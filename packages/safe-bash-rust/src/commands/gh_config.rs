use super::structured::{JVal, parse_json_stream};
use crate::vfs::{SafeBashFs, resolve_posix_path};
use config_mutations_rust::yaml::document::{Document, Kind, mapping_slot, scan};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Default)]
pub(super) struct Config {
    pub values: BTreeMap<String, String>,
    pub hosts: Vec<(String, BTreeMap<String, String>)>,
    pub host_source: String,
    pub original: Option<String>,
}

fn entries(doc: &Document, node: usize) -> impl Iterator<Item = (String, usize)> + '_ {
    doc.nodes[node]
        .children
        .chunks_exact(2)
        .filter_map(move |pair| {
            let key = &doc.nodes[pair[0]];
            (doc.nodes[node].kind == Kind::Mapping && key.kind == Kind::Scalar)
                .then(|| (String::from_utf16_lossy(&key.text), pair[1]))
        })
}

fn settings(doc: &Document, node: usize) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for (key, value) in entries(doc, node) {
        values
            .entry(key)
            .or_insert_with(|| String::from_utf16_lossy(&doc.nodes[value].text));
    }
    values
}

fn decode_yaml(bytes: Vec<u8>) -> Option<String> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let chunks = bytes[2..].chunks_exact(2);
        if !chunks.remainder().is_empty() {
            return None;
        }
        let decode = if bytes[0] == 0xff {
            u16::from_le_bytes
        } else {
            u16::from_be_bytes
        };
        let units: Vec<_> = chunks.map(|pair| decode([pair[0], pair[1]])).collect();
        String::from_utf16(&units).ok()?
    } else {
        let mut text = String::from_utf8(bytes).ok()?;
        if text.starts_with('\u{feff}') {
            text.drain(..3);
        }
        text
    };
    text.chars().all(|c| matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{7e}' | '\u{85}' | '\u{a0}'..='\u{fffd}' | '\u{10000}'..)).then_some(text)
}

pub(super) fn read(fs: &dyn SafeBashFs, cwd: &str, dir: &str) -> Result<Config, String> {
    let mut config = Config::default();
    let mut remaining = fs.max_input_bytes();
    for name in ["config.yml", "hosts.yml"] {
        let display = format!("{}/{name}", dir.trim_end_matches('/'));
        let path = resolve_posix_path(cwd, &display);
        let load_error = |msg: String| {
            format!(
                "warning: failed to load config: {msg}\nfailed to create root command: failed to read configuration: {msg}\n"
            )
        };
        let io_error = |e: String| {
            let (op, reason) = match e.split(':').next() {
                Some("EACCES") => ("open", "permission denied"),
                Some("EISDIR") => ("read", "is a directory"),
                Some("ELOOP") => ("open", "too many levels of symbolic links"),
                Some("ENOTDIR") => ("open", "not a directory"),
                _ if cfg!(unix) && e.ends_with("(os error 13)") => ("open", "permission denied"),
                _ if cfg!(unix) && e.ends_with("(os error 21)") => ("read", "is a directory"),
                _ if cfg!(unix) && e.ends_with("(os error 20)") => ("open", "not a directory"),
                _ if e.starts_with("Too many levels of symbolic links") => {
                    ("open", "too many levels of symbolic links")
                }
                _ => return e,
            };
            load_error(format!("{op} {display}: {reason}"))
        };
        fs.command_descriptor_op()?;
        let stat = match fs.stat(&path) {
            Ok(stat) => stat,
            Err(e) if e.starts_with("ENOENT") || e.ends_with("(os error 2)") => continue,
            Err(e) => return Err(io_error(e)),
        };
        if stat.size > remaining {
            return Err("gh input byte limit exceeded".into());
        }
        let bytes = fs.read_file(&path).map_err(io_error)?;
        remaining = remaining
            .checked_sub(bytes.len())
            .ok_or("gh input byte limit exceeded")?;
        let invalid = |reason| load_error(format!("invalid config file {display}: {reason}"));
        let text = decode_yaml(bytes).ok_or_else(|| invalid("invalid yaml"))?;
        let source: Vec<_> = text.encode_utf16().collect();
        let doc = scan(&source).map_err(|_| invalid("invalid yaml"))?;
        let root = &doc.nodes[doc.root];
        if root.kind == Kind::Scalar && root.text.is_empty() && !root.quoted {
            continue;
        }
        if root.kind != Kind::Mapping {
            return Err(invalid("invalid format"));
        }
        let hosts = if name == "config.yml" {
            config.values = settings(&doc, doc.root);
            config.original = Some(text);
            entries(&doc, doc.root)
                .find(|(key, _)| key == "hosts")
                .map(|(_, node)| node)
        } else if !root.children.is_empty() {
            config.host_source = text;
            if config.values.contains_key("hosts") {
                continue;
            }
            config.values.insert("hosts".into(), String::new());
            Some(doc.root)
        } else {
            None
        };
        if let Some(hosts) = hosts {
            if name == "config.yml" && doc.nodes[hosts].kind == Kind::Mapping {
                let node = &doc.nodes[hosts];
                let start = if node.flow {
                    node.start
                } else {
                    node.children
                        .first()
                        .map_or(node.start, |id| doc.nodes[*id].start)
                };
                let prefix = source[..start]
                    .iter()
                    .rev()
                    .take_while(|u| **u == 32)
                    .count();
                let snippet = String::from_utf16_lossy(&source[start..node.end]);
                let indent = " ".repeat(prefix);
                config.host_source = if node.flow {
                    snippet
                } else {
                    snippet
                        .split('\n')
                        .enumerate()
                        .map(|(i, line)| {
                            if i == 0 {
                                line
                            } else {
                                line.strip_prefix(&indent).unwrap_or(line)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                };
            }
            for (name, host) in entries(&doc, hosts) {
                config.hosts.push((name, settings(&doc, host)));
            }
        }
    }
    if config.values.is_empty() {
        config.original = None;
    } else if config.original.is_none() {
        config.original = Some(String::new());
    }
    Ok(config)
}

pub(super) fn default_config() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        let lines = include_str!("../../../safe-bash-command-gh/src/config-defaults.json");
        let JVal::Array(lines) = parse_json_stream(lines).unwrap().remove(0) else {
            unreachable!()
        };
        lines
            .into_iter()
            .map(|line| match line {
                JVal::Str(s) => s + "\n",
                _ => unreachable!(),
            })
            .collect()
    })
}

