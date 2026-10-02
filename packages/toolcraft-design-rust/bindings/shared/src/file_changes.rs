use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::file_changes::{self, Host};

struct NodeHost<'env> {
    object: Object<'env>,
}
impl<'env> Host for NodeHost<'env> {
    type Value = Unknown<'env>;
    type Error = napi::Error;
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value> {
        let function: Function<FnArgs<(Unknown, String)>, Unknown> =
            self.object.get_named_property("get")?;
        function.call((value, key.to_owned()).into())
    }
    fn call(&mut self, operation: &str, args: Vec<Self::Value>) -> Result<Self::Value> {
        let function: Function<FnArgs<(String, Vec<Unknown>)>, Unknown> =
            self.object.get_named_property("operate")?;
        function.call((operation.to_owned(), args).into())
    }
    fn literal(&mut self, text: &str) -> Result<Self::Value> {
        let function: Function<String, Unknown> = self.object.get_named_property("literal")?;
        function.call(text.to_owned())
    }
    fn number(&mut self, value: f64) -> Result<Self::Value> {
        let function: Function<f64, Unknown> = self.object.get_named_property("number")?;
        function.call(value)
    }
    fn numeric(&mut self, value: Self::Value) -> Result<f64> {
        let function: Function<Unknown, f64> = self.object.get_named_property("numeric")?;
        function.call(value)
    }
    fn is_kind(&self, value: Self::Value, kind: &str) -> Result<bool> {
        if value.get_type()? != ValueType::String {
            return Ok(false);
        }
        let text: Utf16String = unsafe { value.cast()? };
        Ok(text.iter().copied().eq(kind.encode_utf16()))
    }
    fn is_nullish(&self, value: Self::Value) -> Result<bool> {
        Ok(matches!(
            value.get_type()?,
            ValueType::Null | ValueType::Undefined
        ))
    }
    fn is_true(&self, value: Self::Value) -> Result<bool> {
        unsafe { value.cast::<bool>() }
    }
}
#[napi]
pub fn design_file_changes<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    file_changes::run(&mut NodeHost { object: host }, &operation, &args)
}
#[napi]
pub fn design_file_change_kinds() -> Vec<Vec<String>> {
    file_changes::KINDS
        .iter()
        .map(|(kind, marker)| vec![(*kind).to_owned(), (*marker).to_owned()])
        .collect()
}
