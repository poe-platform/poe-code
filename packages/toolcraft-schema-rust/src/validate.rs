//! DSL validation over live host descriptors. No schema/value serialization is
//! performed: getters, functions, resources and callback identities remain live.
use crate::host_values::{Host as GraphHost, Kind};
use std::collections::HashSet;

// Iterative traversal must still terminate unbounded descriptor/value recursion.
// Unlike a node budget, this guard does not reject large, shallow collections.
pub(crate) const MAX_TRAVERSAL_DEPTH: usize = 16_384;

pub trait Host: GraphHost {
    fn call(&mut self, operation: &str, args: Vec<Self::Value>)
    -> Result<Self::Value, Self::Error>;
    fn string(&mut self, value: Self::Value) -> Result<Vec<u16>, Self::Error>;
    fn make_string(&mut self, value: Vec<u16>) -> Result<Self::Value, Self::Error>;
    fn make_number(&mut self, value: f64) -> Result<Self::Value, Self::Error>;
    fn make_boolean(&mut self, value: bool) -> Result<Self::Value, Self::Error>;
    fn undefined(&mut self) -> Result<Self::Value, Self::Error>;
}

pub(crate) fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
pub(crate) fn join(values: &[Vec<u16>], separator: &str) -> Vec<u16> {
    values.join(&u(separator)[..])
}
pub(crate) fn cat(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
pub(crate) fn get<H: Host>(host: &mut H, value: H::Value, key: &str) -> Result<H::Value, H::Error> {
    host.get(value, &u(key))
}
pub(crate) fn is<H: Host>(host: &mut H, value: H::Value, text: &str) -> Result<bool, H::Error> {
    Ok(host.kind(value)? == Kind::String && host.string(value)? == u(text))
}
pub(crate) fn yes<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let result = host.call("isTrue", vec![value])?;
    Ok(host.number(result)? == 1.0)
}
pub(crate) fn truthy<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let result = host.call("truthy", vec![value])?;
    Ok(host.number(result)? == 1.0)
}
pub(crate) fn text<H: Host>(
    host: &mut H,
    value: H::Value,
    template: bool,
) -> Result<Vec<u16>, H::Error> {
    let result = host.call(if template { "template" } else { "stringify" }, vec![value])?;
    host.string(result)
}
pub(crate) fn values<H: Host>(host: &mut H, array: H::Value) -> Result<Vec<H::Value>, H::Error> {
    let length = get(host, array, "length")?;
    let length = host.number(length)? as usize;
    (0..length)
        .map(|index| host.get(array, &u(&index.to_string())))
        .collect()
}
type Entries<V> = Vec<(Vec<u16>, V)>;
pub(crate) fn entries<H: Host>(
    host: &mut H,
    value: H::Value,
) -> Result<Entries<H::Value>, H::Error> {
    let array = host.call("entries", vec![value])?;
    values(host, array)?
        .into_iter()
        .map(|pair| {
            let key = get(host, pair, "0")?;
            Ok((host.string(key)?, get(host, pair, "1")?))
        })
        .collect()
}
pub(crate) fn has<H: Host>(host: &mut H, value: H::Value, key: &[u16]) -> Result<bool, H::Error> {
    let key = host.make_string(key.to_vec())?;
    let result = host.call("hasOwn", vec![value, key])?;
    yes(host, result)
}

pub fn is_plain_record<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    if host.kind(value)? != Kind::Object || host.is_array(value)? {
        return Ok(false);
    }
    let prototype = host.prototype(value)?;
    Ok(host.is_object_prototype(prototype)? || host.kind(prototype)? == Kind::Null)
}

