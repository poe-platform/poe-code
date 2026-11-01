mod descriptor;
use crate::backend::BackendMode;
use crate::budget::ShellLimits;
use crate::fs::{FileStat, MemoryVfs, MountVfs, OverlayVfs, SafeBashFs, VfsEntryKind};
use crate::shell::{ExecOptions, Shell, ShellOptions};
use crate::vfs::{bytes_to_stream_string, stream_string_to_bytes};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Profile { Memory, Overlay, Devices }

struct WasmSession {
    shell: Shell,
    memory_vfs: MemoryVfs,
    descriptors: BTreeMap<u32, descriptor::Descriptor>,
    next_descriptor: u32,
    profile: Profile,
    last_output_buf: Vec<u8>,
}

impl WasmSession {
    // The session lock covers validation and publication, including exclusive creates.
    fn write_target(&self, destination: &str, exclusive: bool, source: Option<(&str, &FileStat)>) -> Result<(String, Option<FileStat>), String> {
        let fs = &self.shell.fs;
        let to = fs.access_path(destination, !exclusive)?;
        let existing = match fs.lstat(&to) {
            Ok(st) => Some(st),
            Err(e) if e.starts_with("ENOENT:") => None,
            Err(e) => return Err(e),
        };
        let target_device = existing.as_ref().is_some_and(|st| st.mode & 0o170000 == 0o020000);
        if let Some(st) = &existing {
            if exclusive { return Err("EEXIST: file already exists".into()); }
            if !target_device && source.is_some_and(|(from, origin)| from == to || (origin.identity.is_some() && st.identity == origin.identity)) {
                return Err("EINVAL: invalid argument".into());
            }
            if st.kind == VfsEntryKind::Directory { return Err("EISDIR: illegal operation on a directory".into()); }
            if st.mode & 0o200 == 0 { return Err("EACCES: permission denied".into()); }
        } else if fs.stat(&crate::vfs::dirname_posix_path(&to))?.mode & 0o300 != 0o300 {
            return Err("EACCES: permission denied".into());
        }
        Ok((to, existing))
    }

    fn write_file(&self, path: &str, data: &[u8], mode: u32, flag: u32) -> Result<(), String> {
        if mode > 0o7777 || flag > 3 { return Err("EINVAL: invalid argument".into()); }
        let fs = &self.shell.fs;
        let (to, existing) = self.write_target(path, flag & 1 != 0, None)?;
        let device = existing.as_ref().is_some_and(|st| st.mode & 0o170000 == 0o020000);
        if flag & 2 != 0 && existing.is_some() && !device {
            let mut bytes = fs.read_file(&to)?;
            bytes.extend_from_slice(data);
            fs.write_file(&to, &bytes)?;
        } else {
            fs.write_file(&to, data)?;
        }
        // A lower-layer file may have been copied into a new overlay entry.
        if !device { fs.chmod(&to, existing.map_or(mode, |st| st.mode & 0o7777))?; }
        Ok(())
    }

    fn copy_file(&self, source: &str, destination: &str, exclusive: bool) -> Result<(), String> {
        let fs = &self.shell.fs;
        let from = fs.access_path(source, true)?;
        let origin = fs.lstat(&from)?;
        if origin.kind == VfsEntryKind::Directory { return Err("EISDIR: illegal operation on a directory".into()); }
        if origin.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        let (to, existing) = self.write_target(destination, exclusive, Some((&from, &origin)))?;
        let source_device = origin.mode & 0o170000 == 0o020000;
        let target_device = existing.is_some_and(|st| st.mode & 0o170000 == 0o020000);
        fs.write_file(&to, &fs.read_file(&from)?)?;
        if !source_device && !target_device { fs.chmod(&to, origin.mode & 0o7777)?; }
        Ok(())
    }
}

static SESSIONS: OnceLock<Mutex<BTreeMap<u32, WasmSession>>> = OnceLock::new();


