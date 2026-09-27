#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigValue {
    Bool(bool),
    Int(i64),
    Str(String),
}

impl ConfigValue {
    pub fn as_str(&self) -> String {
        match self {
            ConfigValue::Bool(b) => b.to_string(),
            ConfigValue::Int(n) => n.to_string(),
            ConfigValue::Str(s) => s.clone(),
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            ConfigValue::Bool(b) => Some(*b),
            ConfigValue::Str(s) => match s.trim().to_ascii_lowercase().as_str() {
                "true" | "yes" | "on" => Some(true),
                "false" | "no" | "off" => Some(false),
                _ => None,
            },
            ConfigValue::Int(n) => Some(*n != 0),
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            ConfigValue::Int(n) => Some(*n),
            ConfigValue::Str(s) => s.parse().ok(),
            ConfigValue::Bool(b) => Some(if *b { 1 } else { 0 }),
        }
    }
}

#[derive(Debug, Clone)]
struct ParsedConfigLine {
    line: String,
    is_section: bool,
    section: Option<String>,
    subsection: Option<String>,
    name: Option<String>,
    value: Option<String>,
    path: String,
    modified: bool,
}

#[derive(Debug, Clone, Default)]
pub struct GitConfig {
    parsed_config: Vec<ParsedConfigLine>,
}

impl GitConfig {
    pub fn from(text: &str) -> Self {
        if text.is_empty() {
            return Self {
                parsed_config: Vec::new(),
            };
        }
        let mut section: Option<String> = None;
        let mut subsection: Option<String> = None;
        let mut parsed_config = Vec::new();

        for raw_line in text.split('\n') {
            let trimmed = raw_line.trim();
            let mut is_section = false;
            let mut name: Option<String> = None;
            let mut value: Option<String> = None;

            if let Some((sec, sub)) = extract_section_line(trimmed) {
                is_section = true;
                section = Some(sec);
                subsection = sub;
            } else if let Some((var_name, var_val)) = extract_variable_line(trimmed) {
                name = Some(var_name);
                value = Some(var_val);
            }

            let path = build_config_path(
                section.as_deref(),
                subsection.as_deref(),
                name.as_deref(),
            );
            parsed_config.push(ParsedConfigLine {
                line: raw_line.to_string(),
                is_section,
                section: section.clone(),
                subsection: subsection.clone(),
                name,
                value,
                path,
                modified: false,
            });
        }

        Self { parsed_config }
    }

    pub fn get(&self, path: &str) -> Option<ConfigValue> {
        self.get_all(path).into_iter().last()
    }

    pub fn get_str(&self, path: &str) -> Option<String> {
        self.get(path).map(|v| v.as_str())
    }

    pub fn get_all(&self, path: &str) -> Vec<ConfigValue> {
        let norm = normalize_config_path(path);
        self.parsed_config
            .iter()
            .filter(|c| !c.is_section && c.path == norm.path)
            .filter_map(|c| {
                let raw_val = c.value.as_deref()?;
                Some(coerce_schema(
                    c.section.as_deref().unwrap_or(""),
                    c.name.as_deref().unwrap_or(""),
                    raw_val,
                ))
            })
            .collect()
    }

    pub fn get_subsections(&self, section: &str) -> Vec<Option<String>> {
        self.parsed_config
            .iter()
            .filter(|c| c.is_section && c.section.as_deref() == Some(section))
            .map(|c| c.subsection.clone())
            .collect()
    }

    pub fn delete_section(&mut self, section: &str, subsection: Option<&str>) {
        self.parsed_config.retain(|c| {
            !(c.section.as_deref() == Some(section)
                && c.subsection.as_deref() == subsection)
        });
    }

    pub fn append(&mut self, path: &str, value: Option<&str>) {
        self.set_internal(path, value, true);
    }

    pub fn set(&mut self, path: &str, value: Option<&str>) {
        self.set_internal(path, value, false);
    }

