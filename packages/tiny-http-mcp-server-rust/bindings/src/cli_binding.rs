use super::{convert::NativeJson, parse};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
use tiny_http_mcp_server_rust::cli::{self, Shutdown, SignalAction};
#[napi]
pub fn http_cli_spec() -> NativeJson {
    NativeJson(cli::spec())
}
#[napi]
pub fn http_cli_numbers(values: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(
        cli::numeric_plan(&parse(&values)?).map_err(napi::Error::from_reason)?,
    ))
}
#[napi]
pub fn http_cli_oauth(values: Utf16String) -> Result<Option<NativeJson>> {
    cli::oauth_plan(&parse(&values)?)
        .map(|value| value.map(NativeJson))
        .map_err(napi::Error::from_reason)
}
#[napi]
pub fn http_cli_help(command: Utf16String) -> Utf16String {
    cli::help(&command).into()
}
#[napi]
pub fn http_verifier_module_kind(path: Utf16String) -> &'static str {
    cli::module_kind(&path)
}
#[napi]
#[derive(Default)]
pub struct NativeHttpCliShutdown {
    state: RefCell<Shutdown>,
}
#[napi]
impl NativeHttpCliShutdown {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: RefCell::new(Shutdown::default()),
        }
    }
    #[napi]
    pub fn signal(&self) -> &'static str {
        match self.state.borrow_mut().signal() {
            SignalAction::Start => "start",
            SignalAction::Force => "force",
            SignalAction::Ignore => "ignore",
        }
    }
    #[napi]
    pub fn settle(&self) -> bool {
        self.state.borrow_mut().settle()
    }
    #[napi(getter)]
    pub fn settled(&self) -> bool {
        self.state.borrow().is_settled()
    }
}
