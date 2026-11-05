use super::{
    PandocBlock, PandocInline, PandocPipeTables, XmlElement, XmlNode, inlines_plain_text,
    pandoc_list, pandoc_slug, parse_pandoc_markdown, xml,
};
use crate::commands::codecs::zip_directory;
use std::{borrow::Cow, collections::HashMap};

type Error = (i32, &'static str);
const INVALID: Error = (63, "couldn't parse docx file: DocxError\n");
const UNSUPPORTED: Error = (1, "pandoc: unsupported Word document content\n");
const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn root(bytes: &[u8]) -> Result<XmlElement, Error> {
    let doc = xml::parse(std::str::from_utf8(bytes).map_err(|_| INVALID)?, None, None)
        .map_err(|_| INVALID)?;
    doc.nodes
        .into_iter()
        .find_map(|node| {
            if let XmlNode::Element(e) = node {
                Some(e)
            } else {
                None
            }
        })
        .ok_or(INVALID)
}

fn attr<'a>(element: &'a XmlElement, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn children(element: &XmlElement) -> impl Iterator<Item = &XmlElement> {
    element.children.iter().filter_map(|node| match node {
        XmlNode::Element(e) if attr(e, "xmlns:w").is_none_or(|uri| uri == WORD) => Some(e),
        _ => None,
    })
}

fn child<'a>(element: &'a XmlElement, tag: &str) -> Option<&'a XmlElement> {
    children(element).find(|e| e.tag == tag)
}

// Word may split a single word across runs. Join neighboring runs with the
// same formatting before constructing Pandoc's word and space inlines.
fn paragraph(
    element: &XmlElement,
    headings: &HashMap<String, usize>,
) -> Result<Option<PandocBlock>, Error> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut properties = (false, false, false);
    let mut space = false;
    let flush = |text: &mut String,
                 (bold, italic, strike),
                 out: &mut Vec<PandocInline>,
                 space: &mut bool| {
        let mut words = text.split_whitespace();
        if let Some(first) = words.next() {
            if !out.is_empty() && (*space || text.starts_with(char::is_whitespace)) {
                out.push(PandocInline::Space);
            }
            let mut content = vec![PandocInline::Text(first.into())];
            for word in words {
                content.push(PandocInline::Space);
                content.push(PandocInline::Text(word.into()));
            }
            if strike {
                content = vec![PandocInline::Strikeout(content)];
            }
            if bold {
                content = vec![PandocInline::Strong(content)];
            }
            if italic {
                content = vec![PandocInline::Emph(content)];
            }
            out.append(&mut content);
            *space = text.ends_with(char::is_whitespace);
        } else {
            *space |= !text.is_empty();
        }
        text.clear();
    };
    for run in children(element) {
        match run.tag.as_str() {
            "w:pPr" | "w:bookmarkStart" | "w:bookmarkEnd" | "w:proofErr" => continue,
            "w:r" => {}
            _ => return Err(UNSUPPORTED),
        }
        let props = child(run, "w:rPr");
        let on = |tag| {
            props
                .and_then(|pr| child(pr, tag))
                .is_some_and(|e| !matches!(attr(e, "w:val"), Some("0" | "off" | "false")))
        };
        let next = (on("w:b"), on("w:i"), on("w:strike"));
        if next != properties {
            flush(&mut text, properties, &mut out, &mut space);
            properties = next;
        }
        for part in children(run) {
            match part.tag.as_str() {
                "w:t" => {
                    for node in &part.children {
                        match node {
                            XmlNode::Text(s, _) | XmlNode::Cdata(s) => text.push_str(s),
                            XmlNode::Markup(_) => {}
                            XmlNode::Element(_) => return Err(INVALID),
                        }
                    }
                }
                "w:rPr" | "w:lastRenderedPageBreak" => {}
                _ => return Err(UNSUPPORTED),
            }
        }
    }
    flush(&mut text, properties, &mut out, &mut space);
    if let Some(level) = child(element, "w:pPr")
        .and_then(|p| child(p, "w:pStyle"))
        .and_then(|s| attr(s, "w:val"))
        .and_then(|id| headings.get(id))
    {
        return Ok(Some(PandocBlock::Header(
            *level,
            pandoc_slug(&inlines_plain_text(&out)),
            out,
        )));
    }
    Ok((!out.is_empty()).then_some(PandocBlock::Para(out)))
}

pub(super) fn read(data: &[u8], mut remaining: usize) -> Result<Vec<PandocBlock>, Error> {
    let (members, _) =
        zip_directory(data.len(), |r| Ok(Cow::Borrowed(&data[r]))).map_err(|_| INVALID)?;
    let mut part = |path: &str| -> Result<Option<Cow<'_, [u8]>>, Error> {
        let mut matches = members.iter().filter(|m| m.name == path);
        let Some(m) = matches.next() else {
            return Ok(None);
        };
        if matches.next().is_some() || !matches!(m.method, 0 | 8) {
            return Err(INVALID);
        }
        remaining = remaining
            .checked_sub(m.size)
            .ok_or((1, "pandoc: DOCX input limit exceeded\n"))?;
        m.decode(Cow::Borrowed(&data[m.payload.clone()]), None)
            .map(Some)
            .map_err(|_| INVALID)
    };
    let Some(rels) = part("_rels/.rels")? else {
        // Older safe-bash exports contained only the original Markdown and an HTML preview.
        let legacy = part("__pandoc_source.md")?.ok_or(INVALID)?;
        return parse_pandoc_markdown(
            std::str::from_utf8(&legacy).map_err(|_| INVALID)?,
            false,
            PandocPipeTables::Markdown,
            0,
            pandoc_list::Tasks::Markdown,
        )
        .ok_or(INVALID);
    };
    let rels = root(&rels)?;
    if rels.tag != "Relationships"
        || attr(&rels, "xmlns")
            != Some("http://schemas.openxmlformats.org/package/2006/relationships")
    {
        return Err(INVALID);
    }
    let target = children(&rels).find(|e| e.tag == "Relationship" && attr(e,"Type") == Some("http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument") && attr(e,"TargetMode") != Some("External")).and_then(|e|attr(e,"Target")).ok_or(INVALID)?;
    let document = root(&part(target.trim_start_matches('/'))?.ok_or(INVALID)?)?;
    if document.tag != "w:document" || attr(&document, "xmlns:w") != Some(WORD) {
        return Err(INVALID);
    }
    let mut headings = HashMap::new();
    if let Some(styles) = part("word/styles.xml")? {
        let styles = root(&styles)?;
        if styles.tag != "w:styles" || attr(&styles, "xmlns:w") != Some(WORD) {
            return Err(INVALID);
        }
        for style in children(&styles)
            .filter(|e| e.tag == "w:style" && attr(e, "w:type") == Some("paragraph"))
        {
            if let Some(id) = attr(style, "w:styleId")
                && let Some(name) = child(style, "w:name").and_then(|e| attr(e, "w:val"))
                && let Some(level) = name
                    .to_ascii_lowercase()
                    .strip_prefix("heading ")
                    .and_then(|n| n.parse().ok())
                && (1..=9).contains(&level)
            {
                headings.insert(id.to_owned(), level);
            }
        }
    }
    let mut blocks = Vec::new();
    for e in children(child(&document, "w:body").ok_or(INVALID)?) {
        match e.tag.as_str() {
            "w:p" => blocks.extend(paragraph(e, &headings)?),
            "w:bookmarkStart" | "w:bookmarkEnd" | "w:sectPr" => {}
            _ => return Err(UNSUPPORTED),
        }
    }
    Ok(blocks)
}
