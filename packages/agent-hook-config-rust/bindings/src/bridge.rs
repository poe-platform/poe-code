use super::{Host as NodeHost, *};
use agent_hook_config_rust::{
    bridge::{self, Agent, DirectoryError, Manifest, Request, State, Strategy, StrategyRequest},
    lifecycle::PriorGroups,
};
use agent_skill_config_rust::exclude::{self, Host as ExcludeHost};
use std::cell::RefCell;
fn exclude_fs(error: FsError<RuntimeError>) -> exclude::FsError<RuntimeError> {
    match error {
        FsError::NotFound(error) => exclude::FsError::NotFound(error),
        FsError::Exists(error) => exclude::FsError::Exists(error),
        FsError::Other(error) => exclude::FsError::Other(error),
    }
}
impl ExcludeHost for NodeHost<'_> {
    type Error = RuntimeError;
    fn git_dir(&mut self, cwd: &[u16]) -> std::result::Result<Option<Vec<u16>>, RuntimeError> {
        let value = self
            .call("gitDir", vec![J::String(cwd.to_vec())])
            .map_err(Self::error)?;
        if value == J::Null {
            Ok(None)
        } else {
            Self::text(value).map(Some).map_err(Self::error)
        }
    }
    fn path_facts(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<exclude::PathFacts, RuntimeError> {
        let value = self
            .call("excludePathFacts", vec![J::String(path.to_vec())])
            .map_err(Self::error)?;
        let resolved =
            Self::text(value.get("resolved").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        let root =
            Self::text(value.get("root").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        let separator =
            Self::text(value.get("separator").cloned().unwrap_or(J::Null)).map_err(Self::error)?;
        if separator.len() != 1 {
            return Err(RuntimeError::Native(Error::from_reason(
                "Invalid exclude path separator",
            )));
        }
        Ok(exclude::PathFacts {
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
        Self::text(
            self.call(
                "resolve",
                vec![J::String(cwd.to_vec()), J::String(path.to_vec())],
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
    fn symbolic(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<bool, exclude::FsError<RuntimeError>> {
        self.call("lstat", vec![J::String(path.to_vec())])
            .map(|value| matches!(value.get("symbolic"), Some(J::Bool(true))))
            .map_err(exclude_fs)
    }
    fn read(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, exclude::FsError<RuntimeError>> {
        self.call("read", vec![J::String(path.to_vec())])
            .and_then(Self::text)
            .map_err(exclude_fs)
    }
    fn mkdir(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.call("mkdir", vec![J::String(path.to_vec())])
            .map(|_| ())
            .map_err(Self::error)
    }
    fn temporary_path(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::text(
            self.call("excludeTemporary", vec![J::String(path.to_vec())])
                .map_err(Self::error)?,
        )
        .map_err(Self::error)
    }
    fn write_new(
        &mut self,
        path: &[u16],
        content: &[u16],
    ) -> std::result::Result<(), exclude::FsError<RuntimeError>> {
        self.call(
            "write",
            vec![J::String(path.to_vec()), J::String(content.to_vec())],
        )
        .map(|_| ())
        .map_err(exclude_fs)
    }
    fn rename(&mut self, from: &[u16], to: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.call(
            "rename",
            vec![J::String(from.to_vec()), J::String(to.to_vec())],
        )
        .map(|_| ())
        .map_err(Self::error)
    }
    fn remove_force(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.call("remove", vec![J::String(path.to_vec())])
            .map(|_| ())
            .map_err(Self::error)
    }
}
impl bridge::Host for NodeHost<'_> {
    fn remove_empty_directory(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<(), DirectoryError<RuntimeError>> {
        let result = self
            .hook
            .call(
                (
                    "rmdir".to_owned(),
                    NativeJson(J::Array(vec![J::String(path.to_vec())])),
                )
                    .into(),
            )
            .map_err(|error| DirectoryError::Other(RuntimeError::Native(error)))?;
        let result = json::parse_utf16(&result, Limits::default()).map_err(|error| {
            DirectoryError::Other(RuntimeError::Native(Error::from_reason(error.to_string())))
        })?;
        if let Some(J::Number(id)) = result.get("error") {
            if !id.is_finite() || *id < 0.0 || *id > f64::from(u32::MAX) || id.fract() != 0.0 {
                return Err(DirectoryError::Other(RuntimeError::Native(
                    Error::from_reason("Invalid directory error handle"),
                )));
            }
            let error = RuntimeError::Foreign(*id as u32);
            return Err(
                if matches!(result.get("code"),Some(J::String(code))if [u("ENOENT"),u("ENOTEMPTY"),u("EEXIST")].contains(code))
                {
                    DirectoryError::Ignore(error)
                } else {
                    DirectoryError::Other(error)
                },
            );
        }
        Ok(())
    }
    fn cleanup_temporary_path(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::text(
            self.call("cleanupTemporary", vec![J::String(path.to_vec())])
                .map_err(Self::error)?,
        )
        .map_err(Self::error)
    }
}
fn error(value: bridge::Error<RuntimeError>) -> Result<NativeJson> {
    match value {
        bridge::Error::Policy(message) => Ok(policy(message)),
        bridge::Error::Host(RuntimeError::Foreign(id)) => Ok(NativeJson(object(vec![(
            "foreignError",
            J::Number(f64::from(id)),
        )]))),
        bridge::Error::Host(RuntimeError::Native(error)) => Err(error),
        bridge::Error::MalformedJson { path, content } => Ok(NativeJson(object(vec![
            ("malformedPath", J::String(path)),
            ("content", J::String(content)),
        ]))),
        bridge::Error::Link(error) => Ok(NativeJson(link_error(error)?)),
    }
}
fn agent(value: &V) -> Result<Agent> {
    Ok(Agent {
        input: string(value, "input")?,
        id: optional(value, "id")?,
        config: match value.get("config") {
            None | Some(V::Undefined) => None,
            Some(value) => Some(config(value.clone())?),
        },
    })
}
fn array_strings(value: Option<&V>) -> Result<Option<Vec<Vec<u16>>>> {
    match value {
        None | Some(V::Undefined) => Ok(None),
        Some(V::Array(rows)) => Ok(Some(
            rows.iter()
                .map(|row| match row {
                    V::String(value) => Ok(value.clone()),
                    _ => Err(Error::from_reason("Expected bridge string array")),
                })
                .collect::<Result<_>>()?,
        )),
        _ => Err(Error::from_reason("Expected bridge array")),
    }
}
fn boolean(value: &V, key: &str) -> Option<bool> {
    match value.get(key) {
        Some(V::Bool(value)) => Some(*value),
        _ => None,
    }
}
fn state(value: Option<&V>) -> Result<Option<State>> {
    match value {
        None | Some(V::Undefined) | Some(V::Null) => Ok(None),
        Some(value) => Ok(Some(State {
            ownership_id: string(value, "ownershipId")?,
            exclude_block_id: optional(value, "excludeBlockId")?,
            cleaned: boolean(value, "cleaned") == Some(true),
        })),
    }
}
fn decode_manifest(value: &V, state_value: Option<&V>) -> Result<Manifest> {
    let prior =
        if value.get("preExistingEvents").is_some() || value.get("preExistingMatchers").is_some() {
            let mut matchers = vec![];
            if let Some(V::Array(rows)) = value.get("preExistingMatchers") {
                for row in rows {
                    let matcher = match row.get("matcher") {
                        None | Some(V::Undefined) => None,
                        Some(value) => Some(json_snapshot(value.clone())?),
                    };
                    matchers.push((string(row, "event")?, matcher));
                }
            }
            Some(PriorGroups {
                events: array_strings(value.get("preExistingEvents"))?.unwrap_or_default(),
                matchers,
            })
        } else {
            None
        };
    Ok(Manifest {
        source_agent_id: vec![],
        target_agent_id: vec![],
        cwd: string(value, "cwd")?,
        run_id: string(value, "runId")?,
        strategy: match string(value, "strategy")?.as_slice() {
            value if value == u("symlink") => Strategy::Symlink,
            value if value == u("transform") => Strategy::Transform,
            _ => Strategy::Skip,
        },
        drops: vec![],
        written_path: optional(value, "writtenPath")?,
        generated_entry_ids: None,
        symlink_path: optional(value, "symlinkPath")?,
        symlink_target: optional(value, "symlinkTarget")?,
        symlink_replaced: None,
        symlink_created: boolean(value, "symlinkCreated"),
        warnings: None,
        created_parents: array_strings(value.get("createdParents"))?,
        prior,
        file_created: boolean(value, "fileCreated"),
        state: state(state_value)?,
    })
}
fn encode_manifest(manifest: Manifest) -> J {
    let mut fields = vec![
        ("sourceAgentId", J::String(manifest.source_agent_id)),
        ("targetAgentId", J::String(manifest.target_agent_id)),
        ("cwd", J::String(manifest.cwd)),
        ("runId", J::String(manifest.run_id)),
        (
            "strategy",
            text(match manifest.strategy {
                Strategy::Symlink => "symlink",
                Strategy::Transform => "transform",
                Strategy::Skip => "skip",
            }),
        ),
        (
            "drops",
            J::Array(
                manifest
                    .drops
                    .into_iter()
                    .map(|drop| {
                        let mut source = vec![
                            ("event", J::String(drop.source.event)),
                            ("handler", drop.source.handler),
                        ];
                        if let Some(matcher) = drop.source.matcher {
                            source.push(("matcher", matcher));
                        }
                        object(vec![
                            ("reason", text(drop.reason)),
                            ("detail", J::String(drop.detail)),
                            ("source", object(source)),
                        ])
                    })
                    .collect(),
            ),
        ),
    ];
    for (key, value) in [
        ("writtenPath", manifest.written_path),
        ("symlinkPath", manifest.symlink_path),
        ("symlinkTarget", manifest.symlink_target),
    ] {
        if let Some(value) = value {
            fields.push((key, J::String(value)));
        }
    }
    for (key, value) in [
        ("generatedEntryIds", manifest.generated_entry_ids),
        ("warnings", manifest.warnings),
        ("createdParents", manifest.created_parents),
    ] {
        if let Some(values) = value {
            fields.push((key, J::Array(values.into_iter().map(J::String).collect())));
        }
    }
    for (key, value) in [
        ("symlinkCreated", manifest.symlink_created),
        ("fileCreated", manifest.file_created),
    ] {
        if let Some(value) = value {
            fields.push((key, J::Bool(value)));
        }
    }
    if let Some(replaced) = manifest.symlink_replaced {
        fields.push((
            "symlinkReplaced",
            text(match replaced {
                links::Replaced::None => "none",
                links::Replaced::StaleSymlink => "stale-symlink",
                links::Replaced::GeneratedFile => "generated-file",
            }),
        ));
    }
    if let Some(prior) = manifest.prior {
        fields.push((
            "preExistingEvents",
            J::Array(prior.events.into_iter().map(J::String).collect()),
        ));
        fields.push((
            "preExistingMatchers",
            J::Array(
                prior
                    .matchers
                    .into_iter()
                    .map(|(event, matcher)| {
                        let mut fields = vec![("event", J::String(event))];
                        if let Some(matcher) = matcher {
                            fields.push(("matcher", matcher));
                        }
                        object(fields)
                    })
                    .collect(),
            ),
        ));
    }
    let state = manifest.state.map_or(J::Null, |state| {
        let mut fields = vec![
            ("ownershipId", J::String(state.ownership_id)),
            ("cleaned", J::Bool(state.cleaned)),
        ];
        if let Some(id) = state.exclude_block_id {
            fields.push(("excludeBlockId", J::String(id)));
        }
        object(fields)
    });
    object(vec![("manifest", object(fields)), ("state", state)])
}
#[napi]
pub struct HookBridge {
    state: RefCell<bridge::Bridge>,
}
#[napi]
impl HookBridge {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: RefCell::new(bridge::Bridge::default()),
        }
    }
    #[napi]
    pub fn begin(&self, payload: Buffer, hook: Hook) -> Result<NativeJson> {
        let value = decode(&payload)?;
        let request = Request {
            source: agent(
                value
                    .get("source")
                    .ok_or_else(|| Error::from_reason("Expected bridge source"))?,
            )?,
            target: agent(
                value
                    .get("target")
                    .ok_or_else(|| Error::from_reason("Expected bridge target"))?,
            )?,
            cwd: string(&value, "cwd")?,
            home: string(&value, "home")?,
            run_id: string(&value, "runId")?,
            strategy: match string(&value, "strategy")?.as_slice() {
                value if value == u("auto") => StrategyRequest::Auto,
                value if value == u("symlink") => StrategyRequest::Symlink,
                _ => StrategyRequest::Transform,
            },
            scope: match string(&value, "scope")?.as_slice() {
                value if value == u("project") => ReadScope::Project,
                value if value == u("user") => ReadScope::User,
                _ => ReadScope::Merged,
            },
        };
        let mut state = self
            .state
            .try_borrow_mut()
            .map_err(|_| Error::from_reason("Hook bridge is already running"))?;
        match state.begin(catalog(), request, &mut NodeHost { hook }) {
            Ok(manifest) => Ok(NativeJson(encode_manifest(manifest))),
            Err(value) => error(value),
        }
    }
    #[napi]
    pub fn cleanup(&self, payload: Buffer, hook: Hook) -> Result<NativeJson> {
        let value = decode(&payload)?;
        let mut manifest = decode_manifest(
            value
                .get("manifest")
                .ok_or_else(|| Error::from_reason("Expected bridge manifest"))?,
            value.get("state"),
        )?;
        let mut state = self
            .state
            .try_borrow_mut()
            .map_err(|_| Error::from_reason("Hook bridge is already running"))?;
        match state.cleanup(&mut manifest, &mut NodeHost { hook }) {
            Ok(()) => Ok(NativeJson(J::Null)),
            Err(value) => error(value),
        }
    }
}
