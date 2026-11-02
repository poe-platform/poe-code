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

impl PageSource<'_> {
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
            return Some("null\n".into());
        };
        let (node, mut cursor) = self.objects.object(id)?;
        cursor.skip();
        let mut out = String::new();
        if cursor.0.starts_with(b"stream") {
            let bytes = self.objects.stream(&node, cursor)?;
            if filtered {
                return Some(crate::vfs::bytes_to_stream_string(
                    &self.objects.decoded_stream(id)?,
                ));
            }
            if raw {
                return Some(crate::vfs::bytes_to_stream_string(bytes));
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
                Value::Word(b"null") => "null",
                Value::Word(b"true" | b"false") => "boolean",
                Value::Word(w) if w.starts_with(b"/") => "name",
                Value::Word(_) => "number",
            };
            writeln!(out, "{}/{}: uncompressed; type = {ty}", id.0, id.1).ok()?;
        }
        Some(out)
    }

    pub(in crate::commands::archive) fn qpdf_pages(&mut self, images: bool) -> Option<String> {
        let mut out = String::new();
        for (i, &id) in self.pages.iter().enumerate() {
            writeln!(out, "page {}: {} {} R", i + 1, id.0, id.1).ok()?;
            let page = self.objects.object(id)?.0;
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
                name(key, out);
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
