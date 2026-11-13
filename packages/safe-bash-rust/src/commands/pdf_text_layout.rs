use super::pdf_blend::BlendMode;
// Position text using PDF text and graphics matrices (PDF 32000-1 §9).
use super::super::{Cursor, text};
use super::{PageSource, Value, pdf_bitmap::ImageStream};
use std::{collections::BTreeMap, rc::Rc};
#[path = "pdf_font_widths.rs"]
pub(in super::super) mod widths;

use super::{ID, Matrix, concat};
fn shift(m: &mut Matrix, x: f64, y: f64) {
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
}
pub(in crate::commands::archive) struct TextLine {
    pub text: String,
    pub family: Rc<str>,
    pub size: f64,
    pub bounds: [f64; 4],
    baseline: f64,
}
pub(super) enum Program {
    Standard,
    TrueType(Vec<u8>),
    CidTrueType { bytes: Vec<u8>, map: Option<Vec<u8>> },
    Unsupported,
}
struct Font {
    program: Program,
    name: Rc<str>,
    start: usize,
    widths: Vec<f64>,
    cid_widths: Option<(BTreeMap<u16, f64>, f64)>,
}
impl Font {
    fn advance(&self, b: u16) -> f64 {
        if let Some((widths, default)) = &self.cid_widths {
            return widths.get(&b).copied().unwrap_or(*default);
        }
        if let Some(width) = (b as usize)
            .checked_sub(self.start)
            .and_then(|i| self.widths.get(i))
        {
            return *width;
        }
        let row = match &*self.name {
            "Helvetica" | "Helvetica-Oblique" => 0,
            "Helvetica-Bold" | "Helvetica-BoldOblique" => 1,
            "Times-Roman" => 2,
            "Times-Bold" => 3,
            "Times-Italic" => 4,
            "Times-BoldItalic" => 5,
            "Symbol" => 6,
            "ZapfDingbats" => 7,
            s if s.starts_with("Courier") => return 600.,
            _ => return 500.,
        };
        f64::from(widths::WIDTHS[row][usize::from(b)])
    }
}
// Identity-H codes and CID width keys are unsigned 16-bit integers.
fn cid_number(value: &Value<'_>) -> Option<u16> {
    let n = value.number()?;
    (n.is_finite() && (0. ..=65535.).contains(&n) && n.fract() == 0.).then_some(n as u16)
}
#[derive(Clone)]
struct State {
    mode: i32,
    ctm: Matrix,
    font: Option<Rc<Font>>,
    size: f64,
    leading: f64,
    rise: f64,
    spacing: f64,
    word: f64,
    hscale: f64,
}
#[derive(Default)]
struct Resources<'a> {
    form: Option<super::ObjectId>,
    fonts: BTreeMap<std::borrow::Cow<'a, [u8]>, Rc<Font>>,
    graphics: BTreeMap<std::borrow::Cow<'a, [u8]>, Value<'a>>,
    shadings: BTreeMap<std::borrow::Cow<'a, [u8]>, Value<'a>>,
    xobjects: BTreeMap<std::borrow::Cow<'a, [u8]>, super::ObjectId>,
}
pub(super) enum Draw<'a, 'b> {
    BeginForm([f64; 4], Matrix, Option<Value<'static>>),
    EndForm,
    Transparency { fill: Option<f64>, stroke: Option<f64>, blend: Option<BlendMode> },
    Shading(Value<'static>, Matrix),
    Image(ImageStream<'a>, Matrix),
    Operator(&'a [u8], &'a [Value<'b>], Matrix),
    Glyph {
        code: u16,
        family: &'a Rc<str>,
        program: &'a Program,
        bounds: [f64; 4],
        baseline: f64,
        size: f64,
        matrix: Matrix,
        ctm: Matrix,
        mode: i32,
    },
}
impl<'a> Resources<'a> {
    fn load(&mut self, objects: &mut super::Objects<'a>, res: &Value<'a>) -> Option<()> {
        let res = objects.resolve(res)?;
        if let Some(value) = res.get(b"Shading") {
            let Value::Dict(entries) = objects.resolve(value)? else { return None; };
            self.shadings.extend(entries);
        }
        if let Some(value) = res.get(b"ExtGState") {
            let Value::Dict(entries) = objects.resolve(value)? else { return None; };
            self.graphics.extend(entries);
        }
        if let Some(Value::Dict(entries)) = res.get(b"XObject").and_then(|v| objects.resolve(v)) {
            self.xobjects.extend(
                entries
                    .into_iter()
                    .filter_map(|(k, v)| Some((k, v.reference()?))),
            );
        }
        if let Some(Value::Dict(entries)) = res.get(b"Font").and_then(|v| objects.resolve(v)) {
            for (key, v) in entries {
                let dict = objects.resolve(&v)?;
                let family = dict
                    .get(b"BaseFont")
                    .and_then(Value::word)
                    .and_then(|w| w.strip_prefix(b"/"))
                    .unwrap_or(&key);
                if dict.get(b"Subtype").and_then(Value::word) == Some(b"/Type0") {
                    let mut font = Font {
                        program: Program::Unsupported,
                        name: Rc::from(String::from_utf8_lossy(family).as_ref()),
                        start: 0,
                        widths: vec![],
                        cid_widths: None,
                    };
                    if dict.get(b"Encoding").and_then(|v| objects.resolve(v)).as_ref().and_then(Value::word) == Some(b"/Identity-H") {
                        let Value::Array(descendants) = objects.resolve(dict.get(b"DescendantFonts")?)? else { return None; };
                        if descendants.len() != 1 { return None; }
                        let cid = objects.resolve(&descendants[0])?;
                        if cid.get(b"Subtype").and_then(Value::word) == Some(b"/CIDFontType2") {
                            let descriptor = objects.resolve(cid.get(b"FontDescriptor")?)?;
                            let bytes = objects.decoded_stream(descriptor.get(b"FontFile2")?.reference()?)?.into_owned();
                            let map = match cid.get(b"CIDToGIDMap") {
                                None => None,
                                Some(v) if objects.resolve(v)?.word() == Some(b"/Identity") => None,
                                Some(_) => {
                                    let bytes = objects.decoded_stream(cid.get(b"CIDToGIDMap")?.reference()?)?.into_owned();
                                    if bytes.len() > 65536 * 2 || bytes.len() % 2 != 0 { return None; }
                                    Some(bytes)
                                }
                            };
                            let default = match cid.get(b"DW") {
                                Some(v) => objects.resolve(v)?.number()?,
                                None => 1000.,
                            };
                            if !default.is_finite() { return None; }
                            let mut widths = BTreeMap::new();
                            if let Some(v) = cid.get(b"W") {
                                let Value::Array(values) = objects.resolve(v)? else { return None; };
                                let mut values = values.iter();
                                while let Some(first) = values.next() {
                                    let first = cid_number(&objects.resolve(first)?)?;
                                    let next = objects.resolve(values.next()?)?;
                                    match next {
                                        Value::Array(entries) => {
                                            if usize::from(first) + entries.len() > 65536 { return None; }
                                            objects.tokens = objects.tokens.checked_sub(entries.len())?;
                                            for (i, value) in entries.iter().enumerate() {
                                                let width = objects.resolve(value)?.number()?;
                                                if !width.is_finite() { return None; }
                                                widths.insert(first + i as u16, width);
                                            }
                                        }
                                        last => {
                                            let last = cid_number(&last)?;
                                            let count = usize::from(last.checked_sub(first)?) + 1;
                                            objects.tokens = objects.tokens.checked_sub(count)?;
                                            let width = objects.resolve(values.next()?)?.number()?;
                                            if !width.is_finite() { return None; }
                                            for code in first..=last { widths.insert(code, width); }
                                        }
                                    }
                                }
                            }
                            font.program = Program::CidTrueType { bytes, map };
                            font.cid_widths = Some((widths, default));
                        }
                    }
                    self.fonts.insert(key, Rc::new(font));
                    continue;
                }
                let start = dict.get(b"FirstChar").and_then(Value::number).unwrap_or(0.) as usize;
                let widths = match dict.get(b"Widths").and_then(|w| objects.resolve(w)) {
                    Some(Value::Array(a)) => {
                        a.iter().map(Value::number).collect::<Option<Vec<_>>>()?
                    }
                    _ => vec![],
                };
                let descriptor = match dict.get(b"FontDescriptor") {
                    Some(value) => Some(objects.resolve(value)?),
                    None => None,
                };
                let program = if let Some(file) = descriptor.as_ref().and_then(|d| d.get(b"FontFile2")) {
                    if dict.get(b"Subtype").and_then(Value::word) == Some(b"/TrueType")
                        && dict.get(b"Encoding").and_then(|v| objects.resolve(v)).as_ref().and_then(Value::word) == Some(b"/WinAnsiEncoding")
                    {
                        Program::TrueType(objects.decoded_stream(file.reference()?)?.into_owned())
                    } else {
                        Program::Unsupported
                    }
                } else if matches!(dict.get(b"Subtype").and_then(Value::word), Some(b"/Type0" | b"/TrueType"))
                    || descriptor.as_ref().is_some_and(|d| d.get(b"FontFile").is_some() || d.get(b"FontFile3").is_some())
                {
                    Program::Unsupported
                } else {
                    Program::Standard
                };
                let name = Rc::from(String::from_utf8_lossy(family).as_ref());
                self.fonts.insert(
                    key,
                    Rc::new(Font {
                        program,
                        name,
                        start,
                        widths,
                        cid_widths: None,
                    }),
                );
            }
        }
        Some(())
    }
}
impl<'a> PageSource<'a> {
    pub(super) fn draw_page(
        &mut self,
        page: &Value<'a>,
        mut emit: impl FnMut(Draw<'_, '_>, &mut super::Objects<'a>) -> Option<()>,
    ) -> Option<()> {
        let mut node = page;
        let mut resources = Resources::default();
        for _ in 0..128 {
            if let Some(res) = node.get(b"Resources") {
                resources.load(&mut self.objects, res)?;
                break;
            }
            let Some(parent) = node
                .get(b"Parent")
                .and_then(Value::reference)
                .and_then(|p| self.tree.get(&p))
                .and_then(Option::as_ref)
            else {
                break;
            };
            node = parent;
        }
        let streams = match page.get(b"Contents") {
            None => return Some(()),
            Some(Value::Ref(r)) => vec![*r],
            Some(Value::Array(a)) => a.iter().map(Value::reference).collect::<Option<Vec<_>>>()?,
            _ => return None,
        };
        let st = State {
            mode: 0,
            ctm: ID,
            font: None,
            size: 12.,
            leading: 0.,
            rise: 0.,
            spacing: 0.,
            word: 0.,
            hscale: 1.,
        };
        self.draw_streams(&streams, st, &mut vec![resources], &mut emit)
    }

    fn draw_streams(
        &mut self,
        streams: &[super::ObjectId],
        mut st: State,
        scopes: &mut Vec<Resources<'a>>,
        emit: &mut impl FnMut(Draw<'_, '_>, &mut super::Objects<'a>) -> Option<()>,
    ) -> Option<()> {
        let default_font = Font {
            program: Program::Standard,
            name: Rc::from("Helvetica"),
            start: 0,
            widths: vec![],
            cid_widths: None,
        };
        let (mut tm, mut lm) = (ID, ID);
        let mut stack = Vec::new();
        let mut in_text = false;
        for &id in streams {
            let bytes = self.objects.decoded_stream(id)?;
            let mut c = Cursor(&bytes);
            let mut args = Vec::new();
            loop {
                c.skip();
                if c.0.is_empty() {
                    break;
                }
                let v = c.value(0, &mut self.objects.tokens, false)?;
                let op = match v.word() {
                    Some(op) if !op.starts_with(b"/") && v.number().is_none() => op,
                    _ => {
                        if args.len() >= 64 {
                            return None;
                        }
                        args.push(v);
                        continue;
                    }
                };
                let num = |i: usize| args.get(i)?.poppler_number();
                emit(Draw::Operator(op, &args, st.ctm), &mut self.objects)?;
                if op == b"sh" {
                    if args.len() != 1 { return None; }
                    let name = args[0].word()?.strip_prefix(b"/")?;
                    let value = scopes.iter().rev().find_map(|scope| scope.shadings.get(name))?;
                    emit(Draw::Shading(value.clone().into_owned(), st.ctm), &mut self.objects)?;
                }
                if op == b"gs" {
                    if args.len() != 1 { return None; }
                    let name = args[0].word()?.strip_prefix(b"/")?;
                    let value = scopes.iter().rev().find_map(|scope| scope.graphics.get(name))?;
                    let dict = self.objects.resolve(value)?;
                    if !matches!(dict, Value::Dict(_)) { return None; }
                    let mut alpha = |key: &[u8]| -> Option<Option<f64>> {
                        let Some(value) = dict.get(key) else { return Some(None); };
                        let n = self.objects.resolve(value)?.number()?;
                        if !n.is_finite() || !(0. ..=1.).contains(&n) { return None; }
                        Some(Some(n))
                    };
                    let fill = alpha(b"ca")?;
                    let stroke = alpha(b"CA")?;
                    let blend = if let Some(value) = dict.get(b"BM") {
                        let value = self.objects.resolve(value)?;
                        let candidates = match &value { Value::Array(items) => items.as_slice(), _ => std::slice::from_ref(&value) };
                        let mut selected = None;
                        for candidate in candidates {
                            let candidate = self.objects.resolve(candidate)?;
                            let name = candidate.word()?.strip_prefix(b"/")?;
                            if let Some(mode) = BlendMode::read(name) { selected = Some(mode); break; }
                        }
                        Some(selected?)
                    } else { None };
                    emit(Draw::Transparency { fill, stroke, blend }, &mut self.objects)?;
                }
                if op == b"BI" {
                    let (fields, pixels) = super::pdf_content_edit::inline(&mut c, &mut self.objects.tokens).ok()?;
                    let dict = super::pdf_externalize::image_dict(&fields);
                    emit(Draw::Image(ImageStream::Inline(dict, pixels), st.ctm), &mut self.objects)?;
                }
                if op == b"Do"
                    && let Some(id) = args
                        .last()
                        .and_then(Value::word)
                        .and_then(|n| n.strip_prefix(b"/"))
                        .and_then(|n| {
                            scopes
                                .iter()
                                .rev()
                                .find_map(|scope| scope.xobjects.get(n))
                                .copied()
                        })
                {
                    let (dict, _) = self.objects.object(id)?;
                    if dict.get(b"Subtype").and_then(Value::word) == Some(b"/Form") {
                        if scopes.len() <= 100
                            && !scopes.iter().any(|scope| scope.form == Some(id))
                            && let Some(Value::Array(bounds)) =
                                dict.get(b"BBox").and_then(|v| self.objects.resolve(v))
                            && let [x0, y0, x1, y1, ..] = bounds.as_slice()
                        {
                            let bbox = [x0.poppler_number()?, y0.poppler_number()?, x1.poppler_number()?, y1.poppler_number()?];
                            let mut child = st.clone();
                            if let Some(Value::Array(values)) =
                                dict.get(b"Matrix").and_then(|v| self.objects.resolve(v))
                            {
                                let m = std::array::from_fn(|i| {
                                    values.get(i).and_then(Value::poppler_number).unwrap_or(0.)
                                });
                                child.ctm = concat(m, st.ctm);
                            }
                            let mut local = Resources {
                                form: Some(id),
                                ..Resources::default()
                            };
                            if let Some(res) = dict.get(b"Resources") {
                                local.load(&mut self.objects, res)?;
                            }
                            scopes.push(local);
                            let group = dict.get(b"Group").map(|v| v.clone().into_owned());
                            emit(Draw::BeginForm(bbox, child.ctm, group), &mut self.objects)?;
                            self.draw_streams(&[id], child, scopes, emit)?;
                            emit(Draw::EndForm, &mut self.objects)?;
                            scopes.pop();
                        }
                    } else {
                        emit(Draw::Image(ImageStream::Object(id), st.ctm), &mut self.objects)?;
                    }
                }
                match op {
                    b"q" => {
                        if stack.len() >= 256 {
                            return None;
                        }
                        stack.push(st.clone());
                    }
                    b"Q" => {
                        if let Some(s) = stack.pop() {
                            st = s;
                        }
                    }
                    b"BT" => {
                        in_text = true;
                        tm = ID;
                        lm = ID;
                    }
                    b"ET" => in_text = false,
                    b"cm" | b"Tm" => {
                        let m = [num(0)?, num(1)?, num(2)?, num(3)?, num(4)?, num(5)?];
                        if op == b"cm" {
                            st.ctm = concat(m, st.ctm);
                        } else {
                            lm = m;
                            tm = m;
                        }
                    }
                    b"Tf" => {
                        let key = args.first()?.word()?.strip_prefix(b"/")?;
                        st.font = scopes
                            .iter()
                            .rev()
                            .find_map(|scope| scope.fonts.get(key))
                            .cloned();
                        st.size = num(1)?;
                    }
                    b"Tr" => st.mode = num(0)? as i32,
                    b"TL" => st.leading = num(0)?,
                    b"Ts" => st.rise = num(0)?,
                    b"Tz" => st.hscale = num(0)? / 100.,
                    b"Tc" => st.spacing = num(0)?,
                    b"Tw" => st.word = num(0)?,
                    b"Td" | b"TD" => {
                        let y = num(1)?;
                        if op == b"TD" {
                            st.leading = -y;
                        }
                        shift(&mut lm, num(0)?, y);
                        tm = lm;
                    }
                    b"T*" => {
                        shift(&mut lm, 0., -st.leading);
                        tm = lm;
                    }
                    b"TJ" | b"Tj" | b"'" | b"\"" if in_text => {
                        if op == b"\"" {
                            st.word = num(0)?;
                            st.spacing = num(1)?;
                        }
                        if matches!(op, b"'" | b"\"") {
                            shift(&mut lm, 0., -st.leading);
                            tm = lm;
                        }
                        let items = match args.last()? {
                            Value::Array(a) => a,
                            _ => &args[args.len() - 1..],
                        };
                        let font = st.font.as_deref().unwrap_or(&default_font);
                        for item in items {
                            if let Some(k) = item.number() {
                                shift(&mut tm, -k * st.size * st.hscale / 1000., 0.);
                                continue;
                            }
                            let Value::String { bytes: raw, .. } = item else {
                                continue;
                            };
                            let composite = matches!(font.program, Program::CidTrueType { .. });
                            let length = if composite { 2 } else { 1 };
                            if raw.len() % length != 0 { return None; }
                            for bytes in raw.chunks_exact(length) {
                                let b = if composite { u16::from_be_bytes([bytes[0], bytes[1]]) } else { u16::from(bytes[0]) };
                                let m = concat(tm, st.ctm);
                                let scale = m[0].hypot(m[1]);
                                let size = st.size * scale;
                                let x = m[4];
                                let y = m[5] + st.rise;
                                let advance = font.advance(b) * st.size / 1000.;
                                let dx =
                                    (advance + st.spacing + if !composite && b == 32 { st.word } else { 0. })
                                        * st.hscale;
                                shift(&mut tm, dx, 0.);
                                let right = x + scale * dx.abs().max(advance);
                                let matrix =
                                    concat([st.size * st.hscale, 0., 0., st.size, 0., st.rise], m);
                                emit(
                                    Draw::Glyph {
                                        code: b,
                                        family: &font.name,
                                        program: &font.program,
                                        size,
                                        bounds: [x, y - size * 0.2, right, y + size * 0.8],
                                        baseline: y,
                                        matrix,
                                        ctm: st.ctm,
                                        mode: st.mode,
                                    },
                                    &mut self.objects,
                                )?;
                            }
                        }
                    }
                    _ => {}
                }
                args.clear();
            }
        }
        Some(())
    }
    pub(in crate::commands::archive) fn plain_text(
        &mut self,
        pno: usize,
        spacing: Option<f64>,
        page_width: f64,
        rejoin: bool,
    ) -> Option<String> {
        let mut lines = self.text_lines(pno, spacing)?;
        let midpoint = page_width * 0.5;
        let column = |line: &TextLine| {
            if line.bounds[2] <= midpoint + 18. {
                0
            } else if line.bounds[0] >= midpoint - 18. {
                1
            } else {
                2
            }
        };
        if spacing.is_some() && lines.len() > 2 {
            let mut present = [false; 3];
            for line in &lines {
                present[column(line)] = true;
            }
            if present == [true, true, false] {
                lines.sort_by(|a, b| {
                    column(a)
                        .cmp(&column(b))
                        .then(b.baseline.total_cmp(&a.baseline))
                });
            }
        }
        let mut out = String::new();
        let paragraph = |l: &TextLine| {
            l.size < 15.
                && !l.text.starts_with('•')
                && !["- ", "* ", "-\t", "*\t"]
                    .iter()
                    .any(|s| l.text.starts_with(s))
        };
        for (i, line) in lines.iter().enumerate() {
            if let Some(prev) = i.checked_sub(1).map(|j| &lines[j]) {
                let gap = prev.baseline - line.baseline;
                if !(paragraph(prev)
                    && paragraph(line)
                    && gap > 0.
                    && gap <= prev.size * 1.9
                    && (line.bounds[0] - prev.bounds[0]).abs() < prev.size * 5.)
                {
                    out.push_str("\n\n");
                } else if rejoin
                    && out.ends_with('-')
                    && line
                        .text
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_lowercase)
                {
                    out.pop();
                } else {
                    out.push('\n');
                }
            }
            out.push_str(&line.text);
        }
        Some(out)
    }

    pub(in crate::commands::archive) fn text_lines(
        &mut self,
        pno: usize,
        spacing: Option<f64>,
    ) -> Option<Vec<TextLine>> {
        let page = self
            .objects
            .page_dict(*self.pages.get(pno.checked_sub(1)?)?, &self.tree)?;
        let mut runs: Vec<TextLine> = vec![];
        let mut space = false;
        self.draw_page(&page, |event, _| {
            if let Draw::Glyph {
                code,
                program,
                family,
                size,
                bounds,
                baseline: y,
                ..
            } = event
            {
                // CID glyph IDs are not Unicode; extraction needs a ToUnicode CMap.
                if matches!(program, Program::CidTrueType { .. }) { return None; }
                let b = u8::try_from(code).ok()?;
                if matches!(b, b' ' | b'\t') {
                    space = true;
                    return Some(());
                }
                let [x, bottom, right, top] = bounds;
                if let Some(run) = runs.last_mut()
                    && (run.baseline - y).abs() < 1e-6
                    && x >= run.bounds[0]
                    && x - run.bounds[2] <= size * 0.22
                    && !space
                {
                    run.text.push_str(&text(&[b]));
                    run.bounds[2] = run.bounds[2].max(right);
                    run.bounds[1] = run.bounds[1].min(bottom);
                    run.bounds[3] = run.bounds[3].max(top);
                } else {
                    if runs.len() >= 100_000 {
                        return None;
                    }
                    runs.push(TextLine {
                        text: text(&[b]),
                        family: Rc::clone(family),
                        size,
                        bounds: [x, bottom, right, top],
                        baseline: y,
                    });
                }
                space = false;
            }
            Some(())
        })?;
        if spacing.is_some() {
            runs.sort_by(|a, b| {
                b.baseline
                    .total_cmp(&a.baseline)
                    .then(a.bounds[0].total_cmp(&b.bounds[0]))
            });
        }
        let mut lines: Vec<TextLine> = vec![];
        for run in runs {
            if let Some(last) = lines.last_mut()
                && (run.baseline - last.baseline).abs() <= run.size.max(last.size) * 0.45
                && spacing.is_none_or(|s| {
                    run.bounds[0] - last.bounds[2] <= run.size.max(last.size) * 4. * (s / 0.7)
                })
            {
                last.text.push(' ');
                last.text.push_str(&run.text);
                for i in 0..4 {
                    last.bounds[i] = if i < 2 {
                        run.bounds[i].min(last.bounds[i])
                    } else {
                        run.bounds[i].max(last.bounds[i])
                    };
                }
            } else {
                lines.push(run);
            }
        }
        Some(lines)
    }
}
