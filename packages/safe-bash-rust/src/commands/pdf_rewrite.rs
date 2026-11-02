// Save a classic PDF with its object numbers intact and a flat page tree.
use super::{
    Value,
    attachments::{self, AddAttachment},
    index,
    pdf_copy::{encode_value, write_objects},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
};
const INVALID: &str = "invalid PDF object graph";
const TOO_LARGE: &str = "PDF output byte limit exceeded";
type Dict<'a> = Vec<(&'a [u8], Value<'a>)>;
pub(super) fn set<'a>(dict: &mut Dict<'a>, key: &'static [u8], value: Value<'a>) {
    if let Some((_, old)) = dict.iter_mut().find(|(k, _)| *k == key) {
        *old = value;
    } else {
        dict.push((key, value));
    }
}

pub(super) fn encode(v: &Value<'_>, out: &mut Vec<u8>) -> Result<(), String> {
    encode_value(v, out, 0, &mut |(n, g), out, _| {
        write!(out, "{n} {g} R").ok()
    })
    .ok_or_else(|| INVALID.into())
}

pub(in super::super) fn empty_pdf(limit: usize) -> Option<Vec<u8>> {
    write_objects(
        &[
            b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
            b"<<\n/Type /Pages\n/Count 0\n/Kids [ ]\n>>".to_vec(),
            b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec(),
        ],
        limit,
    )
}

#[derive(Default)]
pub(in super::super) struct PageEdits<'a> {
    pub rotations: Vec<&'a str>,
    pub split_pages: Option<usize>,
    pub info: bool,
    pub metadata: bool,
    pub structure: bool,
    pub acroform: bool,
    pub page_labels: bool,
}

