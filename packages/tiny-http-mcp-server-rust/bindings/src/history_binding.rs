use super::convert::NativeJson;
use mcp_protocol_rust::json::Value;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::{cell::RefCell, sync::Arc};
use tiny_http_mcp_server_rust::history::History;
struct State {
    history: History,
    next: u64,
}
#[napi]
pub struct NativeHttpEventHistory {
    state: RefCell<State>,
    max_bytes: f64,
}
#[napi]
impl NativeHttpEventHistory {
    #[napi(constructor)]
    pub fn new(limit: f64, max_bytes: f64) -> Self {
        Self {
            state: RefCell::new(State {
                history: History::new(limit as usize),
                next: 1,
            }),
            max_bytes,
        }
    }
    #[napi]
    pub fn record(&self, session: Utf16String, data: Utf16String) -> Result<NativeJson> {
        let mut state = self.state.borrow_mut();
        let id = state.next;
        state.next = state
            .next
            .checked_add(1)
            .ok_or_else(|| napi::Error::from_reason("SSE event sequence exhausted"))?;
        let id = id.to_string().encode_utf16().collect::<Vec<_>>();
        let frame = tiny_http_mcp_server_rust::sse::format_event(&data, Some(&id), None);
        let bytes: usize = char::decode_utf16(frame.iter().copied())
            .map(|c| c.map_or(3, |c| c.len_utf8()))
            .sum();
        if bytes as f64 > self.max_bytes {
            return Ok(NativeJson(Value::Object(vec![(
                "destroy".encode_utf16().collect(),
                Value::Bool(true),
            )])));
        }
        let next = state.next - 1;
        state
            .history
            .record(session.to_vec(), next, Arc::new(data.to_vec()));
        Ok(NativeJson(Value::Object(vec![(
            "frame".encode_utf16().collect(),
            Value::String(frame),
        )])))
    }
    #[napi]
    pub fn replay(&self, session: Utf16String, last: f64) -> Vec<Utf16String> {
        if !last.is_finite() || last.fract() != 0.0 || last.abs() > 9_007_199_254_740_991.0 {
            return vec![];
        }
        let state = self.state.borrow();
        state
            .history
            .replay(&session, if last < 0.0 { 0 } else { last as u64 })
            .iter()
            .map(|event| {
                tiny_http_mcp_server_rust::sse::format_event(
                    &event.data,
                    Some(&event.id.to_string().encode_utf16().collect::<Vec<_>>()),
                    None,
                )
                .into()
            })
            .collect()
    }
    #[napi]
    pub fn remove(&self, session: Utf16String) {
        self.state.borrow_mut().history.remove(&session);
    }
    #[napi]
    pub fn clear(&self) {
        self.state.borrow_mut().history.clear();
    }
}