    fn set_internal(&mut self, path: &str, value: Option<&str>, append: bool) {
        let norm = normalize_config_path(path);
        let config_idx = self
            .parsed_config
            .iter()
            .rposition(|c| !c.is_section && c.path == norm.path);

        if value.is_none() {
            if let Some(idx) = config_idx {
                self.parsed_config.remove(idx);
            }
            return;
        }

        let val_str = value.unwrap().to_string();
        if let Some(idx) = config_idx {
            let mut updated = self.parsed_config[idx].clone();
            updated.name = Some(norm.name.clone());
            updated.value = Some(val_str);
            updated.modified = true;
            if append {
                self.parsed_config.insert(idx + 1, updated);
            } else {
                self.parsed_config[idx] = updated;
            }
        } else {
            let section_idx = self
                .parsed_config
                .iter()
                .position(|c| c.is_section && c.path == norm.section_path);
            if is_valid_section_name(&norm.section) && is_valid_variable_name(&norm.name) {
                let new_config = ParsedConfigLine {
                    line: String::new(),
                    is_section: false,
                    section: Some(norm.section.clone()),
                    subsection: norm.subsection.clone(),
                    name: Some(norm.name.clone()),
                    value: Some(val_str),
                    path: norm.path,
                    modified: true,
                };
                if let Some(s_idx) = section_idx {
                    self.parsed_config.insert(s_idx + 1, new_config);
                } else {
                    let new_section = ParsedConfigLine {
                        line: String::new(),
                        is_section: true,
                        section: Some(norm.section),
                        subsection: norm.subsection,
                        name: None,
                        value: None,
                        path: norm.section_path,
                        modified: true,
                    };
                    self.parsed_config.push(new_section);
                    self.parsed_config.push(new_config);
                }
            }
        }
    }
}

impl std::fmt::Display for GitConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let lines: Vec<String> = self
            .parsed_config
            .iter()
            .map(|c| {
                if !c.modified {
                    return c.line.clone();
                }
                if let (Some(name), Some(val)) = (&c.name, &c.value) {
                    if val.contains('#') || val.contains(';') {
                        return format!("\t{name} = \"{val}\"");
                    }
                    return format!("\t{name} = {val}");
                }
                let sec = c.section.as_deref().unwrap_or("");
                if let Some(ref sub) = c.subsection {
                    format!("[{sec} \"{sub}\"]")
                } else {
                    format!("[{sec}]")
                }
            })
            .collect();
        write!(f, "{}", lines.join("\n"))
    }
}

struct NormalizedConfigPath {
    section: String,
    subsection: Option<String>,
    name: String,
    path: String,
    section_path: String,
}

fn normalize_config_path(path: &str) -> NormalizedConfigPath {
    let mut parts: Vec<&str> = path.split('.').collect();
    let section = parts.first().copied().unwrap_or("").to_string();
    let name = if parts.len() >= 2 {
        parts.pop().unwrap().to_string()
    } else {
        String::new()
    };
    let subsection = if parts.len() > 1 {
        Some(parts[1..].join("."))
    } else {
        None
    };
    let full_path = build_config_path(Some(&section), subsection.as_deref(), Some(&name));
    let section_path = build_config_path(Some(&section), subsection.as_deref(), None);
    NormalizedConfigPath {
        section,
        subsection,
        name,
        path: full_path,
        section_path,
    }
}

fn build_config_path(
    section: Option<&str>,
    subsection: Option<&str>,
    name: Option<&str>,
) -> String {
    let mut parts = Vec::new();
    if let Some(s) = section {
        parts.push(s.to_ascii_lowercase());
    }
    if let Some(sub) = subsection {
        parts.push(sub.to_string());
    }
    if let Some(n) = name {
        parts.push(n.to_ascii_lowercase());
    }
    parts.join(".")
}

