//! Static form widgets that have no normal appearance stream.
use super::{
    Cursor, Draw, Font, Matrix, Objects, PageSource, Program, Resources, State, Value, concat,
};
use crate::commands::archive::pdf_reader::{pdf_render::win_ansi, pdf_string};
use std::rc::Rc;

fn inherited<'a>(
    objects: &mut Objects<'a>,
    annot: &Value<'a>,
    key: &[u8],
) -> Option<Option<Value<'a>>> {
    let mut current = annot.clone();
    for _ in 0..128 {
        if let Some(value) = current.get(key) {
            let value = objects.resolve(value)?;
            if value.word() != Some(b"null") {
                return Some(Some(value));
            }
        }
        let Some(parent) = current.get(b"Parent") else {
            return Some(None);
        };
        current = objects.resolve(parent)?;
    }
    None
}
fn numbers<'a>(objects: &mut Objects<'a>, value: Option<&Value<'a>>) -> Option<Vec<f64>> {
    let Some(value) = value else {
        return Some(vec![]);
    };
    let value = objects.resolve(value)?;
    if value.word() == Some(b"null") {
        return Some(vec![]);
    }
    let Value::Array(values) = value else {
        return None;
    };
    if values.len() > 256 {
        return None;
    }
    values
        .iter()
        .map(|v| {
            let n = objects.resolve(v)?.number()?;
            n.is_finite().then_some(n)
        })
        .collect()
}
fn op<'a>(
    objects: &mut Objects<'a>,
    emit: &mut impl FnMut(Draw<'_, '_>, &mut Objects<'a>) -> Option<()>,
    matrix: Matrix,
    name: &[u8],
    values: &[f64],
) -> Option<()> {
    let values = values
        .iter()
        .map(|n| Value::Word(n.to_string().into_bytes().into()))
        .collect::<Vec<_>>();
    emit(Draw::Operator(name, &values, matrix), objects)
}
fn color<'a>(
    objects: &mut Objects<'a>,
    emit: &mut impl FnMut(Draw<'_, '_>, &mut Objects<'a>) -> Option<()>,
    matrix: Matrix,
    values: &[f64],
    stroke: bool,
) -> Option<()> {
    let name: &[u8] = match (values.len(), stroke) {
        (0, _) => return Some(()),
        (1, false) => b"g",
        (1, true) => b"G",
        (3, false) => b"rg",
        (3, true) => b"RG",
        (4, false) => b"k",
        (4, true) => b"K",
        _ => return None,
    };
    op(objects, emit, matrix, name, values)
}
fn circle<'a>(
    objects: &mut Objects<'a>,
    emit: &mut impl FnMut(Draw<'_, '_>, &mut Objects<'a>) -> Option<()>,
    matrix: Matrix,
    cx: f64,
    cy: f64,
    radius: f64,
) -> Option<()> {
    let r = radius.max(0.);
    let k = r * 0.5523;
    op(objects, emit, matrix, b"m", &[cx, cy + r])?;
    for values in [
        [cx + k, cy + r, cx + r, cy + k, cx + r, cy],
        [cx + r, cy - k, cx + k, cy - r, cx, cy - r],
        [cx - k, cy - r, cx - r, cy - k, cx - r, cy],
        [cx - r, cy + k, cx - k, cy + r, cx, cy + r],
    ] {
        op(objects, emit, matrix, b"c", &values)?;
    }
    Some(())
}
impl<'a> PageSource<'a> {
    pub(super) fn draw_widget(
        &mut self,
        annot: &Value<'a>,
        scopes: &mut Vec<Resources<'a>>,
        emit: &mut impl FnMut(Draw<'_, '_>, &mut Objects<'a>) -> Option<()>,
    ) -> Option<bool> {
        if annot.get(b"Subtype").and_then(Value::word) != Some(b"/Widget") {
            return Some(false);
        }
        let kind = inherited(&mut self.objects, annot, b"FT")?;
        let Some(kind @ (b"/Tx" | b"/Ch" | b"/Btn")) = kind.as_ref().and_then(Value::word) else {
            return Some(false);
        };
        let flags = inherited(&mut self.objects, annot, b"Ff")?
            .as_ref()
            .and_then(Value::number)
            .unwrap_or(0.) as i32;
        let button = kind == b"/Btn";
        let push = button && flags & 65536 != 0;
        let radio = button && !push && flags & 32768 != 0;
        let state = match (button, annot.get(b"AS")) {
            (true, Some(v)) => Some(self.objects.resolve(v)?),
            _ => None,
        };
        // Appearance state belongs to this widget; a parent value can select a sibling.
        let checked = state
            .as_ref()
            .and_then(Value::word)
            .is_some_and(|v| v.starts_with(b"/") && v != b"/Off");
        let rect = numbers(&mut self.objects, annot.get(b"Rect"))?;
        if rect.len() != 4 {
            return None;
        }
        let (rx, ry) = (rect[0].min(rect[2]), rect[1].min(rect[3]));
        let (rw, rh) = ((rect[2] - rect[0]).abs(), (rect[3] - rect[1]).abs());
        let mk = match annot.get(b"MK") {
            Some(v) => Some(self.objects.resolve(v)?),
            None => None,
        };
        let rotation = match mk.as_ref().and_then(|v| v.get(b"R")) {
            Some(v) => self.objects.resolve(v)?.number()?.rem_euclid(360.),
            None => 0.,
        };
        if ![0., 90., 180., 270.].contains(&rotation) || !(rw + rh + rx + ry).is_finite() {
            return None;
        }
        let matrix = if rotation == 90. {
            [0., 1., -1., 0., rx + rw, ry]
        } else if rotation == 180. {
            [-1., 0., 0., -1., rx + rw, ry + rh]
        } else if rotation == 270. {
            [0., -1., 1., 0., rx, ry + rh]
        } else {
            [1., 0., 0., 1., rx, ry]
        };
        let (x, y) = (0., 0.);
        let (w, h) = if rotation % 180. != 0. {
            (rh, rw)
        } else {
            (rw, rh)
        };
        if w == 0. || h == 0. {
            return Some(true);
        }
        let form = match self.catalog.get(b"AcroForm") {
            Some(v) => Some(self.objects.resolve(v)?),
            None => None,
        };
        let mut resources = Resources::default();
        if let Some(res) = form.as_ref().and_then(|v| v.get(b"DR")) {
            resources.load(&mut self.objects, res, &mut self.fonts)?;
        }
        let mut da = inherited(&mut self.objects, annot, b"DA")?;
        if da.is_none() {
            if let Some(value) = form.as_ref().and_then(|v| v.get(b"DA")) {
                da = Some(self.objects.resolve(value)?);
            }
        }
        let da = match &da {
            Some(Value::String { bytes, .. }) => pdf_string::decode(bytes),
            _ => "/Helv 12 Tf 0 g".into(),
        };
        if da.len() > 65536 {
            return None;
        }
        let mut cursor = Cursor(da.as_bytes());
        let mut previous = Vec::<Value>::new();
        let (mut name, mut size, mut ink) = ("Helv".to_owned(), 12f64, vec![0.]);
        loop {
            cursor.skip();
            if cursor.0.is_empty() {
                break;
            }
            let value = cursor.value(0, &mut self.objects.tokens, false)?;
            if value.word() == Some(b"Tf") && previous.len() >= 2 {
                let i = previous.len() - 2;
                if let Some(bytes) = previous[i].word().and_then(|v| v.strip_prefix(b"/")) {
                    name = pdf_string::name(bytes);
                }
                if let Some(n) = previous[i + 1].number() {
                    if !n.is_finite() {
                        return None;
                    }
                    size = n;
                }
            }
            let count = match value.word() {
                Some(b"g") => 1,
                Some(b"rg") => 3,
                Some(b"k") => 4,
                _ => 0,
            };
            if count > 0 && previous.len() >= count {
                let values = previous[previous.len() - count..]
                    .iter()
                    .map(Value::number)
                    .collect::<Option<Vec<_>>>()?;
                if values.iter().any(|n| !n.is_finite()) {
                    return None;
                }
                ink = values;
            }
            if previous.len() == 4 {
                previous.remove(0);
            }
            previous.push(value);
        }
        if button && !push {
            name = "ZapfDingbats".into();
        }
        let font = if button && !push {
            None
        } else {
            resources.fonts.get(name.as_bytes()).cloned()
        }
        .unwrap_or_else(|| {
            let family = match name.as_str() {
                "Helv" => "Helvetica",
                "HeBo" => "Helvetica-Bold",
                "HeOb" => "Helvetica-Oblique",
                "HeBI" => "Helvetica-BoldOblique",
                "Cour" => "Courier",
                "CoBo" => "Courier-Bold",
                "TiRo" => "Times-Roman",
                "TiBo" => "Times-Bold",
                "TiIt" => "Times-Italic",
                other => other,
            };
            Rc::new(Font {
                metrics: [-0.2, 0.8],
                extractable: false,
                program: Program::Standard,
                name: Rc::from(family),
                start: 0,
                widths: vec![],
                cid_widths: None,
                unicode: None,
            })
        });
        let align = if button {
            1.
        } else {
            inherited(&mut self.objects, annot, b"Q")?
                .as_ref()
                .and_then(Value::number)
                .unwrap_or(0.)
        };
        let max_len = inherited(&mut self.objects, annot, b"MaxLen")?
            .as_ref()
            .and_then(Value::number);
        let value = inherited(&mut self.objects, annot, b"V")?;
        let mut characters = 0usize;
        let mut string = |v: Option<&Value>| -> Option<String> {
            let text = match v {
                Some(Value::String { bytes, .. }) => pdf_string::decode(bytes),
                Some(Value::Word(word)) if word.starts_with(b"/") && word.as_ref() != b"/Off" => {
                    pdf_string::name(&word[1..])
                }
                _ => String::new(),
            };
            characters = characters.checked_add(text.len())?;
            (characters <= 65536).then_some(text)
        };
        let mut values = vec![];
        if let Some(Value::Array(items)) = &value {
            if items.len() > 4096 {
                return None;
            }
            for item in items {
                values.push(string(Some(&self.objects.resolve(item)?))?);
            }
        } else {
            values.push(string(value.as_ref())?);
        }
        let mut text = values.first().cloned().unwrap_or_default();
        let mut round = radio;
        if button {
            let caption = match mk.as_ref().and_then(|v| v.get(b"CA")) {
                Some(v) => string(Some(&self.objects.resolve(v)?))?,
                None => String::new(),
            };
            let mark = caption
                .chars()
                .next()
                .filter(|v| "48Hlnu".contains(*v))
                .unwrap_or(if radio { 'l' } else { '4' });
            round = radio && mark == 'l';
            text = if push {
                caption
            } else if checked {
                mark.to_string()
            } else {
                String::new()
            };
        }
        let list = kind == b"/Ch" && flags & 131072 == 0;
        let mut choices = Vec::<(String, bool)>::new();
        if kind == b"/Ch" {
            let indices = inherited(&mut self.objects, annot, b"I")?;
            let indices = numbers(&mut self.objects, indices.as_ref())?;
            if let Some(Value::Array(options)) = inherited(&mut self.objects, annot, b"Opt")? {
                if options.len() > 4096 {
                    return None;
                }
                for option in options {
                    let option = self.objects.resolve(&option)?;
                    let (exported, label) = if let Value::Array(pair) = &option {
                        let exported = match pair.first() {
                            Some(v) => string(Some(&self.objects.resolve(v)?))?,
                            None => String::new(),
                        };
                        let label = match pair.get(1) {
                            Some(v) => string(Some(&self.objects.resolve(v)?))?,
                            None => exported.clone(),
                        };
                        (exported, label)
                    } else {
                        let value = string(Some(&option))?;
                        (value.clone(), value)
                    };
                    if values.first() == Some(&exported) {
                        text = label.clone();
                    }
                    let selected = if indices.is_empty() {
                        values.contains(&exported)
                    } else {
                        indices.contains(&(choices.len() as f64))
                    };
                    choices.push((label, selected));
                }
            }
        }
        self.objects.tokens = self
            .objects
            .tokens
            .checked_sub(characters + choices.len())?;
        if kind == b"/Tx" && flags & 8192 != 0 {
            text = "*".repeat(text.encode_utf16().count());
        }
        let multiline = kind == b"/Tx" && flags & 4096 != 0;
        text = text.replace("\r\n", "\n").replace('\r', "\n");
        if !multiline {
            text = text.replace('\n', " ");
        }
        let background = numbers(&mut self.objects, mk.as_ref().and_then(|v| v.get(b"BG")))?;
        let border_color = numbers(&mut self.objects, mk.as_ref().and_then(|v| v.get(b"BC")))?;
        let bs = match annot.get(b"BS") {
            Some(v) => Some(self.objects.resolve(v)?),
            None => None,
        };
        let old_border = match annot.get(b"Border") {
            Some(v) => Some(self.objects.resolve(v)?),
            None => None,
        };
        let old_items = match &old_border {
            Some(Value::Array(v)) => v.as_slice(),
            _ => &[],
        };
        let border_value = bs
            .as_ref()
            .and_then(|v| v.get(b"W"))
            .or_else(|| old_items.get(2));
        let border_width = match border_value {
            Some(v) => self.objects.resolve(v)?.number()?,
            None => 1.,
        };
        if !border_width.is_finite() || border_width.abs() > 1e6 {
            return None;
        }
        let style = match bs.as_ref().and_then(|v| v.get(b"S")) {
            Some(v) => Some(self.objects.resolve(v)?),
            None => None,
        };
        let style = style.as_ref().and_then(Value::word).unwrap_or(
            if bs.is_none() && old_items.get(3).is_some() {
                b"/D"
            } else {
                b"/S"
            },
        );
        let comb = kind == b"/Tx" && flags & 16777216 != 0 && flags & (4096 | 8192 | 1048576) == 0;
        let count = max_len
            .filter(|v| comb && v.is_finite() && v.fract() == 0. && *v > 0.)
            .unwrap_or(0.);
        if count > 65536. {
            return None;
        }
        self.objects.tokens = self.objects.tokens.checked_sub(count as usize)?;
        let relief = style == b"/B" || style == b"/I";
        let border = if relief {
            border_width.max(0.).min(w / 4.).min(h / 4.)
        } else if border_color.is_empty() {
            0.
        } else {
            border_width.max(0.)
        };
        let padding = border * if relief { 2. } else { 1. } + 1.;
        let available = (w - 2. * padding).max(0.);
        if button && !push {
            size = (available.min(h - 2. * padding) * 0.9).max(0.1);
        } else if size <= 0. {
            let units = win_ansi(&text)
                .into_iter()
                .map(|c| font.advance(c.into()))
                .sum::<f64>()
                / 1000.;
            size = 12f64
                .min((h - 2. * padding) / 1.2)
                .min(if !multiline && units > 0. {
                    available / units
                } else {
                    12.
                })
                .max(0.1);
        }
        if !size.is_finite() || size > 1e6 || !border.is_finite() {
            return None;
        }
        emit(
            Draw::BeginForm([x, y, x + w, y + h], matrix, None, None),
            &mut self.objects,
        )?;
        if !background.is_empty() {
            color(&mut self.objects, emit, matrix, &background, false)?;
            if round {
                circle(
                    &mut self.objects,
                    emit,
                    matrix,
                    w / 2.,
                    h / 2.,
                    w.min(h) / 2.,
                )?;
            } else {
                op(&mut self.objects, emit, matrix, b"re", &[x, y, w, h])?;
            }
            op(&mut self.objects, emit, matrix, b"f", &[])?;
        }
        if border > 0. && !border_color.is_empty() {
            color(&mut self.objects, emit, matrix, &border_color, true)?;
            op(&mut self.objects, emit, matrix, b"w", &[border])?;
            if style == b"/D" {
                let mut dash = numbers(
                    &mut self.objects,
                    bs.as_ref()
                        .and_then(|v| v.get(b"D"))
                        .or_else(|| old_items.get(3)),
                )?;
                if dash.is_empty() {
                    dash.push(3.);
                }
                if dash.iter().any(|v| *v < 0.) || dash.iter().all(|v| *v == 0.) {
                    return None;
                }
                let values = [
                    Value::Array(
                        dash.iter()
                            .map(|v| Value::Word(v.to_string().into_bytes().into()))
                            .collect(),
                    ),
                    Value::Word(b"0".as_slice().into()),
                ];
                emit(Draw::Operator(b"d", &values, matrix), &mut self.objects)?;
            }
            if round {
                circle(
                    &mut self.objects,
                    emit,
                    matrix,
                    w / 2.,
                    h / 2.,
                    (w.min(h) - border) / 2.,
                )?;
            } else if style == b"/U" {
                op(&mut self.objects, emit, matrix, b"m", &[x, y + border / 2.])?;
                op(
                    &mut self.objects,
                    emit,
                    matrix,
                    b"l",
                    &[x + w, y + border / 2.],
                )?;
            } else {
                op(
                    &mut self.objects,
                    emit,
                    matrix,
                    b"re",
                    &[
                        x + border / 2.,
                        y + border / 2.,
                        (w - border).max(0.),
                        (h - border).max(0.),
                    ],
                )?;
            }
            op(&mut self.objects, emit, matrix, b"S", &[])?;
        }
        if border > 0. && relief {
            // Match PDFium interactive-form shading, including its circular bevel profile.
            let bg = if background.is_empty() {
                &[1.][..]
            } else {
                background.as_slice()
            };
            let shades = if style == b"/I" {
                [vec![0.5], vec![0.75]]
            } else {
                [
                    vec![1.],
                    bg.iter()
                        .map(|v| if round { (v - 0.25).max(0.) } else { v / 2. })
                        .collect(),
                ]
            };
            let b = border;
            for (side, shade) in shades.iter().enumerate() {
                color(&mut self.objects, emit, matrix, shade, round)?;
                if round {
                    op(&mut self.objects, emit, matrix, b"w", &[b])?;
                    let r = (w.min(h) / 2. - 1.5 * b).max(0.);
                    let (cx, cy) = (x + w / 2., y + h / 2.);
                    let start = std::f64::consts::FRAC_PI_4 + side as f64 * std::f64::consts::PI;
                    op(
                        &mut self.objects,
                        emit,
                        matrix,
                        b"m",
                        &[cx + r * start.cos(), cy + r * start.sin()],
                    )?;
                    for j in 0..2 {
                        let a = start + j as f64 * std::f64::consts::FRAC_PI_2;
                        let z = a + std::f64::consts::FRAC_PI_2;
                        let k = 0.5523 * r;
                        op(
                            &mut self.objects,
                            emit,
                            matrix,
                            b"c",
                            &[
                                cx + r * a.cos() - k * a.sin(),
                                cy + r * a.sin() + k * a.cos(),
                                cx + r * z.cos() + k * z.sin(),
                                cy + r * z.sin() - k * z.cos(),
                                cx + r * z.cos(),
                                cy + r * z.sin(),
                            ],
                        )?;
                    }
                    op(&mut self.objects, emit, matrix, b"S", &[])?;
                } else {
                    let points = if side == 0 {
                        [
                            [b, b],
                            [b, h - b],
                            [w - b, h - b],
                            [w - 2. * b, h - 2. * b],
                            [2. * b, h - 2. * b],
                            [2. * b, 2. * b],
                        ]
                    } else {
                        [
                            [b, b],
                            [w - b, b],
                            [w - b, h - b],
                            [w - 2. * b, h - 2. * b],
                            [w - 2. * b, 2. * b],
                            [2. * b, 2. * b],
                        ]
                    };
                    for (i, [px, py]) in points.iter().enumerate() {
                        op(
                            &mut self.objects,
                            emit,
                            matrix,
                            if i == 0 { b"m" } else { b"l" },
                            &[x + px, y + py],
                        )?;
                    }
                    op(&mut self.objects, emit, matrix, b"f", &[])?;
                }
            }
        }
        if count > 0. && border > 0. && [b"/S".as_slice(), b"/D"].contains(&style) {
            for i in 1..count as usize {
                op(
                    &mut self.objects,
                    emit,
                    matrix,
                    b"m",
                    &[i as f64 * w / count, 0.],
                )?;
                op(
                    &mut self.objects,
                    emit,
                    matrix,
                    b"l",
                    &[i as f64 * w / count, h],
                )?;
                op(&mut self.objects, emit, matrix, b"S", &[])?;
            }
        }
        if push {
            let tp = match mk.as_ref().and_then(|v| v.get(b"TP")) {
                Some(v) => self.objects.resolve(v)?.number()?,
                None => 0.,
            };
            if !tp.is_finite() || tp.fract() != 0. || !(0. ..=6.).contains(&tp) {
                return None;
            }
            if tp != 0. {
                let icon = mk.as_ref().and_then(|v| v.get(b"I"));
                let fit = match mk.as_ref().and_then(|v| v.get(b"IF")) {
                    Some(v) => {
                        let v = self.objects.resolve(v)?;
                        if !matches!(v, Value::Dict(_)) {
                            return None;
                        }
                        Some(v)
                    }
                    None => None,
                };
                let sw = match fit.as_ref().and_then(|v| v.get(b"SW")) {
                    Some(v) => self.objects.resolve(v)?,
                    None => Value::Word(b"/A".as_slice().into()),
                };
                let scale = match fit.as_ref().and_then(|v| v.get(b"S")) {
                    Some(v) => self.objects.resolve(v)?,
                    None => Value::Word(b"/P".as_slice().into()),
                };
                let fb = match fit.as_ref().and_then(|v| v.get(b"FB")) {
                    Some(v) => self.objects.resolve(v)?,
                    None => Value::Word(b"false".as_slice().into()),
                };
                if !matches!(sw.word()?, b"/A" | b"/B" | b"/S" | b"/N")
                    || !matches!(scale.word()?, b"/P" | b"/A")
                    || !matches!(fb.word()?, b"true" | b"false")
                {
                    return None;
                }
                let alignment = match fit.as_ref().and_then(|v| v.get(b"A")) {
                    Some(v) => numbers(&mut self.objects, Some(v))?,
                    None => vec![0.5, 0.5],
                };
                if alignment.len() != 2 || alignment.iter().any(|v| !(0. ..=1.).contains(v)) {
                    return None;
                }
                let inset = if fb.word() == Some(b"true") {
                    0.
                } else {
                    border * if relief { 2. } else { 1. }
                };
                let (mut ix, mut iy, mut iw, mut ih) = (
                    inset,
                    inset,
                    (w - 2. * inset).max(0.),
                    (h - 2. * inset).max(0.),
                );
                let (mut tx, mut ty, mut tw, mut th) =
                    (padding, padding, available, (h - 2. * padding).max(0.));
                let caption_width = win_ansi(&text)
                    .iter()
                    .map(|c| font.advance((*c).into()) * size / 1000.)
                    .sum::<f64>();
                if icon.is_some() && !text.is_empty() {
                    if tp == 2. || tp == 3. {
                        let reserve = ih.min(size + 2.);
                        ih -= reserve;
                        if tp == 2. {
                            iy += reserve;
                            ty = inset;
                            th = reserve;
                        } else {
                            ty = h - inset - reserve;
                            th = reserve;
                        }
                    } else if tp == 4. || tp == 5. {
                        let reserve = iw.min(caption_width + 2.);
                        iw -= reserve;
                        if tp == 4. {
                            tx = w - inset - reserve;
                            tw = reserve;
                        } else {
                            ix += reserve;
                            tx = inset;
                            tw = reserve;
                        }
                    }
                }
                if let Some(icon) = icon {
                    let id = icon.reference()?;
                    let (dict, _) = self.objects.object(id)?;
                    if dict.get(b"Subtype")?.word() != Some(b"/Form") {
                        return None;
                    }
                    if let Some(res) = dict.get(b"Resources") {
                        if !matches!(self.objects.resolve(res)?, Value::Dict(_)) {
                            return None;
                        }
                    }
                    let bbox = numbers(&mut self.objects, dict.get(b"BBox"))?;
                    let m = match dict.get(b"Matrix") {
                        Some(v) => numbers(&mut self.objects, Some(v))?,
                        None => vec![1., 0., 0., 1., 0., 0.],
                    };
                    if bbox.len() != 4 || m.len() != 6 {
                        return None;
                    }
                    let corners = [
                        (bbox[0], bbox[1]),
                        (bbox[2], bbox[1]),
                        (bbox[0], bbox[3]),
                        (bbox[2], bbox[3]),
                    ]
                    .map(|(x, y)| [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
                    let min =
                        [0, 1].map(|i| corners.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min));
                    let max = [0, 1].map(|i| {
                        corners
                            .iter()
                            .map(|p| p[i])
                            .fold(f64::NEG_INFINITY, f64::max)
                    });
                    let (bw, bh) = (max[0] - min[0], max[1] - min[1]);
                    if ![min[0], min[1], bw, bh].iter().all(|v| v.is_finite()) {
                        return None;
                    }
                    if bw > 0. && bh > 0. && iw > 0. && ih > 0. {
                        let (mut sx, mut sy) = (iw / bw, ih / bh);
                        if scale.word() == Some(b"/P") {
                            sx = sx.min(sy);
                            sy = sx;
                        }
                        match sw.word()? {
                            b"/N" => {
                                sx = 1.;
                                sy = 1.;
                            }
                            b"/B" => {
                                sx = sx.min(1.);
                                sy = sy.min(1.);
                            }
                            b"/S" => {
                                sx = sx.max(1.);
                                sy = sy.max(1.);
                            }
                            _ => {}
                        }
                        let placement = [
                            sx,
                            0.,
                            0.,
                            sy,
                            ix + (iw - bw * sx) * alignment[0] - min[0] * sx,
                            iy + (ih - bh * sy) * alignment[1] - min[1] * sy,
                        ];
                        if placement.iter().any(|v| !v.is_finite()) {
                            return None;
                        }
                        emit(
                            Draw::BeginForm([ix, iy, ix + iw, iy + ih], matrix, None, None),
                            &mut self.objects,
                        )?;
                        let state = State {
                            ctm: concat(placement, matrix),
                            mode: 0,
                            font: None,
                            size: 12.,
                            leading: 0.,
                            rise: 0.,
                            spacing: 0.,
                            word: 0.,
                            hscale: 1.,
                        };
                        // Legacy Forms without Resources inherit the page resource context.
                        scopes.push(resources);
                        self.draw_form(id, state, scopes, None, emit)?;
                        scopes.pop();
                        emit(Draw::EndForm, &mut self.objects)?;
                    }
                }
                if tp != 1. && !text.is_empty() && tw > 0. && th > 0. {
                    op(&mut self.objects, emit, matrix, b"re", &[tx, ty, tw, th])?;
                    op(&mut self.objects, emit, matrix, b"W", &[])?;
                    op(&mut self.objects, emit, matrix, b"n", &[])?;
                    color(&mut self.objects, emit, matrix, &ink, false)?;
                    let mut at = tx + ((tw - caption_width) / 2.).max(0.);
                    let y = ty + (th - size * 0.6) / 2.;
                    for code in win_ansi(&text) {
                        let advance = font.advance(code.into()) * size / 1000.;
                        emit(
                            Draw::Glyph {
                                code: code.into(),
                                unicode: None,
                                family: &font.name,
                                program: &font.program,
                                bounds: [at, y - size * 0.2, at + advance, y + size * 0.8],
                                text_bounds: None,
                                size,
                                matrix: concat([size, 0., 0., size, at, y], matrix),
                                ctm: matrix,
                                mode: 0,
                            },
                            &mut self.objects,
                        )?;
                        at += advance;
                    }
                }
                emit(Draw::EndForm, &mut self.objects)?;
                return Some(true);
            }
        }
        op(
            &mut self.objects,
            emit,
            matrix,
            b"re",
            &[
                x + padding,
                y + padding,
                available,
                (h - 2. * padding).max(0.),
            ],
        )?;
        op(&mut self.objects, emit, matrix, b"W", &[])?;
        op(&mut self.objects, emit, matrix, b"n", &[])?;
        color(&mut self.objects, emit, matrix, &ink, false)?;
        if radio && text == "l" {
            circle(
                &mut self.objects,
                emit,
                matrix,
                w / 2.,
                h / 2.,
                available.min(h - 2. * padding).max(0.) / 4.,
            )?;
            op(&mut self.objects, emit, matrix, b"f", &[])?;
            emit(Draw::EndForm, &mut self.objects)?;
            return Some(true);
        }
        let mut lines = Vec::new();
        let top = inherited(&mut self.objects, annot, b"TI")?
            .as_ref()
            .and_then(Value::number)
            .unwrap_or(0.)
            .max(0.)
            .floor() as usize;
        if list {
            lines = choices
                .iter()
                .skip(top)
                .take(((h - 2. * padding) / (size * 1.2)).ceil().max(0.) as usize)
                .map(|(text, _)| win_ansi(text))
                .collect();
        }
        for paragraph in if list { "" } else { &text }.split('\n') {
            let bytes = win_ansi(paragraph);
            let mut remaining = bytes.as_slice();
            while multiline && !remaining.is_empty() {
                let (mut end, mut used, mut space) = (0, 0., None);
                while end < remaining.len() {
                    let next = font.advance(remaining[end].into()) * size / 1000.;
                    if end > 0 && used + next > available {
                        break;
                    }
                    used += next;
                    if remaining[end] == b' ' {
                        space = Some(end);
                    }
                    end += 1;
                }
                if end == remaining.len() {
                    break;
                }
                if let Some(last) = space.filter(|v| *v > 0) {
                    end = last;
                }
                lines.push(remaining[..end].to_vec());
                remaining = &remaining[end + usize::from(remaining[end] == b' ')..];
            }
            if !list {
                lines.push(remaining.to_vec());
            }
        }
        let baseline = y + if multiline || list {
            h - padding - size * 0.8
        } else {
            (h - size * 0.6) / 2.
        };
        for (i, line) in lines.iter().enumerate() {
            if list {
                if choices[top + i].1 {
                    color(
                        &mut self.objects,
                        emit,
                        matrix,
                        &[0., 0.2, 113. / 255.],
                        false,
                    )?;
                    op(
                        &mut self.objects,
                        emit,
                        matrix,
                        b"re",
                        &[
                            padding,
                            h - padding - (i + 1) as f64 * size * 1.2,
                            available,
                            size * 1.2,
                        ],
                    )?;
                    op(&mut self.objects, emit, matrix, b"f", &[])?;
                    color(&mut self.objects, emit, matrix, &[1.], false)?;
                } else {
                    color(&mut self.objects, emit, matrix, &ink, false)?;
                }
            }
            let width = line
                .iter()
                .map(|c| font.advance((*c).into()) * size / 1000.)
                .sum::<f64>();
            let left = if list {
                padding
            } else if align == 1. {
                (w - width) / 2.
            } else if align == 2. {
                w - padding - width
            } else {
                padding
            };
            let mut at = x + left.max(padding);
            let y = baseline - i as f64 * size * 1.2;
            for (j, &code) in line.iter().enumerate() {
                let advance = font.advance(code.into()) * size / 1000.;
                if count > 0. {
                    if j as f64 >= count.floor() {
                        break;
                    }
                    let cell = w / count;
                    let unused = count - (line.len() as f64).min(count);
                    let offset = if align == 2. {
                        unused
                    } else if align == 1. {
                        (unused / 2.).floor()
                    } else {
                        0.
                    };
                    at = x + (j as f64 + offset) * cell + (cell - advance) / 2.;
                }
                emit(
                    Draw::Glyph {
                        code: code.into(),
                        unicode: None,
                        family: &font.name,
                        program: &font.program,
                        bounds: [at, y - size * 0.2, at + advance, y + size * 0.8],
                        text_bounds: None,
                        size,
                        matrix: concat([size, 0., 0., size, at, y], matrix),
                        ctm: matrix,
                        mode: 0,
                    },
                    &mut self.objects,
                )?;
                at += advance;
            }
        }
        emit(Draw::EndForm, &mut self.objects)?;
        Some(true)
    }
}
