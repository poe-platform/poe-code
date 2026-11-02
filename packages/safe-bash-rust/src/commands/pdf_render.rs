// Static paragraph layout, matching the production wkhtmltopdf renderer.
use super::{
    CP1252, PdfDoc,
    pdf_copy::{literal, write_objects},
};
use crate::commands::{
    codecs::zlib_compress,
    structured::{HtmlNode, bounded_html_dom},
};
use std::{fmt::Write as _, io::Write};

#[derive(Default)]
struct Paragraph {
    level: usize,
    text: String,
    links: Vec<String>,
}

fn paragraphs(html: &str) -> Option<Vec<Paragraph>> {
    fn flush(current: &mut Paragraph, blocks: &mut Vec<Paragraph>) {
        if !current.text.trim().is_empty() {
            blocks.push(std::mem::take(current));
        } else {
            *current = Paragraph::default();
        }
    }
    fn visit(
        nodes: &[HtmlNode],
        current: &mut Paragraph,
        blocks: &mut Vec<Paragraph>,
    ) -> Option<()> {
        for node in nodes {
            let HtmlNode::Element(el) = node else {
                if let HtmlNode::Text(text) = node {
                    current.text.push_str(text);
                }
                continue;
            };
            match el.tag.as_str() {
                "head" | "title" | "script" | "style" | "template" => {}
                "br" => current.text.push('\n'),
                "ul" | "ol" | "dl" | "pre" | "blockquote" | "hr" | "table" | "svg" | "img" => {
                    return None;
                }
                "p" | "div" | "section" | "article" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    flush(current, blocks);
                    current.level = el
                        .tag
                        .strip_prefix('h')
                        .and_then(|n| n.parse().ok())
                        .unwrap_or(0);
                    visit(&el.children, current, blocks)?;
                    flush(current, blocks);
                }
                "a" => {
                    let start = current.text.len();
                    visit(&el.children, current, blocks)?;
                    if current
                        .text
                        .get(start..)
                        .is_some_and(|s| !s.trim().is_empty())
                        && let Some(href) = el
                            .attrs
                            .iter()
                            .find(|(k, _)| k.eq_ignore_ascii_case("href"))
                            .map(|(_, v)| v.trim())
                        && !href.is_empty()
                    {
                        current.links.push(href.to_owned());
                    }
                }
                _ => visit(&el.children, current, blocks)?,
            }
        }
        Some(())
    }
    let mut blocks = Vec::new();
    let mut current = Paragraph::default();
    visit(&bounded_html_dom(html)?, &mut current, &mut blocks)?;
    flush(&mut current, &mut blocks);
    Some(blocks)
}

