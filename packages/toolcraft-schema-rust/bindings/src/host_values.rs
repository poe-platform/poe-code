use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_schema_rust::host_values::{self, Descriptor, Host, JsonLimits, Kind};

pub(crate) struct NodeHost<'env>(pub(crate) Object<'env>, pub(crate) Env);

impl<'env> Host for NodeHost<'env> {
    type Value = Unknown<'env>;
    type Error = napi::Error;

    fn kind(&mut self, value: Self::Value) -> Result<Kind> {
        Ok(match value.get_type()? {
            ValueType::Null => Kind::Null,
            ValueType::Boolean => Kind::Boolean,
            ValueType::String => Kind::String,
            ValueType::Number => Kind::Number,
            ValueType::Object => Kind::Object,
            ValueType::Function => Kind::Function,
            ValueType::Undefined => Kind::Undefined,
            ValueType::BigInt => Kind::BigInt,
            ValueType::Symbol => Kind::Symbol,
            _ => Kind::Other,
        })
    }
    fn number(&mut self, value: Self::Value) -> Result<f64> {
        // Called only after the core has checked the value's numeric type.
        let number: napi::JsNumber = unsafe { value.cast()? };
        number.get_double()
    }
    fn is_array(&mut self, value: Self::Value) -> Result<bool> {
        let function: Function<Unknown, bool> = self.0.get_named_property("isArray")?;
        function.call(value)
    }
    fn prototype(&mut self, value: Self::Value) -> Result<Self::Value> {
        let function: Function<Unknown, Unknown> = self.0.get_named_property("prototype")?;
        function.call(value)
    }
    fn is_object_prototype(&mut self, value: Self::Value) -> Result<bool> {
        let function: Function<Unknown, bool> = self.0.get_named_property("isObjectPrototype")?;
        function.call(value)
    }
    fn keys(&mut self, value: Self::Value) -> Result<Vec<Vec<u16>>> {
        let function: Function<Unknown, Vec<Utf16String>> = self.0.get_named_property("keys")?;
        Ok(function
            .call(value)?
            .into_iter()
            .map(|key| key.to_vec())
            .collect())
    }
    fn get(&mut self, value: Self::Value, key: &[u16]) -> Result<Self::Value> {
        let function: Function<FnArgs<(Unknown, Utf16String)>, Unknown> =
            self.0.get_named_property("get")?;
        function.call((value, key.to_vec().into()).into())
    }
    fn define(&mut self, target: Self::Value, key: &[u16], value: Self::Value) -> Result<()> {
        let function: Function<FnArgs<(Unknown, Utf16String, Unknown)>, Unknown> =
            self.0.get_named_property("define")?;
        function
            .call((target, key.to_vec().into(), value).into())
            .map(|_| ())
    }
    fn new_array(&mut self, source: Self::Value) -> Result<Self::Value> {
        let function: Function<Unknown, Unknown> = self.0.get_named_property("newArray")?;
        function.call(source)
    }
    fn new_object(&mut self, prototype: Self::Value) -> Result<Self::Value> {
        let function: Function<Unknown, Unknown> = self.0.get_named_property("newObject")?;
        function.call(prototype)
    }
    fn copy_get(&mut self, source: Self::Value) -> Result<Option<Self::Value>> {
        let function: Function<Unknown, Option<Unknown>> = self.0.get_named_property("copyGet")?;
        function.call(source)
    }
    fn copy_set(&mut self, source: Self::Value, copy: Self::Value) -> Result<()> {
        let function: Function<FnArgs<(Unknown, Unknown)>, Unknown> =
            self.0.get_named_property("copySet")?;
        function.call((source, copy).into()).map(|_| ())
    }
    fn ancestor_has(&mut self, value: Self::Value) -> Result<bool> {
        let function: Function<Unknown, bool> = self.0.get_named_property("ancestorHas")?;
        function.call(value)
    }
    fn ancestor_add(&mut self, value: Self::Value) -> Result<()> {
        let function: Function<Unknown, Unknown> = self.0.get_named_property("ancestorAdd")?;
        function.call(value).map(|_| ())
    }
    fn ancestor_delete(&mut self, value: Self::Value) -> Result<()> {
        let function: Function<Unknown, Unknown> = self.0.get_named_property("ancestorDelete")?;
        function.call(value).map(|_| ())
    }
    fn descriptor(&mut self, value: Self::Value, key: &[u16]) -> Result<Descriptor<Self::Value>> {
        let function: Function<FnArgs<(Unknown, Utf16String)>, Object> =
            self.0.get_named_property("descriptor")?;
        read_descriptor(function.call((value, key.to_vec().into()).into())?)
    }
    fn properties(&mut self, value: Self::Value) -> Result<Self::Value> {
        let function: Function<Unknown, Unknown> = self.0.get_named_property("properties")?;
        function.call(value)
    }
    fn next_property(&mut self, iterator: Self::Value) -> Result<Option<Descriptor<Self::Value>>> {
        let function: Function<Unknown, Option<Object>> =
            self.0.get_named_property("nextProperty")?;
        function.call(iterator)?.map(read_descriptor).transpose()
    }
    fn length_exceeds(&mut self, value: Self::Value, remaining: f64) -> Result<bool> {
        let function: Function<FnArgs<(Unknown, f64)>, bool> =
            self.0.get_named_property("lengthExceeds")?;
        function.call((value, remaining).into())
    }
}

fn read_descriptor(value: Object<'_>) -> Result<Descriptor<Unknown<'_>>> {
    Ok(match value.get_element::<u32>(0)? {
        0 => Descriptor::Missing,
        1 => Descriptor::Data(value.get_element(1)?),
        _ => Descriptor::Accessor,
    })
}

#[napi]
pub fn clone_default_value<'env>(
    env: Env,
    value: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    host_values::clone_default_value(&mut NodeHost(host, env), value)
}

#[napi]
pub fn is_json_value<'env>(
    env: Env,
    value: Unknown<'env>,
    max_nodes: Unknown<'env>,
    max_depth: Unknown<'env>,
    host: Object<'env>,
) -> Result<bool> {
    let mut host = NodeHost(host, env);
    let mut number = |value| {
        if host.kind(value)? == Kind::Number {
            host.number(value).map(Some)
        } else {
            Ok(None)
        }
    };
    let limits = JsonLimits::new(number(max_nodes)?, number(max_depth)?)
        .map_err(napi::Error::from_reason)?;
    host_values::is_json_value(&mut host, value, limits)
}
