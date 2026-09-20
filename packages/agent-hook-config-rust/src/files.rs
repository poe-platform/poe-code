//! Owned parsed-document policies. Filesystem adapters supply atomic I/O separately.
use crate::{GeneratedEntry, Result, message, u};
use mcp_protocol_rust::json::Value;
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub event: Vec<u16>,
    pub matcher: Option<Value>,
    pub handler: Value,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Mutation {
    pub file: Value,
    pub removed: usize,
    pub written: usize,
}
fn malformed(path: &[u16]) -> Vec<u16> {
    message(&[&u("Malformed hooks in "), path])
}
fn field_mut<'a>(value: &'a mut Value, name: &str) -> Option<&'a mut Value> {
    let Value::Object(fields) = value else {
        return None;
    };
    fields
        .iter_mut()
        .find(|(key, _)| *key == u(name))
        .map(|(_, value)| value)
}
fn index(key: &[u16]) -> Option<u32> {
    if key.is_empty() || key.len() > 1 && key[0] == 48 {
        return None;
    }
    let mut number = 0u32;
    for unit in key {
        if !(48..=57).contains(unit) {
            return None;
        }
        number = number.checked_mul(10)?.checked_add(u32::from(*unit - 48))?;
    }
    (number < u32::MAX).then_some(number)
}
fn entries(value: &Value) -> Vec<(&[u16], &Value)> {
    let Value::Object(fields) = value else {
        return vec![];
    };
    let mut numeric = vec![];
    let mut named = vec![];
    for (key, value) in fields {
        if let Some(index) = index(key) {
            numeric.push((index, key.as_slice(), value));
        } else {
            named.push((key.as_slice(), value));
        }
    }
    numeric.sort_by_key(|(index, _, _)| *index);
    let mut output = numeric
        .into_iter()
        .map(|(_, key, value)| (key, value))
        .collect::<Vec<_>>();
    output.extend(named);
    output
}
pub(crate) fn canonicalize(value: &mut Value) {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Object(fields) => {
                fields.sort_by_key(|(key, _)| {
                    index(key).map(|index| (false, index)).unwrap_or((true, 0))
                });
                pending.extend(fields.iter_mut().rev().map(|(_, value)| value));
            }
            Value::Array(items) => pending.extend(items.iter_mut().rev()),
            _ => {}
        }
    }
}
pub fn read_settings(value: &Value, path: &[u16]) -> Result<Vec<Record>> {
    let mut output = vec![];
    let Some(hooks) = value.get("hooks") else {
        return Ok(output);
    };
    for (event, groups) in entries(hooks) {
        let Value::Array(groups) = groups else {
            return Err(malformed(path));
        };
        for group in groups {
            let Some(Value::Array(handlers)) = group.get("hooks") else {
                return Err(malformed(path));
            };
            for handler in handlers {
                if !matches!(handler, Value::Object(_)) {
                    return Err(malformed(path));
                }
                output.push(Record {
                    event: event.to_vec(),
                    matcher: group.get("matcher").cloned(),
                    handler: handler.clone(),
                });
            }
        }
    }
    Ok(output)
}
fn generated(handler: &Value, prefix: &[u16]) -> bool {
    matches!(handler.get("statusMessage"),Some(Value::String(value)) if value.starts_with(prefix))
}
/// Existing settings are replaceable only when every handler proves generated ownership.
pub fn is_fully_generated(file: &Value) -> bool {
    let Value::Object(fields) = file else {
        return false;
    };
    if fields.iter().any(|(key, _)| *key != u("hooks")) {
        return false;
    }
    let Some(Value::Object(_)) = file.get("hooks") else {
        return false;
    };
    let Ok(entries) = read_settings(file, &[]) else {
        return false;
    };
    !entries.is_empty()
        && entries
            .iter()
            .all(|entry| generated(&entry.handler, &u("[generated:poe-code:")))
}
fn validate(file: &Value, path: &[u16]) -> Result<()> {
    if !matches!(file, Value::Object(_)) {
        return Err(malformed(path));
    }
    let Some(hooks) = file.get("hooks") else {
        return Ok(());
    };
    if matches!(hooks, Value::Null) {
        return Ok(());
    }
    let Value::Object(events) = hooks else {
        return Err(malformed(path));
    };
    for (_, groups) in events {
        let Value::Array(groups) = groups else {
            return Err(malformed(path));
        };
        for group in groups {
            if !matches!(group, Value::Object(_))
                || !matches!(group.get("hooks"), Some(Value::Array(_)))
            {
                return Err(malformed(path));
            }
        }
    }
    Ok(())
}
fn handler(entry: &GeneratedEntry) -> Value {
    let mut fields = vec![
        (u("type"), Value::String(u("command"))),
        (
            u("command"),
            Value::String(entry.handler.command.clone().unwrap_or_default()),
        ),
        (
            u("statusMessage"),
            Value::String(entry.handler.status_message.clone().unwrap_or_default()),
        ),
    ];
    if let Some(args) = &entry.handler.args {
        fields.push((
            u("args"),
            Value::Array(args.iter().cloned().map(Value::String).collect()),
        ));
    }
    if let Some(timeout) = entry.handler.timeout {
        fields.push((u("timeout"), Value::Number(timeout)));
    }
    Value::Object(fields)
}
pub fn mutate_file(
    mut file: Value,
    incoming: &[GeneratedEntry],
    run_id: &[u16],
    preserve_generated: bool,
    path: &[u16],
) -> Result<Mutation> {
    validate(&file, path)?;
    let prefix = message(&[&u("[generated:poe-code:"), run_id]);
    for entry in incoming {
        if !entry
            .handler
            .status_message
            .as_ref()
            .is_some_and(|value| value.starts_with(&prefix))
        {
            return Err(message(&[
                &u("Generated hook entry \""),
                &entry.generated_id,
                &u("\" has statusMessage that must start with \""),
                &prefix,
                &u("]\""),
            ]));
        }
        if entry
            .handler
            .timeout
            .is_some_and(|value| !value.is_finite())
        {
            return Err(message(&[
                &u("Generated hook entry \""),
                &entry.generated_id,
                &u("\" must have a finite timeout"),
            ]));
        }
    }
    let Value::Object(fields) = &mut file else {
        unreachable!()
    };
    let hooks_index = match fields.iter().position(|(key, _)| *key == u("hooks")) {
        Some(index) => index,
        None => {
            fields.push((u("hooks"), Value::Object(vec![])));
            fields.len() - 1
        }
    };
    if fields[hooks_index].1 == Value::Null {
        fields[hooks_index].1 = Value::Object(vec![]);
    }
    let Value::Object(events) = &mut fields[hooks_index].1 else {
        unreachable!()
    };
    let mut removed = 0;
    if !preserve_generated {
        for (_, groups) in events.iter_mut() {
            let Value::Array(groups) = groups else {
                unreachable!()
            };
            groups.retain_mut(|group| {
                let Some(Value::Array(handlers)) = field_mut(group, "hooks") else {
                    unreachable!()
                };
                let previous = handlers.len();
                handlers.retain(|handler| {
                    if generated(handler, &u("[generated:poe-code:")) {
                        removed += 1;
                        false
                    } else {
                        true
                    }
                });
                !handlers.is_empty() || handlers.len() == previous
            });
        }
    }
    for entry in incoming {
        let index = match events.iter().position(|(event, _)| *event == entry.event) {
            Some(index) => index,
            None => {
                events.push((entry.event.clone(), Value::Array(vec![])));
                events.len() - 1
            }
        };
        let Value::Array(groups) = &mut events[index].1 else {
            unreachable!()
        };
        let matcher = entry
            .matcher
            .as_ref()
            .map(|value| Value::String(value.clone()));
        let index = match groups
            .iter()
            .position(|group| group.get("matcher") == matcher.as_ref())
        {
            Some(index) => index,
            None => {
                let mut fields = vec![];
                if let Some(matcher) = matcher {
                    fields.push((u("matcher"), matcher));
                }
                fields.push((u("hooks"), Value::Array(vec![])));
                groups.push(Value::Object(fields));
                groups.len() - 1
            }
        };
        let Some(Value::Array(handlers)) = field_mut(&mut groups[index], "hooks") else {
            unreachable!()
        };
        handlers.push(handler(entry));
    }
    Ok(Mutation {
        file,
        removed,
        written: incoming.len(),
    })
}