fn extract_section_line(line: &str) -> Option<(String, Option<String>)> {
    if !line.starts_with('[') || !line.ends_with(']') {
        return None;
    }
    let inner = &line[1..line.len() - 1];
    if let Some(quote_start) = inner.find(" \"") {
        if !inner.ends_with('"') {
            return None;
        }
        let sec = &inner[..quote_start];
        let sub = &inner[quote_start + 2..inner.len() - 1];
        if is_valid_section_name(sec) {
            return Some((sec.to_string(), Some(sub.to_string())));
        }
        return None;
    }
    if is_valid_section_name(inner) {
        Some((inner.to_string(), None))
    } else {
        None
    }
}

fn extract_variable_line(line: &str) -> Option<(String, String)> {
    if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
        return None;
    }
    let (raw_name, raw_val) = match line.find('=') {
        Some(eq) => (line[..eq].trim_end(), line[eq + 1..].trim_start()),
        None => (line, "true"),
    };
    if !is_valid_variable_name(raw_name) {
        return None;
    }
    let without_comments = remove_comments(raw_val);
    let without_quotes = remove_quotes(&without_comments);
    Some((raw_name.to_string(), without_quotes))
}

fn remove_comments(raw_value: &str) -> String {
    let bytes = raw_value.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b'#' || bytes[i] == b';' {
            let mut space_start = i;
            while space_start > 0 && bytes[space_start - 1] == b' ' {
                space_start -= 1;
            }
            let before = &raw_value[..space_start];
            let comment = &raw_value[space_start..];
            if has_odd_unescaped_quotes(before) && has_odd_unescaped_quotes(comment) {
                return raw_value.to_string();
            }
            return before.to_string();
        }
    }
    raw_value.to_string()
}

fn has_odd_unescaped_quotes(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut count = 0usize;
    for i in 0..bytes.len() {
        if bytes[i] == b'"' && (i == 0 || bytes[i - 1] != b'\\') {
            count += 1;
        }
    }
    !count.is_multiple_of(2)
}

fn remove_quotes(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for i in 0..chars.len() {
        let is_quote = chars[i] == '"' && (i == 0 || chars[i - 1] != '\\');
        let is_escape_for_quote =
            chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1] == '"';
        if !is_quote && !is_escape_for_quote {
            out.push(chars[i]);
        }
    }
    out
}

fn is_valid_section_name(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
}

fn is_valid_variable_name(s: &str) -> bool {
    let bytes = s.as_bytes();
    !bytes.is_empty()
        && bytes[0].is_ascii_alphabetic()
        && bytes.iter().all(|&b| b.is_ascii_alphabetic() || b == b'-')
}

fn coerce_schema(section: &str, name: &str, value: &str) -> ConfigValue {
    if section.eq_ignore_ascii_case("core") {
        let lower_name = name.to_ascii_lowercase();
        match lower_name.as_str() {
            "filemode" | "bare" | "logallrefupdates" | "symlinks" | "ignorecase" => {
                match value.trim().to_ascii_lowercase().as_str() {
                    "true" | "yes" | "on" => return ConfigValue::Bool(true),
                    "false" | "no" | "off" => return ConfigValue::Bool(false),
                    _ => {}
                }
            }
            "bigfilethreshold" => {
                let lower_val = value.trim().to_ascii_lowercase();
                let (digits, factor) = if let Some(d) = lower_val.strip_suffix('k') {
                    (d, 1024i64)
                } else if let Some(d) = lower_val.strip_suffix('m') {
                    (d, 1024 * 1024)
                } else if let Some(d) = lower_val.strip_suffix('g') {
                    (d, 1024 * 1024 * 1024)
                } else {
                    (lower_val.as_str(), 1)
                };
                if let Ok(n) = digits.parse::<i64>() {
                    return ConfigValue::Int(n * factor);
                }
            }
            _ => {}
        }
    }
    ConfigValue::Str(value.to_string())
}
