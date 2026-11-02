// qpdf paints appearance streams into page content. Their resource names live
// in the page namespace once painted, unlike a separately invoked Form XObject.
use super::super::{
    Cursor, Dict, pdf_render::win_ansi, pdf_rewrite::set, pdf_string, pdf_update::encode_name,
};
use super::{
    ObjectId, Objects, PageTree, Value, attribute, literal,
    pdf_stamp::{LayerState, qpdf_name},
};
use std::{collections::BTreeMap, io::Write};

const BAD: &str = "invalid PDF annotation";
const LARGE: &str = "PDF output byte limit exceeded";
type Bodies = BTreeMap<ObjectId, Vec<u8>>;
fn get<'b, 'a>(dict: &'b Dict<'a>, k: &[u8]) -> Option<&'b Value<'a>> {
    dict.iter()
        .rev()
        .find(|(key, _)| key.as_ref() == k)
        .map(|(_, v)| v)
}
fn number(n: f64) -> String {
    if n == 0. {
        "0".into()
    } else if n.abs() >= 1e21 {
        format!("{n:e}").replace('e', "e+")
    } else if n.abs() < 1e-6 {
        format!("{n:e}")
    } else {
        n.to_string()
    }
}
fn array<'a>(o: &mut Objects<'a>, v: Option<&Value<'a>>) -> Vec<Option<f64>> {
    let Some((_, Value::Array(a))) = v.and_then(|v| o.lookup_value(v)) else {
        return vec![];
    };
    a.iter()
        .take(6)
        .map(|v| o.lookup_value(v).and_then(|(_, v)| v.number()))
        .collect()
}
fn value_text(v: &Value<'_>) -> Option<String> {
    match v {
        Value::String { bytes, .. } => Some(pdf_string::decode(bytes).trim().into()),
        Value::Word(w) if w.starts_with(b"/") && w.as_ref() != b"/Off" => {
            Some(pdf_string::name(&w[1..]))
        }
        _ => None,
    }
}

