use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::command_errors::{self, Host};

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
    fn literal(&mut self, value: &[u16]) -> Result<Self::Value> {
        let function: Function<Utf16String, Unknown> = self.object.get_named_property("literal")?;
        function.call(value.to_vec().into())
    }
    fn stringify(&mut self, value: Self::Value) -> Result<Vec<u16>> {
        let function: Function<Unknown, Utf16String> =
            self.object.get_named_property("stringify")?;
        Ok(function.call(value)?.to_vec())
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
pub fn design_command_error<'env>(
    input: Unknown<'env>,
    panel: bool,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    command_errors::render(&mut NodeHost { object: host }, input, panel)
}
