use super::{HybridBackend, ShellBindings, from_jstr, jstr};
use crate::budget::ShellLimits;
use crate::vfs::{host_text, shell_text, stream_byte_len};
use crate::shell::{
    eval::format_function_display,
    parser::{CommandNode, parse_script_with_extglob},
};
use mcp_protocol_rust::json::{Limits, Value, parse, stringify};
use std::collections::{BTreeMap, BTreeSet};

const SET: &[&str] = &[
    "braceexpand",
    "noglob",
    "noclobber",
    "allexport",
    "noexec",
    "pipefail",
    "errexit",
    "nounset",
];
const SHOPT: &[&str] = &[
    "dotglob",
    "globstar",
    "nullglob",
    "failglob",
    "lastpipe",
    "inherit_errexit",
    "expand_aliases",
    "nocaseglob",
    "nocasematch",
    "xpg_echo",
    "extglob",
];

fn string(s: &str) -> Value {
    Value::String(jstr(&host_text(s)))
}
fn strings<'a>(items: impl IntoIterator<Item = &'a String>) -> Value {
    Value::Array(items.into_iter().map(|s| string(s)).collect())
}
fn object<'a>(fields: impl IntoIterator<Item = (&'a str, Value)>) -> Value {
    Value::Object(fields.into_iter().map(|(k, v)| (jstr(k), v)).collect())
}
fn entries(v: Option<&Value>) -> impl Iterator<Item = (String, &Value)> {
    let pairs = match v {
        Some(Value::Object(pairs)) => pairs.as_slice(),
        _ => &[],
    };
    pairs.iter().map(|(k, v)| (shell_text(&from_jstr(k)).into_owned(), v))
}
fn text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(shell_text(&from_jstr(s)).into_owned()),
        _ => None,
    }
}
fn string_entries(v: Option<&Value>) -> impl Iterator<Item = (String, String)> {
    entries(v).filter_map(|(k, v)| Some((k, text(v)?)))
}
fn list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(text).collect(),
        _ => vec![],
    }
}
fn public_name(k: &str) -> bool {
    !k.is_empty() && !k.contains('\0') && !k.contains(['[', ']']) && k != "0"
}

