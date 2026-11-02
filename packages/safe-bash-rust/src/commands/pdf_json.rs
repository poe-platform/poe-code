// qpdf's JSON reports describe indexed COS objects, including unreferenced ones.
use super::super::{Location, pdf_string};
use super::{ObjectId, Objects, PageSource, Value};
use crate::commands::archive::base64_encode;
use mcp_protocol_rust::json::{self, Value as J};
use std::collections::{BTreeMap, BTreeSet};

const INVALID: &str = "qpdf: invalid PDF object or stream\n";
const SHELL_ERROR: &str = "shell: line 1: internal error\n";
type Report = (String, Vec<(String, Vec<u8>)>);

fn string(s: &str) -> J {
    J::String(s.encode_utf16().collect())
}
fn record<const N: usize>(items: [(&str, J); N]) -> J {
    J::Object(
        items
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
use pdf_string::name;
fn text(v: &Value<'_>) -> Option<String> {
    match v {
        Value::String { bytes, .. } => Some(pdf_string::decode(bytes)),
        Value::Word(w) => Some(name(w.strip_prefix(b"/")?)),
        _ => None,
    }
}
fn cos(v: &Value<'_>) -> J {
    match v {
        Value::Ref((n, g)) => string(&format!("{n} {g} R")),
        Value::String { bytes, .. } => string(&format!("u:{}", pdf_string::decode(bytes))),
        Value::Word(w) => match w.as_ref() {
            b"true" => J::Bool(true),
            b"false" => J::Bool(false),
            _ if w.starts_with(b"/") => string(&name(w)),
            _ => v.number().map_or(J::Null, J::Number),
        },
        Value::Array(items) => J::Array(items.iter().map(cos).collect()),
        Value::Dict(items) => {
            let mut indices = BTreeMap::new();
            let mut entries = Vec::new();
            for (key, v) in items {
                let key = format!("/{}", name(key));
                let index = *indices.entry(key.clone()).or_insert(entries.len());
                let entry = (key.encode_utf16().collect(), cos(v));
                if index == entries.len() {
                    entries.push(entry);
                } else {
                    entries[index] = entry;
                }
            }
            J::Object(entries)
        }
    }
}

// Bound the indented representation as it is produced; nested arrays can be
// much larger as JSON than they are in the PDF. Scalar encoding follows JS.
fn pretty(v: &J, depth: usize, out: &mut String, limit: usize) -> Result<(), &'static str> {
    let pad = |out: &mut String, d: usize| {
        if d * 2 + 1 > limit.saturating_sub(out.len()) {
            return Err(SHELL_ERROR);
        }
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', d * 2));
        Ok(())
    };
    let size = match v {
        J::Object(a) => a.len(),
        J::Array(a) => a.len(),
        _ => {
            let s = json::stringify(v);
            if s.len() > limit.saturating_sub(out.len()) {
                return Err(SHELL_ERROR);
            }
            out.push_str(&s);
            return Ok(());
        }
    };
    let obj = matches!(v, J::Object(_));
    out.push(if obj { '{' } else { '[' });
    for i in 0..size {
        if i > 0 {
            out.push(',');
        }
        pad(out, depth + 1)?;
        let item = match v {
            J::Array(a) => &a[i],
            J::Object(a) => {
                pretty(&J::String(a[i].0.clone()), depth + 1, out, limit)?;
                out.push_str(": ");
                &a[i].1
            }
            _ => unreachable!(),
        };
        pretty(item, depth + 1, out, limit)?;
    }
    if size != 0 {
        pad(out, depth)?;
    }
    out.push(if obj { '}' } else { ']' });
    if out.len() > limit {
        return Err(SHELL_ERROR);
    }
    Ok(())
}

impl<'a> PageSource<'a> {
    pub(in crate::commands::archive) fn qpdf_json(
        &mut self,
        version: u32,
        page_list: bool,
        selectors: &[Option<ObjectId>],
        mode: &str,
        (prefix, destination): (&str, Option<&str>),
        limit: usize,
    ) -> Result<Report, &'static str> {
        let mut order: Vec<_> = self
            .objects
            .xref
            .iter()
            .map(|(&id, (loc, order))| ((matches!(loc, Location::Member { .. }), *order), id))
            .collect();
        order.sort_unstable();
        let mut ids: Vec<_> = order.into_iter().map(|(_, id)| id).collect();
        ids.extend(
            self.pages
                .iter()
                .filter(|id| !self.objects.xref.contains_key(id)),
        );
        let highest = ids.iter().map(|id| id.0).max().unwrap_or(0);
        let mut objects = Vec::new();
        let mut files = Vec::new();
        let mut remaining = limit;
        let mut inline_budget = limit;
        for id in ids {
            if !selectors.is_empty() && !selectors.contains(&Some(id)) {
                continue;
            }
            let (v, stream) = if self.objects.xref.contains_key(&id) {
                let (mut v, mut c) = self.objects.object(id).ok_or(INVALID)?;
                c.skip();
                let stream = if c.0.starts_with(b"stream") {
                    Some(self.objects.raw_stream(id, &mut v, c).ok_or(INVALID)?)
                } else {
                    None
                };
                (v, stream)
            } else {
                (
                    self.tree.get(&id).and_then(|v| v.clone()).ok_or(INVALID)?,
                    None,
                )
            };
            let obj = if let Some(bytes) = stream {
                let mut fields = vec![("dict".encode_utf16().collect(), cos(&v))];
                if mode != "none" {
                    let data = self.objects.decode(&v, bytes).ok_or(SHELL_ERROR)?;
                    if mode == "inline" {
                        inline_budget = inline_budget
                            .checked_sub(data.len().div_ceil(3).checked_mul(4).ok_or(SHELL_ERROR)?)
                            .ok_or(SHELL_ERROR)?;
                        fields.push((
                            "data".encode_utf16().collect(),
                            string(&base64_encode(&data)),
                        ));
                    } else {
                        let path = format!("{prefix}{}", id.0);
                        fields.push(("datafile".encode_utf16().collect(), string(&path)));
                        // The stream must decode within its limit even when the
                        // report replaces it at publication.
                        if data.len() > limit {
                            return Err(SHELL_ERROR);
                        }
                        if Some(path.as_str()) == destination {
                            files.push((path, Vec::new()));
                        } else {
                            remaining = remaining.checked_sub(data.len()).ok_or(SHELL_ERROR)?;
                            files.push((path, data.into_owned()));
                        }
                    }
                }
                record([("stream", J::Object(fields))])
            } else {
                record([("value", cos(&v))])
            };
            objects.push((
                format!("obj:{} {} R", id.0, id.1).encode_utf16().collect(),
                obj,
            ));
        }
        if selectors.is_empty() || selectors.contains(&None) {
            let mut entries = Vec::new();
            for k in [b"Root".as_slice(), b"Info"] {
                if let Some(v) = self.trailer.get(k) {
                    entries.push((format!("/{}", name(k)).encode_utf16().collect(), cos(v)));
                }
            }
            entries.push((
                "/Size".encode_utf16().collect(),
                J::Number((highest + 1) as f64),
            ));
            objects.push((
                "trailer".encode_utf16().collect(),
                record([("value", J::Object(entries))]),
            ));
        }
        let version_text = super::super::header_version(self.objects.bytes)
            .ok_or(INVALID)?
            .iter()
            .map(|b| char::from(*b))
            .collect::<String>();
        let mut meta = vec![("pdfversion".encode_utf16().collect(), string(&version_text))];
        if version == 2 {
            meta.push((
                "maxobjectid".encode_utf16().collect(),
                J::Number(highest as f64),
            ));
        }
        let pages = if page_list {
            J::Array(
                self.pages
                    .iter()
                    .enumerate()
                    .map(|(i, (n, g))| {
                        record([
                            ("object", string(&format!("obj:{n} {g} R"))),
                            ("pageposfrom1", J::Number((i + 1) as f64)),
                        ])
                    })
                    .collect(),
            )
        } else {
            J::Number(self.pages.len() as f64)
        };
        let mut labels = Vec::new();
        for (index, label) in self
            .objects
            .tree_pairs(self.catalog.get(b"PageLabels"), b"Nums")
            .ok_or(INVALID)?
        {
            let Some(i) = self.objects.resolve(&index).and_then(|v| v.number()) else {
                continue;
            };
            let Some(v @ Value::Dict(_)) = self.objects.resolve(&label) else {
                continue;
            };
            let start = v
                .get(b"St")
                .and_then(|v| self.objects.resolve(v))
                .and_then(|v| v.number())
                .unwrap_or(1.);
            let mut row = vec![
                ("index".encode_utf16().collect(), J::Number(i)),
                ("start".encode_utf16().collect(), J::Number(start)),
            ];
            for (field, key) in [("prefix", b"P"), ("style", b"S")] {
                if let Some(t) = v
                    .get(key)
                    .and_then(|v| self.objects.resolve(v))
                    .and_then(|v| text(&v))
                {
                    row.push((field.encode_utf16().collect(), string(&t)));
                }
            }
            labels.push(J::Object(row));
        }
        let mut attachments = Vec::new();
        let mut seen = BTreeSet::new();
        for a in self.attachments(true).ok_or(INVALID)? {
            self.objects.decoded_stream(a.stream).ok_or(SHELL_ERROR)?;
            if a.key == "__proto__" || !seen.insert(a.key.clone()) {
                continue;
            }
            attachments.push((
                a.key,
                record([("filename", string(&pdf_string::decode(&a.filename)))]),
            ));
        }
        attachments.sort_by_key(|(k, _)| {
            k.parse::<u32>()
                .ok()
                .filter(|n| n.to_string() == *k)
                .unwrap_or(u32::MAX)
        });
        let attachments = J::Object(
            attachments
                .into_iter()
                .map(|(k, v)| (k.encode_utf16().collect(), v))
                .collect(),
        );
        let outlines = self.json_outlines().ok_or(INVALID)?;
        let form = self.json_form().ok_or(INVALID)?;
        for (key, value) in [
            ("pages", pages),
            ("pagelabels", J::Array(labels)),
            ("outlines", outlines),
            ("acroform", form),
            ("encrypt", record([("encrypted", J::Bool(self.objects.security.is_some()))])),
            ("attachments", attachments),
        ] {
            meta.push((key.encode_utf16().collect(), value));
        }
        let report = if version == 1 {
            meta.insert(0, ("version".encode_utf16().collect(), J::Number(1.)));
            meta.push(("objects".encode_utf16().collect(), J::Object(objects)));
            J::Object(meta)
        } else {
            record([
                ("version", J::Number(2.)),
                ("qpdf", J::Array(vec![J::Object(meta), J::Object(objects)])),
            ])
        };
        let mut output = String::new();
        pretty(
            &report,
            0,
            &mut output,
            remaining.checked_sub(1).ok_or(SHELL_ERROR)?,
        )?;
        output.push('\n');
        Ok((output, files))
    }
}

