//! One addon around own portable skill policies; hosts retain Node I/O errors.
use agent_skill_config_rust::{
    Catalog, Config, SupportStatus,
    exclude::{self, FsError, Host as ExcludeHost, PathFacts},
    paths::{self, PathPlan, Scope},
    resolve::{self, Host as ResolveHost, Resolution, StatError},
};
use mcp_protocol_rust::json::{self, Limits, Value as J};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::OnceLock;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn text(value: &str) -> J {
    J::String(u(value))
}
fn object(fields: Vec<(&str, J)>) -> J {
    J::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| Catalog::builtins().expect("Valid skill descriptors"))
}
#[napi]
pub fn skill_registry() -> NativeJson {
    NativeJson(object(vec![
        (
            "configs",
            J::Object(
                catalog()
                    .configs()
                    .iter()
                    .map(|(id, config)| (id.clone(), config.raw.clone()))
                    .collect(),
            ),
        ),
        (
            "agents",
            J::Array(
                catalog()
                    .supported_agents()
                    .into_iter()
                    .map(J::String)
                    .collect(),
            ),
        ),
        (
            "lookup",
            J::Object(
                agent_defs_rust::Registry::builtins()
                    .lookup_keys()
                    .iter()
                    .map(|(key, id)| (key.clone(), J::String(id.clone())))
                    .collect(),
            ),
        ),
    ]))
}
#[napi]
pub fn skill_support(input: Utf16String, id: Option<Utf16String>, configured: bool) -> NativeJson {
    let status = if id.is_none() {
        SupportStatus::Unknown
    } else if configured {
        SupportStatus::Supported
    } else {
        SupportStatus::Unsupported
    };
    let mut fields = vec![
        (
            "status",
            text(match status {
                SupportStatus::Supported => "supported",
                SupportStatus::Unsupported => "unsupported",
                SupportStatus::Unknown => "unknown",
            }),
        ),
        ("input", J::String(input.to_vec())),
    ];
    if let Some(id) = id {
        fields.push(("id", J::String(id.to_vec())));
    }
    NativeJson(object(fields))
}
#[napi]
pub fn skill_path(
    global: Utf16String,
    local: Utf16String,
    scope: String,
    cwd: Utf16String,
    home: Utf16String,
) -> NativeJson {
    let config = Config {
        global_dir: global.to_vec(),
        local_dir: local.to_vec(),
        raw: J::Null,
    };
    NativeJson(
        match paths::plan_skill_dir(
            &config,
            if scope == "global" {
                Scope::Global
            } else {
                Scope::Local
            },
            &cwd,
            &home,
        ) {
            PathPlan::Resolve(path) => {
                object(vec![("kind", text("resolve")), ("path", J::String(path))])
            }
            PathPlan::Join { directory, path } => object(vec![
                ("kind", text("join")),
                ("directory", J::String(directory)),
                ("path", J::String(path)),
            ]),
            PathPlan::From { directory, path } => object(vec![
                ("kind", text("from")),
                ("directory", J::String(directory)),
                ("path", J::String(path)),
            ]),
        },
    )
}
#[derive(Debug)]
enum RuntimeError {
    Foreign(u32),
    Native(Error),
}
type Callback<'a> = Function<'a, FnArgs<(String, NativeJson)>, Utf16String>;
struct Host<'a> {
    callback: Callback<'a>,
}
impl Host<'_> {
    fn call(&self, operation: &str, args: Vec<J>) -> std::result::Result<J, FsError<RuntimeError>> {
        let value = self
            .callback
            .call((operation.to_owned(), NativeJson(J::Array(args))).into())
            .map_err(|error| FsError::Other(RuntimeError::Native(error)))?;
        let value = json::parse_utf16(&value, Limits::default()).map_err(|error| {
            FsError::Other(RuntimeError::Native(Error::from_reason(error.to_string())))
        })?;
        if let Some(J::Number(id)) = value.get("error") {
            if !id.is_finite() || *id < 0.0 || *id > f64::from(u32::MAX) || id.fract() != 0.0 {
                return Err(FsError::Other(RuntimeError::Native(Error::from_reason(
                    "Invalid skill error handle",
                ))));
            }
            let error = RuntimeError::Foreign(*id as u32);
            return Err(match value.get("code") {
                Some(J::String(code)) if *code == u("ENOENT") => FsError::NotFound(error),
                Some(J::String(code)) if *code == u("EEXIST") => FsError::Exists(error),
                _ => FsError::Other(error),
            });
        }
        Ok(value)
    }
    fn error(error: FsError<RuntimeError>) -> RuntimeError {
        match error {
            FsError::NotFound(error) | FsError::Exists(error) | FsError::Other(error) => error,
        }
    }
    fn string(value: J) -> std::result::Result<Vec<u16>, FsError<RuntimeError>> {
        match value {
            J::String(value) => Ok(value),
            _ => Err(FsError::Other(RuntimeError::Native(Error::from_reason(
                "Expected skill filesystem string",
            )))),
        }
    }
    fn paths(
        &self,
        operation: &str,
        parts: &[&[u16]],
    ) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::string(
            self.call(
                operation,
                parts.iter().map(|part| J::String(part.to_vec())).collect(),
            )
            .map_err(Self::error)?,
        )
        .map_err(Self::error)
    }
    fn unit(&self, operation: &str, parts: &[&[u16]]) -> std::result::Result<(), RuntimeError> {
        self.call(
            operation,
            parts.iter().map(|part| J::String(part.to_vec())).collect(),
        )
        .map(|_| ())
        .map_err(Self::error)
    }
}
impl ExcludeHost for Host<'_> {
    type Error = RuntimeError;
    fn git_dir(&mut self, cwd: &[u16]) -> std::result::Result<Option<Vec<u16>>, RuntimeError> {
        let value = self
            .call("gitDir", vec![J::String(cwd.to_vec())])
            .map_err(Self::error)?;
        if value == J::Null {
            Ok(None)
        } else {
            Self::string(value).map(Some).map_err(Self::error)
        }
    }
    fn path_facts(&mut self, path: &[u16]) -> std::result::Result<PathFacts, RuntimeError> {
        let value = self
            .call("pathFacts", vec![J::String(path.to_vec())])
            .map_err(Self::error)?;
        let resolved =
            Self::string(value.get("resolved").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        let root =
            Self::string(value.get("root").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        let separator = Self::string(value.get("separator").cloned().unwrap_or(J::Null))
            .map_err(Self::error)?;
        if separator.len() != 1 {
            return Err(RuntimeError::Native(Error::from_reason(
                "Invalid path separator",
            )));
        }
        Ok(PathFacts {
            resolved,
            root,
            separator: separator[0],
            absolute: matches!(value.get("absolute"), Some(J::Bool(true))),
        })
    }
    fn resolve(
        &mut self,
        cwd: &[u16],
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, RuntimeError> {
        self.paths("resolve", &[cwd, path])
    }
    fn join(
        &mut self,
        directory: &[u16],
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, RuntimeError> {
        self.paths("join", &[directory, path])
    }
    fn dirname(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, RuntimeError> {
        self.paths("dirname", &[path])
    }
    fn symbolic(&mut self, path: &[u16]) -> std::result::Result<bool, FsError<RuntimeError>> {
        self.call("symbolic", vec![J::String(path.to_vec())])
            .map(|value| value == J::Bool(true))
    }
    fn read(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, FsError<RuntimeError>> {
        Self::string(self.call("read", vec![J::String(path.to_vec())])?)
    }
    fn mkdir(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.unit("mkdir", &[path])
    }
    fn temporary_path(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, RuntimeError> {
        self.paths("temporary", &[path])
    }
    fn write_new(
        &mut self,
        path: &[u16],
        content: &[u16],
    ) -> std::result::Result<(), FsError<RuntimeError>> {
        self.call(
            "write",
            vec![J::String(path.to_vec()), J::String(content.to_vec())],
        )
        .map(|_| ())
    }
    fn rename(&mut self, from: &[u16], to: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.unit("rename", &[from, to])
    }
    fn remove_force(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.unit("remove", &[path])
    }
}
impl ResolveHost for Host<'_> {
    type Error = RuntimeError;
    fn resolve(&mut self, parts: &[&[u16]]) -> std::result::Result<Vec<u16>, RuntimeError> {
        self.paths("resolve", parts)
    }
    fn join(
        &mut self,
        directory: &[u16],
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, RuntimeError> {
        self.paths("join", &[directory, path])
    }
    fn is_directory(&mut self, path: &[u16]) -> std::result::Result<bool, StatError<RuntimeError>> {
        // Only this stat operation admits ENOTDIR alongside ENOENT.
        let value = self
            .callback
            .call(
                (
                    "directory".to_owned(),
                    NativeJson(J::Array(vec![J::String(path.to_vec())])),
                )
                    .into(),
            )
            .map_err(|error| StatError::Other(RuntimeError::Native(error)))?;
        let value = json::parse_utf16(&value, Limits::default()).map_err(|error| {
            StatError::Other(RuntimeError::Native(Error::from_reason(error.to_string())))
        })?;
        if let Some(J::Number(id)) = value.get("error") {
            if !id.is_finite() || *id < 0.0 || *id > f64::from(u32::MAX) || id.fract() != 0.0 {
                return Err(StatError::Other(RuntimeError::Native(Error::from_reason(
                    "Invalid skill stat error handle",
                ))));
            }
            let error = RuntimeError::Foreign(*id as u32);
            return Err(match value.get("code") {
                Some(J::String(code)) if *code == u("ENOENT") || *code == u("ENOTDIR") => {
                    StatError::NoEntry(error)
                }
                _ => StatError::Other(error),
            });
        }
        Ok(value == J::Bool(true))
    }
}
fn host_error(error: RuntimeError) -> Result<NativeJson> {
    match error {
        RuntimeError::Foreign(id) => Ok(NativeJson(object(vec![(
            "foreignError",
            J::Number(f64::from(id)),
        )]))),
        RuntimeError::Native(error) => Err(error),
    }
}
fn exclude_error(error: exclude::Error<RuntimeError>) -> Result<NativeJson> {
    match error {
        exclude::Error::Policy(message) => {
            Ok(NativeJson(object(vec![("error", J::String(message))])))
        }
        exclude::Error::Host(error) => host_error(error),
    }
}
#[napi]
pub fn skill_append_exclude(
    cwd: Utf16String,
    run: Utf16String,
    entries: Vec<Utf16String>,
    prefix: Option<Utf16String>,
    callback: Callback,
) -> Result<NativeJson> {
    let entries = entries
        .into_iter()
        .map(|entry| entry.to_vec())
        .collect::<Vec<_>>();
    match exclude::append_file(
        &cwd,
        &run,
        &entries,
        prefix.as_deref(),
        &mut Host { callback },
    ) {
        Ok(id) => Ok(NativeJson(id.map_or(J::Null, J::String))),
        Err(error) => exclude_error(error),
    }
}
#[napi]
pub fn skill_remove_exclude(
    cwd: Utf16String,
    run: Utf16String,
    prefix: Option<Utf16String>,
    callback: Callback,
) -> Result<NativeJson> {
    match exclude::remove_file(&cwd, &run, prefix.as_deref(), &mut Host { callback }) {
        Ok(()) => Ok(NativeJson(J::Null)),
        Err(error) => exclude_error(error),
    }
}
#[napi]
pub fn skill_resolve(
    reference: Utf16String,
    cwd: Utf16String,
    home: Utf16String,
    callback: Callback,
) -> Result<NativeJson> {
    let result = match resolve::resolve_skill_reference(
        catalog(),
        &reference,
        &cwd,
        &home,
        &mut Host { callback },
    ) {
        Err(error) => return host_error(error),
        Ok(result) => result,
    };
    Ok(NativeJson(match result {
        Resolution::Malformed { reference } => object(vec![
            ("kind", text("malformed")),
            ("ref", J::String(reference)),
        ]),
        Resolution::UnknownAgent {
            reference,
            agent_input,
        } => object(vec![
            ("kind", text("unknown-agent")),
            ("ref", J::String(reference)),
            ("agentInput", J::String(agent_input)),
        ]),
        Resolution::NotFound {
            reference,
            searched_paths,
        } => object(vec![
            ("kind", text("not-found")),
            ("ref", J::String(reference)),
            (
                "searchedPaths",
                J::Array(searched_paths.into_iter().map(J::String).collect()),
            ),
        ]),
        Resolution::Resolved {
            reference,
            name,
            source_agent_id,
            source_path,
            scope,
        } => {
            let mut fields = vec![
                ("kind", text("resolved")),
                ("ref", J::String(reference)),
                ("name", J::String(name)),
                ("sourcePath", J::String(source_path)),
                (
                    "scope",
                    text(if scope == Scope::Local {
                        "project"
                    } else {
                        "user"
                    }),
                ),
            ];
            if let Some(id) = source_agent_id {
                fields.push(("sourceAgentId", J::String(id)));
            }
            object(fields)
        }
    }))
}
