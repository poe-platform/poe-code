use mcp_protocol_rust::jsonrpc::Id;
use napi::{ValueType, bindgen_prelude::*};

#[path = "../../../mcp-protocol-rust/bindings/src/json_input.rs"]
mod json_input;
pub use json_input::{Mode, read};

pub fn read_id(source: Unknown<'_>) -> Result<Option<Id>> {
    Ok(match source.get_type()? {
        ValueType::Undefined => None,
        ValueType::String => Some(Id::String(
            unsafe { source.cast::<Utf16String>()? }.to_vec(),
        )),
        ValueType::Number => Some(Id::Number(unsafe { source.cast()? })),
        _ => Some(Id::Null),
    })
}
