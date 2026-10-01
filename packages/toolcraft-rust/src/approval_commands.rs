//! Approval built-in admission, filtering, presentation and runtime policies.
use crate::host::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("merge", [root]) => {
            let existing = host.call("findExisting", vec![*root])?;
            if !host.is_undefined(existing)? {
                let kind = host.get(existing, "kind")?;
                if host.is_kind(kind, "group")? {
                    let marked = host.call("marked", vec![existing])?;
                    if host.is_true(marked)? {
                        return Ok(*root);
                    }
                }
                return host.call("reserved", vec![]);
            }
            host.call("merged", vec![*root])
        }
        ("runtime", [options]) => {
            if host.is_nullish(*options)? {
                return host.call("missingProvider", vec![]);
            }
            let provider = host.get(*options, "provider")?;
            if host.is_undefined(provider)? {
                return host.call("missingProvider", vec![]);
            }
            host.call("copy", vec![*options])
        }
        ("filter", [states]) => {
            let empty = host.call("empty", vec![*states])?;
            host.call(
                if host.is_true(empty)? {
                    "false"
                } else {
                    "true"
                },
                vec![],
            )
        }
        ("collect", [task, seen, approvals]) => {
            let id = host.get(*task, "qualifiedId")?;
            let duplicate = host.call("has", vec![*seen, id])?;
            if !host.is_true(duplicate)? {
                let id = host.get(*task, "qualifiedId")?;
                host.call("add", vec![*seen, id])?;
                host.call("push", vec![*approvals, *task])?;
            }
            host.call("undefined", vec![])
        }
        ("listError", [error]) => {
            let missing = host.call("missingState", vec![*error])?;
            if host.is_true(missing)? {
                host.call("array", vec![])
            } else {
                host.call("throw", vec![*error])
            }
        }
        ("taskError", [id, error]) => {
            let missing = host.call("missingTask", vec![*error])?;
            let missing = if host.is_true(missing)? {
                true
            } else {
                let missing = host.call("missingState", vec![*error])?;
                host.is_true(missing)?
            };
            if missing {
                host.call("notFound", vec![*id])
            } else {
                host.call("throw", vec![*error])
            }
        }
        ("listRich", [result, logger, table, theme]) => {
            let empty = host.call("empty", vec![*result])?;
            host.call(
                if host.is_true(empty)? {
                    "emptyMessage"
                } else {
                    "listTable"
                },
                vec![*result, *logger, *table, *theme],
            )
        }
        ("listMarkdown", [result]) => {
            let empty = host.call("empty", vec![*result])?;
            host.call(
                if host.is_true(empty)? {
                    "emptyText"
                } else {
                    "listMarkdown"
                },
                vec![*result],
            )
        }
        ("runRich", [result, primitives]) => {
            let truthy = host.call("truthy", vec![*result])?;
            if host.is_true(truthy)? {
                host.call("detailsRich", vec![*result, *primitives])?;
            }
            host.call("undefined", vec![])
        }
        ("runMarkdown", [result]) => {
            let truthy = host.call("truthy", vec![*result])?;
            host.call(
                if host.is_true(truthy)? {
                    "detailsMarkdown"
                } else {
                    "emptyString"
                },
                vec![*result],
            )
        }
        ("listRow", [task]) | ("taskRecord", [task]) => {
            let record = host.call("record", vec![])?;
            let fields: &[&str] = if operation == "listRow" {
                &["id", "state", "name"]
            } else {
                &[
                    "list",
                    "id",
                    "qualifiedId",
                    "name",
                    "state",
                    "description",
                    "metadata",
                ]
            };
            for key in fields {
                let value = host.get(*task, key)?;
                host.call(&format!("define:{key}"), vec![record, value])?;
            }
            Ok(record)
        }
        ("stringify", [value]) => {
            if host.is_undefined(*value)? {
                return host.call("emptyString", vec![]);
            }
            let string = host.call("string", vec![*value])?;
            if host.is_true(string)? {
                Ok(*value)
            } else {
                host.call("serialize", vec![*value])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
