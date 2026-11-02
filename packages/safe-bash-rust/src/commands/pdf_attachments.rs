// Edit the EmbeddedFiles name tree without rebuilding pages or renumbering
// existing objects: outlines, annotations and unrelated name trees keep their refs.
use super::{
    ObjectId, Objects, Value, index,
    pdf_rewrite::{encode, set},
    pdf_string::{decode as text, encode as string},
};
use std::collections::BTreeMap;

pub(in super::super) struct AddAttachment {
    pub path: String,
    pub key: String,
    pub filename: String,
    pub description: String,
    pub replace: bool,
}

pub(in super::super) struct CopyAttachments {
    pub path: String,
    pub prefix: String,
    pub password: String,
}

pub(in super::super) const INVALID_SOURCE: &str = "invalid attachment source";

const INVALID: &str = "invalid PDF attachment tree";
const TOO_LARGE: &str = "PDF output byte limit exceeded";
use super::Dict;

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

impl CopyAttachments {
    pub(in super::super) fn visit(
        &self,
        bytes: &[u8],
        mut visit: impl FnMut(String, String, &[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let (mut src, trailer) = index(bytes, &self.password).map_err(|_| INVALID_SOURCE)?;
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
            let key = format!("{}{}", self.prefix, text(&orig));
            let data = src.decoded_stream(id).ok_or(INVALID)?;
            visit(key, text(&filename), &data)?;
        }
        Ok(())
    }
}

pub(super) fn edit<'a>(
    objects: &mut Objects<'a>,
    catalog: &mut Value<'a>,
    remove: &[String],
    add: &[AddAttachment],
    copies: &[CopyAttachments],
    mut read: impl FnMut(&str) -> Option<Vec<u8>>,
    limit: usize,
) -> Result<BTreeMap<ObjectId, Vec<u8>>, String> {
    let mut next = objects
        .xref
        .keys()
        .next_back()
        .ok_or(INVALID)?
        .0
        .checked_add(1)
        .ok_or(TOO_LARGE)?;
    let mut changed = BTreeMap::new();
    let (names_id, names) = child(objects, catalog, b"Names", &mut next)?;
    let names = Value::Dict(names);
    let (tree_id, mut tree) = child(objects, &names, b"EmbeddedFiles", &mut next)?;
    let flatten = !add.is_empty() || !remove.is_empty();
    let mut pairs = Vec::new();
    let root_count = match tree
        .iter()
        .find(|(k, _)| k.as_ref() == b"Names")
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
                (b"Type".into(), Value::Word(b"/Filespec".as_slice().into())),
                (b"F".into(), name.clone()),
                (b"UF".into(), name),
                (
                    b"EF".into(),
                    Value::Dict(vec![
                        (b"F".into(), Value::Ref((stream, 0))),
                        (b"UF".into(), Value::Ref((stream, 0))),
                    ]),
                ),
            ];
            if !description.is_empty() {
                dict.push((b"Desc".into(), string(description)));
            }
            store_child(&mut changed, Some((spec, 0)), dict)
        };
    let mut copied = false;
    for source in copies {
        let bytes = read(&source.path).ok_or_else(|| format!("cannot open {}", source.path))?;
        source.visit(&bytes, |key, filename, data| {
            if pairs.iter().any(|(k, _, _)| k == &key) {
                return Err(format!("duplicate attachment key {key}"));
            }
            let spec = file(&filename, "", data)?;
            pairs.push((key.clone(), string(&key), spec));
            copied = true;
            Ok(())
        })?;
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
            tree.retain(|(k, _)| k.as_ref() != b"Kids");
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
        let Value::Dict(catalog) = catalog else {
            return Err(INVALID.into());
        };
        set(
            catalog,
            b"Names",
            store_child(&mut changed, names_id, names)?,
        );
    }
    Ok(changed)
}
