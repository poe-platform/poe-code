use napi::{Env, ValueType, bindgen_prelude::*};
use toolcraft_rust::host::Host;

pub(crate) struct NodeHost<'env> {
    pub(crate) env: Env,
    pub(crate) object: Object<'env>,
}
impl<'env> Host for NodeHost<'env> {
    type Value = Unknown<'env>;
    type Error = napi::Error;
    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value> {
        let call: Function<FnArgs<(String, Vec<Unknown>)>, Unknown> =
            self.object.get_named_property("operate")?;
        call.call((name.to_owned(), args).into())
    }
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value> {
        let get: Function<FnArgs<(Unknown, String)>, Unknown> =
            self.object.get_named_property("get")?;
        get.call((value, key.to_owned()).into())
    }
    fn is_undefined(&self, value: Self::Value) -> Result<bool> {
        Ok(value.get_type()? == ValueType::Undefined)
    }
    fn is_nullish(&self, value: Self::Value) -> Result<bool> {
        Ok(matches!(
            value.get_type()?,
            ValueType::Undefined | ValueType::Null
        ))
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
    fn same(&self, left: Self::Value, right: Self::Value) -> Result<bool> {
        self.env.strict_equals(left, right)
    }
}
