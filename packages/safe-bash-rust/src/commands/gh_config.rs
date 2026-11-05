use super::structured::{JVal, parse_json_stream};
use crate::vfs::{SafeBashFs, resolve_posix_path};
use config_mutations_rust::yaml::document::{Document, Kind, mapping_slot, scan};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Default)]
pub(super) struct Config {
    pub values: BTreeMap<String, String>,
    pub hosts: Vec<(String, BTreeMap<String, String>)>,
    pub original: Option<String>,
}

fn entries(doc: &Document, node: usize) -> impl Iterator<Item = (String, usize)> + '_ {
    doc.nodes[node].children.chunks_exact(2).filter_map(move |pair| {
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

pub(super) fn read(fs: &dyn SafeBashFs, cwd: &str, dir: &str) -> Result<Config, String> {
    let mut config = Config::default();
    let mut remaining = fs.max_input_bytes();
    for name in ["config.yml", "hosts.yml"] {
        let display = format!("{}/{name}", dir.trim_end_matches('/'));
        let path = resolve_posix_path(cwd, &display);
        fs.command_descriptor_op()?;
        let stat = match fs.stat(&path) {
            Ok(stat) => stat,
            Err(e) if e.starts_with("ENOENT") || e.ends_with("(os error 2)") => continue,
            Err(e) => return Err(e),
        };
        if stat.size > remaining {
            return Err("gh input byte limit exceeded".into());
        }
        let bytes = fs.read_file(&path)?;
        remaining = remaining
            .checked_sub(bytes.len())
            .ok_or("gh input byte limit exceeded")?;
        let invalid = |reason| {
            let msg = format!("invalid config file {display}: {reason}");
            format!(
                "warning: failed to load config: {msg}\nfailed to create root command: failed to read configuration: {msg}\n"
            )
        };
        let text = String::from_utf8(bytes).map_err(|_| invalid("invalid yaml"))?;
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
        } else if !root.children.is_empty() && !config.values.contains_key("hosts") {
            config.values.insert("hosts".into(), String::new());
            Some(doc.root)
        } else {
            None
        };
        if let Some(hosts) = hosts {
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

fn default_config() -> &'static str {
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

pub(super) fn write(
    fs: &dyn SafeBashFs,
    dir: &str,
    path: &str,
    original: Option<&str>,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let source: Vec<_> = original
        .unwrap_or_else(|| default_config())
        .encode_utf16()
        .collect();
    let doc = scan(&source).map_err(|e| e.to_string())?;
    let root = &doc.nodes[doc.root];
    let name: Vec<_> = key.encode_utf16().collect();
    let found = root
        .children
        .chunks_exact(2)
        .find(|p| doc.nodes[p[0]].kind == Kind::Scalar && doc.nodes[p[0]].text == name);
    let (colon, mut end) = mapping_slot(&source, &doc, &name);
    let flow = root.flow;
    let first = root.children.first().map_or(root.start, |id| doc.nodes[*id].start);
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
                    insert += &indent;
                }
            }
            insert.push_str(line);
        }
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
    fs.mkdir(dir, true, 0o771)
        .map_err(|(code, at)| format!("{code}: {at}"))?;
    fs.write_command_path(path, out.as_bytes(), false, 0o600)
}
