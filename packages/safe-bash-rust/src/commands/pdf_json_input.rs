// QPDF JSON is a map of indirect objects, not a list of page drawing streams.
use super::{
    ObjectId, Value, index,
    pdf_rewrite::{encode, write_stream},
    pdf_string,
};
use mcp_protocol_rust::json::{self, Value as J};
use std::{borrow::Cow, collections::BTreeMap, fmt::Write as _, io::Write};
const LARGE: &str = "PDF output byte limit exceeded";
const BAD: &str = "invalid PDF object graph";
fn object_like(v: &J) -> bool {
    matches!(v, J::Object(_) | J::Array(_))
}
fn reference(s: &str) -> Option<ObjectId> {
    let mut parts = s
        .strip_prefix("obj:")
        .unwrap_or(s)
        .trim()
        .split(' ')
        .filter(|s| !s.is_empty());
    let mut unsigned = || {
        let p = parts.next()?;
        p.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| p.parse::<usize>().ok())
            .flatten()
    };
    let id = unsigned()?;
    let gen_no = unsigned()?;
    (matches!(parts.next(), Some("R" | "obj"))
        && parts.next().is_none()
        && id > 0
        && id <= 2147483647
        && gen_no <= 65535)
        .then_some((id, gen_no))
}
fn pdf_name(units: &[u16]) -> Vec<u8> {
    let mut out = String::new();
    for &n in units {
        if (33..=126).contains(&n) && !b"#()<>[]{}/%".contains(&(n as u8)) {
            out.push(char::from(n as u8))
        } else {
            write!(out, "#{n:02X}").unwrap()
        }
    }
    out.into_bytes()
}
fn cos(v: &J) -> Result<Value<'static>, String> {
    let w = |s: Vec<u8>| Value::Word(s.into());
    Ok(match v {
        J::Null => w(b"null".to_vec()),
        J::Bool(b) => w(b.to_string().into_bytes()),
        J::Number(n) => {
            if !n.is_finite() {
                return Err(format!(
                    "Invalid non-finite PDF number: {}",
                    if n.is_sign_negative() {
                        "-Infinity"
                    } else {
                        "Infinity"
                    }
                ));
            }
            let s = if n.fract() == 0. {
                json::stringify(v)
            } else {
                let s = format!("{n:.6}");
                let s = s.trim_end_matches('0').trim_end_matches('.');
                if s == "-0" { "0".into() } else { s.into() }
            };
            w(s.into_bytes())
        }
        J::String(units) => {
            let s = String::from_utf16_lossy(units);
            if let Some(name) = s
                .strip_prefix("n:")
                .map(|s| s.strip_prefix('/').unwrap_or(s))
                .or_else(|| s.strip_prefix('/'))
            {
                let skip = s.len() - name.len();
                let mut key = vec![b'/'];
                key.extend(pdf_name(&units[skip..]));
                w(key)
            } else if let Some(h) = s.strip_prefix("b:") {
                let chars: Vec<_> = h.trim().encode_utf16().collect();
                let bytes = chars
                    .chunks_exact(2)
                    .map(|p| {
                        let s = String::from_utf16_lossy(p);
                        let s = s.trim_start();
                        let digits = s.trim_start_matches(['+', '-']);
                        let digits =
                            &digits[..digits.bytes().take_while(|c| c.is_ascii_hexdigit()).count()];
                        let n = u8::from_str_radix(digits, 16).unwrap_or(0);
                        if s.starts_with('-') {
                            n.wrapping_neg()
                        } else {
                            n
                        }
                    })
                    .collect();
                Value::String { bytes, hex: true }
            } else if let Some(r) = reference(&s) {
                Value::Ref(r)
            } else {
                let t = s.strip_prefix("u:").unwrap_or(&s);
                let value = pdf_string::encode(t);
                if matches!(value, Value::String { hex: true, .. }) {
                    Value::String {
                        hex: true,
                        bytes: [0xfe, 0xff]
                            .into_iter()
                            .chain(
                                units[if s.starts_with("u:") { 2 } else { 0 }..]
                                    .iter()
                                    .flat_map(|n| n.to_be_bytes()),
                            )
                            .collect(),
                    }
                } else {
                    value
                }
            }
        }
        J::Array(a) => Value::Array(a.iter().map(cos).collect::<Result<_, _>>()?),
        J::Object(entries) => {
            let mut dict: super::Dict = vec![];
            let mut keys = BTreeMap::new();
            let mut ordered: Vec<_> = entries.iter().collect();
            ordered.sort_by_key(|(k, _)| {
                let s = String::from_utf16_lossy(k);
                s.parse::<u32>()
                    .ok()
                    .filter(|n| n.to_string() == s)
                    .unwrap_or(u32::MAX)
            });
            for (k, v) in ordered {
                let skip = if k.starts_with(&[110, 58, 47]) {
                    3
                } else {
                    usize::from(k.first() == Some(&47))
                };
                let k = pdf_name(&k[skip..]);
                let v = cos(v)?;
                if let Some(&i) = keys.get(&k) {
                    let (_, old): &mut (_, Value) = &mut dict[i];
                    *old = v
                } else {
                    keys.insert(k.clone(), dict.len());
                    dict.push((k.into(), v))
                }
            }
            Value::Dict(dict)
        }
    })
}

