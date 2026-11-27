//! Shared HTML tree and tokenizer used by document lowering and native HTML commands.
// HTML character references have legacy semicolonless spellings and numeric
// recovery rules that do not apply to the XML/ODS decoder below.
pub(super) fn decode_html_entities(s: &str, attribute: bool) -> String {
    use poe_agent_rust::html_markdown::{named_entity, numeric_entity};
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp + 1..];
        let bytes = rest.as_bytes();
        if bytes.first() == Some(&b'#') {
            let hex = bytes.get(1).is_some_and(|c| matches!(c, b'x' | b'X'));
            let start = if hex { 2 } else { 1 };
            let mut end = start;
            let mut value = 0u32;
            while let Some(&byte) = bytes.get(end) {
                let digit = match byte {
                    b'0'..=b'9' => byte - b'0',
                    b'a'..=b'f' if hex => byte - b'a' + 10,
                    b'A'..=b'F' if hex => byte - b'A' + 10,
                    _ => break,
                };
                value = (value * if hex { 16 } else { 10 } + u32::from(digit)).min(0x110000);
                end += 1;
            }
            if end > start {
                out.push(numeric_entity(value));
                end += usize::from(bytes.get(end) == Some(&b';'));
                rest = &rest[end..];
                continue;
            }
        } else {
            // Longest named spelling, including a possible semicolon, is 32 bytes.
            let mut end = bytes
                .iter()
                .take(32)
                .take_while(|b| b.is_ascii_alphanumeric())
                .count();
            if end < 32 && bytes.get(end) == Some(&b';') {
                end += 1;
            }
            let mut found = None;
            for stop in (1..=end).rev() {
                if let Some(value) = named_entity(&rest[..stop]) {
                    if bytes[stop - 1] != b';'
                        && attribute
                        && bytes
                            .get(stop)
                            .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'=')
                    {
                        break;
                    }
                    found = Some((stop, value));
                    break;
                }
            }
            if let Some((end, value)) = found {
                out.extend(
                    char::decode_utf16(value.iter().copied())
                        .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)),
                );
                rest = &rest[end..];
                continue;
            }
        }
        out.push('&');
    }
    out.push_str(rest);
    out
}

fn find_tag_close_gt(s: &str) -> Option<usize> {
    let mut in_q: Option<char> = None;
    for (idx, ch) in s.char_indices() {
        if let Some(q) = in_q {
            if ch == q {
                in_q = None;
            }
        } else if ch == '"' || ch == '\'' {
            in_q = Some(ch);
        } else if ch == '>' {
            return Some(idx);
        }
    }
    None
}

#[derive(Clone, Debug)]
pub enum HtmlNode {
    Text(String),
    Element(HtmlElement),
}

#[derive(Clone, Debug)]
pub struct HtmlElement {
    // Distinguishes parser-inserted table groups from authored section headings.
    pub implicit: bool,
    pub tag: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<HtmlNode>,
}

pub fn is_void_html_tag(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

// Shared lexical opening-tag parsing; HTML export applies its own admission policy.
pub(super) fn html_opening_tag(src: &str) -> Option<(HtmlElement, bool, usize)> {
    let gt = find_tag_close_gt(src)?;
    let inside = &src[1..gt];
    let name_end = inside
        .find(|ch: char| ch.is_ascii_whitespace() || ch == '/')
        .unwrap_or(inside.len());
    let tag = inside[..name_end].to_ascii_lowercase();
    let (attrs, self_closing) = parse_html_attrs(&inside[name_end..]);
    let closed = self_closing || is_void_html_tag(&tag);
    Some((
        HtmlElement {
            implicit: false,
            tag,
            attrs,
            children: Vec::new(),
        },
        closed,
        gt + 1,
    ))
}

pub fn parse_html_dom(src: &str) -> Vec<HtmlNode> {
    let mut pos = 0usize;
    parse_html_children(src, &mut pos, None, usize::MAX, false)
}

pub fn bounded_html_dom(src: &str) -> Option<Vec<HtmlNode>> {
    let mut pos = 0usize;
    let nodes = parse_html_children(src, &mut pos, None, 96, false);
    (pos <= src.len()).then_some(nodes)
}

fn foster_table_text(children: &mut Vec<HtmlNode>, before_table: &mut Vec<HtmlNode>) {
    children.retain_mut(|child| match child {
        HtmlNode::Text(text)
            if !text
                .bytes()
                .all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0c)) =>
        {
            before_table.push(HtmlNode::Text(std::mem::take(text)));
            false
        }
        HtmlNode::Element(element)
            if matches!(element.tag.as_str(), "thead" | "tbody" | "tfoot" | "tr") =>
        {
            foster_table_text(&mut element.children, before_table);
            true
        }
        _ => true,
    });
}

