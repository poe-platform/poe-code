// Bake widget appearances into the page. PDFtk keeps the original appearance's
// resources in the Form XObject and leaves links and other annotations editable.
use super::super::{Cursor, pdf_copy::PageTree};
use super::*;
use std::fmt::Write;

impl<'a> Fill<'_, 'a> {
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
    fn append_paint(&mut self, page: &mut Dict<'a>, paint: String) -> Result<(), String> {
        let mut dict = Value::Dict(vec![]);
        dict.set_stream_length(paint.len()).ok_or(BAD)?;
        let r = self.stream(dict, paint.as_bytes(), self.mode)?;
        if let Some((_, old)) = page.iter_mut().find(|(k, _)| k.as_ref() == b"Contents") {
            if let Some((owner, Value::Array(mut a))) = self.resolve(old) {
                a.push(r);
                self.put(owner, Value::Array(a), old);
            } else {
                *old = Value::Array(vec![old.clone(), r]);
            }
        } else {
            set(page, b"Contents", r);
        }
        Ok(())
    }
    fn paint_text(
        &mut self,
        page: &mut Dict<'a>,
        v: Option<Value<'a>>,
        x: f64,
        y: f64,
        arrays: bool,
    ) -> Result<(), String> {
        let s = match v {
            Some(Value::Array(a)) if arrays => a
                .iter()
                .filter_map(|v| self.resolve(v).and_then(|(_, v)| text(&v)))
                .collect::<Vec<_>>()
                .join(", "),
            Some(v) if v.word() == Some(b"true") => "Yes".into(),
            Some(v) if v.word() != Some(b"/Off") => text(&v).unwrap_or_default(),
            _ => String::new(),
        };
        if s.is_empty() {
            return Ok(());
        }
        let (rid, mut res) = self.dictionary(page, b"Resources");
        let (fid, mut fonts) = self.dictionary(&res, b"Font");
        let key = if get(&fonts, b"F1").is_some() {
            b"F_AcroFlat".as_slice()
        } else {
            b"F1"
        };
        if get(&fonts, key).is_none() {
            let id = self.allocate()?;
            self.values.insert(
                id,
                Value::Dict(vec![
                    (b"Type".into(), word(b"/Font")),
                    (b"Subtype".into(), word(b"/Type1")),
                    (
                        b"BaseFont".into(),
                        name(self.font.unwrap_or("Helvetica").trim_start_matches('/')),
                    ),
                ]),
            );
            set(&mut fonts, key, Value::Ref(id));
        }
        if let Some(r) = fid {
            self.values.insert(r, Value::Dict(fonts));
        } else {
            set(&mut res, b"Font", Value::Dict(fonts));
        }
        if let Some(r) = rid {
            self.values.insert(r, Value::Dict(res));
        } else {
            set(page, b"Resources", Value::Dict(res));
        }
        let mut paint = format!("\nq BT /{} 11 Tf ", std::str::from_utf8(key).unwrap());
        let round = |n: f64| {
            let n = (n + 0.5).floor();
            if n == 0. { 0. } else { n }
        };
        for (i, line) in s.replace("\r\n", "\n").split('\n').enumerate() {
            if i == 0 {
                write!(paint, "{} {} Td (", round(x), round(y)).unwrap();
            } else {
                paint.push_str(" 0 -13 Td (");
            }
            for c in line.chars() {
                if matches!(c, '(' | ')' | '\\') {
                    paint.push('\\');
                }
                paint.push(c);
            }
            paint.push_str(") Tj");
            if paint.len() > self.remaining {
                return Err(LIMIT.into());
            }
        }
        paint.push_str(" ET Q\n");
        self.append_paint(page, paint)
    }
    fn dictionary(&mut self, d: &Dict<'a>, key: &[u8]) -> (Option<ObjectId>, Dict<'a>) {
        match get(d, key).and_then(|v| self.resolve(v)) {
            Some((r, Value::Dict(d))) => (r, d),
            _ => (None, vec![]),
        }
    }
    fn numbers<const N: usize>(&mut self, d: &Dict<'a>, key: &[u8]) -> [Option<f64>; N] {
        let a = self.attr(d, key);
        std::array::from_fn(|i| {
            let Value::Array(a) = a.as_ref()? else {
                return None;
            };
            self.resolve(a.get(i)?).and_then(|(_, v)| v.number())
        })
    }
    fn clone_appearance(&mut self, v: &Value<'a>) -> Option<(Dict<'a>, Vec<u8>, Option<bool>)> {
        if let Some(body) = v.reference().and_then(|id| self.bodies.get(&id)) {
            let mut c = Cursor(body);
            let Value::Dict(d) = c.value(0, &mut self.objects.tokens, true)?.into_owned() else {
                return None;
            };
            let n = get(&d, b"Length")?.number()? as usize;
            c.skip();
            return Some((d, c.0.strip_prefix(b"stream\n")?.get(..n)?.to_vec(), None));
        }
        let (Some(id), mut dict, Some(c)) = self.objects.lookup_object(v)? else {
            return None;
        };
        let raw = self.objects.raw_stream(id, &mut dict, c)?;
        let data = if self.mode.is_some() {
            self.objects.decode(&dict, raw)?
        } else {
            raw
        };
        if let Value::Dict(d) = dict {
            Some((d, data.into_owned(), self.mode))
        } else {
            None
        }
    }
    fn draw_widget(
        &mut self,
        page: &mut Dict<'a>,
        widget: &Dict<'a>,
        tree: &PageTree<'a>,
    ) -> Result<(), String> {
        let [x, y, x2, y2] = self.numbers(widget, b"Rect");
        let (x, y) = (x.unwrap_or(50.), y.unwrap_or(700.));
        let parent = self.attr(widget, b"Parent");
        let value = self.attr(widget, b"AS").or_else(|| {
            let v = get(widget, b"V").or_else(|| {
                parent
                    .as_ref()
                    .and_then(|p| p.get(b"V").or_else(|| p.get(b"AS")))
            })?;
            self.resolve(v).map(|(_, v)| v)
        });
        let mut ap = self.attr(widget, b"AP").and_then(|d| d.get(b"N").cloned());
        if let Some((_, Value::Dict(states))) = ap.as_ref().and_then(|v| self.resolve(v))
            && let Some(state) = value
                .as_ref()
                .and_then(Value::word)
                .and_then(|w| w.strip_prefix(b"/"))
            && state != b"Off"
        {
            ap = get(&states, state).cloned();
        }
        let Some((mut dict, data, mode)) = ap.as_ref().and_then(|v| self.clone_appearance(v))
        else {
            return self.paint_text(page, value, x + 2., y + 4., true);
        };
        let width = x2.map_or(20., |r| (r - x).abs().max(1.));
        let height = y2.map_or(20., |r| (r - y).abs().max(1.));
        let [x0, y0, x1, y1] = match self.numbers(&dict, b"BBox") {
            [Some(x0), Some(y0), Some(x1), Some(y1)] => [x0, y0, x1, y1],
            _ => [0., 0., width, height],
        };
        let matrix = self.attr(&dict, b"Matrix");
        let [a, b, c, d, e, f] = if matches!(matrix,Some(Value::Array(ref a)) if a.len()>=6) {
            self.numbers(&dict, b"Matrix").map(|v| v.unwrap_or(0.))
        } else {
            [1., 0., 0., 1., 0., 0.]
        };
        let corners = [(x0, y0), (x0, y1), (x1, y0), (x1, y1)]
            .map(|(x, y)| (a * x + c * y + e, b * x + d * y + f));
        let bounds = |dim: fn((f64, f64)) -> f64| {
            let min = corners.map(dim).into_iter().fold(f64::INFINITY, f64::min);
            let max = corners
                .map(dim)
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max);
            (min, (max - min).max(1.))
        };
        let (left, w) = bounds(|p| p.0);
        let (bottom, h) = bounds(|p| p.1);
        let round = |n: f64| {
            let n = format!("{n:.6}").parse::<f64>().unwrap();
            if n == 0. { 0. } else { n }
        };
        let (sx, sy) = (round(width / w), round(height / h));
        let (tx, ty) = (round(x - left * sx), round(y - bottom * sy));
        let mut current = Value::Dict(page.clone());
        let mut seen = BTreeSet::new();
        let mut res = loop {
            if let Some(v) = current.get(b"Resources") {
                break match self.resolve(v) {
                    Some((_, Value::Dict(d))) => d,
                    _ => vec![],
                };
            }
            let Some(p) = current
                .get(b"Parent")
                .and_then(Value::reference)
                .filter(|id| seen.insert(*id))
            else {
                break vec![];
            };
            let Some(v) = tree
                .get(&p)
                .cloned()
                .flatten()
                .or_else(|| self.resolve(&Value::Ref(p)).map(|(_, v)| v))
            else {
                break vec![];
            };
            current = v;
        };
        let (_, mut xobjs) = self.dictionary(&res, b"XObject");
        let mut n = 1;
        let alias = loop {
            let k = format!("AcroAppearance{n}");
            if get(&xobjs, k.as_bytes()).is_none() {
                break k;
            }
            n += 1;
        };
        set(&mut dict, b"Type", word(b"/XObject"));
        set(&mut dict, b"Subtype", word(b"/Form"));
        xobjs.push((
            alias.as_bytes().to_vec().into(),
            self.stream(Value::Dict(dict), &data, mode)?,
        ));
        set(&mut res, b"XObject", Value::Dict(xobjs));
        set(page, b"Resources", Value::Dict(res));
        self.append_paint(
            page,
            format!("\nq {sx} 0 0 {sy} {tx} {ty} cm /{alias} Do Q\n"),
        )
    }
    pub(super) fn flatten(
        &mut self,
        catalog: &mut Dict<'a>,
        pages: &[ObjectId],
        tree: &mut PageTree<'a>,
    ) -> Result<(), String> {
        let mut baked = BTreeSet::new();
        for &id in pages {
            let Some(Value::Dict(mut page)) = self.objects.page_dict(id, tree) else {
                return Err(BAD.into());
            };
            let Some((owner, Value::Array(items))) =
                get(&page, b"Annots").and_then(|v| self.resolve(v))
            else {
                continue;
            };
            let mut keep = vec![];
            for (i, item) in items.into_iter().enumerate() {
                if let Some((r, Value::Dict(d))) = self.resolve(&item)
                    && (self
                        .attr(&d, b"Subtype")
                        .is_some_and(|v| v.word() == Some(b"/Widget"))
                        || get(&d, b"FT").is_some()
                        || get(&d, b"T").is_some())
                {
                    if let Some(r) = r {
                        baked.insert((r, None));
                    } else if let Some(o) = owner {
                        baked.insert((o, Some(i)));
                    }
                    if let Some((Some(p), Value::Dict(_))) =
                        get(&d, b"Parent").and_then(|v| self.resolve(v))
                    {
                        baked.insert((p, None));
                    }
                    self.draw_widget(&mut page, &d, tree)?;
                } else {
                    keep.push(item);
                }
            }
            set(&mut page, b"Annots", Value::Array(keep));
            tree.insert(id, Some(Value::Dict(page)));
        }
        let Some(&first) = pages.first() else {
            return Ok(());
        };
        let Some((owner, Value::Dict(mut form))) =
            get(catalog, b"AcroForm").and_then(|v| self.resolve(v))
        else {
            return Ok(());
        };
        let Some(Value::Dict(mut page)) = self.objects.page_dict(first, tree) else {
            return Err(BAD.into());
        };
        let mut pending = Vec::new();
        let mut active = BTreeSet::new();
        if let Some((r, Value::Array(fields))) = get(&form, b"Fields").and_then(|v| self.resolve(v))
        {
            for (i, v) in fields.into_iter().enumerate().rev() {
                pending.push((Some(v), r.map(|r| (r, Some(i))), false, false, 0));
            }
        }
        while let Some((node, location, named, typed, depth)) = pending.pop() {
            if depth > 64 {
                return Err("PDF form field depth limit exceeded".into());
            }
            let Some(node) = node else {
                if let Some((r, _)) = location {
                    active.remove(&r);
                }
                continue;
            };
            self.objects.tokens = self.objects.tokens.checked_sub(1).ok_or(LIMIT)?;
            let Some((r, Value::Dict(d))) = self.resolve(&node) else {
                continue;
            };
            let location = r.map(|r| (r, None)).or(location);
            if let Some(r) = r {
                if !active.insert(r) {
                    continue;
                }
                pending.push((None, Some((r, None)), false, false, 0));
            }
            let named = named
                || self
                    .attr(&d, b"T")
                    .as_ref()
                    .and_then(text)
                    .is_some_and(|s| !s.is_empty());
            let typed = self
                .attr(&d, b"FT")
                .map_or(typed, |v| v.word().is_some_and(|w| w.starts_with(b"/")));
            if let Some((owner, Value::Array(ks))) = get(&d, b"Kids").and_then(|v| self.resolve(v))
                && !ks.is_empty()
                && (!named
                    || !typed
                    || ks
                        .iter()
                        .any(|k| self.resolve(k).is_some_and(|(_, v)| v.get(b"T").is_some())))
            {
                for (i, k) in ks.into_iter().enumerate().rev() {
                    pending.push((
                        Some(k),
                        owner.map(|r| (r, Some(i))),
                        named,
                        typed,
                        depth + 1,
                    ));
                }
                continue;
            }
            if named && !location.is_some_and(|loc| baked.contains(&loc)) {
                let [x, y] = self.numbers(&d, b"Rect");
                let value = get(&d, b"V")
                    .or_else(|| get(&d, b"AS"))
                    .and_then(|v| self.resolve(v))
                    .map(|(_, v)| v);
                self.paint_text(
                    &mut page,
                    value,
                    x.unwrap_or(50.) + 2.,
                    y.unwrap_or(700.) + 4.,
                    false,
                )?;
            }
        }
        tree.insert(first, Some(Value::Dict(page)));
        set(&mut form, b"Fields", Value::Array(vec![]));
        set(&mut form, b"NeedAppearances", word(b"false"));
        if let Some(id) = owner {
            self.values.insert(id, Value::Dict(form));
        } else {
            set(catalog, b"AcroForm", Value::Dict(form));
        }
        Ok(())
    }
}