impl<'a> LayerState<'a> {
    pub(super) fn lookup(
        &self,
        o: &mut Objects<'a>,
        bodies: &Bodies,
        v: &Value<'a>,
    ) -> Option<(Option<ObjectId>, Value<'a>)> {
        if let Some(id) = v.reference() {
            if let Some(d) = self.owners.get(&id) {
                return Some((Some(id), Value::Dict(d.clone())));
            }
            if let Some(body) = bodies.get(&id) {
                let mut c = Cursor(body);
                let v = c.value(0, &mut o.tokens, true)?.into_owned();
                c.skip();
                return c.0.is_empty().then_some((Some(id), v));
            }
        }
        o.lookup_value(v)
    }
    pub(super) fn resources(
        &self,
        o: &mut Objects<'a>,
        tree: &PageTree<'a>,
        page: &Dict<'a>,
        bodies: &Bodies,
    ) -> (Option<ObjectId>, Dict<'a>) {
        if let Some((r, Value::Dict(d))) =
            get(page, b"Resources").and_then(|v| self.lookup(o, bodies, v))
        {
            return (r, d);
        }
        let mut d = match attribute(o, tree, &Value::Dict(page.clone()), b"Resources", |_, v| {
            Some(v)
        }) {
            Some(Value::Dict(d)) => d,
            _ => vec![],
        };
        for (_, item) in &mut d {
            if let Some((_, v @ Value::Dict(_))) = self.lookup(o, bodies, item) {
                *item = v
            }
        }
        (None, d)
    }
    pub(super) fn save_dict(
        &mut self,
        owner: Option<ObjectId>,
        d: Dict<'a>,
        parent: &mut Dict<'a>,
        key: &'static [u8],
    ) {
        if let Some(id) = owner {
            self.owners.insert(id, d);
        } else {
            set(parent, key, Value::Dict(d))
        }
    }
    pub(in super::super) fn flatten_annotations(
        &mut self,
        o: &mut Objects<'a>,
        pages: &[ObjectId],
        tree: &mut PageTree<'a>,
        bodies: &mut Bodies,
        next: &mut usize,
        left: &mut usize,
        mode: &str,
    ) -> Result<(), String> {
        for &id in pages {
            let Some(Value::Dict(mut page)) = o.page_dict(id, tree) else {
                return Err(BAD.into());
            };
            let Some((_, Value::Array(items))) =
                get(&page, b"Annots").and_then(|v| self.lookup(o, bodies, v))
            else {
                continue;
            };
            let mut keep = vec![];
            let mut isolated = false;
            for item in items {
                let Some((_, Value::Dict(d))) = self.lookup(o, bodies, &item) else {
                    continue;
                };
                if matches!(
                    get(&d, b"Subtype").and_then(Value::word),
                    Some(b"/Link" | b"/Popup")
                ) {
                    keep.push(item);
                    continue;
                }
                if let Some(f) = get(&d, b"F")
                    .and_then(|v| o.lookup_value(v))
                    .and_then(|(_, v)| v.number())
                {
                    let f = f.trunc().rem_euclid(4294967296.) as u32;
                    if f & 3 != 0
                        || (mode == "print" && f & 4 == 0)
                        || (mode == "screen" && f & 32 != 0)
                    {
                        continue;
                    }
                }
                let r = array(o, get(&d, b"Rect"));
                let coord = |i: usize, n: f64| r.get(i).copied().flatten().unwrap_or(n);
                let (x, y) = (coord(0, 72.), coord(1, 72.));
                let (w, h) = (coord(2, x + 50.) - x, coord(3, y + 20.) - y);
                let state = get(&d, b"AS")
                    .and_then(|v| o.lookup_value(v))
                    .map(|(_, v)| v);
                let mut normal = get(&d, b"AP")
                    .and_then(|v| o.lookup_value(v))
                    .and_then(|(_, v)| v.get(b"N").cloned())
                    .and_then(|v| o.lookup_object(&v));
                if let Some((_, Value::Dict(states), None)) = &normal {
                    normal = state
                        .as_ref()
                        .and_then(Value::word)
                        .and_then(|w| w.strip_prefix(b"/"))
                        .and_then(|k| get(states, k))
                        .and_then(|v| o.lookup_object(v))
                        .or_else(|| states.first().and_then(|(_, v)| o.lookup_object(v)));
                }
                if let Some((Some(n), mut dict, Some(c))) = normal {
                    self.decoded.insert(n);
                    let raw = o.raw_stream(n, &mut dict, c).ok_or(BAD)?;
                    let mut paint = o.decode(&dict, raw).ok_or(BAD)?.into_owned();
                    if !paint.is_empty() {
                        let bbox = array(o, dict.get(b"BBox"));
                        let b = |i: usize, n: f64| bbox.get(i).copied().flatten().unwrap_or(n);
                        let m = array(o, dict.get(b"Matrix"));
                        let [a, bm, c, d, e, f] = if m.len() == 6 {
                            std::array::from_fn(|i| m[i].unwrap_or(0.))
                        } else {
                            [1., 0., 0., 1., 0., 0.]
                        };
                        let corners = [
                            (b(0, 0.), b(1, 0.)),
                            (b(2, w.max(1.)), b(1, 0.)),
                            (b(0, 0.), b(3, h.max(1.))),
                            (b(2, w.max(1.)), b(3, h.max(1.))),
                        ]
                        .map(|(x, y)| (x * a + y * c + e, x * bm + y * d + f));
                        let bounds = |p: fn((f64, f64)) -> f64| {
                            let min = corners.map(p).into_iter().fold(f64::INFINITY, f64::min);
                            (
                                min,
                                (corners.map(p).into_iter().fold(f64::NEG_INFINITY, f64::max)
                                    - min)
                                    .max(1e-6),
                            )
                        };
                        let (xmin, bw) = bounds(|p| p.0);
                        let (ymin, bh) = bounds(|p| p.1);
                        let (sx, sy) = (w / bw, h / bh);
                        if let Some((_, Value::Dict(src))) = dict
                            .get(b"Resources")
                            .and_then(|v| self.lookup(o, bodies, v))
                        {
                            let (owner, mut root) = self.resources(o, tree, &page, bodies);
                            let mut renames: Vec<(String, String)> = vec![];
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
                                    get(&src, key).and_then(|v| self.lookup(o, bodies, v))
                                else {
                                    continue;
                                };
                                let (cat, mut dst) =
                                    match get(&root, key).and_then(|v| self.lookup(o, bodies, v)) {
                                        Some((r, Value::Dict(d))) => (r, d),
                                        _ => (None, vec![]),
                                    };
                                for (k, v) in entries {
                                    let original = pdf_string::name(&k);
                                    let existing =
                                        dst.iter().find(|(k, _)| pdf_string::name(k) == original);
                                    if let Some((_, old)) = existing {
                                        if matches!((old.reference(),v.reference()),(Some(a),Some(b)) if a.0==b.0)
                                        {
                                            continue;
                                        }
                                        let mut i = 1;
                                        let alias = loop {
                                            let s = format!("{original}_qap{i}");
                                            o.tokens =
                                                o.tokens.checked_sub(dst.len()).ok_or(LARGE)?;
                                            if !dst.iter().any(|(k, _)| pdf_string::name(k) == s) {
                                                break s;
                                            }
                                            i += 1
                                        };
                                        dst.push((encode_name(&alias).into(), v));
                                        if let Some((_, a)) =
                                            renames.iter_mut().find(|(k, _)| *k == original)
                                        {
                                            *a = alias
                                        } else {
                                            renames.push((original, alias))
                                        }
                                    } else {
                                        dst.push((k, v))
                                    }
                                }
                                self.save_dict(cat, dst, &mut root, key);
                            }
                            self.save_dict(owner, root, &mut page, b"Resources");
                            for (old, new) in renames {
                                paint = qpdf_name(&paint, &old, &new, *left)?;
                            }
                        }
                        let mut bytes = vec![];
                        self.content(o, get(&page, b"Contents"), bodies, &mut bytes)
                            .ok_or(BAD)?;
                        write!(
                            bytes,
                            "\nq {} 0 0 {} {} {} cm",
                            number(sx),
                            number(sy),
                            number(x - xmin * sx),
                            number(y - ymin * sy)
                        )
                        .unwrap();
                        if m.len() == 6 {
                            write!(bytes, " {} cm", [a, bm, c, d, e, f].map(number).join(" "))
                                .unwrap()
                        }
                        if bytes.len().saturating_add(paint.len()) > *left {
                            return Err(LARGE.into());
                        }
                        bytes.push(b'\n');
                        bytes.extend(paint);
                        bytes.extend_from_slice(b"\nQ\n");
                        self.replace(o, &mut page, &bytes, bodies, next, left, true)?;
                        isolated = false;
                        continue;
                    }
                }
                let mut text = get(&d, b"Contents")
                    .filter(|v| matches!(v, Value::String { .. }))
                    .and_then(value_text)
                    .unwrap_or_default();
                if text.is_empty() {
                    let value = get(&d, b"V")
                        .and_then(|v| self.lookup(o, bodies, v))
                        .or_else(|| {
                            let (_, parent) = self.lookup(o, bodies, get(&d, b"Parent")?)?;
                            self.lookup(o, bodies, parent.get(b"V")?)
                        });
                    text = value
                        .as_ref()
                        .and_then(|(_, v)| value_text(v))
                        .or_else(|| state.as_ref().and_then(value_text))
                        .unwrap_or_default();
                }
                if text.is_empty() {
                    continue;
                }
                let (owner, mut root) = self.resources(o, tree, &page, bodies);
                let (cat, mut fonts) =
                    match get(&root, b"Font").and_then(|v| self.lookup(o, bodies, v)) {
                        Some((r, Value::Dict(d))) => (r, d),
                        _ => (None, vec![]),
                    };
                let font = fonts.iter().find_map(|(k, v)| {
                    let (_, d) = self.lookup(o, bodies, v)?;
                    let (_, f) = self.lookup(o, bodies, d.get(b"BaseFont")?)?;
                    (f.word() == Some(b"/Helvetica")).then(|| pdf_string::name(k))
                });
                let font = if let Some(f) = font {
                    f
                } else {
                    let mut i = 1;
                    let f = loop {
                        let f = format!("F{i}");
                        if get(&fonts, f.as_bytes()).is_none() {
                            break f;
                        }
                        i += 1
                    };
                    let n = (*next, 0);
                    *next = next.checked_add(1).ok_or(LARGE)?;
                    let body=b"<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n/Encoding /WinAnsiEncoding\n>>".to_vec();
                    *left = left.checked_sub(body.len()).ok_or(LARGE)?;
                    bodies.insert(n, body);
                    fonts.push((f.as_bytes().to_vec().into(), Value::Ref(n)));
                    f
                };
                self.save_dict(cat, fonts, &mut root, b"Font");
                self.save_dict(owner, root, &mut page, b"Resources");
                let mut old = vec![];
                self.content(o, get(&page, b"Contents"), bodies, &mut old)
                    .ok_or(BAD)?;
                let mut bytes = super::pdf_content_edit::serialize_content(
                    &old,
                    isolated,
                    &mut o.tokens,
                    *left,
                    |_, _| Ok(None),
                )?;
                write!(
                    bytes,
                    "q\n0 0 0 rg\nBT\n/{font} 10 Tf\n1 0 0 1 {} {} Tm\n",
                    number(x),
                    number(y)
                )
                .unwrap();
                let mut chars = win_ansi(&text);
                for b in &mut chars {
                    if *b < 32 {
                        *b = b'?'
                    }
                }
                literal(&chars, &mut bytes);
                bytes.extend_from_slice(b" Tj\nET\nQ");
                self.replace(o, &mut page, &bytes, bodies, next, left, true)?;
                isolated = true;
            }
            if keep.is_empty() {
                page.retain(|(k, _)| k.as_ref() != b"Annots")
            } else {
                set(&mut page, b"Annots", Value::Array(keep))
            }
            tree.insert(id, Some(Value::Dict(page)));
        }
        Ok(())
    }
}
