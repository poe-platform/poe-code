use napi::bindgen_prelude::Utf16String;
use napi_derive::napi;
use toolcraft_rust::definitions::{self, Metadata, Source};

#[napi(object)]
pub struct MetadataInput {
    pub scope: Option<Vec<Utf16String>>,
    pub secrets: Vec<Utf16String>,
    pub approval: bool,
    pub auth: bool,
    pub version: bool,
    pub check: bool,
}

impl From<MetadataInput> for Metadata {
    fn from(value: MetadataInput) -> Self {
        Self {
            scope: value.scope.map(|names| {
                names
                    .into_iter()
                    .map(|name| name.as_ref().to_vec())
                    .collect()
            }),
            secrets: value
                .secrets
                .into_iter()
                .map(|name| name.as_ref().to_vec())
                .collect(),
            approval: value.approval,
            auth: value.auth,
            version: value.version,
            check: value.check,
        }
    }
}

#[napi(object)]
pub struct SecretSource {
    pub source: u32,
    pub index: u32,
}

#[napi(object)]
pub struct MetadataOutput {
    pub scope: Option<Vec<Utf16String>>,
    pub secrets: Vec<SecretSource>,
    pub approval: u32,
    pub auth: u32,
    pub version: u32,
    pub check: u32,
}

fn source_index(source: Source) -> u32 {
    match source {
        Source::Absent => 0,
        Source::Parent => 1,
        Source::Own => 2,
        Source::Both => 3,
    }
}

#[napi]
pub fn merge_definition_metadata(
    parent: MetadataInput,
    own: MetadataInput,
    command: bool,
) -> MetadataOutput {
    let plan = definitions::merge_metadata(&parent.into(), &own.into(), command);
    MetadataOutput {
        scope: plan
            .scope
            .map(|names| names.into_iter().map(Into::into).collect()),
        secrets: plan
            .secrets
            .into_iter()
            .map(|(source, index)| SecretSource {
                source: source_index(source),
                index: index as u32,
            })
            .collect(),
        approval: source_index(plan.approval),
        auth: source_index(plan.auth),
        version: source_index(plan.version),
        check: source_index(plan.check),
    }
}

#[napi(object)]
pub struct RenameIssue {
    pub kind: String,
    pub index: u32,
    pub previous: u32,
}

#[napi]
pub fn definition_rename_issue(targets: Vec<Utf16String>) -> Option<RenameIssue> {
    let targets = targets
        .into_iter()
        .map(|target| target.as_ref().to_vec())
        .collect::<Vec<_>>();
    definitions::rename_issue(&targets).map(|(kind, index, previous)| RenameIssue {
        kind: kind.into(),
        index: index as u32,
        previous: previous as u32,
    })
}

#[napi]
pub fn definition_default_issue(index: i32, commands: Vec<bool>) -> Option<&'static str> {
    definitions::default_child_issue(index, &commands)
}

#[napi]
pub fn definition_source_location(line: Utf16String) -> Option<Utf16String> {
    definitions::source_location(line.as_ref()).map(Into::into)
}
