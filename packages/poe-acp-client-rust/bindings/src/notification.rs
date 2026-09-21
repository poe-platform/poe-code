//! Project only protocol fields; opaque payloads and extension fields stay in JS.
use mcp_protocol_rust::json::Value;
use napi::{Env, Error, ValueType, bindgen_prelude::*};
#[derive(Clone, Copy)]
enum Shape {
    Scalar,
    Notification,
    Update,
    Content,
    Annotation,
    Resource,
    Location,
    Entry,
    Command,
    Input,
    Config,
    Option,
    Cost,
}
struct Reader<'a> {
    descriptor: Function<'a, FnArgs<(Unknown<'a>, String)>, Unknown<'a>>,
    nodes: usize,
    units: usize,
}
impl<'a> Reader<'a> {
    fn field(&self, mut source: Unknown<'a>, key: &str) -> Result<Option<Unknown<'a>>> {
        for _ in 0..64 {
            if source.get_type()? != ValueType::Object {
                return Ok(None);
            }
            let descriptor = self
                .descriptor
                .call(FnArgs::from((source, key.to_owned())))?;
            if descriptor.get_type()? != ValueType::Undefined {
                let descriptor: Object = unsafe { descriptor.cast()? };
                if !descriptor.has_own_property("value")? {
                    return Err(Error::from_reason(
                        "ACP protocol fields must be data properties",
                    ));
                }
                let value: Unknown = descriptor.get_named_property("value")?;
                return if value.get_type()? == ValueType::Undefined {
                    Ok(None)
                } else {
                    Ok(Some(value))
                };
            }
            let object: Object = unsafe { source.cast()? };
            source = object.get_prototype()?;
        }
        Err(Error::from_reason("ACP protocol prototype limit exceeded"))
    }
    fn tag(&self, source: Unknown<'a>, key: &str) -> Result<String> {
        if let Some(value) = self.field(source, key)?
            && value.get_type()? == ValueType::String
        {
            Ok(unsafe { value.cast::<String>()? })
        } else {
            Ok(String::new())
        }
    }
    fn value(
        &mut self,
        source: Unknown<'a>,
        shape: Shape,
        list: bool,
        depth: usize,
    ) -> Result<Value> {
        self.nodes += 1;
        if depth > 128 || self.nodes > 1_000_000 {
            return Err(Error::from_reason(
                "ACP notification resource limit exceeded",
            ));
        }
        match source.get_type()? {
            ValueType::Null => Ok(Value::Null),
            ValueType::Boolean => Ok(Value::Bool(unsafe { source.cast()? })),
            ValueType::Number => Ok(Value::Number(unsafe { source.cast()? })),
            ValueType::String => {
                let value = unsafe { source.cast::<Utf16String>()? };
                self.units += value.len();
                if self.units > 8 * 1024 * 1024 {
                    return Err(Error::from_reason("ACP notification string limit exceeded"));
                }
                Ok(Value::String(value.to_vec()))
            }
            ValueType::Object => {
                let object: Object = unsafe { source.cast()? };
                if object.is_array()? {
                    if !list {
                        return Ok(Value::Array(vec![]));
                    }
                    let length = object.get_array_length()?;
                    if length as usize > 1_000_000 - self.nodes {
                        return Err(Error::from_reason(
                            "ACP notification resource limit exceeded",
                        ));
                    }
                    let mut values = Vec::with_capacity(length as usize);
                    for index in 0..length {
                        values.push(
                            if let Some(value) = self.field(source, &index.to_string())? {
                                self.value(value, shape, false, depth + 1)?
                            } else {
                                Value::Null
                            },
                        );
                    }
                    return Ok(Value::Array(values));
                }
                if list {
                    return Ok(Value::Object(vec![]));
                }
                let fields = self.fields(source, shape)?;
                let mut values = vec![];
                for (key, child, list, opaque) in fields {
                    if let Some(value) = self.field(source, key)? {
                        let value = if opaque
                            && value.get_type()? == ValueType::Object
                            && !unsafe { value.cast::<Object>()? }.is_array()?
                        {
                            Value::Object(vec![])
                        } else {
                            self.value(value, child, list, depth + 1)?
                        };
                        values.push((key.encode_utf16().collect(), value));
                    }
                }
                Ok(Value::Object(values))
            }
            _ => Ok(Value::Bool(false)),
        }
    }
    fn fields(
        &self,
        source: Unknown<'a>,
        shape: Shape,
    ) -> Result<Vec<(&'static str, Shape, bool, bool)>> {
        use Shape::*;
        let mut fields = vec![("_meta", Notification, false, true)];
        let scalar = |key| (key, Scalar, false, false);
        match shape {
            Scalar => fields.clear(),
            Notification => fields.extend([scalar("sessionId"), ("update", Update, false, false)]),
            Update => {
                fields.push(scalar("sessionUpdate"));
                match self.tag(source, "sessionUpdate")?.as_str() {
                    "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk" => {
                        fields.push(("content", Content, false, false))
                    }
                    "tool_call" | "tool_call_update" => fields.extend([
                        scalar("toolCallId"),
                        scalar("title"),
                        scalar("kind"),
                        scalar("status"),
                        ("content", Content, true, false),
                        ("locations", Location, true, false),
                    ]),
                    "plan" => fields.push(("entries", Entry, true, false)),
                    "current_mode_update" => fields.push(scalar("currentModeId")),
                    "session_info_update" => fields.extend([scalar("title"), scalar("updatedAt")]),
                    "available_commands_update" => {
                        fields.push(("availableCommands", Command, true, false))
                    }
                    "config_option_update" => fields.push(("configOptions", Config, true, false)),
                    "usage_update" => fields.extend([
                        scalar("used"),
                        scalar("size"),
                        ("cost", Cost, false, false),
                    ]),
                    _ => {}
                }
            }
            Content => {
                fields.extend([scalar("type"), ("annotations", Annotation, false, false)]);
                match self.tag(source, "type")?.as_str() {
                    "text" => fields.push(scalar("text")),
                    "image" => fields.extend([scalar("data"), scalar("mimeType"), scalar("uri")]),
                    "audio" => fields.extend([scalar("data"), scalar("mimeType")]),
                    "resource_link" => fields.extend(
                        ["name", "uri", "description", "mimeType", "size", "title"].map(scalar),
                    ),
                    "resource" => fields.push(("resource", Resource, false, false)),
                    "diff" => fields.extend(["path", "newText", "oldText"].map(scalar)),
                    "terminal" => fields.push(scalar("terminalId")),
                    _ => {}
                }
            }
            Annotation => fields.extend([
                ("audience", Scalar, true, false),
                scalar("lastModified"),
                scalar("priority"),
            ]),
            Resource => fields.extend(["uri", "mimeType", "text", "blob"].map(scalar)),
            Location => fields.extend(["path", "line", "lineNumber"].map(scalar)),
            Entry => fields.extend(["content", "priority", "status"].map(scalar)),
            Command => fields.extend([
                scalar("name"),
                scalar("description"),
                ("input", Input, false, false),
            ]),
            Input => fields.push(scalar("hint")),
            Config => fields.extend([
                scalar("type"),
                scalar("id"),
                scalar("name"),
                scalar("currentValue"),
                scalar("description"),
                scalar("category"),
                ("options", Option, true, false),
            ]),
            Option => fields.extend([
                scalar("value"),
                scalar("name"),
                scalar("description"),
                scalar("group"),
                ("options", Option, true, false),
            ]),
            Cost => fields.extend([scalar("amount"), scalar("currency")]),
        }
        Ok(fields)
    }
}
pub fn read<'a>(env: &'a Env, source: Unknown<'a>) -> Result<Value> {
    // JavaScript functions also expose object properties.
    let object: Object = env.get_global()?.get_named_property_unchecked("Object")?;
    let descriptor = object.get_named_property("getOwnPropertyDescriptor")?;
    Reader {
        descriptor,
        nodes: 0,
        units: 0,
    }
    .value(source, Shape::Notification, false, 0)
}
