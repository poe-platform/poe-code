// in2csv uses Python JSON numbers (int and Decimal), including their original scale.
use super::{BuiltinOutcome, err_out};
use crate::budget::{AllocationGuard, ShellLimits};
use mcp_protocol_rust::json;
use std::collections::BTreeMap;

enum Value<'a> {
    Null,
    Bool(bool),
    Number(&'a str),
    Text(String),
    Array(Vec<Value<'a>>),
    Object(Vec<(String, Value<'a>)>),
}

struct Parser<'a, 'b> {
    memory: &'b AllocationGuard,
    text: &'a str,
    pos: usize,
}
impl<'a, 'b> Parser<'a, 'b> {
    fn error(&self, msg: &str, at: usize) -> String {
        let prefix = &self.text[..at];
        let line = prefix.bytes().filter(|&c| c == b'\n').count() + 1;
        let col = prefix.rsplit('\n').next().unwrap_or("").chars().count() + 1;
        format!(
            "JSONDecodeError: {msg}: line {line} column {col} (char {})",
            prefix.chars().count()
        )
    }
    fn byte(&self) -> u8 {
        self.text.as_bytes().get(self.pos).copied().unwrap_or(0)
    }
    fn white(&mut self) {
        while matches!(self.byte(), b' ' | b'\r' | b'\n' | b'\t') {
            self.pos += 1;
        }
    }
    fn string(&mut self) -> Result<String, String> {
        let start = self.pos;
        self.pos += 1;
        let mut escaped = false;
        while self.pos < self.text.len() {
            let p = self.pos;
            self.pos += 1;
            match self.text.as_bytes()[p] {
                b'"' => {
                    self.memory.try_reserve((p - start).saturating_mul(6))?;
                    if !escaped {
                        return Ok(self.text[start + 1..p].into());
                    }
                    let Ok(json::Value::String(s)) = json::parse(
                        &self.text.as_bytes()[start..self.pos],
                        json::Limits::default(),
                    ) else {
                        return Err(self.error("Invalid string", start));
                    };
                    return String::from_utf16(&s).map_err(|_| "csvkit: unsupported or unqualified: JSON unpaired surrogate output encoding profile".into());
                }
                0..=31 => return Err(self.error("Invalid control character at", p)),
                b'\\' => {
                    escaped = true;
                    if self.pos == self.text.len() {
                        break;
                    }
                    match self.byte() {
                        b'u' => {
                            let at = self.pos;
                            self.pos += 1;
                            for _ in 0..4 {
                                if !self.byte().is_ascii_hexdigit() {
                                    return Err(self.error("Invalid \\uXXXX escape", at));
                                }
                                self.pos += 1;
                            }
                        }
                        b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => self.pos += 1,
                        _ => return Err(self.error("Invalid \\escape", p)),
                    }
                }
                _ => (),
            }
        }
        Err(self.error("Unterminated string starting at", start))
    }
    fn value(&mut self, depth: usize) -> Result<Value<'a>, String> {
        // Admit the parsed node and its table slot before growing either structure.
        self.memory
            .try_reserve(2 * size_of::<Value>() + size_of::<Cell>() + 64)?;
        self.white();
        let start = self.pos;
        let first = self.byte();
        if first == b'"' {
            return self.string().map(Value::Text);
        }
        if matches!(first, b'[' | b'{') {
            if depth >= 128 {
                return Err(
                    "csvkit: unsupported or unqualified: JSON nesting budget exceeded".into(),
                );
            }
            self.pos += 1;
            self.white();
            let object = first == b'{';
            let close = if object { b'}' } else { b']' };
            let mut array = Vec::new();
            let mut fields = Vec::new();
            let mut indices = BTreeMap::new();
            if self.byte() != close {
                loop {
                    if object {
                        if self.byte() != b'"' {
                            return Err(self.error(
                                "Expecting property name enclosed in double quotes",
                                self.pos,
                            ));
                        }
                        let key = self.string()?;
                        self.white();
                        if self.byte() != b':' {
                            return Err(self.error("Expecting ':' delimiter", self.pos));
                        }
                        self.pos += 1;
                        let child = self.value(depth + 1)?;
                        // Last value wins, while the first occurrence fixes the field order.
                        if let Some(&index) = indices.get(&key) {
                            fields[index] = (key, child);
                        } else {
                            indices.insert(key.clone(), fields.len());
                            fields.push((key, child));
                        }
                    } else {
                        array.push(self.value(depth + 1)?);
                    }
                    self.white();
                    if self.byte() == close {
                        break;
                    }
                    let comma = self.pos;
                    if self.byte() != b',' {
                        return Err(self.error("Expecting ',' delimiter", comma));
                    }
                    self.pos += 1;
                    self.white();
                    if self.byte() == close {
                        return Err(self.error(
                            if object {
                                "Illegal trailing comma before end of object"
                            } else {
                                "Illegal trailing comma before end of array"
                            },
                            comma,
                        ));
                    }
                }
            }
            self.pos += 1;
            return Ok(if object {
                Value::Object(fields)
            } else {
                Value::Array(array)
            });
        }
        for (word, literal) in [
            ("null", Value::Null),
            ("true", Value::Bool(true)),
            ("false", Value::Bool(false)),
            ("NaN", Value::Number("NaN")),
            ("Infinity", Value::Number("Infinity")),
            ("-Infinity", Value::Number("-Infinity")),
        ] {
            if self.text[start..].starts_with(word) {
                self.pos += word.len();
                return Ok(literal);
            }
        }
        if first == b'-' {
            self.pos += 1;
        }
        if !self.byte().is_ascii_digit() {
            return Err(self.error("Expecting value", start));
        }
        if self.byte() == b'0' {
            self.pos += 1;
        } else {
            while self.byte().is_ascii_digit() {
                self.pos += 1;
            }
        }
        if self.byte() == b'.'
            && self
                .text
                .as_bytes()
                .get(self.pos + 1)
                .is_some_and(u8::is_ascii_digit)
        {
            self.pos += 1;
            while self.byte().is_ascii_digit() {
                self.pos += 1;
            }
        }
        if matches!(self.byte(), b'e' | b'E') {
            let exp = self.pos;
            self.pos += 1;
            if matches!(self.byte(), b'+' | b'-') {
                self.pos += 1;
            }
            if self.byte().is_ascii_digit() {
                while self.byte().is_ascii_digit() {
                    self.pos += 1;
                }
            } else {
                self.pos = exp;
            }
        }
        let token = &self.text[start..self.pos];
        self.memory.try_reserve(token.len().saturating_mul(5))?;
        if !token.contains(['.', 'e', 'E']) && token.trim_start_matches('-').len() > 4300 {
            return Err(format!(
                "ValueError: Exceeds the limit (4300 digits) for integer string conversion: value has {} digits; use sys.set_int_max_str_digits() to increase the limit",
                token.trim_start_matches('-').len()
            ));
        }
        Ok(Value::Number(token))
    }
    fn parse(text: &'a str, memory: &'b AllocationGuard) -> Result<Value<'a>, String> {
        let mut p = Self {
            text,
            pos: 0,
            memory,
        };
        if text.starts_with('\u{feff}') {
            return Err(p.error("Unexpected UTF-8 BOM (decode using utf-8-sig)", 0));
        }
        let v = p.value(0)?;
        p.white();
        if p.pos != text.len() {
            return Err(p.error("Extra data", p.pos));
        }
        Ok(v)
    }
}

/// Decimal spelling without converting through binary floating point. CSV string
/// inference applies the decimal context's 28-digit half-even rounding; native
/// JSON numbers preserve every digit.
fn decimal(token: &str, round: bool) -> Option<String> {
    let negative = token.starts_with('-');
    let unsigned = token.strip_prefix(['-', '+']).unwrap_or(token);
    let (mant, exp) = match unsigned.split_once(['e', 'E']) {
        Some((m, e)) => (m, e.parse::<i128>().ok()?),
        None => (unsigned, 0),
    };
    let (whole, frac) = mant.split_once('.').unwrap_or((mant, ""));
    if (whole.is_empty() && frac.is_empty())
        || !whole
            .bytes()
            .chain(frac.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let mut scale = exp.checked_sub(frac.len() as i128)?;
    let all = format!("{whole}{frac}");
    let significant = all.trim_start_matches('0');
    let mut digits = if significant.is_empty() {
        "0"
    } else {
        significant
    }
    .as_bytes()
    .to_vec();
    if round && digits.len() > 28 {
        let up = digits[28] > b'5'
            || (digits[28] == b'5'
                && (digits[27] % 2 == 1 || digits[29..].iter().any(|&c| c != b'0')));
        scale = scale.checked_add((digits.len() - 28) as i128)?;
        digits.truncate(28);
        if up {
            if let Some(i) = digits.iter().rposition(|&c| c != b'9') {
                digits[i] += 1;
                digits[i + 1..].fill(b'0');
            } else {
                digits.fill(b'0');
                digits[0] = b'1';
                scale = scale.checked_add(1)?;
            }
        }
    }
    let digits = std::str::from_utf8(&digits).ok()?;
    let adjusted = scale.checked_add(digits.len() as i128 - 1)?;
    let sign = if negative { "-" } else { "" };
    if scale > 0 || adjusted < -6 {
        let point = if digits.len() > 1 { "." } else { "" };
        return Some(format!(
            "{sign}{}{point}{}E{adjusted:+}",
            &digits[..1],
            &digits[1..]
        ));
    }
    if scale == 0 {
        return Some(format!("{sign}{digits}"));
    }
    let point = adjusted + 1;
    if point > 0 {
        let p = point as usize;
        Some(format!("{sign}{}.{}", &digits[..p], &digits[p..]))
    } else {
        Some(format!("{sign}0.{}{digits}", "0".repeat((-point) as usize)))
    }
}

#[derive(Default)]
pub(super) struct Options<'a> {
    pub locale: Option<&'a str>,
    pub no_inference: bool,
    pub blanks: bool,
    pub nulls: Vec<&'a str>,
    pub no_leading_zeroes: bool,
    pub line_numbers: bool,
    pub bom: bool,
}

struct Cell {
    text: String,
    boolean: Option<bool>,
    number: Option<String>,
}

impl Options<'_> {
    fn cell(&self, v: Value<'_>) -> Result<Option<Cell>, String> {
        let (text, boolean, number) = match v {
            Value::Null => return Ok(None),
            Value::Bool(b) => (
                (if b { "True" } else { "False" }).into(),
                Some(b),
                Some(if b { "1" } else { "0" }.into()),
            ),
            Value::Number(n) => {
                let text = match n {
                    "NaN" => "nan".into(),
                    "Infinity" => "inf".into(),
                    "-Infinity" => "-inf".into(),
                    "-0" => "0".into(),
                    _ => decimal(n, false).ok_or(
                        "csvkit: unsupported or unqualified: JSON decimal exponent budget exceeded",
                    )?,
                };
                let mantissa = text
                    .split('E')
                    .next()
                    .unwrap_or(&text)
                    .trim_start_matches('-');
                let b = if mantissa.bytes().all(|c| matches!(c, b'0' | b'.')) {
                    Some(false)
                } else if !text.contains('E')
                    && text.split('.').next() == Some("1")
                    && text
                        .split_once('.')
                        .is_none_or(|(_, f)| f.bytes().all(|c| c == b'0'))
                {
                    Some(true)
                } else {
                    None
                };
                let num = if matches!(n, "NaN" | "Infinity" | "-Infinity") {
                    n.into()
                } else {
                    text.clone()
                };
                (text, b, Some(num))
            }
            Value::Text(s) => {
                let trimmed = s.trim();
                let lower = trimmed.to_lowercase();
                if (!self.blanks
                    && matches!(lower.as_str(), "" | "na" | "n/a" | "none" | "null" | "."))
                    || self.nulls.iter().any(|v| v.to_lowercase() == lower)
                {
                    return Ok(None);
                }
                if self.no_inference {
                    return Ok(Some(Cell {
                        text: s,
                        boolean: None,
                        number: None,
                    }));
                }
                let boolean = match lower.replace(',', "").as_str() {
                    "1" | "yes" | "y" | "true" | "t" => Some(true),
                    "0" | "no" | "n" | "false" | "f" => Some(false),
                    _ => None,
                };
                let neg = trimmed.trim_matches('%');
                let (minus, rest) = neg.strip_prefix('-').map_or(("", neg), |s| ("-", s));
                let rest = rest.trim_matches(|c| "؋$ƒ៛¥₡₱£₭₨€﷼₪₩฿₤₫".contains(c));
                let raw = if self.locale == Some("de_DE") {
                    rest.replace('.', "").replace(',', ".")
                } else {
                    rest.replace(',', "")
                };
                let num = if self.no_leading_zeroes
                    && raw.starts_with('0')
                    && raw.len() > 1
                    && !raw.starts_with("0.")
                {
                    None
                } else {
                    match raw.to_ascii_lowercase().as_str() {
                        "inf" | "infinity" => Some(format!("{minus}Infinity")),
                        "nan" => Some("NaN".into()),
                        _ => decimal(&format!("{minus}{}", raw.replace('_', "")), true),
                    }
                };
                (s, boolean, num)
            }
            _ => unreachable!(),
        };
        Ok(Some(Cell {
            text,
            boolean,
            number,
        }))
    }
}

