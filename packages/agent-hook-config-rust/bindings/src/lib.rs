//! Own hook policies with a synchronous Node path/filesystem host.
use agent_hook_config_rust::{
    self as core, Catalog, GeneratedEntry, Handler, SourceEntry, SupportStatus,
    io::{self, FileHost, FsError, ReadScope, Stats},
    links::{self, LinkHost, PathFacts},
    paths::{PathPlan, Scope},
};
use config_mutations_rust::{snapshot, value::Value as V};
use mcp_protocol_rust::json::{self, Limits, Value as J};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::OnceLock;
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| Catalog::builtins().expect("Valid hook definitions"))
}
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
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
fn policy(error: Vec<u16>) -> NativeJson {
    NativeJson(object(vec![("error", J::String(error))]))
}
#[napi]
pub fn hook_registry() -> NativeJson {
    let agents = agent_defs_rust::Registry::builtins();
    NativeJson(object(vec![
        ("userErrorName", text(user_error_rust::USER_ERROR_NAME)),
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
            "lookup",
            J::Object(
                agents
                    .lookup_keys()
                    .iter()
                    .map(|(key, id)| (key.clone(), J::String(id.clone())))
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
    ]))
}
#[napi]
pub fn hook_support(input: Utf16String, id: Option<Utf16String>, configured: bool) -> NativeJson {
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
                SupportStatus::Unknown => "unknown",
                SupportStatus::Unsupported => "unsupported",
                SupportStatus::Supported => "supported",
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
pub fn hook_event_mappings(source: Utf16String, target: Utf16String) -> NativeJson {
    match catalog().event_mappings(&source, &target) {
        Err(error) => policy(error),
        Ok(mappings) => NativeJson(J::Array(
            mappings
                .into_iter()
                .map(|mapping| {
                    let mut fields = vec![
                        ("sourceEvent", J::String(mapping.source_event)),
                        (
                            "targetEvent",
                            mapping.target_event.map_or(J::Null, J::String),
                        ),
                    ];
                    if let Some(reason) = mapping.drop_reason {
                        fields.push(("dropReason", J::String(reason)));
                    }
                    object(fields)
                })
                .collect(),
        )),
    }
}
#[napi]
pub fn hook_handler_rules(target: Utf16String) -> NativeJson {
    match catalog().handler_rules(&target) {
        Err(error) => policy(error),
        Ok(rules) => NativeJson(J::Array(
            rules
                .into_iter()
                .map(|rule| {
                    let mut fields = vec![
                        ("sourceType", J::String(rule.source_type)),
                        ("allowed", J::Bool(rule.allowed)),
                    ];
                    if let Some(reason) = rule.drop_reason {
                        fields.push(("dropReason", J::String(reason)));
                    }
                    object(fields)
                })
                .collect(),
        )),
    }
}
#[napi]
pub fn hook_placeholder_rewrites(source: Utf16String, target: Utf16String) -> NativeJson {
    match catalog().placeholder_rewrites(&source, &target) {
        Err(error) => policy(error),
        Ok(rules) => NativeJson(J::Array(
            rules
                .into_iter()
                .map(|rule| {
                    object(vec![
                        ("from", J::String(rule.from)),
                        ("to", J::String(rule.to)),
                    ])
                })
                .collect(),
        )),
    }
}
fn decode(buffer: &[u8]) -> Result<V> {
    snapshot::decode(buffer).map_err(Error::from_reason)
}
fn string(value: &V, key: &str) -> Result<Vec<u16>> {
    match value.get(key) {
        Some(V::String(value)) => Ok(value.clone()),
        _ => Err(Error::from_reason(format!(
            "Expected hook string field {key}"
        ))),
    }
}
fn optional(value: &V, key: &str) -> Result<Option<Vec<u16>>> {
    match value.get(key) {
        Some(V::String(value)) => Ok(Some(value.clone())),
        None | Some(V::Undefined) => Ok(None),
        _ => Err(Error::from_reason(format!(
            "Expected optional hook string field {key}"
        ))),
    }
}
fn handler(value: &V) -> Result<Handler> {
    let args = match value.get("args") {
        None | Some(V::Undefined) => None,
        Some(V::Array(values)) => Some(
            values
                .iter()
                .map(|value| match value {
                    V::String(value) => Ok(value.clone()),
                    _ => Err(Error::from_reason("Expected string hook arguments")),
                })
                .collect::<Result<_>>()?,
        ),
        _ => return Err(Error::from_reason("Expected hook argument array")),
    };
    let timeout = match value.get("timeout") {
        None | Some(V::Undefined) => None,
        Some(V::Number(value)) => Some(*value),
        _ => return Err(Error::from_reason("Expected numeric hook timeout")),
    };
    Ok(Handler {
        kind: string(value, "type")?,
        command: optional(value, "command")?,
        args,
        timeout,
        status_message: optional(value, "statusMessage")?,
    })
}
fn incoming(value: V) -> Result<Vec<GeneratedEntry>> {
    let V::Array(rows) = value else {
        return Err(Error::from_reason("Expected generated hook entries"));
    };
    rows.into_iter()
        .map(|row| {
            Ok(GeneratedEntry {
                event: string(&row, "event")?,
                matcher: optional(&row, "matcher")?,
                generated_id: string(&row, "generatedId")?,
                handler: handler(
                    row.get("handler")
                        .ok_or_else(|| Error::from_reason("Expected generated hook handler"))?,
                )?,
            })
        })
        .collect()
}
fn encoded_handler(handler: Handler) -> J {
    let mut fields = vec![
        ("type", J::String(handler.kind)),
        ("command", J::String(handler.command.unwrap_or_default())),
        (
            "statusMessage",
            J::String(handler.status_message.unwrap_or_default()),
        ),
    ];
    if let Some(args) = handler.args {
        fields.push(("args", J::Array(args.into_iter().map(J::String).collect())));
    }
    if let Some(timeout) = handler.timeout {
        fields.push((
            "timeout",
            if timeout.is_finite() && !(timeout == 0.0 && timeout.is_sign_negative()) {
                J::Number(timeout)
            } else {
                text(&timeout.to_string())
            },
        ));
    }
    object(fields)
}
fn generated(entry: GeneratedEntry) -> J {
    object(vec![
        ("event", J::String(entry.event)),
        ("matcher", entry.matcher.map_or(J::Null, J::String)),
        ("handler", encoded_handler(entry.handler)),
        ("generatedId", J::String(entry.generated_id)),
    ])
}
#[napi]
pub fn hook_transform(
    source: Buffer,
    from: Utf16String,
    to: Utf16String,
    run: Utf16String,
) -> Result<String> {
    let V::Array(rows) = decode(&source)? else {
        return Err(Error::from_reason("Expected source hooks"));
    };
    let rows = rows
        .into_iter()
        .map(|row| {
            Ok(SourceEntry {
                event: string(&row, "event")?,
                matcher: optional(&row, "matcher")?,
                handler: handler(
                    row.get("handler")
                        .ok_or_else(|| Error::from_reason("Expected hook handler"))?,
                )?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let result = match core::transform_hooks(catalog(), &rows, &from, &to, &run) {
        Err(error) => policy(error),
        Ok(result) => NativeJson(object(vec![
            (
                "entries",
                J::Array(result.entries.into_iter().map(generated).collect()),
            ),
            (
                "drops",
                J::Array(
                    result
                        .drops
                        .into_iter()
                        .map(|drop| {
                            object(vec![
                                ("reason", text(drop.reason)),
                                ("detail", J::String(drop.detail)),
                                ("sourceIndex", J::Number(drop.source_index as f64)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ])),
    };
    Ok(json::stringify(&result.0))
}
fn json_snapshot(value: V) -> Result<J> {
    Ok(match value {
        V::Null => J::Null,
        V::Bool(value) => J::Bool(value),
        V::Number(value) => J::Number(value),
        V::String(value) => J::String(value),
        V::Array(values) => J::Array(
            values
                .into_iter()
                .map(json_snapshot)
                .collect::<Result<_>>()?,
        ),
        V::Object(fields) => J::Object(
            fields
                .into_iter()
                .filter(|(_, value)| !matches!(value, V::Undefined))
                .map(|(key, value)| Ok((key, json_snapshot(value)?)))
                .collect::<Result<_>>()?,
        ),
        _ => return Err(Error::from_reason("Unsupported hook configuration value")),
    })
}
fn config(value: V) -> Result<core::Config> {
    core::Config::from_value(&json_snapshot(value)?)
        .map_err(|error| Error::from_reason(String::from_utf16_lossy(&error)))
}

#[napi]
pub fn hook_transform_pairs(configs: Buffer) -> Result<NativeJson> {
    let V::Object(fields) = decode(&configs)? else {
        return Err(Error::from_reason("Expected hook registry"));
    };
    let configs = fields
        .into_iter()
        .map(|(id, value)| Ok((id, config(value)?)))
        .collect::<Result<Vec<_>>>()?;
    Ok(NativeJson(J::Array(
        core::transform_pairs(&configs)
            .into_iter()
            .map(|(source, target)| {
                object(vec![
                    ("source", J::String(source)),
                    ("target", J::String(target)),
                ])
            })
            .collect(),
    )))
}
#[napi]
pub fn hook_path(
    global: Utf16String,
    local: Option<Utf16String>,
    scope: String,
    cwd: Utf16String,
    home: Utf16String,
) -> NativeJson {
    let base = catalog().configs()[0].1.clone();
    let cfg = core::Config {
        global_path: global.to_vec(),
        local_path: local.map(|local| local.to_vec()),
        ..base
    };
    NativeJson(
        match core::paths::plan_hook_path(
            &cfg,
            if scope == "global" {
                Scope::Global
            } else {
                Scope::Local
            },
            &cwd,
            &home,
        ) {
            None => J::Null,
            Some(PathPlan::Resolve(path)) => {
                object(vec![("kind", text("resolve")), ("path", J::String(path))])
            }
            Some(PathPlan::Join { directory, path }) => object(vec![
                ("kind", text("join")),
                ("directory", J::String(directory)),
                ("path", J::String(path)),
            ]),
            Some(PathPlan::ResolveFrom { directory, path }) => object(vec![
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
type Hook<'a> = Function<'a, FnArgs<(String, NativeJson)>, Utf16String>;
struct Host<'a> {
    hook: Hook<'a>,
}
impl Host<'_> {
    fn call(&self, operation: &str, args: Vec<J>) -> std::result::Result<J, FsError<RuntimeError>> {
        let value = self
            .hook
            .call((operation.to_owned(), NativeJson(J::Array(args))).into())
            .map_err(|error| FsError::Other(RuntimeError::Native(error)))?;
        let value = json::parse_utf16(&value, Limits::default()).map_err(|error| {
            FsError::Other(RuntimeError::Native(Error::from_reason(error.to_string())))
        })?;
        if let Some(J::Number(id)) = value.get("error") {
            if !id.is_finite() || *id < 0.0 || *id > f64::from(u32::MAX) || id.fract() != 0.0 {
                return Err(FsError::Other(RuntimeError::Native(Error::from_reason(
                    "Invalid hook error handle",
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
    fn text(value: J) -> std::result::Result<Vec<u16>, FsError<RuntimeError>> {
        match value {
            J::String(value) => Ok(value),
            _ => Err(FsError::Other(RuntimeError::Native(Error::from_reason(
                "Expected filesystem text",
            )))),
        }
    }
    fn error(error: FsError<RuntimeError>) -> RuntimeError {
        match error {
            FsError::NotFound(error) | FsError::Exists(error) | FsError::Other(error) => error,
        }
    }
}
impl FileHost for Host<'_> {
    type Error = RuntimeError;
    fn resolve(&mut self, parts: &[&[u16]]) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::text(
            self.call(
                "resolve",
                parts.iter().map(|part| J::String(part.to_vec())).collect(),
            )
            .map_err(Self::error)?,
        )
        .map_err(Self::error)
    }
    fn join(
        &mut self,
        directory: &[u16],
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::text(
            self.call(
                "join",
                vec![J::String(directory.to_vec()), J::String(path.to_vec())],
            )
            .map_err(Self::error)?,
        )
        .map_err(Self::error)
    }
    fn dirname(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::text(
            self.call("dirname", vec![J::String(path.to_vec())])
                .map_err(Self::error)?,
        )
        .map_err(Self::error)
    }
    fn lstat(&mut self, path: &[u16]) -> std::result::Result<Stats, FsError<RuntimeError>> {
        let value = self.call("lstat", vec![J::String(path.to_vec())])?;
        Ok(Stats {
            symbolic: matches!(value.get("symbolic"), Some(J::Bool(true))),
            file: matches!(value.get("file"), Some(J::Bool(true))),
        })
    }
    fn read(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, FsError<RuntimeError>> {
        Self::text(self.call("read", vec![J::String(path.to_vec())])?)
    }
    fn mkdir(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.call("mkdir", vec![J::String(path.to_vec())])
            .map(|_| ())
            .map_err(Self::error)
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
        self.call(
            "rename",
            vec![J::String(from.to_vec()), J::String(to.to_vec())],
        )
        .map(|_| ())
        .map_err(Self::error)
    }
    fn unlink(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.call("unlink", vec![J::String(path.to_vec())])
            .map(|_| ())
            .map_err(Self::error)
    }
}
fn runtime_error(error: io::Error<RuntimeError>) -> Result<NativeJson> {
    Ok(match error {
        io::Error::Policy(message) => policy(message),
        io::Error::Host(RuntimeError::Foreign(id)) => {
            NativeJson(object(vec![("foreignError", J::Number(f64::from(id)))]))
        }
        io::Error::Host(RuntimeError::Native(error)) => return Err(error),
        io::Error::MalformedJson { path, content } => NativeJson(object(vec![
            ("malformedPath", J::String(path)),
            ("content", J::String(content)),
        ])),
    })
}
#[napi]
pub fn hook_read(
    cwd: Utf16String,
    home: Utf16String,
    scope: String,
    hook: Hook,
) -> Result<NativeJson> {
    match io::read_hooks(
        catalog(),
        &cwd,
        &home,
        match scope.as_str() {
            "project" => ReadScope::Project,
            "user" => ReadScope::User,
            _ => ReadScope::Merged,
        },
        &mut Host { hook },
    ) {
        Err(error) => runtime_error(error),
        Ok(result) => Ok(NativeJson(object(vec![
            (
                "readPaths",
                J::Array(result.read_paths.into_iter().map(J::String).collect()),
            ),
            (
                "entries",
                J::Array(
                    result
                        .entries
                        .into_iter()
                        .map(|entry| {
                            let mut fields = vec![
                                ("event", J::String(entry.event)),
                                ("handler", entry.handler),
                            ];
                            if let Some(matcher) = entry.matcher {
                                fields.push(("matcher", matcher));
                            }
                            object(fields)
                        })
                        .collect(),
                ),
            ),
        ]))),
    }
}
#[napi]
pub fn hook_write(
    path: Utf16String,
    entries: Buffer,
    run: Utf16String,
    preserve: bool,
    hook: Hook,
) -> Result<NativeJson> {
    let entries = incoming(decode(&entries)?)?;
    match io::write_hooks(&path, &entries, &run, preserve, &mut Host { hook }) {
        Err(error) => runtime_error(error),
        Ok(result) => Ok(NativeJson(object(vec![
            ("path", J::String(result.path)),
            ("fileCreated", J::Bool(result.file_created)),
            (
                "previousGeneratedRemoved",
                J::Number(result.previous_generated_removed as f64),
            ),
            (
                "generatedWritten",
                J::Number(result.generated_written as f64),
            ),
        ]))),
    }
}

impl LinkHost for Host<'_> {
    fn path_facts(
        &mut self,
        resolved: &[u16],
        root: Option<&[u16]>,
    ) -> std::result::Result<PathFacts, RuntimeError> {
        let value = self
            .call(
                "pathFacts",
                vec![
                    J::String(resolved.to_vec()),
                    root.map_or(J::Null, |root| J::String(root.to_vec())),
                ],
            )
            .map_err(Self::error)?;
        let root =
            Self::text(value.get("root").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        let relative =
            Self::text(value.get("relative").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        let separator =
            Self::text(value.get("separator").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        if separator.len() != 1 {
            return Err(RuntimeError::Native(Error::from_reason(
                "Invalid path separator",
            )));
        }
        Ok(PathFacts {
            root,
            relative,
            separator: separator[0],
            absolute_relative: matches!(value.get("absolute"), Some(J::Bool(true))),
        })
    }
    fn read_link(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, FsError<RuntimeError>> {
        Self::text(self.call("readlink", vec![J::String(path.to_vec())])?)
    }
    fn symlink(&mut self, target: &[u16], path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.call(
            "symlink",
            vec![J::String(target.to_vec()), J::String(path.to_vec())],
        )
        .map(|_| ())
        .map_err(Self::error)
    }
}
fn link_error(error: links::Error<RuntimeError>) -> Result<J> {
    Ok(match error {
        links::Error::Policy(message) => policy(message).0,
        links::Error::UserAuthored(message) => object(vec![(
            "userError",
            object(vec![
                ("message", J::String(message)),
                ("code", text(links::USER_AUTHORED_CODE)),
                ("name", text(user_error_rust::USER_ERROR_NAME)),
            ]),
        )]),
        links::Error::Host(RuntimeError::Foreign(id)) => {
            object(vec![("foreignError", J::Number(f64::from(id)))])
        }
        links::Error::Host(RuntimeError::Native(error)) => return Err(error),
        links::Error::Restore { original, restore } => object(vec![
            (
                "aggregateError",
                J::Array(vec![link_error(*original)?, link_error(*restore)?]),
            ),
            ("originalPrefix", text(links::ORIGINAL_FAILURE_PREFIX)),
            ("restorePrefix", text(links::RESTORE_FAILURE_PREFIX)),
        ]),
    })
}
#[napi]
pub fn hook_assert_path(
    path: Utf16String,
    root: Option<Utf16String>,
    hook: Hook,
) -> Result<NativeJson> {
    match links::assert_no_symbolic_link(&path, root.as_deref(), &mut Host { hook }) {
        Ok(()) => Ok(NativeJson(J::Null)),
        Err(error) => Ok(NativeJson(link_error(error)?)),
    }
}
#[napi]
#[allow(clippy::too_many_arguments)]
pub fn hook_symlink(
    source: Option<Buffer>,
    target: Option<Buffer>,
    source_id: Utf16String,
    target_id: Utf16String,
    cwd: Utf16String,
    home: Utf16String,
    scope: String,
    hook: Hook,
) -> Result<NativeJson> {
    let source = source
        .map(|value| decode(&value).and_then(config))
        .transpose()?;
    let target = target
        .map(|value| decode(&value).and_then(config))
        .transpose()?;
    match links::symlink_hooks(
        source.as_ref(),
        target.as_ref(),
        &source_id,
        &target_id,
        &cwd,
        &home,
        if scope == "project" {
            links::Scope::Project
        } else {
            links::Scope::User
        },
        &mut Host { hook },
    ) {
        Err(error) => Ok(NativeJson(link_error(error)?)),
        Ok(result) => Ok(NativeJson(object(vec![
            ("symlinkPath", J::String(result.symlink_path)),
            ("targetPath", J::String(result.target_path)),
            (
                "replaced",
                text(match result.replaced {
                    links::Replaced::None => "none",
                    links::Replaced::StaleSymlink => "stale-symlink",
                    links::Replaced::GeneratedFile => "generated-file",
                }),
            ),
        ]))),
    }
}
#[napi]
pub const USER_AUTHORED_HOOK_FILE_CODE: &str = links::USER_AUTHORED_CODE;

mod bridge;
