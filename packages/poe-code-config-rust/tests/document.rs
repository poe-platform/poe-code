use poe_code_config_rust::document::{self, Entries, Host};
#[derive(Clone)]
enum Value {
    Undefined,
    Opaque,
    Object(Entries<usize>),
}
struct Arena(Vec<Value>);
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
impl Arena {
    fn add(&mut self, value: Value) -> usize {
        let id = self.0.len();
        self.0.push(value);
        id
    }
    fn object(&mut self, fields: Vec<(&str, usize)>) -> usize {
        self.add(Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (u(key), value))
                .collect(),
        ))
    }
    fn get(&self, id: usize, key: &str) -> usize {
        if let Value::Object(fields) = &self.0[id] {
            fields
                .iter()
                .find(|(name, _)| *name == u(key))
                .map_or(0, |(_, id)| *id)
        } else {
            0
        }
    }
}
impl Host for Arena {
    type Value = usize;
    type Error = &'static str;
    fn is_record(&mut self, value: usize) -> Result<bool, Self::Error> {
        Ok(matches!(self.0[value], Value::Object(_)))
    }
    fn is_undefined(&mut self, value: usize) -> Result<bool, Self::Error> {
        Ok(matches!(self.0[value], Value::Undefined))
    }
    fn keys(&mut self, value: usize) -> Result<Vec<Vec<u16>>, Self::Error> {
        Ok(self
            .entries(value)?
            .into_iter()
            .map(|(key, _)| key)
            .collect())
    }
    fn own(&mut self, value: usize, key: &[u16]) -> Result<usize, Self::Error> {
        Ok(self
            .entries(value)?
            .iter()
            .find(|(name, _)| *name == key)
            .map_or(0, |(_, id)| *id))
    }
    fn entries(&mut self, value: usize) -> Result<Entries<usize>, Self::Error> {
        Ok(if let Value::Object(fields) = &self.0[value] {
            fields.clone()
        } else {
            vec![]
        })
    }
    fn create(&mut self) -> Result<usize, Self::Error> {
        Ok(self.add(Value::Object(vec![])))
    }
    fn define(&mut self, target: usize, key: &[u16], value: usize) -> Result<(), Self::Error> {
        let Value::Object(fields) = &mut self.0[target] else {
            return Err("not an object");
        };
        if let Some((_, old)) = fields.iter_mut().find(|(name, _)| *name == key) {
            *old = value;
        } else {
            fields.push((key.to_vec(), value));
        }
        Ok(())
    }
    fn policy_error(&mut self, message: &'static str) -> Self::Error {
        message
    }
}
#[test]
fn normalization_keeps_only_nonempty_scopes_and_defined_fields() {
    let mut h = Arena(vec![Value::Undefined, Value::Opaque]);
    let empty = h.object(vec![("missing", 0)]);
    let scope = h.object(vec![("__proto__", 1), ("missing", 0)]);
    let input = h.object(vec![("array", 1), ("empty", empty), ("__proto__", scope)]);
    let output = document::normalize(&mut h, input).unwrap();
    assert_eq!(h.keys(output).unwrap(), vec![u("__proto__")]);
    let scope = h.get(output, "__proto__");
    assert_eq!(h.keys(scope).unwrap(), vec![u("__proto__")]);
    assert_eq!(h.get(scope, "__proto__"), 1);
}
#[test]
fn scope_merge_is_shallow_except_runtime() {
    let mut h = Arena(vec![Value::Undefined, Value::Opaque, Value::Opaque]);
    let a = h.object(vec![("A", 1)]);
    let b = h.object(vec![("B", 2)]);
    let sa = h.object(vec![("nested", a), ("missing", 0)]);
    let sb = h.object(vec![("nested", b)]);
    let ra = h.object(vec![("args", a)]);
    let rb = h.object(vec![("args", b)]);
    let base = h.object(vec![("core", sa), ("runtime", ra)]);
    let over = h.object(vec![("core", sb), ("runtime", rb)]);
    let output = document::merge(&mut h, base, over).unwrap();
    assert_eq!(h.get(h.get(output, "core"), "nested"), b);
    let args = h.get(h.get(output, "runtime"), "args");
    assert_eq!(h.get(args, "A"), 1);
    assert_eq!(h.get(args, "B"), 2);
    assert_eq!(
        h.keys(h.get(output, "core")).unwrap(),
        vec![u("nested"), u("missing")]
    );
}
#[test]
fn cyclic_runtime_pair_is_rejected_without_changing_input() {
    let mut h = Arena(vec![Value::Undefined, Value::Opaque]);
    let a = h.object(vec![]);
    let b = h.object(vec![]);
    h.define(a, &u("self"), a).unwrap();
    h.define(b, &u("self"), b).unwrap();
    let base = h.object(vec![("runtime", a)]);
    let over = h.object(vec![("runtime", b)]);
    assert_eq!(
        document::merge(&mut h, base, over),
        Err("Config runtime merge depth exceeded (512).")
    );
    assert_eq!(h.get(a, "self"), a);
    assert_eq!(h.get(b, "self"), b);
}
