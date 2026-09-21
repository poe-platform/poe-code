use mcp_protocol_rust::json;
use napi::{Task, bindgen_prelude::*};
use napi_derive::napi;
#[path = "../../../tiny-stdio-mcp-server-rust/bindings/src/lib.rs"]
pub mod embedded_stdio;
use convert::NativeJson;
pub(crate) use embedded_stdio::convert;
#[napi]
pub fn terminal_png_tool_definition() -> NativeJson {
    NativeJson(terminal_png_mcp_rust::definition())
}
pub struct RenderTask {
    arguments: json::Value,
}
impl Task for RenderTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        terminal_png_mcp_rust::render(&self.arguments).map_err(Error::from_reason)
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Buffer> {
        Ok(output.into())
    }
}
#[napi]
pub fn render_terminal_mcp_png(arguments: Utf16String) -> Result<AsyncTask<RenderTask>> {
    let arguments = json::parse_utf16(&arguments, Default::default())
        .map_err(|_| Error::from_reason("Invalid terminal render arguments"))?;
    Ok(AsyncTask::new(RenderTask { arguments }))
}
#[napi]
pub fn terminal_png_mcp_cli(args: Vec<String>) -> Result<bool> {
    terminal_png_mcp_rust::cli(&args).map_err(Error::from_reason)
}
#[napi]
pub fn terminal_png_mcp_help() -> &'static str {
    terminal_png_mcp_rust::HELP
}
