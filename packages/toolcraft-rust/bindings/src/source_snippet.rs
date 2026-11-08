use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_rust::source_snippet::{self, SourceSnippetHost};

struct Host<'env>(Object<'env>);

impl SourceSnippetHost for Host<'_> {
    type Error = napi::Error;

    fn lines(&mut self) -> Result<Vec<Vec<u16>>> {
        let function: Function<(), Vec<Utf16String>> = self.0.get_named_property("lines")?;
        Ok(function
            .call(())?
            .into_iter()
            .map(|line| line.to_vec())
            .collect())
    }
    fn line(&mut self) -> Result<f64> {
        let function: Function<(), f64> = self.0.get_named_property("line")?;
        function.call(())
    }
    fn context(&mut self) -> Result<f64> {
        let function: Function<(), f64> = self.0.get_named_property("context")?;
        function.call(())
    }
    fn header(&mut self, line: usize) -> Result<Option<Vec<u16>>> {
        let function: Function<f64, Option<Utf16String>> = self.0.get_named_property("header")?;
        Ok(function.call(line as f64)?.map(|value| value.to_vec()))
    }
    fn muted(&mut self, value: Vec<u16>) -> Result<Vec<u16>> {
        let function: Function<Utf16String, Utf16String> = self.0.get_named_property("muted")?;
        Ok(function.call(value.into())?.to_vec())
    }
    fn caret(&mut self, width: usize) -> Result<Option<Vec<u16>>> {
        let function: Function<f64, Option<Utf16String>> = self.0.get_named_property("caret")?;
        Ok(function.call(width as f64)?.map(|value| value.to_vec()))
    }
}

#[napi]
pub fn render_source_snippet(host: Object<'_>) -> Result<Utf16String> {
    source_snippet::render_source_snippet(&mut Host(host)).map(Into::into)
}
