use super::{sessions, slice_from_raw};
use crate::backend::CommandResult;
use crate::vfs::{bytes_to_stream_string, stream_string_to_bytes};
use std::sync::Arc;

#[repr(C)]
#[derive(Default)]
pub struct HostBuffer {
    ptr: *mut u8,
    len: usize,
}

impl HostBuffer {
    // The callback transfers ownership of exactly len bytes from safe_bash_alloc.
    unsafe fn take(self) -> Vec<u8> {
        if self.len == 0 { Vec::new() } else { unsafe { Vec::from_raw_parts(self.ptr, self.len, self.len) } }
    }
}

/// Register a Wasm host function with the Rust evaluator. Forks inherit the registration.
///
/// # Safety
/// The name must be readable. The callback must not retain its borrowed input or
/// output slots. Each nonempty returned buffer must be a distinct allocation from
/// safe_bash_alloc, with the same length used for allocation.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_register_command(
    id: u32, name: *const u8, len: usize,
    invoke: unsafe extern "C" fn(*const u8, usize, *mut [HostBuffer; 2]) -> i32,
) -> i32 {
    let Ok(name) = std::str::from_utf8(unsafe { slice_from_raw(name, len) }) else { return -1 };
    if name.is_empty() || name.contains(|c: char| c.is_whitespace() || matches!(c, '/' | '\0' | '\u{feff}')) { return -1; }
    let Ok(mut sessions) = sessions().lock() else { return -1 };
    let Some(session) = sessions.get_mut(&id) else { return -1 };
    session.shell.register_command(crate::vfs::shell_text(name), Arc::new(move |ctx| {
        let mut packet = Vec::new();
        packet.extend_from_slice(&(ctx.args.len() as u32).to_le_bytes());
        packet.extend_from_slice(&0u32.to_le_bytes());
        packet.extend_from_slice(&u32::from(ctx.argv0.is_some()).to_le_bytes());
        let mut field = |s: &str| {
            let bytes = stream_string_to_bytes(s);
            packet.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            packet.extend_from_slice(&bytes);
        };
        field(ctx.cwd);
        if let Some(argv0) = ctx.argv0 { field(argv0); }
        for arg in ctx.args { field(arg); }
        let mut envc = 0u32;
        for (key, value) in ctx.env.iter() {
            if crate::shell::is_exported_scalar(ctx.env, key) { field(key); field(value); envc += 1; }
        }
        packet[4..8].copy_from_slice(&envc.to_le_bytes());
        packet.extend_from_slice(&stream_string_to_bytes(ctx.stdin));
        let mut reply = Default::default();
        let code = unsafe { invoke(packet.as_ptr(), packet.len(), &mut reply) };
        let [stdout, stderr] = reply.map(|buf| unsafe { buf.take() });
        if !(0..=255).contains(&code) { return Err("Exit status must be an integer between 0 and 255".into()); }
        Ok(CommandResult {
            exit_code: code, stdout: bytes_to_stream_string(&stdout), stderr: bytes_to_stream_string(&stderr),
            cwd: ctx.cwd.clone(), env: ctx.env.clone(),
        })
    }));
    0
}
