use super::pdf_blend::BlendMode;
// Position text using PDF text and graphics matrices (PDF 32000-1 §9).
use super::super::{Cursor, text};
use super::{PageSource, Value, pdf_bitmap::ImageStream};
use std::{collections::BTreeMap, rc::Rc};
#[path = "pdf_font_widths.rs"]
pub(in super::super) mod widths;

use super::{ID, Matrix, concat};
#[path = "pdf_soft_mask.rs"]
mod pdf_soft_mask;
#[path = "pdf_markup.rs"]
mod pdf_markup;
#[path = "pdf_widget.rs"]
mod pdf_widget;
use super::Objects;
#[path = "pdf_unicode.rs"]
mod pdf_unicode;
#[cfg(test)]
#[path = "pdf_font_cache_tests.rs"]
mod font_cache_tests;
pub(super) use pdf_soft_mask::SoftMask;
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
    direction: [f64; 2],
    along: [f64; 2],
}
pub(super) enum Program {
    Standard,
    TrueType(Vec<u8>),
    CidTrueType { bytes: Vec<u8>, map: Option<Vec<u8>> },
    Unsupported,
}
pub(super) struct Font {
    metrics: [f64; 2],
    extractable: bool,
    program: Program,
    name: Rc<str>,
    start: usize,
    widths: Vec<f64>,
    cid_widths: Option<(BTreeMap<u16, f64>, f64)>,
    unicode: Option<BTreeMap<u16, String>>,
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
    colors: Option<Value<'a>>,
    fonts: BTreeMap<std::borrow::Cow<'a, [u8]>, Rc<Font>>,
    graphics: BTreeMap<std::borrow::Cow<'a, [u8]>, Value<'a>>,
    shadings: BTreeMap<std::borrow::Cow<'a, [u8]>, Value<'a>>,
    xobjects: BTreeMap<std::borrow::Cow<'a, [u8]>, super::ObjectId>,
}
pub(super) enum Draw<'a, 'b> {
    BeginForm([f64; 4], Matrix, Option<Value<'static>>, Option<SoftMask>),
    ClearMask,
    EndForm,
    Transparency { fill: Option<f64>, stroke: Option<f64>, blend: Option<BlendMode> },
    Shading(Value<'static>, Matrix),
    Image(ImageStream<'a>, Matrix, Option<&'a Value<'b>>),
    Operator(&'a [u8], &'a [Value<'b>], Matrix),
    Glyph {
        code: u16,
        unicode: Option<&'a str>,
        family: &'a Rc<str>,
        program: &'a Program,
        bounds: [f64; 4],
        text_bounds: Option<[f64; 4]>,
        size: f64,
        matrix: Matrix,
        ctm: Matrix,
        mode: i32,
    },
}
impl<'a> Resources<'a> {
    fn load(&mut self, objects: &mut super::Objects<'a>, res: &Value<'a>, fonts: &mut BTreeMap<super::ObjectId, Rc<Font>>) -> Option<()> {
        let res = objects.resolve(res)?;
        if let Some(value) = res.get(b"ColorSpace") {
            self.colors = Some(value.clone());
        }
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
                let id=v.reference();
                if let Some(font)=id.and_then(|id|fonts.get(&id)) {
                    self.fonts.insert(key,Rc::clone(font));
                    continue;
                }
                let dict = objects.resolve(&v)?;
                let family = dict
                    .get(b"BaseFont")
                    .and_then(Value::word)
                    .and_then(|w| w.strip_prefix(b"/"))
                    .unwrap_or(&key);
                // Font programs/maps are already charged by their decoders. Reserve
                // the retained font/name and identity-cache entry before allocation.
                objects.remaining_bytes=objects.remaining_bytes.checked_sub(
                    std::mem::size_of::<Font>().checked_add(family.len())?.checked_add(96)?
                )?;
                if dict.get(b"Subtype").and_then(Value::word) == Some(b"/Type0") {
                    let mut font = Font {
                        metrics: [-0.207, 0.718],
                        extractable: false,
                        program: Program::Unsupported,
                        name: Rc::from(String::from_utf8_lossy(family).as_ref()),
                        start: 0,
                        widths: vec![],
                        cid_widths: None,
                        unicode: None,
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
                                            objects.remaining_bytes=objects.remaining_bytes.checked_sub(entries.len().checked_mul(64)?)?;
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
                                            objects.remaining_bytes=objects.remaining_bytes.checked_sub(count.checked_mul(64)?)?;
                                            let width = objects.resolve(values.next()?)?.number()?;
                                            if !width.is_finite() { return None; }
                                            for code in first..=last { widths.insert(code, width); }
                                        }
                                    }
                                }
                            }
                            font.program = Program::CidTrueType { bytes, map };
                            font.cid_widths = Some((widths, default));
                            font.unicode = dict.get(b"ToUnicode").and_then(Value::reference)
                                .and_then(|id| objects.decoded_stream(id))
                                .and_then(|bytes| pdf_unicode::read(&bytes, &mut objects.tokens, &mut objects.remaining_bytes));
                            font.extractable = font.unicode.is_some();
                            for (i,key) in [b"Descent".as_slice(),b"Ascent".as_slice()].into_iter().enumerate() {
                                if let Some(n)=descriptor.get(key).and_then(|v|objects.resolve(v)).and_then(|v|v.number())
                                    && n.is_finite() && n!=0. {
                                    font.metrics[i]=n.abs()/1000.*if i==0 {-1.}else{1.};
                                }
                            }
                        }
                    }
                    let font=Rc::new(font);
                    if let Some(id)=id {fonts.insert(id,Rc::clone(&font));}
                    self.fonts.insert(key, font);
                    continue;
                }
                let start = dict.get(b"FirstChar").and_then(Value::number).unwrap_or(0.) as usize;
                let widths = match dict.get(b"Widths").and_then(|w| objects.resolve(w)) {
                    Some(Value::Array(a)) => {
                        objects.remaining_bytes=objects.remaining_bytes.checked_sub(a.len().checked_mul(std::mem::size_of::<f64>())?)?;
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
                let mut metrics = match family {
                    b"Times-Roman" | b"Times-Bold" | b"Times-Italic" | b"Times-BoldItalic" => [-0.217, 0.683],
                    b"Courier" | b"Courier-Bold" | b"Courier-Oblique" | b"Courier-BoldOblique" => [-0.157, 0.629],
                    b"Symbol" => [-0.216, 0.693], b"ZapfDingbats" => [-0.143, 0.690],
                    _ => [-0.207, 0.718],
                };
                for (i, key) in [b"Descent".as_slice(), b"Ascent"].into_iter().enumerate() {
                    if let Some(value) = descriptor.as_ref().and_then(|d| d.get(key)).and_then(|v| objects.resolve(v)).and_then(|v| v.number())
                        && value.is_finite() && value != 0. {
                        metrics[i] = value.abs()/1000. * if i == 0 {-1.}else{1.};
                    }
                }
                let encoding = dict.get(b"Encoding").and_then(|v| objects.resolve(v));
                let extractable = dict.get(b"ToUnicode").is_none()
                    && encoding.as_ref().is_none_or(|v| v.word() == Some(b"/WinAnsiEncoding"))
                    && !matches!(family, b"Symbol" | b"ZapfDingbats");
                let name = Rc::from(String::from_utf8_lossy(family).as_ref());
                let font=Rc::new(Font {
                        metrics,
                        extractable,
                        program,
                        name,
                        start,
                        widths,
                        cid_widths: None,
                        unicode: None,
                    });
                if let Some(id)=id {fonts.insert(id,Rc::clone(&font));}
                self.fonts.insert(key,font);
            }
        }
        Some(())
    }
}
impl<'a> PageSource<'a> {
    pub(super) fn draw_page(
        &mut self,
        page: &Value<'a>,
        annotations: bool,
        mut emit: impl FnMut(Draw<'_, '_>, &mut super::Objects<'a>) -> Option<()>,
    ) -> Option<()> {
        let mut node = page;
        let mut resources = Resources::default();
        for _ in 0..128 {
            if let Some(res) = node.get(b"Resources") {
                resources.load(&mut self.objects, res, &mut self.fonts)?;
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
            None => vec![],
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
        let mut scopes = vec![resources];
        emit(Draw::Operator(b"q", &[], ID), &mut self.objects)?;
        self.draw_streams(&streams, st.clone(), &mut scopes, &mut emit)?;
        emit(Draw::Operator(b"Q", &[], ID), &mut self.objects)?;
        if annotations {
            self.draw_annotations(page, st, &mut scopes, &mut emit)?;
        }
        Some(())
    }

    fn draw_annotations(
        &mut self,
        page: &Value<'a>,
        st: State,
        scopes: &mut Vec<Resources<'a>>,
        emit: &mut impl FnMut(Draw<'_, '_>, &mut super::Objects<'a>) -> Option<()>,
    ) -> Option<()> {
        let Some(value) = page.get(b"Annots") else { return Some(()); };
        let value = self.objects.resolve(value)?;
        if value.word() == Some(b"null") { return Some(()); }
        let Value::Array(items) = value else { return None; };
        for item in items {
            let annot = self.objects.resolve(&item)?;
            let flags = match annot.get(b"F") {
                Some(v) => self.objects.resolve(v)?.number()? as u32,
                None => 0,
            };
            if flags & (2 | 32) != 0 { continue; }
            let ap = match annot.get(b"AP") { Some(v) => Some(self.objects.resolve(v)?), None => None };
            let normal = ap.as_ref().and_then(|v| v.get(b"N"));
            let appearance = match normal { Some(v) => Some(self.objects.resolve(v)?), None => None };
            if appearance.as_ref().is_none_or(|v| v.word() == Some(b"null")) {
                if !self.draw_widget(&annot, scopes, emit)? { pdf_markup::draw(&annot, &mut self.objects, emit)?; }
                continue;
            }
            let appearance = appearance?;
            let mut id = normal?.reference();
            // Appearance state names, including Off, select an ordinary stream.
            if appearance.get(b"BBox").is_none() {
                let Some(state) = annot.get(b"AS") else { continue; };
                let state = self.objects.resolve(state)?;
                id = appearance.get(state.word()?.strip_prefix(b"/")?)?.reference();
            }
            let id = id?;
            let (appearance, _) = self.objects.object(id)?;
            let rect = self.objects.resolve(annot.get(b"Rect")?)?.rectangle(Value::number)?;
            let bbox = self.objects.resolve(appearance.get(b"BBox")?)?.rectangle(Value::number)?;
            let mut matrix = ID;
            if let Some(value) = appearance.get(b"Matrix") {
                let Value::Array(values) = self.objects.resolve(value)? else { return None; };
                if values.len() != 6 { return None; }
                for (out, value) in matrix.iter_mut().zip(values) {
                    *out = self.objects.resolve(&value)?.number()?;
                    if !out.is_finite() { return None; }
                }
            }
            let [a,b,c,d,e,f] = matrix;
            let corners = [(bbox[0],bbox[1]),(bbox[2],bbox[1]),(bbox[0],bbox[3]),(bbox[2],bbox[3])]
                .map(|(x,y)| [a*x+c*y+e,b*x+d*y+f]);
            let min = [0,1].map(|i| corners.iter().map(|p|p[i]).fold(f64::INFINITY,f64::min));
            let max = [0,1].map(|i| corners.iter().map(|p|p[i]).fold(f64::NEG_INFINITY,f64::max));
            let width = (rect[2]-rect[0]).abs();
            let height = (rect[3]-rect[1]).abs();
            if width == 0. || height == 0. { continue; }
            if max[0] <= min[0] || max[1] <= min[1] { return None; }
            let sx = width/(max[0]-min[0]);
            let sy = height/(max[1]-min[1]);
            let mut child = st.clone();
            child.ctm = [sx,0.,0.,sy,rect[0].min(rect[2])-min[0]*sx,rect[1].min(rect[3])-min[1]*sy];
            if child.ctm.iter().any(|v|!v.is_finite()) { return None; }
            self.draw_form(id, child, scopes, None, emit)?;
        }
        Some(())
    }

    fn draw_form(
        &mut self,
        id: super::ObjectId,
        mut child: State,
        scopes: &mut Vec<Resources<'a>>,
        mask: Option<SoftMask>,
        emit: &mut impl FnMut(Draw<'_, '_>, &mut super::Objects<'a>) -> Option<()>,
    ) -> Option<()> {
        if scopes.len() >= 100 || scopes.iter().any(|scope| scope.form == Some(id)) { return None; }
        let (dict, _) = self.objects.object(id)?;
        if dict.get(b"Subtype")?.word()? != b"/Form" { return None; }
        let Value::Array(bounds) = self.objects.resolve(dict.get(b"BBox")?)? else { return None; };
        if bounds.len() != 4 { return None; }
        let mut bbox = [0.; 4];
        for (out, v) in bbox.iter_mut().zip(bounds) {
            *out = self.objects.resolve(&v)?.number()?;
            if !out.is_finite() { return None; }
        }
        if let Some(v) = dict.get(b"Matrix") {
            let Value::Array(values) = self.objects.resolve(v)? else { return None; };
            if values.len() != 6 { return None; }
            let mut m = [0.; 6];
            for (out, v) in m.iter_mut().zip(values) {
                *out = self.objects.resolve(&v)?.number()?;
                if !out.is_finite() { return None; }
            }
            child.ctm = concat(m, child.ctm);
        }
        let mut local = Resources { form: Some(id), ..Resources::default() };
        if let Some(res) = dict.get(b"Resources") { local.load(&mut self.objects, res, &mut self.fonts)?; }
        scopes.push(local);
        let group = dict.get(b"Group").map(|v| v.clone().into_owned());
        if mask.is_some() && group.is_none() { return None; }
        emit(Draw::BeginForm(bbox, child.ctm, group, mask), &mut self.objects)?;
        self.draw_streams(&[id], child, scopes, emit)?;
        emit(Draw::EndForm, &mut self.objects)?;
        scopes.pop();
        Some(())
    }

    fn draw_streams(
        &mut self,
        streams: &[super::ObjectId],
        mut st: State,
        scopes: &mut Vec<Resources<'a>>,
        emit: &mut impl FnMut(Draw<'_, '_>, &mut super::Objects<'a>) -> Option<()>,
    ) -> Option<()> {
        let default_font = Font {
            metrics: [-0.207, 0.718],
            extractable: true,
            program: Program::Standard,
            name: Rc::from("Helvetica"),
            start: 0,
            widths: vec![],
            cid_widths: None,
            unicode: None,
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
                    if let Some(value) = dict.get(b"SMask") {
                        let value = self.objects.resolve(value)?;
                        if value.word() == Some(b"/None") {
                            emit(Draw::ClearMask, &mut self.objects)?;
                        } else {
                            let mask = SoftMask::read(&mut self.objects, &value)?;
                            let id = value.get(b"G")?.reference()?;
                            self.draw_form(id, st.clone(), scopes, Some(mask), emit)?;
                        }
                    }
                }
                if op == b"BI" {
                    let (fields, pixels) = super::pdf_content_edit::inline(&mut c, &mut self.objects.tokens).ok()?;
                    let dict = super::pdf_externalize::image_dict(&fields);
                    let colors = scopes.iter().rev().find_map(|scope| scope.colors.as_ref());
                    emit(Draw::Image(ImageStream::Inline(dict, pixels), st.ctm, colors), &mut self.objects)?;
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
                        self.draw_form(id, st.clone(), scopes, None, emit)?;
                    } else {
                        let colors = scopes.iter().rev().find_map(|scope| scope.colors.as_ref());
                        emit(Draw::Image(ImageStream::Object(id), st.ctm, colors), &mut self.objects)?;
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
                                        unicode: font.unicode.as_ref().and_then(|map|map.get(&b)).map(String::as_str),
                                        family: &font.name,
                                        program: &font.program,
                                        size,
                                        bounds: [x, y - size * 0.2, right, y + size * 0.8],
                                        text_bounds: font.extractable.then_some([matrix[4], matrix[5] + size * font.metrics[0], matrix[4] + scale * (advance * st.hscale).abs().max(advance), matrix[5] + size * font.metrics[1]]),
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
    pub(in crate::commands::archive) fn text_lines(
        &mut self,
        pno: usize,
        spacing: Option<f64>,
        discard_diagonal: bool,
    ) -> Option<Vec<TextLine>> {
        let page = self
            .objects
            .page_dict(*self.pages.get(pno.checked_sub(1)?)?, &self.tree)?;
        let media = super::media_box(&mut self.objects, &self.tree, &page);
        let mut runs: Vec<TextLine> = vec![];
        let mut space = false;
        let mut forms = Vec::new();
        let mut in_mask = false;
        self.draw_page(&page, false, |event, objects| {
            match &event {
                Draw::BeginForm(_, _, _, mask) => {
                    forms.push(in_mask);
                    in_mask |= mask.is_some();
                }
                Draw::EndForm => in_mask = forms.pop()?,
                _ => {},
            }
            if in_mask { return Some(()); }
            if let Draw::Glyph {
                code,
                unicode,
                program,
                family,
                size,
                bounds,
                matrix,
                text_bounds,
                ..
            } = event
            {
                let text_bounds = text_bounds?;
                let decoded = if let Some(value)=unicode {std::borrow::Cow::Borrowed(value)}
                    else if matches!(program,Program::CidTrueType{..}) {return None;}
                    else {std::borrow::Cow::Owned(text(&[u8::try_from(code).ok()?]))};
                objects.remaining_bytes=objects.remaining_bytes.checked_sub(decoded.len())?;
                // Group along the text axis, independently of the page's /Rotate.
                let scale = matrix[0].hypot(matrix[1]);
                if scale == 0. { return Some(()); }
                let [ux, uy] = [matrix[0] / scale, matrix[1] / scale];
                if discard_diagonal && ux.abs() > 0.1 && uy.abs() > 0.1 {
                    return Some(());
                }
                let [px, py] = [matrix[4], matrix[5]];
                let advance = bounds[2] - bounds[0];
                let [ex, ey] = [px + ux * advance, py + uy * advance];
                // Match the baseline-intersection test used by TypeScript extraction.
                if px.max(ex) < media[0].min(media[2]) || px.min(ex) > media[0].max(media[2])
                    || py.max(ey) < media[1].min(media[3]) || py.min(ey) > media[1].max(media[3]) {
                    return Some(());
                }
                if matches!(decoded.as_ref(), " " | "\t") {
                    space = true;
                    return Some(());
                }
                let x = px * ux + py * uy;
                let y = -px * uy + py * ux;
                let y = if y == 0. {0.} else {y};
                let right = x + advance;
                // Keep page-space bounds for HTML and other layout consumers.
                let descent = text_bounds[1] - py;
                let ascent = text_bounds[3] - py;
                let corners = [
                    [px - uy * descent, py + ux * descent],
                    [px - uy * ascent, py + ux * ascent],
                    [ex - uy * descent, ey + ux * descent],
                    [ex - uy * ascent, ey + ux * ascent],
                ];
                let bounds = [
                    corners.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
                    corners.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min),
                    corners.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max),
                    corners.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max),
                ];
                if let Some(run) = runs.last_mut()
                    && run.direction[0] * ux + run.direction[1] * uy > 0.85
                    && (run.baseline - y).abs() < 1e-6
                    && x >= run.along[0]
                    && x - run.along[1] <= size * 0.22
                    && !space
                {
                    run.text.push_str(&decoded);
                    run.along[1] = run.along[1].max(right);
                    for i in 0..4 {
                        run.bounds[i] = if i < 2 {run.bounds[i].min(bounds[i])} else {run.bounds[i].max(bounds[i])};
                    }
                } else {
                    if runs.len() >= 100_000 {
                        return None;
                    }
                    runs.push(TextLine {
                        text: decoded.into_owned(),
                        family: Rc::clone(family),
                        size,
                        bounds,
                        baseline: y,
                        direction: [ux, uy],
                        along: [x, right],
                    });
                }
                space = false;
            }
            Some(())
        })?;
        if spacing.is_some() {
            runs.sort_by(|a, b| {
                b.baseline.total_cmp(&a.baseline).then(a.along[0].total_cmp(&b.along[0]))
            });
        }
        let mut lines: Vec<TextLine> = vec![];
        for run in runs {
            if let Some(last) = lines.last_mut()
                && run.direction[0] * last.direction[0] + run.direction[1] * last.direction[1] > 0.85
                && (run.baseline - last.baseline).abs() <= run.size.max(last.size) * 0.45
                && spacing.is_none_or(|s| {
                    run.along[0] - last.along[1] <= run.size.max(last.size) * 4. * (s / 0.7)
                })
            {
                last.text.push(' ');
                last.text.push_str(&run.text);
                last.along[0] = last.along[0].min(run.along[0]);
                last.along[1] = last.along[1].max(run.along[1]);
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
