use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::tar::{self, Entry};
#[napi(object)]
pub struct TarInput {
    pub path: Utf16String,
    pub bytes: Buffer,
}
#[napi(object)]
pub struct TarReply {
    pub bytes: Option<Buffer>,
    pub error: Option<Utf16String>,
}
#[napi]
pub fn workspace_tar(env: Env, inputs: Vec<TarInput>) -> Result<TarReply> {
    let entries = inputs
        .iter()
        .map(|input| Entry {
            path: &input.path,
            content: &input.bytes,
        })
        .collect::<Vec<_>>();
    Ok(match tar::create(&entries) {
        Ok(bytes) => TarReply {
            bytes: Some(BufferSlice::copy_from(&env, &bytes)?.into_buffer(&env)?),
            error: None,
        },
        Err(error) => TarReply {
            bytes: None,
            error: Some(error.into()),
        },
    })
}
