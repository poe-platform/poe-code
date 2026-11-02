// PDFtk keeps the original drawing streams separate so that graphics state,
// fonts, links and images remain usable after applying an overlay or underlay.
use super::super::{
    Dict,
    pdf_rewrite::{encode, set, write_stream},
    pdf_string,
    pdf_update::encode_name,
};
use super::{ObjectId, Objects, PageSource, PageTree, Value, attribute, geometry};
use std::collections::{BTreeMap, BTreeSet};

const BAD: &str = "invalid PDF stamp";
const LARGE: &str = "PDF output byte limit exceeded";

struct Stamp<'a> {
    bodies: &'a mut BTreeMap<ObjectId, Vec<u8>>,
    copies: BTreeMap<usize, ObjectId>,
    next: usize,
    left: usize,
    mode: Option<bool>,
}
impl Stamp<'_> {
    fn allocate(&mut self) -> Result<ObjectId, String> {
        let id = self.next;
        self.next = id.checked_add(1).ok_or(LARGE)?;
        Ok((id, 0))
    }
    fn store(&mut self, id: ObjectId, body: Vec<u8>) -> Result<(), String> {
        self.left = self.left.checked_sub(body.len()).ok_or(LARGE)?;
        self.bodies.insert(id, body);
        Ok(())
    }
    fn stream(&mut self, data: &[u8]) -> Result<Value<'static>, String> {
        let id = self.allocate()?;
        let mut dict = Value::Dict(vec![]);
        dict.set_stream_length(data.len()).ok_or(BAD)?;
        let mut body = Vec::new();
        write_stream(&mut body, dict, data, self.mode, self.left)?;
        self.store(id, body)?;
        Ok(Value::Ref(id))
    }
    fn copy<'a>(
        &mut self,
        obj: &mut Objects<'a>,
        value: Value<'a>,
        depth: usize,
    ) -> Result<Value<'static>, String> {
        if depth > 128 {
            return Err(BAD.into());
        }
        Ok(match value {
            Value::Ref((n, _)) => {
                if let Some(id) = self.copies.get(&n) {
                    return Ok(Value::Ref(*id));
                }
                let id = self.allocate()?;
                self.copies.insert(n, id);
                let mut body = Vec::new();
                if let Some(source) = obj
                    .xref
                    .range((n, 0)..=(n, usize::MAX))
                    .next()
                    .map(|(&id, _)| id)
                    && let Some((mut v, mut c)) = obj.object(source)
                {
                    c.skip();
                    let data = if c.0.starts_with(b"stream") {
                        let raw = obj.raw_stream(source, &mut v, c).ok_or(BAD)?;
                        Some(if self.mode.is_some() {
                            obj.decode(&v, raw).ok_or(BAD)?
                        } else {
                            raw
                        })
                    } else {
                        None
                    };
                    let cloned = self.copy(obj, v, depth + 1)?;
                    if let Some(data) = data {
                        write_stream(&mut body, cloned, &data, self.mode, self.left)?;
                    } else {
                        encode(&cloned, &mut body)?;
                    }
                } else {
                    body.extend_from_slice(b"<<\n>>");
                }
                self.store(id, body)?;
                Value::Ref(id)
            }
            Value::Array(a) => Value::Array(
                a.into_iter()
                    .map(|v| self.copy(obj, v, depth + 1))
                    .collect::<Result<_, _>>()?,
            ),
            Value::Dict(d) => {
                let mut fields = Vec::new();
                for (k, v) in d {
                    let key = pdf_string::name(&k);
                    if key != "Parent" {
                        fields.push((encode_name(&key).into(), self.copy(obj, v, depth + 1)?));
                    }
                }
                Value::Dict(fields)
            }
            v => v.into_owned(),
        })
    }
}

