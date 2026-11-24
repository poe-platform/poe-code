use crate::{Error, Result, Runtime, Value, numbers};
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;

fn integer(value: &Value) -> Result<i32> {
    let number = value
        .number()
        .map_err(|_| Error::unlocated("Expected Lua number"))?;
    numbers::integral(number).map_err(|error| Error::unlocated(error.message))
}

fn string(value: &Value) -> Result<Vec<u8>> {
    match value {
        Value::String(_) | Value::Integer(_) | Value::Number(_) => Ok(value.bytes()),
        _ => Err(Error::unlocated(
            "Expected Lua string or number for concatenation",
        )),
    }
}

impl Runtime {
    pub(crate) fn table_library(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
        let a = |i: usize| args.get(i).cloned().unwrap_or_default();
        let value = match name {
            "table.pack" => {
                let table = self.table();
                for (i, value) in args.iter().enumerate().rev() {
                    self.raw_set(&table, Value::Integer((i + 1) as i32), value.clone())?;
                }
                self.raw_set(
                    &table,
                    Value::String("n".into()),
                    Value::Integer(args.len() as i32),
                )?;
                table
            }
            "table.integer" => Value::Integer(integer(&a(0))?),
            "table.string" => Value::String(string(&a(0))?),
            "table.finish" => {
                let table = a(0);
                let count = a(1).number()?;
                let separator = string(&a(2))?;
                let mut result = Vec::new();
                let mut index = 1.0;
                while index <= count {
                    if index > 1.0 {
                        result.extend_from_slice(&separator);
                    }
                    result.extend(string(&self.raw_get(&table, &Value::Number(index)))?);
                    index += 1.0;
                }
                Value::String(result)
            }
            "table.values" => {
                let table = a(0);
                let count = a(1).number()?;
                let mut values = Vec::new();
                let mut index = 1.0;
                while index <= count {
                    values.push(self.raw_get(&table, &Value::Number(index)));
                    index += 1.0;
                }
                return Ok(values);
            }
            "table.random" => Value::Number((RandomState::new().hash_one(0u8) as u32) as f64),
            "table.check" => {
                let value = a(0);
                if !matches!(value, Value::Table(_)) {
                    let mask = integer(&a(1))?;
                    for (bit, name) in [(1, "__index"), (2, "__newindex"), (4, "__len")] {
                        if mask & bit != 0 && self.meta(&value, name) == Value::Nil {
                            return Err(Error::unlocated("Expected Lua table"));
                        }
                    }
                }
                return Ok(Vec::new());
            }
            _ => unreachable!(),
        };
        Ok(vec![value])
    }
}
