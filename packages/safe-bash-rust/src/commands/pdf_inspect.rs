// qpdf's human-readable inspection format is distinct from PDF serialization.
use super::{ObjectId, Objects, PageSource, Value};
use std::{collections::BTreeSet, fmt::Write};

#[path = "pdf_linearization_report.rs"]
mod linearization_report;

fn display(value: &Value<'_>, out: &mut String) {
    match value {
        Value::Ref((n, g)) => write!(out, "{n} {g} R").unwrap(),
        Value::Word(w) if w.starts_with(b"/") => out.push_str(&super::super::pdf_string::name(w)),
        Value::Word(w) => {
            if let Some(n) = value.number() {
                if n == 0. {
                    out.push('0');
                } else {
                    write!(out, "{n}").unwrap();
                }
            } else {
                out.push_str(&String::from_utf8_lossy(w));
            }
        }
        Value::String { bytes, .. } => {
            let hex = bytes.iter().any(|b| !(32..=126).contains(b) && !matches!(b, 8 | 9 | 10 | 12 | 13));
            out.push(if hex { '<' } else { '(' });
            for &b in bytes {
                if hex { write!(out, "{b:02x}").unwrap(); }
                else {
                    match b {
                        8 => out.push_str("\\b"), 9 => out.push_str("\\t"), 10 => out.push_str("\\n"),
                        12 => out.push_str("\\f"), 13 => out.push_str("\\r"),
                        b'(' | b')' | b'\\' => { out.push('\\'); out.push(char::from(b)); }
                        _ => out.push(char::from(b)),
                    }
                }
            }
            out.push(if hex { '>' } else { ')' });
        }
        Value::Array(items) => {
            out.push_str("[ ");
            for (i, v) in items.iter().enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                display(v, out);
            }
            out.push_str(" ]");
        }
        Value::Dict(items) => {
            let mut entries: Vec<_> = items.iter().map(|(k, v)| (super::super::pdf_string::name(k), v)).collect();
            entries.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            out.push_str("<< ");
            for (i, (k, v)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                out.push('/');
                out.push_str(k);
                out.push(' ');
                display(v, out);
            }
            out.push_str(" >>");
        }
    }
}

