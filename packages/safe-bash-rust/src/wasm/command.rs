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
    stream_access: u32,
    directory_mode: u32,
    child_packet: *const u8,
    child_len: usize,
    child_status: i32,
    output_credit: [usize; 2],
    max_input: usize,
    file_output: usize,
}

impl HostBuffer {
    // The callback transfers ownership of exactly len bytes from safe_bash_alloc.
    unsafe fn take(self) -> Vec<u8> {
        if self.len == 0 { Vec::new() } else { unsafe { Vec::from_raw_parts(self.ptr, self.len, self.len) } }
    }
}

fn word(packet: &mut &[u8]) -> Result<u32, String> {
    Ok(u32::from_le_bytes(packet.split_off(..4).ok_or("Truncated child request")?.try_into().unwrap()))
}

fn field(packet: &mut &[u8]) -> Result<String, String> {
    let n = word(packet)? as usize;
    Ok(bytes_to_stream_string(packet.split_off(..n).ok_or("Truncated child field")?))
}

fn invoke_child(ctx: &mut crate::CommandContext<'_>, mut request: &[u8], middleware_input:&mut Option<String>) -> Result<(i32, Vec<u8>, usize), String> {
    let flags = word(&mut request)?;
    if flags == 132 {
        let input = middleware_input.as_mut().ok_or("No middleware input")?;
        return Ok((0,ctx.read_middleware_input(input)?,0));
    }
    if flags == 64 {
        let input = middleware_input.as_mut().ok_or("No command to continue")?;
        let result = ctx.proceed(input)?;
        return Ok(child_result(result,0));
    }
    if (128..=131).contains(&flags) {
        let data = bytes_to_stream_string(request);
        ctx.write_middleware_output(1 + (flags & 1), &data, if flags & 2 != 0 {request.len()} else {0})?;
        return Ok((0,Vec::new(),0));
    }
    let argc = word(&mut request)? as usize;
    let envc = word(&mut request)? as usize;
    if flags & !319 != 0 || argc > request.len()/4 || envc > request.len()/8 {
        return Err("Invalid child request".into());
    }
    let name = field(&mut request)?;
    let cwd = (flags & 1 != 0).then(|| field(&mut request)).transpose()?;
    let argv0 = (flags & 2 != 0).then(|| field(&mut request)).transpose()?;
    let args = (0..argc).map(|_| field(&mut request)).collect::<Result<Vec<_>,_>>()?;
    let env = (0..envc).map(|_| Ok((field(&mut request)?,field(&mut request)?))).collect::<Result<_,String>>()?;
    let mut stdin = field(&mut request)?;
    if !request.is_empty() { return Err("Trailing child request bytes".into()); }
    let input = if flags & 256 != 0 {
        middleware_input.as_mut().ok_or("No middleware input")?
    } else { &mut stdin };
    let result = ctx.invoke(&name,&args,crate::InvokeOptions {
        cwd:cwd.as_deref(), argv0:argv0.as_deref(), env, replace_env:flags & 4 != 0,
        external_invocation:flags & 8 != 0, stdin_is_default:flags & 16 != 0, merge_stderr:flags & 32 != 0, inherit_stdin:flags & 256 != 0,
    }, input)?;
    Ok(child_result(result,crate::vfs::stream_byte_len(input)))
}

