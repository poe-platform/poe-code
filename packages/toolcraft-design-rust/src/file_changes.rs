//! File status, summaries and unified-hunk policies over observable host values.
pub const KINDS: [(&str, &str); 4] = [
    ("added", "A"),
    ("modified", "M"),
    ("deleted", "D"),
    ("renamed", "R"),
];

pub trait Host {
    type Value: Copy;
    type Error;
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value, Self::Error>;
    fn call(&mut self, operation: &str, args: Vec<Self::Value>)
    -> Result<Self::Value, Self::Error>;
    fn literal(&mut self, text: &str) -> Result<Self::Value, Self::Error>;
    fn number(&mut self, value: f64) -> Result<Self::Value, Self::Error>;
    fn numeric(&mut self, value: Self::Value) -> Result<f64, Self::Error>;
    fn is_kind(&self, value: Self::Value, kind: &str) -> Result<bool, Self::Error>;
    fn is_nullish(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_true(&self, value: Self::Value) -> Result<bool, Self::Error>;
}
fn predicate<H: Host>(
    host: &mut H,
    operation: &str,
    args: Vec<H::Value>,
) -> Result<bool, H::Error> {
    let value = host.call(operation, args)?;
    host.is_true(value)
}
fn length<H: Host>(host: &mut H, value: H::Value) -> Result<f64, H::Error> {
    let value = host.get(value, "length")?;
    host.numeric(value)
}
fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}
fn limit<H: Host>(host: &mut H, old: H::Value, new: H::Value) -> Result<f64, H::Error> {
    let old = host.get(old, "length")?;
    let new = host.get(new, "length")?;
    Ok(min(host.numeric(old)?, host.numeric(new)?))
}
fn content_lines<H: Host>(host: &mut H, content: H::Value) -> Result<H::Value, H::Error> {
    let lines = host.call("split", vec![content])?;
    let last = host.call("last", vec![lines])?;
    if host.is_kind(last, "")? {
        host.call("pop", vec![lines])?;
    }
    Ok(lines)
}
fn hunk<H: Host>(host: &mut H, old: H::Value, new: H::Value) -> Result<H::Value, H::Error> {
    let old = content_lines(host, old)?;
    let new = content_lines(host, new)?;
    let prefix_limit = limit(host, old, new)?;
    let mut prefix = 0.0;
    while prefix < prefix_limit {
        let index = host.number(prefix)?;
        if !predicate(host, "equalAt", vec![old, new, index])? {
            break;
        }
        prefix += 1.0;
    }
    let suffix_limit = limit(host, old, new)? - prefix;
    let mut suffix = 0.0;
    while suffix < suffix_limit {
        let index = host.number(suffix)?;
        if !predicate(host, "equalTail", vec![old, new, index])? {
            break;
        }
        suffix += 1.0;
    }
    let old_change_end = length(host, old)? - suffix;
    let new_change_end = length(host, new)? - suffix;
    let old_start = (prefix - 3.0).max(0.0);
    let new_start = (prefix - 3.0).max(0.0);
    let old_end = min(length(host, old)?, old_change_end + 3.0);
    let new_end = min(length(host, new)?, new_change_end + 3.0);
    let old_count = old_end - old_start;
    let new_count = new_end - new_start;
    let old_start_value = host.number(old_start)?;
    let prefix_value = host.number(prefix)?;
    let old_change_end_value = host.number(old_change_end)?;
    let new_change_end_value = host.number(new_change_end)?;
    let old_end_value = host.number(old_end)?;
    let space = host.literal(" ")?;
    let minus = host.literal("-")?;
    let plus = host.literal("+")?;
    let before = host.call(
        "sliceLines",
        vec![old, old_start_value, prefix_value, space],
    )?;
    let removed = host.call(
        "sliceLines",
        vec![old, prefix_value, old_change_end_value, minus],
    )?;
    let added = host.call(
        "sliceLines",
        vec![new, prefix_value, new_change_end_value, plus],
    )?;
    let after = host.call(
        "sliceLines",
        vec![old, old_change_end_value, old_end_value, space],
    )?;
    let old_line = host.number(if old_count == 0.0 {
        0.0
    } else {
        old_start + 1.0
    })?;
    let old_count = host.number(old_count)?;
    let new_line = host.number(if new_count == 0.0 {
        0.0
    } else {
        new_start + 1.0
    })?;
    let new_count = host.number(new_count)?;
    host.call(
        "hunk",
        vec![
            old_line, old_count, new_line, new_count, before, removed, added, after,
        ],
    )
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("render", [changes, options]) => {
            let count = host.get(*changes, "length")?;
            if predicate(host, "zero", vec![count])? {
                return host.literal("No file changes.");
            }
            let mode = host.get(*options, "mode")?;
            let format = host.get(*options, "format")?;
            let format = if host.is_nullish(format)? {
                host.literal("terminal")?
            } else {
                format
            };
            if host.is_kind(mode, "diff")? {
                let output = host.call("diff", vec![*changes])?;
                if host.is_kind(format, "markdown")? {
                    host.call("diffMarkdown", vec![output])
                } else {
                    host.call("diffTerminal", vec![output])
                }
            } else {
                let output = host.call("status", vec![*changes, format])?;
                if host.is_kind(format, "markdown")? {
                    host.call("statusMarkdown", vec![output])
                } else {
                    Ok(output)
                }
            }
        }
        ("path", [change]) => {
            let kind = host.get(*change, "kind")?;
            if host.is_kind(kind, "renamed")? {
                let old = host.get(*change, "oldPath")?;
                if predicate(host, "truthy", vec![old])? {
                    return host.call("renamePath", vec![*change]);
                }
            }
            host.get(*change, "path")
        }
        ("statusRow", [change, format]) => {
            let kind = host.get(*change, "kind")?;
            let prefix = host.call("marker", vec![kind])?;
            let conflict = host.get(*change, "conflict")?;
            let conflict = predicate(host, "truthy", vec![conflict])?;
            let suffix = host.literal(if conflict { "!" } else { " " })?;
            let marker = host.call("concat", vec![prefix, suffix])?;
            let marker = if host.is_kind(*format, "terminal")? {
                run(host, "statusColor", &[*change, marker])?
            } else {
                marker
            };
            let marker = host.call("stringify", vec![marker])?;
            let path = run(host, "path", &[*change])?;
            host.call("statusLine", vec![marker, path])
        }
        ("statusColor", [change, marker]) => {
            let conflict = host.get(*change, "conflict")?;
            if predicate(host, "truthy", vec![conflict])? {
                return host.call("conflictColor", vec![*marker]);
            }
            let kind = host.get(*change, "kind")?;
            for (name, color) in [
                ("added", "green"),
                ("modified", "yellow"),
                ("deleted", "red"),
                ("renamed", "cyan"),
            ] {
                if host.is_kind(kind, name)? {
                    let color = host.literal(color)?;
                    return host.call("color", vec![color, *marker]);
                }
            }
            host.call("undefined", vec![])
        }
        ("count", [counts, state, change]) => {
            // Host Map operations preserve SameValueZero keys and both kind reads.
            host.call("countKind", vec![*counts, *change])?;
            let conflict = host.get(*change, "conflict")?;
            if predicate(host, "truthy", vec![conflict])? {
                host.call("countConflict", vec![*state])?;
            }
            Ok(*state)
        }
        ("summaryDetail", [counts, kind]) => {
            let count = host.call("countGet", vec![*counts, *kind])?;
            if predicate(host, "positive", vec![count])? {
                host.call("detail", vec![count, *kind])
            } else {
                host.call("array", vec![])
            }
        }
        ("summaryFinish", [changes, details, state]) => {
            let conflicts = host.get(*state, "conflicts")?;
            if predicate(host, "positive", vec![conflicts])? {
                let single = predicate(host, "one", vec![conflicts])?;
                let noun = host.literal(if single { "conflict" } else { "conflicts" })?;
                host.call("appendConflict", vec![*details, conflicts, noun])?;
            }
            host.call("summaryLine", vec![*changes, *details])
        }
        ("summaryNoun", [length]) => {
            let one = predicate(host, "one", vec![*length])?;
            host.literal(if one { "change" } else { "changes" })
        }
        ("patch", [change]) => {
            let kind = host.get(*change, "kind")?;
            let old_path = if host.is_kind(kind, "added")? {
                host.literal("/dev/null")?
            } else {
                let old = host.get(*change, "oldPath")?;
                let old = if host.is_nullish(old)? {
                    host.get(*change, "path")?
                } else {
                    old
                };
                host.call("oldPath", vec![old])?
            };
            let kind = host.get(*change, "kind")?;
            let new_path = if host.is_kind(kind, "deleted")? {
                host.literal("/dev/null")?
            } else {
                let path = host.get(*change, "path")?;
                host.call("newPath", vec![path])?
            };
            let kind = host.get(*change, "kind")?;
            let old = if host.is_kind(kind, "added")? {
                host.literal("")?
            } else {
                let value = host.get(*change, "oldContent")?;
                if host.is_nullish(value)? {
                    host.literal("")?
                } else {
                    value
                }
            };
            let kind = host.get(*change, "kind")?;
            let new = if host.is_kind(kind, "deleted")? {
                host.literal("")?
            } else {
                let value = host.get(*change, "newContent")?;
                if host.is_nullish(value)? {
                    host.literal("")?
                } else {
                    value
                }
            };
            let headers = host.call("headers", vec![old_path, new_path])?;
            if predicate(host, "different", vec![old, new])? {
                host.call("patchHunk", vec![headers, old, new])
            } else {
                host.call("joinLines", vec![headers])
            }
        }
        ("hunk", [old, new]) => hunk(host, *old, *new),
        ("diffColor", [line]) => {
            for (prefix, color) in [
                ("@@", "cyan"),
                ("+++", "bold"),
                ("---", "bold"),
                ("+", "green"),
                ("-", "red"),
            ] {
                let prefix = host.literal(prefix)?;
                if predicate(host, "startsWith", vec![*line, prefix])? {
                    let color = host.literal(color)?;
                    return host.call("color", vec![color, *line]);
                }
            }
            Ok(*line)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
