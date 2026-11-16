// Word geometry and crop selection for pdftotext's spatial output.
use super::{PageSource, Value, attribute, media_box, pdf_text_layout::Draw};
use crate::commands::archive::html_escape_str;

type Rect = [f64; 4];
fn union(a: Rect, b: Rect) -> Rect {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}
pub(in crate::commands::archive) struct TextOptions {
    pub resolution: f64,
    pub crop: [Option<f64>; 4],
    pub cropbox: bool,
    pub spatial: bool,
    pub raw: bool,
    pub layout: bool,
    pub colspacing: f64,
    pub nodiag: bool,
    pub limit: usize,
}
struct Glyph {
    text: String,
    bounds: Rect,
    size: f64,
    baseline: f64,
    axis: [f64; 2],
    along: f64,
    normal: f64,
    advance: f64,
    diagonal: bool,
}
struct Word {
    text: String,
    bounds: Rect,
}
struct Line {
    words: Vec<Word>,
    bounds: Rect,
    baseline: f64,
    size: f64,
}
struct Block {
    lines: Vec<Line>,
    bounds: Rect,
}
pub(in crate::commands::archive) struct TextPage {
    pub width: f64,
    pub height: f64,
    blocks: Vec<Block>,
}
impl PageSource<'_> {
    pub(in crate::commands::archive) fn spatial_text(
        &mut self,
        pno: usize,
        options: &TextOptions,
    ) -> Option<TextPage> {
        let page = self
            .objects
            .page_dict(*self.pages.get(pno.checked_sub(1)?)?, &self.tree)?;
        let media = media_box(&mut self.objects, &self.tree, &page);
        if !media.iter().all(|v| v.is_finite()) {
            return None;
        }
        let (width, height) = ((media[2] - media[0]).abs(), (media[3] - media[1]).abs());
        let boxpt = if options.cropbox && options.spatial {
            attribute(
                &mut self.objects,
                &self.tree,
                &page,
                b"CropBox",
                |objects, value| {
                    let Value::Array(values) = value else {
                        return None;
                    };
                    let mut rect = [0.; 4];
                    for (i, out) in rect.iter_mut().enumerate() {
                        *out = objects.resolve(values.get(i)?)?.number()?;
                    }
                    Some(rect)
                },
            )
        } else {
            None
        };
        let [a, b, c, d] = boxpt.unwrap_or([0., 0., width, height]);
        if ![a, b, c, d].iter().all(|v| v.is_finite()) {
            return None;
        }
        let (x0, y0, x1, y1) = (a.min(c), b.min(d), a.max(c), b.max(d));
        let (offset_x, offset_y) = if boxpt.is_some() { (x0, y0) } else { (0., 0.) };
        let scale = options.resolution / 72.;
        let [x, y, w, h] = options.crop;
        let min_x = x0 + x.unwrap_or(0.) / scale;
        let max_y = y1 - y.unwrap_or(0.) / scale;
        let max_x = w.filter(|v| *v > 0.).map_or(x1, |v| min_x + v / scale);
        let min_y = h.filter(|v| *v > 0.).map_or(y0, |v| max_y - v / scale);
        let cropping = boxpt.is_some() || options.crop.iter().any(Option::is_some);
        let mut glyphs = Vec::new();
        let (mut mask, mut forms) = (false, vec![]);
        let mut bytes = 0usize;
        self.draw_page(&page, false, |event, _| {
            match &event {
                Draw::BeginForm(_, _, _, soft) => {
                    forms.push(mask);
                    mask |= soft.is_some();
                }
                Draw::EndForm => mask = forms.pop()?,
                _ => {}
            }
            if mask {
                return Some(());
            }
            if let Draw::Glyph {
                code,
                text_bounds: bounds,
                size,
                matrix,
                ..
            } = event
            {
                let bounds = bounds?;
                if !bounds.iter().chain(matrix.iter()).all(|v| v.is_finite()) || !size.is_finite() {
                    return None;
                }
                let norm = matrix[0].hypot(matrix[1]);
                if norm == 0. {
                    return Some(());
                }
                let (ux, uy) = (matrix[0] / norm, matrix[1] / norm);
                let diagonal = ux.abs() > 0.1 && uy.abs() > 0.1;
                if options.nodiag && diagonal {
                    return Some(());
                }
                let advance = bounds[2] - bounds[0];
                let (x, y) = (matrix[4], matrix[5]);
                let (ex, ey) = (x + ux * advance, y + uy * advance);
                if x.max(ex) < media[0].min(media[2])
                    || x.min(ex) > media[0].max(media[2])
                    || y.max(ey) < media[1].min(media[3])
                    || y.min(ey) > media[1].max(media[3])
                {
                    return Some(());
                }
                let axis = if diagonal {
                    if (matrix[0] * matrix[3]).abs() > (matrix[1] * matrix[2]).abs() {
                        [
                            if matrix[0] > 0. || matrix[3] < 0. {
                                1.
                            } else {
                                -1.
                            },
                            0.,
                        ]
                    } else {
                        [0., if matrix[2] < 0. { 1. } else { -1. }]
                    }
                } else {
                    [ux, uy]
                };
                let text = super::super::text(&[u8::try_from(code).ok()?]);
                if !options.raw && diagonal && (text == " " || text == "\t") {
                    return Some(());
                }
                bytes = bytes.checked_add(std::mem::size_of::<Glyph>() + text.len())?;
                if bytes > options.limit {
                    return None;
                }
                glyphs.push(Glyph {
                    text,
                    bounds,
                    size,
                    baseline: y,
                    axis,
                    along: x * axis[0] + y * axis[1],
                    normal: -x * axis[1] + y * axis[0],
                    advance: advance * (ux * axis[0] + uy * axis[1]),
                    diagonal,
                });
            }
            Some(())
        })?;
        let same = |a: &Glyph, b: &Glyph| {
            let tolerance = a.size.max(b.size) * if a.diagonal || b.diagonal { 0.5 } else { 0.45 };
            a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] > 0.85
                && (a.normal - b.normal).abs() <= tolerance
        };
        if !options.raw {
            glyphs.sort_by(|a, b| {
                let tolerance =
                    a.size.max(b.size) * if a.diagonal || b.diagonal { 0.5 } else { 0.45 };
                if a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] > 0.85 {
                    if (a.normal - b.normal).abs() > tolerance {
                        b.normal.total_cmp(&a.normal)
                    } else {
                        a.along.total_cmp(&b.along)
                    }
                } else if (a.baseline - b.baseline).abs() > tolerance {
                    b.baseline.total_cmp(&a.baseline)
                } else {
                    a.bounds[0].total_cmp(&b.bounds[0])
                }
            });
        }
        let mut groups: Vec<Vec<Glyph>> = vec![];
        for glyph in glyphs {
            if let Some(group) = groups.last_mut()
                && same(
                    if options.raw && glyph.diagonal {
                        group
                            .iter()
                            .rev()
                            .find(|g| g.text != " " && g.text != "\t")
                            .unwrap_or(group.first()?)
                    } else {
                        group.first()?
                    },
                    &glyph,
                )
            {
                group.push(glyph);
            } else {
                groups.push(vec![glyph]);
            }
        }
        let mut lines = Vec::new();
        for mut group in groups {
            if !options.raw {
                group.sort_by(|a, b| a.along.total_cmp(&b.along));
            }
            let mut pieces: Vec<Vec<Glyph>> = vec![];
            for glyph in group {
                if let Some(piece) = pieces.last_mut()
                    && (options.raw
                        || glyph.along - piece.last()?.along - piece.last()?.advance
                            <= glyph.size.max(piece.last()?.size) * 4. * options.colspacing / 0.7)
                {
                    piece.push(glyph);
                } else {
                    pieces.push(vec![glyph]);
                }
            }
            for piece in pieces {
                let first = piece.first()?;
                let (baseline, size) = (first.baseline, first.size);
                let mut words: Vec<Word> = vec![];
                let mut separated = true;
                let mut previous: Option<&Glyph> = None;
                for glyph in &piece {
                    if glyph.text == " " || glyph.text == "\t" {
                        separated = true;
                        continue;
                    }
                    let split = previous.is_some_and(|p| {
                        glyph.along - p.along - p.advance > p.size.max(glyph.size) * 0.22
                    });
                    if !separated && !split {
                        let word = words.last_mut()?;
                        word.text.push_str(&glyph.text);
                        word.bounds = union(word.bounds, glyph.bounds);
                    } else {
                        words.push(Word {
                            text: glyph.text.clone(),
                            bounds: glyph.bounds,
                        });
                    }
                    separated = false;
                    previous = Some(glyph);
                }
                if let Some(first) = words.first() {
                    let bounds = words.iter().fold(first.bounds, |a, w| union(a, w.bounds));
                    lines.push(Line {
                        words,
                        bounds,
                        baseline,
                        size,
                    });
                }
            }
        }
        if !options.raw && !options.layout && lines.len() > 2 {
            let mid = width * 0.5;
            let column = |line: &Line| {
                if line.bounds[2] <= mid + 18. {
                    0
                } else if line.bounds[0] >= mid - 18. {
                    1
                } else {
                    2
                }
            };
            let mut present = [false; 3];
            for line in &lines {
                present[column(line)] = true;
            }
            let connected = (0..2).any(|c| {
                let mut previous: Option<&Line> = None;
                for line in lines.iter().filter(|l| column(l) == c) {
                    if let Some(p) = previous
                        && p.baseline - line.baseline > 0.
                        && p.baseline - line.baseline <= p.size * 1.5
                    {
                        return true;
                    }
                    previous = Some(line);
                }
                false
            });
            if present == [true, true, false] && connected {
                lines.sort_by(|a, b| {
                    column(a)
                        .cmp(&column(b))
                        .then(b.baseline.total_cmp(&a.baseline))
                });
            }
        }
        let kind = |line: &Line| {
            let s = &line.words[0].text;
            if line.size >= 15. {
                0
            } else if s.starts_with('•') || s == "-" || s == "*" {
                1
            } else {
                2
            }
        };
        let mut blocks: Vec<Block> = vec![];
        for line in lines {
            if let Some(block) = blocks.last_mut() {
                let last = block.lines.last()?;
                let gap = last.baseline - line.baseline;
                let same_kind = kind(last) == kind(&line)
                    && (kind(&line) == 2
                        || (!options.raw && kind(&line) == 0 && last.size == line.size));
                if same_kind
                    && gap > 0.
                    && gap <= last.size * 1.9
                    && (line.bounds[0] - last.bounds[0]).abs() < last.size * 5.
                {
                    block.bounds = union(block.bounds, line.bounds);
                    block.lines.push(line);
                    continue;
                }
            }
            blocks.push(Block {
                bounds: line.bounds,
                lines: vec![line],
            });
        }
        // Select whole words by their centers, then rebuild every enclosing box.
        for block in &mut blocks {
            for line in &mut block.lines {
                line.words.retain(|w| {
                    !cropping || {
                        let x = (w.bounds[0] + w.bounds[2]) / 2.;
                        let y = (w.bounds[1] + w.bounds[3]) / 2.;
                        x >= min_x && x <= max_x && y >= min_y && y <= max_y
                    }
                });
                for word in &mut line.words {
                    word.bounds = [
                        word.bounds[0] - offset_x,
                        word.bounds[1] - offset_y,
                        word.bounds[2] - offset_x,
                        word.bounds[3] - offset_y,
                    ];
                }
                if let Some(first) = line.words.first() {
                    line.bounds = line
                        .words
                        .iter()
                        .fold(first.bounds, |b, w| union(b, w.bounds));
                }
            }
            block.lines.retain(|l| !l.words.is_empty());
            if let Some(first) = block.lines.first() {
                block.bounds = block
                    .lines
                    .iter()
                    .fold(first.bounds, |b, l| union(b, l.bounds));
            }
        }
        blocks.retain(|b| !b.lines.is_empty());
        Some(TextPage {
            width: if boxpt.is_some() {
                (x1 - x0).max(1.)
            } else {
                width
            },
            height: if boxpt.is_some() {
                (y1 - y0).max(1.)
            } else {
                height
            },
            blocks,
        })
    }
}
impl TextPage {
    pub(in crate::commands::archive) fn empty(&self) -> bool {
        self.blocks.is_empty()
    }
    pub(in crate::commands::archive) fn bbox(&self, layout: bool, resolution: f64) -> String {
        let scale = resolution / 72.;
        let coords = |b: Rect| {
            format!(
                "xMin=\"{:.6}\" yMin=\"{:.6}\" xMax=\"{:.6}\" yMax=\"{:.6}\"",
                b[0] * scale,
                (self.height - b[3]) * scale,
                b[2] * scale,
                (self.height - b[1]) * scale
            )
        };
        let mut out = format!(
            "  <page width=\"{:.6}\" height=\"{:.6}\">\n",
            self.width, self.height
        );
        for block in &self.blocks {
            if layout {
                out.push_str(&format!(
                    "    <flow>\n      <block {}>\n",
                    coords(block.bounds)
                ));
            }
            for line in &block.lines {
                if layout {
                    out.push_str(&format!("        <line {}>\n", coords(line.bounds)));
                }
                for word in &line.words {
                    out.push_str(&format!(
                        "          <word {}>{}</word>\n",
                        coords(word.bounds),
                        html_escape_str(&word.text)
                    ));
                }
                if layout {
                    out.push_str("        </line>\n");
                }
            }
            if layout {
                out.push_str("      </block>\n    </flow>\n");
            }
        }
        out.push_str("  </page>\n");
        out
    }
    pub(in crate::commands::archive) fn tsv(
        &self,
        pno: usize,
        raw: bool,
        resolution: f64,
    ) -> String {
        let scale = resolution / 72.;
        let coords = |b: Rect, n| {
            [
                b[0] * scale,
                (self.height - b[3]) * scale,
                (b[2] - b[0]) * scale,
                (b[3] - b[1]) * scale,
            ]
            .map(|v| format!("{v:.n$}"))
            .join("\t")
        };
        let mut out = format!(
            "1\t{pno}\t0\t0\t0\t0\t0.000000\t0.000000\t{:.6}\t{:.6}\t-1\t###PAGE###\n",
            self.width, self.height
        );
        if raw {
            return out;
        }
        for (b, block) in self.blocks.iter().enumerate() {
            out.push_str(&format!(
                "3\t{pno}\t{b}\t{b}\t0\t0\t{}\t-1\t###FLOW###\n",
                coords(block.bounds, 6)
            ));
            for (l, line) in block.lines.iter().enumerate() {
                out.push_str(&format!(
                    "4\t{pno}\t{b}\t{b}\t{l}\t0\t{}\t-1\t###LINE###\n",
                    coords(line.bounds, 6)
                ));
                for (w, word) in line.words.iter().enumerate() {
                    out.push_str(&format!(
                        "5\t{pno}\t{b}\t{b}\t{l}\t{w}\t{}\t100\t{}\n",
                        coords(word.bounds, 2),
                        word.text
                    ));
                }
            }
        }
        out
    }
    pub(in crate::commands::archive) fn plain(
        &self,
        raw: bool,
        layout: bool,
        rejoin: bool,
    ) -> String {
        if layout && !raw {
            let mut lines: Vec<_> = self.blocks.iter().flat_map(|b| &b.lines).collect();
            lines.sort_by(|a, b| {
                if (a.baseline - b.baseline).abs() > 4. {
                    b.baseline.total_cmp(&a.baseline)
                } else {
                    a.bounds[0].total_cmp(&b.bounds[0])
                }
            });
            let texts: Vec<_> = lines
                .iter()
                .map(|line| {
                    line.words
                        .iter()
                        .map(|w| w.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();
            let lengths: Vec<_> = texts.iter().map(|s| s.encode_utf16().count()).collect();
            let mut horizontal: Vec<_> = (0..lines.len()).collect();
            horizontal.sort_by(|&a, &b| lines[a].bounds[0].total_cmp(&lines[b].bounds[0]));
            let mut columns = vec![0usize; lines.len()];
            for (i, &current) in horizontal.iter().enumerate() {
                let line = lines[current];
                for &prior in &horizontal[..i] {
                    let previous = lines[prior];
                    let offset = if line.bounds[0] > previous.bounds[2] {
                        lengths[prior] + 3
                    } else if previous.bounds[2] == previous.bounds[0] {
                        0
                    } else {
                        ((line.bounds[0] - previous.bounds[0])
                            / (previous.bounds[2] - previous.bounds[0])
                            * lengths[prior] as f64)
                            .trunc() as usize
                    };
                    columns[current] = columns[current].max(columns[prior].saturating_add(offset));
                }
            }
            let mut rows: Vec<Vec<usize>> = vec![];
            for (i, line) in lines.iter().enumerate() {
                if let Some(row) = rows.last_mut()
                    && (lines[row[0]].baseline - line.baseline).abs() <= 4.
                {
                    row.push(i);
                } else {
                    rows.push(vec![i]);
                }
            }
            for row in &mut rows {
                row.sort_by(|&a, &b| lines[a].bounds[0].total_cmp(&lines[b].bounds[0]));
            }
            let mut out = String::new();
            for (r, row) in rows.iter().enumerate() {
                if r > 0 {
                    let previous = lines[*rows[r - 1].last().unwrap()];
                    let size = if previous.size > 0. {
                        previous.size
                    } else {
                        12.
                    };
                    let blanks = ((previous.baseline - lines[row[0]].baseline) / size).trunc() - 1.;
                    out.push_str(&"\n".repeat(1 + blanks.clamp(0., 4.) as usize));
                }
                let mut text = String::new();
                let mut length = 0;
                for &segment in row {
                    let spaces = columns[segment]
                        .saturating_sub(length)
                        .max(usize::from(length > 0))
                        .min(40);
                    text.push_str(&" ".repeat(spaces));
                    text.push_str(&texts[segment]);
                    length += spaces + lengths[segment];
                }
                out.push_str(text.trim_end());
            }
            return out;
        }
        let mut out = String::new();
        for (b, block) in self.blocks.iter().enumerate() {
            if b > 0 {
                out.push_str(if raw || layout { "\n" } else { "\n\n" });
            }
            for (l, line) in block.lines.iter().enumerate() {
                if l > 0 {
                    if rejoin
                        && out.ends_with('-')
                        && line.words[0]
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
                for (w, word) in line.words.iter().enumerate() {
                    if w > 0 {
                        out.push(' ');
                    }
                    out.push_str(&word.text);
                }
            }
        }
        out
    }
}
