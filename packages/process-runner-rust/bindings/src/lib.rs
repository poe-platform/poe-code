use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::host::{self, KillTarget, Stdio};
pub mod docker;
pub mod ignore;
pub mod mock;
pub mod tar;
pub mod upload_transaction;
pub mod workspace;
#[napi(object)]
pub struct HostFacts {
    pub stdin: Option<String>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub detached: bool,
    pub group: bool,
    pub aborted: bool,
}
#[napi(object)]
pub struct HostPlan {
    pub aborted: bool,
    pub detached: bool,
    pub stdio: Either<String, Vec<String>>,
}
#[napi]
pub fn host_plan(facts: HostFacts) -> HostPlan {
    let plan = host::plan(
        facts.stdin.as_deref(),
        facts.stdout.as_deref(),
        facts.stderr.as_deref(),
        facts.detached,
        facts.group,
        facts.aborted,
    );
    HostPlan {
        aborted: plan.aborted,
        detached: plan.detached,
        stdio: match plan.stdio {
            Stdio::Inherit => Either::A("inherit".to_owned()),
            Stdio::Modes(values) => Either::B(values.into()),
        },
    }
}
#[napi]
pub struct HostRun {
    state: host::RunState,
}
#[napi]
impl HostRun {
    #[napi(constructor)]
    pub fn new(group: bool) -> Self {
        Self {
            state: host::RunState::new(group),
        }
    }
    #[napi]
    pub fn kill_target(&self, pid: Option<i32>, windows: bool) -> Option<i64> {
        match self.state.kill_target(pid, windows) {
            KillTarget::Child => None,
            KillTarget::Group(pid) => Some(pid),
        }
    }
    #[napi]
    pub fn finish(&mut self, code: Option<i32>) -> Option<i32> {
        self.state.finish(code)
    }
}
#[napi(object)]
pub struct ShellFacts {
    pub command: Option<Utf16String>,
    pub cwd: Option<Utf16String>,
    pub has_args: bool,
    pub has_signal: bool,
    pub own_env: bool,
}
#[napi(object)]
pub struct ShellPlan {
    pub command: Option<Utf16String>,
    pub cwd: Option<Utf16String>,
    pub has_args: bool,
    pub has_signal: bool,
    pub own_env: bool,
    pub error: Option<u32>,
}
#[napi(object)]
pub struct ShellRead {
    pub value: Option<Utf16String>,
    pub error: Option<u32>,
}
enum LookupError {
    Foreign(u32),
    Native(Error),
}
#[napi]
pub fn host_shell(facts: ShellFacts, read: Function<String, ShellRead>) -> Result<ShellPlan> {
    let plan = host::shell(
        host::ShellFacts {
            command: facts.command.map(|value| value.to_vec()),
            cwd: facts.cwd.map(|value| value.to_vec()),
            has_args: facts.has_args,
            has_signal: facts.has_signal,
            own_env: facts.own_env,
        },
        |fact| {
            let reply = read
                .call(
                    match fact {
                        host::ShellFact::EnvShell => "envShell",
                        host::ShellFact::SystemShell => "systemShell",
                        host::ShellFact::DefaultCwd => "defaultCwd",
                    }
                    .to_owned(),
                )
                .map_err(LookupError::Native)?;
            if let Some(id) = reply.error {
                return Err(LookupError::Foreign(id));
            }
            Ok(reply.value.map(|value| value.to_vec()))
        },
    );
    let plan = match plan {
        Ok(plan) => plan,
        Err(LookupError::Native(error)) => return Err(error),
        Err(LookupError::Foreign(id)) => {
            return Ok(ShellPlan {
                command: None,
                cwd: None,
                has_args: false,
                has_signal: false,
                own_env: false,
                error: Some(id),
            });
        }
    };
    Ok(ShellPlan {
        command: Some(plan.command.into()),
        cwd: plan.cwd.map(Into::into),
        has_args: plan.has_args,
        has_signal: plan.has_signal,
        own_env: plan.own_env,
        error: None,
    })
}
#[napi]
pub const HOST_ATTACH_ERROR: &str = host::ATTACH_ERROR;
#[napi]
pub const HOST_DETACH_ERROR: &str = host::DETACH_ERROR;

pub mod docker_template;