fn placement((dw, dh, dr): (f64, f64, f64), (sw, sh, sr): (f64, f64, f64)) -> String {
    let r = (dr - sr).rem_euclid(360.);
    if sw <= 0. || sh <= 0. || (r == 0. && (dw - sw).abs() <= 0.5 && (dh - sh).abs() <= 0.5) {
        return "q\n".into();
    }
    let side = r == 90. || r == 270.;
    let (w, h) = if side { (dh, dw) } else { (dw, dh) };
    let s = (w / sw).min(h / sh);
    let (x, y) = ((w - sw * s) / 2., (h - sh * s) / 2.);
    let matrix = match r {
        90. => [0., s, -s, 0., dw - y, x],
        180. => [-s, 0., 0., -s, dw - x, dh - y],
        270. => [0., -s, s, 0., y, dh - x],
        _ => [s, 0., 0., s, x, y],
    };
    let parts = matrix
        .into_iter()
        .enumerate()
        .map(|(i, n)| {
            let n = if i < 4 {
                format!("{n:.6}")
            } else {
                format!("{n:.4}")
            }
            .parse::<f64>()
            .unwrap();
            if n == 0. { "0".into() } else { n.to_string() }
        })
        .collect::<Vec<_>>();
    format!("q\n{} cm\n", parts.join(" "))
}
fn names(data: &[u8], rename: &BTreeMap<String, String>, limit: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        if data[i] == b'/' {
            out.push(b'/');
            i += 1;
            let start = i;
            while i < data.len() && (data[i].is_ascii_alphanumeric() || b"_.+-".contains(&data[i]))
            {
                i += 1;
            }
            let raw = &data[start..i];
            let text = std::str::from_utf8(raw)
                .ok()
                .and_then(|s| rename.get(s))
                .map_or(raw, |s| s.as_bytes());
            if text.len() > limit.saturating_sub(out.len()) {
                return Err(LARGE.into());
            }
            out.extend_from_slice(text);
        } else {
            out.push(data[i]);
            i += 1;
        }
        if out.len() > limit {
            return Err(LARGE.into());
        }
    }
    Ok(out)
}

