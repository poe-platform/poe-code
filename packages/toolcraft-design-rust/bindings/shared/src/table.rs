use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::table::{self, Host};

struct NodeHost<'env> {
    object: Object<'env>,
}
impl<'env> Host for NodeHost<'env> {
    type Value = Unknown<'env>;
    type Error = napi::Error;
    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value> {
        let function: Function<FnArgs<(String, Vec<Unknown>)>, Unknown> =
            self.object.get_named_property("operate")?;
        function.call((name.to_owned(), args).into())
    }
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value> {
        let function: Function<FnArgs<(Unknown, String)>, Unknown> =
            self.object.get_named_property("get")?;
        function.call((value, key.to_owned()).into())
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
    fn is_kind(&self, value: Self::Value, kind: &str) -> Result<bool> {
        if value.get_type()? != ValueType::String {
            return Ok(false);
        }
        let text: Utf16String = unsafe { value.cast()? };
        Ok(text.iter().copied().eq(kind.encode_utf16()))
    }
}
#[napi]
pub fn design_table_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    table::run(&mut NodeHost { object: host }, &operation, &args)
}
#[napi]
pub fn design_table_point_width(point: f64) -> f64 {
    table::point_width(point)
}
#[napi]
pub fn design_table_emoji_point(point: f64) -> bool {
    table::emoji_point(point)
}
