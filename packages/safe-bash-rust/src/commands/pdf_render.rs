// Static paragraph layout, matching the production wkhtmltopdf renderer.
use super::{
    CP1252, PdfDoc,
    pdf_copy::{literal, write_objects},
};
use crate::commands::{codecs::zlib_compress, structured::unescape_xml_entities};
use std::io::Write;

// Other block types need their own draw operations (images, links, outlines, etc.).
fn paragraphs(mut html: &str) -> Option<Vec<String>> {
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
            "p" | "/p" | "div" | "/div" => {
                if !current.trim().is_empty() {
                    result.push(unescape_xml_entities(&current));
                }
                current.clear();
            }
            "html" | "/html" | "body" | "/body" | "!doctype html" | "b" | "/b" | "i" | "/i"
            | "strong" | "/strong" | "em" | "/em" | "span" | "/span" => {}
            _ => return None,
        }
    }
    if !current.trim().is_empty() {
        result.push(unescape_xml_entities(&current));
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

pub(in super::super) fn render_paragraphs(doc: &PdfDoc) -> Result<Option<Vec<u8>>, ()> {
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
    let mut font = 0;
    let mut remaining = limit;
    let width = doc.page_w;
    let height = doc.page_h;
    let max_chars = ((width - 2. * 72. / 2.54) / (11. * 0.52)).floor().max(20.) as usize;
    let mut finish_page = |stream: &mut Vec<u8>| -> Result<(), ()> {
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
        let new_font = font == 0 && !stream.is_empty();
        if new_font {
            font = page + 1;
        }
        let resources = if stream.is_empty() {
            "<<\n>>".into()
        } else {
            format!("<<\n/Font <<\n/F1 {font} 0 R\n>>\n>>")
        };
        bodies.push(format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {width} {height} ]\n/Resources {resources}\n/Contents {content} 0 R\n>>").into_bytes());
        if new_font {
            bodies.push(b"<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n/Encoding /WinAnsiEncoding\n>>".to_vec());
        }
        pages.push(format!("{page} 0 R"));
        stream.clear();
        Ok(())
    };
    for page in &doc.pages {
        let Some(blocks) = paragraphs(&page.html) else {
            return Ok(None);
        };
        let mut stream = Vec::new();
        let mut y = height - 36.;
        for block in blocks {
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
            if y - ((15 * lines.len() + 6) as f64) < 36. && !stream.is_empty() {
                finish_page(&mut stream)?;
                y = height - 36.;
            }
            for line in lines {
                if !stream.is_empty() {
                    stream.push(b'\n');
                }
                let coord = format!("{:.6}", y - 11.);
                write!(
                    stream,
                    "q\n0.12 0.12 0.12 rg\nBT\n/F1 11 Tf\n1 0 0 1 28.346457 {} Tm\n",
                    coord.trim_end_matches('0').trim_end_matches('.')
                )
                .unwrap();
                literal(&win_ansi(&line), &mut stream);
                stream.extend_from_slice(b" Tj\nET\nQ");
                if stream.len() > limit {
                    return Err(());
                }
                y -= 15.;
            }
            y -= 6.;
        }
        finish_page(&mut stream)?;
    }
    bodies[1] = format!(
        "<<\n/Type /Pages\n/Count {}\n/Kids [ {} ]\n>>",
        pages.len(),
        pages.join(" ")
    )
    .into_bytes();
    write_objects(&bodies, limit).map(Some).ok_or(())
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
