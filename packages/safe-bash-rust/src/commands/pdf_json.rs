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
fn cos(v: &Value<'_>, version: u32) -> J {
    match v {
        Value::Ref((n, g)) => string(&format!("{n} {g} R")),
        Value::String { bytes, .. } => string(&format!("{}{}", if version == 1 { "" } else { "u:" }, pdf_string::decode(bytes))),
        Value::Word(w) => match w.as_ref() {
            b"true" => J::Bool(true),
            b"false" => J::Bool(false),
            _ if w.starts_with(b"/") => string(&name(w)),
            _ => v.number().map_or(J::Null, J::Number),
        },
        Value::Array(items) => J::Array(items.iter().map(|v| cos(v, version)).collect()),
        Value::Dict(items) => {
            let mut indices = BTreeMap::new();
            let mut entries = Vec::new();
            for (key, v) in items {
                let key = format!("/{}", name(key));
                let index = *indices.entry(key.clone()).or_insert(entries.len());
                let entry = (key.encode_utf16().collect(), cos(v, version));
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

#[path = "pdf_json_pages.rs"]
mod pdf_json_pages;

fn attachment_date(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if !bytes.starts_with(b"D:") || bytes.len() < 16 || !bytes[2..16].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let zone = if bytes.len() > 16 && bytes[16] != b'Z' {
        if bytes.len() != 23 || !matches!(bytes[16], b'+' | b'-') || bytes[19] != b'\'' || bytes[22] != b'\''
            || !bytes[17..19].iter().chain(&bytes[20..22]).all(u8::is_ascii_digit) {
            return None;
        }
        format!("{}:{}", &value[16..19], &value[20..22])
    } else {"Z".into()};
    Some(format!("{}-{}-{}T{}:{}:{}{zone}", &value[2..6], &value[6..8], &value[8..10], &value[10..12], &value[12..14], &value[14..16]))
}

impl<'a> PageSource<'a> {
    fn json_attachment(&mut self, reference: &Value<'a>) -> J {
        let spec = self.objects.resolve(reference);
        let embedded = spec.as_ref().and_then(|s| s.get(b"EF")).and_then(|v| self.objects.resolve(v));
        let mut names = BTreeMap::new();
        let mut streams = BTreeMap::new();
        let mut preferred_name = J::Null;
        let mut preferred_contents = J::Null;
        for key in [b"UF".as_slice(), b"F", b"DOS", b"Mac", b"Unix"] {
            let label: Vec<u16> = format!("/{}", std::str::from_utf8(key).unwrap()).encode_utf16().collect();
            if let Some(Value::String {bytes, ..}) = spec.as_ref().and_then(|s| s.get(key)).and_then(|v| self.objects.resolve(v)) {
                let name = string(&pdf_string::decode(&bytes));
                if matches!(preferred_name, J::Null) {preferred_name = name.clone();}
                names.insert(label.clone(), name);
            }
            let Some(stream_ref) = embedded.as_ref().and_then(|e| e.get(key)) else {continue};
            let Some(stream @ Value::Dict(_)) = self.objects.resolve(stream_ref) else {continue};
            if matches!(preferred_contents, J::Null) && let Value::Ref((n, g)) = stream_ref {
                preferred_contents = string(&format!("{n} {g} R"));
            }
            let params = stream.get(b"Params").and_then(|v| self.objects.resolve(v));
            let checksum = match params.as_ref().and_then(|p| p.get(b"CheckSum")).and_then(|v| self.objects.resolve(v)) {
                Some(Value::String {bytes, ..}) => string(&bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()),
                _ => J::Null,
            };
            let date = match params.as_ref().and_then(|p| p.get(b"CreationDate")).and_then(|v| self.objects.resolve(v)) {
                Some(Value::String {bytes, ..}) => attachment_date(&pdf_string::decode(&bytes)).map_or(J::Null, |s| string(&s)),
                _ => J::Null,
            };
            let mime = match stream.get(b"Subtype").and_then(|v| self.objects.resolve(v)) {
                Some(Value::Word(w)) if w.starts_with(b"/") => string(&name(&w[1..])),
                _ => J::Null,
            };
            streams.insert(label, record([
                ("checksum", checksum), ("creationdate", date.clone()), ("mimetype", mime),
                // Native qpdf uses CreationDate for both date fields.
                ("modificationdate", date),
            ]));
        }
        let description = match spec.as_ref().and_then(|s| s.get(b"Desc")).and_then(|v| self.objects.resolve(v)) {
            Some(Value::String {bytes, ..}) => string(&pdf_string::decode(&bytes)),
            _ => J::Null,
        };
        record([
            ("description", description),
            ("filespec", match reference {Value::Ref((n, g)) => string(&format!("{n} {g} R")), _ => J::Null}),
            ("names", J::Object(names.into_iter().collect())),
            ("preferredcontents", preferred_contents), ("preferredname", preferred_name),
            ("streams", J::Object(streams.into_iter().collect())),
        ])
    }

    pub(in crate::commands::archive) fn qpdf_json(
        &mut self,
        version: u32,
        inline_images:Option<(u64,bool)>,
        keys: &[String],
        selectors: &[Option<ObjectId>],
        mode: &str,
        (prefix, destination): (&str, Option<&str>),
        limit: usize,
    ) -> Result<Report, &'static str> {
        let include = |key: &str| keys.is_empty() || keys.iter().any(|k| k == key);
        let include_objects = include(if version == 1 { "objects" } else { "qpdf" });
        let include_info = version == 1 && include("objectinfo");
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
        let mut highest = ids.iter().map(|id| id.0).max().unwrap_or(0);
        let mut edits=BTreeMap::new();
        let mut edited_pages=BTreeSet::new();
        let mut lengths=BTreeMap::new();
        if let Some((minimum,compress))=inline_images{
            let mut state=super::pdf_stamp::LayerState::default();
            state.counts=self.objects.reference_counts(&self.pages,&self.tree);
            let mut next=highest.checked_add(1).ok_or(SHELL_ERROR)?;
            let mut left=limit;
            lengths=state.externalize_images(&mut self.objects,&self.pages,&mut self.tree,&mut edits,&mut next,&mut left,minimum,compress).map_err(|_|SHELL_ERROR)?;
            state.finish(&mut edits,left).map_err(|_|SHELL_ERROR)?;
            ids.extend(edits.keys().copied().filter(|id|id.0>highest));
            highest=next-1;
            edited_pages.extend(self.pages.iter().copied());
        }
        let mut pages = Vec::new();
        if include("pages") {
            for index in 0..self.pages.len() { pages.push(self.json_page(index, version, &edits).ok_or(INVALID)?); }
        }
        let mut objects = Vec::new();
        let mut object_info = Vec::new();
        let mut files = Vec::new();
        let mut remaining = limit;
        let mut inline_budget = limit;
        for id in ids {
            if !include_objects && !include_info { continue; }
            if !selectors.is_empty() && !selectors.contains(&Some(id)) {
                continue;
            }
            let (mut v, stream) = if let Some(body)=edits.remove(&id){
                let mut c=super::super::Cursor(&body);
                let mut v=c.value(0,&mut self.objects.tokens,true).ok_or(INVALID)?.into_owned();c.skip();
                let raw=if c.0.is_empty(){None}else{
                    let b=c.0.strip_prefix(b"stream\n").and_then(|s|s.strip_suffix(b"\nendstream")).ok_or(INVALID)?;
                    if let Value::Dict(d)=&mut v{
                        if let Some(length)=lengths.remove(&id){super::set(d,b"Length",length)}else{d.retain(|(k,_)|k.as_ref()!=b"Length")}
                    }
                    Some(b.to_vec().into())
                };
                (v,raw)
            }else if edited_pages.contains(&id) && let Some(Some(v))=self.tree.get(&id){
                (v.clone(),None)
            }else if self.objects.xref.contains_key(&id) {
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
            if include_info {
                let mut value = |key| v.get(key).and_then(|v| self.objects.resolve(v)).map_or(J::Null, |v| cos(&v, version));
                object_info.push((format!("{} {} R", id.0, id.1).encode_utf16().collect(), record([("stream", record([
                    ("filter", if stream.is_some() { value(b"Filter") } else { J::Null }),
                    ("is", J::Bool(stream.is_some())),
                    ("length", if stream.is_some() { value(b"Length") } else { J::Null }),
                ]))])));
            }
            if !include_objects { continue; }
            let obj = if version == 1 { cos(&v, version) } else if let Some(bytes) = stream {
                let mut fields = Vec::new();
                if mode != "none" {
                    let data = self.objects.decode(&v, bytes).ok_or(SHELL_ERROR)?;
                    if let Value::Dict(entries) = &mut v {
                        entries.retain(|(key, _)| !matches!(key.as_ref(), b"Length" | b"Filter" | b"DecodeParms"));
                    }
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
                fields.insert(0, ("dict".encode_utf16().collect(), cos(&v, version)));
                record([("stream", J::Object(fields))])
            } else {
                record([("value", cos(&v, version))])
            };
            objects.push((
                format!("{}{} {} R", if version == 1 { "" } else { "obj:" }, id.0, id.1).encode_utf16().collect(),
                obj,
            ));
        }
        if include_objects && (selectors.is_empty() || selectors.contains(&None)) {
            let mut entries = Vec::new();
            for k in [b"Root".as_slice(), b"Info"] {
                if let Some(v) = self.trailer.get(k) {
                    entries.push((format!("/{}", name(k)).encode_utf16().collect(), cos(v, version)));
                }
            }
            entries.push((
                "/Size".encode_utf16().collect(),
                J::Number((highest + 1) as f64),
            ));
            if let Some(Value::Array(ids)) = self.trailer.get(b"ID") {
                entries.push(("/ID".encode_utf16().collect(), J::Array(ids.iter().map(|id| match id {
                    Value::String { bytes, .. } => string(&format!("b:{}", crate::commands::archive::hex_encode(bytes))),
                    _ => cos(id, version),
                }).collect())));
            }
            objects.push((
                "trailer".encode_utf16().collect(),
                if version == 1 { cos(&self.trailer, version) } else { record([("value", J::Object(entries))]) },
            ));
        }
        let version_text = super::super::header_version(self.objects.bytes).ok_or(INVALID)?;
        let mut labels = Vec::new();
        for (index, label) in if include("pagelabels") { self
            .objects
            .tree_pairs(self.catalog.get(b"PageLabels"), b"Nums")
            .ok_or(INVALID)? } else { Vec::new() }
        {
            let Some(i) = self.objects.resolve(&index).and_then(|v| v.number()) else {
                continue;
            };
            let Some(v @ Value::Dict(_)) = self.objects.resolve(&label) else {
                continue;
            };
            let start = v.get(b"St").and_then(|v| self.objects.resolve(v)).and_then(|v| v.number()).unwrap_or(1.);
            let mut label = vec![("/St".encode_utf16().collect(), J::Number(start))];
            if let Some(prefix @ Value::String { .. }) = v.get(b"P").and_then(|v| self.objects.resolve(v)) {
                label.push(("/P".encode_utf16().collect(), cos(&prefix, version)));
            }
            if let Some(style @ Value::Word(_)) = v.get(b"S").and_then(|v| self.objects.resolve(v))
                && style.word().is_some_and(|w| w.starts_with(b"/")) {
                label.push(("/S".encode_utf16().collect(), cos(&style, version)));
            }
            labels.push(record([("index", J::Number(i)), ("label", J::Object(label))]));
        }
        let mut attachments = Vec::new();
        let mut seen = BTreeSet::new();
        for a in if include("attachments") { self.attachments(true).ok_or(INVALID)? } else { Vec::new() } {
            self.objects.decoded_stream(a.stream).ok_or(SHELL_ERROR)?;
            if a.key == "__proto__" || !seen.insert(a.key.clone()) {
                continue;
            }
            attachments.push((
                a.key,
                self.json_attachment(&a.spec),
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
        let outlines = if include("outlines") { self.json_outlines(version).ok_or(INVALID)? } else { J::Array(Vec::new()) };
        let form = if include("acroform") { self.json_form(version).ok_or(INVALID)? } else { J::Null };
        let encrypt = if let Some(security) = &self.objects.security { security.json_report(version) } else {
            record([
                ("capabilities", record([
                    ("accessibility", J::Bool(true)), ("extract", J::Bool(true)),
                    (if version == 1 { "moddifyannotations" } else { "modifyannotations" }, J::Bool(true)),
                    ("modify", J::Bool(true)), ("modifyassembly", J::Bool(true)), ("modifyforms", J::Bool(true)),
                    ("modifyother", J::Bool(true)), ("printhigh", J::Bool(true)), ("printlow", J::Bool(true)),
                ])),
                ("encrypted", J::Bool(false)), ("ownerpasswordmatched", J::Bool(false)),
                ("parameters", record([
                    ("P", J::Number(0.)), ("R", J::Number(0.)), ("V", J::Number(0.)), ("bits", J::Number(0.)),
                    ("filemethod", string("none")), ("key", J::Null), ("method", string("none")),
                    ("streammethod", string("none")), ("stringmethod", string("none")),
                ])), ("recovereduserpassword", J::Null), ("userpasswordmatched", J::Bool(false)),
            ])
        };
        let mut sections = vec![
            ("pages", J::Array(pages)), ("pagelabels", J::Array(labels)),
            ("acroform", form), ("attachments", attachments), ("encrypt", encrypt), ("outlines", outlines),
        ];
        if version == 1 {
            sections.extend([("objects", J::Object(objects)), ("objectinfo", J::Object(object_info))]);
        } else {
            sections.push(("qpdf", J::Array(vec![record([
                ("jsonversion", J::Number(2.)), ("pdfversion", string(&version_text)),
                ("pushedinheritedpageresources", J::Bool(false)),
                ("calledgetallpages", J::Bool(["pages", "pagelabels", "acroform", "outlines"].iter().any(|k| include(k)))),
                ("maxobjectid", J::Number(highest as f64)),
            ]), J::Object(objects)])));
        }
        let mut fields = vec![("version".encode_utf16().collect(), J::Number(version as f64)),
            ("parameters".encode_utf16().collect(), record([("decodelevel", string("generalized"))]))];
        for (key, value) in sections { if include(key) { fields.push((key.encode_utf16().collect(), value)); } }
        let report = J::Object(fields);
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
    fn json_form(&mut self, version: u32) -> Option<J> {
        let form = self
            .catalog
            .get(b"AcroForm")
            .and_then(|v| self.objects.resolve(v));
        let need = form
            .as_ref()
            .and_then(|v| v.get(b"NeedAppearances"))
            .and_then(|v| self.objects.resolve(v))
            .is_some_and(|v| v.word() == Some(b"true"));
        let mut fields = Vec::new();
        if let Some(form @ Value::Dict(_)) = &form {
            for (index, &id) in self.pages.iter().enumerate() {
                let page = self.objects.page_dict(id, &self.tree)?;
                if let Some(Value::Array(annotations)) = page.get(b"Annots").and_then(|v| self.objects.resolve(v)) {
                    for annotation in annotations {
                        let field = self.objects.json_field(&annotation, index + 1, form, version)?;
                        if !matches!(field, J::Null) { fields.push(field); }
                    }
                }
            }
        }
        Some(record([
            ("hasacroform", J::Bool(matches!(form, Some(Value::Dict(_))))),
            ("needappearances", J::Bool(need)),
            ("fields", J::Array(fields)),
        ]))
    }

    fn json_outlines(&mut self, version: u32) -> Option<J> {
        let root = self.catalog.get(b"Outlines").and_then(|v| self.objects.resolve(v));
        let first = root.as_ref().and_then(|v| v.get(b"First")).cloned();
        let named = self.objects.named_destinations(&self.catalog)?;
        let mut seen = BTreeSet::new();
        fn siblings<'a>(objects: &mut Objects<'a>, mut node: Option<Value<'a>>, named: &BTreeMap<String, Value<'a>>,
            pages: &[ObjectId], seen: &mut BTreeSet<ObjectId>, version: u32, depth: usize) -> Option<Vec<J>> {
            if depth > 64 { return None; }
            let mut rows = Vec::new();
            while let Some(reference) = node {
                objects.tokens = objects.tokens.checked_sub(1)?;
                if reference.reference().is_some_and(|id| !seen.insert(id)) { break; }
                let Some(value) = objects.resolve(&reference) else { break };
                let action = value.get(b"A").and_then(|v| objects.resolve(v));
                let mut dest = value.get(b"Dest").or_else(|| action.as_ref().and_then(|v| v.get(b"D"))).and_then(|v| objects.resolve(v));
                if let Some(name) = dest.as_ref().and_then(text) { dest = named.get(&name).and_then(|v| objects.resolve(v)); }
                if matches!(dest, Some(Value::Dict(_))) { dest = dest.as_ref().and_then(|v| v.get(b"D")).and_then(|v| objects.resolve(v)); }
                let target = match &dest { Some(Value::Array(items)) => items.first().and_then(Value::reference), _ => None };
                let position = target.and_then(|id| pages.iter().position(|p| *p == id));
                let title = value.get(b"Title").and_then(|v| objects.resolve(v)).and_then(|v| text(&v)).unwrap_or_default();
                let count = value.get(b"Count").and_then(|v| objects.resolve(v)).and_then(|v| v.number());
                let kids = siblings(objects, value.get(b"First").cloned(), named, pages, seen, version, depth + 1)?;
                rows.push(record([
                    ("dest", dest.as_ref().map_or(J::Null, |v| cos(v, version))),
                    ("destpageposfrom1", position.map_or(J::Null, |i| J::Number((i + 1) as f64))),
                    ("kids", J::Array(kids)), ("object", cos(&reference, version)),
                    ("open", J::Bool(count.is_none_or(|n| n >= 0.))), ("title", string(&title)),
                ]));
                node = value.get(b"Next").cloned();
            }
            Some(rows)
        }
        Some(J::Array(siblings(&mut self.objects, first, &named, &self.pages, &mut seen, version, 0)?))
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
    fn json_field(&mut self, node: &Value<'a>, page: usize, form: &Value<'a>, version: u32) -> Option<J> {
        let Some(field @ Value::Dict(_)) = self.resolve(node) else { return Some(J::Null); };
        if field.get(b"Subtype").and_then(|v| self.resolve(v)).as_ref().and_then(Value::word) != Some(b"/Widget") {
            return Some(J::Null);
        }
        let mut chain = vec![field];
        let mut seen = BTreeSet::new();
        if let Some(id) = node.reference() { seen.insert(id); }
        while let Some(parent) = chain.last()?.get(b"Parent") {
            if parent.reference().is_some_and(|id| !seen.insert(id)) { break; }
            if chain.len() >= 64 { return None; }
            self.tokens = self.tokens.checked_sub(1)?;
            let Some(parent @ Value::Dict(_)) = self.resolve(parent) else { break; };
            chain.push(parent);
        }
        let field_text = |value: Option<Value<'a>>| match value {
            Some(Value::String { bytes, .. }) => pdf_string::decode(&bytes),
            _ => String::new(),
        };
        let field_name = |value: Option<Value<'a>>| value.as_ref().and_then(Value::word)
            .filter(|w| w.starts_with(b"/")).map(name).unwrap_or_default();
        let mut names = Vec::new();
        for field in chain.iter().rev() {
            let part = field_text(field.get(b"T").and_then(|v| self.resolve(v)));
            if !part.is_empty() { names.push(part); }
        }
        let fullname = names.join(".");
        self.remaining_bytes = self.remaining_bytes.checked_sub(fullname.len())?;
        let mut inherited = |key: &[u8]| chain.iter().chain(std::iter::once(form))
            .find_map(|field| field.get(key).and_then(|v| self.resolve(v)).filter(|v| v.word() != Some(b"null")));
        let fieldtype = field_name(inherited(b"FT"));
        let flags = inherited(b"Ff").as_ref().and_then(Value::number).unwrap_or(0.);
        let quadding = inherited(b"Q").as_ref().and_then(Value::number).unwrap_or(0.);
        let default = inherited(b"DV").as_ref().map_or(J::Null, |v| cos(v, version));
        let value = inherited(b"V").as_ref().map_or(J::Null, |v| cos(v, version));
        let options = if fieldtype == "/Ch" { inherited(b"Opt") } else { None };
        let mut choices = Vec::new();
        if let Some(Value::Array(options)) = options {
            for option in options {
                let option = self.resolve(&option);
                let display = match option {
                    Some(Value::Array(pair)) => pair.get(1).and_then(|v| self.resolve(v)),
                    other => other,
                };
                choices.push(string(&field_text(display)));
            }
        }
        let field = &chain[0];
        let alternative = field_text(field.get(b"TU").and_then(|v| self.resolve(v)));
        let mapping = field_text(field.get(b"TM").and_then(|v| self.resolve(v)));
        let annotationflags = field.get(b"F").and_then(|v| self.resolve(v)).as_ref().and_then(Value::number).unwrap_or(0.);
        let appearance = field_name(field.get(b"AS").and_then(|v| self.resolve(v)));
        let partial = field_text(field.get(b"T").and_then(|v| self.resolve(v)));
        let button_flags = flags as i64 as i32;
        Some(record([
            ("alternativename", string(if alternative.is_empty() { &fullname } else { &alternative })),
            ("annotation", record([("annotationflags", J::Number(annotationflags)), ("appearancestate", string(&appearance)), ("object", cos(node, version))])),
            ("choices", J::Array(choices)), ("defaultvalue", default), ("fieldflags", J::Number(flags)),
            ("fieldtype", string(&fieldtype)), ("fullname", string(&fullname)),
            ("ischeckbox", J::Bool(fieldtype == "/Btn" && button_flags & (32768 | 65536) == 0)),
            ("ischoice", J::Bool(fieldtype == "/Ch")), ("isradiobutton", J::Bool(fieldtype == "/Btn" && button_flags & 32768 != 0)),
            ("istext", J::Bool(fieldtype == "/Tx")),
            ("mappingname", string(if mapping.is_empty() { &fullname } else { &mapping })),
            ("object", cos(node, version)), ("pageposfrom1", J::Number(page as f64)),
            ("parent", field.get(b"Parent").map_or(J::Null, |v| cos(v, version))), ("partialname", string(&partial)),
            ("quadding", J::Number(quadding)), ("value", value),
        ]))
    }

}

#[cfg(test)]
mod schema_tests {
    use super::*;

    fn canonical(value: J) -> J {
        match value {
            J::Object(mut entries) => {
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                J::Object(entries.into_iter().map(|(k, v)| (k, canonical(v))).collect())
            }
            J::Array(values) => J::Array(values.into_iter().map(canonical).collect()),
            value => value,
        }
    }

    #[test]
    fn native_qpdf_json_section_schemas() {
        for (oracle, bytes) in [
            (include_bytes!("../../../pdf-ast/src/fixtures/qpdf-json-sections.json").as_slice(), &include_bytes!("../../../pdf-ast/src/fixtures/qpdf-prefixed-table.pdf")[14..]),
            (include_bytes!("../../../pdf-ast/src/fixtures/qpdf-json-pages.json").as_slice(), include_bytes!("../../../pdf-ast/src/fixtures/qpdf-json-pages.pdf").as_slice()),
        ] {
        let J::Array(cases) = json::parse(oracle, json::Limits::default()).unwrap() else { panic!() };
        for case in cases {
            let J::Number(version) = case.get("version").unwrap() else { panic!() };
            let J::Array(keys) = case.get("keys").unwrap() else { panic!() };
            let keys: Vec<String> = keys.iter().map(|v| { let J::String(s) = v else { panic!() }; String::from_utf16_lossy(s) }).collect();
            let mode = match case.get("mode") { Some(J::String(s)) => String::from_utf16_lossy(s), _ => "none".into() };
            let mut source = PageSource::open(bytes, "").unwrap();
            let (report, files) = source.qpdf_json(*version as u32, None, &keys, &[], &mode, ("", None), 65536).unwrap();
            assert!(files.is_empty());
            let actual = json::parse(report.as_bytes(), json::Limits::default()).unwrap();
            assert_eq!(json::stringify(&canonical(actual)), json::stringify(&canonical(case.get("expected").unwrap().clone())), "version={version}, keys={keys:?}");
        }
         }
    }
}
