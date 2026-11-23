use super::super::super::{office::space, office_pptx::Slide};
use super::{Image, Page, Pdf, literal, svg_format_num, win_ansi};
use std::{collections::BTreeSet, io::Write};

fn text<'a>(
    out: &mut Vec<u8>,
    chunks: impl IntoIterator<Item = &'a str>,
    [x, y, size]: [f64; 3],
    heading: bool,
    color: &str,
    prefix: &'a str,
) {
    writeln!(
        out,
        "q\n{color} rg\nBT\n/{} {} Tf\n1 0 0 1 {} {} Tm",
        if heading { "Heading" } else { "Body" },
        svg_format_num(size, 6),
        svg_format_num(x, 6),
        svg_format_num(y, 6)
    )
    .unwrap();
    for value in (!prefix.is_empty())
        .then_some(prefix)
        .into_iter()
        .chain(chunks)
    {
        // Each backing read is a separate PDF string, including spaces between
        // words. Preserve UTF-8 decoder boundaries in long title/cell strings.
        let mut start = 0;
        for boundary in (16384..value.len() + 16384).step_by(16384) {
            let mut end = boundary.min(value.len());
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            if end > start {
                let mut bytes = win_ansi(&value[start..end]);
                for byte in &mut bytes {
                    if *byte < 32 {
                        *byte = b'?';
                    }
                }
                literal(&bytes, out);
                out.extend_from_slice(b" Tj\n");
            }
            start = end;
        }
    }
    out.extend_from_slice(b"ET\nQ\n");
}
fn wrap(
    out: &mut Vec<u8>,
    value: &str,
    maximum: usize,
    [x, start_y, size, line_height]: [f64; 4],
    clip: bool,
) -> f64 {
    let words: Vec<_> = value.split(space).filter(|s| !s.is_empty()).collect();
    let mut first = 0;
    let mut y = start_y;
    let mut line = 0;
    loop {
        let mut end = first;
        let mut length = 0;
        while end < words.len() {
            let next = words[end].encode_utf16().count();
            if end > first && length + 1 + next > maximum {
                break;
            }
            length += usize::from(end > first) + next;
            end += 1;
        }
        if !clip || y >= 14. {
            let chunks = words[first..end]
                .iter()
                .enumerate()
                .flat_map(|(i, &word)| if i > 0 { vec![" ", word] } else { vec![word] });
            text(
                out,
                chunks,
                [x, y, size],
                false,
                "0.18 0.2 0.24",
                if line == 0 { "- " } else { "  " },
            );
            y -= line_height;
        }
        first = end;
        line += 1;
        if first >= words.len() {
            break;
        }
    }
    y
}
pub(in super::super::super) fn render_slides(
    slides: &[Slide],
    filter: Option<&str>,
    limit: usize,
) -> Option<Vec<u8>> {
    let mut pdf = Pdf {
        pages: Vec::new(),
        images: Vec::new(),
        unicode: BTreeSet::new(),
        mappings: Vec::new(),
        y: 0.,
        explicit_widths: false,
        page_height: 540.,
        retained: 0,
        limit,
    };
    for slide in slides {
        let mut page = Page::default();

        text(
            &mut page.stream,
            [slide.paragraphs[0].as_str()],
            [40., slide.dimensions[1] - 40., 22.],
            true,
            "0 0 0",
            "",
        );
        for picture in &slide.images {
            if let Some(image) = Image::read(
                &picture.bytes,
                limit.checked_sub(pdf.retained + page.stream.len())?,
            )
            .ok()?
            {
                let index = pdf.images.len();
                writeln!(
                    page.stream,
                    "q\n{} 0 0 {} {} {} cm\n/Image{index} Do\nQ",
                    svg_format_num(picture.width, 6),
                    svg_format_num(picture.height, 6),
                    svg_format_num(picture.x, 6),
                    svg_format_num(picture.y, 6)
                )
                .ok()?;
                page.images.push(index);
                pdf.retained = pdf
                    .retained
                    .checked_add(image.bytes.len() + image.alpha.len())?;
                pdf.images.push(image);
            }
        }
        let mut cursor: f64 = 330.;
        let mut previous: Option<f64> = None;
        if !slide.boxes.is_empty() {
            for b in &slide.boxes {
                let mut y = if previous.is_some_and(|x| (b.x - x).abs() < 40.) {
                    b.top.min(cursor)
                } else {
                    b.top
                };
                previous = Some(b.x);
                for p in &slide.paragraphs[b.first..b.first + b.count] {
                    y = wrap(
                        &mut page.stream,
                        p,
                        (b.width / (b.size * 0.52)).floor().max(24.) as usize,
                        [b.x, y, b.size, (b.size * 1.35).round()],
                        true,
                    ) - 4.;
                    if pdf.retained + page.stream.len() > limit {
                        return None;
                    }
                }
                cursor = y - 4.;
            }
        } else if slide.tables.is_empty() {
            let mut y = 300.;
            for p in &slide.paragraphs[1..] {
                y = wrap(&mut page.stream, p, 78, [52., y, 14., 20.], false) - 6.;
                if pdf.retained + page.stream.len() > limit {
                    return None;
                }
            }
        }
        for table in &slide.tables {
            let columns = table.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let cell_width = table.width / columns as f64;
            let mut top = table.top.min(cursor);
            for (row, cells) in table.rows.iter().enumerate() {
                let bottom = top - 22.;
                if bottom < 14. {
                    break;
                }
                writeln!(
                    page.stream,
                    "q\n{}\n{} {} {} 22 re\n{}\nQ",
                    if row == 0 {
                        "0.92 0.94 0.97 rg\n0.5 0.55 0.62 RG\n0.75 w"
                    } else {
                        "0.7 0.72 0.75 RG\n0.5 w"
                    },
                    svg_format_num(table.x, 6),
                    svg_format_num(bottom, 6),
                    svg_format_num(table.width, 6),
                    if row == 0 { "B" } else { "S" }
                )
                .ok()?;
                for (cell, value) in cells.iter().enumerate() {
                    let left = table.x + cell as f64 * cell_width;
                    if cell > 0 {
                        writeln!(
                            page.stream,
                            "q\n0.7 0.72 0.75 RG\n0.5 w\n{} {} m\n{} {} l\nS\nQ",
                            svg_format_num(left, 6),
                            svg_format_num(bottom, 6),
                            svg_format_num(left, 6),
                            svg_format_num(top, 6)
                        )
                        .ok()?;
                    }
                    text(
                        &mut page.stream,
                        [value.as_str()],
                        [left + 6., bottom + 6., 10.],
                        row == 0,
                        "0.15 0.15 0.15",
                        "",
                    );
                }
                top -= 22.;
                if pdf.retained + page.stream.len() > limit {
                    return None;
                }
            }
            cursor = top - 8.;
        }
        pdf.retained = pdf.retained.checked_add(page.stream.len())?;
        if pdf.retained > limit {
            return None;
        }
        pdf.pages.push(page);
    }
    pdf.save(
        None,
        filter,
        slides.first().map_or([960., 540.], |slide| slide.dimensions),
        "LibreOffice Impress (@poe-code/pdf-ast)",
    )
}
