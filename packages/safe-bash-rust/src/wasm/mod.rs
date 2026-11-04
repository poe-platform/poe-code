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

struct PendingChmod {
    receipts: Vec<crate::vfs::OverlayChmodReceipt>,
    mode: u32,
    file: Option<crate::vfs::memory::StagedFile>,
}

struct WasmSession {
    pending_chmod: BTreeMap<usize, PendingChmod>,
    shell: Shell,
    memory_vfs: MemoryVfs,
    descriptors: BTreeMap<u32, descriptor::Descriptor>,
    next_descriptor: u32,
    profile: Profile,
    last_output_buf: Vec<u8>,
}

impl WasmSession {
    // Fixed fields precede the operand, which can contain arbitrary punctuation.
    fn read_error(&mut self, error: &str, operation: &str, path: &str, resolved: Option<&str>, limit_detail: Option<&str>) -> i32 {
        let (code, reason) = error.split_once(':').unwrap_or(("EIO", error));
        let mut op = operation;
        let mut operand = path.to_owned();
        let mut detail = limit_detail.unwrap_or("");
        if self.profile == Profile::Overlay {
            if matches!(operation, "symlink" | "readlink") && path.contains('\0') {
                op = "resolve";
                operand.clear();
                detail = "paths must be strings without NUL bytes";
            } else if limit_detail.is_some() { operand = resolved.unwrap_or(path).to_owned(); }
            else {
                op = "overlay";
                operand = resolved.map(str::to_owned).unwrap_or_else(|| if path.is_empty() { String::new() } else { crate::vfs::normalize_posix_path(path) });
                if let Some((message, at)) = reason.split_once(", ")
                    && let Some((syscall, arg)) = at.split_once(" '")
                    && let Some(arg) = arg.strip_suffix('\'')
                    && matches!(syscall, "overlay" | "realpath" | "lstat" | "stat" | "writeFile" | "appendFile" | "symlink") {
                    op = if matches!(syscall, "stat" | "writeFile" | "appendFile" | "symlink") { "overlay" } else { syscall };
                    operand = arg.to_owned();
                    if code == "ENOTSUP" { detail = message.trim_start(); }
                }
            }
        } else if self.profile == Profile::Devices {
            if !path.starts_with('/') { operand.insert(0, '/'); }
            detail = "";
        }
        self.last_output_buf = format!("{code}:{op}:{detail}:{operand}").into_bytes();
        -(self.last_output_buf.len() as i32)
    }

    // The session lock covers validation and publication, including exclusive creates.
    fn write_target(&self, operation: &str, destination: &str, to: String, exclusive: bool, source: Option<(&str, &FileStat)>) -> Result<(String, Option<FileStat>), String> {
        let fs = &self.shell.fs;
        let existing = match fs.lstat(&to) {
            Ok(st) => Some(st),
            Err(e) if e.starts_with("ENOENT:") => None,
            Err(e) => return Err(e),
        };
        if self.profile == Profile::Devices && operation == "symlink" {
            if to == "/" || to == "/dev" { return Err("EBUSY: resource busy or locked".into()); }
            if to.starts_with("/dev/") { return Err("ENOTSUP: operation not supported".into()); }
        }
        if matches!(operation, "writeFile" | "appendFile") && self.profile == Profile::Devices {
            if to == "/dev" { return Err("EBUSY: resource busy or locked".into()); }
            if to.starts_with("/dev/") && existing.is_none() { return Err("ENOENT: no such file or directory".into()); }
        }
        let target_device = existing.as_ref().is_some_and(|st| st.mode & 0o170000 == 0o020000);
        if let Some(st) = &existing {
            if exclusive { return Err(format!("EEXIST: file already exists, {operation} '{destination}'")); }
            if !target_device && source.is_some_and(|(from, origin)| from == to || (origin.identity.is_some() && st.identity == origin.identity)) {
                return Err("EINVAL: invalid argument".into());
            }
            if st.kind == VfsEntryKind::Directory { return Err(format!("EISDIR: illegal operation on a directory, {operation} '{to}'")); }
            if st.mode & 0o200 == 0 { return Err(format!("EACCES: permission denied, {operation} '{to}'")); }
        } else {
            let parent = crate::vfs::dirname_posix_path(&to);
            if fs.stat(&parent)?.mode & 0o300 != 0o300 { return Err(format!("EACCES: permission denied, {operation} '{parent}'")); }
        }
        Ok((to, existing))
    }

