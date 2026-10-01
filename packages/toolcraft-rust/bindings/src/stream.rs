use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::stream::{Host, ManagedStream, Phase};

struct NodeHost<'env>(Object<'env>);
impl<'env> Host for NodeHost<'env> {
    type Value = Unknown<'env>;
    type Error = napi::Error;
    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value> {
        let operation: Function<FnArgs<(String, Vec<Unknown>)>, Unknown> =
            self.0.get_named_property("operate")?;
        operation.call((name.to_owned(), args).into())
    }
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value> {
        let get: Function<FnArgs<(Unknown, String)>, Unknown> = self.0.get_named_property("get")?;
        get.call((value, key.to_owned()).into())
    }
    fn is_undefined(&self, value: Self::Value) -> Result<bool> {
        Ok(value.get_type()? == ValueType::Undefined)
    }
    fn is_true(&self, value: Self::Value) -> Result<bool> {
        if value.get_type()? != ValueType::Boolean {
            return Ok(false);
        }
        unsafe { value.cast::<bool>() }
    }
}

#[napi(object)]
pub struct StreamAction<'env> {
    pub kind: String,
    pub value: Unknown<'env>,
    pub saved: Unknown<'env>,
    pub next: u32,
    pub failure: u32,
}

#[napi]
#[derive(Default)]
pub struct NativeManagedStream {
    state: ManagedStream,
}

fn phase(index: u32) -> Result<Phase> {
    Phase::from_index(index).ok_or_else(|| napi::Error::from_reason("Invalid stream continuation"))
}

#[napi]
impl NativeManagedStream {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: ManagedStream::default(),
        }
    }
    #[napi]
    pub fn initialize(&self, host: Object<'_>) -> Result<()> {
        self.state.initialize(&mut NodeHost(host))
    }
    #[napi]
    pub fn close<'env>(&self, reason: Unknown<'env>, host: Object<'env>) -> Result<Unknown<'env>> {
        self.state.close(&mut NodeHost(host), reason)
    }
    #[napi]
    pub fn advance<'env>(
        &self,
        current: u32,
        input: Unknown<'env>,
        saved: Unknown<'env>,
        host: Object<'env>,
    ) -> Result<StreamAction<'env>> {
        let action = self
            .state
            .advance(&mut NodeHost(host), phase(current)?, input, saved)?;
        Ok(StreamAction {
            kind: action.kind.into(),
            value: action.value,
            saved: action.saved,
            next: action.next as u32,
            failure: action.failure as u32,
        })
    }
}

#[napi]
pub fn stream_catch_phase(current: u32) -> Result<u32> {
    Ok(phase(current)?.catch() as u32)
}
