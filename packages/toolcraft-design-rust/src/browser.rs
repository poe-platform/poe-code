//! Platform launcher and exit policy. Node owns URL parsing and child processes.
use crate::feedback::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("command", [url, platform]) => {
            let (command, windows) = if host.is_kind(*platform, "darwin")? {
                ("open", false)
            } else if host.is_kind(*platform, "win32")? {
                ("rundll32.exe", true)
            } else {
                ("xdg-open", false)
            };
            let command = host.literal(command)?;
            let arguments = if windows {
                let handler = host.literal("url.dll,FileProtocolHandler")?;
                host.call("windows", vec![handler, *url])?
            } else {
                host.call("url", vec![*url])?
            };
            host.call("command", vec![command, arguments])
        }
        ("close", [child, code, signal, resolve, reject]) => {
            let zero = host.number(0.)?;
            let success = host.call("same", vec![*code, zero])?;
            if host.is_true(success)? {
                host.call("unref", vec![*child])?;
                host.call("resolve", vec![*resolve])
            } else {
                let is_null = host.call("isNull", vec![*code])?;
                let reason = if host.is_true(is_null)? {
                    host.call("signal", vec![*signal])?
                } else {
                    host.call("code", vec![*code])?
                };
                let error = host.call("error", vec![reason])?;
                host.call("reject", vec![*reject, error])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
