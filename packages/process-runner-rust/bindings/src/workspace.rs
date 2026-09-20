use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::{workspace_ignore, workspace_state};
#[napi]
pub fn workspace_max_bytes(mb: f64) -> Result<f64> {
    workspace_state::max_bytes(mb).map_err(Error::from_reason)
}
#[napi(object)]
pub struct IgnoreSource {
    pub base: Utf16String,
    pub text: Utf16String,
}
#[napi]
pub struct WorkspaceIgnore {
    rules: workspace_ignore::Rules,
}
#[napi]
impl WorkspaceIgnore {
    #[napi(constructor)]
    pub fn new(git: Vec<IgnoreSource>, poe: Utf16String, exclude: Vec<Utf16String>) -> Self {
        Self {
            rules: workspace_ignore::Rules::new(
                &git.into_iter()
                    .map(|source| workspace_ignore::Source {
                        base: source.base.to_vec(),
                        text: source.text.to_vec(),
                    })
                    .collect::<Vec<_>>(),
                &poe,
                &exclude
                    .into_iter()
                    .map(|text| text.to_vec())
                    .collect::<Vec<_>>(),
            ),
        }
    }
    #[napi]
    pub fn ignores(&self, path: Utf16String) -> bool {
        self.rules.ignores(&path)
    }
}
#[napi(object)]
pub struct Admission {
    pub uploaded: bool,
    pub warning: Option<Utf16String>,
}
#[napi]
#[derive(Default)]
pub struct WorkspaceState {
    state: workspace_state::State,
}
#[napi]
impl WorkspaceState {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: workspace_state::State::default(),
        }
    }
    #[napi]
    pub fn admit(&mut self, path: Utf16String, bytes: BufferSlice<'_>, max: f64) -> Admission {
        let uploaded = self.state.admit(&path, &bytes, max);
        Admission {
            uploaded,
            warning: if uploaded {
                None
            } else {
                Some(workspace_state::warning(&path, bytes.len()).into())
            },
        }
    }
    #[napi]
    pub fn conflict(
        &self,
        path: Utf16String,
        remote: BufferSlice<'_>,
        local: Option<BufferSlice<'_>>,
    ) -> bool {
        self.state.conflict(&path, &remote, local.as_deref())
    }
    #[napi]
    pub fn same(&self, path: Utf16String, content: BufferSlice<'_>) -> bool {
        self.state.same(&path, &content)
    }
    #[napi]
    pub fn deletions(&self, remote: Vec<Utf16String>) -> Vec<Utf16String> {
        self.state
            .deletions(
                &remote
                    .into_iter()
                    .map(|path| path.to_vec())
                    .collect::<Vec<_>>(),
            )
            .into_iter()
            .map(Into::into)
            .collect()
    }
}
