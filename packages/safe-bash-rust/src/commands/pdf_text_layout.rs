// Position simple-font text using PDF text and graphics matrices (PDF 32000-1 §9).
use super::super::{Cursor, text};
use super::{PageSource, Value};
use std::{collections::BTreeMap, rc::Rc};
#[path = "pdf_font_widths.rs"]
mod widths;

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
struct Font {
    name: Rc<str>,
    start: usize,
    widths: Vec<f64>,
}
impl Font {
    fn advance(&self, b: u8) -> f64 {
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
#[derive(Clone)]
struct State {
    mode: i32,
    ctm: Matrix,
    font: usize,
    size: f64,
    leading: f64,
    rise: f64,
    spacing: f64,
    word: f64,
    hscale: f64,
}
pub(super) enum Draw<'a, 'b> {
    Operator(&'a [u8], &'a [Value<'b>], Matrix),
    Glyph {
        byte: u8,
        family: &'a Rc<str>,
        bounds: [f64; 4],
        baseline: f64,
        size: f64,
        matrix: Matrix,
        mode: i32,
    },
}
impl<'a> PageSource<'a> {
    pub(super) fn draw_page(
        &mut self,
        page: &Value<'a>,
        mut emit: impl FnMut(Draw<'_, '_>) -> Option<()>,
    ) -> Option<()> {
        let mut node = page;
        let mut fonts = vec![Font {
            name: Rc::from("Helvetica"),
            start: 0,
            widths: vec![],
        }];
        let mut names = BTreeMap::new();
        for _ in 0..128 {
            if let Some(res) = node.get(b"Resources") {
                let res = self.objects.resolve(res)?;
                if let Some(Value::Dict(entries)) =
                    res.get(b"Font").and_then(|v| self.objects.resolve(v))
                {
                    for (key, v) in entries {
                        let dict = self.objects.resolve(&v)?;
                        let family = dict
                            .get(b"BaseFont")
                            .and_then(Value::word)
                            .and_then(|w| w.strip_prefix(b"/"))
                            .unwrap_or(key);
                        let start =
                            dict.get(b"FirstChar").and_then(Value::number).unwrap_or(0.) as usize;
                        let widths = match dict.get(b"Widths").and_then(|w| self.objects.resolve(w))
                        {
                            Some(Value::Array(a)) => {
                                a.iter().map(Value::number).collect::<Option<Vec<_>>>()?
                            }
                            _ => vec![],
                        };
                        names.insert(key, fonts.len());
                        fonts.push(Font {
                            name: Rc::from(String::from_utf8_lossy(family).as_ref()),
                            start,
                            widths,
                        });
                    }
                }
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
        let mut st = State {
            mode: 0,
            ctm: ID,
            font: 0,
            size: 12.,
            leading: 0.,
            rise: 0.,
            spacing: 0.,
            word: 0.,
            hscale: 1.,
        };
        let (mut tm, mut lm) = (ID, ID);
        let mut stack = Vec::new();
        let mut in_text = false;
        for id in streams {
            let bytes = self.objects.decoded_stream(id)?;
            let mut c = Cursor(&bytes);
            let mut args = Vec::new();
            loop {
                c.skip();
                if c.0.is_empty() {
                    break;
                }
                let v = c.value(0, &mut self.objects.tokens)?;
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
                let num = |i: usize| args.get(i)?.number();
                emit(Draw::Operator(op, &args, st.ctm))?;
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
                        st.font = *names.get(key).unwrap_or(&0);
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
                        let font = &fonts[st.font];
                        for item in items {
                            if let Some(k) = item.number() {
                                shift(&mut tm, -k * st.size * st.hscale / 1000., 0.);
                                continue;
                            }
                            let Value::String(raw) = item else { continue };
                            for &b in raw {
                                let m = concat(tm, st.ctm);
                                let scale = m[0].hypot(m[1]);
                                let size = st.size * scale;
                                let x = m[4];
                                let y = m[5] + st.rise;
                                let advance = font.advance(b) * st.size / 1000.;
                                let dx =
                                    (advance + st.spacing + if b == 32 { st.word } else { 0. })
                                        * st.hscale;
                                shift(&mut tm, dx, 0.);
                                let right = x + scale * dx.abs().max(advance);
                                let matrix =
                                    concat([st.size * st.hscale, 0., 0., st.size, 0., st.rise], m);
                                emit(Draw::Glyph {
                                    byte: b,
                                    family: &font.name,
                                    size,
                                    bounds: [x, y - size * 0.2, right, y + size * 0.8],
                                    baseline: y,
                                    matrix,
                                    mode: st.mode,
                                })?;
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
    pub(in crate::commands::archive) fn text_lines(&mut self, pno: usize) -> Option<Vec<TextLine>> {
        let page = self
            .objects
            .object(*self.pages.get(pno.checked_sub(1)?)?)?
            .0;
        let mut runs: Vec<TextLine> = vec![];
        let mut space = false;
        self.draw_page(&page, |event| {
            if let Draw::Glyph {
                byte: b,
                family,
                size,
                bounds,
                baseline: y,
                ..
            } = event
            {
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
        runs.sort_by(|a, b| {
            b.baseline
                .total_cmp(&a.baseline)
                .then(a.bounds[0].total_cmp(&b.bounds[0]))
        });
        let mut lines: Vec<TextLine> = vec![];
        for run in runs {
            if let Some(last) = lines.last_mut()
                && (run.baseline - last.baseline).abs() <= run.size.max(last.size) * 0.45
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