fn parse_html_children(
    src: &str,
    pos: &mut usize,
    stop_tag: Option<&str>,
    depth: usize,
    in_svg: bool,
) -> Vec<HtmlNode> {
    if depth == 0 {
        *pos = src.len() + 1;
        return vec![];
    }
    let mut out = Vec::new();
    let bytes = src.as_bytes();
    while *pos < bytes.len() {
        if let Some(rel_lt) = src[*pos..].find('<') {
            if rel_lt > 0 {
                let text = &src[*pos..*pos + rel_lt];
                out.push(HtmlNode::Text(decode_html_entities(text, false)));
                *pos += rel_lt;
            }
            let rest = &src[*pos..];
            if rest.starts_with("<!--") {
                if let Some(end) = rest.find("-->") {
                    *pos += end + 3;
                } else {
                    *pos = bytes.len();
                }
                continue;
            }
            if rest.len() > 2 && (rest.starts_with("<!") || rest.starts_with("<?")) {
                if let Some(end) = rest.find('>') {
                    *pos += end + 1;
                } else {
                    *pos = bytes.len();
                }
                continue;
            }
            if let Some(after_slash) = rest.strip_prefix("</") {
                let end_gt = after_slash.find('>').unwrap_or(after_slash.len());
                let close_name = after_slash[..end_gt].trim().to_ascii_lowercase();
                if let Some(st) = stop_tag
                    && close_name == st
                {
                    *pos += (2 + end_gt + 1).min(rest.len());
                    break;
                }
                if let Some(st) = stop_tag
                    && (matches!(st, "p" | "li")
                        || matches!(
                            (st, close_name.as_str()),
                            ("dt" | "dd", "dl")
                                | ("td" | "th", "tr")
                                | ("td" | "th" | "tr", "thead" | "tbody" | "tfoot")
                                | ("td" | "th" | "tr" | "thead" | "tbody" | "tfoot", "table")
                        ))
                {
                    break;
                }
                *pos += (2 + end_gt + 1).min(rest.len());
                continue;
            }
            if let Some((opening, self_closing, consumed)) = html_opening_tag(rest) {
                let tag_name = opening.tag;
                let svg_element = in_svg || tag_name == "svg";
                if let Some(st) = stop_tag
                    && matches!(
                        (st, tag_name.as_str()),
                        (
                            "p",
                            "address"
                                | "article"
                                | "aside"
                                | "blockquote"
                                | "center"
                                | "dd"
                                | "details"
                                | "dialog"
                                | "dir"
                                | "div"
                                | "dl"
                                | "dt"
                                | "fieldset"
                                | "figcaption"
                                | "figure"
                                | "footer"
                                | "form"
                                | "h1"
                                | "h2"
                                | "h3"
                                | "h4"
                                | "h5"
                                | "h6"
                                | "header"
                                | "hgroup"
                                | "hr"
                                | "li"
                                | "listing"
                                | "main"
                                | "menu"
                                | "nav"
                                | "ol"
                                | "p"
                                | "plaintext"
                                | "pre"
                                | "search"
                                | "section"
                                | "summary"
                                | "table"
                                | "ul"
                                | "xmp"
                        ) | ("li", "li")
                            | ("dt" | "dd", "dt" | "dd")
                            | ("td" | "th", "td" | "th" | "tr")
                            | ("tr", "tr")
                            | (
                                "td" | "th" | "tr" | "thead" | "tbody" | "tfoot",
                                "thead" | "tbody" | "tfoot"
                            )
                    )
                {
                    break;
                }
                let attrs = opening.attrs;
                *pos += consumed;
                if tag_name.is_empty() {
                    continue;
                }
                // HTML ignores nonvoid slashes; SVG foreign content honors them.
                if is_void_html_tag(&tag_name) || svg_element && self_closing {
                    out.push(HtmlNode::Element(HtmlElement {
                        implicit: false,
                        tag: tag_name,
                        attrs,
                        children: Vec::new(),
                    }));
                    continue;
                }
                let rcdata = matches!(tag_name.as_str(), "title" | "textarea") && !svg_element;
                if matches!(tag_name.as_str(), "script" | "style") || rcdata {
                    let lower_rem = src[*pos..].to_ascii_lowercase();
                    let closing = if rcdata {
                        let close_pat = format!("</{tag_name}");
                        lower_rem.match_indices(&close_pat).find_map(|(start, _)| {
                            let after = &lower_rem[start + close_pat.len()..];
                            after.as_bytes().first().filter(|ch| {
                                ch.is_ascii_whitespace() || matches!(ch, b'>' | b'/')
                            })?;
                            Some((start, find_tag_close_gt(&lower_rem[start..])? + 1))
                        })
                    } else {
                        let close_pat = format!("</{tag_name}>");
                        lower_rem.find(&close_pat).map(|at| (at, close_pat.len()))
                    };
                    let end = closing.map_or(bytes.len(), |(at, _)| *pos + at);
                    let text = if rcdata {
                        decode_html_entities(&src[*pos..end], false)
                    } else {
                        src[*pos..end].to_string()
                    };
                    *pos = closing.map_or(bytes.len(), |(_, width)| end + width);
                    out.push(HtmlNode::Element(HtmlElement {
                        implicit: false,
                        tag: tag_name,
                        attrs,
                        children: vec![HtmlNode::Text(text)],
                    }));
                    continue;
                }
                // These SVG integration points parse their children as HTML;
                // a nested <svg> re-enters foreign content at its opening tag.
                let svg_children =
                    svg_element && !matches!(tag_name.as_str(), "foreignobject" | "desc" | "title");
                let mut children =
                    parse_html_children(src, pos, Some(&tag_name), depth - 1, svg_children);
                if tag_name == "table" && !svg_element {
                    // HTML table insertion modes move non-whitespace text before
                    // the table, while cell and caption content stays in place.
                    foster_table_text(&mut children, &mut out);
                }
                if tag_name == "template" && !svg_element {
                    // HTML template contents belong to a detached fragment, not
                    // the document tree used for traversal and serialization.
                    children.clear();
                }
                if tag_name == "table"
                    && children
                        .iter()
                        .any(|c| matches!(c, HtmlNode::Element(el) if el.tag == "tr"))
                {
                    let mut implicit: Option<HtmlElement> = None;
                    for child in std::mem::take(&mut children) {
                        if matches!(&child, HtmlNode::Element(el) if el.tag == "tr") {
                            implicit
                                .get_or_insert_with(|| HtmlElement {
                                    implicit: true,
                                    tag: "tbody".into(),
                                    attrs: Vec::new(),
                                    children: Vec::new(),
                                })
                                .children
                                .push(child);
                        } else if let Some(group) = &mut implicit
                            && matches!(&child, HtmlNode::Text(t) if t.trim().is_empty())
                        {
                            group.children.push(child);
                        } else {
                            if let Some(group) = implicit.take() {
                                children.push(HtmlNode::Element(group));
                            }
                            children.push(child);
                        }
                    }
                    if let Some(group) = implicit {
                        children.push(HtmlNode::Element(group));
                    }
                }
                out.push(HtmlNode::Element(HtmlElement {
                    implicit: false,
                    tag: tag_name,
                    attrs,
                    children,
                }));
            } else {
                out.push(HtmlNode::Text(rest.to_string()));
                *pos = bytes.len();
            }
        } else {
            let text = &src[*pos..];
            if !text.is_empty() {
                out.push(HtmlNode::Text(decode_html_entities(text, false)));
            }
            *pos = bytes.len();
        }
    }
    out
}

