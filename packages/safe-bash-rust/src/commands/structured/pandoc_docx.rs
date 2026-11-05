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

use std::fmt::{self, Write};
use xml::EncodedOutput;
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

struct Writer {
    document: EncodedOutput<'static>,
    relationships: EncodedOutput<'static>,
    numbering: EncodedOutput<'static>,
    links: usize,
    lists: usize,
    bookmarks: usize,
}

impl Writer {
    fn inlines(&mut self, mut nodes: &[PandocInline], properties: &str) -> fmt::Result {
        while let Some((node, rest)) = nodes.split_first() {
            nodes = rest;
            match node {
                PandocInline::Strong(children)
                | PandocInline::Emph(children)
                | PandocInline::Strikeout(children) => {
                    let tag = match node {
                        PandocInline::Strong(_) => "<w:b/>",
                        PandocInline::Emph(_) => "<w:i/>",
                        _ => "<w:strike/>",
                    };
                    self.inlines(children, &(properties.to_owned() + tag))?;
                }
                PandocInline::Link(_, children, url, _) => {
                    if let Some(anchor) = url.strip_prefix('#') {
                        write!(
                            self.document,
                            "<w:hyperlink w:anchor=\"{}\">",
                            super::xml_escape_text(anchor)
                        )?;
                    } else {
                        self.links += 1;
                        write!(
                            self.relationships,
                            r#"<Relationship Id="link{}" Type="{REL}/hyperlink" Target="{}" TargetMode="External"/>"#,
                            self.links,
                            super::xml_escape_text(url)
                        )?;
                        write!(self.document, r#"<w:hyperlink r:id="link{}">"#, self.links)?;
                    }
                    self.inlines(children, properties)?;
                    self.document.write_str("</w:hyperlink>")?;
                }
                PandocInline::Code(_, code) => {
                    write!(
                        self.document,
                        r#"<w:r><w:rPr><w:rStyle w:val="VerbatimChar"/>{properties}</w:rPr><w:t xml:space="preserve">{}</w:t></w:r>"#,
                        super::xml_escape_text(code)
                    )?;
                }
                PandocInline::Text(_) | PandocInline::Space => {
                    self.document.write_str("<w:r>")?;
                    if !properties.is_empty() {
                        write!(self.document, "<w:rPr>{properties}</w:rPr>")?;
                    }
                    self.document.write_str(r#"<w:t xml:space="preserve">"#)?;
                    let mut current = node;
                    loop {
                        if let PandocInline::Text(text) = current {
                            self.document.write_str(&super::xml_escape_text(text))?;
                        } else {
                            self.document.write_char(' ')?;
                        }
                        let Some((next @ (PandocInline::Space | PandocInline::Text(_)), rest)) =
                            nodes.split_first()
                        else {
                            break;
                        };
                        current = next;
                        nodes = rest;
                    }
                    self.document.write_str("</w:t></w:r>")?;
                }
            }
        }
        Ok(())
    }

    fn blocks(
        &mut self,
        blocks: &[PandocBlock],
        style: &str,
        depth: usize,
        mut marker: &str,
    ) -> fmt::Result {
        for block in blocks {
            match block {
                PandocBlock::Para(nodes) | PandocBlock::Plain(nodes) | PandocBlock::Header(_, _, nodes) => {
                    let heading;
                    let style = if let PandocBlock::Header(level, _, _) = block {
                        heading = format!("Heading{}", level.clamp(&1,&9)); &heading
                    } else {style};
                    self.document.write_str("<w:p><w:pPr>")?;
                    if !style.is_empty() {write!(self.document, r#"<w:pStyle w:val="{style}"/>"#)?;}
                    write!(self.document, "{marker}</w:pPr>")?;
                    marker = "";
                    let bookmark = if let PandocBlock::Header(_, id, _) = block && !id.is_empty() {
                        self.bookmarks += 1;
                        write!(self.document, r#"<w:bookmarkStart w:id="{}" w:name="{}"/>"#, self.bookmarks, super::xml_escape_text(id))?;
                        Some(self.bookmarks)
                    } else {None};
                    self.inlines(nodes,"")?;
                    if let Some(id) = bookmark {write!(self.document, r#"<w:bookmarkEnd w:id="{id}"/>"#)?;}
                    self.document.write_str("</w:p>")?;
                }
                PandocBlock::BlockQuote(inner) => self.blocks(inner, "BlockText", depth, std::mem::take(&mut marker))?,
                PandocBlock::CodeBlock(_, code) => {
                    write!(self.document, r#"<w:p><w:pPr><w:pStyle w:val="SourceCode"/>{marker}</w:pPr>"#)?;
                    marker = "";
                    for (i,line) in code.split('\n').enumerate() {
                        if i != 0 {self.document.write_str("<w:r><w:br/></w:r>")?;}
                        write!(self.document, r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#, super::xml_escape_text(line))?;
                    }
                    self.document.write_str("</w:p>")?;
                }
                PandocBlock::HorizontalRule => self.document.write_str(r#"<w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hralign="center" o:hrstd="t" o:hr="t"/></w:pict></w:r></w:p>"#)?,
                PandocBlock::List(numbering, items) => {
                    self.lists += 1;
                    let id = self.lists;
                    let level = depth.min(8);
                    let (start, fmt, pattern) = if let Some(n) = numbering {
                        let fmt = match n.style.as_str() {"LowerAlpha"=>"lowerLetter", "UpperAlpha"=>"upperLetter", "LowerRoman"=>"lowerRoman", "UpperRoman"=>"upperRoman", _=>"decimal"};
                        let index = level+1;
                        let pattern = match n.delimiter.as_str() {"OneParen"=>format!("%{index})"),"TwoParens"=>format!("(%{index})"),_=>format!("%{index}.")};
                        (n.start,fmt,pattern)
                    } else {(1,"bullet","•".into())};
                    write!(self.numbering, r#"<w:abstractNum w:abstractNumId="{id}"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="{level}"><w:start w:val="{start}"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{pattern}"/><w:pPr><w:ind w:left="{}" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>"#, 720*(level+1))?;
                    let num = format!(r#"<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{id}"/></w:numPr>"#);
                    for item in items {self.blocks(item, if matches!(item.first(),Some(PandocBlock::Plain(_))) {"Compact"} else {""}, depth+1, &num)?;}
                }
                PandocBlock::Table(header, rows, alignments) => {
                    let cols = header.len().max(1);
                    self.document.write_str("<w:tbl><w:tblPr><w:tblW w:type=\"auto\" w:w=\"0\"/><w:tblLook w:firstRow=\"1\"/></w:tblPr><w:tblGrid>")?;
                    for _ in 0..cols {write!(self.document, r#"<w:gridCol w:w="{}"/>"#, 7920/cols)?;}
                    self.document.write_str("</w:tblGrid>")?;
                    for (i,row) in std::iter::once(header).chain(rows).enumerate() {
                        self.document.write_str("<w:tr>")?;
                        if i==0 {self.document.write_str("<w:trPr><w:tblHeader w:val=\"on\"/></w:trPr>")?;}
                        for (j,cell) in row.iter().enumerate() {
                            self.document.write_str("<w:tc><w:p><w:pPr><w:pStyle w:val=\"Compact\"/>")?;
                            if let Some(a) = alignments.as_ref().and_then(|a|a.get(j)).copied().flatten() {
                                write!(self.document, "<w:jc w:val=\"{}\"/>", match a {fmt::Alignment::Center=>"center",fmt::Alignment::Right=>"right",_=>"left"})?;
                            }
                            write!(self.document, r#"</w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p></w:tc>"#, super::xml_escape_text(cell))?;
                        }
                        self.document.write_str("</w:tr>")?;
                    }
                    self.document.write_str("</w:tbl>")?;
                }
            }
        }
        Ok(())
    }
}

pub(super) fn write(blocks: &[PandocBlock], limit: usize) -> Option<Vec<u8>> {
    let part = || EncodedOutput {
        bytes: Vec::new(),
        encoding: None,
        limit,
    };
    let mut w = Writer {
        document: part(),
        relationships: part(),
        numbering: part(),
        links: 0,
        lists: 0,
        bookmarks: 0,
    };
    write!(w.document, r#"<w:document xmlns:w="{WORD}" xmlns:r="{REL}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>"#).ok()?;
    write!(w.relationships, r#"<Relationships xmlns="{PACKAGE_REL}"><Relationship Id="styles" Type="{REL}/styles" Target="styles.xml"/>"#).ok()?;
    write!(w.numbering, r#"<w:numbering xmlns:w="{WORD}">"#).ok()?;
    w.blocks(blocks, "", 0, "").ok()?;
    w.document
        .write_str("<w:sectPr/></w:body></w:document>")
        .ok()?;
    let mut types = String::from(
        r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#,
    );
    if w.lists > 0 {
        types.push_str(r#"<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>"#);
        write!(
            w.relationships,
            r#"<Relationship Id="numbers" Type="{REL}/numbering" Target="numbering.xml"/>"#
        )
        .ok()?;
        for id in 1..=w.lists {
            write!(
                w.numbering,
                r#"<w:num w:numId="{id}"><w:abstractNumId w:val="{id}"/></w:num>"#
            )
            .ok()?;
        }
        w.numbering.write_str("</w:numbering>").ok()?;
    }
    types.push_str("</Types>");
    w.relationships.write_str("</Relationships>").ok()?;
    let mut styles = format!(r#"<w:styles xmlns:w="{WORD}">"#);
    for level in 1..=9 {
        write!(styles,r#"<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:pPr><w:outlineLvl w:val="{}"/></w:pPr></w:style>"#, level-1).ok()?;
    }
    for (id, name, kind) in [
        ("Compact", "Compact", "paragraph"),
        ("BlockText", "Block Text", "paragraph"),
        ("SourceCode", "Source Code", "paragraph"),
        ("VerbatimChar", "Verbatim Char", "character"),
    ] {
        write!(
            styles,
            r#"<w:style w:type="{kind}" w:styleId="{id}"><w:name w:val="{name}"/></w:style>"#
        )
        .ok()?;
    }
    styles.push_str("</w:styles>");
    let mut parts = vec![
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", include_bytes!("../docx-root.rels")),
        ("word/document.xml", &w.document.bytes),
        ("word/styles.xml", styles.as_bytes()),
        ("word/_rels/document.xml.rels", &w.relationships.bytes),
    ];
    if w.lists > 0 {
        parts.push(("word/numbering.xml", &w.numbering.bytes));
    }
    let size = parts.iter().try_fold(22usize, |n, (name, bytes)| {
        n.checked_add(76 + 2 * name.len())?.checked_add(bytes.len())
    })?;
    (size <= limit && size <= u32::MAX as usize).then(|| super::write_zip_stored(&parts))
}