fn scalar(text: &str, flow: bool, key: bool) -> String {
    let double = || JVal::Str(text.to_owned()).to_json_string(true, false, 0);
    if text.is_empty() {
        return if key { "\"\"".into() } else { String::new() };
    }
    if text.chars().any(|c| c.is_control() && c != '\n') {
        return double();
    }
    if text.contains('\n') {
        if flow || key {
            return double();
        }
        let trimmed = text.trim_end_matches('\n');
        let chomp = match text.len() - trimmed.len() {
            0 => "-",
            1 => "",
            _ => "+",
        };
        let mut block = format!(
            "|{}{chomp}",
            if text.starts_with([' ', '\n']) {
                "4"
            } else {
                ""
            }
        );
        for line in text.strip_suffix('\n').unwrap_or(text).split('\n') {
            block.push('\n');
            if !line.is_empty() {
                block.push_str("    ");
                block.push_str(line);
            }
        }
        return block;
    }
    let raw: Vec<_> = text.encode_utf16().collect();
    if text.trim() == text
        && !text.starts_with(['!', '&', '*', '\'', '"', '|', '>', '%', '@', '`'])
        && !(flow && text.contains([',', '[', ']', '{', '}']))
        && let Ok(doc) = scan(&raw)
    {
        let root = &doc.nodes[doc.root];
        if root.kind == Kind::Scalar && root.text == raw {
            if root.scalar.is_some()
                || config_mutations_rust::temporal::Temporal::parse(&raw)
                    .is_some_and(|t| t.has_date)
            {
                return double();
            }
            return text.into();
        }
    }
    format!("'{}'", text.replace('\'', "''"))
}

pub(super) fn set_config(
    original: &str,
    host: &str,
    key: &str,
    value: &str,
) -> Result<String, String> {
    let source: Vec<_> = original.encode_utf16().collect();
    let doc = scan(&source).map_err(|e| e.to_string())?;
    if host.is_empty() {
        return Ok(set_in(&source, &doc, &[key], value));
    }
    let updated = set_in(&source, &doc, &[host, key], value);
    let user = if key == "user" {
        value.to_owned()
    } else {
        entries(&doc, doc.root)
            .find(|(name, _)| name == host)
            .and_then(|(_, id)| entries(&doc, id).find(|(k, _)| k == "user"))
            .map(|(_, id)| String::from_utf16_lossy(&doc.nodes[id].text))
            .unwrap_or_default()
    };
    if user.is_empty() {
        return Ok(updated);
    }
    let source: Vec<_> = updated.encode_utf16().collect();
    let doc = scan(&source).map_err(|e| e.to_string())?;
    Ok(set_in(&source, &doc, &[host, "users", &user, key], value))
}

