// Table algorithms adapted from Fengari/Lua. See LICENSE.LUA.
use crate::{Error, Result, Runtime, Value, first, numbers};
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
    fn table_access(&self, value: &Value, methods: &[&str]) -> Result<()> {
        if !matches!(value, Value::Table(_))
            && methods
                .iter()
                .any(|name| self.meta(value, name) == Value::Nil)
        {
            return Err(Error::unlocated("Expected Lua table"));
        }
        Ok(())
    }

    fn table_length(&mut self, value: &Value) -> Result<i32> {
        let method = self.meta(value, "__len");
        if method == Value::Nil || matches!(value, Value::String(_)) {
            return self
                .length(value)
                .map(|n| n as i32)
                .map_err(|_| Error::unlocated("Expected Lua table"));
        }
        integer(&first(
            self.call(method, vec![value.clone(), value.clone()])?,
        ))
    }

    pub(crate) fn table_library(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
        let a = |i: usize| args.get(i).cloned().unwrap_or_default();
        let optional = |i, fallback| {
            if a(i) == Value::Nil {
                Ok(fallback)
            } else {
                integer(&a(i))
            }
        };
        let table = a(0);
        match name {
            "table.insert" => {
                self.table_access(&table, &["__index", "__newindex", "__len"])?;
                let end = self
                    .table_length(&table)?
                    .checked_add(1)
                    .ok_or_else(|| Error::unlocated("Number has no integer representation"))?;
                let (position, value) = match args.len() {
                    2 => (end, a(1)),
                    3 => {
                        let position = integer(&a(1))?;
                        if position < 1 || position > end {
                            return Err(Error::unlocated("table:21: Position out of bounds"));
                        }
                        for i in (position..end).rev() {
                            let value = self.get(&table, &Value::Integer(i))?;
                            self.set(table.clone(), Value::Integer(i + 1), value)?;
                        }
                        (position, a(2))
                    }
                    _ => {
                        return Err(Error::unlocated(
                            "table:24: Wrong number of arguments to insert",
                        ));
                    }
                };
                self.set(table, Value::Integer(position), value)?;
                Ok(Vec::new())
            }
            "table.remove" => {
                self.table_access(&table, &["__index", "__newindex", "__len"])?;
                let len = self.table_length(&table)?;
                let position = optional(1, len)?;
                if position != len && (position < 1 || i64::from(position) > i64::from(len) + 1) {
                    return Err(Error::unlocated("table:30: Position out of bounds"));
                }
                let value = self.get(&table, &Value::Integer(position))?;
                for i in position..len {
                    let next = self.get(&table, &Value::Integer(i + 1))?;
                    self.set(table.clone(), Value::Integer(i), next)?;
                }
                self.set(table, Value::Integer(position.max(len)), Value::Nil)?;
                Ok(vec![value])
            }
            "table.concat" => {
                self.table_access(&table, &["__index", "__len"])?;
                let len = self.table_length(&table)?;
                let separator = if a(1) == Value::Nil {
                    Vec::new()
                } else {
                    string(&a(1))?
                };
                let start = optional(2, 1)?;
                let end = optional(3, len)?;
                let mut text = Vec::new();
                for i in start..=end {
                    let value = string(&self.get(&table, &Value::Integer(i))?)?;
                    if i > start {
                        text.extend_from_slice(&separator);
                    }
                    text.extend_from_slice(&value);
                }
                Ok(vec![Value::String(text)])
            }
            "table.unpack" => {
                let start = optional(1, 1)?;
                let len = self.table_length(&table)?;
                let end = optional(2, len)?;
                let mut values = Vec::new();
                for i in start..=end {
                    values.push(self.get(&table, &Value::Integer(i))?);
                }
                Ok(values)
            }
            "table.move" => {
                let from = integer(&a(1))?;
                let end = integer(&a(2))?;
                let to = integer(&a(3))?;
                let target = if a(4) == Value::Nil {
                    table.clone()
                } else {
                    a(4)
                };
                self.table_access(&table, &["__index"])?;
                self.table_access(&target, &["__newindex"])?;
                if end >= from {
                    let count = i64::from(end) - i64::from(from) + 1;
                    if count > i64::from(i32::MAX) {
                        return Err(Error::unlocated("table:41: Too many elements to move"));
                    }
                    if i64::from(to) > i64::from(i32::MAX) - count + 1 {
                        return Err(Error::unlocated("table:43: Destination wrap around"));
                    }
                    let forward = to > end
                        || to <= from
                        || !self.binary("==", table.clone(), target.clone())?.truth();
                    for offset in 0..count {
                        let i = if forward { offset } else { count - 1 - offset };
                        let value =
                            self.get(&table, &Value::Integer((i64::from(from) + i) as i32))?;
                        self.set(
                            target.clone(),
                            Value::Integer((i64::from(to) + i) as i32),
                            value,
                        )?;
                    }
                }
                Ok(vec![target])
            }
            "table.sort" => {
                self.table_access(&table, &["__index", "__newindex", "__len"])?;
                let len = self.table_length(&table)?;
                if len > 1 {
                    if len == i32::MAX {
                        return Err(Error::unlocated("table:134: Array too big"));
                    }
                    let compare = a(1);
                    if !matches!(compare, Value::Nil | Value::Function(_) | Value::Native(_)) {
                        return Err(Error::unlocated("table:135: Expected comparison function"));
                    }
                    self.table_sort(&table, 1, len, 0, &compare)?;
                }
                Ok(Vec::new())
            }
            _ => unreachable!(),
        }
    }

    fn table_less(&mut self, a: Value, b: Value, compare: &Value) -> Result<bool> {
        Ok(if *compare == Value::Nil {
            self.binary("<", a, b)?
        } else {
            first(self.call(compare.clone(), vec![a, b])?)
        }
        .truth())
    }

    fn table_partition(
        &mut self,
        table: &Value,
        lo: i32,
        up: i32,
        pivot: Value,
        compare: &Value,
    ) -> Result<i32> {
        let (mut i, mut j) = (lo, up - 1);
        loop {
            i += 1;
            let mut a = self.get(table, &Value::Integer(i))?;
            while self.table_less(a.clone(), pivot.clone(), compare)? {
                if i == up - 1 {
                    return Err(Error::unlocated(
                        "table:88: Invalid order function for sorting",
                    ));
                }
                i += 1;
                a = self.get(table, &Value::Integer(i))?;
            }
            j -= 1;
            let mut b = self.get(table, &Value::Integer(j))?;
            while self.table_less(pivot.clone(), b.clone(), compare)? {
                if j < i {
                    return Err(Error::unlocated(
                        "table:94: Invalid order function for sorting",
                    ));
                }
                j -= 1;
                b = self.get(table, &Value::Integer(j))?;
            }
            if j < i {
                self.set(table.clone(), Value::Integer(up - 1), a)?;
                self.set(table.clone(), Value::Integer(i), pivot)?;
                return Ok(i);
            }
            self.set(table.clone(), Value::Integer(i), b)?;
            self.set(table.clone(), Value::Integer(j), a)?;
        }
    }

    fn table_sort(
        &mut self,
        table: &Value,
        mut lo: i32,
        mut up: i32,
        mut random: u32,
        compare: &Value,
    ) -> Result<()> {
        while lo < up {
            let a = self.get(table, &Value::Integer(lo))?;
            let b = self.get(table, &Value::Integer(up))?;
            if self.table_less(b.clone(), a.clone(), compare)? {
                self.set(table.clone(), Value::Integer(lo), b)?;
                self.set(table.clone(), Value::Integer(up), a)?;
            }
            if up - lo == 1 {
                return Ok(());
            }
            let p = if up - lo < 100 || random == 0 {
                lo + (up - lo) / 2
            } else {
                let quarter = (up - lo) / 4;
                (random % (quarter as u32 * 2)) as i32 + lo + quarter
            };
            let a = self.get(table, &Value::Integer(p))?;
            let b = self.get(table, &Value::Integer(lo))?;
            if self.table_less(a.clone(), b.clone(), compare)? {
                self.set(table.clone(), Value::Integer(p), b)?;
                self.set(table.clone(), Value::Integer(lo), a)?;
            } else {
                let b = self.get(table, &Value::Integer(up))?;
                if self.table_less(b.clone(), a.clone(), compare)? {
                    self.set(table.clone(), Value::Integer(p), b)?;
                    self.set(table.clone(), Value::Integer(up), a)?;
                }
            }
            if up - lo == 2 {
                return Ok(());
            }
            let pivot = self.get(table, &Value::Integer(p))?;
            let a = self.get(table, &Value::Integer(up - 1))?;
            self.set(table.clone(), Value::Integer(p), a)?;
            self.set(table.clone(), Value::Integer(up - 1), pivot.clone())?;
            let p = self.table_partition(table, lo, up, pivot, compare)?;
            let n;
            if p - lo < up - p {
                self.table_sort(table, lo, p - 1, random, compare)?;
                n = p - lo;
                lo = p + 1;
            } else {
                self.table_sort(table, p + 1, up, random, compare)?;
                n = up - p;
                up = p - 1;
            }
            if i64::from(up - lo) > i64::from(n) * 128 {
                random = RandomState::new().hash_one((lo, up)) as u32;
            }
        }
        Ok(())
    }
}
