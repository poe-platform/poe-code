//! Run the shared Pandoc Lua API inside the portable Rust evaluator.
use super::JVal;
use lua_rust::{Runtime, Value};

fn read(vm: &mut Runtime, value: &JVal) -> Result<Value, String> {
    Ok(match value {
        JVal::Null => {
            let table = vm.table();
            vm.raw_set(
                &table,
                Value::String("__pandoc_null".into()),
                Value::Bool(true),
            )
            .map_err(|e| e.to_string())?;
            table
        }
        JVal::Bool(value) => Value::Bool(*value),
        JVal::Number(value, _) => Value::Number(*value),
        JVal::Str(value) => Value::String(value.as_bytes().to_vec()),
        JVal::Array(values) => {
            let table = vm.table();
            for (index, value) in values.iter().enumerate() {
                let value = read(vm, value)?;
                vm.raw_set(&table, Value::Number((index + 1) as f64), value)
                    .map_err(|e| e.to_string())?;
            }
            table
        }
        JVal::Object(fields) => {
            let table = vm.table();
            for (key, value) in fields {
                let value = read(vm, value)?;
                vm.raw_set(&table, Value::String(key.as_bytes().to_vec()), value)
                    .map_err(|e| e.to_string())?;
            }
            table
        }
    })
}
fn write(vm: &Runtime, value: Value, object: bool, depth: usize) -> Result<JVal, String> {
    if depth > 200 {
        return Err("Lua document nesting limit exceeded".into());
    }
    Ok(match value {
        Value::Nil => JVal::Null,
        Value::Bool(v) => JVal::Bool(v),
        Value::Number(v) if v.is_finite() => JVal::Number(v, None),
        Value::String(v) => {
            JVal::Str(String::from_utf8(v).map_err(|_| "Invalid UTF-8 Lua string")?)
        }
        Value::Table(_) => {
            if vm.raw_get(&value, &Value::String("__pandoc_null".into())) == Value::Bool(true) {
                return Ok(JVal::Null);
            }
            let entries = vm.entries(&value).map_err(|e| e.to_string())?;
            let map =
                vm.raw_get(&value, &Value::String("t".into())) == Value::String("MetaMap".into());
            if object
                || entries
                    .iter()
                    .any(|(key, _)| matches!(key, Value::String(_)))
            {
                let mut fields = Vec::new();
                for (key, value) in entries {
                    let Value::String(key) = key else {
                        return Err("Invalid Lua object key".into());
                    };
                    let key = String::from_utf8(key).map_err(|_| "Invalid UTF-8 Lua string")?;
                    let child = write(vm, value, key == "meta" || map && key == "c", depth + 1)?;
                    fields.push((key, child));
                }
                JVal::Object(fields)
            } else {
                let mut values = Vec::new();
                for index in 1..=entries.len() {
                    let value = vm.raw_get(&value, &Value::Number(index as f64));
                    if value == Value::Nil {
                        return Err("Invalid Lua array index".into());
                    }
                    values.push(write(vm, value, false, depth + 1)?);
                }
                JVal::Array(values)
            }
        }
        _ => return Err("Invalid Lua document value".into()),
    })
}
pub(super) fn filter(
    document: &JVal,
    source: &[u8],
    path: &str,
    format: &str,
    steps: usize,
) -> Result<JVal, String> {
    let mut vm = Runtime::new(steps);
    vm.set_global("FORMAT", Value::String(format.into()));
    let factory = vm
        .run(include_str!("pandoc.lua"), "@pandoc constructors")
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or("Missing Lua filter factory")?;
    let returned = vm
        .run(source, path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .unwrap_or_default();
    let runner = vm
        .call(factory, vec![returned])
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or("Missing Lua filter runner")?;
    let document = read(&mut vm, document)?;
    let result = vm
        .call(runner, vec![document])
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or("Invalid Lua document result")?;
    write(&vm, result, true, 0)
}
