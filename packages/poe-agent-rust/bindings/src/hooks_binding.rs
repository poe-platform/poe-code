use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::hooks::{self, Primitive};
#[napi]
pub fn hook_events() -> Vec<String> {
    hooks::EVENTS
        .iter()
        .map(|event| event.to_string())
        .collect()
}
#[napi]
#[derive(Default)]
pub struct NativeHookCatalog {
    state: hooks::Catalog,
}
#[napi]
impl NativeHookCatalog {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn add(&mut self, event: String, handle: u32) {
        self.state.add(&event, handle);
    }
    #[napi]
    pub fn get(&self, event: String, index: u32) -> Option<u32> {
        self.state.get(&event, index as usize)
    }
    #[napi]
    pub fn snapshot(&self) -> Vec<Vec<u32>> {
        self.state.snapshot()
    }
    #[napi]
    pub fn append(&mut self, entries: Vec<Vec<u32>>, offset: u32) -> Result<()> {
        self.state
            .append(entries, offset)
            .map_err(napi::Error::from_reason)
    }
}
#[napi]
#[derive(Default)]
pub struct NativeHookPipeline {
    state: hooks::Pipeline,
}
#[napi]
impl NativeHookPipeline {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn observe(&mut self, defined: bool) -> bool {
        self.state.observe(defined)
    }
}
#[napi]
pub struct NativeHookDecision {
    state: hooks::Plan,
}
#[napi]
impl NativeHookDecision {
    #[napi(constructor)]
    pub fn new(event: String, decision: Unknown<'_>) -> Result<Self> {
        let primitive = match decision.get_type()? {
            ValueType::Undefined => Primitive::Undefined,
            ValueType::Object => Primitive::Object,
            ValueType::String => {
                let value: Utf16String = unsafe { decision.cast()? };
                if value.iter().copied().eq("skip".encode_utf16()) {
                    Primitive::Skip
                } else if value.iter().copied().eq("abort".encode_utf16()) {
                    Primitive::Abort
                } else {
                    Primitive::Other
                }
            }
            _ => Primitive::Other,
        };
        Ok(Self {
            state: hooks::Plan::new(&event, primitive),
        })
    }
    #[napi]
    pub fn request(&self) -> String {
        self.state.request().to_owned()
    }
    #[napi]
    pub fn observe(&mut self, accepted: bool) {
        self.state.observe(accepted);
    }
}

#[napi]
#[derive(Default)]
pub struct NativeHookWarnings {
    state: hooks::Warnings,
}
#[napi]
impl NativeHookWarnings {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn mark(&mut self, event: String) -> bool {
        self.state.mark(&event)
    }
}
