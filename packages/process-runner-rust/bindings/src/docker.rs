use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::docker;
fn texts(values: Vec<Utf16String>) -> Vec<Vec<u16>> {
    values.into_iter().map(|value| value.to_vec()).collect()
}
fn output(values: Vec<Vec<u16>>) -> Vec<Utf16String> {
    values.into_iter().map(Into::into).collect()
}
#[napi]
pub fn docker_context_args(engine: Utf16String, context: Option<Utf16String>) -> Vec<Utf16String> {
    output(docker::context_args(&engine, context.as_deref()))
}
#[napi]
pub fn docker_detect_context(source: Utf16String) -> Option<Utf16String> {
    docker::detect_context(&source).map(Into::into)
}
#[napi]
pub fn docker_detect_engine(read: Function<String, bool>) -> Result<String> {
    // Transport failures are already handled as unavailable by the Node adapter.
    let mut fault = None;
    let result = docker::detect_engine(|engine| match read.call(engine.to_owned()) {
        Ok(value) => value,
        Err(error) => {
            fault = Some(error);
            false
        }
    });
    if let Some(error) = fault {
        return Err(error);
    }
    result.map(str::to_owned).map_err(Error::from_reason)
}
#[napi]
pub fn docker_env_args(keys: Vec<Utf16String>, file: Option<Utf16String>) -> Vec<Utf16String> {
    output(docker::env_args(&texts(keys), file.as_deref()))
}
#[napi(object)]
pub struct EnvEntry {
    pub key: Utf16String,
    pub value: Utf16String,
}
#[napi]
pub fn docker_serialize_env(entries: Vec<EnvEntry>) -> Result<Utf16String> {
    docker::serialize_env(
        &entries
            .into_iter()
            .map(|entry| (entry.key.to_vec(), entry.value.to_vec()))
            .collect::<Vec<_>>(),
    )
    .map(Into::into)
    .map_err(Error::from_reason)
}
#[napi(object)]
pub struct Mount {
    pub source: Utf16String,
    pub target: Utf16String,
    pub readonly: bool,
}
#[napi(object)]
pub struct Port {
    pub host: f64,
    pub container: f64,
    pub protocol: Option<Utf16String>,
}
#[napi(object)]
pub struct RunFacts {
    pub engine: Utf16String,
    pub context: Option<Utf16String>,
    pub image: Utf16String,
    pub command: Utf16String,
    pub args: Vec<Utf16String>,
    pub cwd: Option<Utf16String>,
    pub env_keys: Vec<Utf16String>,
    pub env_file: Option<Utf16String>,
    pub mounts: Vec<Mount>,
    pub ports: Vec<Port>,
    pub network: Option<Utf16String>,
    pub name: Utf16String,
    pub detached: bool,
    pub interactive: bool,
    pub tty: bool,
    pub rm: bool,
    pub extra: Vec<Utf16String>,
}
#[napi]
pub fn docker_run_args(facts: RunFacts) -> Result<Vec<Utf16String>> {
    docker::run_args(&docker::RunArgs {
        engine: facts.engine.to_vec(),
        context: facts.context.map(|v| v.to_vec()),
        image: facts.image.to_vec(),
        command: facts.command.to_vec(),
        args: texts(facts.args),
        cwd: facts.cwd.map(|v| v.to_vec()),
        env_keys: texts(facts.env_keys),
        env_file: facts.env_file.map(|v| v.to_vec()),
        mounts: facts
            .mounts
            .into_iter()
            .map(|m| docker::Mount {
                source: m.source.to_vec(),
                target: m.target.to_vec(),
                readonly: m.readonly,
            })
            .collect(),
        ports: facts
            .ports
            .into_iter()
            .map(|p| docker::Port {
                host: p.host,
                container: p.container,
                protocol: p.protocol.map(|v| v.to_vec()),
            })
            .collect(),
        network: facts.network.map(|v| v.to_vec()),
        name: facts.name.to_vec(),
        detached: facts.detached,
        interactive: facts.interactive,
        tty: facts.tty,
        rm: facts.rm,
        extra: texts(facts.extra),
    })
    .map(output)
    .map_err(Error::from_reason)
}
