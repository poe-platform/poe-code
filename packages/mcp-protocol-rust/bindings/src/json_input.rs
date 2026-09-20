use mcp_protocol_rust::json::{Limits, Value};
use napi::{Env, Error, JsValue, ValueType, bindgen_prelude::*};

#[derive(Clone, Copy)]
pub enum Mode {
    Json,
    Tool,
}

/// Copy values directly through Node-API. Descriptor inspection rejects
/// accessors before reading them, and never calls a serialization hook.
pub fn read(env: &Env, source: Unknown<'_>, mode: Mode) -> Result<Option<Value>> {
    let mut reader = Reader {
        env,
        descriptor: None,
        object_prototype: None,
        ancestors: Vec::new(),
        nodes: 0,
        bytes: 0,
        limits: Limits::default(),
    };
    reader.visit(source, 0, mode, true)
}

struct Reader<'env> {
    env: &'env Env,
    descriptor: Option<Function<'env, FnArgs<(Unknown<'env>, Utf16String)>, Unknown<'env>>>,
    object_prototype: Option<Unknown<'env>>,
    ancestors: Vec<Unknown<'env>>,
    nodes: usize,
    bytes: usize,
    limits: Limits,
}

impl<'env> Reader<'env> {
    fn visit(
        &mut self,
        source: Unknown<'env>,
        depth: usize,
        mode: Mode,
        allow_undefined: bool,
    ) -> Result<Option<Value>> {
        self.nodes += 1;
        if depth > self.limits.max_depth || self.nodes > self.limits.max_nodes {
            return Err(Error::from_reason("JSON value resource limit exceeded"));
        }
        let value = match source.get_type()? {
            ValueType::Undefined if allow_undefined => return Ok(None),
            ValueType::Null => Value::Null,
            ValueType::Boolean => Value::Bool(unsafe { source.cast()? }),
            ValueType::Number => {
                let number: f64 = unsafe { source.cast()? };
                if !number.is_finite() {
                    if matches!(mode, Mode::Json) {
                        return Err(Error::from_reason("JSON numbers must be finite"));
                    }
                    let text = if number.is_nan() {
                        "NaN"
                    } else if number.is_sign_negative() {
                        "-Infinity"
                    } else {
                        "Infinity"
                    };
                    Value::String(text.encode_utf16().collect())
                } else {
                    Value::Number(number)
                }
            }
            ValueType::String => {
                let string: Utf16String = unsafe { source.cast()? };
                self.charge_string(&string)?;
                Value::String(string.to_vec())
            }
            ValueType::Object => {
                for ancestor in &self.ancestors {
                    if self.env.strict_equals(*ancestor, source)? {
                        return Err(Error::from_reason("Cyclic JSON value"));
                    }
                }
                let object: Object = unsafe { source.cast()? };
                let array = object.is_array()?;
                let prototype = object.get_prototype()?;
                if !array && self.object_prototype.is_none() {
                    let global = self.env.get_global()?;
                    let constructor: Object = global.get_named_property_unchecked("Object")?;
                    self.object_prototype = Some(constructor.get_named_property("prototype")?);
                }
                if !array
                    && prototype.get_type()? != ValueType::Null
                    && !self.env.strict_equals(
                        prototype,
                        self.object_prototype.expect("loaded object prototype"),
                    )?
                {
                    return Err(Error::from_reason(
                        "JSON objects must have a plain prototype",
                    ));
                }
                self.reject_serialization_hook(source)?;
                self.ancestors.push(source);
                let result = if array {
                    let length = object.get_array_length()?;
                    if length as usize > self.limits.max_nodes - self.nodes {
                        return Err(Error::from_reason("JSON value resource limit exceeded"));
                    }
                    let mut values = Vec::with_capacity(length as usize);
                    for index in 0..length {
                        let entry =
                            self.data_property(source, &index.to_string())?
                                .ok_or_else(|| {
                                    Error::from_reason("Arrays must contain own data entries")
                                })?;
                        if let Some(value) =
                            self.visit(entry, depth + 1, mode, matches!(mode, Mode::Tool))?
                        {
                            values.push(value);
                        }
                    }
                    Value::Array(values)
                } else {
                    let keys = object.get_all_property_names(
                        KeyCollectionMode::OwnOnly,
                        KeyFilter::Enumerable,
                        KeyConversion::NumbersToStrings,
                    )?;
                    let length = keys.get_array_length()?;
                    if length as usize > self.limits.max_nodes - self.nodes {
                        return Err(Error::from_reason("JSON value resource limit exceeded"));
                    }
                    let mut properties = Vec::with_capacity(length as usize);
                    for index in 0..length {
                        let key: Unknown = keys.get_element(index)?;
                        if key.get_type()? == ValueType::Symbol {
                            continue;
                        }
                        let key: Utf16String = unsafe { key.cast()? };
                        self.charge_string(&key)?;
                        let entry = self
                            .data_property_utf16(source, key.to_vec().into())?
                            .ok_or_else(|| Error::from_reason("Object property disappeared"))?;
                        let value = self
                            .visit(entry, depth + 1, Mode::Json, false)?
                            .expect("undefined is rejected inside JSON objects");
                        properties.push((key.to_vec(), value));
                    }
                    Value::Object(properties)
                };
                self.ancestors.pop();
                result
            }
            _ => {
                return Err(Error::from_reason(
                    "Value must be JSON or a supported tool return",
                ));
            }
        };
        Ok(Some(value))
    }

    fn charge_string(&mut self, units: &[u16]) -> Result<()> {
        for scalar in char::decode_utf16(units.iter().copied()) {
            self.bytes += scalar.map_or(3, |scalar| scalar.len_utf8());
            if self.bytes > self.limits.max_bytes {
                return Err(Error::from_reason("JSON value byte limit exceeded"));
            }
        }
        Ok(())
    }

    fn data_property(&mut self, source: Unknown<'env>, key: &str) -> Result<Option<Unknown<'env>>> {
        self.data_property_utf16(source, key.encode_utf16().collect::<Vec<_>>().into())
    }

    fn data_property_utf16(
        &mut self,
        source: Unknown<'env>,
        key: Utf16String,
    ) -> Result<Option<Unknown<'env>>> {
        if self.descriptor.is_none() {
            let global = self.env.get_global()?;
            let constructor: Object = global.get_named_property_unchecked("Object")?;
            self.descriptor = Some(constructor.get_named_property("getOwnPropertyDescriptor")?);
        }
        let descriptor = self
            .descriptor
            .as_ref()
            .expect("loaded descriptor function")
            .call(FnArgs::from((source, key)))?;
        if descriptor.get_type()? == ValueType::Undefined {
            return Ok(None);
        }
        let object: Object = unsafe { descriptor.cast()? };
        if !object.has_own_property("value")? {
            return Err(Error::from_reason(
                "JSON properties must be data properties",
            ));
        }
        object.get_named_property("value").map(Some)
    }

    fn reject_serialization_hook(&mut self, source: Unknown<'env>) -> Result<()> {
        let mut owner = source;
        for _ in 0..64 {
            if owner.get_type()? == ValueType::Null {
                return Ok(());
            }
            if let Some(hook) = self.data_property(owner, "toJSON")? {
                return if hook.get_type()? == ValueType::Function {
                    Err(Error::from_reason(
                        "JSON serialization hooks are not supported",
                    ))
                } else {
                    Ok(())
                };
            }
            let object: Object = unsafe { owner.cast()? };
            owner = object.get_prototype()?;
        }
        Err(Error::from_reason("JSON prototype depth limit exceeded"))
    }
}
