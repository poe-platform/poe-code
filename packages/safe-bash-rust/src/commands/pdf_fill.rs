#[path = "pdf_flatten_forms.rs"]
mod pdf_flatten_forms;
use super::{
    Dict, ObjectId, Objects, Value,
    pdf_fields::text,
    pdf_form_appearance::appearance,
    pdf_form_data::{self, Input},
    pdf_rewrite::{PageEdits, encode, set, write_stream},
    pdf_string,
    pdf_update::encode_name,
};
use std::collections::{BTreeMap, BTreeSet};
const LIMIT: &str = "PDF output byte limit exceeded";
const BAD: &str = "invalid PDF form";
fn name(s: &str) -> Value<'static> {
    let mut w = vec![b'/'];
    w.extend(encode_name(s));
    Value::Word(w.into())
}
fn word(s: &'static [u8]) -> Value<'static> {
    Value::Word(s.into())
}
fn get<'a, 'b>(d: &'b Dict<'a>, k: &[u8]) -> Option<&'b Value<'a>> {
    d.iter()
        .rev()
        .find(|(key, _)| key.as_ref() == k)
        .map(|(_, v)| v)
}
#[derive(Clone, Default)]
struct Attributes {
    path: String,
    kind: String,
    align: f64,
    flags: i32,
    max_len: Option<f64>,
}
#[derive(Clone, Copy)]
enum FieldEdit<'a> {
    Update(&'a str, &'a Input),
    Generate { force: bool },
}
struct Fill<'r, 'a> {
    objects: &'r mut Objects<'a>,
    values: BTreeMap<ObjectId, Value<'a>>,
    bodies: &'r mut BTreeMap<ObjectId, Vec<u8>>,
    next: usize,
    remaining: usize,
    mode: Option<bool>,
    font: Option<&'r str>,
    default_da: String,
}
impl<'a> Fill<'_, 'a> {
    fn resolve(&mut self, v: &Value<'a>) -> Option<(Option<ObjectId>, Value<'a>)> {
        let mut node = v.clone();
        let mut seen = BTreeSet::new();
        let mut owner = None;
        while let Value::Ref(r) = node {
            if !seen.insert(r) {
                return None;
            }
            node = if let Some(x) = self.values.get(&r) {
                x.clone()
            } else if let Some(body) = self.bodies.get(&r) {
                let mut c = super::Cursor(body);
                let value = c.value(0, &mut self.objects.tokens, true)?;
                c.skip();
                if c.0.starts_with(b"stream") {
                    return None;
                }
                value.into_owned()
            } else {
                let (v, mut c) = self.objects.object(r)?;
                c.skip();
                if c.0.starts_with(b"stream") {
                    return None;
                }
                v
            };
            owner = Some(r);
        }
        Some((owner, node))
    }
    fn attr(&mut self, d: &Dict<'a>, key: &[u8]) -> Option<Value<'a>> {
        self.resolve(get(d, key)?).map(|x| x.1)
    }
    fn put(&mut self, id: Option<ObjectId>, v: Value<'a>, slot: &mut Value<'a>) {
        if let Some(r) = id {
            self.values.insert(r, v);
        } else {
            *slot = v;
        }
    }
    fn allocate(&mut self) -> Result<ObjectId, String> {
        let id = (self.next, 0);
        self.next = self.next.checked_add(1).ok_or(LIMIT)?;
        Ok(id)
    }
    fn stream(
        &mut self,
        dict: Value<'a>,
        data: &[u8],
        mode: Option<bool>,
    ) -> Result<Value<'a>, String> {
        let r = self.allocate()?;
        let mut body = vec![];
        write_stream(&mut body, dict, data, mode, self.remaining)?;
        self.remaining = self.remaining.checked_sub(body.len()).ok_or(LIMIT)?;
        self.bodies.insert(r, body);
        Ok(Value::Ref(r))
    }
    fn normal_states(&mut self, d: &Dict<'a>) -> Option<Dict<'a>> {
        let ap = self.attr(d, b"AP")?;
        let (_, normal) = self.resolve(ap.get(b"N")?)?;
        match normal {
            Value::Dict(n) => Some(n),
            _ => None,
        }
    }
    fn draw(&mut self, d: &mut Dict<'a>, value: &str, a: &Attributes) -> Result<(), String> {
        let rect = self.attr(d, b"Rect").and_then(|v| {
            let Value::Array(items) = v else { return None };
            let mut r = [0.; 4];
            for (i, v) in r.iter_mut().enumerate() {
                *v = self.resolve(items.get(i)?)?.1.number()?;
            }
            Some(r)
        });
        let (w, h) = rect.map_or((120., 20.), |[x, y, r, t]| {
            ((r - x).abs().max(10.), (t - y).abs().max(10.))
        });
        let da = get(d, b"DA")
            .cloned()
            .or_else(|| self.attr(d, b"Parent")?.get(b"DA").cloned());
        let da = da
            .and_then(|v| self.resolve(&v))
            .and_then(|(_, v)| text(&v));
        let (mut font, paint) = appearance(
            value,
            w,
            h,
            da.as_deref().unwrap_or(&self.default_da),
            a.align,
            a.flags,
            a.max_len,
            self.remaining,
        )
        .ok_or(LIMIT)?;
        if font == "Helvetica"
            && let Some(f) = self.font
        {
            font = f.trim_start_matches('/').into();
        }
        let f = self.allocate()?;
        self.values.insert(
            f,
            Value::Dict(vec![
                (b"Type".into(), word(b"/Font")),
                (b"Subtype".into(), word(b"/Type1")),
                (b"BaseFont".into(), name(&font)),
            ]),
        );
        let number = |n: f64| Value::Word(n.to_string().into_bytes().into());
        let mut dict = Value::Dict(vec![
            (b"Type".into(), word(b"/XObject")),
            (b"Subtype".into(), word(b"/Form")),
            (b"FormType".into(), word(b"1")),
            (
                b"BBox".into(),
                Value::Array([0., 0., w, h].map(number).into()),
            ),
            (
                b"Resources".into(),
                Value::Dict(vec![(
                    b"Font".into(),
                    Value::Dict(vec![(b"F1".into(), Value::Ref(f))]),
                )]),
            ),
        ]);
        dict.set_stream_length(paint.len()).ok_or(BAD)?;
        let stream = self.stream(dict, paint.as_bytes(), self.mode)?;
        set(d, b"AP", Value::Dict(vec![(b"N".into(), stream)]));
        Ok(())
    }
    fn on_value(
        &mut self,
        d: &Dict<'a>,
        kids: &Option<(Option<ObjectId>, Vec<Value<'a>>)>,
    ) -> String {
        let on = |normal: Option<Dict>| {
            normal?
                .into_iter()
                .map(|(k, _)| pdf_string::name(&k))
                .find(|s| s != "Off")
        };
        on(self.normal_states(d))
            .or_else(|| {
                kids.as_ref()?.1.iter().find_map(|v| {
                    let (_, Value::Dict(k)) = self.resolve(v)? else {
                        return None;
                    };
                    on(self.normal_states(&k))
                })
            })
            .unwrap_or_else(|| "Yes".into())
    }
    fn draw_widgets(
        &mut self,
        d: &mut Dict<'a>,
        kids: &mut Option<(Option<ObjectId>, Vec<Value<'a>>)>,
        display: &str,
        a: &Attributes,
    ) -> Result<(), String> {
        self.draw(d, display, a)?;
        if let Some((_, ks)) = kids {
            for k in ks {
                if let Some((r, Value::Dict(mut child))) = self.resolve(k)
                    && get(&child, b"T").is_none()
                {
                    self.draw(&mut child, display, a)?;
                    self.put(r, Value::Dict(child), k);
                }
            }
        }
        Ok(())
    }
    fn field(
        &mut self,
        node: &mut Value<'a>,
        a: &Attributes,
        edit: FieldEdit,
        active: &mut BTreeSet<ObjectId>,
        depth: usize,
    ) -> Result<bool, String> {
        if depth > 64 {
            return Err("PDF form field depth limit exceeded".into());
        }
        self.objects.tokens = self.objects.tokens.checked_sub(1).ok_or(LIMIT)?;
        let Some((id, Value::Dict(mut d))) = self.resolve(node) else {
            return Ok(false);
        };
        if let Some(r) = id
            && !active.insert(r)
        {
            return Ok(false);
        }
        let mut a = a.clone();
        if let Some(t) = self
            .attr(&d, b"T")
            .as_ref()
            .and_then(text)
            .filter(|v| !v.is_empty())
        {
            if !a.path.is_empty() {
                a.path.push('.');
            }
            a.path.push_str(&t);
        }
        if let Some(k) = self.attr(&d, b"FT").as_ref().and_then(text) {
            a.kind = k;
        }
        if let Some(n) = self.attr(&d, b"Q").and_then(|v| v.number()) {
            a.align = n;
        }
        if let Some(n) = self.attr(&d, b"Ff").and_then(|v| v.number()) {
            a.flags = n as i32;
        }
        if let Some(n) = self.attr(&d, b"MaxLen").and_then(|v| v.number()) {
            a.max_len = Some(n);
        }
        let mut kids = get(&d, b"Kids")
            .and_then(|v| self.resolve(v))
            .and_then(|(r, v)| {
                if let Value::Array(a) = v {
                    Some((r, a))
                } else {
                    None
                }
            });
        let children = kids.as_ref().is_some_and(|(_, ks)| {
            !ks.is_empty()
                && (a.path.is_empty()
                    || a.kind.is_empty()
                    || ks
                        .iter()
                        .any(|v| self.resolve(v).is_some_and(|(_, v)| v.get(b"T").is_some())))
        });
        let mut matched = false;
        if children {
            if let Some((_, ks)) = &mut kids {
                for k in ks {
                    matched |= self.field(k, &a, edit, active, depth + 1)?;
                }
            }
        } else if let FieldEdit::Update(key, input) = edit
            && !a.path.is_empty()
            && a.path == key
        {
            matched = true;
            if matches!(input, Input::Check(_)) || a.kind == "Btn" {
                let default = self.on_value(&d, &kids);
                let state = match input {
                    Input::Check(true) => &default,
                    Input::Check(false) => "Off",
                    Input::Text(s) => match s.as_str() {
                        "Off" | "false" | "0" | "" => "Off",
                        "true" => &default,
                        s => s,
                    },
                };
                set(&mut d, b"FT", word(b"/Btn"));
                set(&mut d, b"V", name(state));
                set(&mut d, b"AS", name(state));
                if let Some((_, ks)) = &mut kids {
                    for k in ks {
                        if let Some((r, Value::Dict(mut child))) = self.resolve(k) {
                            let off = self.normal_states(&child).is_some_and(|n| {
                                !n.is_empty()
                                    && !n.iter().any(|(k, _)| pdf_string::name(k) == state)
                            });
                            set(&mut child, b"AS", name(if off { "Off" } else { state }));
                            self.put(r, Value::Dict(child), k);
                        }
                    }
                }
            } else if let Input::Text(s) = input {
                if a.kind.is_empty() {
                    set(&mut d, b"FT", word(b"/Tx"));
                }
                let multi = a.kind == "Ch" && a.flags & (1 << 21) != 0 && s.contains(',');
                let vals: Vec<_> = if multi {
                    s.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .collect()
                } else {
                    vec![s.as_str()]
                };
                set(
                    &mut d,
                    b"V",
                    if multi {
                        Value::Array(vals.iter().map(|s| pdf_string::encode(s)).collect())
                    } else {
                        pdf_string::encode(s)
                    },
                );
                let mut display = s.clone();
                if a.kind == "Ch"
                    && let Some(Value::Array(opts)) = self.attr(&d, b"Opt")
                {
                    let mut inds = vec![];
                    for (i, v) in opts.iter().enumerate() {
                        let pair = match self.resolve(v).map(|x| x.1) {
                            Some(Value::Array(p)) if p.len() >= 2 => {
                                let mut label = |i: usize| {
                                    self.resolve(&p[i])
                                        .and_then(|(_, v)| text(&v))
                                        .unwrap_or_default()
                                };
                                (label(0), label(1))
                            }
                            Some(v @ Value::String { .. }) => {
                                let t = text(&v).unwrap();
                                (t.clone(), t)
                            }
                            _ => continue,
                        };
                        if vals.contains(&pair.0.as_str()) || vals.contains(&pair.1.as_str()) {
                            inds.push(Value::Word(i.to_string().into_bytes().into()));
                            if !multi {
                                if !pair.1.is_empty() {
                                    display = pair.1;
                                }
                                break;
                            }
                        }
                    }
                    if !inds.is_empty() {
                        set(&mut d, b"I", Value::Array(inds));
                    }
                }
                self.draw_widgets(&mut d, &mut kids, &display, &a)?;
            }
        } else if let FieldEdit::Generate { force } = edit
            && !a.path.is_empty()
            && let Some(v) = self.attr(&d, b"V")
        {
            let has_normal = self
                .attr(&d, b"AP")
                .is_some_and(|ap| ap.get(b"N").is_some());
            if force || !has_normal {
                matched = true;
                if a.kind == "Btn" {
                    set(&mut d, b"AS", name(text(&v).as_deref().unwrap_or("Off")));
                    if !has_normal {
                        let on = self.on_value(&d, &kids);
                        let dict = Value::Dict(vec![
                            (b"Type".into(), word(b"/XObject")),
                            (b"Subtype".into(), word(b"/Form")),
                            (
                                b"BBox".into(),
                                Value::Array(vec![
                                    word(b"0"),
                                    word(b"0"),
                                    word(b"12"),
                                    word(b"12"),
                                ]),
                            ),
                        ]);
                        let yes =
                            self.stream(dict.clone(), b"q 0 0 0 rg 2 2 8 8 re f Q\n", None)?;
                        let no = self.stream(dict, b"q Q\n", None)?;
                        set(
                            &mut d,
                            b"AP",
                            Value::Dict(vec![(
                                b"N".into(),
                                Value::Dict(vec![
                                    (encode_name(&on).into(), yes),
                                    (b"Off".into(), no),
                                ]),
                            )]),
                        );
                    }
                } else {
                    let mut display = text(&v).unwrap_or_default();
                    if a.kind == "Ch"
                        && let Some(Value::Array(choices)) = self.attr(&d, b"Opt")
                    {
                        for choice in choices {
                            if let Some((_, Value::Array(pair))) = self.resolve(&choice)
                                && pair.len() >= 2
                            {
                                let label = |v: Option<(Option<ObjectId>, Value)>| match v {
                                    Some((_, Value::String { bytes, .. })) => {
                                        pdf_string::decode(&bytes)
                                    }
                                    _ => String::new(),
                                };
                                if label(self.resolve(&pair[0])) == display {
                                    let s = label(self.resolve(&pair[1]));
                                    if !s.is_empty() {
                                        display = s;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    self.draw_widgets(&mut d, &mut kids, &display, &a)?;
                }
            }
        }
        if matched {
            if let Some((r, ks)) = kids {
                let slot = d.iter_mut().find(|(k, _)| k.as_ref() == b"Kids").unwrap();
                self.put(r, Value::Array(ks), &mut slot.1);
            }
            self.put(id, Value::Dict(d), node);
        }
        if let Some(r) = id {
            active.remove(&r);
        }
        Ok(matched)
    }
}
pub(super) fn apply<'a>(
    objects: &mut Objects<'a>,
    catalog: &mut Value<'a>,
    pages: &[ObjectId],
    tree: &mut super::pdf_copy::PageTree<'a>,
    edits: &PageEdits,
    next: usize,
    bodies: &mut BTreeMap<ObjectId, Vec<u8>>,
    limit: usize,
) -> Result<usize, String> {
    let Value::Dict(cat) = catalog else {
        return Err(BAD.into());
    };
    let mut fill = Fill {
        objects,
        values: BTreeMap::new(),
        next,
        remaining: bodies
            .values()
            .try_fold(limit, |n, b| n.checked_sub(b.len()))
            .ok_or(LIMIT)?,
        bodies,
        mode: edits.compress_streams,
        font: edits.replacement_font,
        default_da: String::new(),
    };
    if edits.generate_appearances
        && let Some(slot) = cat.iter_mut().find(|(k, _)| k.as_ref() == b"AcroForm")
        && let Some((r, Value::Dict(mut form))) = fill.resolve(&slot.1)
    {
        fill.default_da = fill
            .attr(&form, b"DA")
            .as_ref()
            .and_then(text)
            .unwrap_or_default();
        let force = fill
            .attr(&form, b"NeedAppearances")
            .is_some_and(|v| v.word() == Some(b"true"));
        if let Some((_, fields)) = form.iter_mut().find(|(k, _)| k.as_ref() == b"Fields")
            && let Some((owner, Value::Array(mut items))) = fill.resolve(fields)
        {
            for item in &mut items {
                fill.field(
                    item,
                    &Attributes::default(),
                    FieldEdit::Generate { force },
                    &mut BTreeSet::new(),
                    0,
                )?;
            }
            fill.put(owner, Value::Array(items), fields);
        }
        set(&mut form, b"NeedAppearances", word(b"false"));
        fill.put(r, Value::Dict(form), &mut slot.1);
    }
    if let Some(bytes) = edits.form_data {
        fill.fill(cat, pdf_form_data::parse(bytes, limit)?)?;
    }
    if edits.flatten_forms {
        fill.flatten(cat, pages, tree)?;
    }
    if (edits.drop_xfa
        || edits.need_appearances
        || edits.form_data.is_some() && !edits.flatten_forms)
        && let Some(slot) = cat.iter_mut().find(|(k, _)| k.as_ref() == b"AcroForm")
        && let Some((r, Value::Dict(mut form))) = fill.resolve(&slot.1)
    {
        if edits.drop_xfa {
            form.retain(|(k, _)| k.as_ref() != b"XFA");
        }
        if edits.need_appearances || !edits.flatten_forms {
            set(
                &mut form,
                b"NeedAppearances",
                word(if edits.need_appearances {
                    b"true"
                } else {
                    b"false"
                }),
            );
        }
        fill.put(r, Value::Dict(form), &mut slot.1);
    }
    for (id, v) in fill.values {
        let mut body = vec![];
        encode(&v, &mut body)?;
        fill.remaining = fill.remaining.checked_sub(body.len()).ok_or(LIMIT)?;
        fill.bodies.insert(id, body);
    }
    Ok(fill.next)
}

impl<'a> Fill<'_, 'a> {
    fn fill(&mut self, cat: &mut Dict<'a>, updates: Vec<(String, Input)>) -> Result<(), String> {
        let existing = get(cat, b"AcroForm").and_then(|v| self.resolve(v));
        let (id, mut form) = match existing {
            Some((id, Value::Dict(d))) => (id, d),
            _ if updates.is_empty() => return Ok(()),
            _ => {
                let id = self.allocate()?;
                set(cat, b"AcroForm", Value::Ref(id));
                (
                    Some(id),
                    vec![
                        (b"Fields".into(), Value::Array(vec![])),
                        (b"NeedAppearances".into(), word(b"true")),
                    ],
                )
            }
        };
        self.default_da = self
            .attr(&form, b"DA")
            .as_ref()
            .and_then(text)
            .unwrap_or_default();
        if !updates.is_empty() {
            set(&mut form, b"NeedAppearances", word(b"true"));
            let (fid, mut fields) = match get(&form, b"Fields").and_then(|v| self.resolve(v)) {
                Some((r, Value::Array(a))) => (r, a),
                _ => (None, vec![]),
            };
            for (key, input) in updates {
                let mut matched = false;
                for field in &mut fields {
                    matched |= self.field(
                        field,
                        &Attributes::default(),
                        FieldEdit::Update(&key, &input),
                        &mut BTreeSet::new(),
                        0,
                    )?;
                }
                if !matched {
                    let mut d = vec![];
                    set(
                        &mut d,
                        b"FT",
                        word(if matches!(input, Input::Check(_)) {
                            b"/Btn"
                        } else {
                            b"/Tx"
                        }),
                    );
                    set(&mut d, b"T", pdf_string::encode(&key));
                    match input {
                        Input::Text(s) => set(&mut d, b"V", pdf_string::encode(&s)),
                        Input::Check(c) => {
                            let v = word(if c { b"/Yes" } else { b"/Off" });
                            set(&mut d, b"V", v.clone());
                            set(&mut d, b"AS", v);
                        }
                    }
                    let id = self.allocate()?;
                    self.values.insert(id, Value::Dict(d));
                    fields.push(Value::Ref(id));
                }
            }
            if let Some(r) = fid {
                self.values.insert(r, Value::Array(fields));
            } else {
                set(&mut form, b"Fields", Value::Array(fields));
            }
        }
        if let Some(id) = id {
            self.values.insert(id, Value::Dict(form));
        } else {
            set(cat, b"AcroForm", Value::Dict(form));
        }
        Ok(())
    }
}
