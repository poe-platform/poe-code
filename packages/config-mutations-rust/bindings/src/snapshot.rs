//! Binary codec snapshots preserve UTF-16 and avoid JSON hooks and transfer copies.
use config_mutations_rust::value::Value;
use mcp_protocol_rust::json::Value as Json;
type Result<T> = std::result::Result<T, &'static str>;
struct Reader<'a> {
    source: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn bytes(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or("Invalid configuration snapshot length")?;
        let value = self
            .source
            .get(self.offset..end)
            .ok_or("Truncated configuration snapshot")?;
        self.offset = end;
        Ok(value)
    }
    fn count(&mut self) -> Result<usize> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()) as usize)
    }
    fn text(&mut self) -> Result<Vec<u16>> {
        let count = self.count()?;
        let length = count
            .checked_mul(2)
            .ok_or("Invalid configuration snapshot length")?;
        Ok(self
            .bytes(length)?
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect())
    }
}
enum Frame {
    Array {
        remaining: usize,
        values: Vec<Value>,
    },
    Object {
        remaining: usize,
        properties: Vec<(Vec<u16>, Value)>,
        key: Option<Vec<u16>>,
    },
}
pub fn decode(snapshot: &[u8]) -> Result<Value> {
    let mut input = Reader {
        source: snapshot,
        offset: 0,
    };
    let mut frames = vec![];
    loop {
        if frames.len() > 1000 {
            return Err("Could not stringify the object: maximum object depth exceeded");
        }
        if let Some(Frame::Object { key, .. }) = frames.last_mut() {
            *key = Some(input.text()?);
        }
        let mut value = match input.bytes(1)?[0] {
            0 => Value::Null,
            1 => Value::Undefined,
            2 => Value::Bool(false),
            3 => Value::Bool(true),
            4 => Value::Number(f64::from_le_bytes(input.bytes(8)?.try_into().unwrap())),
            5 => Value::String(input.text()?),
            6 => Value::BigInt(input.text()?),
            7 => Value::DateLiteral(input.text()?),
            8 => Value::Unsupported(input.text()?),
            tag @ (9 | 10) => {
                let count = input.count()?;
                if count > input.source.len() - input.offset {
                    return Err("Invalid configuration snapshot count");
                }
                if count == 0 {
                    if tag == 9 {
                        Value::Array(vec![])
                    } else {
                        Value::Object(vec![])
                    }
                } else {
                    frames.push(if tag == 9 {
                        Frame::Array {
                            remaining: count,
                            values: Vec::with_capacity(count),
                        }
                    } else {
                        Frame::Object {
                            remaining: count,
                            properties: Vec::with_capacity(count),
                            key: None,
                        }
                    });
                    continue;
                }
            }
            _ => return Err("Invalid configuration snapshot tag"),
        };
        loop {
            let Some(frame) = frames.last_mut() else {
                if input.offset != input.source.len() {
                    return Err("Trailing configuration snapshot bytes");
                }
                return Ok(value);
            };
            let remaining = match frame {
                Frame::Array { remaining, values } => {
                    values.push(value);
                    remaining
                }
                Frame::Object {
                    remaining,
                    properties,
                    key,
                } => {
                    properties.push((
                        key.take().ok_or("Invalid configuration snapshot key")?,
                        value,
                    ));
                    remaining
                }
            };
            *remaining -= 1;
            if *remaining != 0 {
                break;
            }
            value = match frames.pop().unwrap() {
                Frame::Array { values, .. } => Value::Array(values),
                Frame::Object { properties, .. } => Value::Object(properties),
            };
        }
    }
}
pub fn parsed(value: Value, path: &mut Vec<Json>, temporals: &mut Vec<Json>) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Bool(v) => Json::Bool(v),
        Value::Number(v) => Json::Number(v),
        Value::String(v) => Json::String(v),
        Value::Date(value) => {
            temporals.push(Json::Array(vec![
                Json::Array(path.clone()),
                Json::Number(value.epoch_millis as f64),
                Json::Bool(value.has_date),
                Json::Bool(value.has_time),
                value.offset.map_or(Json::Null, Json::String),
            ]));
            Json::Null
        }
        Value::Object(properties) => Json::Object(
            properties
                .into_iter()
                .map(|(key, value)| {
                    path.push(Json::String(key.clone()));
                    let value = parsed(value, path, temporals);
                    path.pop();
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(items) => Json::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(i, value)| {
                    path.push(Json::Number(i as f64));
                    let value = parsed(value, path, temporals);
                    path.pop();
                    value
                })
                .collect(),
        ),
        _ => unreachable!("TOML parse emits only TOML values"),
    }
}
