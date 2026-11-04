use super::{sessions, slice_from_raw};
use crate::backend::{CommandFailure, CommandResult};
use crate::vfs::{bytes_to_stream_string, stream_string_to_bytes};
use std::sync::Arc;

#[repr(C)]
#[derive(Default)]
struct HostBuffer {
    ptr: *mut u8,
    len: usize,
}

#[repr(C)]
#[derive(Default)]
pub struct HostReply {
    streams: [HostBuffer; 2],
    consumed: usize,
    remaining_output: usize,
    shared_output: u32,
    remaining_fs_ops: usize,
    max_path_components: usize,
    used_fs_ops: usize,
    creation_mode: u32,
    diagnostic: HostBuffer,
    stdin_is_default: u32,
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
    invoke: unsafe extern "C" fn(*const u8, usize, *mut HostReply) -> i32,
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
        let input_start = packet.len();
        packet.extend_from_slice(&stream_string_to_bytes(ctx.stdin));
        let mut reply = HostReply {
            remaining_output: ctx.budget.remaining_output_bytes(), shared_output: u32::from(ctx.shared_output),
            stdin_is_default: u32::from(ctx.stdin_is_default),
            remaining_fs_ops: ctx.budget.remaining_fs_ops(), max_path_components: ctx.budget.limits.max_pathname_components,
            creation_mode: 0o666 & !ctx.env.get("\0umask").and_then(|mask| u32::from_str_radix(mask, 8).ok()).unwrap_or(0o022),
            ..Default::default()
        };
        let code = unsafe { invoke(packet.as_ptr(), packet.len(), &mut reply) };
        let [stdout, stderr] = reply.streams.map(|buf| unsafe { buf.take() });
        let diagnostic = unsafe { reply.diagnostic.take() };
        if reply.consumed != 0 {
            let unread = packet[input_start..].get(reply.consumed..).ok_or("Host command consumed more than its stdin")?;
            ctx.unread_stdin = Some(bytes_to_stream_string(unread));
        }
        if reply.used_fs_ops != 0 { ctx.budget.charge_fs_ops(reply.used_fs_ops)?; }
        ctx.failure = match code {
            -5 => Some(CommandFailure::Abort(crate::budget::ShellLimits::limit_error("maxFileSystemOperations", ctx.budget.limits.max_filesystem_operations))),
            -2 => Some(CommandFailure::Abort("Execution aborted: cancelled".into())),
            -3 => Some(CommandFailure::Abort(crate::budget::ShellLimits::limit_error("maxOutputBytes", ctx.budget.limits.max_output_bytes))),
            -4 => Some(CommandFailure::Diagnostic(bytes_to_stream_string(&diagnostic))),
            0..=255 => None,
            _ => return Err("Exit status must be an integer between 0 and 255".into()),
        };
        let code = if ctx.failure.is_some() { 1 } else { code };
        Ok(CommandResult {
            exit_code: code, stdout: bytes_to_stream_string(&stdout), stderr: bytes_to_stream_string(&stderr),
            cwd: ctx.cwd.clone(), env: ctx.env.clone(),
        })
    }));
    0
}
