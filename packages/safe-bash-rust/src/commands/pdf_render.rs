// Static paragraph layout, matching the production wkhtmltopdf renderer.
use super::{
    CP1252, PdfDoc,
    pdf_copy::{literal, write_objects},
};
use crate::commands::{codecs::zlib_compress, structured::unescape_xml_entities};
use std::{fmt::Write as _, io::Write};

// Other block types need their own draw operations (images, links, outlines, etc.).
fn paragraphs(mut html: &str) -> Option<Vec<(usize, String)>> {
    let mut level = 0;
    let mut result = Vec::new();
    let mut current = String::new();
    let mut hidden = 0usize;
    loop {
        let (text, tag) = html
            .split_once('<')
            .map_or((html, None), |(t, rest)| (t, Some(rest)));
        if hidden == 0 {
            current.push_str(text);
        }
        let Some(rest) = tag else { break };
        let (tag, tail) = rest.split_once('>')?;
        html = tail;
        match tag.trim().to_ascii_lowercase().as_str() {
            "head" | "title" => hidden += 1,
            "/head" | "/title" => hidden = hidden.saturating_sub(1),
            name @ ("p" | "/p" | "div" | "/div" | "h1" | "/h1" | "h2" | "/h2" | "h3" | "/h3"
            | "h4" | "/h4" | "h5" | "/h5" | "h6" | "/h6") => {
                if !current.trim().is_empty() {
                    result.push((level, unescape_xml_entities(&current)));
                }
                current.clear();
                level = name
                    .strip_prefix('h')
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0);
            }
            "html" | "/html" | "body" | "/body" | "!doctype html" | "b" | "/b" | "i" | "/i"
            | "strong" | "/strong" | "em" | "/em" | "span" | "/span" => {}
            _ => return None,
        }
    }
    if !current.trim().is_empty() {
        result.push((level, unescape_xml_entities(&current)));
    }
    Some(result)
}

pub(super) fn win_ansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| {
            u8::try_from(c as u32).unwrap_or_else(|_| {
                CP1252
                    .iter()
                    .position(|&v| v == c && c != '�')
                    .map_or(b'?', |i| 128 + i as u8)
            })
        })
        .collect()
}