pub fn has_required_keys<H: Host>(
    host: &mut H,
    schema: H::Value,
    value: H::Value,
) -> Result<bool, H::Error> {
    let shape = get(host, schema, "shape")?;
    for (key, schema) in entries(host, shape)? {
        let kind = get(host, schema, "kind")?;
        if !is(host, kind, "optional")? && !has(host, value, &key)? {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn required_fingerprint<H: Host>(host: &mut H, schema: H::Value) -> Result<Vec<u16>, H::Error> {
    Ok(join(&required_keys(host, schema)?, "+"))
}

pub fn required_keys<H: Host>(host: &mut H, schema: H::Value) -> Result<Vec<Vec<u16>>, H::Error> {
    let shape = get(host, schema, "shape")?;
    let mut required = Vec::new();
    for key in host.keys(shape)? {
        let shape = get(host, schema, "shape")?;
        let child = host.get(shape, &key)?;
        let kind = get(host, child, "kind")?;
        if !is(host, kind, "optional")? {
            required.push(key);
        }
    }
    required.sort();
    Ok(required)
}

pub fn deep_equal<H: Host>(
    host: &mut H,
    left: H::Value,
    right: H::Value,
) -> Result<H::Value, H::Error> {
    enum Compare<V> {
        Pair(V, V),
        Object(V, V, std::vec::IntoIter<Vec<u16>>, bool),
        Array(V, V, usize, usize, bool),
    }
    let mut tasks = vec![Compare::Pair(left, right)];
    let mut result = host.make_boolean(true)?;
    while let Some(task) = tasks.pop() {
        if tasks.len() > MAX_TRAVERSAL_DEPTH {
            host.call("stackOverflow", vec![])?;
        }
        match task {
            Compare::Pair(left, right) => {
                let same = host.call("sameValue", vec![left, right])?;
                if yes(host, same)? {
                    result = same;
                    continue;
                }
                result = host.make_boolean(false)?;
                if host.kind(left)? != host.kind(right)? || host.kind(left)? == Kind::Null {
                    continue;
                }
                if host.is_array(left)? {
                    if !host.is_array(right)? {
                        continue;
                    }
                    let left_length = get(host, left, "length")?;
                    let right_length = get(host, right, "length")?;
                    let equal = host.call("strictEqual", vec![left_length, right_length])?;
                    if !yes(host, equal)? {
                        continue;
                    }
                    let method = get(host, left, "every")?;
                    let builtin = host.call("isBuiltinEvery", vec![method])?;
                    if yes(host, builtin)? {
                        let length = host.call("iterationLength", vec![left])?;
                        let length = host.number(length)? as usize;
                        tasks.push(Compare::Array(left, right, 0, length, false));
                    } else {
                        // Caller-supplied methods must see the original receiver,
                        // callback and uncoerced callback results.
                        result = host.call("everyEqual", vec![method, left, right])?;
                    }
                } else if host.kind(left)? == Kind::Object
                    && !host.is_array(left)?
                    && host.kind(right)? == Kind::Object
                    && !host.is_array(right)?
                {
                    let left_keys = host.keys(left)?;
                    let right_keys = host.keys(right)?;
                    if left_keys.len() == right_keys.len() {
                        tasks.push(Compare::Object(left, right, left_keys.into_iter(), false));
                    }
                }
            }
            Compare::Object(left, right, mut keys, pending) => {
                if pending && !truthy(host, result)? {
                    result = host.make_boolean(false)?;
                    continue;
                }
                let Some(key) = keys.next() else {
                    result = host.make_boolean(true)?;
                    continue;
                };
                if !has(host, right, &key)? {
                    result = host.make_boolean(false)?;
                    continue;
                }
                let a = host.get(left, &key)?;
                let b = host.get(right, &key)?;
                tasks.push(Compare::Object(left, right, keys, true));
                tasks.push(Compare::Pair(a, b));
            }
            Compare::Array(left, right, mut index, length, pending) => {
                if pending && !truthy(host, result)? {
                    result = host.make_boolean(false)?;
                    continue;
                }
                result = host.make_boolean(true)?;
                while index < length {
                    let key = u(&index.to_string());
                    let property = host.make_string(key.clone())?;
                    let present = host.call("hasProperty", vec![left, property])?;
                    index += 1;
                    if !yes(host, present)? {
                        continue;
                    }
                    let a = host.get(left, &key)?;
                    let b = host.get(right, &key)?;
                    tasks.push(Compare::Array(left, right, index, length, true));
                    tasks.push(Compare::Pair(a, b));
                    break;
                }
            }
        }
    }
    Ok(result)
}

#[derive(Clone, Copy)]
struct Context<V> {
    schema: V,
    value: Option<V>,
    path: usize,
    state: usize,
    depth: usize,
}
struct ObjectFrame<V> {
    context: Context<V>,
    output: V,
    entries: std::vec::IntoIter<(Vec<u16>, V)>,
    allowed: HashSet<Vec<u16>>,
    injected: Vec<(Vec<u16>, V)>,
    pending: Option<Vec<u16>>,
}
struct ArrayFrame<V> {
    context: Context<V>,
    output: V,
    length: usize,
    index: usize,
    pending: Option<V>,
}
struct RecordFrame<V> {
    context: Context<V>,
    output: V,
    entries: std::vec::IntoIter<(Vec<u16>, V)>,
    pending: Option<Vec<u16>>,
}
struct UnionFrame<V> {
    context: Context<V>,
    iterator: V,
    matches: Vec<(Vec<u16>, V)>,
    pending: Option<(V, usize)>,
}
enum Task<V> {
    Walk(Context<V>),
    Object(ObjectFrame<V>),
    Array(ArrayFrame<V>),
    Record(RecordFrame<V>),
    Union(UnionFrame<V>),
}

pub struct Evaluation<V> {
    pub value: Option<V>,
    pub issues: Vec<V>,
}
struct Evaluator<'a, H: Host> {
    host: &'a mut H,
    symbol: H::Value,
    defaults_none: bool,
    defaults_all: bool,
    tasks: Vec<Task<H::Value>>,
    result: Option<H::Value>,
    states: Vec<Vec<H::Value>>,
    active_iterators: Vec<H::Value>,
    // Flat path arena avoids recursive Rc drops and copying full paths on every node.
    paths: Vec<(usize, Vec<u16>)>,
}

pub fn validate<H: Host>(
    host: &mut H,
    schema: H::Value,
    value: H::Value,
    defaults: H::Value,
    symbol: H::Value,
) -> Result<Evaluation<H::Value>, H::Error> {
    let defaults_none = is(host, defaults, "none")?;
    let defaults_all = is(host, defaults, "all")?;
    let mut evaluator = Evaluator {
        host,
        symbol,
        defaults_none,
        defaults_all,
        result: None,
        tasks: vec![Task::Walk(Context {
            schema,
            value: Some(value),
            path: 0,
            state: 0,
            depth: 0,
        })],
        states: vec![Vec::new()],
        active_iterators: Vec::new(),
        paths: vec![(0, Vec::new())],
    };
    while let Some(task) = evaluator.tasks.pop() {
        let result = match task {
            Task::Walk(context) => evaluator.walk(context),
            Task::Object(frame) => evaluator.object_next(frame),
            Task::Array(frame) => evaluator.array_next(frame),
            Task::Record(frame) => evaluator.record_next(frame),
            Task::Union(frame) => evaluator.union_next(frame),
        };
        if let Err(error) = result {
            // for-of closes nested iterators from inside out on a body throw;
            // an error thrown by return() cannot replace the original throw.
            for iterator in evaluator.active_iterators.iter().rev() {
                let _ = evaluator.host.call("closeIterator", vec![*iterator]);
            }
            return Err(error);
        }
    }
    Ok(Evaluation {
        value: evaluator.result,
        issues: evaluator.states.swap_remove(0),
    })
}

impl<H: Host> Evaluator<'_, H> {
    fn child_path(&mut self, parent: usize, key: Vec<u16>) -> usize {
        let index = self.paths.len();
        self.paths.push((parent, key));
        index
    }
    fn path(&self, mut index: usize) -> Vec<Vec<u16>> {
        let mut parts = Vec::new();
        while index != 0 {
            let (parent, key) = &self.paths[index];
            parts.push(key.clone());
            index = *parent;
        }
        parts.reverse();
        parts
    }
    fn format_path(&self, index: usize) -> Vec<u16> {
        if index == 0 {
            u("value")
        } else {
            join(&self.path(index), ".")
        }
    }
    fn path_value(&mut self, index: usize) -> Result<H::Value, H::Error> {
        let parts = self
            .path(index)
            .into_iter()
            .map(|key| self.host.make_string(key))
            .collect::<Result<Vec<_>, _>>()?;
        self.host.call("array", parts)
    }
    fn issue(
        &mut self,
        context: Context<H::Value>,
        expected: Vec<u16>,
        received: Vec<u16>,
        message: Option<Vec<u16>>,
    ) -> Result<(), H::Error> {
        let message = message.unwrap_or_else(|| {
            cat(&[
                &u("Expected "),
                &expected,
                &u(" at "),
                &self.format_path(context.path),
                &u(", got "),
                &received,
            ])
        });
        let path = self.path_value(context.path)?;
        let expected = self.host.make_string(expected)?;
        let received = self.host.make_string(received)?;
        let message = self.host.make_string(message)?;
        let issue = self
            .host
            .call("issue", vec![path, expected, received, message])?;
        self.states[context.state].push(issue);
        Ok(())
    }
    fn received_type(&mut self, value: H::Value) -> Result<Vec<u16>, H::Error> {
        let kind = self.host.kind(value)?;
        if kind == Kind::Null {
            return Ok(u("null"));
        }
        if self.host.is_array(value)? {
            return Ok(u("array"));
        }
        if kind == Kind::Object && !is_plain_record(self.host, value)? {
            return Ok(u("non-plain object"));
        }
        Ok(u(match kind {
            Kind::Number
                if {
                    let number = self.host.number(value)?;
                    number.is_finite() && number.fract() == 0.0
                } =>
            {
                "integer"
            }
            Kind::Number => "number",
            Kind::String => "string",
            Kind::Boolean => "boolean",
            Kind::Object => "object",
            Kind::Function => "function",
            Kind::BigInt => "bigint",
            Kind::Symbol => "symbol",
            _ => "undefined",
        }))
    }
    fn expected_issue(
        &mut self,
        context: Context<H::Value>,
        expected: &str,
        value: H::Value,
    ) -> Result<(), H::Error> {
        let received = self.received_type(value)?;
        self.issue(context, u(expected), received, None)
    }
    fn expected(&mut self, mut schema: H::Value) -> Result<Vec<u16>, H::Error> {
        let mut depth = 0;
        loop {
            depth += 1;
            if depth > MAX_TRAVERSAL_DEPTH {
                self.host.call("stackOverflow", vec![])?;
            }
            let kind = get(self.host, schema, "kind")?;
            let kind = self.host.string(kind)?;
            match String::from_utf16_lossy(&kind).as_str() {
                "optional" => schema = get(self.host, schema, "inner")?,
                "number" => {
                    let kind = get(self.host, schema, "jsonType")?;
                    return Ok(u(if is(self.host, kind, "integer")? {
                        "integer"
                    } else {
                        "number"
                    }));
                }
                "enum" => {
                    let values = get(self.host, schema, "values")?;
                    let result = self.host.call("joinComma", vec![values])?;
                    return Ok(cat(&[&u("one of "), &text(self.host, result, true)?]));
                }
                "object" | "oneOf" | "record" => return Ok(u("object")),
                "union" => return Ok(u("exactly one union branch")),
                "json" => return Ok(u("JSON value")),
                _ => return Ok(kind),
            }
        }
    }
    fn default_value(&mut self, mut schema: H::Value) -> Result<Option<H::Value>, H::Error> {
        let mut depth = 0;
        loop {
            depth += 1;
            if depth > MAX_TRAVERSAL_DEPTH {
                self.host.call("stackOverflow", vec![])?;
            }
            let value = get(self.host, schema, "default")?;
            if self.host.kind(value)? != Kind::Undefined {
                return get(self.host, schema, "default").map(Some);
            }
            let kind = get(self.host, schema, "kind")?;
            if !is(self.host, kind, "optional")? {
                return Ok(None);
            }
            schema = get(self.host, schema, "inner")?;
        }
    }
    fn walk(&mut self, mut context: Context<H::Value>) -> Result<(), H::Error> {
        if context.depth > MAX_TRAVERSAL_DEPTH {
            self.host.call("stackOverflow", vec![])?;
        }
        let kind = get(self.host, context.schema, "kind")?;
        if is(self.host, kind, "optional")? {
            let missing = match context.value {
                None => true,
                Some(value) => self.host.kind(value)? == Kind::Undefined,
            };
            if missing {
                if self.defaults_none {
                    self.result = None;
                    return Ok(());
                }
                let inner = get(self.host, context.schema, "inner")?;
                let Some(value) = self.default_value(inner)? else {
                    self.result = None;
                    return Ok(());
                };
                let attempt = self.host.call("structuredCloneAttempt", vec![value])?;
                let ok = get(self.host, attempt, "0")?;
                let result = get(self.host, attempt, "1")?;
                context.value = Some(if yes(self.host, ok)? {
                    result
                } else {
                    let clone_error = self.host.call("isDataCloneError", vec![result])?;
                    if !yes(self.host, clone_error)? {
                        self.host.call("throwValue", vec![result])?;
                    }
                    self.host.call("cloneDefault", vec![value])?
                });
            }
            context.schema = get(self.host, context.schema, "inner")?;
            context.depth += 1;
            self.tasks.push(Task::Walk(context));
            return Ok(());
        }
        if context.value.is_none() && self.defaults_all {
            let value = get(self.host, context.schema, "default")?;
            if self.host.kind(value)? != Kind::Undefined {
                let value = get(self.host, context.schema, "default")?;
                context.value = Some(self.host.call("cloneDefault", vec![value])?);
            }
        }
        let Some(value) = context.value else {
            let expected = self.expected(context.schema)?;
            // The original also evaluates expectedFor for the legacy message argument.
            self.expected(context.schema)?;
            self.issue(context, expected, u("missing"), None)?;
            self.result = None;
            return Ok(());
        };
        self.result = Some(value);
        let native = self
            .host
            .call("getNative", vec![context.schema, self.symbol])?;
        if self.host.kind(native)? != Kind::Undefined {
            let json = self.host.call("isJson", vec![value])?;
            if !yes(self.host, json)? {
                self.expected_issue(context, "JSON value", value)?;
            } else {
                let result = self.host.call("validateOverride", vec![native, value])?;
                let ok = get(self.host, result, "ok")?;
                if !truthy(self.host, ok)? {
                    let issues = get(self.host, result, "issues")?;
                    let path = self.path_value(context.path)?;
                    let issues = self.host.call("prefixIssues", vec![issues, path])?;
                    self.states[context.state].extend(values(self.host, issues)?);
                }
            }
            return Ok(());
        }
        if self.host.kind(value)? == Kind::Null {
            let nullable = get(self.host, context.schema, "nullable")?;
            if yes(self.host, nullable)? {
                return Ok(());
            }
        }
        let kind = get(self.host, context.schema, "kind")?;
        match String::from_utf16_lossy(&self.host.string(kind)?).as_str() {
            "string" => self.string(context, value)?,
            "number" => self.number(context, value)?,
            "boolean" => {
                if self.host.kind(value)? != Kind::Boolean {
                    self.expected_issue(context, "boolean", value)?;
                }
            }
            "enum" => {
                let choices = get(self.host, context.schema, "values")?;
                let included = self.host.call("includes", vec![choices, value])?;
                if !truthy(self.host, included)? {
                    let choices = get(self.host, context.schema, "values")?;
                    let joined = self.host.call("joinComma", vec![choices])?;
                    let expected = cat(&[&u("one of "), &text(self.host, joined, true)?]);
                    let received = text(self.host, value, false)?;
                    self.issue(context, expected, received, None)?;
                }
            }
            "array" => self.array(context, value)?,
            "object" => self.object(context, Vec::new())?,
            "record" => {
                if !is_plain_record(self.host, value)? {
                    self.expected_issue(context, "object", value)?;
                } else {
                    let output = self.host.call("object", vec![])?;
                    let entries = entries(self.host, value)?.into_iter();
                    self.tasks.push(Task::Record(RecordFrame {
                        context,
                        output,
                        entries,
                        pending: None,
                    }));
                }
            }
            "oneOf" => self.one_of(context, value)?,
            "union" => self.union(context, value)?,
            "json" => self.json(context, value)?,
            _ => {
                self.host.call("invalidWalkResult", vec![])?;
            }
        }
        Ok(())
    }
    fn string(&mut self, context: Context<H::Value>, value: H::Value) -> Result<(), H::Error> {
        if self.host.kind(value)? != Kind::String {
            return self.expected_issue(context, "string", value);
        }
        let length = char::decode_utf16(self.host.string(value)?).count();
        for (name, comparison, description) in [
            ("minLength", "less", "at least"),
            ("maxLength", "greater", "at most"),
        ] {
            let bound = get(self.host, context.schema, name)?;
            if self.host.kind(bound)? == Kind::Undefined {
                continue;
            }
            let bound = get(self.host, context.schema, name)?;
            let count = self.host.make_number(length as f64)?;
            let failed = self.host.call(comparison, vec![count, bound])?;
            if yes(self.host, failed)? {
                let bound = get(self.host, context.schema, name)?;
                let expected = cat(&[
                    &u(&format!("string with length {description} ")),
                    &text(self.host, bound, true)?,
                ]);
                self.issue(
                    context,
                    expected,
                    u(&format!("string with length {length}")),
                    None,
                )?;
            }
        }
        let pattern = get(self.host, context.schema, "pattern")?;
        if self.host.kind(pattern)? != Kind::Undefined {
            let pattern = get(self.host, context.schema, "pattern")?;
            let compiled = self.host.call("compilePattern", vec![pattern])?;
            let failed = if self.host.kind(compiled)? == Kind::Undefined {
                true
            } else {
                let matched = self.host.call("testPattern", vec![compiled, value])?;
                !truthy(self.host, matched)?
            };
            if failed {
                let pattern = get(self.host, context.schema, "pattern")?;
                let expected = cat(&[
                    &u("string matching pattern "),
                    &text(self.host, pattern, true)?,
                ]);
                let received = self.host.string(value)?;
                self.issue(context, expected, received, None)?;
            }
        }
        Ok(())
    }
    fn number(&mut self, context: Context<H::Value>, value: H::Value) -> Result<(), H::Error> {
        if self.host.kind(value)? != Kind::Number || !self.host.number(value)?.is_finite() {
            let kind = get(self.host, context.schema, "jsonType")?;
            let expected = if is(self.host, kind, "integer")? {
                "integer"
            } else {
                "number"
            };
            return self.expected_issue(context, expected, value);
        }
        let kind = get(self.host, context.schema, "jsonType")?;
        if is(self.host, kind, "integer")? && self.host.number(value)?.fract() != 0.0 {
            self.expected_issue(context, "integer", value)?;
        }
        for (name, comparison, description) in [
            ("minimum", "less", "greater"),
            ("maximum", "greater", "less"),
        ] {
            let bound = get(self.host, context.schema, name)?;
            if self.host.kind(bound)? == Kind::Undefined {
                continue;
            }
            let bound = get(self.host, context.schema, name)?;
            let failed = self.host.call(comparison, vec![value, bound])?;
            if yes(self.host, failed)? {
                let bound = get(self.host, context.schema, name)?;
                let expected = cat(&[
                    &u(&format!("number {description} than or equal to ")),
                    &text(self.host, bound, true)?,
                ]);
                let received = text(self.host, value, false)?;
                self.issue(context, expected, received, None)?;
            }
        }
        Ok(())
    }
    fn array(&mut self, context: Context<H::Value>, value: H::Value) -> Result<(), H::Error> {
        if !self.host.is_array(value)? {
            return self.expected_issue(context, "array", value);
        }
        for (name, comparison, description) in [
            ("minItems", "less", "at least"),
            ("maxItems", "greater", "at most"),
        ] {
            let bound = get(self.host, context.schema, name)?;
            if self.host.kind(bound)? == Kind::Undefined {
                continue;
            }
            let length = get(self.host, value, "length")?;
            let bound = get(self.host, context.schema, name)?;
            let failed = self.host.call(comparison, vec![length, bound])?;
            if yes(self.host, failed)? {
                let bound = get(self.host, context.schema, name)?;
                let expected = cat(&[
                    &u(&format!("array with {description} ")),
                    &text(self.host, bound, true)?,
                    &u(" items"),
                ]);
                let length = get(self.host, value, "length")?;
                let received = cat(&[
                    &u("array with "),
                    &text(self.host, length, true)?,
                    &u(" items"),
                ]);
                self.issue(context, expected, received, None)?;
            }
        }
        let output = self.host.call("denseArray", vec![value])?;
        let length = get(self.host, output, "length")?;
        let length = self.host.number(length)? as usize;
        self.tasks.push(Task::Array(ArrayFrame {
            context,
            output,
            length,
            index: 0,
            pending: None,
        }));
        Ok(())
    }
    fn array_next(&mut self, mut frame: ArrayFrame<H::Value>) -> Result<(), H::Error> {
        if let Some(original) = frame.pending.take() {
            self.host.define(
                frame.output,
                &u(&(frame.index - 1).to_string()),
                self.result.unwrap_or(original),
            )?;
        }
        if frame.index == frame.length {
            self.result = Some(frame.output);
            return Ok(());
        }
        let key = u(&frame.index.to_string());
        let value = self.host.get(frame.context.value.unwrap(), &key)?;
        let schema = get(self.host, frame.context.schema, "item")?;
        let context = Context {
            schema,
            value: Some(value),
            path: self.child_path(frame.context.path, key),
            state: frame.context.state,
            depth: frame.context.depth + 1,
        };
        frame.index += 1;
        frame.pending = Some(value);
        self.tasks.push(Task::Array(frame));
        self.tasks.push(Task::Walk(context));
        Ok(())
    }
    fn object(
        &mut self,
        context: Context<H::Value>,
        injected: Vec<(Vec<u16>, H::Value)>,
    ) -> Result<(), H::Error> {
        let value = context.value.unwrap();
        if !is_plain_record(self.host, value)? {
            self.result = Some(value);
            return self.expected_issue(context, "object", value);
        }
        let output = self.host.call("object", vec![])?;
        let shape = get(self.host, context.schema, "shape")?;
        let mut allowed: HashSet<_> = self.host.keys(shape)?.into_iter().collect();
        allowed.extend(injected.iter().map(|(key, _)| key.clone()));
        let shape = get(self.host, context.schema, "shape")?;
        let entries = entries(self.host, shape)?.into_iter();
        self.tasks.push(Task::Object(ObjectFrame {
            context,
            output,
            entries,
            allowed,
            injected,
            pending: None,
        }));
        Ok(())
    }
    fn object_next(&mut self, mut frame: ObjectFrame<H::Value>) -> Result<(), H::Error> {
        if let Some(key) = frame.pending.take()
            && let Some(value) = self.result
        {
            self.host.define(frame.output, &key, value)?;
        }
        let value = frame.context.value.unwrap();
        if let Some((key, schema)) = frame.entries.next() {
            let value = if has(self.host, value, &key)? {
                Some(self.host.get(value, &key)?)
            } else {
                None
            };
            let context = Context {
                schema,
                value,
                path: self.child_path(frame.context.path, key.clone()),
                state: frame.context.state,
                depth: frame.context.depth + 1,
            };
            frame.pending = Some(key);
            self.tasks.push(Task::Object(frame));
            self.tasks.push(Task::Walk(context));
            return Ok(());
        }
        for (key, injected) in frame.injected {
            let injected = if has(self.host, value, &key)? {
                self.host.get(value, &key)?
            } else {
                injected
            };
            self.host.define(frame.output, &key, injected)?;
        }
        for (key, value) in entries(self.host, value)? {
            if frame.allowed.contains(&key) {
                continue;
            }
            let additional = get(self.host, frame.context.schema, "additionalProperties")?;
            if yes(self.host, additional)? {
                self.host.define(frame.output, &key, value)?;
            } else {
                let context = Context {
                    path: self.child_path(frame.context.path, key),
                    ..frame.context
                };
                self.issue(
                    context,
                    u("no additional properties"),
                    u("unknown property"),
                    None,
                )?;
            }
        }
        self.result = Some(frame.output);
        Ok(())
    }
    fn record_next(&mut self, mut frame: RecordFrame<H::Value>) -> Result<(), H::Error> {
        if let Some(key) = frame.pending.take()
            && let Some(value) = self.result
        {
            self.host.define(frame.output, &key, value)?;
        }
        if let Some((key, value)) = frame.entries.next() {
            let schema = get(self.host, frame.context.schema, "value")?;
            let context = Context {
                schema,
                value: Some(value),
                path: self.child_path(frame.context.path, key.clone()),
                state: frame.context.state,
                depth: frame.context.depth + 1,
            };
            frame.pending = Some(key);
            self.tasks.push(Task::Record(frame));
            self.tasks.push(Task::Walk(context));
        } else {
            self.result = Some(frame.output);
        }
        Ok(())
    }
    fn one_of(&mut self, context: Context<H::Value>, value: H::Value) -> Result<(), H::Error> {
        if !is_plain_record(self.host, value)? {
            return self.expected_issue(context, "object", value);
        }
        let discriminator = get(self.host, context.schema, "discriminator")?;
        let discriminator = self.host.string(discriminator)?;
        let selected = self.host.get(value, &discriminator)?;
        let discriminator = get(self.host, context.schema, "discriminator")?;
        let discriminator = self.host.string(discriminator)?;
        let path = self.child_path(context.path, discriminator);
        let branches = get(self.host, context.schema, "branches")?;
        let names = join(&self.host.keys(branches)?, ", ");
        let expected = cat(&[&u("one of "), &names]);
        let discriminator = get(self.host, context.schema, "discriminator")?;
        let discriminator = self.host.string(discriminator)?;
        if !has(self.host, value, &discriminator)? {
            let discriminator = get(self.host, context.schema, "discriminator")?;
            let message = cat(&[
                &u("Missing discriminator \""),
                &text(self.host, discriminator, true)?,
                &u("\" at "),
                &self.format_path(context.path),
                &u(". Expected one of: "),
                &names,
                &u("."),
            ]);
            return self.issue(
                Context { path, ..context },
                expected,
                u("missing"),
                Some(message),
            );
        }
        let valid = if self.host.kind(selected)? != Kind::String {
            false
        } else {
            let branches = get(self.host, context.schema, "branches")?;
            let key = self.host.string(selected)?;
            has(self.host, branches, &key)?
        };
        if !valid {
            let received = text(self.host, selected, false)?;
            let formatted = if self.host.kind(selected)? == Kind::String {
                let formatted = self.host.call("jsonStringify", vec![selected])?;
                self.host.string(formatted)?
            } else {
                text(self.host, selected, false)?
            };
            let message = cat(&[
                &u("Expected "),
                &expected,
                &u(" at "),
                &self.format_path(path),
                &u(", got "),
                &formatted,
            ]);
            return self.issue(
                Context { path, ..context },
                expected,
                received,
                Some(message),
            );
        }
        let branches = get(self.host, context.schema, "branches")?;
        let key = self.host.string(selected)?;
        let schema = self.host.get(branches, &key)?;
        let discriminator = get(self.host, context.schema, "discriminator")?;
        let discriminator = self.host.string(discriminator)?;
        self.object(
            Context { schema, ..context },
            vec![(discriminator, selected)],
        )
    }
    fn union(&mut self, context: Context<H::Value>, value: H::Value) -> Result<(), H::Error> {
        if !is_plain_record(self.host, value)? {
            return self.expected_issue(context, "object", value);
        }
        let branches = get(self.host, context.schema, "branches")?;
        let candidates = self.host.call("filterCandidates", vec![branches, value])?;
        let length = get(self.host, candidates, "length")?;
        if self.host.number(length)? == 1.0 && !self.defaults_all {
            let schema = get(self.host, candidates, "0")?;
            return self.object(Context { schema, ..context }, Vec::new());
        }
        let branches = get(self.host, context.schema, "branches")?;
        let iterator = self.host.call("iterator", vec![branches])?;
        self.tasks.push(Task::Union(UnionFrame {
            context,
            iterator,
            matches: Vec::new(),
            pending: None,
        }));
        Ok(())
    }
    fn union_next(&mut self, mut frame: UnionFrame<H::Value>) -> Result<(), H::Error> {
        if let Some((schema, state)) = frame.pending.take() {
            if self.states[state].is_empty()
                && let Some(value) = self.result
            {
                frame
                    .matches
                    .push((required_fingerprint(self.host, schema)?, value));
            }
            self.active_iterators.pop();
        }
        let next = self.host.call("next", vec![frame.iterator])?;
        let done = get(self.host, next, "done")?;
        if !truthy(self.host, done)? {
            let schema = get(self.host, next, "value")?;
            let state = self.states.len();
            self.states.push(Vec::new());
            let context = Context {
                schema,
                state,
                ..frame.context
            };
            frame.pending = Some((schema, state));
            self.active_iterators.push(frame.iterator);
            self.tasks.push(Task::Union(frame));
            return self.object(context, Vec::new());
        }
        if frame.matches.len() == 1 {
            self.result = Some(frame.matches[0].1);
            return Ok(());
        }
        let context = frame.context;
        let (received, message) = if frame.matches.is_empty() {
            let branches = get(self.host, context.schema, "branches")?;
            let descriptions = self.host.call("mapFingerprints", vec![branches])?;
            let branches = get(self.host, context.schema, "branches")?;
            let count = get(self.host, branches, "length")?;
            let count = text(self.host, count, true)?;
            let descriptions = self.host.call("joinPipe", vec![descriptions])?;
            (
                u("0 matching branches"),
                cat(&[
                    &u("No union branch matched at "),
                    &self.format_path(context.path),
                    &u(". Tried "),
                    &count,
                    &u(" branches. Expected one of: "),
                    &text(self.host, descriptions, true)?,
                    &u("."),
                ]),
            )
        } else {
            let names = frame
                .matches
                .iter()
                .map(|(name, _)| name.clone())
                .collect::<Vec<_>>();
            (
                u(&format!("{} matching branches", frame.matches.len())),
                cat(&[
                    &u("Expected exactly one union branch at "),
                    &self.format_path(context.path),
                    &u(", but matched more than one branch: "),
                    &join(&names, " | "),
                ]),
            )
        };
        self.issue(
            context,
            u("exactly one union branch"),
            received,
            Some(message),
        )?;
        self.result = context.value;
        Ok(())
    }
    fn json(&mut self, context: Context<H::Value>, value: H::Value) -> Result<(), H::Error> {
        let json = self.host.call("isJson", vec![value])?;
        if !yes(self.host, json)? {
            return self.expected_issue(context, "JSON value", value);
        }
        let constant = get(self.host, context.schema, "const")?;
        if self.host.kind(constant)? != Kind::Undefined {
            let constant = get(self.host, context.schema, "const")?;
            let equal = deep_equal(self.host, value, constant)?;
            if !truthy(self.host, equal)? {
                self.expected_issue(context, "declared JSON constant", value)?;
            }
        }
        let choices = get(self.host, context.schema, "enum")?;
        if self.host.kind(choices)? != Kind::Undefined {
            let choices = get(self.host, context.schema, "enum")?;
            let included = self.host.call("someEqual", vec![choices, value])?;
            if !truthy(self.host, included)? {
                self.expected_issue(context, "declared JSON enum value", value)?;
            }
        }
        Ok(())
    }
}
