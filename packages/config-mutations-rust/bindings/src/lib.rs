use config_mutations_rust::jsonc::{self, PathSegment};
use mcp_protocol_rust::json::{self as json, Limits, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn input(source: &[u16]) -> Result<Value> {
    json::parse_utf16(
        source,
        Limits {
            max_bytes: usize::MAX,
            max_nodes: usize::MAX,
            max_depth: 512,
        },
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}
#[napi]
pub fn config_json_parse(source: Utf16String) -> Result<NativeJson> {
    jsonc::parse_object(&source)
        .map(NativeJson)
        .map_err(|e| Error::from_reason(e.to_string()))
}
#[napi]
pub fn config_json_indent(source: Utf16String) -> Utf16String {
    jsonc::detect_indent(&source).into()
}
#[napi]
pub fn config_json_serialize(serialized: Utf16String) -> Result<Utf16String> {
    Ok(jsonc::serialize(&input(&serialized)?).into())
}
#[napi]
pub struct ConfigJsonEdit {
    plan: Option<jsonc::EditPlan>,
}
#[napi]
impl ConfigJsonEdit {
    #[napi(getter)]
    pub fn wrappers(&self) -> Result<NativeJson> {
        Ok(NativeJson(Value::Array(
            self.plan
                .as_ref()
                .ok_or_else(|| Error::from_reason("JSON edit already consumed"))?
                .wrappers()
                .iter()
                .map(|segment| match segment {
                    PathSegment::Key(key) => Value::String(key.clone()),
                    PathSegment::Index(index) => Value::Number(*index as f64),
                })
                .collect(),
        )))
    }
    #[napi(getter)]
    pub fn replaces_value(&self) -> Result<bool> {
        Ok(self
            .plan
            .as_ref()
            .ok_or_else(|| Error::from_reason("JSON edit already consumed"))?
            .replaces_value())
    }
    #[napi]
    pub fn apply(&mut self, serialized: Option<Utf16String>) -> Result<Utf16String> {
        Ok(self
            .plan
            .take()
            .ok_or_else(|| Error::from_reason("JSON edit already consumed"))?
            .apply_serialized(serialized.as_ref().map(|s| s.as_ref()))
            .into())
    }
    #[napi]
    pub fn discard(&mut self) {
        self.plan = None;
    }
}
#[napi]
pub fn config_json_plan(
    source: Utf16String,
    path: Vec<Either<Utf16String, f64>>,
    has_value: bool,
) -> Result<ConfigJsonEdit> {
    let path: Vec<_> = path
        .into_iter()
        .map(|part| match part {
            Either::A(key) => Ok(PathSegment::Key(key.to_vec())),
            Either::B(index)
                if index.is_finite()
                    && index.fract() == 0.0
                    && index >= i64::MIN as f64
                    && index < (i64::MAX as f64) =>
            {
                Ok(PathSegment::Index(index as i64))
            }
            _ => Err(Error::from_reason(
                "Expected string or integer JSON path segment",
            )),
        })
        .collect::<Result<_>>()?;
    jsonc::plan(source.to_vec(), &path, has_value)
        .map(|plan| ConfigJsonEdit { plan: Some(plan) })
        .map_err(|e| Error::from_reason(e.to_string()))
}