    fn copy_file(&self, source: &str, destination: &str, exclusive: bool) -> Result<(), String> {
        let fs = &self.shell.fs;
        let from = fs.access_path(source, true)?;
        let origin = fs.lstat(&from)?;
        if origin.kind == VfsEntryKind::Directory { return Err("EISDIR: illegal operation on a directory".into()); }
        if origin.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        let (to, existing) = self.write_target("copyFile", destination, fs.access_path(destination, !exclusive)?, exclusive, Some((&from, &origin)))?;
        let source_device = origin.mode & 0o170000 == 0o020000;
        let target_device = existing.is_some_and(|st| st.mode & 0o170000 == 0o020000);
        fs.write_file(&to, &fs.read_file(&from)?)?;
        if !source_device && !target_device { fs.chmod(&to, origin.mode & 0o7777)?; }
        Ok(())
    }
}

#[derive(Default)]
struct Sessions {
    last_id: u32,
    // An empty slot belongs to the running command until it returns or is destroyed.
    slots: BTreeMap<u32, Option<WasmSession>>,
}

impl Sessions {
    fn insert(&mut self, session: WasmSession) -> u32 {
        let Some(id) = self.last_id.checked_add(1) else { return 0 };
        self.last_id = id;
        self.slots.insert(id, Some(session));
        id
    }

    fn get(&self, id: &u32) -> Option<&WasmSession> {
        self.slots.get(id)?.as_ref()
    }

    fn get_mut(&mut self, id: &u32) -> Option<&mut WasmSession> {
        self.slots.get_mut(id)?.as_mut()
    }
}

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