impl<'a> PageSource<'a> {
    pub(in crate::commands::archive) fn encryption_description(&self) -> String {
        self.objects.security.as_ref().map_or_else(|| "File is not encrypted\n".into(), |s| s.description())
    }
    // Inspect encoded bytes, including streams unrelated to the selected pages.
    // The first linearization dictionary follows revision order, not object number.
    pub(super) fn validate_objects(&mut self) -> Option<Option<Value<'a>>> {
        let mut first = None;
        for (id, order) in self
            .objects
            .xref
            .iter()
            .map(|(id, (loc, order))| {
                (
                    *id,
                    (matches!(loc, super::super::Location::Member { .. }), *order),
                )
            })
            .collect::<Vec<_>>()
        {
            let (node, mut cursor) = self.objects.object(id)?;
            cursor.skip();
            if cursor.0.starts_with(b"stream") {
                self.objects.stream(&node, cursor)?;
            } else if !cursor.0.starts_with(b"endobj") {
                return None;
            } else if node.get(b"Linearized").is_some()
                && first.as_ref().is_none_or(|(pos, _)| order < *pos)
            {
                first = Some((order, node));
            }
        }
        Some(first.map(|(_, node)| node))
    }

    pub(in crate::commands::archive) fn qpdf_summary(
        &mut self,
        input: &str,
        check: bool,
        linearization: bool,
    ) -> Option<String> {
        let dict = self.validate_objects()?;
        let count = self.len();
        if linearization {
            let Some(values) = dict.or_else(|| {
                self.pages
                    .iter()
                    .filter(|id| !self.objects.xref.contains_key(id))
                    .find_map(|id| {
                        self.tree
                            .get(id)?
                            .as_ref()
                            .filter(|p| p.get(b"Linearized").is_some())
                            .cloned()
                    })
            }) else {
                return Some(format!("{input} is not linearized\n"));
            };
            return linearization_report::report(self, input, &values);
        }
        if check {
            let mut version = super::super::header_version(self.objects.bytes)?;
            let mut level = Some(self.catalog.clone());
            for key in [b"Extensions".as_slice(), b"ADBE", b"ExtensionLevel"] {
                level = level.and_then(|v| v.get(key).cloned()).and_then(|v| self.objects.resolve(&v));
            }
            if let Some(level) = level.and_then(|v| v.number()).filter(|v| *v != 0.) {
                write!(version, " extension level {level}").unwrap();
            }
            let state = if count == 0 {
                "empty"
            } else if dict.is_some() {
                "linearized"
            } else {
                "not linearized"
            };
            let clean = if self.objects.recovered_xref || !self.objects.recovered_objects.is_empty() || !self.objects.recovered_streams.is_empty() { "" }
                else { "No syntax or stream encoding errors found; the file may still contain\nerrors that qpdf cannot detect\n" };
            return Some(format!(
                "checking {input}\nPDF Version: {version}\n{}File is {state}\n{clean}", self.encryption_description()
            ));
        }
        Some(format!("{count}\n"))
    }

    pub(in crate::commands::archive) fn qpdf_object(
        &mut self,
        selector: &str,
        raw: bool,
        filtered: bool,
    ) -> Option<String> {
        if selector == "trailer" {
            // The merged security/catalog trailer omits xref-stream fields.
            // Inspection exposes the actual latest revision dictionary.
            let bytes = self.objects.bytes;
            let original = if self.objects.recovered_xref { None } else {
                super::super::last_xref(bytes).and_then(|offset| {
                    let header = bytes[..bytes.len().min(1024)].windows(5).position(|w| w == b"%PDF-")?;
                    self.objects.xref_revision(offset.checked_add(header)?, &mut |_, _| {})
                })
            };
            let mut text = String::new();
            display(original.as_ref().unwrap_or(&self.trailer), &mut text);
            text.push('\n');
            return Some(text);
        }
        let (number, generation) = selector.split_once(',').unwrap_or((selector, "0"));
        let integer = |value: &str| crate::commands::archive::qpdf_decimal(value)
            .filter(|n| n.is_finite() && *n >= 0. && *n <= 9_007_199_254_740_991. && *n <= usize::MAX as f64)
            .map(|n| n as usize);
        let Some(number) = integer(number) else { return Some("null\n".into()); };
        if number == 0 { return Some(String::new()); }
        let Some(generation) = integer(generation) else { return Some("null\n".into()); };
        let id = (number, generation);
        if !self.objects.xref.contains_key(&id) {
            if generation == 0 && let Some(Some(node)) = self.tree.get(&id) {
                let mut text = String::new();
                display(node, &mut text);
                text.push('\n');
                return Some(text);
            }
            return Some("null\n".into());
        }
        let (mut node, mut cursor) = self.objects.object(id)?;
        cursor.skip();
        let mut out = String::new();
        if cursor.0.starts_with(b"stream") {
            let bytes = self.objects.raw_stream(id, &mut node, cursor)?;
            if filtered {
                return Some(crate::vfs::bytes_to_stream_string(
                    &self.objects.decode(&node, bytes)?,
                ));
            }
            if raw {
                return Some(crate::vfs::bytes_to_stream_string(&bytes));
            }
            out.push_str("Object is stream.  Dictionary:\n");
            display(&node, &mut out);
        } else {
            display(&node, &mut out);
        }
        out.push('\n');
        Some(out)
    }

    pub(in crate::commands::archive) fn qpdf_xref(&mut self) -> Option<String> {
        let mut out = String::new();
        let bytes = self.objects.bytes;
        let header = bytes[..bytes.len().min(1024)].windows(5).position(|w| w == b"%PDF-")?;
        for id in self.objects.xref.keys().copied().collect::<Vec<_>>() {
            let (node, _) = self.objects.object(id)?;
            match self.objects.xref[&id].0 {
                super::super::Location::File(offset) => writeln!(out,
                    "{}/{}: uncompressed; offset = {}", id.0, id.1, offset.checked_sub(header)?).ok()?,
                super::super::Location::Member { .. } if self.objects.recovered_xref => {
                    let kind = match &node {
                        Value::Dict(_) => "dict", Value::Array(_) => "array",
                        Value::String { .. } => "string", Value::Ref(_) => "ref",
                        Value::Word(word) if word.starts_with(b"/") => "name",
                        Value::Word(word) if matches!(word.as_ref(), b"true" | b"false") => "boolean",
                        Value::Word(word) if word.as_ref() == b"null" => "null",
                        Value::Word(_) => "number",
                    };
                    writeln!(out, "{}/{}: uncompressed; type = {kind}", id.0, id.1).ok()?;
                }
                super::super::Location::Member { container, ordinal } => writeln!(out,
                    "{}/0: compressed; stream = {container}, index = {ordinal}", id.0).ok()?,
            }
        }
        for &id in &self.pages {
            if !self.objects.xref.contains_key(&id) {
                writeln!(out, "{}/0: uncompressed; type = dict", id.0).ok()?;
            }
        }
        Some(out)
    }

    pub(in crate::commands::archive) fn qpdf_pages(&mut self, images: bool) -> Option<String> {
        let mut out = String::new();
        for (i, &id) in self.pages.iter().enumerate() {
            writeln!(out, "page {}: {} {} R", i + 1, id.0, id.1).ok()?;
            let page = self.objects.page_dict(id, &self.tree)?;
            if images {
                let image_start = out.len();
                let mut owner = &page;
                let mut parents = BTreeSet::new();
                while owner.get(b"Resources").is_none() {
                    let Some(id) = owner.get(b"Parent").and_then(Value::reference) else {
                        break;
                    };
                    if !parents.insert(id) {
                        break;
                    }
                    let Some(parent) = self.tree.get(&id).and_then(Option::as_ref) else {
                        break;
                    };
                    owner = parent;
                }
                if let Some(res) = owner.get(b"Resources") {
                    image_lines(&mut self.objects, res, &mut BTreeSet::new(), 0, &mut out)?;
                }
                if out.len() > image_start { out.insert_str(image_start, "  images:\n"); }
            }
            out.push_str("  content:\n");
            if let Some(contents) = page.get(b"Contents") {
                let items = match contents {
                    Value::Array(v) => v.as_slice(),
                    v => std::slice::from_ref(v),
                };
                for (n, g) in items.iter().filter_map(Value::reference) {
                    writeln!(out, "    {n} {g} R").ok()?;
                }
            }
        }
        if out.is_empty() {
            out.push('\n');
        }
        Some(out)
    }
}