fn quote_key(s: &str) -> String {
    let q = if s.contains('\'') && !s.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut repr = String::from(q);
    for c in s.chars() {
        match c {
            '\n' => repr.push_str("\\n"),
            '\t' => repr.push_str("\\t"),
            '\r' => repr.push_str("\\r"),
            c if c == q || c == '\\' => {
                repr.push('\\');
                repr.push(c);
            }
            c if c.is_control() => repr.push_str(&format!("\\x{:02x}", u32::from(c))),
            _ => repr.push(c),
        }
    }
    repr.push(q);
    repr
}

struct Column {
    name: String,
    boolean: bool,
    numeric: bool,
}

fn flatten(
    v: Value<'_>,
    path: &mut String,
    cells: &mut BTreeMap<usize, Option<Cell>>,
    names: &mut BTreeMap<String, usize>,
    columns: &mut Vec<Column>,
    opts: &Options<'_>,
    memory: &AllocationGuard,
) -> Result<(), String> {
    let len = path.len();
    match v {
        Value::Object(fields) => {
            for (key, v) in fields {
                path.push_str(&key);
                path.push('/');
                flatten(v, path, cells, names, columns, opts, memory)?;
                path.truncate(len);
            }
        }
        Value::Array(values) => {
            for (i, v) in values.into_iter().enumerate() {
                path.push_str(&i.to_string());
                path.push('/');
                flatten(v, path, cells, names, columns, opts, memory)?;
                path.truncate(len);
            }
        }
        v => {
            let name = path.trim_matches('/');
            let idx = if let Some(&idx) = names.get(name) {
                idx
            } else {
                memory.try_reserve(name.len().saturating_mul(4) + size_of::<Column>())?;
                names.insert(name.into(), columns.len());
                columns.push(Column {
                    name: name.into(),
                    boolean: !opts.no_inference,
                    numeric: !opts.no_inference,
                });
                columns.len() - 1
            };
            cells.insert(idx, opts.cell(v)?);
        }
    }
    Ok(())
}

