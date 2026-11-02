// Edit the EmbeddedFiles name tree without rebuilding pages or renumbering
// existing objects: outlines, annotations and unrelated name trees keep their refs.
use super::{
    ObjectId, Objects, Value, index,
    pdf_copy::encode_value,
    pdf_string::{decode as text, encode as string},
};
use std::{collections::BTreeMap, io::Write};

pub(in super::super) struct AddAttachment {
    pub path: String,
    pub key: String,
    pub filename: String,
    pub description: String,
    pub replace: bool,
}

const INVALID: &str = "invalid PDF attachment tree";
const TOO_LARGE: &str = "PDF output byte limit exceeded";
type Dict<'a> = Vec<(&'a [u8], Value<'a>)>;

fn set<'a>(dict: &mut Dict<'a>, key: &'static [u8], value: Value<'a>) {
    if let Some((_, old)) = dict.iter_mut().find(|(k, _)| *k == key) {
        *old = value;
    } else {
        dict.push((key, value));
    }
}

fn child<'a>(
    objects: &mut Objects<'a>,
    parent: &Value<'a>,
    key: &[u8],
    next: &mut usize,
) -> Result<(Option<ObjectId>, Dict<'a>), String> {
    if let Some(child) = parent.get(key)
        && let Some(Value::Dict(entries)) = objects.resolve(child)
    {
        return Ok((child.reference(), entries));
    }
    let id = *next;
    *next = id.checked_add(1).ok_or(TOO_LARGE)?;
    Ok((Some((id, 0)), vec![]))
}

fn encode(v: &Value<'_>, out: &mut Vec<u8>) -> Result<(), String> {
    encode_value(v, out, 0, &mut |(n, g), out, _| {
        write!(out, "{n} {g} R").ok()
    })
    .ok_or_else(|| INVALID.into())
}

fn store_child<'a>(
    bodies: &mut BTreeMap<ObjectId, Vec<u8>>,
    id: Option<ObjectId>,
    dict: Dict<'a>,
) -> Result<Value<'a>, String> {
    let value = Value::Dict(dict);
    if let Some(id) = id {
        let mut body = vec![];
        encode(&value, &mut body)?;
        bodies.insert(id, body);
        Ok(Value::Ref(id))
    } else {
        Ok(value)
    }
}

impl<'a> Objects<'a> {
    pub(super) fn filespec(
        &mut self,
        spec: &Value<'a>,
        fallback: &[u8],
    ) -> Option<(Vec<u8>, ObjectId)> {
        let spec = self.resolve(spec)?;
        let ef = self.resolve(spec.get(b"EF")?)?;
        let stream = [b"UF".as_slice(), b"F", b"DOS", b"Mac", b"Unix"]
            .iter()
            .find_map(|k| ef.get(k))?
            .reference()?;
        let name = match spec
            .get(b"UF")
            .or_else(|| spec.get(b"F"))
            .and_then(|v| self.resolve(v))
        {
            Some(Value::String { bytes: s, .. }) => s,
            _ => fallback.to_vec(),
        };
        Some((name, stream))
    }
}