enum PageResource {
    Font(bool),
    Link(Vec<u8>),
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

fn coordinate(value: f64) -> String {
    if value.fract() == 0. {
        return value.to_string();
    }
    let text = format!("{value:.6}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" {
        "0".into()
    } else {
        trimmed.into()
    }
}

pub(in super::super) fn render_paragraphs(
    doc: &PdfDoc,
    [top, right, bottom, left]: [f64; 4],
    settings: impl Fn(usize) -> (usize, bool),
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
    let content_width = (width - left - right).max(72.);
    let media_width = coordinate(width);
    let media_height = coordinate(height);
    let x = coordinate(left);
    let mut remaining_links_budget = limit;
    let mut finish_page = |stream: &mut Vec<u8>,
                           objects: &mut Vec<PageResource>,
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
        let mut annots = String::new();
        let mut fonts = 0;
        for (i, obj) in objects.iter().enumerate() {
            let id = page + i + 1;
            match obj {
                PageResource::Font(_) => {
                    if fonts == 0 {
                        resources.push_str("\n/Font <<");
                    }
                    fonts += 1;
                    write!(resources, "\n/F{fonts} {id} 0 R").unwrap();
                }
                PageResource::Link(_) => write!(annots, "{id} 0 R ").unwrap(),
            }
        }
        if fonts > 0 {
            resources.push_str("\n>>");
        }
        resources.push_str("\n>>");
        let annots = if annots.is_empty() {
            annots
        } else {
            format!("\n/Annots [ {annots}]")
        };
        bodies.push(format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {media_width} {media_height} ]\n/Resources {resources}\n/Contents {content} 0 R{annots}\n>>").into_bytes());
        for obj in objects.drain(..) {
            bodies.push(match obj {
                PageResource::Font(bold) => {
                    let font = if bold { "Helvetica-Bold" } else { "Helvetica" };
                    format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{font}\n/Encoding /WinAnsiEncoding\n>>").into_bytes()
                }
                PageResource::Link(body) => body,
            });
        }
        outlines.extend(
            headings
                .drain(..)
                .map(|(level, title)| (level, title, (page, 0))),
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
        let mut y = height - top;
        let mut objects = Vec::new();
        let mut fonts = Vec::new();
        let (outline_depth, external_links) = settings(page_index);
        let mut headings = Vec::new();
        for Paragraph {
            level,
            text: block,
            links,
        } in blocks
        {
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
            if y - (pitch * lines.len() as f64 + if bold { 10. } else { 6. }) < bottom
                && !stream.is_empty()
            {
                finish_page(&mut stream, &mut objects, &mut headings)?;
                fonts.clear();
                y = height - top;
            }
            if bold {
                y -= 4.;
                if level <= outline_depth {
                    headings.push((
                        level,
                        block.split_whitespace().collect::<Vec<_>>().join(" "),
                    ));
                }
            }
            let block_top = y;
            let font = fonts.iter().position(|&b| b == bold).unwrap_or_else(|| {
                objects.push(PageResource::Font(bold));
                fonts.push(bold);
                fonts.len() - 1
            }) + 1;
            let color = if bold {
                "0.1 0.12 0.18"
            } else if !links.is_empty() {
                "0.05 0.28 0.72"
            } else {
                "0.12 0.12 0.12"
            };
            for line in lines {
                if !stream.is_empty() {
                    stream.push(b'\n');
                }
                let coord = coordinate(y - size as f64);
                write!(
                    stream,
                    "q\n{color} rg\nBT\n/F{font} {size} Tf\n1 0 0 1 {x} {coord} Tm\n"
                )
                .unwrap();
                literal(&win_ansi(&line), &mut stream);
                stream.extend_from_slice(b" Tj\nET\nQ");
                if stream.len() > limit {
                    return Err(());
                }
                y -= pitch;
            }
            if external_links {
                for uri in links {
                    let mut body = format!("<<\n/Type /Annot\n/Subtype /Link\n/Rect [ {x} {} {} {} ]\n/Border [ 0 0 0 ]\n/A <<\n/Type /Action\n/S /URI\n/URI ",coordinate(y),coordinate(left+content_width.min(220.)),coordinate(block_top)).into_bytes();
                    super::pdf_rewrite::encode(&super::pdf_string::encode(&uri), &mut body)
                        .map_err(|_| ())?;
                    body.extend_from_slice(b"\n>>\n>>");
                    remaining_links_budget =
                        remaining_links_budget.checked_sub(body.len()).ok_or(())?;
                    objects.push(PageResource::Link(body));
                }
            }
            y -= 6.;
        }
        finish_page(&mut stream, &mut objects, &mut headings)?;
    }
    bodies[1] = format!(
        "<<\n/Type /Pages\n/Count {}\n/Kids [ {} ]\n>>",
        pages.len(),
        pages.join(" ")
    )
    .into_bytes();
    if !outlines.is_empty() {
        let root = bodies.len() + 1;
        write_outlines(root, &mut bodies, outlines)?;
        bodies[0] =
            format!("<<\n/Type /Catalog\n/Pages 2 0 R\n/Outlines {root} 0 R\n>>").into_bytes();
    }
    write_objects(&bodies, limit).map(Some).ok_or(())
}

pub(super) fn write_outlines(
    root: usize,
    bodies: &mut Vec<Vec<u8>>,
    outlines: Vec<(usize, String, super::ObjectId)>,
) -> Result<(), ()> {
    use super::{
        Value,
        pdf_rewrite::{encode, set},
        pdf_string,
    };
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
                    Value::Ref(page),
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
    Ok(())
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