struct Object<'a> {
    id: ObjectId,
    order: usize,
    value: Value<'a>,
    data: Option<Cow<'a, [u8]>>,
}
#[derive(Default)]
pub(in super::super) struct JsonDocument<'a> {
    objects: BTreeMap<usize, Object<'a>>,
    root: Option<ObjectId>,
    info: Option<ObjectId>,
    ordinal: usize,
    external_bytes: usize,
}
impl<'a> JsonDocument<'a> {
    pub(in super::super) fn from_pdf(bytes: &'a [u8], password: &str) -> Result<Self, String> {
        let (mut o, trailer) = index(bytes, password)?;
        let mut doc = Self {
            root: trailer.get(b"Root").and_then(Value::reference),
            info: trailer.get(b"Info").and_then(Value::reference),
            ..Default::default()
        };
        let mut ids: Vec<_> = o
            .xref
            .iter()
            .map(|(&id, (loc, order))| {
                ((matches!(loc, super::Location::Member { .. }), *order), id)
            })
            .collect();
        ids.sort_unstable();
        for (_, id) in ids {
            let (mut v, mut c) = o.object(id).ok_or(BAD)?;
            c.skip();
            let data = if c.0.starts_with(b"stream") {
                Some(o.raw_stream(id, &mut v, c).ok_or(BAD)?)
            } else {
                None
            };
            doc.put(id, v, data)
        }
        Ok(doc)
    }
    fn put(&mut self, id: ObjectId, value: Value<'a>, data: Option<Cow<'a, [u8]>>) {
        let order = self.objects.get(&id.0).map_or_else(
            || {
                self.ordinal += 1;
                self.ordinal
            },
            |o| o.order,
        );
        self.objects.insert(
            id.0,
            Object {
                id,
                order,
                value,
                data,
            },
        );
    }
    pub(in super::super) fn apply(
        &mut self,
        input: &[u8],
        read: &mut impl FnMut(&str) -> Result<Option<Vec<u8>>, String>,
        limit: usize,
    ) -> Result<(), String> {
        let input = String::from_utf8_lossy(input.strip_prefix(&[239, 187, 191]).unwrap_or(input));
        let root = json::parse(
            input.as_bytes(),
            json::Limits {
                max_bytes: input.len(),
                max_depth: 100,
                max_nodes: limit,
            },
        )
        .map_err(|e| syntax(&input, e))?;
        if !object_like(&root) {
            return Err("Invalid QPDF JSON root".into());
        }
        let section = match root.get("qpdf") {
            Some(J::Array(a)) => a.get(1).filter(|v| object_like(v) || **v == J::Null),
            _ => None,
        }
        .or_else(|| root.get("objects").filter(|v| object_like(v)))
        .filter(|v| **v != J::Null)
        .ok_or("Missing QPDF JSON objects section")?;
        let mut root_ref = None;
        if let J::Object(entries) = section {
            for (key, entry) in entries {
                let key = String::from_utf16_lossy(key);
                if key == "trailer" {
                    if let Some(v) = entry.get("value") {
                        let v = cos(v)?;
                        root_ref = v.get(b"Root").and_then(Value::reference).or(root_ref);
                        self.info = v.get(b"Info").and_then(Value::reference).or(self.info)
                    }
                    continue;
                }
                let Some(id) = reference(&key) else { continue };
                if let Some(stream) = entry.get("stream").filter(|v| object_like(v)) {
                    let mut dict = match stream.get("dict").map(cos).transpose()? {
                        Some(Value::Dict(d)) => d,
                        _ => vec![],
                    };
                    let filter = dict
                        .iter()
                        .find(|(k, _)| k.as_ref() == b"Filter")
                        .map(|(_, v)| v);
                    let known = |v: &Value| {
                        matches!(
                            v.word(),
                            Some(
                                b"/FlateDecode"
                                    | b"/ASCIIHexDecode"
                                    | b"/ASCII85Decode"
                                    | b"/LZWDecode"
                                    | b"/RunLengthDecode"
                            )
                        )
                    };
                    if filter.is_some_and(|v| {
                        if let Value::Array(a) = v {
                            a.iter().all(known)
                        } else {
                            known(v)
                        }
                    }) {
                        dict.retain(|(k, _)| !matches!(k.as_ref(), b"Filter" | b"DecodeParms"))
                    }
                    let data = if let Some(J::String(s)) = stream.get("data") {
                        let mut data = vec![];
                        let (mut acc, mut bits) = (0u16, 0);
                        for &c in s {
                            let n = match c {
                                65..=90 => c - 65,
                                97..=122 => c - 97 + 26,
                                48..=57 => c - 48 + 52,
                                43 => 62,
                                47 => 63,
                                _ => continue,
                            };
                            acc = (acc << 6) | n;
                            bits += 6;
                            if bits >= 8 {
                                bits -= 8;
                                data.push((acc >> bits) as u8);
                            }
                        }
                        Cow::Owned(data)
                    } else if let Some(J::String(path)) = stream.get("datafile") {
                        let name = String::from_utf16_lossy(path);
                        let bytes = read(&name)?
                            .ok_or_else(|| format!("cannot open stream datafile {name}"))?;
                        self.external_bytes = self
                            .external_bytes
                            .checked_add(bytes.len())
                            .filter(|n| *n <= limit)
                            .ok_or(LARGE)?;
                        Cow::Owned(bytes)
                    } else {
                        self.objects
                            .get_mut(&id.0)
                            .and_then(|o| o.data.take())
                            .unwrap_or_default()
                    };
                    self.put(id, Value::Dict(dict), Some(data))
                } else if let Some(v) = entry.get("value") {
                    if *v == J::Null {
                        self.objects.remove(&id.0);
                    } else {
                        self.put(id, cos(v)?, None)
                    }
                }
            }
        }
        self.root = root_ref
            .or_else(|| {
                self.objects
                    .values()
                    .filter(|o| {
                        o.data.is_none()
                            && o.value.get(b"Type").and_then(Value::word) == Some(b"/Catalog")
                    })
                    .min_by_key(|o| o.order)
                    .map(|o| o.id)
            })
            .or(self.root);
        Ok(())
    }
    pub(in super::super) fn save(self, limit: usize) -> Result<Vec<u8>, String> {
        let (rn, rg) = self.root.ok_or("missing trailer /Root")?;
        let size = self.objects.last_key_value().map_or(1, |(n, _)| n + 1);
        if size > limit / 20 {
            return Err(LARGE.into());
        }
        let mut rows = vec![(0, 65535); size];
        let mut out = b"%PDF-1.7\n%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n".to_vec();
        for (n, o) in self.objects {
            rows[n] = (out.len(), o.id.1);
            writeln!(out, "{n} {} obj", o.id.1).unwrap();
            if let Some(data) = o.data {
                write_stream(&mut out, o.value, &data, None, limit)?
            } else {
                encode(&o.value, &mut out)?
            };
            out.extend_from_slice(b"\nendobj\n\n");
            if out.len() > limit {
                return Err(LARGE.into());
            }
        }
        let offset = out.len();
        if rows.len() * 20 > limit.saturating_sub(offset) {
            return Err(LARGE.into());
        }
        writeln!(out, "xref\n0 {size}").unwrap();
        for (pos, g) in rows {
            writeln!(
                out,
                "{pos:010} {g:05} {} ",
                if pos == 0 { 'f' } else { 'n' }
            )
            .unwrap()
        }
        write!(out, "trailer\n<<\n/Size {size}\n/Root {rn} {rg} R\n").unwrap();
        if let Some((n, g)) = self.info {
            writeln!(out, "/Info {n} {g} R").unwrap()
        }
        write!(out, ">>\n\nstartxref\n{offset}\n%%EOF").unwrap();
        if out.len() > limit {
            Err(LARGE.into())
        } else {
            Ok(out)
        }
    }
}

