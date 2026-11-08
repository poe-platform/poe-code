//! Resumable upload mutation order. Hosts execute effects synchronously or
//! asynchronously; portable Rust owns admission, promotion and rollback.
pub const RENAME_ERROR: &str = "Workspace transfer filesystem must support atomic rename.";
pub type Text = Vec<u16>;
pub struct Paths {
    pub workspace: Text,
    pub upload: Text,
    pub archive: Text,
}
pub enum Action {
    RemoveTree(Text),
    Mkdir(Text),
    WriteArchive(Text),
    WriteFile {
        workspace: Text,
        relative: Text,
        index: usize,
    },
    Stat(Text),
    Rename {
        source: Text,
        target: Text,
    },
    RemoveFile(Text),
    Done {
        success: bool,
    },
}
impl Action {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RemoveTree(_) => "removeTree",
            Self::Mkdir(_) => "mkdir",
            Self::WriteArchive(_) => "writeArchive",
            Self::WriteFile { .. } => "writeFile",
            Self::Stat(_) => "stat",
            Self::Rename { .. } => "rename",
            Self::RemoveFile(_) => "removeFile",
            Self::Done { .. } => "done",
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub enum Fault {
    Primary,
    Ignore,
    Replace,
}
enum Stage {
    RemoveStageBefore,
    RemoveBackupBefore,
    MakeWorkspace,
    MakeUpload,
    Archive,
    File(usize),
    StatWorkspace,
    Backup,
    PromoteWorkspace,
    PromoteArchive,
    RemoveBackupAfter,
    RollbackStat,
    Restore,
    CleanupWorkspace,
    RollbackArchive,
    Done(bool),
}
pub struct Transaction {
    paths: Paths,
    files: Vec<Text>,
    staged_workspace: Text,
    backup_workspace: Text,
    staged_archive: Text,
    stage: Stage,
    had_workspace: bool,
}
fn suffix(text: &[u16], suffix: &str) -> Text {
    let mut path = text.to_vec();
    path.extend(suffix.encode_utf16());
    path
}
impl Transaction {
    pub fn new(paths: Paths, files: Vec<Text>) -> Self {
        let staged_workspace = suffix(&paths.workspace, ".upload-tmp");
        let backup_workspace = suffix(&paths.workspace, ".upload-backup");
        let staged_archive = suffix(&paths.archive, ".upload-tmp");
        Self {
            paths,
            files,
            staged_workspace,
            backup_workspace,
            staged_archive,
            stage: Stage::RemoveStageBefore,
            had_workspace: false,
        }
    }
    pub fn next(&self) -> Action {
        match self.stage {
            Stage::RemoveStageBefore | Stage::CleanupWorkspace => {
                Action::RemoveTree(self.staged_workspace.clone())
            }
            Stage::RemoveBackupBefore | Stage::RemoveBackupAfter => {
                Action::RemoveTree(self.backup_workspace.clone())
            }
            Stage::MakeWorkspace => Action::Mkdir(self.staged_workspace.clone()),
            Stage::MakeUpload => Action::Mkdir(self.paths.upload.clone()),
            Stage::Archive => Action::WriteArchive(self.staged_archive.clone()),
            Stage::File(index) => Action::WriteFile {
                workspace: self.staged_workspace.clone(),
                relative: self.files[index].clone(),
                index,
            },
            Stage::StatWorkspace | Stage::RollbackStat => {
                Action::Stat(self.paths.workspace.clone())
            }
            Stage::Backup => Action::Rename {
                source: self.paths.workspace.clone(),
                target: self.backup_workspace.clone(),
            },
            Stage::PromoteWorkspace => Action::Rename {
                source: self.staged_workspace.clone(),
                target: self.paths.workspace.clone(),
            },
            Stage::PromoteArchive => Action::Rename {
                source: self.staged_archive.clone(),
                target: self.paths.archive.clone(),
            },
            Stage::Restore => Action::Rename {
                source: self.backup_workspace.clone(),
                target: self.paths.workspace.clone(),
            },
            Stage::RollbackArchive => Action::RemoveFile(self.staged_archive.clone()),
            Stage::Done(success) => Action::Done { success },
        }
    }
    pub fn success(&self) -> bool {
        matches!(self.stage, Stage::Done(true))
    }
    /// On a failed effect, tells the host whether to retain, ignore or replace
    /// the original exception. No host exception enters the portable core.
    pub fn advance(&mut self, ok: bool, exists: bool) -> Option<Fault> {
        if matches!(self.stage, Stage::Done(_)) {
            return None;
        }
        if !ok {
            let (next, fault) = match self.stage {
                Stage::RemoveStageBefore | Stage::RemoveBackupBefore => {
                    (Stage::Done(false), Fault::Primary)
                }
                Stage::RollbackStat => (Stage::Done(false), Fault::Replace),
                Stage::Restore => (Stage::CleanupWorkspace, Fault::Ignore),
                Stage::CleanupWorkspace => (Stage::RollbackArchive, Fault::Ignore),
                Stage::RollbackArchive => (Stage::Done(false), Fault::Ignore),
                _ => (Stage::RollbackStat, Fault::Primary),
            };
            self.stage = next;
            return Some(fault);
        }
        self.stage = match self.stage {
            Stage::RemoveStageBefore => Stage::RemoveBackupBefore,
            Stage::RemoveBackupBefore => Stage::MakeWorkspace,
            Stage::MakeWorkspace => Stage::MakeUpload,
            Stage::MakeUpload => Stage::Archive,
            Stage::Archive => {
                if self.files.is_empty() {
                    Stage::StatWorkspace
                } else {
                    Stage::File(0)
                }
            }
            Stage::File(index) => {
                if index + 1 < self.files.len() {
                    Stage::File(index + 1)
                } else {
                    Stage::StatWorkspace
                }
            }
            Stage::StatWorkspace => {
                self.had_workspace = exists;
                if exists {
                    Stage::Backup
                } else {
                    Stage::PromoteWorkspace
                }
            }
            Stage::Backup => Stage::PromoteWorkspace,
            Stage::PromoteWorkspace => Stage::PromoteArchive,
            Stage::PromoteArchive => Stage::RemoveBackupAfter,
            Stage::RemoveBackupAfter => Stage::Done(true),
            Stage::RollbackStat => {
                if !exists && self.had_workspace {
                    Stage::Restore
                } else {
                    Stage::CleanupWorkspace
                }
            }
            Stage::Restore => Stage::CleanupWorkspace,
            Stage::CleanupWorkspace => Stage::RollbackArchive,
            Stage::RollbackArchive => Stage::Done(false),
            Stage::Done(value) => Stage::Done(value),
        };
        None
    }
}
