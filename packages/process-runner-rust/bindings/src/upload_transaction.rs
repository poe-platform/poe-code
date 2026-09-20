use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::upload_transaction::{self, Action, Fault, Paths, Transaction};
#[napi]
pub const WORKSPACE_RENAME_ERROR: &str = upload_transaction::RENAME_ERROR;
#[napi(object)]
pub struct UploadPaths {
    pub workspace: Utf16String,
    pub upload: Utf16String,
    pub archive: Utf16String,
}
#[napi(object)]
pub struct UploadEffect {
    pub kind: String,
    pub path: Option<Utf16String>,
    pub relative: Option<Utf16String>,
    pub source: Option<Utf16String>,
    pub target: Option<Utf16String>,
    pub index: Option<u32>,
    pub success: Option<bool>,
}
#[napi]
pub struct UploadTransaction {
    state: Transaction,
}
#[napi]
impl UploadTransaction {
    #[napi(constructor)]
    pub fn new(paths: UploadPaths, files: Vec<Utf16String>) -> Self {
        Self {
            state: Transaction::new(
                Paths {
                    workspace: paths.workspace.to_vec(),
                    upload: paths.upload.to_vec(),
                    archive: paths.archive.to_vec(),
                },
                files.into_iter().map(|path| path.to_vec()).collect(),
            ),
        }
    }
    #[napi]
    pub fn next(&self) -> UploadEffect {
        let action = self.state.next();
        let mut effect = UploadEffect {
            kind: action.kind().to_owned(),
            path: None,
            relative: None,
            source: None,
            target: None,
            index: None,
            success: None,
        };
        match action {
            Action::RemoveTree(path)
            | Action::Mkdir(path)
            | Action::WriteArchive(path)
            | Action::Stat(path)
            | Action::RemoveFile(path) => {
                effect.path = Some(path.into());
            }
            Action::WriteFile {
                workspace,
                relative,
                index,
            } => {
                effect.path = Some(workspace.into());
                effect.relative = Some(relative.into());
                effect.index = Some(index as u32);
            }
            Action::Rename { source, target } => {
                effect.source = Some(source.into());
                effect.target = Some(target.into());
            }
            Action::Done { success } => {
                effect.success = Some(success);
            }
        }
        effect
    }
    #[napi]
    pub fn advance(&mut self, success: bool, exists: bool) -> Option<String> {
        self.state.advance(success, exists).map(|fault| {
            match fault {
                Fault::Primary => "primary",
                Fault::Ignore => "ignore",
                Fault::Replace => "replace",
            }
            .to_owned()
        })
    }
}
