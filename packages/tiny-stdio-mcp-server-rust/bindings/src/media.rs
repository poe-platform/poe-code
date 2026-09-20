use super::NativeJson;
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
use tiny_stdio_mcp_server_rust::media;

#[napi(object)]
pub struct FileType {
    pub mime: String,
    pub ext: String,
}

#[napi(ts_return_type = "FileType | undefined")]
pub fn file_type_from_buffer(data: Uint8Array) -> Either<FileType, ()> {
    match media::file_type(&data) {
        Some(detected) => Either::A(FileType {
            mime: detected.mime.into(),
            ext: detected.ext.into(),
        }),
        None => Either::B(()),
    }
}

#[napi(ts_return_type = "unknown")]
pub fn media_bytes(kind: String, data: Uint8Array, format: Option<String>) -> Result<NativeJson> {
    media::binary_bytes(&kind, &data, format.as_deref())
        .map(NativeJson)
        .map_err(Error::from_reason)
}

#[napi(ts_return_type = "unknown")]
pub fn media_base64(kind: String, data: Utf16String, mime: String) -> Result<NativeJson> {
    media::binary_base64(&kind, &data, &mime)
        .map(NativeJson)
        .map_err(Error::from_reason)
}

#[napi]
pub fn decode_media_base64(data: Utf16String) -> Result<Uint8Array> {
    media::decode_base64(&data)
        .map(Uint8Array::new)
        .map_err(Error::from_reason)
}

#[napi(ts_return_type = "unknown")]
pub fn file_bytes(
    data: Uint8Array,
    mime: Utf16String,
    name: Option<Utf16String>,
    force_binary: Option<bool>,
) -> NativeJson {
    NativeJson(media::file_bytes(
        &data,
        &mime,
        name.as_ref().map(|name| name.as_ref()),
        force_binary == Some(true),
    ))
}

#[napi(ts_return_type = "unknown")]
pub fn file_text(data: Utf16String, mime: Utf16String, name: Option<Utf16String>) -> NativeJson {
    NativeJson(media::file_text(
        &data,
        &mime,
        name.as_ref().map(|name| name.as_ref()),
    ))
}
