//! Persistent container command and detached-job policies, independent of host I/O.
use crate::docker::{self, Text};
use mcp_protocol_rust::json::{self, Value};
fn u(text: &str) -> Text {
    text.encode_utf16().collect()
}
fn whitespace(unit: u16) -> bool {
    matches!(unit,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
fn trim(text: &[u16]) -> &[u16] {
    let start = text
        .iter()
        .position(|c| !whitespace(*c))
        .unwrap_or(text.len());
    let end = text
        .iter()
        .rposition(|c| !whitespace(*c))
        .map_or(start, |i| i + 1);
    &text[start..end]
}
pub fn shell_quote(text: &[u16]) -> Text {
    let mut output = vec![39];
    for unit in text {
        if *unit == 39 {
            output.extend([39, 92, 39, 39]);
        } else {
            output.push(*unit);
        }
    }
    output.push(39);
    output
}
pub fn runtime_error(object: bool, kind: Option<&[u16]>) -> Option<&'static str> {
    if !object {
        Some("docker runtime must be an object")
    } else if kind != Some(&u("docker")) {
        Some("docker runtime type must be \"docker\"")
    } else {
        None
    }
}
pub struct Exec<'a> {
    pub engine: &'a [u16],
    pub context: Option<&'a [u16]>,
    pub container: &'a [u16],
    pub interactive: bool,
    pub tty: bool,
    pub cwd: Option<&'a [u16]>,
    pub keys: &'a [Text],
    pub env_file: Option<&'a [u16]>,
    pub command: &'a [u16],
    pub args: &'a [Text],
}
pub fn exec_args(input: Exec<'_>) -> Vec<Text> {
    let Exec {
        engine,
        context,
        container,
        interactive,
        tty,
        cwd,
        keys,
        env_file,
        command,
        args,
    } = input;
    let mut argv = docker::context_args(engine, context);
    argv.push(u("exec"));
    if interactive {
        argv.push(u("-i"));
    }
    if tty {
        argv.push(u("-t"));
    }
    if let Some(cwd) = cwd {
        argv.extend([u("-w"), cwd.to_vec()]);
    }
    argv.extend(docker::env_args(keys, env_file));
    argv.extend([container.to_vec(), command.to_vec()]);
    argv.extend_from_slice(args);
    argv
}
pub fn exit_code(value: &[u16], source: &str) -> Result<f64, Text> {
    let invalid = || {
        u(&format!(
            "{source} returned an invalid exit code: {}.",
            json::stringify(&Value::String(value.to_vec()))
        ))
    };
    if value.is_empty() {
        return Err(invalid());
    }
    let mut code = 0_u64;
    for unit in value {
        if !(48..=57).contains(unit) {
            return Err(invalid());
        }
        code = code
            .checked_mul(10)
            .and_then(|n| n.checked_add(u64::from(*unit - 48)))
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or_else(invalid)?;
    }
    Ok(code as f64)
}
pub fn wait(stdout: &[u16], fallback: f64) -> Result<f64, Text> {
    let value = trim(stdout);
    if value.is_empty() {
        Ok(fallback)
    } else {
        exit_code(value, "docker wait")
    }
}
pub fn complete_prefix(contents: &[u8]) -> usize {
    if contents.is_empty() {
        return 0;
    }
    let mut lead = contents.len();
    while lead > 0 && matches!(contents[lead - 1], 0x80..=0xbf) {
        lead -= 1;
    }
    if lead == 0 {
        return contents.len();
    }
    let index = lead - 1;
    let expected = match contents[index] {
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => 0,
    };
    if expected > 0 && contents.len() - index < expected {
        index
    } else {
        contents.len()
    }
}
pub struct Job {
    engine: Text,
    context: Option<Text>,
    container: Text,
    detached: Option<Text>,
}
impl Job {
    pub fn new(
        engine: Text,
        context: Option<Text>,
        container: Text,
        detached: Option<Text>,
    ) -> Self {
        Self {
            engine,
            context,
            container,
            detached,
        }
    }
    fn command(&self, args: Vec<Text>) -> Vec<Text> {
        let mut argv = docker::context_args(&self.engine, self.context.as_deref());
        argv.extend(args);
        argv
    }
    fn shell(&self, command: Text) -> Vec<Text> {
        self.command(vec![
            u("exec"),
            self.container.clone(),
            u("sh"),
            u("-c"),
            command,
        ])
    }
    pub fn status_args(&self) -> Vec<Text> {
        if let Some(id) = &self.detached {
            let mut file = u("/tmp/poe-jobs/");
            file.extend(id);
            file.extend(u(".exit"));
            let quoted = shell_quote(&file);
            let mut command = u("test -f ");
            command.extend(&quoted);
            command.extend(u(" && cat "));
            command.extend(&quoted);
            command.extend(u(" || true"));
            self.shell(command)
        } else {
            self.command(vec![
                u("inspect"),
                u("-f"),
                u("{{.State.Status}}"),
                self.container.clone(),
            ])
        }
    }
    pub fn status(&self, code: i32, stdout: &[u16]) -> Result<(&'static str, Option<f64>), Text> {
        if code != 0 {
            return Ok(("lost", None));
        }
        let text = trim(stdout);
        if self.detached.is_some() {
            if text.is_empty() {
                Ok(("running", None))
            } else {
                Ok(("exited", Some(exit_code(text, "detached exit marker")?)))
            }
        } else {
            Ok((
                if text == u("exited") {
                    "exited"
                } else {
                    "running"
                },
                None,
            ))
        }
    }
    pub fn wait_args(&self) -> Vec<Text> {
        self.command(vec![u("wait"), self.container.clone()])
    }
    pub fn kill_args(&self, signal: Option<&[u16]>) -> Vec<Text> {
        self.command(docker::control_args(&self.container, signal))
    }
    pub fn close_args(&self) -> Vec<Text> {
        self.command(vec![u("rm"), u("-f"), self.container.clone()])
    }
    pub fn log_args(&self, id: &[u16], offset: f64, since: Option<f64>) -> Vec<Text> {
        let mut file = u("/tmp/poe-jobs/");
        file.extend(id);
        file.extend(u(".log"));
        let quoted = shell_quote(&file);
        let mut command = u("test -f ");
        command.extend(&quoted);
        if let Some(since) = since {
            command.extend(u(" && test $(stat -c %Y "));
            command.extend(&quoted);
            command.extend(u(" 2>/dev/null || stat -f %m "));
            command.extend(&quoted);
            command.extend(u(&format!(") -ge {}", (since / 1000.0).ceil())));
        }
        command.extend(u(&format!(" && tail -c +{} ", offset + 1.0)));
        command.extend(&quoted);
        command.extend(u(" || true"));
        self.shell(command)
    }
}
pub struct LogPoll {
    follow: bool,
    detached: bool,
    final_read: bool,
}
impl LogPoll {
    pub fn new(follow: bool, detached: bool) -> Self {
        Self {
            follow,
            detached,
            final_read: false,
        }
    }
    pub fn after_read(&self) -> &'static str {
        if !self.follow || self.final_read {
            "return"
        } else {
            "status"
        }
    }
    pub fn after_status(&mut self, status: &str) -> &'static str {
        if status == "exited" && self.detached {
            self.final_read = true;
            "read"
        } else if status != "running" {
            "return"
        } else {
            "sleep"
        }
    }
}
