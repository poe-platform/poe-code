use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::tool_results::Probe;
#[napi]
pub fn probe_tool_result_part(env: Env, value: Object<'_>) -> Result<bool> {
    poe_agent_rust::tool_results::valid_part(|probe| {
        let (key, expected, literal) = match probe {
            Probe::TypeString => (c"type", napi::ValueType::String, None),
            Probe::Text => (c"type", napi::ValueType::String, Some("text")),
            Probe::TextString => (c"text", napi::ValueType::String, None),
            Probe::Image => (c"type", napi::ValueType::String, Some("image")),
            Probe::MimeString => (c"mimeType", napi::ValueType::String, None),
            Probe::DataString => (c"data", napi::ValueType::String, None),
            Probe::Error => (c"type", napi::ValueType::String, Some("error")),
            Probe::CodeString => (c"code", napi::ValueType::String, None),
            Probe::MessageString => (c"message", napi::ValueType::String, None),
            Probe::RetriableBoolean => (c"retriable", napi::ValueType::Boolean, None),
        };
        let property: Unknown<'_> = value.get_c_named_property_unchecked(key)?;
        if property.get_type()? != expected {
            return Ok(false);
        }
        if let Some(literal) = literal {
            env.strict_equals(property, env.create_string(literal)?)
        } else {
            Ok(true)
        }
    })
}
#[napi]
pub fn tool_result_image_text(mime: Utf16String) -> Utf16String {
    poe_agent_rust::tool_results::image_text(&mime).into()
}
