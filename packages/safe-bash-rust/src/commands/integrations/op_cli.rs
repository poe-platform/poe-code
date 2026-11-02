use super::{
    BuiltinOutcome, OP_ROOT_HELP, is_op_go_duration, is_op_password_recipe,
    is_valid_op_vault_permission, op_bool, op_err, op_topics, parse_op_file_mode_str,
    supported_op_encoding,
};
use std::borrow::Cow;
use std::collections::BTreeMap;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Kind {
    Bool,
    Value,
    Optional,
}

pub(super) struct Command {
    pub path: &'static str,
    pub args: Vec<String>,
    pub format_json: bool,
    pub reveal: bool,
    pub vault: Option<String>,
    pub selection: Option<&'static str>,
}

struct Scan {
    vault: Option<String>,
    path: &'static str,
    group: bool,
    help: &'static str,
    help_word: bool,
    operands: usize,
    switches: BTreeMap<&'static str, bool>,
    globals: BTreeMap<&'static str, String>,
    args: Vec<String>,
}

fn validate_value(name: &str, value: &str) -> Result<(), String> {
    let valid = match name {
        "--file-mode" => parse_op_file_mode_str(value).is_some(),
        "--allow-admins-to-manage" => op_bool(value).is_some(),
        "--travel-mode" => matches!(value, "on" | "off"),
        "--ssh-generate-key" => matches!(
            value.to_ascii_lowercase().as_str(),
            "ed25519"
                | "rsa"
                | "rsa2048"
                | "rsa3072"
                | "rsa4096"
                | "rsa-2048"
                | "rsa-3072"
                | "rsa-4096"
        ),
        "--deauthorize-devices-after" => is_op_go_duration(value),
        "--generate-password" => is_op_password_recipe(value),
        "--role" => matches!(value.to_ascii_lowercase().as_str(), "manager" | "member"),
        "--permission" | "--permissions" => is_valid_op_vault_permission(value),
        _ => true,
    };
    if valid {
        Ok(())
    } else {
        Err(format!("invalid value for {name}"))
    }
}

// First resolve the command with the flags of its possible descendants. Then
// parse again with just that command’s flags. This also resolves aliases and
// chooses the diagnostic before a handler can touch the object store.
fn scan(args: &[String], resolved: Option<&str>) -> Result<Scan, String> {
    let mut scan = Scan {
        vault: None,
        path: "",
        group: true,
        help: OP_ROOT_HELP,
        help_word: false,
        operands: 0,
        switches: BTreeMap::new(),
        globals: BTreeMap::new(),
        args: Vec::new(),
    };
    let mut local_flags = Vec::new();
    let mut literal = None;
    let mut words = args.iter();
    let mut pending = None;
    while let Some(word) = pending
        .take()
        .or_else(|| words.next().map(|s| Cow::Borrowed(s.as_str())))
    {
        let token = word.as_ref();
        if token == "--" {
            scan.operands += words.len();
            if resolved.is_some() {
                literal = Some(scan.args.len());
                scan.args.extend(words.cloned());
            }
            break;
        }
        if token.starts_with('-') && token != "-" {
            let short = !token.starts_with("--");
            let cluster = short && token[1..].chars().nth(1).is_some_and(|c| c != '=');
            let (spelling, mut value) = if cluster {
                let end = 1 + token[1..].chars().next().unwrap().len_utf8();
                (&token[..end], Some(&token[end..]))
            } else {
                token
                    .split_once('=')
                    .map_or((token, None), |(k, v)| (k, Some(v)))
            };
            let path = resolved.unwrap_or(scan.path);
            let Some((name, kind, global)) =
                op_topics::flag(spelling).filter(|(name, _, global)| {
                    if *global {
                        return *name != "--version" || path.is_empty();
                    }
                    op_topics::local_paths(name).iter().any(|p| {
                        *p == path
                            || (resolved.is_none()
                                && (path.is_empty()
                                    || p.strip_prefix(path).is_some_and(|s| s.starts_with(' '))))
                    })
                })
            else {
                return Err(if cluster {
                    format!("unknown shorthand flag: {}", &spelling[1..])
                } else {
                    format!("unknown flag: {spelling}")
                });
            };
            if cluster && kind == Kind::Bool {
                pending = Some(Cow::Owned(format!("-{}", value.take().unwrap())));
            }
            if value.is_none() && resolved.is_none() && scan.group && !global {
                words.next();
                continue;
            }
            if kind == Kind::Value && value.is_none() {
                value = Some(
                    words
                        .next()
                        .ok_or_else(|| format!("flag needs a value: {name}"))?,
                );
            }
            let enabled = if kind == Kind::Bool {
                op_bool(value.unwrap_or("true"))
                    .ok_or_else(|| format!("invalid boolean value for {name}"))?
            } else {
                if let Some(v) = value {
                    validate_value(name, v)?;
                }
                true
            };
            if resolved.is_some() {
                if global {
                    scan.globals.insert(
                        name,
                        if kind == Kind::Bool {
                            enabled.to_string()
                        } else {
                            value.unwrap().to_owned()
                        },
                    );
                } else {
                    match kind {
                        Kind::Value if matches!(name, "--vault" | "--current-vault") &&
                            resolved.is_some_and(|p| p.starts_with("item ") || p.starts_with("document ")) => {
                            scan.vault = value.map(str::to_owned);
                        }
                        Kind::Value => {
                            local_flags.push(name.into());
                            local_flags.push(value.unwrap().into());
                        }
                        Kind::Optional => local_flags
                            .push(value.map_or_else(|| name.to_owned(), |v| format!("{name}={v}"))),
                        Kind::Bool => {
                            scan.switches.insert(name, enabled);
                        }
                    }
                }
            }
        } else if token == "help" && scan.path.is_empty() {
            scan.help_word = true;
        } else if scan.group {
            let Some((path, group, help)) = op_topics::child(scan.path, token) else {
                return Err(format!(
                    "unknown command: {}{token}",
                    if scan.path.is_empty() {
                        String::new()
                    } else {
                        format!("{} ", scan.path)
                    }
                ));
            };
            scan.path = path;
            scan.group = group;
            scan.help = help;
        } else {
            scan.operands += 1;
            if resolved.is_some() {
                scan.args.push(word.into_owned());
            }
        }
    }
    if resolved.is_some() {
        local_flags.extend(
            scan.switches
                .iter()
                .filter(|(_, on)| **on)
                .map(|(name, _)| (*name).to_owned()),
        );
        if scan.path == "run" {
            // The child receives exactly the parsed operands, regardless of where
            // the caller put op flags or the literal boundary.
            local_flags.push("--".into());
            local_flags.append(&mut scan.args);
            scan.args = local_flags;
        } else {
            let at = literal.unwrap_or(scan.args.len());
            if literal.is_some() {
                local_flags.push("--".into());
            }
            scan.args.splice(at..at, local_flags);
        }
    }
    Ok(scan)
}

