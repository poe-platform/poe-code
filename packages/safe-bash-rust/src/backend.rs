mod session;
use crate::budget::{ExecutionBudget, ShellLimits};
use crate::fs::{SafeBashFs, VfsEntryKind, VfsFileEntry};
use crate::vfs::{FileStat, host_text, shell_text};
use crate::shell::eval::{EvalError, EvalState};
use crate::shell::parser::CommandNode;
use mcp_protocol_rust::json::{Limits, Value, parse, stringify};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackendMode {
    Hybrid,
    #[default]
    NativeOnly,
    TypeScriptOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub cwd: String,
    pub env: BTreeMap<String, String>,
}

pub(crate) enum CommandFailure {
    Diagnostic(String),
    Abort(String),
}

#[derive(Default)]
pub struct InvokeOptions<'a> {
    pub argv0: Option<&'a str>,
    pub cwd: Option<&'a str>,
    pub env: BTreeMap<String, String>,
    pub replace_env: bool,
    pub external_invocation: bool,
    pub merge_stderr: bool,
    pub stdin_is_default: bool,
    /// Share the caller's input descriptor and its read position with this invocation.
    pub inherit_stdin: bool,
}

pub struct CommandContext<'a> {
    pub(crate) caller: &'a mut dyn crate::shell::eval::CommandCaller,
    pub command: &'a str,
    pub argv0: Option<&'a str>,
    pub args: &'a [String],
    pub stdin: &'a str,
    pub stdin_is_default: bool,
    pub(crate) shared_output: bool,
    pub(crate) forwarded: (usize, usize),
    pub(crate) stream_access: u32,
    pub(crate) failure: Option<CommandFailure>,
    pub(crate) unread_stdin: Option<String>,
    pub(crate) budget: &'a ExecutionBudget,
    pub cwd: &'a mut String,
    pub env: &'a mut BTreeMap<String, String>,
    pub fs: &'a dyn SafeBashFs,
}

pub type RustCommand =
    Arc<dyn Fn(&mut CommandContext<'_>) -> Result<CommandResult, String> + Send + Sync>;

#[derive(Clone, Default)]
struct ShellBindings {
    functions: BTreeMap<String, CommandNode>,
    exported_functions: BTreeSet<String>,
    positional: Vec<String>,
}

#[derive(Default)]
pub struct HybridBackend {
    pub mode: BackendMode,
    pub(crate) provided_devices: bool,
    commands: BTreeMap<String, RustCommand>,
    pub(crate) middleware: Option<RustCommand>,
    bindings: Mutex<ShellBindings>,
    pub(crate) used_typescript_bridge: Arc<AtomicBool>,
    pub(crate) last_elapsed_ms: AtomicU32,
}

impl Clone for HybridBackend {
    fn clone(&self) -> Self {
        Self {
            mode: self.mode,
            provided_devices: self.provided_devices,
            commands: self.commands.clone(),
            middleware: self.middleware.clone(),
            last_elapsed_ms: AtomicU32::default(),
            bindings: Mutex::new(self.bindings.lock().unwrap().clone()),
            used_typescript_bridge: self.used_typescript_bridge.clone(),
        }
    }
}

fn jstr(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_jstr(u: &[u16]) -> String {
    String::from_utf16_lossy(u)
}

fn obj_get<'a>(props: &'a [(Vec<u16>, Value)], key: &str) -> Option<&'a Value> {
    let key_u16 = jstr(key);
    props.iter().find_map(|(k, v)| (k == &key_u16).then_some(v))
}

struct BudgetedFs<'a> {
    inner: &'a dyn SafeBashFs,
    budget: &'a ExecutionBudget,
}

fn quote_host_text(text: String) -> String {
    match shell_text(&text) {
        std::borrow::Cow::Borrowed(_) => text,
        std::borrow::Cow::Owned(quoted) => quoted,
    }
}

impl<'a> SafeBashFs for BudgetedFs<'a> {
    fn shell_limits(&self) -> ShellLimits {
        self.budget.limits.clone()
    }

    fn limit_error(&self, name: &str, maximum: usize) -> String {
        self.budget.record_exceeded(ShellLimits::limit_error(name, maximum))
    }

    fn remaining_output_bytes(&self) -> usize { self.budget.remaining_output_bytes() }

    fn max_input_bytes(&self) -> usize {
        self.budget.limits.max_input_bytes
    }

