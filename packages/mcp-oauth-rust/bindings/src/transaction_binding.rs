use mcp_oauth_rust::transaction::{self, Queue};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
#[napi]
pub fn transaction_timeout(value: f64) -> Result<u32> {
    transaction::timeout(value).map_err(napi::Error::from_reason)
}
#[napi]
#[derive(Default)]
pub struct NativeTransactionQueue {
    state: RefCell<Queue>,
}
#[napi]
impl NativeTransactionQueue {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn enqueue(&self, resource: Utf16String) -> Result<Vec<u32>> {
        let ticket = self
            .state
            .borrow_mut()
            .enqueue(&resource)
            .map_err(napi::Error::from_reason)?;
        Ok(vec![ticket.id, ticket.previous.unwrap_or(0)])
    }
    #[napi]
    pub fn retire(&self, resource: Utf16String, id: u32) -> bool {
        self.state.borrow_mut().retire(&resource, id)
    }
    #[napi]
    pub fn resources(&self) -> u32 {
        self.state.borrow().resources() as u32
    }
}