pub(in super::super) fn rewrite(
    bytes: &[u8],
    edits: &PageEdits,
    remove: &[String],
    add: &[AddAttachment],
    copies: &[(String, String)],
    read: impl FnMut(&str) -> Option<Vec<u8>>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let (mut objects, trailer) = index(bytes).ok_or(INVALID)?;
    let root = trailer
        .get(b"Root")
        .and_then(Value::reference)
        .ok_or(INVALID)?;
    let mut catalog = objects.object(root).ok_or(INVALID)?.0;
    let mut changed = if remove.is_empty() && add.is_empty() && copies.is_empty() {
        BTreeMap::new()
    } else {
        attachments::edit(&mut objects, &mut catalog, remove, add, copies, read, limit)?
    };
    let Value::Dict(entries) = &mut catalog else {
        return Err(INVALID.into());
    };
    entries.retain(|(key, _)| !match *key {
        b"Metadata" => edits.info || edits.metadata,
        b"StructTreeRoot" | b"MarkInfo" => edits.structure,
        b"AcroForm" => edits.acroform,
        b"PageLabels" => edits.page_labels,
        _ => false,
    });
    let mut info = trailer.get(b"Info");
    let page_root = catalog
        .get(b"Pages")
        .and_then(Value::reference)
        .ok_or(INVALID)?;
    let (pages, tree) = objects.page_tree(root, &catalog).ok_or(INVALID)?;
    let rotations =
        super::rotations(&edits.rotations, pages.len()).ok_or("invalid page rotation")?;
    let mut remaining = limit;
    let mut store = |id, value: &Value<'_>| -> Result<(), String> {
        let body = changed.entry(id).or_default();
        body.clear();
        encode(value, body)?;
        remaining = remaining.checked_sub(body.len()).ok_or(TOO_LARGE)?;
        Ok(())
    };
    if edits.info
        && let Some(id) = info.and_then(Value::reference)
        && let Some((Value::Dict(mut entries), mut cursor)) = objects.object(id)
    {
        cursor.skip();
        if !cursor.0.starts_with(b"stream") {
            entries.retain(|(key, _)| *key == b"ModDate");
            if entries.is_empty() {
                info = None;
            }
            store(id, &Value::Dict(entries))?;
        }
    }
    for (i, &id) in pages.iter().enumerate() {
        let rotation = rotations.get(i).copied().flatten();
        if edits.split_pages.is_some() && rotation.is_none() {
            continue;
        }
        let page = objects.object(id).ok_or(INVALID)?.0;
        let inherited = |key: &[u8]| {
            let mut current = &page;
            let mut seen = BTreeSet::new();
            loop {
                if let Some(v) = current.get(key) {
                    return Some(v);
                }
                let parent = current.get(b"Parent")?.reference()?;
                if !seen.insert(parent) {
                    return None;
                }
                current = tree.get(&parent)?.as_ref()?;
            }
        };
        let Value::Dict(mut fields) = page.clone() else {
            return Err(INVALID.into());
        };
        if let Some(rotation) = rotation {
            let original = inherited(b"Rotate")
                .and_then(|v| objects.resolve(v))
                .and_then(|v| v.number())
                .unwrap_or(0.);
            set(&mut fields, b"Rotate", rotation.word(original));
        }
        if edits.split_pages.is_none() {
            if !matches!(
                page.get(b"Resources").and_then(|v| objects.resolve(v)),
                Some(Value::Dict(_))
            ) {
                let mut res = match inherited(b"Resources").and_then(|v| objects.resolve(v)) {
                    Some(Value::Dict(entries)) => entries,
                    _ => vec![],
                };
                for (_, v) in &mut res {
                    if let Some(sub @ Value::Dict(_)) = objects.resolve(v) {
                        *v = sub;
                    }
                }
                set(&mut fields, b"Resources", Value::Dict(res));
            }
            for k in [b"MediaBox".as_slice(), b"CropBox", b"Rotate"] {
                if !fields.iter().any(|(key, _)| *key == k)
                    && let Some(v) = inherited(k).and_then(|v| objects.resolve(v))
                {
                    set(&mut fields, k, v);
                }
            }
            set(&mut fields, b"Parent", Value::Ref(page_root));
        }
        store(id, &Value::Dict(fields))?;
    }
    if edits.split_pages.is_none() {
        let Value::Dict(mut page_node) = objects.object(page_root).ok_or(INVALID)?.0 else {
            return Err(INVALID.into());
        };
        let count = pages.len().to_string();
        set(
            &mut page_node,
            b"Kids",
            Value::Array(pages.into_iter().map(Value::Ref).collect()),
        );
        set(&mut page_node, b"Count", Value::Word(count.as_bytes()));
        store(page_root, &Value::Dict(page_node))?;
    }
    store(root, &catalog)?;
    let next = objects
        .xref
        .keys()
        .chain(changed.keys())
        .max()
        .ok_or(INVALID)?
        .0
        .checked_add(1)
        .ok_or(TOO_LARGE)?;
    let mut out = bytes.get(..8).ok_or(INVALID)?.to_vec();
    out.extend_from_slice(b"\n%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n");
    if next > limit / 20 {
        return Err(TOO_LARGE.into());
    }
    let mut xref = format!("xref\n0 {next}\n0000000000 65535 f \n").into_bytes();
    for n in 1..next {
        let original = objects
            .xref
            .range((n, 0)..=(n, usize::MAX))
            .next()
            .map(|(&id, _)| id);
        let id = original.unwrap_or((n, 0));
        if original.is_none() && !changed.contains_key(&id) {
            xref.extend_from_slice(b"0000000000 65535 f \n");
            continue;
        }
        writeln!(xref, "{:010} {:05} n ", out.len(), id.1).unwrap();
        writeln!(out, "{n} {} obj", id.1).unwrap();
        if let Some(body) = changed.remove(&id) {
            if body.len() > limit.saturating_sub(out.len()) {
                return Err(TOO_LARGE.into());
            }
            out.extend_from_slice(&body);
        } else {
            let (dict, mut cursor) = objects.object(id).ok_or(INVALID)?;
            cursor.skip();
            encode(&dict, &mut out)?;
            if cursor.0.starts_with(b"stream") {
                let data = objects.stream(&dict, cursor).ok_or(INVALID)?;
                if data.len() > limit.saturating_sub(out.len()) {
                    return Err(TOO_LARGE.into());
                }
                out.extend_from_slice(b"\nstream\n");
                out.extend_from_slice(data);
                out.extend_from_slice(b"\nendstream");
            } else if !cursor.0.starts_with(b"endobj") {
                return Err(INVALID.into());
            }
        }
        out.extend_from_slice(b"\nendobj\n\n");
        if out.len() > limit {
            return Err(TOO_LARGE.into());
        }
    }
    let offset = out.len();
    out.extend_from_slice(&xref);
    write!(
        out,
        "trailer\n<<\n/Size {next}\n/Root {} {} R\n",
        root.0, root.1
    )
    .unwrap();
    for (key, value) in [(b"Info".as_slice(), info), (b"ID", trailer.get(b"ID"))] {
        if let Some(v) = value {
            out.push(b'/');
            out.extend_from_slice(key);
            out.push(b' ');
            encode(v, &mut out)?;
            out.push(b'\n');
        }
    }
    write!(out, ">>\n\nstartxref\n{offset}\n%%EOF").unwrap();
    if out.len() > limit {
        return Err(TOO_LARGE.into());
    }
    Ok(out)
}