fn parse_html_attrs(s: &str) -> (Vec<(String, String)>, bool) {
    let mut attrs: Vec<(String, String)> = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        // A slash is a self-closing marker only outside an unquoted value.
        if bytes[i] == b'/' {
            i += 1;
            if i == bytes.len() {
                return (attrs, true);
            }
            continue;
        }
        let k_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && !matches!(bytes[i], b'=' | b'/')
        {
            i += 1;
        }
        let key = s[k_start..i].to_string();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let q = bytes[i];
                i += 1;
                let v_start = i;
                while i < bytes.len() && bytes[i] != q {
                    i += 1;
                }
                let val = decode_html_entities(&s[v_start..i], true);
                if i < bytes.len() {
                    i += 1;
                }
                if !attrs.iter().any(|(k, _)| k.eq_ignore_ascii_case(&key)) {
                    attrs.push((key, val));
                }
            } else {
                let v_start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                if !attrs.iter().any(|(k, _)| k.eq_ignore_ascii_case(&key)) {
                    attrs.push((key, decode_html_entities(&s[v_start..i], true)));
                }
            }
        } else if !key.is_empty() && !attrs.iter().any(|(k, _)| k.eq_ignore_ascii_case(&key)) {
            attrs.push((key, String::new()));
        }
    }
    (attrs, false)
}