unsafe fn slice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

unsafe fn str_from_raw<'a>(ptr: *const u8, len: usize) -> &'a str {
    unsafe { std::str::from_utf8_unchecked(slice_from_raw(ptr, len)) }
}

fn sessions() -> &'static Mutex<BTreeMap<u32, WasmSession>> {
    SESSIONS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_dealloc(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, size);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_create_session() -> u32 {
    let mut map = sessions().lock().unwrap();
    let id = map.keys().next_back().copied().unwrap_or(0) + 1;
    let vfs = MemoryVfs::new();
    vfs.set_devices(crate::vfs::memory::Devices::Null);
    let _ = vfs.mkdir_all("/workspace");
    let _ = vfs.mkdir_all("/tmp");
    let _ = vfs.mkdir_all("/home/user");
    let fs_arc: Arc<dyn SafeBashFs> = Arc::new(vfs.clone());
    let shell = Shell::new(
        fs_arc,
        ShellOptions {
            cwd: Some("/workspace".into()),
            env: BTreeMap::new(),
            mode: BackendMode::NativeOnly,
        },
    );
    map.insert(
        id,
        WasmSession {
            shell,
            memory_vfs: vfs,
            descriptors: BTreeMap::new(),
            next_descriptor: 1,
            profile: Profile::Memory,
            last_output_buf: Vec::new(),
        },
    );
    id
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_configure_profile(id: u32, profile: u32) -> i32 {
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    sess.profile = match profile {
        1 => {
            let upper = Arc::new(MemoryVfs::new());
            upper.set_devices(crate::vfs::memory::Devices::None);
            sess.shell.fs = Arc::new(OverlayVfs::new(sess.shell.fs.clone(), upper));
            Profile::Overlay
        }
        2 | 3 => {
            let dev_fs = Arc::new(MemoryVfs::new());
            dev_fs.set_devices(crate::vfs::memory::Devices::Mounted);
            sess.shell.fs = Arc::new(MountVfs::new(sess.shell.fs.clone()).with_mount("/dev", dev_fs));
            sess.shell.use_provided_devices();
            if profile == 2 {
                sess.shell.set_limits(ShellLimits {
                    max_loop_iterations: 50_000,
                    max_commands: 10_000,
                    max_output_bytes: 4 * 1024 * 1024,
                    max_filesystem_operations: 50_000,
                    max_pipeline_stages: 16,
                    max_substitution_depth: 16,
                    max_expansion_fields: 10_000,
                    max_expansion_bytes: 1024 * 1024,
                    ..ShellLimits::default()
                });
            }
            Profile::Devices
        }
        _ => return 0,
    };
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_use_provided_devices(id: u32) {
    if let Some(sess) = sessions().lock().unwrap().get_mut(&id) {
        sess.memory_vfs.set_devices(crate::vfs::memory::Devices::None);
        sess.shell.use_provided_devices();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_destroy_session(id: u32) {
    if let Ok(mut map) = sessions().lock() {
        map.remove(&id);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_fs_mkdir(id: u32, ptr: *const u8, len: usize, recursive: u32, mode: u32, string_path: u32) -> i32 {
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let operand = unsafe { str_from_raw(ptr, len) };
    let revision = sess.shell.fs.generation();
    let invalid = string_path == 0 || operand.contains('\0');
    let result = if invalid {
        let path = if sess.profile == Profile::Devices && !operand.starts_with('/') { format!("/{operand}") } else { operand.to_owned() };
        Err(("EINVAL".to_owned(), path))
    } else { sess.shell.fs.mkdir(operand, recursive != 0, mode) };
    match result {
        Ok(()) => 0,
        Err((code, path)) => {
            let syscall = match sess.profile {
                Profile::Overlay if invalid && mode <= 0o7777 => "resolve",
                Profile::Overlay => "overlay",
                _ => "mkdir",
            };
            let changed = u8::from(revision != sess.shell.fs.generation());
            sess.last_output_buf = format!("{changed}{code}:{syscall}:{path}").into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_mkdir_all(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.shell.fs.mkdir_all(path).is_ok() {
        0
    } else {
        -1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_write_file(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    data_ptr: *const u8,
    data_len: usize,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let data = unsafe { slice_from_raw(data_ptr, data_len) };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.shell.fs.write_file(path, data).is_ok() {
        0
    } else {
        -1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_fs_write_file(
    id: u32, ptr: *const u8, len: usize, data: *const u8, size: usize, mode: u32, flag: u32,
) -> i32 {
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    match sess.write_file(unsafe { str_from_raw(ptr, len) }, unsafe { slice_from_raw(data, size) }, mode, flag) {
        Ok(()) => 0,
        Err(e) => {
            sess.last_output_buf = e.into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_read_file(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    max_bytes: f64,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    // Memory validates options first; mounts resolve the path before calling
    // their backend, and the overlay checks access before admitting the read.
    let invalid_limit = max_bytes < 0.0;
    let fs = &sess.shell.fs;
    let result = (|| {
        if sess.profile == Profile::Memory && invalid_limit { return Err("EINVAL: invalid argument".into()); }
        let p = fs.access_path(path, true)?;
        let st = fs.lstat(&p)?;
        if sess.profile != Profile::Overlay && invalid_limit { return Err("EINVAL: invalid argument".into()); }
        let device = st.mode & 0o170000 == 0o020000;
        if sess.profile == Profile::Devices && device && max_bytes == f64::INFINITY { return Err("EINVAL: invalid argument".into()); }
        if st.kind == VfsEntryKind::Directory { return Err("EISDIR: illegal operation on a directory".into()); }
        if st.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        if invalid_limit { return Err("EINVAL: invalid argument".into()); }
        if device && crate::vfs::basename_posix_path(&p) != "null" { return Err("EFBIG: device has no EOF".into()); }
        if st.size as f64 > max_bytes { return Err("EFBIG: file too large".into()); }
        fs.read_file(&p)
    })();
    match result {
        Ok(bytes) => {
            let len = bytes.len() as i32;
            sess.last_output_buf = bytes;
            len
        }
        Err(e) => {
            sess.last_output_buf = e.into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_realpath(id: u32, ptr: *const u8, len: usize) -> i32 {
    let path = unsafe { str_from_raw(ptr, len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let fs = &sess.shell.fs;
    match fs.access_path(path, true).and_then(|p| fs.lstat(&p).map(|_| p)) {
        Ok(p) => {
            sess.last_output_buf = p.into_bytes();
            sess.last_output_buf.len() as i32
        }
        Err(e) => {
            sess.last_output_buf = e.into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_copy_file(
    id: u32, src_ptr: *const u8, src_len: usize, dst_ptr: *const u8, dst_len: usize, exclusive: bool,
) -> i32 {
    let source = unsafe { str_from_raw(src_ptr, src_len) };
    let destination = unsafe { str_from_raw(dst_ptr, dst_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    match sess.copy_file(source, destination, exclusive) {
        Ok(()) => 0,
        Err(e) => {
            sess.last_output_buf = e.into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_rename(
    id: u32, src_ptr: *const u8, src_len: usize, dst_ptr: *const u8, dst_len: usize, no_replace: bool,
) -> i32 {
    let source = unsafe { str_from_raw(src_ptr, src_len) };
    let destination = unsafe { str_from_raw(dst_ptr, dst_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    match sess.shell.fs.rename(source, destination, no_replace) {
        Ok(()) => 0,
        Err(error) => {
            sess.last_output_buf = format!("{error}, rename '{source}' -> '{destination}'").into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_remove_path(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    // 0: recursive rm (legacy ABI default), 1: unlink, 2: rmdir.
    operation: u32,
    force: bool,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let result = match operation {
        0 => sess.shell.fs.remove_path(path),
        1 | 2 => sess.shell.fs.remove_one(path, operation == 2),
        _ => Err("EINVAL: invalid removal operation".into()),
    };
    match result {
        Ok(()) => 0,
        Err(e) if force && e.starts_with("ENOENT:") => 0,
        Err(e) => {
            sess.last_output_buf = e.into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_symlink(
    id: u32,
    target_ptr: *const u8,
    target_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    let target = unsafe {
        str_from_raw(target_ptr, target_len)
    };
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.shell.fs.symlink(target, path).is_ok() {
        0
    } else {
        -1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_readlink(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    match sess.shell.fs.readlink(path) {
        Ok(target) => {
            let bytes = target.into_bytes();
            let len = bytes.len() as i32;
            sess.last_output_buf = bytes;
            len
        }
        Err(_) => -1,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_chmod(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    mode: u32,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.shell.fs.chmod(path, mode).is_ok() {
        0
    } else {
        -1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_set_mtime(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    mtime_ms: u64,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.shell.fs.set_mtime(path, mtime_ms).is_ok() {
        0
    } else {
        -1
    }
}

fn stat_bytes(st: FileStat) -> Vec<u8> {
    let kind_code: u32 = match st.kind {
        VfsEntryKind::File => 0,
        VfsEntryKind::Directory => 1,
        VfsEntryKind::Symlink => 2,
    };
    let mut buf = Vec::with_capacity(40);
    buf.extend_from_slice(&kind_code.to_le_bytes());
    buf.extend_from_slice(&(st.size as u32).to_le_bytes());
    buf.extend_from_slice(&st.mode.to_le_bytes());
    buf.extend_from_slice(&st.mtime_ms.to_le_bytes());
    if let Some(crate::vfs::EntryIdentity::Memory(dev, ino)) = st.identity {
        buf.extend_from_slice(&dev.to_le_bytes());
        buf.extend_from_slice(&ino.to_le_bytes());
        buf.extend_from_slice(&(st.nlink as u32).to_le_bytes());
    }
    buf
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_stat(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    follow: u32,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    let fs = &sess.shell.fs;
    let res = fs.access_path(path, follow != 0).and_then(|p| fs.lstat(&p));
    match res {
        Ok(st) => {
            sess.last_output_buf = stat_bytes(st);
            sess.last_output_buf.len() as i32
        }
        Err(e) => {
            let code = e.split_once(':').map_or("EIO", |(code, _)| code);
            let root = if sess.profile == Profile::Devices && !path.starts_with('/') { "/" } else { "" };
            sess.last_output_buf = format!("{code}:{root}{path}").into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_readdir(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    let path = unsafe {
        str_from_raw(path_ptr, path_len)
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    let fs = &sess.shell.fs;
    let result = (|| {
        let p = fs.access_path(path, true)?;
        let st = fs.lstat(&p)?;
        if st.kind != VfsEntryKind::Directory { return Err("ENOTDIR: not a directory".into()); }
        if st.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        fs.list_dir(&p)
    })();
    match result {
        Ok(mut entries) => {
            entries.sort();
            let mut buf = Vec::new();
            buf.extend_from_slice(&(entries.len() as u32).to_le_bytes());
            for entry in entries {
                let b = entry.as_bytes();
                buf.extend_from_slice(&(b.len() as u32).to_le_bytes());
                buf.extend_from_slice(b);
            }
            let len = buf.len() as i32;
            sess.last_output_buf = buf;
            len
        }
        Err(e) => {
            let code = e.split_once(':').map_or("EIO", |(c, _)| c);
            let syscall = if sess.profile == Profile::Overlay { "overlay" } else { "readdir" };
            let root = if sess.profile == Profile::Devices && !path.starts_with('/') { "/" } else { "" };
            sess.last_output_buf = format!("{code}:{syscall}:{root}{path}").into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_set_env(
    id: u32,
    key_ptr: *const u8,
    key_len: usize,
    val_ptr: *const u8,
    val_len: usize,
) -> i32 {
    let key = unsafe {
        str_from_raw(key_ptr, key_len)
    };
    let val = unsafe {
        str_from_raw(val_ptr, val_len)
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    if key == "__cwd" {
        sess.shell.set_cwd(val);
        return 0;
    }
    sess.shell.set_env(key, val);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_set_limit(
    id: u32,
    key_ptr: *const u8,
    key_len: usize,
    val: usize,
) -> i32 {
    let key = unsafe { str_from_raw(key_ptr, key_len) };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    let mut lim = sess.shell.limits().clone();
    match key {
        "maxLoopIterations" => lim.max_loop_iterations = val,
        "maxCommands" => lim.max_commands = val,
        "maxOutputBytes" => lim.max_output_bytes = val,
        "maxFileSystemOperations" => lim.max_filesystem_operations = val,
        "maxPipelineStages" => lim.max_pipeline_stages = val,
        "maxSubstitutionDepth" => lim.max_substitution_depth = val,
        "maxFunctionDepth" => lim.max_function_depth = val,
        "maxExpansionFields" => lim.max_expansion_fields = val,
        "maxExpansionBytes" => lim.max_expansion_bytes = val,
        "maxMemoryBytes" => lim.max_memory_bytes = val,
        "maxRedirects" => lim.max_redirects = val,
        "maxPathnameComponents" => lim.max_pathname_components = val,
        "maxInputBytes" => lim.max_input_bytes = val,
        "maxParseUnits" => lim.max_parse_units = val,
        "maxSourceBytes" => lim.max_source_bytes = val,
        "maxVfsBytes" | "maxBytes" => {
            sess.memory_vfs.set_max_total_bytes(val);
            return 0;
        }
        "maxFileBytes" => {
            sess.memory_vfs.set_max_file_bytes(val);
            return 0;
        }
        "maxFiles" => {
            sess.memory_vfs.set_max_entries(val);
            return 0;
        }
        _ => return -1,
    }
    sess.shell.set_limits(lim);
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_exec(
    id: u32,
    script_ptr: *const u8,
    script_len: usize,
    stdin_ptr: *const u8,
    stdin_len: usize,
) -> i32 {
    let script = unsafe {
        str_from_raw(script_ptr, script_len)
    };
    let stdin_bytes = unsafe { slice_from_raw(stdin_ptr, stdin_len) };
    let stdin_str = bytes_to_stream_string(stdin_bytes);
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    match sess.shell.exec_with_options(
        script,
        ExecOptions {
            stdin: if stdin_bytes.is_empty() {
                None
            } else {
                Some(stdin_str)
            },
            ..Default::default()
        },
    ) {
        Ok(res) => {
            let mut buf = Vec::new();
            let stdout_bytes = stream_string_to_bytes(&res.stdout);
            let stderr_bytes = stream_string_to_bytes(&res.stderr);
            let cwd_bytes = res.cwd.as_bytes();
            buf.extend_from_slice(&(res.exit_code).to_le_bytes());
            buf.extend_from_slice(&(stdout_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(stderr_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(cwd_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&stdout_bytes);
            buf.extend_from_slice(&stderr_bytes);
            buf.extend_from_slice(cwd_bytes);
            sess.last_output_buf = buf;
            res.exit_code
        }
        Err(err_msg) => {
            let mut buf = Vec::new();
            let stderr_bytes = err_msg.as_bytes();
            let cwd_bytes = sess.shell.cwd().as_bytes();
            buf.extend_from_slice(&(-124i32).to_le_bytes());
            buf.extend_from_slice(&0u32.to_le_bytes());
            buf.extend_from_slice(&(stderr_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(cwd_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(stderr_bytes);
            buf.extend_from_slice(cwd_bytes);
            sess.last_output_buf = buf;
            -124
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_output_ptr(id: u32) -> *const u8 {
    let Ok(map) = sessions().lock() else {
        return std::ptr::null();
    };
    map.get(&id)
        .map(|s| s.last_output_buf.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_output_len(id: u32) -> usize {
    let Ok(map) = sessions().lock() else {
        return 0;
    };
    map.get(&id).map(|s| s.last_output_buf.len()).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_last_elapsed_ms(_id: u32) -> u32 {
    crate::commands::virtual_clock_elapsed_ms().ceil() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_wasm_ffi_session_lifecycle_limits_and_exec() {
        let id = safe_bash_create_session();
        assert!(id > 0);

        let path = b"/workspace/ffi.txt";
        let content = b"ffi-payload\n";
        unsafe {
            assert_eq!(
                safe_bash_write_file(id, path.as_ptr(), path.len(), content.as_ptr(), content.len()),
                0
            );
            let k = b"FFI_VAR";
            let v = b"ffi_val";
            assert_eq!(safe_bash_set_env(id, k.as_ptr(), k.len(), v.as_ptr(), v.len()), 0);
            let lim_name = b"maxLoopIterations";
            assert_eq!(safe_bash_set_limit(id, lim_name.as_ptr(), lim_name.len(), 500), 0);

            let script = b"echo \"$FFI_VAR:$(cat /workspace/ffi.txt)\"";
            let code = safe_bash_exec(id, script.as_ptr(), script.len(), std::ptr::null(), 0);
            assert_eq!(code, 0);
            let out_len = safe_bash_output_len(id);
            assert!(out_len > 16);
            let out_ptr = safe_bash_output_ptr(id);
            let packet = std::slice::from_raw_parts(out_ptr, out_len);
            let exit_code = i32::from_le_bytes(packet[0..4].try_into().unwrap());
            let stdout_len = u32::from_le_bytes(packet[4..8].try_into().unwrap()) as usize;
            let stdout_str = std::str::from_utf8(&packet[16..16 + stdout_len]).unwrap();
            assert_eq!(exit_code, 0);
            assert_eq!(stdout_str, "ffi_val:ffi-payload\n");
        }

        safe_bash_destroy_session(id);
    }


    #[test]
    fn unit_wasm_ffi_mkdir_symlink_export_vfs_and_elapsed_ms() {
        let id = safe_bash_create_session();
        unsafe {
            let dir = b"/workspace/sub";
            assert_eq!(safe_bash_mkdir_all(id, dir.as_ptr(), dir.len()), 0);
            let fpath = b"/workspace/sub/a.txt";
            let fdata = b"hello";
            assert_eq!(
                safe_bash_write_file(id, fpath.as_ptr(), fpath.len(), fdata.as_ptr(), fdata.len()),
                0
            );
            let target = b"a.txt";
            let lpath = b"/workspace/sub/link.txt";
            assert_eq!(
                safe_bash_symlink(id, target.as_ptr(), target.len(), lpath.as_ptr(), lpath.len()),
                0
            );

            let script = b"sleep 0.02; cat /workspace/sub/link.txt";
            assert_eq!(
                safe_bash_exec(id, script.as_ptr(), script.len(), std::ptr::null(), 0),
                0
            );
            assert!(safe_bash_last_elapsed_ms(id) >= 20);
            assert!(safe_bash_stat(id, fpath.as_ptr(), fpath.len(), 1) > 0);
        }
        safe_bash_destroy_session(id);
    }

    #[test]
    fn unit_wasm_ffi_invalid_session_handles_return_negative_codes() {
        unsafe {
            assert_eq!(safe_bash_exec(999_999, std::ptr::null(), 0, std::ptr::null(), 0), -1);
            assert_eq!(safe_bash_output_len(999_999), 0);
            assert!(safe_bash_output_ptr(999_999).is_null());
            assert_eq!(safe_bash_stat(999_999, std::ptr::null(), 0, 0), -1);
        }
    }

}
