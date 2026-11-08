//! Scope projection policy. Host operations preserve JavaScript spreads,
//! WeakMap identity and user-provided array methods.
use crate::host::Host;

enum Task<V> {
    Visit(V),
    Wrap(V, &'static str),
    Remember(V),
}

pub fn filter<H: Host>(
    host: &mut H,
    schema: H::Value,
    scope: H::Value,
) -> Result<H::Value, H::Error> {
    let mut tasks = vec![Task::Visit(schema)];
    let empty = host.call("undefined", vec![])?;
    let mut result = empty;
    while let Some(task) = tasks.pop() {
        match task {
            Task::Remember(schema) => {
                if !host.is_undefined(result)? && !host.same(result, schema)? {
                    let kind = host.get(schema, "kind")?;
                    if !host.is_kind(kind, "optional")? {
                        host.call("remember", vec![result, schema])?;
                    }
                }
            }
            Task::Wrap(schema, operation) => {
                if !host.is_undefined(result)? {
                    let mut promote = false;
                    if operation == "copyInner" {
                        let required = host.get(result, "requiredScopes")?;
                        if !host.is_nullish(required)? {
                            let includes = host.call("includes", vec![required, scope])?;
                            promote = host.is_true(includes)?;
                        }
                    }
                    if !promote {
                        result = host.call(operation, vec![schema, result])?;
                    }
                }
            }
            Task::Visit(schema) => {
                // Bound malformed/cyclic wrapper chains without a native stack
                // overflow. Callback nesting is bounded separately by the host.
                if tasks.len() >= 32_768 {
                    return host.call("stackError", vec![]);
                }
                tasks.push(Task::Remember(schema));
                let selected = host.get(schema, "scope")?;
                if !host.is_undefined(selected)? {
                    let selected = host.get(schema, "scope")?;
                    let includes = host.call("includes", vec![selected, scope])?;
                    if !host.is_true(includes)? {
                        result = empty;
                        continue;
                    }
                }
                let kind = host.get(schema, "kind")?;
                if host.is_kind(kind, "optional")? {
                    let inner = host.get(schema, "inner")?;
                    tasks.push(Task::Wrap(schema, "copyInner"));
                    tasks.push(Task::Visit(inner));
                } else if host.is_kind(kind, "array")? {
                    let item = host.get(schema, "item")?;
                    tasks.push(Task::Wrap(schema, "copyItem"));
                    tasks.push(Task::Visit(item));
                } else if host.is_kind(kind, "record")? {
                    let value = host.get(schema, "value")?;
                    tasks.push(Task::Wrap(schema, "copyValue"));
                    tasks.push(Task::Visit(value));
                } else if host.is_kind(kind, "object")? {
                    // Object spread precedes reading/filtering shape in the source.
                    let copy = host.call("copy", vec![schema])?;
                    let shape = host.get(schema, "shape")?;
                    let shape = host.call("mapShape", vec![shape, scope])?;
                    result = host.call("setShape", vec![copy, shape])?;
                } else if host.is_kind(kind, "oneOf")? || host.is_kind(kind, "union")? {
                    let branches = host.get(schema, "branches")?;
                    let one_of = host.is_kind(kind, "oneOf")?;
                    let branches = host.call(
                        if one_of {
                            "mapNamedBranches"
                        } else {
                            "mapBranches"
                        },
                        vec![branches, scope],
                    )?;
                    let exhausted =
                        host.call(if one_of { "noKeys" } else { "zeroLength" }, vec![branches])?;
                    result = if host.is_true(exhausted)? {
                        let nullable = host.get(schema, "nullable")?;
                        if host.is_true(nullable)? {
                            host.call("copyBranches", vec![schema, branches])?
                        } else {
                            empty
                        }
                    } else {
                        host.call("copyBranches", vec![schema, branches])?
                    };
                } else if host.is_kind(kind, "string")?
                    || host.is_kind(kind, "number")?
                    || host.is_kind(kind, "boolean")?
                    || host.is_kind(kind, "enum")?
                    || host.is_kind(kind, "json")?
                {
                    result = schema;
                } else {
                    result = empty;
                }
            }
        }
    }
    Ok(result)
}

pub fn filter_branch<H: Host>(
    host: &mut H,
    schema: H::Value,
    scope: H::Value,
    key: H::Value,
    entry: bool,
    objects_only: bool,
) -> Result<H::Value, H::Error> {
    let result = filter(host, schema, scope)?;
    let mut keep = !host.is_undefined(result)?;
    if keep && objects_only {
        let kind = host.get(result, "kind")?;
        keep = host.is_kind(kind, "object")?;
    }
    host.call(
        if !keep {
            "emptyArray"
        } else if entry {
            "entryArray"
        } else {
            "valueArray"
        },
        vec![key, result],
    )
}
