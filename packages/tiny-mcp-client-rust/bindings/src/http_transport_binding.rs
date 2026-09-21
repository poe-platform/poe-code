use crate::{NativeHttpResponseMessages, convert::NativeJson};
#[path = "header_schema.rs"]
mod header_schema;
use mcp_protocol_rust::json::Value;
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use std::cell::RefCell;
use tiny_mcp_client_rust::http_transport::{HttpState, Post, ResponseKind, response_kind};

fn changes(values: Vec<(String, Option<Vec<u16>>)>) -> NativeJson {
    NativeJson(Value::Array(
        values
            .into_iter()
            .map(|(name, value)| {
                Value::Array(vec![
                    Value::String(name.encode_utf16().collect()),
                    value.map(Value::String).unwrap_or(Value::Null),
                ])
            })
            .collect(),
    ))
}
#[napi]
pub struct NativeHttpPost {
    post: Post,
}
#[napi]
impl NativeHttpPost {
    #[napi(getter)]
    pub fn modern(&self) -> bool {
        self.post.modern
    }
    #[napi(getter)]
    pub fn ordered(&self) -> bool {
        self.post.ordered
    }
    #[napi(getter)]
    pub fn initializing(&self) -> bool {
        self.post.ordered
            && self
                .post
                .message
                .as_ref()
                .is_some_and(|message| message.get("id").is_some())
    }
    #[napi(getter)]
    pub fn slot(&self) -> Option<f64> {
        self.post.slot.map(|slot| slot as f64)
    }
    #[napi(getter)]
    pub fn cancelled(&self) -> bool {
        self.post.cancelled
    }
    #[napi(getter)]
    pub fn cancel_slot(&self) -> Option<f64> {
        self.post.cancel_slot.map(|slot| slot as f64)
    }
    #[napi(getter)]
    pub fn has_session(&self) -> bool {
        self.post.has_session
    }
    #[napi]
    pub fn response_context(&self) -> Option<NativeHttpResponseMessages> {
        self.post
            .response_context()
            .map(|context| NativeHttpResponseMessages {
                state: RefCell::new(context),
            })
    }
    #[napi]
    pub fn error_line(&self, status: u16, body: Utf16String) -> Option<Utf16String> {
        self.post.error_line(status, &body).map(Utf16String::from)
    }
}
#[napi]
pub struct NativeHttpTransport {
    state: RefCell<HttpState>,
    limit: f64,
}
#[napi]
impl NativeHttpTransport {
    #[napi(constructor)]
    pub fn new(limit: Unknown<'_>) -> Result<Self> {
        let number = if limit.get_type()? == ValueType::Number {
            unsafe { limit.cast::<f64>()? }
        } else {
            f64::NAN
        };
        if !number.is_finite()
            || number.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&number)
        {
            return Err(napi::Error::from_reason(
                "HTTP response byte limit must be a positive safe integer",
            ));
        }
        Ok(Self {
            state: RefCell::new(HttpState::default()),
            limit: number,
        })
    }
    #[napi(getter)]
    pub fn max_response_bytes(&self) -> f64 {
        self.limit
    }
    #[napi(getter)]
    pub fn disposed(&self) -> bool {
        self.state.borrow().disposed()
    }
    #[napi(getter)]
    pub fn active_count(&self) -> f64 {
        self.state.borrow().active_count() as f64
    }
    #[napi]
    pub fn prepare(&self, line: Utf16String) -> Result<NativeHttpPost> {
        self.state
            .borrow_mut()
            .prepare(&line)
            .map(|post| NativeHttpPost { post })
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn finish(&self, post: &NativeHttpPost) {
        self.state.borrow_mut().finish(&post.post);
    }
    #[napi]
    pub fn clear_tools(&self) {
        self.state.borrow_mut().clear_tools();
    }
    #[napi]
    pub fn filter_tool(&self, env: Env, name: Utf16String, schema: Unknown<'_>) -> Result<()> {
        let result = header_schema::read(&env, schema);
        match result {
            Ok(schema) => self
                .state
                .borrow_mut()
                .filter_tool(name.to_vec(), &schema)
                .map_err(napi::Error::from_reason),
            Err(error) => {
                self.state.borrow_mut().reject_tool(&name);
                Err(error)
            }
        }
    }
    #[napi]
    pub fn post_headers(&self, post: &NativeHttpPost) -> Result<NativeJson> {
        self.state
            .borrow()
            .post_headers(&post.post)
            .map(changes)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn get_headers(&self) -> NativeJson {
        changes(
            self.state
                .borrow()
                .get_headers()
                .into_iter()
                .map(|(name, value)| (name, Some(value)))
                .collect(),
        )
    }
    #[napi]
    pub fn capture_session(&self, session: Option<Utf16String>) -> Result<()> {
        self.state
            .borrow_mut()
            .capture_session(session.as_ref().map(|value| value.as_ref()))
            .map_err(napi::Error::from_reason)
    }
    #[napi(getter)]
    pub fn legacy_version(&self) -> Utf16String {
        self.state.borrow().legacy_version().into()
    }
    #[napi]
    pub fn set_legacy_version(&self, version: Utf16String) {
        self.state.borrow_mut().set_legacy_version(version.to_vec());
    }
    #[napi]
    pub fn capture_initialization(&self, line: Utf16String) -> bool {
        self.state.borrow_mut().capture_initialization(&line)
    }
    #[napi]
    pub fn expire_session(&self) {
        self.state.borrow_mut().expire_session();
    }
    #[napi]
    pub fn begin_get(&self) -> bool {
        self.state.borrow_mut().begin_get()
    }
    #[napi]
    pub fn finish_get(&self) -> bool {
        self.state.borrow_mut().finish_get()
    }
    #[napi]
    pub fn set_event_id(&self, cursor: Option<Utf16String>) {
        self.state
            .borrow_mut()
            .set_event_id(cursor.map(|value| value.to_vec()));
    }
    #[napi]
    pub fn dispose(&self) -> NativeJson {
        let disposal = self.state.borrow_mut().dispose();
        NativeJson(
            disposal
                .map(|disposal| {
                    Value::Object(vec![
                        (
                            "session".encode_utf16().collect(),
                            disposal.session.map(Value::String).unwrap_or(Value::Null),
                        ),
                        (
                            "slots".encode_utf16().collect(),
                            Value::Array(
                                disposal
                                    .slots
                                    .into_iter()
                                    .map(|slot| Value::Number(slot as f64))
                                    .collect(),
                            ),
                        ),
                    ])
                })
                .unwrap_or(Value::Null),
        )
    }
}
#[napi]
pub fn http_response_kind(status: u16, content_type: Option<String>) -> &'static str {
    match response_kind(status, content_type.as_deref()) {
        ResponseKind::Ignore => "ignore",
        ResponseKind::Json => "json",
        ResponseKind::Sse => "sse",
        ResponseKind::Unsupported => "unsupported",
    }
}