fn set_in(source: &[u16], doc: &Document, path: &[&str], value: &str) -> String {
    let mut id = doc.root;
    let mut path = path;
    while path.len() > 1 {
        let child = entries(doc, id).find(|(name, _)| name == path[0]);
        let Some((_, child)) = child else {
            break;
        };
        let node = &doc.nodes[child];
        if node.kind == Kind::Mapping {
            id = child;
            path = &path[1..];
        } else if node.kind == Kind::Scalar
            && !node.quoted
            && matches!(
                String::from_utf16_lossy(&node.text).as_str(),
                "" | "~" | "null" | "Null" | "NULL"
            )
        {
            break;
        } else {
            return String::from_utf16_lossy(source);
        }
    }
    let root = &doc.nodes[id];
    let key = path[0];
    let name: Vec<_> = key.encode_utf16().collect();
    let found = root
        .children
        .chunks_exact(2)
        .find(|p| doc.nodes[p[0]].kind == Kind::Scalar && doc.nodes[p[0]].text == name);
    let (colon, mut end) = mapping_slot(source, doc, id, &name);
    let flow = root.flow;
    let first = root
        .children
        .first()
        .map_or(root.start, |id| doc.nodes[*id].start);
    let line_start = source[..first]
        .iter()
        .rposition(|u| *u == 10)
        .map_or(0, |at| at + 1);
    let indent = if flow {
        String::new()
    } else {
        " ".repeat(
            source[line_start..first]
                .iter()
                .take_while(|u| **u == 32)
                .count(),
        )
    };
    let mut insert = String::new();
    let start = if found.is_some() {
        let start = colon.map_or(end, |at| at + 1);
        if colon.is_none() {
            insert.push(':');
        }
        if !flow {
            // Keep trailing standalone comments on the next key or mapping.
            while end > start {
                let line_end = if source[end - 1] == 10 { end - 1 } else { end };
                let begin = source[start..line_end]
                    .iter()
                    .rposition(|u| *u == 10)
                    .map_or(start, |i| start + i + 1);
                if begin == start {
                    break;
                }
                let tail = &source[begin..line_end];
                if tail.first() == Some(&35) || tail.iter().all(|u| matches!(u, 9 | 13 | 32)) {
                    end = begin;
                } else {
                    break;
                }
            }
            if end > start && source[end - 1] == 10 {
                end -= 1;
            }
        }
        start
    } else {
        if flow && !root.children.is_empty() {
            if source[..end]
                .iter()
                .rev()
                .find(|c| !matches!(c, 9 | 10 | 13 | 32))
                != Some(&44)
            {
                insert.push(',');
            }
            insert.push(' ');
        } else if !flow && end > 0 && source[end - 1] != 10 {
            insert.push('\n');
        }
        insert += &indent;
        insert.push_str(&scalar(key, flow, true));
        insert.push(':');
        end
    };
    let mut nested_indent = indent.clone();
    for component in &path[1..] {
        if flow {
            insert += " {";
        } else {
            nested_indent += "    ";
            insert.push('\n');
            insert += &nested_indent;
        }
        insert += &scalar(component, flow, true);
        insert.push(':');
    }
    if flow && value.is_empty() {
        insert += " ''";
    }
    if !value.is_empty() {
        insert.push(' ');
        let encoded = scalar(value, flow, false);
        for (i, line) in encoded.split('\n').enumerate() {
            if i != 0 {
                insert.push('\n');
                if !line.is_empty() {
                    insert += &nested_indent;
                }
            }
            insert.push_str(line);
        }
    }
    if flow {
        insert += &"}".repeat(path.len() - 1);
    }
    if !flow && let Some(pair) = found {
        let old = &doc.nodes[pair[1]];
        if old.kind == Kind::Scalar && old.text.is_empty() && !old.quoted {
            let removed = String::from_utf16_lossy(&source[start..end]);
            if let Some(comment) = removed
                .lines()
                .next()
                .map(str::trim_start)
                .filter(|s| s.starts_with('#'))
            {
                let at = insert.find('\n').unwrap_or(insert.len());
                insert.insert_str(at, &format!(" {comment}"));
            }
        }
    }
    if !flow && found.is_none() {
        insert.push('\n');
    }
    let mut out = String::from_utf16_lossy(&source[..start]);
    out += &insert;
    out += &String::from_utf16_lossy(&source[end..]);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}