fn sessions() -> &'static Mutex<Sessions> {
    static SESSIONS: OnceLock<Mutex<Sessions>> = OnceLock::new();
    SESSIONS.get_or_init(Mutex::default)
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
    sessions().lock().unwrap().insert(WasmSession {
        shell,
        memory_vfs: vfs,
        descriptors: BTreeMap::new(),
        next_descriptor: 1,
        pending_chmod: BTreeMap::new(),
        profile: Profile::Memory,
        last_output_buf: Vec::new(),
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_fork_session(parent_id: u32) -> u32 {
    let mut map = sessions().lock().unwrap();
    let Some(parent) = map.get(&parent_id) else { return 0 };
    let child = WasmSession {
        shell: parent.shell.clone(),
        memory_vfs: parent.memory_vfs.clone(),
        descriptors: BTreeMap::new(),
        next_descriptor: 1,
        pending_chmod: BTreeMap::new(),
        profile: parent.profile,
        last_output_buf: Vec::new(),
    };
    map.insert(child)
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_session_snapshot(id: u32, status: i32) -> i32 {
    let mut map = sessions().lock().unwrap();
    let Some(session) = map.get_mut(&id) else { return -1 };
    session.last_output_buf = session.shell.session_snapshot(status).into_bytes();
    session.last_output_buf.len() as i32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_restore_session(id: u32, ptr: *const u8, size: usize) -> i32 {
    let mut map = sessions().lock().unwrap();
    let Some(session) = map.get_mut(&id) else { return -1 };
    match session.shell.restore_session(unsafe { slice_from_raw(ptr,size) }) {
        Ok(()) => 0,
        Err(e) => { session.last_output_buf = e.into_bytes(); session.last_output_buf.len() as i32 }
    }
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
        map.slots.remove(&id);
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
    id: u32, ptr: *const u8, len: usize, data: *const u8, size: usize, mode: u32, flag: u32, append: bool,
) -> i32 {
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let path = unsafe { str_from_raw(ptr, len) };
    let operation = if append { "appendFile" } else { "writeFile" };
    let wrapped = sess.profile == Profile::Memory && !sess.shell.backend.provided_devices;
    let invalid = mode > 0o7777 || flag > 3;
    if path.contains('\0') && (wrapped || (sess.profile == Profile::Overlay && !invalid)) {
        return sess.read_error("EINVAL:", "resolve", path, None, Some("paths must be strings without NUL bytes"));
    }
    let mut op = operation;
    let result = (|| {
        let fs = &sess.shell.fs;
        let exclusive = matches!(flag, 1 | 3);
        if invalid && !wrapped && sess.profile != Profile::Devices { return Err("EINVAL: invalid argument".into()); }
        let target = fs.access_path(path, !exclusive);
        if wrapped {
            // The default device wrapper intercepts root and /dev/null before the backing write.
            let followed = exclusive.then(|| fs.access_path(path, true));
            match followed.as_ref().unwrap_or(&target).as_deref() {
                Ok("/" | "/dev") => { op = ""; return Err("EISDIR: illegal operation on a directory".into()); }
                Ok("/dev/null") => {
                    op = "";
                    return if exclusive { Err("EEXIST: file already exists".into()) }
                        else if flag > 3 { Err("EINVAL: invalid argument".into()) } else { Ok(()) };
                }
                Err(_) if path.is_empty() => { op = ""; return Err("EISDIR: illegal operation on a directory".into()); }
                Err(e) if e.starts_with("EACCES:") && e.contains(", lstat '") => { op = "lstat"; return Err(e.clone()); }
                Err(e) if (!exclusive && e.starts_with("ELOOP:")) || e.starts_with("ENOTDIR: not a directory '") => {
                    op = ""; return Err(e.clone());
                }
                _ => {}
            }
        }
        if invalid {
            if sess.profile == Profile::Devices && target? == "/dev" { return Err("EBUSY: resource busy or locked".into()); }
            return Err("EINVAL: invalid argument".into());
        }
        let (to, existing) = sess.write_target(operation, path, target?, exclusive, None)?;
        let bytes = unsafe { slice_from_raw(data, size) };
        match existing {
            None => fs.create_file(&to, bytes, mode),
            Some(st) if flag & 2 != 0 && st.mode & 0o170000 != 0o020000 => fs.append_file(&to, bytes),
            Some(_) => fs.write_file(&to, bytes),
        }
    })();
    match result {
        Ok(()) => 0,
        Err(e) => {
            let operand = if op == "lstat" { e.split_once(", lstat '").and_then(|(_, p)| p.strip_suffix('\'')).unwrap_or(path) } else { path };
            sess.read_error(&e, op, operand, (sess.profile == Profile::Overlay && (invalid || path.is_empty())).then_some(path), None)
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
    let mut resolved = None;
    let result = (|| {
        if sess.profile == Profile::Memory && invalid_limit { return Err("EINVAL: invalid argument".into()); }
        let p = fs.access_path(path, true)?;
        resolved = Some(p.clone());
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
        Err(e) => sess.read_error(&e, "readFile", path, resolved.as_deref(), None),
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
        Err(e) => sess.read_error(&e, "realpath", path, None, None),
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
pub unsafe extern "C" fn safe_bash_link(
    id: u32, src_ptr: *const u8, src_len: usize, dst_ptr: *const u8, dst_len: usize,
) -> i32 {
    let source = unsafe { str_from_raw(src_ptr, src_len) };
    let destination = unsafe { str_from_raw(dst_ptr, dst_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let fs = &sess.shell.fs;
    let mut operand = "source";
    let result = (|| {
        if sess.profile == Profile::Overlay { return Err("ENOTSUP".into()); }
        let wrapped = sess.profile == Profile::Memory && !fs.supports_hard_links("/");
        let resolve = |path: &str| fs.access_path(if wrapped && path.is_empty() { "/" } else { path }, false);
        let from = resolve(source)?;
        if wrapped && !fs.supports_hard_links(&from) { return Err("EBUSY".into()); }
        let to = resolve(destination);
        if wrapped && to.as_ref().is_ok_and(|p| !fs.supports_hard_links(p)) {
            operand = "destination";
            return Err("EBUSY".into());
        }
        let origin = fs.lstat(&from)?;
        if sess.profile == Profile::Memory && origin.kind == VfsEntryKind::Directory { return Err("EPERM".into()); }
        operand = "destination";
        let to = to?;
        fs.hard_link(&from, &to)
    })();
    match result {
        Ok(()) => 0,
        Err(e) => {
            let code = e.split(':').next().unwrap();
            let scope = match sess.profile {
                Profile::Overlay => "overlay",
                Profile::Devices => "mounted",
                Profile::Memory if matches!(code, "EEXIST" | "EPERM") => "both",
                _ => operand,
            };
            sess.last_output_buf = format!("{code}:{scope}").into_bytes();
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
        Err(error) if sess.profile == Profile::Memory && error.ends_with(", resolve") =>
            sess.read_error(&error,"resolve","",None,Some("paths must be strings without NUL bytes")),
        Err(ref error) if sess.profile == Profile::Memory && let Some((reason,operand)) = error.split_once(" '")
            && let Some(operand) = operand.strip_suffix('\'') =>
            sess.read_error(reason,if reason.ends_with(", lstat") { "lstat" } else { "" },operand,None,None),
        Err(error) => sess.read_error(&error,"rename",source,None,None),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_remove_path(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    // 0: recursive rm (legacy ABI default), 1: unlink, 2: rmdir, 3: nonrecursive rm.
    operation: u32,
    force: bool,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let result = match operation {
        0 => sess.shell.fs.remove_path(path),
        1 | 2 => sess.shell.fs.remove_one(path, operation == 2),
        3 => match sess.shell.fs.overlay_backend() {
            Some(overlay) => overlay.rm(path, false),
            None => sess.shell.fs.remove_one(path, false),
        },
        _ => Err("EINVAL: invalid removal operation".into()),
    };
    match result {
        Ok(()) => 0,
        Err(e) if force && e.starts_with("ENOENT:") => 0,
        Err(e) => {
            let op = if operation == 2 { "rmdir" } else if operation == 1 && sess.profile == Profile::Devices { "unlink" } else { "rm" };
            if sess.profile == Profile::Overlay && matches!(operation, 1 | 2) {
                sess.last_output_buf = format!("{}:{op}::{path}", e.split(':').next().unwrap_or("EIO")).into_bytes();
                -(sess.last_output_buf.len() as i32)
            } else { sess.read_error(&e, op, path, None, None) }
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
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    if target.is_empty() || target.contains('\0') {
        if sess.profile == Profile::Overlay && target.contains('\0') {
            return sess.read_error("EINVAL:", "resolve", "", None, Some("paths must be strings without NUL bytes"));
        }
        let operand = if sess.profile == Profile::Memory { target } else { path };
        return sess.read_error(if target.is_empty() { "ENOENT:" } else { "EINVAL:" }, "symlink", operand, None, None);
    }
    match sess.shell.fs.access_path(path, false).and_then(|to| sess.write_target("symlink", path, to, true, None)).and_then(|(to, _)| sess.shell.fs.symlink(target, &to)) {
        Ok(()) => 0,
        Err(e) => sess.read_error(&e, "symlink", path, None, None),
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
    let fs = &sess.shell.fs;
    let result = fs.access_path(path, false).and_then(|p| {
        if fs.lstat(&p)?.kind != VfsEntryKind::Symlink { return Err("EINVAL: invalid argument".into()); }
        fs.readlink(&p)
    });
    match result {
        Ok(target) => {
            let bytes = target.into_bytes();
            let len = bytes.len() as i32;
            sess.last_output_buf = bytes;
            len
        }
        Err(e) => sess.read_error(&e, "readlink", path, None, None),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_chmod(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    mode: f64,
    omitted: bool,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let fs = &sess.shell.fs;
    let mode = if omitted && sess.profile != Profile::Overlay { 0.0 } else { mode };
    let invalid = mode.fract() != 0.0 || !(0.0..=4095.0).contains(&mode);
    let res = (|| {
        if invalid && sess.profile != Profile::Devices { return Err("EINVAL: invalid argument".into()); }
        let target = fs.access_path(path, true)?;
        if sess.profile == Profile::Devices {
            fs.lstat(&target)?;
            if target == "/dev" { return Err("EBUSY: resource busy or locked".into()); }
            if target.starts_with("/dev/") { return Err("ENOTSUP: operation not supported".into()); }
            if invalid { return Err("EINVAL: invalid argument".into()); }
        }
        fs.chmod(&target, mode as u32)
    })();
    match res {
        Ok(()) => 0,
        Err(e) => sess.read_error(&e, "chmod", path,
            (sess.profile == Profile::Overlay && (invalid || path.is_empty())).then_some(path), None),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_supports_conditional_chmod(id: u32) -> bool {
    sessions().lock().is_ok_and(|map| map.get(&id).is_some_and(|s| s.shell.fs.memory_backend().is_some() || s.shell.fs.overlay_backend().is_some()))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_chmod_conditional(
    id: u32, path_ptr: *const u8, path_len: usize, mode: f64, ptr: *const u8, len: usize, phase: u32,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let data = unsafe { slice_from_raw(ptr,len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let res = (|| {
        let fs = &sess.shell.fs;
        let paths = std::iter::once("/").chain(path.match_indices('/').skip(1).map(|(i,_)| &path[..i]));
        if data.len() / 72 != paths.clone().count() + 2 || !data.len().is_multiple_of(72) {
            return Err("EINVAL: invalid chmod receipt".into());
        }
        let mut stats = data.chunks_exact(72).map(|row| {
            let n = |i:usize| f64::from_le_bytes(row[i*8..][..8].try_into().unwrap());
            let count = |i| (n(i).is_finite() && n(i)>=0. && n(i).fract()==0.).then(||n(i) as u64);
            Ok::<_, String>(FileStat {
                identity: n(0).is_finite().then(||crate::vfs::EntryIdentity::Memory(count(0).unwrap_or(u64::MAX), count(1).unwrap_or(u64::MAX))),
                kind: match n(2) {0. => VfsEntryKind::File, 3. => return Err("ENOTSUP: character device".into()), 1. => VfsEntryKind::Directory, 2. => VfsEntryKind::Symlink, _=>return Err("EAGAIN: different type".into())},
                revision: count(3), size: count(4).and_then(|n|usize::try_from(n).ok()).unwrap_or(usize::MAX),
                mode: count(5).and_then(|n|u32::try_from(n).ok()).unwrap_or(u32::MAX), nlink: count(6).and_then(|n|usize::try_from(n).ok()),
                mtime_ms: n(7), ctime_ms: Some(n(8)), atime_ms: 0., birthtime_ms: None,
                uid:None, gid:None, allocated_bytes:None, io_block_size:None, filesystem_type:None,
            })
        });
        let ancestors = paths.map(|p| Ok::<_,String>((p,stats.next().unwrap()?))).collect::<Result<Vec<_>,_>>()?;
        let parent = stats.next().unwrap()?;
        let expected = stats.next().unwrap()?;
        if phase != 2 { fs.prepare_chmod(path,&ancestors)?; }
        if mode.fract() != 0. || !(0.0..=4095.0).contains(&mode) { return Err("EINVAL: invalid mode".into()); }
        if phase == 1 { return Ok(()); }
        fs.chmod_conditional(path,mode as u32,&ancestors,&parent,&expected)
    })();
    match res {
        Ok(()) => 0,
        Err(e) => {
            let detail = e.split_once(", ").and_then(|(_,s)|s.strip_suffix('\'')?.split_once(" '"));
            let (op, operand) = if sess.profile == Profile::Devices { ("chmod",path) } else { detail.unwrap_or(("chmod",path)) };
            sess.read_error(&e,op,operand,None,None)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_overlay_chmod(
    id: u32, path_ptr: *const u8, path_len: usize, mode: f64, ptr: *const u8, len: usize, phase: u32,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let data = unsafe { slice_from_raw(ptr,len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let res = (|| {
        let key = ptr as usize;
        // The loader keeps its receipt allocation live across all three guard calls.
        // Nested chmod calls have their own allocation and cannot overwrite the stage.
        if phase == 4 { sess.pending_chmod.remove(&key); return Ok(()); }
        let fs = sess.shell.fs.overlay_backend().ok_or("ENOTSUP: not an overlay")?;
        if mode.fract()!=0. || !(0.0..=4095.0).contains(&mode) {return Err("EINVAL: invalid mode".into());}
        if phase == 3 {
            let stage = sess.pending_chmod.remove(&key).ok_or("EINVAL: missing chmod stage")?;
            if stage.mode != mode as u32 || stage.receipts.last().is_none_or(|r| r.path != path) {
                return Err("EINVAL: wrong chmod stage".into());
            }
            return fs.finish_observed_chmod(path,stage.mode,&stage.receipts,stage.file);
        }
        let dir=crate::vfs::dirname_posix_path(path);
        let paths=std::iter::once("/").chain(path.match_indices('/').skip(1).map(|(i,_)|&path[..i])).chain([dir.as_str(),path]);
        if paths.clone().count()*48 != len {return Err("EINVAL: invalid ancestry".into());}
        let receipts=paths.zip(data.chunks_exact(48)).map(|(p,row)|crate::vfs::OverlayChmodReceipt {
            path:p.to_owned(), stamp:std::array::from_fn(|i|u64::from_le_bytes(row[i*8..][..8].try_into().unwrap()))
        }).collect::<Vec<_>>();
        match phase {
            0 => fs.chmod_observed(path,mode as u32,&receipts,||Ok(())),
            1 => fs.check_observed_chmod(path,&receipts).map(|_|()),
            2 => {
                let file = fs.stage_observed_chmod(path,mode as u32,&receipts)?;
                sess.pending_chmod.insert(key,PendingChmod { receipts, mode: mode as u32, file });
                Ok(())
            }
            _ => Err("EINVAL: invalid chmod phase".into())
        }
    })();
    match res {
        Ok(())=>0,
        Err(e)=>{
            if let Some((reason,p))=e.split_once(", receipt '") {
                let code=reason.split(':').next().unwrap_or("EIO");
                sess.last_output_buf=format!("{code}:::{}",p.strip_suffix('\'').unwrap_or(p)).into_bytes();
                return -(sess.last_output_buf.len() as i32);
            }
            sess.read_error(&e,"chmod",path,None,None)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_set_times(
    id: u32, path_ptr: *const u8, path_len: usize, atime: f64, mtime: f64, both: bool,
) -> i32 {
    let path = unsafe { str_from_raw(path_ptr, path_len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let fs = &sess.shell.fs;
    let res = (|| {
        let valid = mtime.is_finite() && (!both || atime.is_finite());
        if sess.profile != Profile::Devices && !valid { return Err("EINVAL: invalid argument".into()); }
        let p = fs.access_path(path, true)?;
        if sess.profile == Profile::Devices {
            fs.lstat(&p)?;
            if p == "/dev" || p.starts_with("/dev/") { return Err("ENOTSUP: operation not supported".into()); }
            if !valid { return Err("EINVAL: invalid argument".into()); }
        }
        fs.set_times(&p, both.then_some(atime), Some(mtime))
    })();
    match res {
        Ok(()) => 0,
        Err(e) if sess.profile == Profile::Overlay && (e.starts_with("EINVAL:") || path.is_empty()) => {
            sess.last_output_buf = format!("{}:overlay::{path}", e.split(':').next().unwrap()).into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
        Err(e) => sess.read_error(&e, "utimes", path, None, None),
    }
}

fn stat_bytes(st: FileStat) -> Vec<u8> {
    let kind_code: u32 = match st.kind {
        VfsEntryKind::File => 0,
        VfsEntryKind::Directory => 1,
        VfsEntryKind::Symlink => 2,
    };
    let mut buf = Vec::with_capacity(108);
    buf.extend_from_slice(&kind_code.to_le_bytes());
    buf.extend_from_slice(&(st.size as u32).to_le_bytes());
    buf.extend_from_slice(&st.mode.to_le_bytes());
    buf.extend_from_slice(&st.mtime_ms.to_le_bytes());
    buf.extend_from_slice(&st.atime_ms.to_le_bytes());
    buf.extend_from_slice(&st.ctime_ms.unwrap_or(f64::NAN).to_le_bytes());
    buf.extend_from_slice(&st.birthtime_ms.unwrap_or(f64::NAN).to_le_bytes());
    let fields = u32::from(st.uid.is_some()) | (u32::from(st.gid.is_some()) << 1)
        | (u32::from(st.nlink.is_some()) << 2) | (u32::from(st.filesystem_type == Some("memory")) << 3) | (u32::from(st.revision.is_some()) << 4);
    buf.extend_from_slice(&fields.to_le_bytes());
    buf.extend_from_slice(&st.uid.unwrap_or(0).to_le_bytes());
    buf.extend_from_slice(&st.gid.unwrap_or(0).to_le_bytes());
    buf.extend_from_slice(&(st.nlink.unwrap_or(0) as u32).to_le_bytes());
    buf.extend_from_slice(&st.allocated_bytes.map_or(f64::NAN, |n| n as f64).to_le_bytes());
    buf.extend_from_slice(&st.io_block_size.map_or(f64::NAN, |n| n as f64).to_le_bytes());
    use crate::vfs::EntryIdentity;
    if let Some(EntryIdentity::Memory(dev, ino) | EntryIdentity::OverlayDirectory { dev, ino, .. }) = st.identity {
        buf.extend_from_slice(&dev.to_le_bytes());
        buf.extend_from_slice(&ino.to_le_bytes());
        if let Some(EntryIdentity::OverlayDirectory { scope, .. }) = st.identity { buf.extend_from_slice(&scope.to_le_bytes()); }
    }
    if let Some(revision) = st.revision { buf.extend_from_slice(&revision.to_le_bytes()); }
    buf
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_access(id: u32, ptr: *const u8, len: usize, mode: u32) -> i32 {
    let path = unsafe { str_from_raw(ptr, len) };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let wrapped = sess.profile == Profile::Memory && !sess.shell.backend.provided_devices;
    let mut op = "access";
    let mut resolved = None;
    let mut operand = path;
    let result = (|| {
        if mode > 7 && !wrapped { return Err("EINVAL: invalid argument".to_string()); }
        if path.contains('\0') && (wrapped || sess.profile == Profile::Overlay) {
            op = "resolve";
            return Err("EINVAL: invalid path".into());
        }
        let fs = &sess.shell.fs;
        let p = match fs.access_path(path, true) {
            Ok(p) => p,
            Err(e) if wrapped && e.starts_with("EACCES:") && e.contains(", lstat '") => {
                op = "lstat";
                return Err(e);
            }
            Err(e) if wrapped && (e.starts_with("ELOOP:") || e.starts_with("ENOTDIR: not a directory '")) => {
                op = "";
                return Err(e);
            }
            Err(_) if wrapped && mode > 7 => return Err("EINVAL: invalid argument".into()),
            Err(e) => return Err(e),
        };
        if wrapped && matches!(p.as_str(), "/dev" | "/dev/null") { op = ""; }
        resolved = Some(p);
        if mode > 7 { return Err("EINVAL: invalid argument".into()); }
        let p = resolved.as_deref().unwrap();
        let allowed = if wrapped && p == "/dev" { 5 } else { fs.lstat(p)?.mode >> 6 };
        if allowed & mode != mode { return Err("EACCES: permission denied".into()); }
        Ok(())
    })();
    if let Err(e) = result {
        if op == "lstat" && let Some((_, arg)) = e.split_once(", lstat '") {
            operand = arg.strip_suffix('\'').unwrap_or(path);
        }
        if sess.profile == Profile::Overlay && mode > 7 {
            resolved = Some(path.to_owned());
        }
        sess.read_error(&e, op, operand, resolved.as_deref(),
            (op == "resolve").then_some("paths must be strings without NUL bytes"))
    } else { 0 }
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
    let res = fs.access_path(path, follow != 0).and_then(|p| match fs.overlay_backend() {
        Some(overlay) => overlay.observe_chmod(&p).map(|(st,r)|(st,Some(r))),
        None => fs.lstat(&p).map(|st|(st,None)),
    });
    match res {
        Ok((st,receipt)) => {
            sess.last_output_buf = stat_bytes(st);
            if let Some(r) = receipt {
                let buf = &mut sess.last_output_buf;
                buf[44] |= 32;
                for v in r.stamp { buf.extend_from_slice(&v.to_le_bytes()); }
                buf.extend_from_slice(r.path.as_bytes());
                buf.extend_from_slice(&(r.path.len() as u32).to_le_bytes());
            }
            sess.last_output_buf.len() as i32
        }
        Err(e) => sess.read_error(&e, if follow != 0 { "stat" } else { "lstat" }, path, None, None),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_readdir(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
    typed: bool,
    limit: f64,
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
    let mut listing_path = None;
    let result = (|| {
        if typed && limit < 0.0 { return Err("EINVAL: invalid directory entry limit".into()); }
        let p = fs.access_path(path, true)?;
        listing_path = Some(p.clone());
        let st = fs.lstat(&p)?;
        if st.kind != VfsEntryKind::Directory { return Err("ENOTDIR: not a directory".into()); }
        if st.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        if typed {
            // The mounted device backend requires a finite limit when explicitly supplied.
            if sess.profile == Profile::Devices && p == "/dev" && limit == f64::INFINITY { return Err("EINVAL: invalid argument".into()); }
            fs.directory_entries(&p, limit as usize)
        } else {
            fs.list_dir(&p).map(|names| names.into_iter().map(|name| (name, 0)).collect())
        }
    })();
    match result {
        Ok(mut entries) => {
            if typed { entries.sort_unstable_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16())); }
            else { entries.sort_unstable(); }
            let mut buf = Vec::new();
            buf.extend_from_slice(&(entries.len() as u32).to_le_bytes());
            for (entry, mode) in entries {
                if typed { buf.push((mode >> 12) as u8); }
                let b = entry.as_bytes();
                buf.extend_from_slice(&(b.len() as u32).to_le_bytes());
                buf.extend_from_slice(b);
            }
            let len = buf.len() as i32;
            sess.last_output_buf = buf;
            len
        }
        Err(e) => {
            let limit_detail = if typed && limit < 0.0 { Some("directory entry limit must be a nonnegative safe integer or Infinity") }
                else if e.starts_with("EFBIG:") { Some("directory entry limit exceeded") } else { None };
            sess.read_error(&e, "readdir", path, listing_path.as_deref(), limit_detail)
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
    if key == "\0cwd" {
        sess.shell.set_cwd(val);
        return 0;
    }
    sess.shell.set_binding(key, val);
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
        "maxInputBytes" => {
            lim.max_input_bytes = val;
            sess.shell.set_binding("\0has_finite_input_quota", "1");
        }
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
    let script = unsafe { str_from_raw(script_ptr, script_len) };
    let bytes = unsafe { slice_from_raw(stdin_ptr, stdin_len) };
    exec_session(id, |shell| shell.exec_with_options(script, ExecOptions {
        stdin: (!bytes.is_empty()).then(|| bytes_to_stream_string(bytes)),
        ..Default::default()
    }))
}

/// `next` returns 0 for EOF, 1 for a chunk, -1 for a UTF-8 diagnostic, or -2 to cancel.
/// For a nonempty payload it transfers exactly `len` bytes allocated by safe_bash_alloc.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_exec_stream(
    id: u32, script_ptr: *const u8, script_len: usize,
    next: unsafe extern "C" fn(u32, *mut *mut u8, *mut usize) -> i32,
) -> i32 {
    let script = unsafe { str_from_raw(script_ptr, script_len) };
    let input = crate::shell::eval::FdTarget::input_stream(move |budget| {
        let mut ptr = std::ptr::null_mut();
        let mut len = 0;
        let status = unsafe { next(id, &mut ptr, &mut len) };
        if status == 0 { return None; }
        if status == -2 {
            return Some(Err(budget.record_exceeded("Execution aborted: cancelled".into())));
        }
        let bytes = if len == 0 { Vec::new() } else { unsafe { Vec::from_raw_parts(ptr, len, len) } };
        Some(if status == 1 { Ok(bytes) } else { Err(String::from_utf8_lossy(&bytes).into_owned()) })
    });
    exec_session(id, |shell| shell.exec_input(script, ExecOptions::default(), Some(input)))
}

fn exec_session(id: u32, run: impl FnOnce(&mut Shell) -> Result<crate::shell::ExecOutput, String>) -> i32 {
    let mut sess = {
        let Ok(mut map) = sessions().lock() else { return -1 };
        let Some(sess) = map.slots.get_mut(&id).and_then(Option::take) else { return -1 };
        sess
    };
    let code = match run(&mut sess.shell) {
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
    };
    let Ok(mut map) = sessions().lock() else { return -1 };
    let Some(slot) = map.slots.get_mut(&id) else { return -1 };
    *slot = Some(sess);
    code
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
pub extern "C" fn safe_bash_last_elapsed_ms(id: u32) -> u32 {
    let Ok(map) = sessions().lock() else { return 0 };
    map.get(&id).map_or(0, |s| s.shell.backend.last_elapsed_ms.load(std::sync::atomic::Ordering::Relaxed))
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
