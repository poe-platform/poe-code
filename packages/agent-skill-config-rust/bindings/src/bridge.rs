use super::*;
use agent_skill_config_rust::bridge::{self, DirectoryError, Kind, Manifest, Relation};
use std::cell::RefCell;
#[napi(object)]
pub struct SkillBytes {
    pub content: Option<Buffer>,
    pub error: Option<u32>,
}
pub type ReadBytes<'a> = Function<'a, Utf16String, SkillBytes>;
fn required(value: &J, key: &str) -> std::result::Result<Vec<u16>, RuntimeError> {
    match value.get(key) {
        Some(J::String(value)) => Ok(value.clone()),
        _ => Err(RuntimeError::Native(Error::from_reason(format!(
            "Expected bridge string {key}"
        )))),
    }
}
fn strings(value: J) -> std::result::Result<Vec<Vec<u16>>, RuntimeError> {
    match value {
        J::Array(values) => values
            .into_iter()
            .map(|value| Host::string(value).map_err(Host::error))
            .collect(),
        _ => Err(RuntimeError::Native(Error::from_reason(
            "Expected bridge string array",
        ))),
    }
}
fn kind(value: J) -> std::result::Result<Kind, RuntimeError> {
    match value {
        J::String(value) => Ok(if value == u("link") {
            Kind::Link
        } else if value == u("directory") {
            Kind::Directory
        } else if value == u("file") {
            Kind::File
        } else {
            Kind::Other
        }),
        _ => Err(RuntimeError::Native(Error::from_reason(
            "Expected bridge filesystem kind",
        ))),
    }
}
impl bridge::Host for Host<'_> {
    fn exists(&mut self, path: &[u16]) -> std::result::Result<bool, RuntimeError> {
        match self.call("exists", vec![J::String(path.to_vec())]) {
            Ok(value) => Ok(value == J::Bool(true)),
            Err(FsError::NotFound(_)) => Ok(false),
            Err(error) => Err(Self::error(error)),
        }
    }
    fn bridge_directory(&mut self, path: &[u16]) -> std::result::Result<bool, RuntimeError> {
        match self.call("bridgeDirectory", vec![J::String(path.to_vec())]) {
            Ok(value) => Ok(value == J::Bool(true)),
            Err(FsError::NotFound(_)) => Ok(false),
            Err(error) => Err(Self::error(error)),
        }
    }
    fn relation(
        &mut self,
        root: &[u16],
        target: &[u16],
    ) -> std::result::Result<Relation, RuntimeError> {
        let value = self
            .call(
                "bridgeRelation",
                vec![J::String(root.to_vec()), J::String(target.to_vec())],
            )
            .map_err(Self::error)?;
        let separator = required(&value, "separator")?;
        if separator.len() != 1 {
            return Err(RuntimeError::Native(Error::from_reason(
                "Expected bridge separator",
            )));
        }
        Ok(Relation {
            root: required(&value, "root")?,
            target: required(&value, "target")?,
            relative: required(&value, "relative")?,
            absolute: value.get("absolute") == Some(&J::Bool(true)),
            separator: separator[0],
        })
    }
    fn kind(&mut self, path: &[u16]) -> std::result::Result<Kind, RuntimeError> {
        kind(
            self.call("kind", vec![J::String(path.to_vec())])
                .map_err(Self::error)?,
        )
    }
    fn names(&mut self, path: &[u16]) -> std::result::Result<Vec<Vec<u16>>, RuntimeError> {
        strings(
            self.call("names", vec![J::String(path.to_vec())])
                .map_err(Self::error)?,
        )
    }
    fn entries(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<Vec<(Vec<u16>, Kind)>, RuntimeError> {
        let value = self
            .call("entries", vec![J::String(path.to_vec())])
            .map_err(Self::error)?;
        let J::Array(rows) = value else {
            return Err(RuntimeError::Native(Error::from_reason(
                "Expected bridge directory entries",
            )));
        };
        rows.into_iter()
            .map(|row| {
                Ok((
                    required(&row, "name")?,
                    kind(row.get("kind").cloned().unwrap_or(J::Null))?,
                ))
            })
            .collect()
    }
    fn read_bytes(&mut self, path: &[u16]) -> std::result::Result<Vec<u8>, RuntimeError> {
        let Some(bytes) = &self.bytes else {
            return Err(RuntimeError::Native(Error::from_reason(
                "Missing bridge byte reader",
            )));
        };
        let result = bytes
            .call(path.to_vec().into())
            .map_err(RuntimeError::Native)?;
        if let Some(id) = result.error {
            return Err(RuntimeError::Foreign(id));
        }
        result
            .content
            .map(|bytes| bytes.to_vec())
            .ok_or_else(|| RuntimeError::Native(Error::from_reason("Expected bridge file bytes")))
    }
    fn copy_file(
        &mut self,
        source: &[u16],
        target: &[u16],
    ) -> std::result::Result<(), RuntimeError> {
        self.unit("copyFile", &[source, target])
    }
    fn write_token(
        &mut self,
        path: &[u16],
        token: &[u16],
    ) -> std::result::Result<(), RuntimeError> {
        self.unit("writeToken", &[path, token])
    }
    fn uuid(&mut self) -> std::result::Result<Vec<u16>, RuntimeError> {
        Self::string(self.call("uuid", vec![]).map_err(Self::error)?).map_err(Self::error)
    }
    fn remove_tree(&mut self, path: &[u16]) -> std::result::Result<(), RuntimeError> {
        self.unit("removeTree", &[path])
    }
    fn remove_empty(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<(), DirectoryError<RuntimeError>> {
        let value = self
            .callback
            .call(
                (
                    "rmdir".to_owned(),
                    NativeJson(J::Array(vec![J::String(path.to_vec())])),
                )
                    .into(),
            )
            .map_err(|error| DirectoryError::Other(RuntimeError::Native(error)))?;
        let value = json::parse_utf16(&value, Limits::default()).map_err(|error| {
            DirectoryError::Other(RuntimeError::Native(Error::from_reason(error.to_string())))
        })?;
        if let Some(J::Number(id)) = value.get("error") {
            if !id.is_finite() || *id < 0.0 || *id > f64::from(u32::MAX) || id.fract() != 0.0 {
                return Err(DirectoryError::Other(RuntimeError::Native(
                    Error::from_reason("Invalid bridge directory error handle"),
                )));
            }
            let error = RuntimeError::Foreign(*id as u32);
            return Err(
                if matches!(value.get("code"),Some(J::String(code))if [u("ENOENT"),u("ENOTEMPTY"),u("EEXIST")].contains(code))
                {
                    DirectoryError::Ignore(error)
                } else {
                    DirectoryError::Other(error)
                },
            );
        }
        Ok(())
    }
}
fn error(value: bridge::Error<RuntimeError>) -> Result<NativeJson> {
    match value {
        bridge::Error::Host(error) => host_error(error),
        bridge::Error::Policy { message, user } => Ok(NativeJson(object(vec![(
            if user { "userError" } else { "error" },
            J::String(message),
        )]))),
    }
}
fn encode(manifest: Manifest) -> J {
    let mut fields = vec![
        ("spawnAgentId", J::String(manifest.spawn_agent_id)),
        ("cwd", J::String(manifest.cwd)),
        ("runId", J::String(manifest.run_id.clone())),
        (
            "entries",
            J::Array(
                manifest
                    .entries
                    .into_iter()
                    .map(|entry| {
                        object(vec![
                            ("ref", J::String(entry.reference)),
                            ("sourcePath", J::String(entry.source_path)),
                            ("targetPath", J::String(entry.target_path)),
                            (
                                "createdParents",
                                J::Array(
                                    entry.created_parents.into_iter().map(J::String).collect(),
                                ),
                            ),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "warnings",
            J::Array(
                manifest
                    .warnings
                    .into_iter()
                    .map(|warning| {
                        object(vec![
                            ("kind", text(warning.kind.name())),
                            ("ref", J::String(warning.reference)),
                            ("sourcePath", J::String(warning.source_path)),
                            ("conflictingPath", J::String(warning.conflicting_path)),
                            ("message", J::String(warning.message)),
                        ])
                    })
                    .collect(),
            ),
        ),
    ];
    if let Some(id) = &manifest.exclude_block_id
        && id != &manifest.run_id
    {
        fields.push(("excludeBlockId", J::String(id.clone())));
    }
    object(vec![
        ("manifest", object(fields)),
        (
            "excludeBlockId",
            manifest.exclude_block_id.map_or(J::Null, J::String),
        ),
    ])
}
#[napi(object)]
pub struct SkillBridgeRequest {
    pub spawn: Utf16String,
    pub cwd: Utf16String,
    pub home: Utf16String,
    pub run: Utf16String,
    pub refs: Vec<Utf16String>,
}
#[napi]
pub struct SkillBridge {
    state: RefCell<bridge::Bridge>,
}
#[napi]
impl SkillBridge {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: RefCell::new(bridge::Bridge::default()),
        }
    }
    #[napi]
    pub fn begin(
        &self,
        request: SkillBridgeRequest,
        callback: Callback,
        bytes: ReadBytes,
    ) -> Result<NativeJson> {
        let mut state = self
            .state
            .try_borrow_mut()
            .map_err(|_| Error::from_reason("Skill bridge is already running"))?;
        match state.begin(
            catalog(),
            bridge::Request {
                spawn_agent: request.spawn.to_vec(),
                cwd: request.cwd.to_vec(),
                home: request.home.to_vec(),
                run_id: request.run.to_vec(),
                references: request
                    .refs
                    .into_iter()
                    .map(|value| value.to_vec())
                    .collect(),
            },
            &mut Host {
                callback,
                bytes: Some(bytes),
            },
        ) {
            Ok(manifest) => Ok(NativeJson(encode(manifest))),
            Err(value) => error(value),
        }
    }
    #[napi]
    pub fn cleanup(
        &self,
        payload: Utf16String,
        callback: Callback,
        bytes: ReadBytes,
    ) -> Result<NativeJson> {
        let value = json::parse_utf16(&payload, Limits::default())
            .map_err(|error| Error::from_reason(error.to_string()))?;
        let cwd = required(&value, "cwd").map_err(|_| Error::from_reason("Expected bridge cwd"))?;
        let run = required(&value, "run").map_err(|_| Error::from_reason("Expected bridge run"))?;
        let exclude = match value.get("exclude") {
            Some(J::String(id)) => Some(id.clone()),
            _ => None,
        };
        let targets = strings(value.get("targets").cloned().unwrap_or(J::Null))
            .map_err(|_| Error::from_reason("Expected bridge targets"))?;
        let mut state = self
            .state
            .try_borrow_mut()
            .map_err(|_| Error::from_reason("Skill bridge is already running"))?;
        match state.cleanup(
            &cwd,
            &run,
            exclude.as_deref(),
            &targets,
            &mut Host {
                callback,
                bytes: Some(bytes),
            },
        ) {
            Ok(()) => Ok(NativeJson(J::Null)),
            Err(value) => error(value),
        }
    }
}