// The JSON parser reports a byte offset. On a failure only, recover the
// surrounding grammar and UTF-16 position used by JSON.parse diagnostics.
fn syntax(input: &str, e: json::Error) -> String {
    use json::ErrorKind::*;
    if matches!(e.kind, ByteLimit | DepthLimit | NodeLimit | InvalidLimits) {
        return "QPDF JSON input limit exceeded".into();
    }
    let bytes = input.as_bytes();
    let mut pos = e.offset.min(bytes.len());
    let mut parents = vec![];
    let mut last = b' '; // k: complete key, v: complete value, or literal punctuation
    let mut quoted = false;
    let mut key = false;
    let mut slash = false;
    let mut hex = 0;
    let mut i = 0;
    let mut zero = None;
    while i < pos {
        let b = bytes[i];
        i += 1;
        if quoted {
            if hex > 0 {
                hex -= 1
            } else if slash {
                slash = false;
                if b == b'u' {
                    hex = 4
                }
            } else if b == b'\\' {
                slash = true
            } else if b == b'"' {
                quoted = false;
                last = if key { b'k' } else { b'v' }
            }
            continue;
        }
        match b {
            b' ' | b'\r' | b'\n' | b'\t' => (),
            b'{' | b'[' => {
                parents.push(b);
                last = b
            }
            b'}' | b']' => {
                parents.pop();
                last = b'v'
            }
            b':' | b',' => last = b,
            b'"' => {
                quoted = true;
                key = parents.last() == Some(&b'{') && matches!(last, b'{' | b',')
            }
            _ => {
                let start = i - 1;
                while i < pos && !b"{}[],:\" \r\n\t".contains(&bytes[i]) {
                    i += 1
                }
                if matches!(&bytes[start..i], b"0" | b"-0") {
                    zero = Some(i)
                }
                last = b'v'
            }
        }
    }
    let ch = bytes.get(pos).copied();
    let stem = if quoted {
        if hex > 0 {
            Some("Bad Unicode escape in JSON")
        } else if slash && ch.is_some() {
            Some("Bad escaped character in JSON")
        } else if ch.is_some() {
            Some("Bad control character in string literal in JSON")
        } else if !slash {
            Some("Unterminated string in JSON")
        } else {
            None
        }
    } else if e.kind == InvalidNumber {
        let prefix = &bytes[..pos];
        if prefix.ends_with(b".") {
            Some("Unterminated fractional number in JSON")
        } else if prefix.ends_with(b"-")
            && !matches!(prefix.get(pos.wrapping_sub(2)), Some(b'e' | b'E'))
        {
            Some("No number after minus sign in JSON")
        } else {
            Some("Exponent part is missing a number in JSON")
        }
    } else if zero == Some(pos) && ch.is_some_and(|b| b.is_ascii_digit()) {
        Some("Unexpected number in JSON")
    } else if e.kind == TrailingData {
        Some("Unexpected non-whitespace character after JSON")
    } else if last == b'k' {
        Some("Expected ':' after property name in JSON")
    } else if last == b'{' {
        Some("Expected property name or '}' in JSON")
    } else if last == b',' && parents.last() == Some(&b'{') {
        Some("Expected double-quoted property name in JSON")
    } else if last == b'v' && parents.last() == Some(&b'{') {
        Some("Expected ',' or '}' after property value in JSON")
    } else if last == b'v' && parents.last() == Some(&b'[') {
        Some("Expected ',' or ']' after array element in JSON")
    } else {
        None
    };
    if stem.is_none() && !quoted {
        if matches!(input, "undefined" | "NaN" | "Infinity" | "[object Object]") {
            return format!("\"{input}\" is not valid JSON");
        }
        let literal: &[u8] = match ch {
            Some(b't') => b"true",
            Some(b'f') => b"false",
            Some(b'n') => b"null",
            _ => b"",
        };
        pos += literal
            .iter()
            .zip(&bytes[pos..])
            .take_while(|(a, b)| a == b)
            .count();
    }
    let prefix = &input[..pos];
    let at = prefix.encode_utf16().count();
    if let Some(stem) = stem {
        let mut line = 1;
        let mut column = 1;
        let mut cr = false;
        for u in prefix.encode_utf16() {
            match u {
                13 => {
                    line += 1;
                    column = 1
                }
                10 => {
                    if !cr {
                        line += 1
                    };
                    column = 1
                }
                _ => column += 1,
            }
            cr = u == 13
        }
        return format!("{stem} at position {at} (line {line} column {column})");
    }
    if pos == input.len() {
        return "Unexpected end of JSON input".into();
    }
    let units = input.encode_utf16().count();
    let excerpt = if units <= 20 {
        format!("\"{input}\"")
    } else {
        let start = at.saturating_sub(10);
        let end = (at + 10).min(units);
        let window: Vec<_> = input.encode_utf16().skip(start).take(end - start).collect();
        format!(
            "{}\"{}\"{}",
            if at >= 10 { "..." } else { "" },
            String::from_utf16_lossy(&window),
            if end < units { "..." } else { "" }
        )
    };
    let c = String::from_utf16_lossy(&[input[pos..].encode_utf16().next().unwrap()]);
    format!("Unexpected token '{c}', {excerpt} is not valid JSON")
}
