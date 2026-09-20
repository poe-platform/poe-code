use mcp_protocol_rust::json::{self, Limits};
use mcp_protocol_rust::jsonrpc::{self, ParsedMessage};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

mod convert;
use convert::NativeJson;

pub struct NativeParsed(ParsedMessage);

impl ToNapiValue for NativeParsed {
    unsafe fn to_napi_value(env: sys::napi_env, parsed: Self) -> Result<sys::napi_value> {
        let environment = Env::from_raw(env);
        let mut object = Object::new(&environment)?;
        match parsed.0 {
            ParsedMessage::Request(request) => {
                let mut payload = Object::new(&environment)?;
                payload.set("jsonrpc", "2.0")?;
                let notification = request.id.is_none();
                if let Some(id) = request.id {
                    payload.set("id", NativeJson(id.into_value()))?;
                }
                payload.set("method", Utf16String::from(request.method))?;
                match request.params {
                    Some(params) => payload.set("params", NativeJson(params))?,
                    None => payload.set("params", ())?,
                }
                object.set("success", true)?;
                object.set("isNotification", notification)?;
                object.set("request", payload)?;
            }
            ParsedMessage::Error { id, error } => {
                let mut payload = Object::new(&environment)?;
                payload.set("code", error.code)?;
                payload.set("message", error.message)?;
                if let Some(data) = error.data {
                    payload.set("data", NativeJson(data))?;
                }
                object.set("success", false)?;
                object.set("error", payload)?;
                object.set("id", NativeJson(id.into_value()))?;
            }
        }
        unsafe { Object::to_napi_value(env, object) }
    }
}

#[napi(object)]
pub struct ParseLimits {
    pub max_bytes: Option<f64>,
    pub max_depth: Option<f64>,
    pub max_nodes: Option<f64>,
}

impl ParseLimits {
    fn resolve(options: Option<Self>) -> Result<Limits, String> {
        let mut limits = Limits::default();
        if let Some(options) = options {
            for (input, target) in [
                (options.max_bytes, &mut limits.max_bytes),
                (options.max_depth, &mut limits.max_depth),
                (options.max_nodes, &mut limits.max_nodes),
            ] {
                if let Some(value) = input {
                    if !value.is_finite()
                        || value.fract() != 0.0
                        || !(0.0..=u32::MAX as f64).contains(&value)
                    {
                        return Err(Error::new(
                            "InvalidLimits".into(),
                            "Limits must be nonnegative integers no greater than 4294967295",
                        ));
                    }
                    *target = value as usize;
                }
            }
        }
        Ok(limits)
    }
}

#[napi(ts_return_type = "unknown")]
pub fn parse_json(input: Utf16String, limits: Option<ParseLimits>) -> Result<NativeJson, String> {
    json::parse_utf16(&input, ParseLimits::resolve(limits)?)
        .map(NativeJson)
        .map_err(|error| Error::new(format!("{:?}", error.kind), error.to_string()))
}

#[napi(ts_return_type = "unknown")]
pub fn parse_json_utf8(input: Buffer, limits: Option<ParseLimits>) -> Result<NativeJson, String> {
    json::parse(&input, ParseLimits::resolve(limits)?)
        .map(NativeJson)
        .map_err(|error| Error::new(format!("{:?}", error.kind), error.to_string()))
}

#[napi]
pub fn canonicalize_json(
    input: Utf16String,
    limits: Option<ParseLimits>,
) -> Result<String, String> {
    json::parse_utf16(&input, ParseLimits::resolve(limits)?)
        .map(|value| json::stringify(&value))
        .map_err(|error| Error::new(format!("{:?}", error.kind), error.to_string()))
}

#[napi(ts_return_type = "ParseResult | ParseError")]
pub fn parse_message(
    input: Utf16String,
    limits: Option<ParseLimits>,
) -> Result<NativeParsed, String> {
    Ok(NativeParsed(jsonrpc::parse_message_utf16(
        &input,
        ParseLimits::resolve(limits)?,
    )))
}

#[napi(ts_return_type = "ParseResult | ParseError")]
pub fn parse_message_utf8(
    input: Buffer,
    limits: Option<ParseLimits>,
) -> Result<NativeParsed, String> {
    Ok(NativeParsed(jsonrpc::parse_message(
        &input,
        ParseLimits::resolve(limits)?,
    )))
}