pub(in super::super) fn render_paragraphs(
    doc: &PdfDoc,
    outline_depth: impl Fn(usize) -> usize,
) -> Result<Option<Vec<u8>>, ()> {
    let limit = crate::budget::ShellLimits::default().max_output_bytes;
    let mut bodies = vec![
        b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        vec![],
        vec![],
    ];
    let mut info = b"<<\n/Producer (@poe-code/pdf-ast)\n/Title ".to_vec();
    let title = if doc.title.chars().all(|c| c as u32 <= 127) {
        doc.title.as_bytes().to_vec()
    } else {
        [0xfe, 0xff]
            .into_iter()
            .chain(doc.title.encode_utf16().flat_map(u16::to_be_bytes))
            .collect()
    };
    literal(&title, &mut info);
    info.extend_from_slice(b"\n/Creator (wkhtmltopdf \\(pdf-ast-static\\))\n>>");
    bodies[2] = info;
    let mut pages = Vec::new();
    let mut outlines = Vec::new();
    let mut remaining = limit;
    let width = doc.page_w;
    let height = doc.page_h;
    let content_width = (width - 2. * 72. / 2.54).max(72.);
    let mut finish_page = |stream: &mut Vec<u8>,
                           fonts: &mut Vec<bool>,
                           headings: &mut Vec<(usize, String)>|
     -> Result<(), ()> {
        let content = bodies.len() + 1;
        let page = content + 1;
        let compressed = zlib_compress(stream);
        let mut body = format!(
            "<<\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            compressed.len()
        )
        .into_bytes();
        body.extend(compressed);
        body.extend_from_slice(b"\nendstream");
        remaining = remaining.checked_sub(body.len() + 160).ok_or(())?;
        bodies.push(body);
        let mut resources = String::from("<<");
        if !fonts.is_empty() {
            resources.push_str("\n/Font <<");
            for i in 0..fonts.len() {
                write!(resources, "\n/F{} {} 0 R", i + 1, page + i + 1).unwrap();
            }
            resources.push_str("\n>>");
        }
        resources.push_str("\n>>");
        bodies.push(format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {width} {height} ]\n/Resources {resources}\n/Contents {content} 0 R\n>>").into_bytes());
        for bold in fonts.drain(..) {
            let font = if bold { "Helvetica-Bold" } else { "Helvetica" };
            bodies.push(format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{font}\n/Encoding /WinAnsiEncoding\n>>").into_bytes());
        }
        outlines.extend(
            headings
                .drain(..)
                .map(|(level, title)| (level, title, page)),
        );
        pages.push(format!("{page} 0 R"));
        stream.clear();
        Ok(())
    };
    for (page_index, page) in doc.pages.iter().enumerate() {
        let Some(blocks) = paragraphs(&page.html) else {
            return Ok(None);
        };
        let mut stream = Vec::new();
        let mut y = height - 36.;
        let mut fonts = Vec::new();
        let mut headings = Vec::new();
        for (level, block) in blocks {
            let bold = level != 0;
            let size = match level {
                0 => 11,
                1 => 20,
                2 => 16,
                3 => 14,
                _ => 12,
            };
            let pitch = if bold { 1.35 * size as f64 } else { 15. };
            let max_chars = (content_width / (size as f64 * if bold { 0.55 } else { 0.52 }))
                .floor()
                .max(if bold { 15. } else { 20. }) as usize;
            let mut lines: Vec<String> = vec![];
            let mut len = 0usize;
            for word in block.split_whitespace() {
                let n = word.encode_utf16().count();
                if let Some(line) = lines.last_mut()
                    && len + 1 + n <= max_chars
                {
                    line.push(' ');
                    line.push_str(word);
                    len += 1 + n;
                } else {
                    lines.push(word.into());
                    len = n;
                }
            }
            if y - (pitch * lines.len() as f64 + if bold { 10. } else { 6. }) < 36.
                && !stream.is_empty()
            {
                finish_page(&mut stream, &mut fonts, &mut headings)?;
                y = height - 36.;
            }
            if bold {
                y -= 4.;
                if level <= outline_depth(page_index) {
                    headings.push((
                        level,
                        block.split_whitespace().collect::<Vec<_>>().join(" "),
                    ));
                }
            }
            let font = fonts.iter().position(|b| *b == bold).unwrap_or_else(|| {
                fonts.push(bold);
                fonts.len() - 1
            }) + 1;
            let color = if bold {
                "0.1 0.12 0.18"
            } else {
                "0.12 0.12 0.12"
            };
            for line in lines {
                if !stream.is_empty() {
                    stream.push(b'\n');
                }
                let coord = format!("{:.6}", y - size as f64);
                write!(
                    stream,
                    "q\n{color} rg\nBT\n/F{font} {size} Tf\n1 0 0 1 28.346457 {} Tm\n",
                    coord.trim_end_matches('0').trim_end_matches('.')
                )
                .unwrap();
                literal(&win_ansi(&line), &mut stream);
                stream.extend_from_slice(b" Tj\nET\nQ");
                if stream.len() > limit {
                    return Err(());
                }
                y -= pitch;
            }
            y -= 6.;
        }
        finish_page(&mut stream, &mut fonts, &mut headings)?;
    }
    bodies[1] = format!(
        "<<\n/Type /Pages\n/Count {}\n/Kids [ {} ]\n>>",
        pages.len(),
        pages.join(" ")
    )
    .into_bytes();
    if !outlines.is_empty() {
        let root = write_outlines(&mut bodies, outlines)?;
        bodies[0] =
            format!("<<\n/Type /Catalog\n/Pages 2 0 R\n/Outlines {root} 0 R\n>>").into_bytes();
    }
    write_objects(&bodies, limit).map(Some).ok_or(())
}

pub(super) fn write_outlines(
    bodies: &mut Vec<Vec<u8>>,
    outlines: Vec<(usize, String, usize)>,
) -> Result<usize, ()> {
    use super::{
        Value,
        pdf_rewrite::{encode, set},
        pdf_string,
    };
    let root = bodies.len() + 1;
    let mut dicts = vec![vec![(
        b"Type".as_slice().into(),
        Value::Word(b"/Outlines".as_slice().into()),
    )]];
    let mut stack = vec![(0, 0, 0)];
    for (level, title, page) in outlines {
        stack.truncate(level);
        while stack.len() < level {
            let last = stack.last().ok_or(())?.1;
            if last == 0 {
                break;
            }
            stack.push((last, 0, 0));
        }
        let (parent, last, count) = stack.last_mut().ok_or(())?;
        let index = dicts.len();
        let reference = Value::Ref((root + index, 0));
        let null = Value::Word(b"null".as_slice().into());
        let mut dict = vec![
            (b"Title".as_slice().into(), pdf_string::encode(&title)),
            (b"Parent".into(), Value::Ref((root + *parent, 0))),
            (
                b"Dest".into(),
                Value::Array(vec![
                    Value::Ref((page, 0)),
                    Value::Word(b"/XYZ".as_slice().into()),
                    null.clone(),
                    null.clone(),
                    null,
                ]),
            ),
        ];
        if *last != 0 {
            set(&mut dicts[*last], b"Next", reference.clone());
            dict.push((b"Prev".into(), Value::Ref((root + *last, 0))));
        } else {
            set(&mut dicts[*parent], b"First", reference.clone());
        }
        set(&mut dicts[*parent], b"Last", reference);
        *count += 1;
        set(
            &mut dicts[*parent],
            b"Count",
            Value::Word(count.to_string().into_bytes().into()),
        );
        *last = index;
        dicts.push(dict);
    }
    for dict in dicts {
        let mut body = vec![];
        encode(&Value::Dict(dict), &mut body).map_err(|_| ())?;
        bodies.push(body);
    }
    Ok(root)
}

pub(in crate::commands) fn image_pdf(
    pixels: &[[u8; 4]],
    w: usize,
    h: usize,
    page_w: f64,
    page_h: f64,
    limit: usize,
) -> Option<Vec<u8>> {
    fn stream(mut dict: String, raw: &[u8]) -> Vec<u8> {
        let data = zlib_compress(raw);
        dict.push_str(&format!(
            "/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            data.len()
        ));
        let mut b = dict.into_bytes();
        b.extend(data);
        b.extend_from_slice(b"\nendstream");
        b
    }
    let page_w = super::super::svg_format_num(page_w, 6);
    let page_h = super::super::svg_format_num(page_h, 6);
    let alpha = pixels.iter().any(|p| p[3] != 255);
    let image = if alpha { 7 } else { 6 };
    let mut bodies=vec![
        b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        b"<<\n/Type /Pages\n/Count 1\n/Kids [ 5 0 R ]\n>>".to_vec(),
        b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec(),
        stream("<<\n".into(),format!("q\n{page_w} 0 0 {page_h} 0 0 cm\n/Im1 Do\nQ").as_bytes()),
        format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {page_w} {page_h} ]\n/Resources <<\n/Font <<\n>>\n/XObject <<\n/Im1 {image} 0 R\n>>\n>>\n/Contents 4 0 R\n>>").into_bytes(),
    ];
    let dict = |color: &str| {
        format!(
            "<<\n/Type /XObject\n/Subtype /Image\n/Width {w}\n/Height {h}\n/ColorSpace /Device{color}\n/BitsPerComponent 8\n"
        )
    };
    if alpha {
        bodies.push(stream(
            dict("Gray"),
            &pixels.iter().map(|p| p[3]).collect::<Vec<_>>(),
        ));
    }
    let mut rgb = dict("RGB");
    if alpha {
        rgb.push_str("/SMask 6 0 R\n");
    }
    bodies.push(stream(
        rgb,
        &pixels
            .iter()
            .flat_map(|p| &p[..3])
            .copied()
            .collect::<Vec<_>>(),
    ));
    write_objects(&bodies, limit)
}
