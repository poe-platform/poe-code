use super::NativeJson;
use napi::{Error, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use tiny_stdio_mcp_server_rust::media;

#[napi]
pub struct NativeRemoteBytes {
    bytes: media::RemoteBytes,
}

#[napi]
impl NativeRemoteBytes {
    #[napi(constructor)]
    pub fn new(max_bytes: Unknown<'_>) -> Result<Self> {
        let max_bytes: f64 = if max_bytes.get_type()? == ValueType::Number {
            unsafe { max_bytes.cast()? }
        } else {
            return Err(Error::from_reason("maxBytes must be a positive integer"));
        };
        if !max_bytes.is_finite()
            || max_bytes.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&max_bytes)
        {
            return Err(Error::from_reason("maxBytes must be a positive integer"));
        }
        Ok(Self {
            bytes: media::RemoteBytes::new(max_bytes as usize),
        })
    }
    #[napi]
    pub fn push(&mut self, bytes: Uint8Array) -> Result<bool> {
        self.bytes.append(&bytes).map_err(Error::from_reason)
    }
    #[napi]
    pub fn finish(&mut self) -> Uint8Array {
        Uint8Array::new(self.bytes.take())
    }
}

#[napi(ts_return_type = "{ mimeType?: string; charset?: string }")]
pub fn parse_media_content_type(value: String) -> NativeJson {
    NativeJson(media::parse_content_type(&value))
}

#[napi]
pub fn supported_media_mime(kind: String, mime: String) -> bool {
    media::supported_mime(&kind, &mime)
}

#[napi]
pub fn is_text_media_mime(mime: String) -> bool {
    media::is_text_mime(&mime)
}

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
