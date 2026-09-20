//! Rust retains slot identities; host references stay visible to the JavaScript GC.
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
use tiny_http_mcp_server_rust::session::SessionTable;
struct State {
    table: SessionTable<u64>,
    next_slot: u64,
}
#[napi]
pub struct NativeHttpSessionStore {
    state: RefCell<State>,
}
#[napi(object)]
pub struct NativeHttpSessionInsertion {
    pub slot: f64,
    pub previous: Option<f64>,
}
#[napi(object)]
pub struct NativeHttpSessionEntry {
    pub sequence: BigInt,
    pub slot: f64,
}
#[napi]
impl NativeHttpSessionStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: RefCell::new(State {
                table: SessionTable::default(),
                next_slot: 0,
            }),
        }
    }
    #[napi]
    pub fn insert(&self, id: Utf16String) -> Result<NativeHttpSessionInsertion> {
        let mut state = self.state.borrow_mut();
        if state.next_slot >= 9_007_199_254_740_991 {
            return Err(napi::Error::from_reason("Session slot sequence exhausted"));
        }
        let slot = state.next_slot;
        let previous = state
            .table
            .insert(id.to_vec(), slot)
            .map_err(napi::Error::from_reason)?;
        state.next_slot += 1;
        Ok(NativeHttpSessionInsertion {
            slot: slot as f64,
            previous: previous.map(|s| s as f64),
        })
    }
    #[napi]
    pub fn get(&self, id: Utf16String) -> Option<f64> {
        self.state.borrow().table.get(&id).map(|slot| *slot as f64)
    }
    #[napi]
    pub fn delete(&self, id: Utf16String) -> Option<f64> {
        self.state
            .borrow_mut()
            .table
            .remove(&id)
            .map(|slot| slot as f64)
    }
    #[napi]
    pub fn next_after(&self, sequence: Option<BigInt>) -> Option<NativeHttpSessionEntry> {
        let sequence = sequence.map(|v| v.get_u64().1);
        let state = self.state.borrow();
        state
            .table
            .next_after(sequence)
            .map(|(sequence, slot)| NativeHttpSessionEntry {
                sequence: BigInt::from(sequence),
                slot: *slot as f64,
            })
    }
}
