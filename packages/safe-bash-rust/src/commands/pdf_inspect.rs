// qpdf's human-readable inspection format is distinct from PDF serialization.
use super::{ObjectId, Objects, PageSource, Value};
use std::{collections::BTreeSet, fmt::Write};

fn name(bytes: &[u8], out: &mut String) {
    let mut rest = bytes;
    while let Some((&b, tail)) = rest.split_first() {
        if b == b'#'
            && let Some(v) = tail
                .get(..2)
                .and_then(|s| std::str::from_utf8(s).ok())
                .and_then(|s| u8::from_str_radix(s, 16).ok())
        {
            out.push(char::from(v));
            rest = &tail[2..];
        } else {
            out.push(char::from(b));
            rest = tail;
        }
    }
}

fn display(value: &Value<'_>, out: &mut String) {
    match value {
        Value::Ref((n, g)) => write!(out, "{n} {g} R").unwrap(),
        Value::Word(w) if w.starts_with(b"/") => name(w, out),
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
            out.push('(');
            out.push_str(&super::super::pdf_string::decode(bytes));
            out.push(')');
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
            out.push_str("<< ");
            for (i, (k, v)) in items.iter().enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                out.push('/');
                name(k, out);
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
                return Some(format!("{input}: not linearized\n"));
            };
            let mut number = |k: &[u8], default: f64| {
                values
                    .get(k)
                    .and_then(|v| self.objects.resolve(v))
                    .and_then(|v| v.number())
                    .unwrap_or(default)
            };
            let (l, o, e, n, t) = (
                number(b"L", 0.),
                number(b"O", 0.),
                number(b"E", 0.),
                number(b"N", count as f64),
                number(b"T", 0.),
            );
            let hints = values.get(b"H").and_then(|v| self.objects.resolve(v));
            let mut hint = |i: usize| {
                let Some(Value::Array(h)) = &hints else {
                    return "0".to_owned();
                };
                match h.get(i).and_then(|v| self.objects.resolve(v)) {
                    Some(Value::Word(w)) if matches!(w.as_ref(), b"true" | b"false") => {
                        String::from_utf8_lossy(&w).into_owned()
                    }
                    Some(v) => v.number().unwrap_or(0.).to_string(),
                    None => "0".into(),
                }
            };
            return Some(format!(
                "{input}: linearized\nLinearization dictionary: L={l} H=[{} {}] O={o} E={e} N={n} T={t}\nno linearization errors\n",
                hint(0),
                hint(1)
            ));
        }
        if check {
            let version =
                std::str::from_utf8(self.objects.bytes.strip_prefix(b"%PDF-")?.get(..3)?).ok()?;
            let state = if count == 0 {
                "empty"
            } else if dict.is_some() {
                "linearized"
            } else {
                "not linearized"
            };
            return Some(format!(
                "checking {input}\nPDF Version: {version}\nFile is {}\nFile is {state}\nNo syntax or stream encoding errors found; the file may still contain\nerrors that qpdf cannot detect\n", if self.objects.security.is_some() {"encrypted"} else {"not encrypted"}
            ));
        }
        Some(format!("{count}\n"))
    }

    pub(in crate::commands::archive) fn qpdf_object(
        &mut self,
        number: usize,
        raw: bool,
        filtered: bool,
    ) -> Option<String> {
        let Some((&id, _)) = self
            .objects
            .xref
            .range((number, 0)..=(number, usize::MAX))
            .next()
        else {
            if let Some(Some(node)) = self.tree.get(&(number, 0)) {
                let mut text = String::new();
                display(node, &mut text);
                text.push('\n');
                return Some(text);
            }
            return Some("null\n".into());
        };
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
            display(&node, &mut out);
            write!(out, "\nstream\n...({} bytes)...\nendstream", bytes.len()).ok()?;
        } else {
            display(&node, &mut out);
        }
        out.push('\n');
        Some(out)
    }

    pub(in crate::commands::archive) fn qpdf_xref(&mut self) -> Option<String> {
        let mut out = String::new();
        for id in self.objects.xref.keys().copied().collect::<Vec<_>>() {
            let (v, mut c) = self.objects.object(id)?;
            c.skip();
            let ty = match v {
                Value::Dict(_) if c.0.starts_with(b"stream") => "stream",
                Value::Dict(_) => "dict",
                Value::Array(_) => "array",
                Value::String { .. } => "string",
                Value::Ref(_) => "ref",
                Value::Word(w) if w.as_ref() == b"null" => "null",
                Value::Word(w) if matches!(w.as_ref(), b"true" | b"false") => "boolean",
                Value::Word(w) if w.starts_with(b"/") => "name",
                Value::Word(_) => "number",
            };
            if let Some(container) = self.objects.latest_members.get(&id.0) {
                writeln!(
                    out,
                    "{}/0: compressed; stream = {container}; index = undefined; type = {ty}",
                    id.0
                )
                .ok()?;
            } else {
                writeln!(out, "{}/{}: uncompressed; type = {ty}", id.0, id.1).ok()?;
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
                out.push_str("  images:\n");
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
                name(&key, out);
                out.push_str(": ");
                if let Some((n, g)) = reference {
                    write!(out, "{n} {g} R").ok()?;
                } else {
                    out.push_str("inline");
                }
                let dimension = |k: &[u8]| dict.get(k).and_then(Value::number).unwrap_or(0.);
                writeln!(out, " ({} x {})", dimension(b"Width"), dimension(b"Height")).ok()?;
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
