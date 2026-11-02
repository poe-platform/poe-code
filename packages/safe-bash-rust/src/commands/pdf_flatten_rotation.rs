// Bake the page rotation into the paint operations. A single-owner Contents
// object can be replaced in place; a shared one must survive for the other page.
use super::super::pdf_rewrite::{encode, set, write_stream};
use super::{ObjectId, Objects, PageTree, Rotation, Value, count, geometry};
use std::collections::BTreeMap;
const BAD: &str = "invalid rotated PDF page";
const LARGE: &str = "PDF output byte limit exceeded";
fn rect(vals: [f64; 4]) -> Value<'static> {
    Value::Array(
        vals.map(|n| Value::Word(n.to_string().into_bytes().into()))
            .into(),
    )
}
impl<'a> Objects<'a> {
    pub(in super::super) fn flatten_rotations(
        &mut self,
        pages: &[ObjectId],
        tree: &mut PageTree<'a>,
        rotations: &[Option<Rotation>],
        changed: &mut BTreeMap<ObjectId, Vec<u8>>,
        next: &mut usize,
        mut remaining: usize,
        state: &mut super::pdf_stamp::LayerState<'a>,
    ) -> Result<(), String> {

        let mut modified: BTreeMap<ObjectId, Value> = BTreeMap::new();
        for (i, &id) in pages.iter().enumerate() {
            let old = self.page_dict(id, tree).ok_or(BAD)?;
            let (w, h, old_rotation) = geometry(self, tree, &old);
            let rotation = rotations
                .get(i)
                .copied()
                .flatten()
                .map_or(old_rotation, |r| f64::from(r.apply(old_rotation)));
            let Value::Dict(mut fields) = old.clone() else {
                return Err(BAD.into());
            };
            if rotation == 0. {
                if rotations.get(i).is_some_and(Option::is_some) {
                    set(&mut fields, b"Rotate", Value::Word(b"0".as_slice().into()));
                    tree.insert(id, Some(Value::Dict(fields)));
                }
                continue;
            }
            let map = |obj: &mut Self, v: &Value<'a>| {
                let (_, Value::Array(a)) = obj.lookup_value(v)? else {
                    return None;
                };
                let mut vals = [0.; 4];
                for (j, n) in vals.iter_mut().enumerate() {
                    *n = obj
                        .lookup_value(a.get(j)?)
                        .and_then(|(_, v)| v.number())
                        .unwrap_or(0.);
                }
                let point = |x, y| match rotation {
                    90. => (y, w - x),
                    180. => (w - x, h - y),
                    _ => (h - y, x),
                };
                let (x0, y0) = point(vals[0], vals[1]);
                let (x1, y1) = point(vals[2], vals[3]);
                Some(rect([x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]))
            };
            if rotation != 180. {
                set(&mut fields, b"MediaBox", rect([0., 0., h, w]));
            }
            for key in [b"CropBox".as_slice(), b"BleedBox", b"TrimBox", b"ArtBox"] {
                if let Some(v) = old.get(key).and_then(|v| map(self, v)) {
                    set(&mut fields, key, v);
                }
            }
            if let Some((owner, Value::Array(a))) =
                old.get(b"Annots").and_then(|v| self.lookup_value(v))
            {
                let mut a = match owner.and_then(|id| modified.remove(&id)) {
                    Some(Value::Array(a)) => a,
                    _ => a,
                };
                for item in &mut a {
                    let Some((r, Value::Dict(d))) = self.lookup_value(item) else {
                        continue;
                    };
                    let mut d = match r.and_then(|id| {
                        modified
                            .remove(&id)
                            .or_else(|| tree.get(&id).cloned().flatten())
                    }) {
                        Some(Value::Dict(d)) => d,
                        _ => d,
                    };
                    if let Some(v) = d
                        .iter()
                        .find(|(k, _)| k.as_ref() == b"Rect")
                        .and_then(|(_, v)| map(self, v))
                    {
                        if r == Some(id) {
                            set(&mut fields, b"Rect", v);
                            continue;
                        }
                        set(&mut d, b"Rect", v);
                    }
                    if let Some(id) = r {
                        if let Some(page) = tree.get_mut(&id) {
                            *page = Some(Value::Dict(d));
                        } else {
                            modified.insert(id, Value::Dict(d));
                        }
                    } else {
                        *item = Value::Dict(d);
                    }
                }
                if let Some(id) = owner {
                    modified.insert(id, Value::Array(a));
                } else {
                    set(&mut fields, b"Annots", Value::Array(a));
                }
            }
            let mut bytes = match rotation {
                90. => format!("q\n0 -1 1 0 0 {w} cm\n"),
                180. => format!("q\n-1 0 0 -1 {w} {h} cm\n"),
                _ => format!("q\n0 1 -1 0 {h} 0 cm\n"),
            }
            .into_bytes();
            let content = old.get(b"Contents");
            state.content(self,content,changed,&mut bytes).ok_or(BAD)?;
            bytes.extend_from_slice(b"\nQ\n");
            let reuse = content
                .and_then(Value::reference)
                .filter(|id| state.counts.get(id) == Some(&1));
            let stream = if let Some(id) = reuse {
                if let Some((v, _)) = self.object(id) {
                    count(&v, &mut state.counts, -1);
                }
                id
            } else {
                let id = (*next, 0);
                *next = next.checked_add(1).ok_or(LARGE)?;
                set(&mut fields, b"Contents", Value::Ref(id));
                id
            };
            set(&mut fields, b"Rotate", Value::Word(b"0".as_slice().into()));
            let mut body = Vec::new();
            write_stream(
                &mut body,
                Value::Dict(vec![]),
                &bytes,
                Some(true),
                remaining,
            )?;
            remaining = remaining.checked_sub(body.len()).ok_or(LARGE)?;
            changed.insert(stream, body);
            let page = Value::Dict(fields);
            count(&old, &mut state.counts, -1);
            count(&page, &mut state.counts, 1);
            tree.insert(id, Some(page));
        }
        for (id, v) in modified {
            let mut body = Vec::new();
            encode(&v, &mut body)?;
            remaining = remaining.checked_sub(body.len()).ok_or(LARGE)?;
            changed.insert(id, body);
        }
        Ok(())
    }
}
