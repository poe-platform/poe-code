//! Standalone addon for document admission and foreign-runtime merge policies.
mod resolution;
use config_extends_rust::{document, foreign};
pub use frontmatter_rust_napi_core::*;
use mcp_protocol_rust::json::{self, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn number(value: u32) -> Value {
    Value::Number(f64::from(value))
}

fn snapshot_value(
    value: config_mutations_rust::value::Value,
    path: &mut Vec<Value>,
    references: &mut Vec<Value>,
) -> Result<Value> {
    use config_mutations_rust::value::Value as V;
    Ok(match value {
        V::Null => Value::Null,
        V::Bool(value) => Value::Bool(value),
        V::Number(value) => Value::Number(value),
        V::String(value) => Value::String(value),
        V::Undefined => {
            references.push(Value::Array(vec![
                Value::Array(path.clone()),
                Value::Number(-1.0),
            ]));
            Value::Null
        }
        V::Unsupported(id) => {
            let id = String::from_utf16(&id)
                .ok()
                .and_then(|text| text.parse::<u32>().ok())
                .ok_or_else(|| Error::from_reason("Invalid opaque snapshot handle"))?;
            references.push(Value::Array(vec![Value::Array(path.clone()), number(id)]));
            Value::Null
        }
        V::Array(items) => Value::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(index, value)| {
                    path.push(Value::Number(index as f64));
                    let result = snapshot_value(value, path, references);
                    path.pop();
                    result
                })
                .collect::<Result<_>>()?,
        ),
        V::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| {
                    path.push(Value::String(key.clone()));
                    let result = snapshot_value(value, path, references);
                    path.pop();
                    Ok((key, result?))
                })
                .collect::<Result<_>>()?,
        ),
        _ => return Err(Error::from_reason("Invalid owned snapshot value")),
    })
}
#[napi]
pub fn extends_owned_merge(snapshot: Buffer) -> Result<NativeJson> {
    use config_mutations_rust::value::Value as V;
    let V::Array(rows) =
        config_mutations_rust::snapshot::decode(&snapshot).map_err(Error::from_reason)?
    else {
        return Err(Error::from_reason("Expected configuration layers"));
    };
    let mut layers = vec![];
    for mut row in rows {
        let Some(V::String(source)) = row.get("source") else {
            return Err(Error::from_reason("Expected a string layer source"));
        };
        let source = source.clone();
        let V::Object(ref mut fields) = row else {
            unreachable!()
        };
        let index = fields
            .iter()
            .position(|(key, _)| *key == u("data"))
            .ok_or_else(|| Error::from_reason("Expected layer data"))?;
        let data = fields.swap_remove(index).1;
        layers.push(config_extends_rust::Layer { source, data });
    }
    let merged = config_extends_rust::merge_layers(&layers).map_err(Error::from_reason)?;
    let mut references = vec![];
    let data = snapshot_value(
        merged.data,
        &mut vec![Value::String(u("data"))],
        &mut references,
    )?;
    Ok(NativeJson(object(vec![
        ("data", data),
        (
            "sources",
            Value::Object(
                merged
                    .sources
                    .into_iter()
                    .map(|(key, source)| (key, Value::String(source)))
                    .collect(),
            ),
        ),
        ("references", Value::Array(references)),
    ])))
}
#[napi]
pub fn extends_parse_document(
    source: Utf16String,
    extension: Utf16String,
    file: Utf16String,
    absolute: Function<Utf16String, bool>,
    date_key: Function<f64, Utf16String>,
) -> Result<NativeJson> {
    let mut absolute_error = None;
    let mut date_error = None;
    let mut is_absolute = |path: &[u16]| match absolute.call(path.to_vec().into()) {
        Ok(value) => value,
        Err(error) => {
            absolute_error = Some(error);
            false
        }
    };
    let mut format_date = |epoch: i64| match date_key.call(epoch as f64) {
        Ok(value) => value.to_vec(),
        Err(error) => {
            date_error = Some(error);
            vec![]
        }
    };
    let parsed = document::parse_document(
        &source,
        &extension,
        &file,
        &mut is_absolute,
        Some(&mut format_date),
    );
    if let Some(error) = absolute_error.or(date_error) {
        return Err(error);
    }
    Ok(NativeJson(match parsed {
        Ok(parsed) => {
            let Value::Object(mut fields) = parsed_yaml_snapshot(parsed.yaml).0 else {
                unreachable!()
            };
            fields.push((
                u("format"),
                Value::String(u(match parsed.format {
                    document::Format::Markdown => "markdown",
                    document::Format::Yaml => "yaml",
                    document::Format::Json => "json",
                })),
            ));
            fields.push((
                u("extends"),
                match parsed.extends {
                    document::Extends::Disabled => Value::Bool(false),
                    document::Extends::Enabled => Value::Bool(true),
                    document::Extends::Path(path) => Value::String(path),
                },
            ));
            fields.push((u("hasExtendsField"), Value::Bool(parsed.has_extends)));
            Value::Object(fields)
        }
        Err(error) => object(vec![("error", Value::String(error.message))]),
    }))
}
type Hook<'a> = Function<'a, FnArgs<(String, NativeJson)>, Utf16String>;
struct ForeignHost<'a> {
    hook: Hook<'a>,
}
impl ForeignHost<'_> {
    fn call(&self, operation: &str, args: Vec<Value>) -> Result<Value> {
        let value = self
            .hook
            .call((operation.to_owned(), NativeJson(Value::Array(args))).into())?;
        json::parse_utf16(
            &value,
            json::Limits {
                max_depth: 512,
                max_bytes: usize::MAX,
                max_nodes: usize::MAX,
            },
        )
        .map_err(|error| Error::from_reason(error.to_string()))
    }
    fn id(value: Value) -> Result<u32> {
        match value {
            Value::Number(value)
                if value >= 0.0 && value <= f64::from(u32::MAX) && value.fract() == 0.0 =>
            {
                Ok(value as u32)
            }
            _ => Err(Error::from_reason("Invalid foreign value handle")),
        }
    }
    fn boolean(value: Value) -> Result<bool> {
        match value {
            Value::Bool(value) => Ok(value),
            _ => Err(Error::from_reason("Invalid foreign boolean")),
        }
    }
}
impl foreign::Host for ForeignHost<'_> {
    type Value = u32;
    type Iterator = u32;
    type Error = Error;
    fn layer_data(&mut self, layer: u32) -> Result<u32> {
        Self::id(self.call("layerData", vec![number(layer)])?)
    }
    fn layer_source(&mut self, layer: u32) -> Result<Vec<u16>> {
        match self.call("layerSource", vec![number(layer)])? {
            Value::String(source) => Ok(source),
            _ => Err(Error::from_reason("Expected a string layer source")),
        }
    }
    fn kind(&mut self, value: u32) -> Result<foreign::Kind> {
        Ok(match Self::id(self.call("kind", vec![number(value)])?)? {
            0 => foreign::Kind::Undefined,
            1 => foreign::Kind::Null,
            2 => foreign::Kind::EmptyString,
            3 => foreign::Kind::Other,
            _ => return Err(Error::from_reason("Invalid foreign value kind")),
        })
    }
    fn is_plain(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("plain", vec![number(value)])?)
    }
    fn is_array(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("array", vec![number(value)])?)
    }
    fn keys(&mut self, value: u32) -> Result<Vec<Vec<u16>>> {
        let Value::Array(keys) = self.call("keys", vec![number(value)])? else {
            return Err(Error::from_reason("Invalid foreign keys"));
        };
        keys.into_iter()
            .map(|key| match key {
                Value::String(key) => Ok(key),
                _ => Err(Error::from_reason("Invalid foreign key")),
            })
            .collect()
    }
    fn own(&mut self, value: u32, key: &[u16]) -> Result<u32> {
        Self::id(self.call("own", vec![number(value), Value::String(key.to_vec())])?)
    }
    fn entries(&mut self, value: u32) -> Result<foreign::Entries<u32>> {
        let Value::Array(entries) = self.call("entries", vec![number(value)])? else {
            return Err(Error::from_reason("Invalid foreign entries"));
        };
        entries
            .into_iter()
            .map(|entry| {
                let Value::Array(mut parts) = entry else {
                    return Err(Error::from_reason("Invalid foreign entry"));
                };
                if parts.len() != 2 {
                    return Err(Error::from_reason("Invalid foreign entry length"));
                }
                let value = Self::id(parts.pop().unwrap())?;
                let Value::String(key) = parts.pop().unwrap() else {
                    return Err(Error::from_reason("Invalid foreign entry key"));
                };
                Ok((key, value))
            })
            .collect()
    }
    fn sequence(&mut self, value: u32, array: bool) -> Result<u32> {
        Self::id(self.call("sequence", vec![number(value), Value::Bool(array)])?)
    }
    fn next(&mut self, iterator: u32) -> Result<Option<u32>> {
        match self.call("next", vec![number(iterator)])? {
            Value::Null => Ok(None),
            value => Ok(Some(Self::id(value)?)),
        }
    }
    fn close(&mut self, iterator: u32, abrupt: bool) {
        let _ = self.call("close", vec![number(iterator), Value::Bool(abrupt)]);
    }
    fn create(&mut self, prototype: Option<u32>) -> Result<u32> {
        Self::id(self.call("create", vec![prototype.map_or(Value::Null, number)])?)
    }
    fn define(&mut self, object: u32, key: &[u16], value: u32) -> Result<()> {
        self.call(
            "define",
            vec![number(object), Value::String(key.to_vec()), number(value)],
        )?;
        Ok(())
    }
    fn map(&mut self, array: u32, depth: usize) -> Result<u32> {
        Self::id(self.call("map", vec![number(array), Value::Number(depth as f64)])?)
    }
}
fn foreign_error(error: foreign::Error<Error>) -> Error {
    match error {
        foreign::Error::Policy(message) => Error::from_reason(message),
        foreign::Error::Host(error) => error,
    }
}
#[napi]
pub fn extends_foreign_clone(value: u32, depth: u32, hook: Hook) -> Result<u32> {
    foreign::clone_value(value, depth as usize, &mut ForeignHost { hook }).map_err(foreign_error)
}
#[napi]
pub fn extends_foreign_merge(layers: Vec<u32>, hook: Hook) -> Result<NativeJson> {
    let layers: Vec<_> = layers.into_iter().map(foreign::Layer::Dynamic).collect();
    let result =
        foreign::merge_layers(&layers, &mut ForeignHost { hook }).map_err(foreign_error)?;
    Ok(NativeJson(object(vec![
        ("data", number(result.data)),
        (
            "sources",
            Value::Object(
                result
                    .sources
                    .into_iter()
                    .map(|(path, source)| (path, Value::String(source)))
                    .collect(),
            ),
        ),
    ])))
}