fn child_result(result:crate::shell::builtins::BuiltinOutcome, remaining:usize) -> (i32,Vec<u8>,usize) {
    let mut response = (remaining as u32).to_le_bytes().to_vec();
    for stream in [result.stdout,result.stderr] {
        response.extend_from_slice(&(crate::vfs::stream_byte_len(&stream) as u32).to_le_bytes());
        response.extend_from_slice(&stream_string_to_bytes(&stream));
    }
    let credit = response.len() - 12;
    (result.exit_code,response,credit)
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
    session.shell.register_command(crate::vfs::shell_text(name), host_handler(invoke,false));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_register_middleware(id:u32, invoke: unsafe extern "C" fn(*const u8, usize, *mut HostReply) -> i32) -> i32 {
    let Ok(mut sessions) = sessions().lock() else { return -1 };
    let Some(session) = sessions.get_mut(&id) else { return -1 };
    session.shell.set_middleware(host_handler(invoke,true));
    0
}

fn host_handler(invoke: unsafe extern "C" fn(*const u8, usize, *mut HostReply) -> i32, middleware:bool) -> crate::backend::RustCommand {
    Arc::new(move |ctx| {
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
        if middleware { field(ctx.command); }
        if let Some(argv0) = ctx.argv0 { field(argv0); }
        for arg in ctx.args { field(arg); }
        let mut envc = 0u32;
        for (key, value) in ctx.env.iter() {
            if crate::shell::is_exported_scalar(ctx.env, key) { field(key); field(value); envc += 1; }
        }
        packet[4..8].copy_from_slice(&envc.to_le_bytes());
        let input_start = packet.len();
        let mut middleware_input = middleware.then(||ctx.stdin.to_owned());
        if !middleware { packet.extend_from_slice(&stream_string_to_bytes(ctx.stdin)); }
        let umask = ctx.env.get("\0umask").and_then(|mask| u32::from_str_radix(mask, 8).ok()).unwrap_or(0o022);
        let mut child_status = -1;
        let mut response = Vec::new();
        let mut charged = 0usize;
        let mut file_output = 0usize;
        let (code,reply) = loop {
            let mut reply = HostReply {
                max_input: ctx.budget.limits.max_input_bytes,
                child_status, child_packet: response.as_ptr(), child_len: response.len(),
                remaining_output: ctx.budget.remaining_output_bytes(), shared_output: u32::from(ctx.shared_output),
                stdin_is_default: u32::from(ctx.stdin_is_default), stream_access: ctx.stream_access,
                remaining_fs_ops: ctx.budget.remaining_fs_ops(), max_path_components: ctx.budget.limits.max_pathname_components,
                creation_mode: 0o666 & !umask, directory_mode: 0o777 & !umask,
                ..Default::default()
            };
            let code = unsafe { invoke(packet.as_ptr(), packet.len(), &mut reply) };
            // File bytes count against the script but are never credit for a forwarded stream.
            // A short counted write can settle after its callback invokes another command.
            if reply.file_output < file_output {
                ctx.budget.refund_file_output(file_output - reply.file_output);
            } else {
                ctx.budget.add_output_bytes(reply.file_output - file_output)?;
            }
            file_output = reply.file_output;
            if code != -7 { break (code,reply); }
            let request = unsafe { reply.diagnostic.take() };
            let streams = reply.streams.map(|b| unsafe { b.take() });
            if streams.iter().any(|b| !b.is_empty()) || reply.consumed != 0 {
                return Err("Returning streams or consuming caller stdin requires a final host reply".into());
            }
            if child_status == -2 && ctx.budget.check_cancelled().is_err() {
                return Err("Cannot invoke after the execution has stopped".into());
            }
            let reserved = reply.output_credit[0].saturating_add(reply.output_credit[1]);
            (child_status,response) = match ctx.budget.charge_fs_ops(reply.used_fs_ops)
                .and_then(|()| ctx.budget.add_output_bytes(reserved))
                .and_then(|()| { charged += reserved; invoke_child(ctx,&request,&mut middleware_input) }) {
                Ok((code, bytes, credit)) => { charged += credit; (code,bytes) }
                Err(e) => (-2,e.into_bytes()),
            };
        };
        let [stdout, stderr] = reply.streams.map(|buf| unsafe { buf.take() });
        let diagnostic = unsafe { reply.diagnostic.take() };
        let [out,err] = reply.output_credit;
        if out > stdout.len() || err > stderr.len() || out.saturating_add(err) > charged {
            return Err("Host output credit exceeds charged bytes".into());
        }
        ctx.forwarded = (out,err);
        if middleware { ctx.unread_stdin = middleware_input; } else if reply.consumed != 0 {
            let unread = packet[input_start..].get(reply.consumed..).ok_or("Host command consumed more than its stdin")?;
            ctx.unread_stdin = Some(bytes_to_stream_string(unread));
        }
        if reply.used_fs_ops != 0 { ctx.budget.charge_fs_ops(reply.used_fs_ops)?; }
        ctx.failure = match code {
            -9 => Some(CommandFailure::Abort(crate::budget::ShellLimits::limit_error("maxInputBytes", ctx.budget.limits.max_input_bytes))),
            -5 => Some(CommandFailure::Abort(crate::budget::ShellLimits::limit_error("maxFileSystemOperations", ctx.budget.limits.max_filesystem_operations))),
            -2 => Some(CommandFailure::Abort("Execution aborted: cancelled".into())),
            -3 => Some(CommandFailure::Abort(crate::budget::ShellLimits::limit_error("maxOutputBytes", ctx.budget.limits.max_output_bytes))),
            -4 => Some(CommandFailure::Diagnostic("internal error".into())),
            -6 => Some(CommandFailure::Diagnostic(bytes_to_stream_string(&diagnostic))),
            0..=255 => None,
            _ => return Err("Exit status must be an integer between 0 and 255".into()),
        };
        let code = if ctx.failure.is_some() { 1 } else { code };
        Ok(CommandResult {
            exit_code: code, stdout: bytes_to_stream_string(&stdout), stderr: bytes_to_stream_string(&stderr),
            cwd: ctx.cwd.clone(), env: ctx.env.clone(),
        })
    })
}
