// Read font dictionaries through the page resource graph, without decoding content streams.
use super::{Objects, PageSource, Value};
use std::collections::BTreeSet;
use std::fmt::Write;

fn name(bytes: &[u8]) -> String {
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut rest = bytes;
    while let Some((&b, tail)) = rest.split_first() {
        if b == b'#'
            && let Some(digits) = tail.get(..2)
            && let Some(n) = std::str::from_utf8(digits)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
        {
            decoded.push(n);
            rest = &tail[2..];
        } else {
            decoded.push(b);
            rest = tail;
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

struct FontTable<'b, 'a> {
    objects: &'b mut Objects<'a>,
    seen: BTreeSet<String>,
    rows: String,
    location: bool,
    postscript: bool,
    substitute: bool,
}

impl<'a> FontTable<'_, 'a> {
    fn field(&mut self, value: &Value<'a>, key: &[u8]) -> Option<Value<'a>> {
        self.objects.resolve(value.get(key)?)
    }

    fn stream_dict(&mut self, value: &Value<'a>) -> Option<Value<'a>> {
        let (dict, mut cursor) = self.objects.object(value.reference()?)?;
        (cursor.word()? == b"stream").then_some(dict)
    }

    fn font(&mut self, key: String, node: &Value<'a>, depth: usize) -> Option<()> {
        let id = node.reference();
        if !self
            .seen
            .insert(id.map_or_else(|| format!("inline:{key}"), |(n, g)| format!("{n}:{g}")))
        {
            return Some(());
        }
        let Some(dict @ Value::Dict(_)) = self.objects.resolve(node) else {
            return Some(());
        };
        let base = dict
            .get(b"BaseFont")
            .or_else(|| dict.get(b"Name"))
            .and_then(|v| self.objects.resolve(v));
        let font = match base {
            Some(Value::Word(w)) if w.starts_with(b"/") => name(&w[1..]),
            Some(Value::String { bytes, .. }) => super::super::text(&bytes),
            _ => "[none]".into(),
        };
        let subtype = self.field(&dict, b"Subtype").and_then(|v| v.word());
        let descendant = if subtype == Some(b"/Type0")
            && let Some(Value::Array(items)) = self.field(&dict, b"DescendantFonts")
        {
            items.first().and_then(|v| self.objects.resolve(v))
        } else {
            None
        };
        let descriptor = self
            .field(&dict, b"FontDescriptor")
            .or_else(|| self.field(descendant.as_ref()?, b"FontDescriptor"));
        let has = |key: &[u8]| descriptor.as_ref().is_some_and(|d| d.get(key).is_some());
        let embedded = subtype == Some(b"/Type3")
            || [b"FontFile".as_slice(), b"FontFile2", b"FontFile3"]
                .iter()
                .any(|k| has(k));
        let kind = match subtype {
            Some(b"/TrueType") => "TrueType",
            Some(b"/MMType1") => "MM Type 1",
            Some(b"/Type3") => "Type 3",
            Some(b"/Type0") => {
                if descendant
                    .as_ref()
                    .and_then(|d| self.field(d, b"Subtype"))
                    .and_then(|v| v.word())
                    == Some(b"/CIDFontType2")
                {
                    "CID TrueType"
                } else {
                    "CID Type 0"
                }
            }
            _ if has(b"FontFile3") => "Type 1C",
            _ => "Type 1",
        };
        let obj = id.map_or_else(|| "   [none]".into(), |(n, g)| format!("{n:>6} {g:>2}"));
        if self.substitute {
            if !embedded {
                let sub = if font.starts_with("Helvetica") || font.starts_with("Arial") {
                    "Nimbus Sans"
                } else if font.starts_with("Times") {
                    "Nimbus Roman"
                } else if font.starts_with("Courier") {
                    "Nimbus Mono PS"
                } else if font == "Symbol" {
                    "Standard Symbols PS"
                } else if font == "ZapfDingbats" {
                    "D050000L"
                } else {
                    &font
                };
                writeln!(
                    self.rows,
                    "{font:<36.36} {obj} {sub:<36.36} /usr/share/fonts/type1/urw-base35/{}.t1",
                    sub.replace(' ', "")
                )
                .ok()?;
            }
        } else {
            let enc = match self.field(&dict, b"Encoding") {
                Some(Value::Word(b"/WinAnsiEncoding")) => "WinAnsi".into(),
                Some(Value::Word(b"/MacRomanEncoding")) => "MacRoman".into(),
                Some(Value::Word(b"/StandardEncoding")) => "Standard".into(),
                Some(Value::Word(w)) if w.starts_with(b"/") => name(&w[1..]),
                Some(Value::Dict(_)) => "Custom".into(),
                _ => "Builtin".into(),
            };
            let yn = |b| if b { "yes" } else { "no " };
            let subset = font.len() > 7
                && font.as_bytes()[6] == b'+'
                && font.as_bytes()[..6].iter().all(u8::is_ascii_uppercase);
            write!(
                self.rows,
                "{font:<36.36} {kind:<17} {enc:<16.16} {} {} {} {obj}",
                yn(embedded),
                yn(subset),
                yn(dict.get(b"ToUnicode").is_some())
            )
            .ok()?;
            if self.location {
                if embedded {
                    self.rows.push_str(" Embedded");
                } else if self.postscript {
                    write!(self.rows, " Substitute ({font})").ok()?;
                } else {
                    self.rows.push_str(" Substitute");
                }
            }
            self.rows.push('\n');
        }
        if self.rows.len() > crate::budget::ShellLimits::default().max_output_bytes {
            return None;
        }
        if subtype == Some(b"/Type3") {
            self.resources(dict.get(b"Resources"), depth + 1)?;
        }
        Some(())
    }

    fn resources(&mut self, node: Option<&Value<'a>>, depth: usize) -> Option<()> {
        let Some(dict) = node.and_then(|v| self.objects.resolve(v)) else {
            return Some(());
        };
        if depth > 64 {
            return None;
        }
        if let Some(Value::Dict(fonts)) = self.field(&dict, b"Font") {
            for (k, v) in fonts {
                self.font(name(k), &v, depth)?;
            }
        }
        if let Some(Value::Dict(states)) = self.field(&dict, b"ExtGState") {
            for (k, v) in states {
                if let Some(s) = self.objects.resolve(&v)
                    && let Some(Value::Array(a)) = self.field(&s, b"Font")
                    && let Some(f) = a.first()
                {
                    self.font(format!("ExtGS_{}", name(k)), f, depth)?;
                }
            }
        }
        for key in [b"XObject".as_slice(), b"Pattern"] {
            if let Some(Value::Dict(entries)) = self.field(&dict, key) {
                for (_, v) in entries {
                    if let Some((n, _)) = v.reference()
                        && self.seen.insert(format!("form:{n}"))
                        && let Some(stream) = self.stream_dict(&v)
                        && (key == b"Pattern"
                            || self.field(&stream, b"Subtype").and_then(|v| v.word())
                                == Some(b"/Form"))
                    {
                        self.resources(stream.get(b"Resources"), depth + 1)?;
                    }
                }
            }
        }
        Some(())
    }
}

impl PageSource<'_> {
    pub(in crate::commands::archive) fn font_rows(
        &mut self,
        first: usize,
        last: usize,
        location: bool,
        postscript: bool,
        substitute: bool,
    ) -> Option<String> {
        let mut table = FontTable {
            objects: &mut self.objects,
            rows: String::new(),
            seen: BTreeSet::new(),
            location,
            postscript,
            substitute,
        };
        for id in self.pages.get(first.checked_sub(1)?..last)? {
            let page = table.objects.page_dict(*id, &self.tree)?;
            let mut node = &page;
            for _ in 0..128 {
                if let Some(res) = node.get(b"Resources") {
                    table.resources(Some(res), 0)?;
                    break;
                }
                let Some(parent) = node
                    .get(b"Parent")
                    .and_then(Value::reference)
                    .and_then(|r| self.tree.get(&r))
                    .and_then(Option::as_ref)
                else {
                    break;
                };
                node = parent;
            }
            if let Some(Value::Array(annots)) = table.field(&page, b"Annots") {
                for a in annots {
                    let Some(ap) = table
                        .objects
                        .resolve(&a)
                        .and_then(|d| table.field(&d, b"AP"))
                    else {
                        continue;
                    };
                    for k in [b"N", b"R", b"D"] {
                        let Some(v) = ap.get(k) else {
                            continue;
                        };
                        if let Some(stream) = table.stream_dict(v) {
                            table.resources(stream.get(b"Resources"), 0)?;
                        } else if let Some(Value::Dict(states)) = table.objects.resolve(v) {
                            for (_, s) in states {
                                if let Some(stream) = table.stream_dict(&s) {
                                    table.resources(stream.get(b"Resources"), 0)?;
                                }
                            }
                        }
                    }
                }
            }
        }
        if let Some(a) = table.field(&self.catalog, b"AcroForm") {
            table.resources(a.get(b"DR"), 0)?;
        }
        Some(table.rows)
    }
}
