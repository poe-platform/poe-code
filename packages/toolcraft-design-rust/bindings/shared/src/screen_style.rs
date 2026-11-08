use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::screen_style::{self, Host};

#[napi]
pub fn design_pack_style(
    bold: bool,
    dim: bool,
    underline: bool,
    inverse: bool,
    fg: i32,
    bg: i32,
) -> i32 {
    screen_style::pack([bold, dim, underline, inverse], fg, bg)
}
#[napi]
pub fn design_style_channel(style: i32, background: bool) -> i32 {
    screen_style::channel(style, background)
}
#[napi]
pub fn design_style_codes(previous: i32, next: i32) -> Vec<i32> {
    screen_style::codes(previous, next)
}

#[napi(object)]
pub struct StyleReply {
    pub value: i32,
    pub failed: bool,
}
type Callback<'a> = Function<'a, FnArgs<(u32, i32)>, StyleReply>;
struct StyleHost<'a> {
    callback: Callback<'a>,
}
impl StyleHost<'_> {
    fn call(&self, operation: u32, code: i32) -> Result<i32> {
        let reply = self.callback.call(FnArgs::from((operation, code)))?;
        if reply.failed {
            return Err(Error::from_reason("Screen style host failed"));
        }
        Ok(reply.value)
    }
}
impl Host for StyleHost<'_> {
    type Error = Error;
    fn operand(&mut self, next: bool) -> Result<i32> {
        self.call(u32::from(next), 0)
    }
    fn code(&mut self, code: i32) -> Result<()> {
        self.call(2, code)?;
        Ok(())
    }
}
#[napi]
pub fn design_style_emit(callback: Callback<'_>) -> Result<()> {
    screen_style::emit(&mut StyleHost { callback })
}