    fn access_path(&self, path: &str, follow_final: bool) -> Result<String, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.access_path(&host_text(path), follow_final).map(quote_host_text).map_err(quote_host_text)
    }

    fn command_create_path(&self, path: &str) -> Result<String, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.command_create_path(&host_text(path)).map(quote_host_text).map_err(quote_host_text)
    }

    fn inspect_command_entry(&self, path: &str, follow: bool, syscall: &str) -> Result<(String, crate::vfs::FileStat), String> {
        self.budget.tick_fs_op()?;
        self.budget.limits.check_path(path)?;
        self.inner.inspect_command_entry(&host_text(path), follow, syscall).map(|(p, st)| (quote_host_text(p), st)).map_err(quote_host_text)
    }

    fn scratch_file(&self, directory: &str) -> Result<std::rc::Rc<dyn crate::vfs::OpenRedirectFile>, String> {
        self.budget.limits.check_path(directory)?;
        self.budget.tick_fs_op()?;
        self.inner.scratch_file(&host_text(directory)).map_err(quote_host_text)
    }

    fn supports_command_descriptor(&self, entry: &str) -> bool {
        self.inner.supports_command_descriptor(&host_text(entry))
    }

    fn open_exclusive_redirect(&self, path: &str, mode: u32) -> Result<Option<crate::vfs::ChunkWriter<'static>>, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        let stream = self.inner.open_exclusive_redirect(&host_text(path), mode).map_err(quote_host_text)?;
        Ok(stream.map(|mut write| Box::new(move |chunk: Option<&[u8]>| write(chunk).map_err(quote_host_text)) as crate::vfs::ChunkWriter<'static>))
    }

    fn open_redirect_file(&self, path: &str, access: crate::vfs::RedirectAccess, create_mode: Option<u32>) -> Result<Option<std::rc::Rc<dyn crate::vfs::OpenRedirectFile>>, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.open_redirect_file(&host_text(path), access, create_mode).map_err(quote_host_text)
    }

    fn open_command_stream<'b>(&'b self, path: &str, append: bool, exclusive: bool, mode: u32, _: Option<&'b ExecutionBudget>) -> Result<crate::vfs::ChunkWriter<'b>, String> {
        self.budget.limits.check_path(path)?;
        let mut stream = self.inner.open_command_stream(&host_text(path), append, exclusive, mode, Some(self.budget)).map_err(quote_host_text)?;
        Ok(Box::new(move |chunk| stream(chunk).map_err(quote_host_text)))
    }

    fn write_command_path(&self, path: &str, bytes: &[u8], append: bool, mode: u32) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(bytes.len())?;
        self.inner.write_command_path(&host_text(path), bytes, append, mode).map_err(quote_host_text)
    }

    fn command_descriptor_op(&self) -> Result<(), String> { self.budget.tick_fs_op() }

    fn write_command_file_at(&self, file: &dyn crate::vfs::OpenRedirectFile, offset: Option<usize>, bytes: &[u8]) -> Result<(), String> {
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(bytes.len())?;
        file.write_at(offset, bytes).map_err(quote_host_text)
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        self.budget.tick_fs_op()?;
        self.budget.limits.check_path(path)?;
        self.inner.read_file(&host_text(path)).map_err(quote_host_text)
    }

    fn has_path_capabilities(&self) -> bool { self.inner.has_path_capabilities() }

    fn supplies_single_chunk_input(&self) -> bool { self.inner.supplies_single_chunk_input() }

    fn read_single_chunk_input(&self, path: &str, _: Option<&ExecutionBudget>) -> Result<Vec<u8>, String> {
        self.budget.limits.check_path(path)?;
        self.inner.read_single_chunk_input(&host_text(path), Some(self.budget)).map_err(quote_host_text)
    }

    fn open_read_file(&self, path: &str, allow_directory: bool) -> Result<Box<dyn crate::vfs::FileReadHandle>, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.open_read_file(&host_text(path), allow_directory).map_err(quote_host_text)
    }

    fn open_stream_reader(&self, path: &str) -> Result<Box<dyn crate::vfs::FileReadHandle>, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.open_stream_reader(&host_text(path)).map_err(quote_host_text)
    }

    fn open_chunks(&self, path: &str) -> Result<crate::vfs::ChunkReader<'_>, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        let mut next = self.inner.open_chunks(&host_text(path)).map_err(quote_host_text)?;
        Ok(Box::new(move |chunk| {
            self.budget.check_cancelled()?;
            next(chunk)
        }))
    }

    fn open_chunks_sized(&self, path: &str, size: std::num::NonZeroUsize) -> Result<crate::vfs::ChunkReader<'_>, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        let mut next = self.inner.open_chunks_sized(&host_text(path), size).map_err(quote_host_text)?;
        Ok(Box::new(move |chunk| {
            self.budget.check_cancelled()?;
            next(chunk)
        }))
    }

    fn commit_file_edit(&self, path: &str, original: &crate::vfs::FileStat, before: &[u8], after: &[u8], in_place: bool) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(after.len())?;
        self.inner.commit_file_edit(&host_text(path), original, before, after, in_place).map_err(quote_host_text)
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        self.inner.create_file(&host_text(path), data, mode).map_err(quote_host_text)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_redirect_path(path, data, false, crate::vfs::RedirectCharge(0))
    }

    fn patch_revision(&self, path: &str) -> Result<(u64, u64), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.patch_revision(&host_text(path)).map_err(quote_host_text)
    }

    fn observe_patch(&self,path:&str)->Result<(u64,crate::vfs::PublicationStamp),String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.observe_patch(&host_text(path)).map_err(quote_host_text)
    }
    fn patch_file(&self, path: &str, bytes: Option<&[u8]>, expected: (u64, u64)) -> Result<u64, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        if let Some(data) = bytes { self.budget.add_output_bytes(data.len())?; }
        self.inner.patch_file(&host_text(path), bytes, expected).map_err(quote_host_text)
    }

    fn replace_file_entry(&self, path: &str, data: &[u8], version: u64) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        self.inner.replace_file_entry(&host_text(path), data, version).map_err(quote_host_text)
    }
    fn replace_file_entry_with_mode(&self, path: &str, data: &[u8], mode: u32, version: u64) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        self.inner.replace_file_entry_with_mode(&host_text(path), data, mode, version).map_err(quote_host_text)
    }
    fn replace_file_batch(&self, mut files: Vec<(String, Vec<u8>, u32)>, version: u64) -> Result<(), String> {
        for (path, bytes, _) in &mut files {
            self.budget.limits.check_path(path)?;
            self.budget.tick_fs_op()?;
            self.budget.add_output_bytes(bytes.len())?;
            if let std::borrow::Cow::Owned(p) = host_text(path) { *path = p; }
        }
        self.inner.replace_file_batch(files, version).map_err(quote_host_text)
    }
    fn replace_staged_file(&self, path: &str, data: &[u8], version: u64) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.replace_staged_file(&host_text(path), data, version).map_err(quote_host_text)
    }

    fn supports_conditional_removal(&self, path: &str) -> bool {
        self.inner.supports_conditional_removal(&host_text(path))
    }
    fn remove_unchanged_entry(&self, path: &str, parent: &crate::vfs::FileStat, expected: &crate::vfs::FileStat) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.remove_unchanged_entry(&host_text(path),parent,expected).map_err(quote_host_text)
    }

    fn remove_unchanged_file(&self, path: &str, parent: &crate::vfs::FileStat, expected: &crate::vfs::FileStat) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.remove_unchanged_file(&host_text(path), parent, expected).map_err(quote_host_text)
    }

    fn inspect_extraction(&self,path:&str,allow_trusted_ancestry:bool)->Result<(Option<FileStat>,crate::vfs::PublicationStamp),String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.inspect_extraction(&host_text(path),allow_trusted_ancestry).map_err(quote_host_text)
    }
    fn charge_extraction_bytes(&self,bytes:usize)->Result<(),String>{self.budget.add_output_bytes(bytes)}
    fn publish_extraction_symlink(&self,path:&str,target:&str,parent:&FileStat,expected:Option<&FileStat>,stamp:u64)->Result<(),String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.publish_extraction_symlink(&host_text(path),&host_text(target),parent,expected,stamp).map_err(quote_host_text)
    }
    fn prepare_extraction_directory(&self,path:&str,parent:&FileStat,expected:Option<&FileStat>,mode:u32,times:(Option<f64>,Option<f64>),stamp:u64)->Result<FileStat,String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.prepare_extraction_directory(&host_text(path),parent,expected,mode,times,stamp).map_err(quote_host_text)
    }
    fn remove_extraction_entry(&self,path:&str,expected:&FileStat,version:u64)->Result<(),String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.remove_extraction_entry(&host_text(path),expected,version).map_err(quote_host_text)
    }
    fn replace_file_entry_with_metadata(&self, path: &str, data: &[u8], mode: u32, times: (Option<f64>, Option<f64>), version: u64) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        self.inner.replace_file_entry_with_metadata(&host_text(path), data, mode, times, version).map_err(quote_host_text)
    }

    fn observe_publication(&self,path:&str,generation:u64,mode:crate::vfs::PublicationMode)->Result<crate::vfs::PublicationStamp,String> {
        self.budget.limits.check_path(path)?;
        self.inner.observe_publication(&host_text(path),generation,mode).map_err(quote_host_text)
    }
    fn publish_file(&self, path: &str, data: &[u8], inputs: &[String], version: u64) -> Result<u64, String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len())?;
        if inputs.iter().any(|p| p.contains(crate::vfs::is_stream_byte)) {
            let inputs: Vec<_> = inputs.iter().map(|p| host_text(p).into_owned()).collect();
            self.inner.publish_file(&host_text(path), data, &inputs, version).map_err(quote_host_text)
        } else {
            self.inner.publish_file(&host_text(path), data, inputs, version).map_err(quote_host_text)
        }
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_redirect_path(path, data, true, crate::vfs::RedirectCharge(0))
    }

    fn write_redirect_path(&self, path: &str, data: &[u8], append: bool, charge: crate::vfs::RedirectCharge) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.budget.add_output_bytes(data.len() - charge.0)?;
        let path = host_text(path);
        if append { self.inner.append_file(&path, data) } else { self.inner.write_file(&path, data) }
            .map_err(quote_host_text)
    }

    fn remove_published(&self, path: &str, publication: u64) -> Result<bool, String> {
        self.budget.limits.check_path(path)?;
        self.inner.remove_published(&host_text(path), publication).map_err(quote_host_text)
    }

    fn move_across_devices(&self, source: &str, destination: &str, _: Option<&ExecutionBudget>) -> Result<(), String> {
        self.budget.limits.check_path(source)?;
        self.budget.limits.check_path(destination)?;
        self.inner.move_across_devices(&host_text(source), &host_text(destination), Some(self.budget)).map_err(quote_host_text)
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        self.budget.limits.check_path(source)?;
        self.budget.limits.check_path(destination)?;
        self.budget.tick_fs_op()?;
        self.inner.rename(&host_text(source), &host_text(destination), no_replace).map_err(quote_host_text)
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.remove_one(&host_text(path), directory).map_err(quote_host_text)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.inner.remove_path(&host_text(path)).map_err(quote_host_text)
    }

    fn mkdir(&self, path: &str, recursive: bool, mode: u32) -> Result<(), (String, String)> {
        self.mkdir_with_operation(path, recursive, mode, false).map_err(|(code, _, at)| (code, at))
    }

    fn check_mkdir_creation_mode(&self, path: &str, recursive: bool) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.inner.check_mkdir_creation_mode(&host_text(path), recursive).map_err(quote_host_text)
    }

    fn rmdir_support(&self, path: &str, entry: Option<&str>) -> Result<crate::vfs::RmdirSupport, String> {
        self.inner.rmdir_support(&host_text(path), entry.map(host_text).as_deref())
    }

    fn default_device_view(&self) -> bool { self.inner.default_device_view() }
    fn reserved_device(&self, path: &str, follow: bool) -> Result<Option<&'static str>,String> {
        self.budget.limits.check_path(path)?;
        self.inner.reserved_device(&host_text(path),follow)
    }

    fn mkdir_with_operation(&self, path: &str, recursive: bool, mode: u32, try_backing: bool) -> Result<(), (String, &'static str, String)> {
        self.budget.limits.check_path(path).and_then(|()| self.budget.tick_fs_op())
            .map_err(|error| (error, "mkdir", path.to_owned()))?;
        self.inner.mkdir_with_operation(&host_text(path), recursive, mode, try_backing)
            .map_err(|(code, op, at)| (code, op, quote_host_text(at)))
    }

    fn mkdir_one(&self, path: &str, mode: u32) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.budget.tick_fs_op()?;
        self.inner.mkdir_one(&host_text(path), mode).map_err(quote_host_text)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.inner.mkdir_all(&host_text(path)).map_err(quote_host_text)
    }

    fn exists(&self, path: &str) -> bool {
        self.budget.limits.check_path(path).is_ok() && self.inner.exists(&host_text(path))
    }

    fn is_dir(&self, path: &str) -> bool {
        self.budget.limits.check_path(path).is_ok() && self.inner.is_dir(&host_text(path))
    }

    fn link_free_memory(&self) -> bool { self.inner.link_free_memory() }

    fn indexed_directory_entry(&self, path: &str) -> Option<bool> {
        self.inner.indexed_directory_entry(&host_text(path))
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        self.budget.limits.check_path(path)?;
        self.inner.list_dir(&host_text(path)).map(|mut names| { for name in &mut names { if let std::borrow::Cow::Owned(s) = shell_text(name) { *name = s; } } names }).map_err(quote_host_text)
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        self.budget.limits.check_path(path)?;
        self.inner.directory_entries(&host_text(path), limit).map(|mut entries| { for (name, _) in &mut entries { if let std::borrow::Cow::Owned(s) = shell_text(name) { *name = s; } } entries }).map_err(quote_host_text)
    }

    fn needs_readlink_lookup(&self, path: &str) -> bool { self.inner.needs_readlink_lookup(&host_text(path)) }
    fn readlink_supported(&self, path: &str) -> Result<bool, String> {
        self.budget.tick_fs_op()?;
        self.budget.limits.check_path(path)?;
        self.inner.readlink_supported(&host_text(path)).map_err(quote_host_text)
    }

    fn supports_symbolic_links(&self, entry: &str) -> bool { self.inner.supports_symbolic_links(&host_text(entry)) }
    fn supports_hard_links(&self, path: &str) -> bool { self.inner.supports_hard_links(&host_text(path)) }

    fn hard_link(&self, source: &str, destination: &str) -> Result<(), String> {
        self.budget.limits.check_path(source)?;
        self.budget.limits.check_path(destination)?;
        self.budget.tick_fs_op()?;
        self.inner.hard_link(&host_text(source), &host_text(destination)).map_err(quote_host_text)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.inner.symlink(&host_text(target), &host_text(path)).map_err(quote_host_text)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        self.budget.limits.check_path(path)?;
        self.inner.readlink(&host_text(path)).map(quote_host_text).map_err(quote_host_text)
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        self.inner.export_entries()
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        self.inner.replace_entries(entries)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        self.budget.limits.check_path(path)?;
        self.inner.stat(&host_text(path)).map_err(quote_host_text)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        self.budget.limits.check_path(path)?;
        self.inner.lstat(&host_text(path)).map_err(quote_host_text)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.inner.chmod(&host_text(path), mode).map_err(quote_host_text)
    }

    fn set_times(&self, path: &str, atime_ms: Option<f64>, mtime_ms: Option<f64>) -> Result<(), String> {
        self.budget.limits.check_path(path)?;
        self.inner.set_times(&host_text(path), atime_ms, mtime_ms).map_err(quote_host_text)
    }

    fn generation(&self) -> u64 {
        self.inner.generation()
    }
}