pub(super) fn parse(
    args: &[String],
    env: &BTreeMap<String, String>,
) -> Result<Command, BuiltinOutcome> {
    let path = scan(args, None).map_err(|e| op_err(&e))?.path;
    let scan = scan(args, Some(path)).map_err(|e| op_err(&e))?;
    let setting = |flag, var| {
        scan.globals
            .get(flag)
            .or_else(|| env.get(var).filter(|v| !v.is_empty()))
    };
    for (flag, var) in [("--cache", "OP_CACHE"), ("--debug", "OP_DEBUG")] {
        if setting(flag, var).is_some_and(|v| op_bool(v).is_none()) {
            return Err(op_err(&format!("invalid boolean value for {flag}")));
        }
    }
    let format = setting("--format", "OP_FORMAT").map(String::as_str);
    if format.is_some_and(|v| !matches!(v, "json" | "human-readable")) {
        return Err(op_err("format must be json or human-readable"));
    }
    let enabled = |name| scan.globals.get(name).is_some_and(|v| v == "true");
    let version = enabled("--version");
    let help = enabled("--help");
    if !version
        && !help
        && scan
            .globals
            .get("--encoding")
            .is_some_and(|v| !supported_op_encoding(v))
    {
        return Err(op_err("unsupported character-encoding"));
    }
    if version || help || scan.help_word || path.is_empty() || (scan.group && scan.operands == 0) {
        return Err(BuiltinOutcome {
            stdout: if version { "0.0.1\n" } else { scan.help }.into(),
            stderr: String::new(),
            exit_code: 0,
        });
    }
    if scan.group {
        return Err(op_err("a command is required"));
    }
    let (min, max) = op_topics::operand_bounds(path);
    if scan.operands < min {
        return Err(op_err(&format!(
            "expected at least {min} arguments but got {} instead",
            scan.operands
        )));
    }
    if let Some(max) = max
        && scan.operands > max
    {
        return Err(op_err(&format!(
            "expected at most {max} arguments but got {} instead",
            scan.operands
        )));
    }
    // Only companion backends can supply configured accounts or issued sessions.
    let selection = if setting("--account", "OP_ACCOUNT").is_some() {
        Some("Account selection is required")
    } else if setting("--session", "OP_SESSION").is_some() {
        Some("Invalid session")
    } else {
        None
    };
    Ok(Command {
        path,
        format_json: format == Some("json"),
        reveal: scan.switches.get("--reveal") == Some(&true),
        selection,
        vault: scan.vault,
        args: path
            .split(' ')
            .map(str::to_owned)
            .chain(scan.args)
            .collect(),
    })
}
