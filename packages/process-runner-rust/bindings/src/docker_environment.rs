use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::docker_environment::{self, Job, LogPoll};
#[napi]
pub fn docker_shell_quote(text: Utf16String) -> Utf16String {
    docker_environment::shell_quote(&text).into()
}
#[napi]
pub fn docker_runtime_validate(object: bool, kind: Option<Utf16String>) -> Result<()> {
    match docker_environment::runtime_error(object, kind.as_deref()) {
        Some(error) => Err(Error::from_reason(error)),
        None => Ok(()),
    }
}
#[napi]
pub fn docker_complete_utf8_prefix(bytes: BufferSlice<'_>) -> u32 {
    docker_environment::complete_prefix(&bytes) as u32
}
#[napi(object)]
pub struct ExecInput {
    pub engine: Utf16String,
    pub context: Option<Utf16String>,
    pub container: Utf16String,
    pub interactive: bool,
    pub tty: bool,
    pub cwd: Option<Utf16String>,
    pub keys: Vec<Utf16String>,
    pub env_file: Option<Utf16String>,
    pub command: Utf16String,
    pub args: Vec<Utf16String>,
}
#[napi]
pub fn docker_exec_args(input: ExecInput) -> Vec<Utf16String> {
    docker_environment::exec_args(docker_environment::Exec {
        engine: &input.engine,
        context: input.context.as_deref(),
        container: &input.container,
        interactive: input.interactive,
        tty: input.tty,
        cwd: input.cwd.as_deref(),
        keys: &input
            .keys
            .into_iter()
            .map(|v| v.to_vec())
            .collect::<Vec<_>>(),
        env_file: input.env_file.as_deref(),
        command: &input.command,
        args: &input
            .args
            .into_iter()
            .map(|v| v.to_vec())
            .collect::<Vec<_>>(),
    })
    .into_iter()
    .map(Into::into)
    .collect()
}
#[napi(object)]
pub struct JobStatus {
    pub status: String,
    pub code: Option<f64>,
    pub error: Option<Utf16String>,
}
#[napi(object)]
pub struct WaitReply {
    pub code: Option<f64>,
    pub error: Option<Utf16String>,
}
#[napi]
pub fn docker_wait_exit_code(stdout: Utf16String, fallback: f64) -> WaitReply {
    match docker_environment::wait(&stdout, fallback) {
        Ok(code) => WaitReply {
            code: Some(code),
            error: None,
        },
        Err(error) => WaitReply {
            code: None,
            error: Some(error.into()),
        },
    }
}
#[napi]
pub struct DockerJob {
    job: Job,
}
#[napi]
impl DockerJob {
    #[napi(constructor)]
    pub fn new(
        engine: Utf16String,
        context: Option<Utf16String>,
        container: Utf16String,
        detached: Option<Utf16String>,
    ) -> Self {
        Self {
            job: Job::new(
                engine.to_vec(),
                context.map(|v| v.to_vec()),
                container.to_vec(),
                detached.map(|v| v.to_vec()),
            ),
        }
    }
    #[napi]
    pub fn status_args(&self) -> Vec<Utf16String> {
        self.job.status_args().into_iter().map(Into::into).collect()
    }
    #[napi]
    pub fn status(&self, code: i32, stdout: Utf16String) -> JobStatus {
        match self.job.status(code, &stdout) {
            Ok((status, code)) => JobStatus {
                status: status.into(),
                code,
                error: None,
            },
            Err(error) => JobStatus {
                status: "".into(),
                code: None,
                error: Some(error.into()),
            },
        }
    }
    #[napi]
    pub fn wait_args(&self) -> Vec<Utf16String> {
        self.job.wait_args().into_iter().map(Into::into).collect()
    }
    #[napi]
    pub fn kill_args(&self, signal: Option<Utf16String>) -> Vec<Utf16String> {
        self.job
            .kill_args(signal.as_deref())
            .into_iter()
            .map(Into::into)
            .collect()
    }
    #[napi]
    pub fn close_args(&self) -> Vec<Utf16String> {
        self.job.close_args().into_iter().map(Into::into).collect()
    }
    #[napi]
    pub fn log_args(&self, id: Utf16String, offset: f64, since: Option<f64>) -> Vec<Utf16String> {
        self.job
            .log_args(&id, offset, since)
            .into_iter()
            .map(Into::into)
            .collect()
    }
}
#[napi]
pub struct DockerLogPoll {
    poll: LogPoll,
}
#[napi]
impl DockerLogPoll {
    #[napi(constructor)]
    pub fn new(follow: bool, detached: bool) -> Self {
        Self {
            poll: LogPoll::new(follow, detached),
        }
    }
    #[napi]
    pub fn after_read(&self) -> String {
        self.poll.after_read().into()
    }
    #[napi]
    pub fn after_status(&mut self, status: String) -> String {
        self.poll.after_status(&status).into()
    }
}