pub(in super::super) fn edit(
    bytes: &[u8],
    remove: &[String],
    add: &[AddAttachment],
    copies: &[(String, String)],
    mut read: impl FnMut(&str) -> Option<Vec<u8>>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let (mut objects, trailer) = index(bytes).ok_or(INVALID)?;
    let root = trailer
        .get(b"Root")
        .and_then(Value::reference)
        .ok_or(INVALID)?;
    let catalog = objects.object(root).ok_or(INVALID)?.0;
    let mut next = objects
        .xref
        .keys()
        .next_back()
        .ok_or(INVALID)?
        .0
        .checked_add(1)
        .ok_or(TOO_LARGE)?;
    let mut changed = BTreeMap::new();
    let (names_id, names) = child(&mut objects, &catalog, b"Names", &mut next)?;
    let names = Value::Dict(names);
    let (tree_id, mut tree) = child(&mut objects, &names, b"EmbeddedFiles", &mut next)?;
    let flatten = !add.is_empty() || !remove.is_empty();
    let mut pairs = Vec::new();
    let root_count = match tree
        .iter()
        .find(|(k, _)| *k == b"Names")
        .and_then(|(_, v)| objects.resolve(v))
    {
        Some(Value::Array(v)) => v.len() / 2,
        _ => 0,
    };
    let mut descendant_pairs = Vec::new();
    for (i, (key, spec)) in objects
        .tree_pairs(names.get(b"EmbeddedFiles"), b"Names")
        .ok_or(INVALID)?
        .into_iter()
        .enumerate()
    {
        let resolved = match objects.resolve(&key) {
            Some(Value::String { bytes: v, .. }) => text(&v),
            _ => String::new(),
        };
        if i < root_count {
            pairs.push((resolved, key, spec));
        } else if flatten {
            descendant_pairs.push((resolved, key, spec));
        }
    }
    let mut remaining = limit;
    let mut file =
        |filename: &str, description: &str, data: &[u8]| -> Result<Value<'static>, String> {
            remaining = remaining.checked_sub(data.len()).ok_or(TOO_LARGE)?;
            let stream = next;
            next = next.checked_add(2).ok_or(TOO_LARGE)?;
            let mut body = format!(
                "<<\n/Type /EmbeddedFile\n/Params <<\n/Size {}\n>>\n/Length {}\n>>\nstream\n",
                data.len(),
                data.len()
            )
            .into_bytes();
            body.extend_from_slice(data);
            body.extend_from_slice(b"\nendstream");
            changed.insert((stream, 0), body);
            let spec = stream + 1;
            let name = string(filename);
            let mut dict: Dict = vec![
                (b"Type", Value::Word(b"/Filespec")),
                (b"F", name.clone()),
                (b"UF", name),
                (
                    b"EF",
                    Value::Dict(vec![
                        (b"F", Value::Ref((stream, 0))),
                        (b"UF", Value::Ref((stream, 0))),
                    ]),
                ),
            ];
            if !description.is_empty() {
                dict.push((b"Desc", string(description)));
            }
            store_child(&mut changed, Some((spec, 0)), dict)
        };
    let mut copied = false;
    for (path, prefix) in copies {
        let bytes = read(path).ok_or_else(|| format!("cannot open {path}"))?;
        let (mut src, trailer) = index(&bytes).ok_or(INVALID)?;
        let catalog = src
            .resolve(trailer.get(b"Root").ok_or(INVALID)?)
            .ok_or(INVALID)?;
        let names = catalog.get(b"Names").and_then(|v| src.resolve(v));
        for (i, (key, spec)) in src
            .tree_pairs(
                names.as_ref().and_then(|d| d.get(b"EmbeddedFiles")),
                b"Names",
            )
            .ok_or(INVALID)?
            .into_iter()
            .enumerate()
        {
            let orig = match src.resolve(&key) {
                Some(Value::String { bytes: v, .. }) => v,
                _ => format!("att_{}", 2 * i).into_bytes(),
            };
            let Some((filename, id)) = src.filespec(&spec, &orig) else {
                continue;
            };
            let key = format!("{prefix}{}", text(&orig));
            if pairs.iter().any(|(k, _, _)| k == &key) {
                return Err(format!("duplicate attachment key {key}"));
            }
            let data = src.decoded_stream(id).ok_or(INVALID)?;
            let spec = file(&text(&filename), "", &data)?;
            pairs.push((key.clone(), string(&key), spec));
            copied = true;
        }
    }
    pairs.append(&mut descendant_pairs);
    pairs.retain(|(key, _, _)| !remove.contains(key));
    for a in add {
        let data = read(&a.path).ok_or_else(|| format!("cannot open attachment {}", a.path))?;
        let pos = pairs.iter().position(|(key, _, _)| key == &a.key);
        if pos.is_some() && !a.replace {
            return Err(format!("duplicate attachment key {}", a.key));
        }
        let spec = file(&a.filename, &a.description, &data)?;
        if let Some(i) = pos {
            pairs[i].2 = spec;
        } else {
            pairs.push((a.key.clone(), string(&a.key), spec));
        }
    }
    if flatten || copied {
        if flatten {
            tree.retain(|(k, _)| *k != b"Kids");
        }
        set(
            &mut tree,
            b"Names",
            Value::Array(pairs.into_iter().flat_map(|(_, k, s)| [k, s]).collect()),
        );
        let Value::Dict(mut names) = names else {
            unreachable!()
        };
        set(
            &mut names,
            b"EmbeddedFiles",
            store_child(&mut changed, tree_id, tree)?,
        );
        let Value::Dict(mut catalog) = catalog else {
            return Err(INVALID.into());
        };
        set(
            &mut catalog,
            b"Names",
            store_child(&mut changed, names_id, names)?,
        );
        store_child(&mut changed, Some(root), catalog)?;
    } else {
        next = objects
            .xref
            .keys()
            .next_back()
            .ok_or(INVALID)?
            .0
            .checked_add(1)
            .ok_or(TOO_LARGE)?;
    }

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
    for key in [b"Info".as_slice(), b"ID"] {
        if let Some(v) = trailer.get(key) {
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