impl HybridBackend {
    pub fn new(mode: BackendMode) -> Self {
        Self {
            mode,
            ..Default::default()
        }
    }

    pub fn register_command(&mut self, name: impl Into<String>, cmd: RustCommand) {
        self.commands.insert(name.into(), cmd);
    }

    pub fn try_execute_native(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        fs: &dyn SafeBashFs,
    ) -> Option<Result<CommandResult, String>> {
        self.try_execute_native_with_limits(
            script,
            cwd,
            env,
            stdin,
            None,
            &ShellLimits::default(),
            fs,
        )
    }

    pub fn try_execute_native_with_limits(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        timeout_ms: Option<u64>,
        limits: &ShellLimits,
        fs: &dyn SafeBashFs,
    ) -> Option<Result<CommandResult, String>> {
        self.execute_native_input(script, cwd, env, Some(stdin), None, timeout_ms, limits, fs)
    }

    pub(crate) fn execute_native_input(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: Option<&str>,
        stream: Option<crate::shell::eval::FdTarget>,
        timeout_ms: Option<u64>,
        limits: &ShellLimits,
        fs: &dyn SafeBashFs,
    ) -> Option<Result<CommandResult, String>> {
        self.used_typescript_bridge.store(false, Ordering::Relaxed);
        let budget = ExecutionBudget::new(limits.clone(), timeout_ms);
        let budgeted_fs = BudgetedFs {
            inner: fs,
            budget: &budget,
        };
        let allow_fallback = self.mode == BackendMode::Hybrid && stream.is_none();
        let mut shell_cwd = shell_text(cwd).into_owned();
        let mut eval = EvalState::new(&mut shell_cwd, env, &budgeted_fs, &budget, &self.commands, allow_fallback);
        eval.middleware = self.middleware.as_ref();
        if stdin.is_none() && stream.is_none() && (!self.commands.is_empty() || self.middleware.is_some()) { eval.default_input_fds.insert(0); }
        if let Some(input) = stream { eval.fd_table.insert(0, input); }
        eval.used_typescript_bridge = self.used_typescript_bridge.clone();
        eval.provided_devices = self.provided_devices;
        if let Ok(bindings) = self.bindings.lock() {
            eval.functions.clone_from(&bindings.functions);
            eval.exported_functions.clone_from(&bindings.exported_functions);
            eval.pos_args.clone_from(&bindings.positional);
        }
        let (eval_res, elapsed_ms) = eval.eval_script_timed(script, stdin.unwrap_or(""));
        *cwd = host_text(eval.cwd).into_owned();
        self.last_elapsed_ms.store(elapsed_ms, Ordering::Relaxed);
        if let Err(exceeded_msg) = budget.check_exceeded() {
            return Some(Err(exceeded_msg));
        }
        match eval_res {
            Ok(mut res) => {
                res.cwd.clone_from(cwd);
                let last_exit_str = res.exit_code.to_string();
                if let Ok(mut bindings) = self.bindings.lock() {
                    *bindings = ShellBindings {
                        functions: eval.functions,
                        exported_functions: eval.exported_functions,
                        positional: eval.pos_args,
                    };
                }
                if script != ":" {
                    env.insert("\0last_exit".to_string(), last_exit_str);
                }
                Some(Ok(res))
            }
            Err(EvalError::Syntax(msg)) => {
                let code = if msg.starts_with("__exit127__") { 127 } else { 2 };
                let stderr = eval.format_active_syntax_diagnostic(script, &msg);
                if script != ":" {
                    env.insert("\0last_exit".to_string(), code.to_string());
                }
                Some(Ok(CommandResult {
                    stdout: String::new(),
                    stderr,
                    exit_code: code,
                    cwd: cwd.clone(),
                    env: env.clone(),
                }))
            }
            Err(EvalError::Budget(msg) | EvalError::OutputClose(msg)) => Some(Err(msg)),
            Err(EvalError::UnportedCommand(_)) => None,
        }
    }

