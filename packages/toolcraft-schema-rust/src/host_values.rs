//! Host graph semantics used by the schema DSL. Values are opaque handles:
//! traversal, admission and cloning decisions live here; the embedding supplies
//! ECMAScript property operations, identity collections and allocations.

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Null,
    Boolean,
    String,
    Number,
    Object,
    Function,
    Undefined,
    BigInt,
    Symbol,
    Other,
}

pub enum Descriptor<V> {
    Missing,
    Accessor,
    Data(V),
}

pub trait Host {
    type Value: Copy;
    type Error;

    fn kind(&mut self, value: Self::Value) -> Result<Kind, Self::Error>;
    fn number(&mut self, value: Self::Value) -> Result<f64, Self::Error>;
    fn is_array(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn prototype(&mut self, value: Self::Value) -> Result<Self::Value, Self::Error>;
    fn is_object_prototype(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn keys(&mut self, value: Self::Value) -> Result<Vec<Vec<u16>>, Self::Error>;
    fn get(&mut self, value: Self::Value, key: &[u16]) -> Result<Self::Value, Self::Error>;
    fn define(
        &mut self,
        target: Self::Value,
        key: &[u16],
        value: Self::Value,
    ) -> Result<(), Self::Error>;
    fn new_array(&mut self, source: Self::Value) -> Result<Self::Value, Self::Error>;
    fn new_object(&mut self, prototype: Self::Value) -> Result<Self::Value, Self::Error>;
    fn copy_get(&mut self, source: Self::Value) -> Result<Option<Self::Value>, Self::Error>;
    fn copy_set(&mut self, source: Self::Value, copy: Self::Value) -> Result<(), Self::Error>;
    fn ancestor_has(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn ancestor_add(&mut self, value: Self::Value) -> Result<(), Self::Error>;
    fn ancestor_delete(&mut self, value: Self::Value) -> Result<(), Self::Error>;
    fn descriptor(
        &mut self,
        value: Self::Value,
        key: &[u16],
    ) -> Result<Descriptor<Self::Value>, Self::Error>;
    fn properties(&mut self, value: Self::Value) -> Result<Self::Value, Self::Error>;
    /// None is iterator completion, distinct from a missing array descriptor.
    fn next_property(
        &mut self,
        iterator: Self::Value,
    ) -> Result<Option<Descriptor<Self::Value>>, Self::Error>;
    fn length_exceeds(&mut self, value: Self::Value, remaining: f64) -> Result<bool, Self::Error>;
}

struct CopyFrame<V> {
    source: V,
    target: V,
    keys: std::vec::IntoIter<Vec<u16>>,
    pending: Option<Vec<u16>>,
}

/// A flat continuation stack retains depth-first getter order without recursing
/// on either the native stack or the caller's stack. Copies enter the identity
/// map before keys/getters are observed, preserving cyclic and shared graphs.
pub fn clone_default_value<H: Host>(host: &mut H, value: H::Value) -> Result<H::Value, H::Error> {
    let mut stack: Vec<CopyFrame<H::Value>> = Vec::new();
    let mut current = value;
    'visit: loop {
        let mut result = current;
        if host.kind(current)? == Kind::Object {
            if let Some(copy) = host.copy_get(current)? {
                result = copy;
            } else {
                let prototype = host.prototype(current)?;
                if host.is_array(current)?
                    || host.is_object_prototype(prototype)?
                    || host.kind(prototype)? == Kind::Null
                {
                    result = if host.is_array(current)? {
                        host.new_array(current)?
                    } else {
                        host.new_object(prototype)?
                    };
                    host.copy_set(current, result)?;
                    let keys = host.keys(current)?.into_iter();
                    stack.push(CopyFrame {
                        source: current,
                        target: result,
                        keys,
                        pending: None,
                    });
                }
            }
        }
        while let Some(frame) = stack.last_mut() {
            if let Some(key) = frame.pending.take() {
                host.define(frame.target, &key, result)?;
            }
            if let Some(key) = frame.keys.next() {
                current = host.get(frame.source, &key)?;
                frame.pending = Some(key);
                continue 'visit;
            }
            result = frame.target;
            stack.pop();
        }
        return Ok(result);
    }
}

pub struct JsonLimits {
    pub max_nodes: f64,
    pub max_depth: f64,
}

impl JsonLimits {
    pub fn new(max_nodes: Option<f64>, max_depth: Option<f64>) -> Result<Self, &'static str> {
        fn valid(value: f64, minimum: f64) -> bool {
            value == f64::INFINITY
                || (value.is_finite()
                    && value.fract() == 0.0
                    && value >= minimum
                    && value <= 9_007_199_254_740_991.0)
        }
        let max_nodes = max_nodes
            .filter(|&value| valid(value, 1.0))
            .ok_or("maxNodes must be a positive safe integer")?;
        let max_depth = max_depth
            .filter(|&value| valid(value, 0.0))
            .ok_or("maxDepth must be a nonnegative safe integer or Infinity")?;
        Ok(Self {
            max_nodes,
            max_depth,
        })
    }
}

struct JsonFrame<V> {
    owner: V,
    children: V,
    depth: usize,
}

/// Check JSON safety without invoking getters or serialization hooks. Enumeration
/// is lazy, so proxy traps and mutations occur in the same order as JavaScript.
pub fn is_json_value<H: Host>(
    host: &mut H,
    value: H::Value,
    limits: JsonLimits,
) -> Result<bool, H::Error> {
    let mut stack: Vec<JsonFrame<H::Value>> = Vec::new();
    let mut current = value;
    let mut depth = 0;
    let mut nodes = 0.0;
    loop {
        nodes += 1.0;
        if nodes > limits.max_nodes || depth as f64 > limits.max_depth {
            return Ok(false);
        }
        match host.kind(current)? {
            Kind::Null | Kind::String | Kind::Boolean => {}
            Kind::Number => {
                if !host.number(current)?.is_finite() {
                    return Ok(false);
                }
            }
            Kind::Object => {
                if host.ancestor_has(current)? {
                    return Ok(false);
                }
                if !host.is_array(current)? {
                    let prototype = host.prototype(current)?;
                    if !host.is_object_prototype(prototype)? {
                        // The reference reads a nonstandard prototype twice.
                        let prototype = host.prototype(current)?;
                        if host.kind(prototype)? != Kind::Null {
                            return Ok(false);
                        }
                    }
                }
                let mut hook_owner = current;
                let mut prototype_depth = 0;
                while host.kind(hook_owner)? != Kind::Null {
                    prototype_depth += 1;
                    if prototype_depth > 64 {
                        return Ok(false);
                    }
                    match host.descriptor(hook_owner, &[116, 111, 74, 83, 79, 78])? {
                        Descriptor::Accessor => return Ok(false),
                        Descriptor::Data(value) => {
                            if host.kind(value)? == Kind::Function {
                                return Ok(false);
                            }
                            break;
                        }
                        Descriptor::Missing => hook_owner = host.prototype(hook_owner)?,
                    }
                }
                if host.is_array(current)?
                    && host.length_exceeds(current, limits.max_nodes - nodes)?
                {
                    return Ok(false);
                }
                host.ancestor_add(current)?;
                stack.push(JsonFrame {
                    owner: current,
                    children: host.properties(current)?,
                    depth,
                });
            }
            Kind::Function | Kind::Undefined | Kind::BigInt | Kind::Symbol | Kind::Other => {
                return Ok(false);
            }
        }
        loop {
            let Some(frame) = stack.last() else {
                return Ok(true);
            };
            match host.next_property(frame.children)? {
                Some(Descriptor::Data(value)) => {
                    current = value;
                    depth = frame.depth + 1;
                    break;
                }
                Some(Descriptor::Accessor | Descriptor::Missing) => return Ok(false),
                None => {
                    host.ancestor_delete(frame.owner)?;
                    stack.pop();
                }
            }
        }
    }
}
