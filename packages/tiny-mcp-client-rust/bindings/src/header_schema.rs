//! Copy only traversed header schema nodes. Unrelated values are observed by
//! Object.entries semantics but never serialized or traversed.
use mcp_protocol_rust::json::Value;
use napi::{Env, ValueType, bindgen_prelude::*};

pub fn read<'env>(env: &'env Env, input: Unknown<'env>) -> Result<Value> {
    Reader {
        env,
        ancestors: vec![],
        nodes: 0,
    }
    .schema(input, 0)
}
struct Reader<'env> {
    env: &'env Env,
    ancestors: Vec<Unknown<'env>>,
    nodes: usize,
}
fn primitive(input: Unknown<'_>) -> Result<Value> {
    Ok(match input.get_type()? {
        ValueType::String => Value::String(unsafe { input.cast::<Utf16String>()? }.to_vec()),
        _ => Value::Null,
    })
}
fn entries<'env>(object: Object<'env>) -> Result<Vec<(Vec<u16>, Unknown<'env>)>> {
    let keys = object.get_all_property_names(
        KeyCollectionMode::OwnOnly,
        KeyFilter::Enumerable,
        KeyConversion::NumbersToStrings,
    )?;
    let mut entries = vec![];
    for index in 0..keys.get_array_length()? {
        let key: Unknown = keys.get_element(index)?;
        if key.get_type()? == ValueType::Symbol {
            continue;
        }
        let value = object.get_property(key)?;
        let key: Utf16String = unsafe { key.cast()? };
        entries.push((key.to_vec(), value));
    }
    Ok(entries)
}
impl<'env> Reader<'env> {
    fn schema(&mut self, input: Unknown<'env>, depth: usize) -> Result<Value> {
        self.nodes += 1;
        if self.nodes > 10_000 || depth > 64 {
            return Err(napi::Error::from_reason(
                "MCP header schema traversal limit exceeded",
            ));
        }
        if input.get_type()? == ValueType::Boolean {
            return Ok(Value::Bool(unsafe { input.cast()? }));
        }
        if input.get_type()? != ValueType::Object || input.is_array()? {
            return Ok(Value::Null);
        }
        for ancestor in &self.ancestors {
            if self.env.strict_equals(*ancestor, input)? {
                return Err(napi::Error::from_reason("Invalid MCP header schema"));
            }
        }
        self.ancestors.push(input);
        let object: Object = unsafe { input.cast()? };
        let mut fields = vec![];
        if object.has_own_property("x-mcp-header")? {
            fields.push((
                "x-mcp-header".encode_utf16().collect(),
                primitive(object.get_named_property("x-mcp-header")?)?,
            ));
            fields.push((
                "type".encode_utf16().collect(),
                primitive(object.get_named_property("type")?)?,
            ));
        }
        for (key, value) in entries(object)? {
            let name = String::from_utf16_lossy(&key);
            let child = match name.as_str() {
                "properties" | "patternProperties" | "$defs" | "definitions"
                | "dependentSchemas" => {
                    if value.get_type()? != ValueType::Object || value.is_array()? {
                        Value::Null
                    } else {
                        let map: Object = unsafe { value.cast()? };
                        let mut children = vec![];
                        for (key, value) in entries(map)? {
                            children.push((key, self.schema(value, depth + 1)?));
                        }
                        Value::Object(children)
                    }
                }
                "oneOf" | "allOf" | "anyOf" | "prefixItems" => {
                    if value.is_array()? {
                        self.array(value, depth + 1)?
                    } else {
                        Value::Null
                    }
                }
                "items"
                | "additionalProperties"
                | "not"
                | "contains"
                | "if"
                | "then"
                | "else"
                | "propertyNames"
                | "unevaluatedProperties"
                | "unevaluatedItems"
                | "contentSchema" => {
                    if value.is_array()? {
                        self.array(value, depth + 1)?
                    } else {
                        self.schema(value, depth + 1)?
                    }
                }
                _ => continue,
            };
            fields.push((key, child));
        }
        self.ancestors.pop();
        Ok(Value::Object(fields))
    }
    fn array(&mut self, input: Unknown<'env>, depth: usize) -> Result<Value> {
        let array: Array = unsafe { input.cast()? };
        let mut values = vec![];
        for index in 0..array.len() {
            values.push(self.schema(array.get(index)?.expect("array index"), depth)?);
        }
        Ok(Value::Array(values))
    }
}
