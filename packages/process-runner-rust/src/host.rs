//! Host process stdio, group signaling, result admission and shell defaults.
#[derive(Debug, PartialEq)]
pub enum Stdio {
    Inherit,
    Modes([String; 3]),
}
pub struct Plan {
    pub aborted: bool,
    pub stdio: Stdio,
    pub detached: bool,
}
pub fn plan(
    stdin: Option<&str>,
    stdout: Option<&str>,
    stderr: Option<&str>,
    detached: bool,
    group: bool,
    aborted: bool,
) -> Plan {
    let modes = [
        stdin.unwrap_or("ignore"),
        stdout.unwrap_or("pipe"),
        stderr.unwrap_or("pipe"),
    ];
    Plan {
        aborted,
        stdio: if modes == ["inherit"; 3] {
            Stdio::Inherit
        } else {
            Stdio::Modes(modes.map(str::to_owned))
        },
        detached: detached || group,
    }
}
#[derive(Debug, PartialEq)]
pub enum KillTarget {
    Child,
    Group(i64),
}
pub struct RunState {
    group: bool,
    settled: bool,
}
impl RunState {
    pub fn new(group: bool) -> Self {
        Self {
            group,
            settled: false,
        }
    }
    pub fn kill_target(&self, pid: Option<i32>, windows: bool) -> KillTarget {
        if self.group
            && !windows
            && let Some(pid) = pid
        {
            KillTarget::Group(-i64::from(pid))
        } else {
            KillTarget::Child
        }
    }
    pub fn finish(&mut self, code: Option<i32>) -> Option<i32> {
        if self.settled {
            return None;
        }
        self.settled = true;
        Some(code.unwrap_or(1))
    }
}
pub struct ShellFacts {
    pub command: Option<Vec<u16>>,
    pub cwd: Option<Vec<u16>>,
    pub has_args: bool,
    pub has_signal: bool,
    pub own_env: bool,
}
pub struct ShellPlan {
    pub command: Vec<u16>,
    pub cwd: Option<Vec<u16>>,
    pub has_args: bool,
    pub has_signal: bool,
    pub own_env: bool,
}
#[derive(Debug, PartialEq)]
pub enum ShellFact {
    EnvShell,
    SystemShell,
    DefaultCwd,
}
pub fn shell<E>(
    facts: ShellFacts,
    mut lookup: impl FnMut(ShellFact) -> Result<Option<Vec<u16>>, E>,
) -> Result<ShellPlan, E> {
    let command = match facts.command {
        Some(value) => value,
        None => match lookup(ShellFact::EnvShell)? {
            Some(value) => value,
            None => {
                lookup(ShellFact::SystemShell)?.unwrap_or_else(|| "sh".encode_utf16().collect())
            }
        },
    };
    let cwd = match facts.cwd {
        Some(value) => Some(value),
        None => lookup(ShellFact::DefaultCwd)?,
    };
    Ok(ShellPlan {
        command,
        cwd,
        has_args: facts.has_args,
        has_signal: facts.has_signal,
        own_env: facts.own_env,
    })
}
pub const ATTACH_ERROR: &str = "host runtime does not support reattach";
pub const DETACH_ERROR: &str =
    "host runtime does not support detach because host has no addressable env";
