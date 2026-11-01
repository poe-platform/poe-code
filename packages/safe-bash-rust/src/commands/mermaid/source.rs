use config_mutations_rust::{config_data, value::Value as Yaml, yaml};
use mcp_protocol_rust::json::Value;

// YAML diagnostics use UTF-16 columns, including leading whitespace after "init:".
fn yaml_error(raw: &[u16], err: yaml::Error) -> String {
    let at = err.offset.min(raw.len());
    let start = raw[..at]
        .iter()
        .rposition(|c| *c == 10)
        .map_or(0, |i| i + 1);
    let excerpt = if at == start && start > 0 {
        raw[..start - 1]
            .iter()
            .rposition(|c| *c == 10)
            .map_or(0, |i| i + 1)
    } else {
        start
    };
    let end = raw[at..]
        .iter()
        .position(|c| *c == 10)
        .map_or(raw.len(), |i| at + i);
    let line = raw[..start].iter().filter(|c| **c == 10).count() + 1;
    let column = at - start + 1;
    let mut reason = err.reason;
    if reason.contains("flow mapping")
        || reason.contains("flow sequence")
        || reason.contains("expected node content")
    {
        // The scanner reports the bad closer. The JS diagnostic describes the
        // collection that was still open there, distinguishing root from nested.
        let mut open = Vec::new();
        let mut quote = None;
        let mut escape = false;
        let mut comment = false;
        for (i, &c) in raw[..at].iter().enumerate() {
            if comment {
                comment = c != 10;
                continue;
            }
            if escape {
                escape = false;
                continue;
            }
            if let Some(q) = quote {
                if c == 92 && q == 34 {
                    escape = true;
                }
                if c == q {
                    quote = None;
                }
            } else {
                match c {
                    34 | 39 => quote = Some(c),
                    35 if i == 0 || matches!(raw[i - 1], 9 | 10 | 13 | 32) => comment = true,
                    91 | 123 => open.push((i, c)),
                    93 | 125 => {
                        open.pop();
                    }
                    _ => (),
                }
            }
        }
        if let Some((i, c)) = open.pop() {
            let (name, end) = if c == 91 {
                ("sequence", ']')
            } else {
                ("map", '}')
            };
            let nested = raw[..i].iter().any(|c| !matches!(c, 9 | 10 | 13 | 32));
            reason = if nested {
                format!(
                    "Flow {name} in block collection must be sufficiently indented and end with a {end}"
                )
            } else {
                format!("Flow {name} must end with a {end}")
            };
        } else if let Some(c @ (93 | 125)) = raw.get(at) {
            let name = if *c == 125 { "map" } else { "seq" };
            reason = format!(
                "Unexpected flow-{name}-end token in YAML document: \"{}\"",
                char::from_u32(*c as u32).unwrap()
            );
        }
    }
    format!(
        "mmdc: E_CONFIG: {reason} at line {line}, column {column}:\n\n{}\n{}^\n\n",
        String::from_utf16_lossy(&raw[excerpt..end]).replace("\r\n", "\n"),
        " ".repeat(column - 1)
    )
}

fn mapping(text: &str) -> Result<Yaml, String> {
    let raw: Vec<_> = text.encode_utf16().collect();
    // Mermaid disables YAML aliases before conversion to ordinary JS objects.
    if raw.contains(&42)
        && yaml::document::scan(&raw).is_ok_and(|d| {
            d.nodes
                .iter()
                .any(|n| n.kind == yaml::document::Kind::Alias)
        })
    {
        return Err("shell: line 1: internal error\n".into());
    }
    let parsed = yaml::parse_with_options(
        &raw,
        None,
        yaml::ParseOptions {
            object_root: false,
            unique_keys: true,
        },
    )
    .map_err(|e| yaml_error(&raw, e))?
    .value;
    if !matches!(parsed, Yaml::Object(_)) {
        return Err("mmdc: E_CONFIG: Mermaid configuration must be a mapping\n".into());
    }
    Ok(parsed)
}

fn json(value: Yaml) -> Value {
    match value {
        Yaml::Bool(b) => Value::Bool(b),
        Yaml::Number(n) => Value::Number(n),
        Yaml::String(s) => Value::String(s),
        Yaml::Array(a) => Value::Array(a.into_iter().map(json).collect()),
        Yaml::Object(pairs) => Value::Object(
            pairs
                .into_iter()
                .filter(|(k, _)| {
                    !matches!(
                        String::from_utf16_lossy(k).as_ref(),
                        "__proto__" | "constructor" | "prototype"
                    )
                })
                .map(|(k, v)| (k, json(v)))
                .collect(),
        ),
        _ => Value::Null,
    }
}

fn blank(s: &str) -> impl Iterator<Item = char> + '_ {
    s.encode_utf16().map(|c| match c {
        10 => '\n',
        13 => '\r',
        _ => ' ',
    })
}

#[derive(Default)]
pub(in super::super) struct Metadata {
    title: Option<String>,
    config: Option<Yaml>,
    bytes: usize,
}
impl Metadata {
    pub fn frontmatter(source: &mut String) -> Result<Self, String> {
        if source.starts_with('\u{feff}') {
            source.drain(..3);
        }
        let opening = source.trim_start_matches([' ', '\t', '\r', '\n']);
        if !opening.starts_with("---\n") && !opening.starts_with("---\r\n") {
            return Ok(Self::default());
        }
        let start = source.len() - opening.len() + opening.find('\n').unwrap() + 1;
        let mut end = start;
        for line in source[start..].split_inclusive('\n') {
            if line.trim() == "---" {
                break;
            }
            end += line.len();
        }
        if end == source.len() {
            return Err("mmdc: E_SYNTAX: Unclosed YAML frontmatter\n".into());
        }
        let Yaml::Object(pairs) = mapping(&source[start..end])? else {
            unreachable!()
        };
        let mut meta = Self::default();
        for (key, value) in pairs {
            match (String::from_utf16_lossy(&key).as_str(), value) {
                ("title", Yaml::String(text)) => {
                    let title = String::from_utf16_lossy(&text);
                    if let Some(msg) = super::scanner::unsafe_label(&title) {
                        return Err(format!("mmdc: E_UNSUPPORTED: {msg}\n"));
                    }
                    meta.title = Some(title);
                }
                ("config", v @ Yaml::Object(_)) => {
                    meta.config = Some(v);
                    meta.bytes = end - start;
                }
                _ => (),
            }
        }
        let fence_end = source[end..].find('\n').map_or(source.len(), |n| end + n);
        let masked = blank(&source[..fence_end]).collect::<String>();
        source.replace_range(..fence_end, &masked);
        Ok(meta)
    }
    pub(super) fn directive(&mut self, body: &str, work: &mut usize) -> Result<(), String> {
        let Some((key, text)) = body.trim().split_once(':') else {
            return Ok(());
        };
        if !matches!(key.trim(), "init" | "initialize") {
            return Ok(());
        }
        self.bytes = self.bytes.saturating_add(text.len());
        *work = work
            .checked_sub(self.bytes)
            .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
        let value = mapping(text)?;
        self.config = Some(match self.config.take() {
            None => value,
            Some(old) => config_data::merge(&old, &value, None)
                .map_err(|e| format!("mmdc: E_CONFIG: {e}\n"))?,
        });
        Ok(())
    }

    pub(in super::super) fn finish(
        self,
    ) -> (Option<String>, Result<super::config::Config, String>) {
        let config = match self.config {
            Some(value) => super::config::Config::parse(&json(value), true),
            None => Ok(super::config::Config::default()),
        };
        (self.title.filter(|t| !t.is_empty()), config)
    }
}