pub(super) fn convert(
    text: &str,
    newline: bool,
    key: Option<&str>,
    opts: &Options<'_>,
    limits: &ShellLimits,
) -> BuiltinOutcome {
    match table(text, newline, key, opts, limits) {
        Ok(stdout) => BuiltinOutcome {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        },
        Err(e) => err_out(
            &format!("{e}\n"),
            if e.starts_with("csvkit: unsupported or unqualified:") {
                78
            } else {
                1
            },
        ),
    }
}
fn table(
    text: &str,
    newline: bool,
    key: Option<&str>,
    opts: &Options<'_>,
    limits: &ShellLimits,
) -> Result<String, String> {
    let memory = AllocationGuard::new(limits.max_memory_bytes);
    memory.try_reserve(text.len())?;
    let values = if newline {
        if key.is_some() {
            return Err("ValueError: key and newline may not be specified together.".into());
        }
        text.split_inclusive('\n')
            .map(|line| Parser::parse(line, &memory))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        let mut root = Parser::parse(text, &memory)?;
        if let Value::Object(entries) = root {
            let key = key.filter(|s| !s.is_empty()).ok_or("TypeError: When converting a JSON document with a top-level dictionary element, a key must be specified.")?;
            root = entries
                .into_iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v)
                .ok_or_else(|| format!("KeyError: {}", quote_key(key)))?;
        }
        match root {
            Value::Array(vals) => vals,
            Value::Object(o) => o.into_iter().map(|(k, _)| Value::Text(k)).collect(),
            Value::Text(s) => {
                memory.try_reserve(
                    s.chars()
                        .count()
                        .saturating_mul(2 * size_of::<Value>() + size_of::<Cell>() + 64),
                )?;
                s.chars().map(|c| Value::Text(c.to_string())).collect()
            }
            v => {
                let ty = match v {
                    Value::Null => "NoneType",
                    Value::Bool(_) => "bool",
                    Value::Number("NaN" | "Infinity" | "-Infinity") => "float",
                    Value::Number(n) if n.contains(['e', 'E', '.']) => "decimal.Decimal",
                    _ => "int",
                };
                return Err(format!("TypeError: '{ty}' object is not iterable"));
            }
        }
    };
    if !opts.no_inference
        && let Some(locale) = opts.locale
        && !matches!(locale, "en_US" | "de_DE")
    {
        return Err(format!(
            "csvkit: unsupported or unqualified: Agate Number locale {locale}"
        ));
    }
    let mut columns = Vec::new();
    let mut names = BTreeMap::new();
    let mut rows = Vec::with_capacity(values.len());
    for v in values {
        let mut cells = BTreeMap::new();
        flatten(
            v,
            &mut String::new(),
            &mut cells,
            &mut names,
            &mut columns,
            opts,
            &memory,
        )?;
        for (&idx, c) in &cells {
            if let Some(c) = c {
                columns[idx].boolean &= c.boolean.is_some();
                columns[idx].numeric &= c.number.is_some();
            }
        }
        rows.push(cells);
    }
    let remaining = if limits.max_memory_bytes == 0 {
        usize::MAX
    } else {
        limits
            .max_memory_bytes
            .saturating_sub(memory.current_bytes())
    };
    let output_limit = limits.max_output_bytes.min(remaining);
    let bound = if remaining < limits.max_output_bytes {
        "Memory budget exceeded while rendering CSV"
    } else {
        "csvkit: unsupported or unqualified: CSV output budget exceeded"
    };
    if columns.len().max(1).saturating_mul(rows.len() + 1) > output_limit {
        return Err(bound.into());
    }
    let mut headers: Vec<_> = columns.iter().map(|c| c.name.clone()).collect();
    if headers.iter().any(String::is_empty) {
        headers = super::normalize_csvkit_headers(&headers);
    }
    if opts.line_numbers {
        headers.insert(0, "line_number".into());
    }
    let mut out = if opts.bom {
        "\u{feff}".into()
    } else {
        String::new()
    };
    let width = headers.len();
    let mut field = |text: &str, last: bool| -> Result<(), String> {
        let quoted = (width == 1 && text.is_empty()) || text.contains([',', '"', '\r', '\n']);
        let extra = if quoted {
            2 + text.bytes().filter(|&c| c == b'"').count()
        } else {
            0
        };
        if out
            .len()
            .saturating_add(text.len())
            .saturating_add(extra + 1)
            > output_limit
        {
            return Err(bound.into());
        }
        if quoted {
            out.push('"');
            for c in text.chars() {
                if c == '"' {
                    out.push('"');
                }
                out.push(c);
            }
            out.push('"');
        } else {
            out.push_str(text);
        }
        out.push(if last { '\n' } else { ',' });
        Ok(())
    };
    if width == 0 {
        field("", true)?;
    }
    for (i, header) in headers.iter().enumerate() {
        field(header, i + 1 == width)?;
    }
    for (i, row) in rows.into_iter().enumerate() {
        if opts.line_numbers {
            field(&(i + 1).to_string(), columns.is_empty())?;
        }
        if width == 0 {
            field("", true)?;
        }
        let mut cells = row.into_iter().peekable();
        for (idx, col) in columns.iter().enumerate() {
            let cell = cells.next_if(|(k, _)| *k == idx).and_then(|(_, c)| c);
            let value = match &cell {
                None => "",
                Some(c) if col.boolean => {
                    if c.boolean == Some(true) {
                        "True"
                    } else {
                        "False"
                    }
                }
                Some(c) if col.numeric => c.number.as_deref().unwrap_or_default(),
                Some(c) => &c.text,
            };
            field(value, idx + 1 == columns.len())?;
        }
    }
    Ok(out)
}