impl PageSource<'_> {
    pub(in super::super) fn stamp<'d>(
        &mut self,
        dst: &mut Objects<'d>,
        pages: &[ObjectId],
        tree: &mut PageTree<'d>,
        multi: bool,
        overlay: bool,
        next: usize,
        bodies: &mut BTreeMap<ObjectId, Vec<u8>>,
        mode: Option<bool>,
        limit: usize,
    ) -> Result<(), String> {
        if self.pages.is_empty() {
            return Ok(());
        }
        let mut edit = Stamp {
            bodies,
            copies: BTreeMap::new(),
            next,
            left: limit,
            mode,
        };
        let mut owners: BTreeMap<ObjectId, Dict> = BTreeMap::new();
        for (i, &id) in pages.iter().enumerate() {
            let sid = self.pages[if multi {
                i.min(self.pages.len() - 1)
            } else {
                0
            }];
            let src = &mut self.objects;
            let other = src.page_dict(sid, &self.tree).ok_or(BAD)?;
            let page = dst.page_dict(id, tree).ok_or(BAD)?;
            let (dst_size, src_size) = (
                geometry(dst, tree, &page),
                geometry(src, &self.tree, &other),
            );
            let existing = page.get(b"Resources").and_then(|v| dst.lookup_value(v));
            let (owner, mut res) = match existing {
                Some((owner, Value::Dict(d))) => {
                    (owner, owner.and_then(|id| owners.remove(&id)).unwrap_or(d))
                }
                _ => {
                    let mut d = match attribute(dst, tree, &page, b"Resources", |_, v| Some(v)) {
                        Some(Value::Dict(d)) => d,
                        _ => vec![],
                    };
                    for (_, item) in &mut d {
                        if let Some((_, dict @ Value::Dict(_))) = dst.lookup_value(item) {
                            *item = dict;
                        }
                    }
                    (None, d)
                }
            };
            let mut fields = match page {
                Value::Dict(d) => d,
                _ => return Err(BAD.into()),
            };
            let mut renames = BTreeMap::new();
            if let Some(source) = attribute(src, &self.tree, &other, b"Resources", |_, v| Some(v)) {
                for key in [
                    b"Font".as_slice(),
                    b"XObject",
                    b"ExtGState",
                    b"ColorSpace",
                    b"Pattern",
                    b"Shading",
                    b"Properties",
                ] {
                    let Some((_, Value::Dict(entries))) =
                        source.get(key).and_then(|v| src.lookup_value(v))
                    else {
                        continue;
                    };
                    let found = res
                        .iter()
                        .find(|(k, _)| k.as_ref() == key)
                        .and_then(|(_, v)| dst.lookup_value(v));
                    let (oid, mut cat) = match found {
                        Some((oid, Value::Dict(d))) => {
                            (oid, oid.and_then(|n| owners.remove(&n)).unwrap_or(d))
                        }
                        _ => (None, vec![]),
                    };
                    let mut used: BTreeSet<_> =
                        cat.iter().map(|(k, _)| pdf_string::name(k)).collect();
                    for (k, v) in entries {
                        let value = edit.copy(src, v, 0)?;
                        let original = pdf_string::name(&k);
                        let name = if used.contains(&original) {
                            let mut name = format!("Ov_{i}_{original}");
                            let mut suffix = 0;
                            while used.contains(&name) {
                                suffix += 1;
                                name = format!("Ov_{i}_{suffix}_{original}");
                            }
                            renames.insert(original, name.clone());
                            name
                        } else {
                            original
                        };
                        cat.push((encode_name(&name).into(), value));
                        used.insert(name);
                    }
                    if let Some(oid) = oid {
                        owners.insert(oid, cat);
                    } else {
                        set(&mut res, key, Value::Dict(cat));
                    }
                }
            }
            if let Some(owner) = owner {
                owners.insert(owner, res);
            } else {
                set(&mut fields, b"Resources", Value::Dict(res));
            }
            if let Some(content) = other.get(b"Contents") {
                let nodes = match src.lookup_value(content) {
                    Some((_, Value::Array(a))) => a,
                    _ => vec![content.clone()],
                };
                let mut stamped = Vec::new();
                for v in nodes {
                    stamped.push(
                        if !renames.is_empty()
                            && let Some((Some(id), mut dict, Some(c))) = src.lookup_object(&v)
                        {
                            let raw = src.raw_stream(id, &mut dict, c).ok_or(BAD)?;
                            let data = src.decode(&dict, raw).ok_or(BAD)?;
                            let data = names(&data, &renames, src.remaining_bytes)?;
                            edit.stream(&data)?
                        } else {
                            edit.copy(src, v, 0)?
                        },
                    );
                }
                if !stamped.is_empty() {
                    let mut target = match fields.iter().find(|(k, _)| k.as_ref() == b"Contents") {
                        Some((_, v)) => match dst.lookup_value(v) {
                            Some((_, Value::Array(a))) => a,
                            _ => vec![v.clone()],
                        },
                        None => vec![],
                    };
                    let open = edit.stream(b"q\n")?;
                    let place = edit.stream(placement(dst_size, src_size).as_bytes())?;
                    let close = edit.stream(b"\nQ\n")?;
                    let mut items = Vec::new();
                    for source_first in [!overlay, overlay] {
                        items.push(if source_first {
                            place.clone()
                        } else {
                            open.clone()
                        });
                        items.append(if source_first {
                            &mut stamped
                        } else {
                            &mut target
                        });
                        items.push(close.clone());
                    }
                    set(&mut fields, b"Contents", Value::Array(items));
                }
            }
            tree.insert(id, Some(Value::Dict(fields)));
        }
        for (oid, d) in owners {
            let mut body = Vec::new();
            encode(&Value::Dict(d), &mut body)?;
            edit.store(oid, body)?;
        }
        Ok(())
    }
}
