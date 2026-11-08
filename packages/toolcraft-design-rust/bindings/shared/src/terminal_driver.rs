use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::terminal_driver::{self, TerminalDriver};
#[napi]
pub struct NativeTerminalDriver {
    inner: TerminalDriver,
}
#[napi]
impl NativeTerminalDriver {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: TerminalDriver::default(),
        }
    }
    #[napi]
    pub fn start(&mut self) -> bool {
        self.inner.start()
    }
    #[napi]
    pub fn stop(&mut self) -> bool {
        self.inner.stop()
    }
}
impl Default for NativeTerminalDriver {
    fn default() -> Self {
        Self::new()
    }
}
#[napi]
pub fn design_terminal_dimension(value: Unknown<'_>) -> Result<f64> {
    Ok(if value.get_type()? == ValueType::Number {
        terminal_driver::dimension(unsafe { value.cast()? })
    } else {
        0.
    })
}