    #[cfg(target_arch = "wasm32")]
    pub fn execute_typescript_bridge(
        &self,
        _script: &str,
        _cwd: &mut String,
        _env: &mut BTreeMap<String, String>,
        _stdin: &str,
        _timeout_ms: Option<u64>,
        _fs: &dyn SafeBashFs,
    ) -> Result<CommandResult, String> {
        let _ = (jstr, from_jstr, obj_get, base64_encode, base64_decode);
        let _ = (Limits::default, Value::Null, parse, stringify, VfsEntryKind::File, VfsFileEntry {
            path: String::new(),
            kind: VfsEntryKind::File,
            data: Default::default(),
            link_group: None,
            symlink_target: None,
            mode: 0,
        });
        Err("TypeScript subprocess bridge is not available on wasm32".into())
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn execute_typescript_bridge(
        &self,
        script: &str,
        cwd: &mut String,
        env: &mut BTreeMap<String, String>,
        stdin: &str,
        timeout_ms: Option<u64>,
        fs: &dyn SafeBashFs,
    ) -> Result<CommandResult, String> {
        use std::io::Write;
        use std::path::PathBuf;
        use std::process::{Command, Stdio};

        let entries = fs.export_entries()?;
        let mut files_json = Vec::with_capacity(entries.len());
        let mut emitted = std::collections::BTreeSet::new();
        for entry in entries {
            let kind_str = match entry.kind {
                VfsEntryKind::File => "file",
                VfsEntryKind::Directory => "directory",
                VfsEntryKind::Symlink => "symlink",
            };
            let mut obj = vec![
                (jstr("path"), Value::String(jstr(&entry.path))),
                (jstr("kind"), Value::String(jstr(kind_str))),
                (
                    jstr("dataBase64"),
                    Value::String(jstr(&if entry.link_group.is_some_and(|id| !emitted.insert(id)) { String::new() } else { base64_encode(&entry.data) })),
                ),
                (jstr("mode"), Value::Number(entry.mode as f64)),
            ];
            if let Some(id) = entry.link_group { obj.push((jstr("linkGroup"), Value::String(jstr(&id.to_string())))); }
            if let Some(target) = entry.symlink_target {
                obj.push((jstr("symlinkTarget"), Value::String(jstr(&target))));
            }
            files_json.push(Value::Object(obj));
        }

        let mut env_obj = Vec::with_capacity(env.len());
        for (k, v) in env.iter().filter(|(k, _)| !k.contains('\0')) {
            env_obj.push((jstr(k), Value::String(jstr(&host_text(v)))));
        }

        let mut req_obj = vec![
            (jstr("script"), Value::String(jstr(script))),
            (jstr("cwd"), Value::String(jstr(cwd))),
            (jstr("env"), Value::Object(env_obj)),
            (jstr("stdinBase64"), Value::String(jstr(&base64_encode(&crate::vfs::stream_string_to_bytes(stdin))))),
            (jstr("files"), Value::Array(files_json)),
        ];
        if let Some(ms) = timeout_ms {
            req_obj.push((jstr("timeoutMs"), Value::Number(ms as f64)));
        }

        let payload = stringify(&Value::Object(req_obj));
        let runner_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bridge")
            .join("runner.mjs");

        let mut child = Command::new("node")
            .arg(&runner_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn safe-bash TypeScript bridge: {e}"))?;

        if let Some(mut child_stdin) = child.stdin.take() {
            child_stdin
                .write_all(payload.as_bytes())
                .map_err(|e| format!("Failed writing to bridge stdin: {e}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed waiting for safe-bash bridge: {e}"))?;

        if !output.status.success() {
            let stderr_text = String::from_utf8_lossy(&output.stderr);
            return Err(format!("safe-bash bridge failed: {stderr_text}"));
        }

        let parsed = parse(
            &output.stdout,
            Limits {
                max_bytes: 64 * 1024 * 1024,
                max_depth: 128,
                max_nodes: 1_048_576,
            },
        )
        .map_err(|e| format!("Invalid JSON from safe-bash bridge: {e:?}"))?;

        let Value::Object(resp) = parsed else {
            return Err("Expected JSON object from safe-bash bridge".into());
        };

        if let Some(Value::Bool(true)) = obj_get(&resp, "timedOut") {
            return Err("Command timed out".into());
        }

        let out_stdout = match obj_get(&resp, "stdoutBase64") {
            Some(Value::String(s)) => crate::vfs::bytes_to_stream_string(&base64_decode(&from_jstr(s))?),
            _ => String::new(),
        };
        let out_stderr = match obj_get(&resp, "stderr") {
            Some(Value::String(s)) => from_jstr(s),
            _ => String::new(),
        };
        let exit_code = match obj_get(&resp, "exitCode") {
            Some(Value::Number(n)) => *n as i32,
            _ => 0,
        };
        if let Some(Value::String(next_cwd)) = obj_get(&resp, "cwd") {
            *cwd = from_jstr(next_cwd);
        }
        if let Some(Value::Object(next_env)) = obj_get(&resp, "env") {
            env.retain(|k, _| k.starts_with('\0'));
            for (k, v) in next_env {
                if !k.contains(&0) && let Value::String(s) = v {
                    env.insert(from_jstr(k), shell_text(&from_jstr(s)).into_owned());
                }
            }
        }

        if let Some(Value::Array(files)) = obj_get(&resp, "files") {
            let mut synced = Vec::with_capacity(files.len());
            for item in files {
                if let Value::Object(f) = item {
                    let Some(Value::String(path)) = obj_get(f, "path") else {
                        continue;
                    };
                    let kind = match obj_get(f, "kind") {
                        Some(Value::String(k)) => match from_jstr(k).as_str() {
                            "directory" => VfsEntryKind::Directory,
                            "symlink" => VfsEntryKind::Symlink,
                            _ => VfsEntryKind::File,
                        },
                        _ => VfsEntryKind::File,
                    };
                    let symlink_target = match obj_get(f, "symlinkTarget") {
                        Some(Value::String(t)) => Some(from_jstr(t)),
                        _ => None,
                    };
                    let bytes = match obj_get(f, "dataBase64") {
                        Some(Value::String(b64)) => base64_decode(&from_jstr(b64))?,
                        _ => Vec::new(),
                    };
                    let mode = match obj_get(f, "mode") {
                        Some(Value::Number(m)) => *m as u32,
                        _ => 0o100644,
                    };
                    synced.push(VfsFileEntry {
                        path: from_jstr(path),
                        kind,
                        data: bytes.into(),
                        link_group: match obj_get(f, "linkGroup") {
                            Some(Value::String(id)) => Some(from_jstr(id).parse().map_err(|_| "invalid link group")?),
                            _ => None,
                        },
                        symlink_target,
                        mode,
                    });
                }
            }
            fs.replace_entries(&synced)?;
        }

        Ok(CommandResult {
            stdout: out_stdout,
            stderr: out_stderr,
            exit_code,
            cwd: cwd.clone(),
            env: env.clone(),
        })
    }
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(BASE64_ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(BASE64_ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(BASE64_ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(BASE64_ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn base64_val(b: u8) -> Option<u32> {
    match b {
        b'A'..=b'Z' => Some((b - b'A') as u32),
        b'a'..=b'z' => Some((b - b'a' + 26) as u32),
        b'0'..=b'9' => Some((b - b'0' + 52) as u32),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if !bytes.len().is_multiple_of(4) {
        return Err("Invalid base64 length".into());
    }
    let mut out = Vec::with_capacity((bytes.len() / 4) * 3);
    for chunk in bytes.chunks(4) {
        let c0 = base64_val(chunk[0]).ok_or("Invalid base64 char")?;
        let c1 = base64_val(chunk[1]).ok_or("Invalid base64 char")?;
        let c2 = if chunk[2] == b'=' {
            0
        } else {
            base64_val(chunk[2]).ok_or("Invalid base64 char")?
        };
        let c3 = if chunk[3] == b'=' {
            0
        } else {
            base64_val(chunk[3]).ok_or("Invalid base64 char")?
        };
        let triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
        out.push(((triple >> 16) & 0xFF) as u8);
        if chunk[2] != b'=' {
            out.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk[3] != b'=' {
            out.push((triple & 0xFF) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::MemoryVfs;

    #[test]
    fn unit_hybrid_backend_custom_command_functions_and_base64_roundtrip() {
        let raw = b"safe-bash-rust-binary-\x00\xff-payload";
        let enc = base64_encode(raw);
        let dec = base64_decode(&enc).unwrap();
        assert_eq!(dec, raw);

        let mut backend = HybridBackend::new(BackendMode::NativeOnly);
        backend.register_command(
            "DoubleStdin",
            Arc::new(|ctx| {
                Ok(CommandResult {
                    stdout: format!("{}{}", ctx.stdin, ctx.stdin),
                    stderr: String::new(),
                    exit_code: 0,
                    cwd: ctx.cwd.clone(),
                    env: ctx.env.clone(),
                })
            }),
        );

        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();
        let limits = ShellLimits::default();

        let fn_def = backend
            .try_execute_native_with_limits(
                "greet() { echo \"hi-$1\"; }; greet world",
                &mut cwd,
                &mut env,
                "",
                None,
                &limits,
                &vfs,
            )
            .unwrap()
            .unwrap();
        assert_eq!(fn_def.exit_code, 0);
        assert_eq!(fn_def.stdout, "hi-world\n");

        let fn_reuse = backend
            .try_execute_native_with_limits(
                "greet again",
                &mut cwd,
                &mut env,
                "",
                None,
                &limits,
                &vfs,
            )
            .unwrap()
            .unwrap();
        assert_eq!(fn_reuse.stdout, "hi-again\n");

        let custom = backend
            .try_execute_native_with_limits(
                "printf 'ab' | DoubleStdin",
                &mut cwd,
                &mut env,
                "",
                None,
                &limits,
                &vfs,
            )
            .unwrap()
            .unwrap();
        assert_eq!(custom.stdout, "abab");
    }

    #[test]
    fn middleware_continues_in_the_original_shell_without_recharging_command_output() {
        let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
        fs.mkdir_all("/other").unwrap();
        shell.set_limits(ShellLimits {max_output_bytes: 8,..Default::default()});
        shell.set_middleware(Arc::new(|ctx| {
            let mut input = ctx.stdin.to_owned();
            let result = ctx.proceed(&mut input)?;
            assert!(ctx.proceed(&mut input).is_err());
            Ok(CommandResult {stdout:result.stdout,stderr:result.stderr,exit_code:result.exit_code,
                cwd:ctx.cwd.clone(),env:ctx.env.clone()})
        }));
        let r = shell.exec("cd /other; pwd; printf X").unwrap();
        assert_eq!((r.stdout.as_str(),r.cwd.as_str()),("/other\nX","/other"));
    }

    #[test]
    fn middleware_context_applies_to_functions_without_leaking_into_the_caller() {
        let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
        fs.mkdir_all("/work").unwrap();
        shell.set_middleware(Arc::new(|ctx| {
            if ctx.command == "probe" {
                *ctx.cwd = "/work".into();
                ctx.env.insert("LABEL".into(),"inner".into());
            }
            let mut input = ctx.stdin.to_owned();
            let r = ctx.proceed(&mut input)?;
            Ok(CommandResult {stdout:r.stdout,stderr:r.stderr,exit_code:r.exit_code,cwd:ctx.cwd.clone(),env:ctx.env.clone()})
        }));
        let r = shell.exec("export LABEL=outer; probe(){ pwd; echo $LABEL; }; probe; pwd; echo $LABEL").unwrap();
        assert_eq!(r.stdout,"/work\ninner\n/\nouter\n");
    }

    #[test]
    fn registered_commands_override_executables_but_not_forced_shell_builtins() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        for name in ["pwd", "true", "false", "kill", "echo", "cd", "cat"] {
            shell.register_command(name, Arc::new(|ctx| Ok(CommandResult {
                stdout: "extension\n".into(), stderr: String::new(), exit_code: 23,
                cwd: ctx.cwd.clone(), env: ctx.env.clone(),
            })));
        }
        for (script, code, out) in [
            ("pwd", 23, "extension\n"), ("command true", 23, "extension\n"),
            ("/usr/bin/false", 23, "extension\n"), ("/bin/kill", 23, "extension\n"),
            ("builtin pwd", 0, "/\n"), ("builtin false", 1, ""),
            ("builtin echo test", 23, "extension\n"), ("cd /", 0, ""),
            ("/bin/cd", 23, "extension\n"), ("pwd() { return 7; }; pwd", 7, ""),
            ("command pwd", 23, "extension\n"), ("cat", 23, "extension\n"),
        ] {
            let r = shell.exec(script).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str()), (code, out), "{script}");
        }
    }

    #[test]
    fn registered_command_discovery_uses_which_options_and_the_callers_path() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        shell.register_command("probe", Arc::new(|_| panic!("discovery executed the command")));
        for (script, code, out, err) in [
            ("which probe", 0, "/bin/probe\n", ""),
            ("PATH=/nowhere which probe", 1, "", ""),
            ("PATH=/usr/bin:/bin which -a probe", 0, "/usr/bin/probe\n/bin/probe\n", ""),
            ("/bin/which /usr/bin/probe", 0, "/usr/bin/probe\n", ""),
            ("which -z probe", 1, "", "which: illegal option -- z\nusage: which [-as] program ...\n"),
            ("which probe -z", 1, "/bin/probe\n", ""),
            ("mkdir -p /bin; touch /bin/probe; chmod 000 /bin/probe; which probe", 0, "/bin/probe\n", ""),
        ] {
            let r = shell.exec(script).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (code, out, err), "{script}");
        }
    }

    #[test]
    fn unit_base64_decode_invalid_inputs_and_padding_lengths() {
        assert!(base64_decode("abc").is_err());
        assert!(base64_decode("ab!d").is_err());
        assert_eq!(base64_decode("").unwrap(), b"");
        for len in 1..=7 {
            let input: Vec<u8> = (0..len).map(|i| (i * 37) as u8).collect();
            let enc = base64_encode(&input);
            assert_eq!(base64_decode(&enc).unwrap(), input);
        }
    }

    #[test]
    fn unit_hybrid_backend_modes_and_vfs_sync() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let backend = HybridBackend::new(BackendMode::NativeOnly);
        assert_eq!(backend.mode, BackendMode::NativeOnly);
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();
        let out = backend
            .try_execute_native("printf 'ok' > /work/f.txt && cat /work/f.txt", &mut cwd, &mut env, "", &vfs)
            .unwrap()
            .unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(out.stdout, "ok");
    }
}