impl HybridBackend {
    pub(crate) fn snapshot(
        &self,
        cwd: &str,
        env: &BTreeMap<String, String>,
        status: i32,
    ) -> String {
        let bindings = self.bindings.lock().unwrap();
        let mut arrays = BTreeMap::<&str, BTreeMap<&str, &str>>::new();
        let mut exported = BTreeSet::new();
        let mut readonly = Vec::new();
        let mut attrs = Vec::new();
        let mut aliases = Vec::new();
        let mut readonly_fns = Vec::new();
        let mut variables = BTreeMap::new();
        for (k, v) in env {
            if let Some(name) = k.strip_prefix("\0alias__") {
                aliases.push((jstr(name), string(v)));
            } else if let Some(name) = k.strip_prefix("\0readonly_fn__") {
                readonly_fns.push(string(name));
            } else if let Some(name) = k.strip_prefix("\0attr__").filter(|n| public_name(n)) {
                if v.contains('r') {
                    readonly.push(string(name));
                }
                if v.contains('x') {
                    exported.insert(name);
                }
                if v.contains(['a', 'A']) {
                    arrays.entry(name).or_default();
                }
                let flags: String = v.chars().filter(|c| "ilnu".contains(*c)).collect();
                if !flags.is_empty() {
                    attrs.push((jstr(name), string(&flags)));
                }
            } else if let Some(name) = k.strip_prefix("\0nameref__").filter(|n| public_name(n)) {
                variables.insert(name, string(v));
                attrs.push((jstr(name), string("n")));
            } else if let Some(name) = k
                .strip_prefix("\0keys__")
                .or_else(|| k.strip_prefix("\0assoc__"))
                .filter(|n| public_name(n))
            {
                arrays.entry(name).or_default();
            } else if let Some((name, key)) = k
                .strip_suffix(']')
                .and_then(|k| k.split_once('['))
                .filter(|(n, _)| public_name(n))
            {
                arrays.entry(name).or_default().insert(key, v);
            } else if public_name(k) {
                variables.insert(k.as_str(), string(v));
            }
        }
        // DIRSTACK is a computed view of cwd and directoryStack.
        arrays.remove("DIRSTACK");
        variables.remove("DIRSTACK");
        let arrays = object(arrays.into_iter().map(|(name, mut elements)| {
            variables.remove(name);
            let assoc = env.contains_key(&format!("\0assoc__{name}"))
                || env
                    .get(&format!("\0attr__{name}"))
                    .is_some_and(|s| s.contains('A'));
            let keys = env.get(&format!("\0keys__{name}"));
            let mut ordered = Vec::with_capacity(elements.len());
            if assoc && let Some(keys) = keys {
                for key in keys.split('\x1f') {
                    if let Some(value) = elements.remove(key) {
                        ordered.push((jstr(&host_text(key)), string(value)));
                    }
                }
            }
            ordered.extend(
                elements
                    .into_iter()
                    .map(|(key, value)| (jstr(&host_text(key)), string(value))),
            );
            (
                name,
                object([
                    (
                        "kind",
                        string(if assoc { "associative" } else { "indexed" }),
                    ),
                    (
                        "assigned",
                        Value::Bool(keys.is_some() || !ordered.is_empty()),
                    ),
                    ("elements", Value::Object(ordered)),
                ]),
            )
        }));
        exported.extend(
            variables.keys().copied().filter(|k| {
                *k != "BASH_COMMAND" && !env.contains_key(&format!("\0unexported__{k}"))
            }),
        );
        let stack = env
            .get("\0dirstack")
            .into_iter()
            .flat_map(|v| v.split('\x1f'))
            .map(string)
            .collect();
        let options = object([("set", SET), ("shopt", SHOPT)].into_iter().flat_map(
            |(prefix, names)| {
                names.iter().map(move |&name| {
                    let flag = env
                        .get(&format!("\0{prefix}_{name}"))
                        .map_or(name == "braceexpand", |v| v == "1");
                    (name, Value::Bool(flag))
                })
            },
        ));
        stringify(&object([
            ("cwd", Value::String(jstr(cwd))),
            ("status", Value::Number(status.into())),
            (
                "umask",
                Value::Number(
                    env.get("\0umask")
                        .and_then(|s| u32::from_str_radix(s, 8).ok())
                        .unwrap_or(0o22)
                        .into(),
                ),
            ),
            ("variables", object(variables)),
            ("aliases", Value::Object(aliases)),
            ("arrays", arrays),
            ("variableAttributes", Value::Object(attrs)),
            ("readonlyVariables", Value::Array(readonly)),
            (
                "exported",
                Value::Array(exported.into_iter().map(string).collect()),
            ),
            ("directoryStack", Value::Array(stack)),
            ("options", options),
            ("positionalParams", strings(&bindings.positional)),
            ("exportedFunctions", strings(&bindings.exported_functions)),
            ("readonlyFunctions", Value::Array(readonly_fns)),
            (
                "functions",
                object(
                    bindings
                        .functions
                        .iter()
                        .map(|(k, body)| (k.as_str(), string(&format_function_display(k, body)))),
                ),
            ),
        ]))
    }