fn image_lines<'a>(
    objects: &mut Objects<'a>,
    resources: &Value<'a>,
    seen: &mut BTreeSet<ObjectId>,
    depth: usize,
    out: &mut String,
) -> Option<()> {
    if depth > 128 {
        return None;
    }
    let Some(Value::Dict(entries)) = objects
        .resolve(resources)?
        .get(b"XObject")
        .and_then(|v| objects.resolve(v))
    else {
        return Some(());
    };
    for (key, item) in entries {
        let reference = item.reference();
        let Some(dict) = objects.resolve(&item) else {
            continue;
        };
        match dict.get(b"Subtype").and_then(Value::word) {
            Some(b"/Image") => {
                out.push_str("    /");
                out.push_str(&super::super::pdf_string::name(&key));
                out.push_str(": ");
                if let Some((n, g)) = reference {
                    write!(out, "{n} {g} R").ok()?;
                } else {
                    out.push_str("inline");
                }
                let dimension = |k: &[u8]| dict.get(k).and_then(Value::number).unwrap_or(0.);
                writeln!(out, ", {} x {}", dimension(b"Width"), dimension(b"Height")).ok()?;
            }
            Some(b"/Form") if reference.is_none_or(|r| seen.insert(r)) => {
                if let Some(res) = dict.get(b"Resources") {
                    image_lines(objects, res, seen, depth + 1, out)?;
                }
            }
            _ => {}
        }
    }
    Some(())
}