impl<'a> PageSource<'a> {
    fn json_form(&mut self) -> Option<J> {
        let form = self
            .catalog
            .get(b"AcroForm")
            .and_then(|v| self.objects.resolve(v));
        let need = form
            .as_ref()
            .and_then(|v| v.get(b"NeedAppearances"))
            .and_then(|v| self.objects.resolve(v))
            .is_some_and(|v| v.word() == Some(b"true"));
        let roots = form
            .as_ref()
            .and_then(|v| v.get(b"Fields"))
            .and_then(|v| self.objects.resolve(v));
        let mut fields = Vec::new();
        if let Some(Value::Array(roots)) = roots {
            let mut active = BTreeSet::new();
            for node in &roots {
                self.objects
                    .json_field(node, "", "", &mut active, &mut fields, 0)?;
            }
        }
        Some(record([
            ("hasacroform", J::Bool(!fields.is_empty())),
            ("needappearances", J::Bool(need)),
            ("fields", J::Array(fields)),
        ]))
    }

    fn json_outlines(&mut self) -> Option<J> {
        let outlines=self.objects.outlines(&self.catalog,&self.pages)?;
        Some(J::Array(outlines.into_iter().map(|(title,_,index)|{
            let (n,g)=self.pages.get(index).copied().unwrap_or_default();
            record([("title",string(&title)),("destpagepos",J::Number((index+1) as f64)),
                ("destpageobject",string(&format!("obj:{n} {g} R")))])
        }).collect()))
    }
}
impl<'a> Objects<'a> {
    pub(super) fn named_destinations(&mut self,catalog:&Value<'a>)->Option<BTreeMap<String,Value<'a>>>{
        let mut named = BTreeMap::new();
        if let Some(names) = catalog
            .get(b"Names")
            .and_then(|v| self.resolve(v))
        {
            for (k, v) in self.tree_pairs(names.get(b"Dests"), b"Names")? {
                if let Some(k) = self.resolve(&k).and_then(|v| text(&v)) {
                    named.entry(k).or_insert(v);
                }
            }
        }
        if let Some(Value::Dict(dests)) = catalog
            .get(b"Dests")
            .and_then(|v| self.resolve(v))
        {
            for (k, v) in dests {
                named.insert(name(&k), v);
            }
        }
        Some(named)
    }
    pub(super) fn destination_index(&mut self,raw:Option<&Value<'a>>,named:&BTreeMap<String,Value<'a>>,indices:&BTreeMap<usize,usize>,count:usize)->Option<usize>{
        let mut dest=self.resolve(raw?);
            if let Some(Value::Dict(_)) = &dest {
                dest = dest
                    .as_ref()
                    .and_then(|v| v.get(b"D").or_else(|| v.get(b"Dest")))
                    .and_then(|v| self.resolve(v));
            }
            if let Some(k) = dest.as_ref().and_then(text) {
                dest = named.get(&k).and_then(|v| self.resolve(v));
                if let Some(Value::Dict(_)) = &dest {
                    dest = dest
                        .as_ref()
                        .and_then(|v| v.get(b"D"))
                        .and_then(|v| self.resolve(v));
                }
            }
        let Value::Array(a)=dest? else{return None};
        let first=a.first()?;
        if let Some(id)=first.reference(){indices.get(&id.0).copied()}
        else {first.number().filter(|n|*n>=0. && *n<count as f64).map(|n|n.round() as usize)}
    }
    pub(in super::super) fn outlines(&mut self, catalog:&Value<'a>, pages:&[ObjectId]) -> Option<Vec<(String,usize,usize)>> {
        let root = catalog
            .get(b"Outlines")
            .and_then(|v| self.resolve(v));
        let mut stack: Vec<_> = root
            .as_ref()
            .and_then(|v| v.get(b"First"))
            .cloned().map(|v|(v,1usize))
            .into_iter()
            .collect();
        let mut rows = Vec::new();
        if stack.is_empty() {
            return Some(rows);
        }
        let indices: BTreeMap<_, _> = pages
            .iter()
            .enumerate()
            .rev()
            .map(|(i, id)| (id.0, i))
            .collect();
        let named=self.named_destinations(catalog)?;
        let mut seen = BTreeSet::new();
        while let Some((v,level)) = stack.pop() {
            self.tokens = self.tokens.checked_sub(1)?;
            if v.reference().is_some_and(|r| !seen.insert(r)) {
                continue;
            }
            let Some(dict @ Value::Dict(_)) = self.resolve(&v) else {
                continue;
            };
            stack.extend(dict.get(b"Next").cloned().map(|x|(x,level)));
            stack.extend(dict.get(b"First").cloned().map(|x|(x,level+1)));
            let Some(Value::String { bytes, .. }) =
                dict.get(b"Title").and_then(|v| self.resolve(v))
            else {
                continue;
            };
            let title = pdf_string::decode(&bytes);
            if title.is_empty() {
                continue;
            }
            let dest=dict.get(b"Dest").or_else(||dict.get(b"A"));
            let index=self.destination_index(dest,&named,&indices,pages.len()).unwrap_or(0);
            rows.push((title,level,index));
        }
        Some(rows)
    }
    fn json_field(
        &mut self,
        node: &Value<'a>,
        prefix: &str,
        inherited_type: &str,
        active: &mut BTreeSet<ObjectId>,
        out: &mut Vec<J>,
        depth: usize,
    ) -> Option<()> {
        self.tokens = self.tokens.checked_sub(1)?;
        if depth > 64 {
            return None;
        }
        let Some(dict @ Value::Dict(_)) = self.resolve(node) else {
            return Some(());
        };
        if let Some(r) = node.reference()
            && !active.insert(r)
        {
            return Some(());
        }
        let part = dict
            .get(b"T")
            .and_then(|v| self.resolve(v))
            .and_then(|v| text(&v))
            .unwrap_or_default();
        let key = if prefix.is_empty() {
            part
        } else if part.is_empty() {
            prefix.to_owned()
        } else {
            format!("{prefix}.{part}")
        };
        self.remaining_bytes = self.remaining_bytes.checked_sub(key.len())?;
        let kind = dict
            .get(b"FT")
            .and_then(|v| self.resolve(v))
            .and_then(|v| text(&v))
            .unwrap_or_else(|| inherited_type.to_owned());
        let mut leaf = true;
        if let Some(Value::Array(kids)) = dict.get(b"Kids").and_then(|v| self.resolve(v))
            && !kids.is_empty()
            && (kind.is_empty()
                || key.is_empty()
                || kids
                    .iter()
                    .any(|kid| self.resolve(kid).is_some_and(|v| v.get(b"T").is_some())))
        {
            leaf = false;
            for kid in &kids {
                self.json_field(kid, &key, &kind, active, out, depth + 1)?;
            }
        }
        if leaf && !key.is_empty() {
            let mut parent = dict;
            let mut seen = BTreeSet::new();
            let value = loop {
                if let Some(v) = parent.get(b"V") {
                    break self.resolve(v);
                }
                let Some(next) = parent.get(b"Parent") else {
                    break None;
                };
                if next.reference().is_some_and(|id| !seen.insert(id)) {
                    break None;
                }
                let Some(v) = self.resolve(next) else {
                    break None;
                };
                parent = v;
            };
            let (ty, value) = if kind == "Btn" {
                (
                    "checkbox",
                    J::Bool(
                        value
                            .as_ref()
                            .and_then(Value::word)
                            .is_some_and(|w| w == b"true" || w.starts_with(b"/") && w != b"/Off"),
                    ),
                )
            } else {
                let s = match &value {
                    Some(Value::Array(a)) => a
                        .iter()
                        .filter_map(|v| self.resolve(v).and_then(|v| text(&v)))
                        .collect::<Vec<_>>()
                        .join(", "),
                    _ => value.as_ref().and_then(text).unwrap_or_default(),
                };
                (
                    match kind.as_str() {
                        "Tx" => "text",
                        "Ch" => "choice",
                        _ => "unknown",
                    },
                    string(&s),
                )
            };
            out.push(record([
                ("name", string(&key)),
                ("type", string(ty)),
                ("value", value),
            ]));
        }
        if let Some(id) = node.reference() {
            active.remove(&id);
        }
        Some(())
    }
}