    pub(crate) fn restore(
        &self,
        input: &[u8],
        env: &mut BTreeMap<String, String>,
        limits: &ShellLimits,
    ) -> Result<String, String> {
        let v = parse(
            input,
            Limits {
                max_bytes: limits.max_input_bytes,
                max_depth: 8,
                max_nodes: limits.max_input_bytes,
            },
        )
        .map_err(|e| e.to_string())?;
        let cwd = v
            .get("cwd")
            .and_then(text)
            .ok_or("Session state needs cwd")?;
        let cwd = crate::vfs::normalize_posix_path(&cwd);
        let positional = list(v.get("positionalParams"));
        if positional.iter().map(|s| stream_byte_len(s)).sum::<usize>() > limits.max_expansion_bytes {
            return Err("Shell limit exceeded: maxExpansionBytes".into());
        }
        let exported: BTreeSet<_> = list(v.get("exported")).into_iter().collect();
        for (k, s) in string_entries(v.get("variables")).filter(|(k, _)| public_name(k)) {
            if !exported.contains(&k) {
                env.insert(format!("\0unexported__{k}"), "1".into());
            }
            env.insert(k, s);
        }
        env.insert("PWD".into(), cwd.clone());
        let mut alias_bytes = 0;
        for (name, val) in string_entries(v.get("aliases")) {
            alias_bytes += stream_byte_len(&name) + stream_byte_len(&val);
            if alias_bytes > limits.max_expansion_bytes {
                return Err("Shell limit exceeded: maxExpansionBytes".into());
            }
            env.insert(format!("\0alias__{name}"), val);
        }
        for (name, arr) in entries(v.get("arrays")).filter(|(k, _)| public_name(k)) {
            let assoc = arr.get("kind").and_then(text).as_deref() == Some("associative");
            if assoc {
                env.insert(format!("\0assoc__{name}"), "1".into());
            }
            env.insert(
                format!("\0attr__{name}"),
                if assoc { "A" } else { "a" }.into(),
            );
            env.remove(&name);
            let mut keys = vec![];
            for (key, val) in string_entries(arr.get("elements")) {
                if !assoc && key.parse::<u64>().is_err() {
                    continue;
                }
                if key == "0" {
                    env.insert(name.clone(), val.clone());
                }
                env.insert(format!("{name}[{key}]"), val);
                keys.push(key);
            }
            if !assoc {
                keys.sort_by_key(|k| k.parse::<u64>().unwrap());
            }
            if !keys.is_empty() || arr.get("assigned") != Some(&Value::Bool(false)) {
                env.insert(format!("\0keys__{name}"), keys.join("\x1f"));
            }
        }
        for (k, flags) in
            string_entries(v.get("variableAttributes")).filter(|(k, _)| public_name(k))
        {
            if flags.contains('n')
                && let Some(target) = env.get(&k).cloned()
            {
                env.insert(format!("\0nameref__{k}"), target);
            }
            env.entry(format!("\0attr__{k}"))
                .or_default()
                .extend(flags.chars().filter(|c| "ilnu".contains(*c)));
        }
        for k in exported.iter().filter(|k| public_name(k)) {
            env.remove(&format!("\0unexported__{k}"));
            env.entry(format!("\0attr__{k}")).or_default().push('x');
        }
        for k in list(v.get("readonlyVariables"))
            .into_iter()
            .filter(|k| public_name(k))
        {
            env.entry(format!("\0attr__{k}")).or_default().push('r');
        }
        for k in list(v.get("readonlyFunctions")) {
            env.insert(format!("\0readonly_fn__{k}"), "1".into());
        }
        if let Some(Value::Number(n)) = v.get("umask") {
            env.insert("\0umask".into(), format!("{:04o}", (*n as u32) & 0o777));
        }
        if let Some(Value::Number(n)) = v.get("status") {
            env.insert("\0last_exit".into(), (*n as i32).to_string());
        }
        let stack = list(v.get("directoryStack"));
        if !stack.is_empty() {
            env.insert("\0dirstack".into(), stack.join("\x1f"));
        }
        for (prefix, names) in [("set", SET), ("shopt", SHOPT)] {
            for &name in names {
                if let Some(Value::Bool(b)) = v.get("options").and_then(|opts| opts.get(name)) {
                    env.insert(
                        format!("\0{prefix}_{name}"),
                        if *b { "1" } else { "0" }.into(),
                    );
                }
            }
        }
        let extglob = env.get("\0shopt_extglob").is_some_and(|v| v == "1");
        let mut functions = BTreeMap::new();
        for (name, src) in string_entries(v.get("functions")) {
            if stream_byte_len(&src) > limits.max_source_bytes {
                return Err("Shell limit exceeded: maxSourceBytes".into());
            }
            if let Ok(script) = parse_script_with_extglob(&src, extglob)
                && let [list] = script.lists.as_slice()
                && !list.background
                && list.rest.is_empty()
                && !list.first.negated
                && let [CommandNode::FuncDef { body, .. }] = list.first.commands.as_slice()
            {
                if limits.max_parse_units == 0 {
                    return Err("Shell limit exceeded: maxParseUnits".into());
                }
                functions.insert(name, *body.clone());
            }
        }
        *self.bindings.lock().unwrap() = ShellBindings {
            functions,
            positional,
            exported_functions: list(v.get("exportedFunctions")).into_iter().collect(),
        };
        Ok(host_text(&cwd).into_owned())
    }
}
