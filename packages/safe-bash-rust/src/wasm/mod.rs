use crate::backend::BackendMode;
use crate::budget::ShellLimits;
use crate::fs::{MemoryVfs, MountVfs, OverlayVfs, SafeBashFs};
use crate::shell::{ExecOptions, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

struct WasmSession {
    shell: Shell,
    vfs: Arc<dyn SafeBashFs>,
    last_output_buf: Vec<u8>,
}

static SESSIONS: OnceLock<Mutex<BTreeMap<u32, WasmSession>>> = OnceLock::new();

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
    let _ = vfs.mkdir_all("/workspace");
    let _ = vfs.mkdir_all("/tmp");
    let fs_arc: Arc<dyn SafeBashFs> = Arc::new(vfs);
    let shell = Shell::new(
        fs_arc.clone(),
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
            vfs: fs_arc,
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
    let cwd = sess.shell.cwd().to_string();
    let env = sess.shell.env().clone();
    match profile {
        1 => {
            let upper = Arc::new(MemoryVfs::new());
            let overlay: Arc<dyn SafeBashFs> = Arc::new(OverlayVfs::new(sess.vfs.clone(), upper));
            sess.vfs = overlay.clone();
            sess.shell = Shell::new(
                overlay,
                ShellOptions {
                    cwd: Some(cwd),
                    env,
                    mode: BackendMode::NativeOnly,
                },
            );
        }
        2 => {
            let dev_fs = Arc::new(MemoryVfs::new());
            let _ = dev_fs.write_file("/null", b"");
            let _ = dev_fs.write_file("/zero", &[0u8; 64]);
            let mounted: Arc<dyn SafeBashFs> =
                Arc::new(MountVfs::new(sess.vfs.clone()).with_mount("/dev", dev_fs));
            sess.vfs = mounted.clone();
            let mut shell = Shell::new(
                mounted,
                ShellOptions {
                    cwd: Some(cwd),
                    env,
                    mode: BackendMode::NativeOnly,
                },
            );
            shell.set_limits(ShellLimits {
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
            sess.shell = shell;
        }
        _ => {}
    }
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_destroy_session(id: u32) {
    if let Ok(mut map) = sessions().lock() {
        map.remove(&id);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_mkdir_all(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    let path = unsafe {
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(path_ptr, path_len))
    };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.vfs.mkdir_all(path).is_ok() {
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
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(path_ptr, path_len))
    };
    let data = unsafe { std::slice::from_raw_parts(data_ptr, data_len) };
    let Ok(map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get(&id) else {
        return -1;
    };
    if sess.vfs.write_file(path, data).is_ok() {
        0
    } else {
        -1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_read_file(
    id: u32,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    let path = unsafe {
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(path_ptr, path_len))
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    match sess.vfs.read_file(path) {
        Ok(bytes) => {
            let len = bytes.len() as i32;
            sess.last_output_buf = bytes;
            len
        }
        Err(_) => -1,
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
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(key_ptr, key_len))
    };
    let val = unsafe {
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(val_ptr, val_len))
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    let mut env = BTreeMap::new();
    env.insert(key.to_string(), val.to_string());
    let _ = sess.shell.exec_with_options(
        ":",
        ExecOptions {
            env,
            ..Default::default()
        },
    );
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
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(script_ptr, script_len))
    };
    let stdin = unsafe {
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(stdin_ptr, stdin_len))
    };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    match sess.shell.exec_with_options(
        script,
        ExecOptions {
            stdin: if stdin.is_empty() {
                None
            } else {
                Some(stdin.to_string())
            },
            ..Default::default()
        },
    ) {
        Ok(res) => {
            let mut buf = Vec::new();
            let stdout_bytes = res.stdout.as_bytes();
            let stderr_bytes = res.stderr.as_bytes();
            let cwd_bytes = res.cwd.as_bytes();
            buf.extend_from_slice(&(res.exit_code).to_le_bytes());
            buf.extend_from_slice(&(stdout_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(stderr_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(cwd_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(stdout_bytes);
            buf.extend_from_slice(stderr_bytes);
            buf.extend_from_slice(cwd_bytes);
            sess.last_output_buf = buf;
            res.exit_code
        }
        Err(err_msg) => {
            let mut buf = Vec::new();
            let stderr_bytes = err_msg.as_bytes();
            let cwd_bytes = sess.shell.cwd().as_bytes();
            buf.extend_from_slice(&124i32.to_le_bytes());
            buf.extend_from_slice(&0u32.to_le_bytes());
            buf.extend_from_slice(&(stderr_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(cwd_bytes.len() as u32).to_le_bytes());
            buf.extend_from_slice(stderr_bytes);
            buf.extend_from_slice(cwd_bytes);
            sess.last_output_buf = buf;
            124
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
