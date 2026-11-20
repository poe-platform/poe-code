pub mod dom;
use document_ast_rust::*;
use dom::{HtmlElement, HtmlNode, bounded_html_dom, decode_html_entities, html_opening_tag};
use mcp_protocol_rust::formats::base64_decode;
use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Range,
};

fn attr<'a>(e: &'a HtmlElement, name: &str) -> Option<&'a str> {
    e.attrs
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}
fn css<'a>(e: &'a HtmlElement, name: &str) -> Option<&'a str> {
    css_property(attr(e, "style")?, name)
}
pub(crate) fn css_property<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    source.rsplit(';').find_map(|rule| {
        let (key, value) = rule.split_once(':')?;
        (key.trim().eq_ignore_ascii_case(name)).then_some(value.trim())
    })
}
// Preserve explicit HTML isolation. Resolving auto and general CSS bidi modes
// needs a Unicode bidi implementation; do not silently guess their direction.
fn direction(e: &HtmlElement) -> Result<Option<Direction>, String> {
    if let Some(value) = attr(e, "dir") {
        if !["ltr", "rtl", "auto"]
            .iter()
            .any(|valid| value.eq_ignore_ascii_case(valid))
        {
            return Err(format!(
                "Unsupported HTML direction {value:?}; use dir=ltr/rtl for export"
            ));
        }
    }
    if attr(e, "dir").is_some_and(|value| value.eq_ignore_ascii_case("auto")) {
        return Err(
            "Automatic text direction requires an export plugin or an explicit dir=ltr/rtl".into(),
        );
    }
    let css_direction_value = css(e, "direction").map(str::to_ascii_lowercase);
    let css_direction = css_direction_value.as_deref();
    if let Some(value) = css_direction {
        if !matches!(value, "ltr" | "rtl") {
            return Err(format!(
                "Unsupported CSS direction {value}; use an explicit dir=ltr/rtl or an export plugin"
            ));
        }
        let html_isolation = attr(e, "dir").is_some_and(|value| {
            value.eq_ignore_ascii_case("ltr") || value.eq_ignore_ascii_case("rtl")
        });
        if !is_block(e) && !html_isolation && css(e, "unicode-bidi").is_none() {
            return Err("Inline CSS direction requires an explicit isolate mode for export".into());
        }
    }
    if let Some(mode) = css(e, "unicode-bidi") {
        if !mode.eq_ignore_ascii_case("isolate") && !mode.eq_ignore_ascii_case("isolate-override") {
            return Err(format!(
                "Unsupported CSS unicode-bidi mode {mode}; use an export plugin"
            ));
        }
        if attr(e, "dir").is_none() && css_direction.is_none() {
            return Err("CSS unicode-bidi requires an explicit direction for export".into());
        }
    }
    match css_direction
        .or_else(|| attr(e, "dir"))
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("ltr") => Ok(Some(Direction::Ltr)),
        Some("rtl") => Ok(Some(Direction::Rtl)),
        Some("auto") => Err(
            "Automatic text direction requires an export plugin or an explicit dir=ltr/rtl".into(),
        ),
        _ if matches!(e.tag.as_str(), "bdi" | "bdo") => Err(format!(
            "{} requires an explicit dir=ltr/rtl for export",
            e.tag
        )),
        _ if css(e, "unicode-bidi").is_some() => {
            Err("CSS unicode-bidi requires an explicit dir=ltr/rtl for export".into())
        }
        _ => Ok(None),
    }
}
fn direction_blocks(e: &HtmlElement, blocks: &mut Vec<Block>, start: usize) -> Result<(), String> {
    if let Some(direction) = direction(e)? {
        if e.tag == "bdo"
            || css(e, "unicode-bidi")
                .is_some_and(|mode| mode.eq_ignore_ascii_case("isolate-override"))
        {
            return Err("Block directional overrides require an export plugin".into());
        }
        let content = blocks.split_off(start);
        blocks.push(Block::Direction {
            direction,
            blocks: content,
        });
    }
    Ok(())
}
fn align(e: &HtmlElement) -> Align {
    match css(e, "text-align")
        .or_else(|| attr(e, "align"))
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("center") => Align::Center,
        Some("right") => Align::Right,
        Some("left") => Align::Left,
        _ => Align::Default,
    }
}
fn id(e: &HtmlElement) -> String {
    attr(e, "id")
        .or_else(|| attr(e, "data-heading"))
        .unwrap_or("")
        .into()
}
fn text(nodes: &[HtmlNode]) -> String {
    let mut out = String::new();
    for n in nodes {
        match n {
            HtmlNode::Text(t) => out.push_str(t),
            HtmlNode::Element(e) if e.tag == "br" => out.push('\n'),
            HtmlNode::Element(e) => out.push_str(&text(&e.children)),
        }
    }
    out
}
/// Image bytes remain in the supplied map; only embedded URLs need owned decoding.
/// Header admission is cooperative and cached across HTML islands in one conversion.
pub(crate) struct HtmlImages<'a> {
    format: crate::Format,
    supplied: &'a BTreeMap<String, Vec<u8>>,
    decoded: BTreeMap<String, Vec<u8>>,
    headers: BTreeMap<String, terminal_png_rust::office_image::RasterHeader>,
}
impl<'a> HtmlImages<'a> {
    pub(crate) fn new(supplied: &'a BTreeMap<String, Vec<u8>>, format: crate::Format) -> Self {
        Self {
            format,
            supplied,
            decoded: BTreeMap::new(),
            headers: BTreeMap::new(),
        }
    }
    fn bytes(&self, source: &str) -> Option<&[u8]> {
        self.supplied
            .get(source)
            .or_else(|| self.decoded.get(source))
            .map(Vec::as_slice)
    }
    fn encoded<'s>(source: &'s str) -> Result<&'s str, String> {
        let (header, encoded) = source.split_once(',').ok_or_else(|| {
            format!("Missing image resource: {source}; images must be embedded or supplied")
        })?;
        if !header.starts_with("data:image/") || !header.ends_with(";base64") {
            return Err(
                "Images must be embedded base64 image data URLs or supplied resources".into(),
            );
        }
        Ok(encoded)
    }
    pub(crate) fn byte_len(&self, source: &str) -> Result<usize, String> {
        if let Some(bytes) = self.bytes(source) {
            return Ok(bytes.len());
        }
        // Match the existing permissive decoder without allocating before admission.
        Ok(Self::encoded(source)?
            .bytes()
            .filter(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'-' | b'_')
            })
            .count()
            .saturating_mul(6)
            / 8)
    }
    pub(crate) async fn prepare(
        &mut self,
        source: &str,
    ) -> Result<&terminal_png_rust::office_image::RasterHeader, String> {
        if !self.headers.contains_key(source) {
            if self.bytes(source).is_none() {
                let decoded = base64_decode(Self::encoded(source)?)?;
                self.decoded.insert(source.into(), decoded);
            }
            let header =
                terminal_png_rust::office_image::characterize(self.bytes(source).unwrap()).await?;
            self.headers.insert(source.into(), header);
        }
        Ok(&self.headers[source])
    }
    pub(crate) async fn admit_nodes(
        &mut self,
        nodes: &[HtmlNode],
        max_nodes: usize,
        max_depth: usize,
        max_images: usize,
        max_image_bytes: usize,
        notes: &HtmlNotes<'_>,
    ) -> Result<(usize, usize, usize), String> {
        let mut pending: Vec<_> = nodes.iter().map(|node| (node, 0usize, false)).collect();
        let (mut count, mut images, mut image_bytes) = (0usize, 0usize, 0usize);
        let mut sources = BTreeSet::new();
        let mut text_bytes = 0usize;
        while let Some((node, depth, in_note)) = pending.pop() {
            cooperate::yield_now().await;
            if depth >= 96 || depth > max_depth {
                return Err("E_LIMIT: HTML depth limit exceeded".into());
            }
            count = count.saturating_add(1);
            if count > max_nodes {
                return Err("E_LIMIT: HTML node limit exceeded".into());
            }
            let HtmlNode::Element(element) = node else {
                if let HtmlNode::Text(text) = node {
                    text_bytes = text_bytes.saturating_add(text.len());
                    if text_bytes > 64 * 1024 * 1024 {
                        return Err("E_LIMIT: HTML expanded text exceeds 64 MiB".into());
                    }
                }
                continue;
            };
            if matches!(
                element.tag.as_str(),
                "head" | "script" | "style" | "template" | "meta" | "link"
            ) {
                continue;
            }
            if in_note && attr(element, "role") == Some("doc-backlink") {
                continue;
            }
            if attr(element, "role") == Some("doc-endnotes") {
                continue;
            }
            if attr(element, "role") == Some("doc-noteref") {
                let (definition, _, _, _) = &notes[note_id(element, notes)?];
                pending.extend(
                    definition
                        .children
                        .iter()
                        .map(|child| (child, depth + 1, true)),
                );
                continue;
            }
            if element.tag == "img" {
                images = images.saturating_add(1);
                if images > max_images {
                    return Err("E_LIMIT: HTML images limit exceeded".into());
                }
                let source = attr(element, "src").ok_or("Image has no embedded source")?;
                image_bytes = image_bytes.saturating_add(self.byte_len(source)?);
                if image_bytes > max_image_bytes.min(64 * 1024 * 1024) {
                    return Err("E_LIMIT: HTML image byte limit exceeded".into());
                }
                sources.insert(source);
            }
            pending.extend(
                element
                    .children
                    .iter()
                    .map(|child| (child, depth + 1, in_note)),
            );
        }
        for source in sources {
            self.prepare(source).await?;
        }
        Ok((count, images, image_bytes))
    }
}

// Definitions retain their own inherited style, independent of the reference marker.
pub type HtmlNotes<'a> = BTreeMap<String, (&'a HtmlElement, TextStyle, Option<Direction>, Align)>;

pub fn note_id<'a>(element: &HtmlElement, notes: &'a HtmlNotes<'_>) -> Result<&'a str, String> {
    let target = attr(element, "href")
        .and_then(|href| href.strip_prefix('#'))
        .ok_or("HTML footnote reference requires a local fragment target")?;
    let resolved = resolve_fragment(target, |id| notes.contains_key(id))
        .ok_or_else(|| format!("Missing HTML footnote target: {target}"))?;
    Ok(notes.get_key_value(resolved.as_ref()).unwrap().0)
}

fn style_string_bytes(style: &TextStyle) -> usize {
    [&style.link, &style.color, &style.highlight]
        .into_iter()
        .flatten()
        .fold(0usize, |bytes, value| bytes.saturating_add(value.len()))
}

pub async fn html_notes<'a>(
    nodes: &'a [HtmlNode],
    inherited: &TextStyle,
    max_nodes: usize,
    max_depth: usize,
    max_text_bytes: usize,
) -> Result<HtmlNotes<'a>, String> {
    // Bound the source before retaining inherited styles or indexing definitions.
    let mut pending: Vec<_> = nodes.iter().map(|node| (node, 0usize)).collect();
    let mut count = 0usize;
    let mut has_notes = false;
    while let Some((node, depth)) = pending.pop() {
        cooperate::yield_now().await;
        count = count.saturating_add(1);
        if count > max_nodes {
            return Err("E_LIMIT: HTML node limit exceeded".into());
        }
        if depth >= 96 || depth > max_depth {
            return Err("E_LIMIT: HTML depth limit exceeded".into());
        }
        if let HtmlNode::Element(element) = node {
            if matches!(
                element.tag.as_str(),
                "script" | "style" | "head" | "template" | "meta" | "link"
            ) {
                continue;
            }
            has_notes |= matches!(attr(element, "role"), Some("doc-endnotes" | "doc-noteref"));
            pending.extend(element.children.iter().map(|child| (child, depth + 1)));
        }
    }
    let mut notes = BTreeMap::new();
    if !has_notes {
        return Ok(notes);
    }
    let max_text_bytes = max_text_bytes.min(64 * 1024 * 1024);
    let mut retained_styles = style_string_bytes(inherited);
    if retained_styles > max_text_bytes {
        return Err("E_LIMIT: HTML note style byte limit exceeded".into());
    }
    let mut references = Vec::new();
    // One inherited style per open element, never one URL/style copy per sibling.
    let mut stack = vec![(
        nodes.iter(),
        inherited.clone(),
        None,
        Align::Default,
        None,
        None,
        false,
        false,
    )];
    while let Some((
        children,
        style,
        parent_direction,
        parent_alignment,
        owner,
        parent,
        endnotes,
        literal,
    )) = stack.last_mut()
    {
        cooperate::yield_now().await;
        let Some(node) = children.next() else {
            retained_styles -= style_string_bytes(&stack.pop().unwrap().1);
            continue;
        };
        let HtmlNode::Element(element) = node else {
            if *endnotes
                && owner.is_none()
                && matches!(node, HtmlNode::Text(text) if !text.trim().is_empty())
            {
                return Err("Malformed HTML footnote definition list".into());
            }
            continue;
        };
        if matches!(
            element.tag.as_str(),
            "script" | "style" | "head" | "template" | "meta" | "link"
        ) {
            continue;
        }
        if owner.is_some() && attr(element, "role") == Some("doc-backlink") {
            continue;
        }
        let literal = *literal
            || matches!(
                element.tag.as_str(),
                "pre" | "code" | "tt" | "samp" | "var" | "kbd"
            );
        // inline_style first clones the inherited strings. A replacement href
        // is allocated before the inherited href is dropped. Parsed colors are
        // at most six bytes each; reserve their replacements conservatively too.
        let mut copy_bytes = style_string_bytes(style);
        if element.tag == "a" {
            copy_bytes = copy_bytes
                .saturating_add(attr(element, "href").map_or(0, |href| href.trim().len()));
        }
        for replacement in [
            element.tag == "mark",
            css(element, "color").is_some(),
            css(element, "background-color").is_some(),
        ] {
            if replacement {
                copy_bytes = copy_bytes.saturating_add(6);
            }
        }
        if retained_styles.saturating_add(copy_bytes) > max_text_bytes {
            return Err("E_LIMIT: HTML note style byte limit exceeded".into());
        }
        let style = inline_style(element, style);
        let style_bytes = style_string_bytes(&style);
        let scope = direction(element)?.or(*parent_direction);
        let alignment = match align(element) {
            Align::Default => *parent_alignment,
            value => value,
        };
        let mut owner = *owner;
        let mut endnotes = *endnotes;
        if endnotes && owner.is_none() {
            let parent: Option<&HtmlElement> = *parent;
            if parent.is_some_and(|parent| attr(parent, "role") == Some("doc-endnotes")) {
                if element.tag == "hr" && attr(element, "role").is_none() {
                    continue;
                }
                if element.tag != "ol" {
                    return Err("HTML footnote definitions require an ordered list".into());
                }
            } else {
                let id = id(element);
                if element.tag != "li" || id.is_empty() {
                    return Err("HTML footnote definitions require list items with IDs".into());
                }
                // Both the current frame and the indexed definition own a copy.
                if retained_styles.saturating_add(style_bytes.saturating_mul(2)) > max_text_bytes {
                    return Err("E_LIMIT: HTML note style byte limit exceeded".into());
                }
                if notes
                    .insert(id.clone(), (element, style.clone(), scope, alignment))
                    .is_some()
                {
                    return Err(format!("Duplicate HTML footnote definition: {id}"));
                }
                retained_styles += style_bytes;
                owner = Some(element);
            }
        }
        match attr(element, "role") {
            Some("doc-noteref") => {
                if element.tag != "a" {
                    return Err("HTML footnote reference must be a link".into());
                }
                if literal {
                    return Err(
                        "HTML footnote references inside literal code are not supported".into(),
                    );
                }
                references.push((element, owner));
            }
            Some("doc-endnotes") => {
                if literal {
                    return Err(
                        "HTML footnote definitions inside literal code are not supported".into(),
                    );
                }
                if endnotes {
                    return Err("Nested HTML footnote definitions are not supported".into());
                }
                endnotes = true;
            }
            _ => {}
        }
        if endnotes
            && (owner.is_none() || owner.is_some_and(|owner| std::ptr::eq(owner, element)))
            && scope.is_some()
            && css(element, "unicode-bidi")
                .is_some_and(|value| value.eq_ignore_ascii_case("isolate-override"))
        {
            return Err(
                "HTML footnote block directional overrides require an export plugin".into(),
            );
        }
        retained_styles += style_bytes;
        stack.push((
            element.children.iter(),
            style,
            scope,
            alignment,
            owner,
            Some(element),
            endnotes,
            literal,
        ));
    }
    let mut reached = BTreeSet::new();
    let mut edges: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (reference, owner) in references {
        let target = note_id(reference, &notes)?;
        reached.insert(target);
        if let Some(owner) = owner {
            let owner = attr(owner, "id")
                .or_else(|| attr(owner, "data-heading"))
                .unwrap();
            edges.entry(owner).or_default().push(target);
        }
    }
    let mut complete = BTreeSet::new();
    let mut active = BTreeSet::new();
    for id in notes.keys() {
        let mut pending = vec![(id.as_str(), false)];
        while let Some((id, closing)) = pending.pop() {
            cooperate::yield_now().await;
            if closing {
                active.remove(id);
                complete.insert(id);
            } else if !complete.contains(id) {
                if !active.insert(id) {
                    return Err(format!("Circular HTML footnote reference: {id}"));
                }
                pending.push((id, true));
                if let Some(children) = edges.get(id) {
                    pending.extend(children.iter().map(|id| (*id, false)));
                }
            }
        }
    }
    if let Some(id) = notes.keys().find(|id| !reached.contains(id.as_str())) {
        return Err(format!("Unreferenced HTML footnote definition: {id}"));
    }
    // Check the referenced content before any caller materializes repeated bodies.
    // Carry borrowed URLs and color lengths, so admission itself never expands
    // inherited strings. Indexed styles remain live while bodies are lowered.
    let initial_style = (
        inherited.link.as_deref(),
        inherited.color.as_ref().map_or(0, String::len),
        inherited.highlight.as_ref().map_or(0, String::len),
    );
    let mut pending: Vec<_> = nodes
        .iter()
        .map(|node| (node, 0usize, false, initial_style))
        .collect();
    let (mut count, mut text_bytes) = (0usize, retained_styles);
    while let Some((node, depth, in_note, (link, color_bytes, highlight_bytes))) = pending.pop() {
        cooperate::yield_now().await;
        count = count.saturating_add(1);
        if count > max_nodes {
            return Err("E_LIMIT: HTML node limit exceeded".into());
        }
        if depth >= 96 || depth > max_depth {
            return Err("E_LIMIT: HTML depth limit exceeded".into());
        }
        match node {
            HtmlNode::Text(text) => {
                text_bytes = text_bytes.saturating_add(text.len());
                if in_note && !text.is_empty() {
                    text_bytes = text_bytes
                        .saturating_add(link.map_or(0, str::len))
                        .saturating_add(color_bytes)
                        .saturating_add(highlight_bytes);
                }
                if text_bytes > max_text_bytes {
                    return Err("E_LIMIT: HTML expanded text limit exceeded".into());
                }
            }
            HtmlNode::Element(element) => {
                if matches!(
                    element.tag.as_str(),
                    "script" | "style" | "head" | "template" | "meta" | "link"
                ) || attr(element, "role") == Some("doc-endnotes")
                    || in_note && attr(element, "role") == Some("doc-backlink")
                {
                    continue;
                }
                if attr(element, "role") == Some("doc-noteref") {
                    let (definition, style, _, _) = &notes[note_id(element, &notes)?];
                    let style = (
                        style.link.as_deref(),
                        style.color.as_ref().map_or(0, String::len),
                        style.highlight.as_ref().map_or(0, String::len),
                    );
                    pending.extend(
                        definition
                            .children
                            .iter()
                            .map(|child| (child, depth + 1, true, style)),
                    );
                } else {
                    if in_note {
                        if element.tag == "img" {
                            text_bytes = text_bytes.saturating_add(link.map_or(0, str::len));
                        } else if element.tag == "input"
                            && attr(element, "type") == Some("checkbox")
                        {
                            text_bytes = text_bytes
                                .saturating_add(4)
                                .saturating_add(link.map_or(0, str::len))
                                .saturating_add(color_bytes)
                                .saturating_add(highlight_bytes);
                        }
                        if text_bytes > max_text_bytes {
                            return Err("E_LIMIT: HTML expanded text limit exceeded".into());
                        }
                    }
                    let link = if element.tag == "a" {
                        attr(element, "href")
                            .map(str::trim)
                            .filter(|href| !href.is_empty())
                            .or(link)
                    } else {
                        link
                    };
                    let color_bytes = css(element, "color")
                        .and_then(color)
                        .map_or(color_bytes, |color| color.len());
                    let highlight_bytes = if element.tag == "mark" {
                        6
                    } else {
                        highlight_bytes
                    };
                    let highlight_bytes = css(element, "background-color")
                        .and_then(color)
                        .map_or(highlight_bytes, |color| color.len());
                    pending.extend(element.children.iter().map(|child| {
                        (
                            child,
                            depth + 1,
                            in_note,
                            (link, color_bytes, highlight_bytes),
                        )
                    }));
                }
            }
        }
    }
    Ok(notes)
}

fn image(e: &HtmlElement, resources: &HtmlImages<'_>) -> Result<Image, String> {
    let source = attr(e, "src").ok_or("Image has no embedded source")?;
    let header = resources
        .headers
        .get(source)
        .ok_or("Image has not been admitted")?;
    let bytes = resources
        .bytes(source)
        .ok_or("Image has no embedded source")?;
    let natural =
        if resources.format == crate::Format::Pdf && header.orientation.is_some_and(|o| o >= 5) {
            (f64::from(header.height), f64::from(header.width))
        } else {
            (f64::from(header.width), f64::from(header.height))
        };
    let dimension = |name: &str| {
        css(e, name)
            .or_else(|| attr(e, name))
            .map(str::trim)
            .and_then(|v| v.strip_suffix("px").unwrap_or(v).parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0. && *v <= 100000.)
    };
    let (w, h) = (dimension("width"), dimension("height"));
    let (width, height) = match (w, h) {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, w * natural.1 / natural.0),
        (None, Some(h)) => (h * natural.0 / natural.1, h),
        _ => natural,
    };
    if !width.is_finite()
        || !height.is_finite()
        || width <= 0.
        || height <= 0.
        || width > 100000.
        || height > 100000.
    {
        return Err("Invalid image dimensions".into());
    }
    Ok(Image {
        bytes: bytes.to_vec(),
        mime: header.mime.into(),
        width,
        height,
        alt: attr(e, "alt").unwrap_or("").into(),
        title: attr(e, "title").unwrap_or("").into(),
        link: None,
    })
}
fn color(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    let value = normalized.as_str();
    if let Some(hex) = value.strip_prefix('#') {
        if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(hex.to_uppercase());
        }
        if hex.len() == 3 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(
                hex.chars()
                    .flat_map(|c| [c, c])
                    .collect::<String>()
                    .to_uppercase(),
            );
        }
    }
    if let Some(rgb) = value.strip_prefix("rgb(").and_then(|s| s.strip_suffix(')')) {
        let parts = rgb
            .split(',')
            .map(|s| s.trim().parse::<u8>())
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        if parts.len() == 3 {
            return Some(format!("{:02X}{:02X}{:02X}", parts[0], parts[1], parts[2]));
        }
    }
    match value {
        "yellow" => Some("FFFF00".into()),
        "black" => Some("000000".into()),
        "red" => Some("FF0000".into()),
        "blue" => Some("0000FF".into()),
        _ => None,
    }
}
pub fn append_html_text(
    out: &mut Vec<Inline>,
    raw: &str,
    style: &TextStyle,
    boundary: Option<char>,
) {
    if style.code {
        if let Some(Inline::Text { text, style: prior }) = out.last_mut() {
            if prior == style {
                text.push_str(raw);
                return;
            }
        }
        if !raw.is_empty() {
            out.push(Inline::Text {
                text: raw.into(),
                style: style.clone(),
            });
        }
        return;
    }
    let mut collapsed = String::new();
    for c in raw.chars() {
        let c = if matches!(c, '\n' | '\r' | '\t' | '\u{c}') {
            ' '
        } else {
            c
        };
        let previous = collapsed
            .chars()
            .last()
            .or_else(|| match out.last() {
                Some(Inline::Text { text, .. }) => text.chars().last(),
                _ => None,
            })
            .or(boundary);
        if c == ' ' && (previous == Some(' ') || previous.is_none() && out.is_empty()) {
            continue;
        }
        collapsed.push(c);
    }
    if collapsed.is_empty() {
        return;
    }
    if let Some(Inline::Text { text, style: prior }) = out.last_mut() {
        if prior == style {
            text.push_str(&collapsed);
            return;
        }
    }
    out.push(Inline::Text {
        text: collapsed,
        style: style.clone(),
    });
}
fn inline_style(e: &HtmlElement, style: &TextStyle) -> TextStyle {
    let mut next = style.clone();
    match e.tag.as_str() {
        "b" | "strong" | "summary" => next.bold = true,
        "i" | "em" => next.italic = true,
        "u" => next.underline = true,
        "s" | "del" | "strike" => next.strike = true,
        "code" | "kbd" | "samp" => next.code = true,
        "sub" => {
            next.sub = true;
            next.sup = false;
        }
        "sup" => {
            next.sup = true;
            next.sub = false;
        }
        "mark" => next.highlight = Some("FFF3A3".into()),
        "a" => {
            next.link = attr(e, "href")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .or(next.link)
        }
        _ => {}
    }
    if let Some(source) = attr(e, "style") {
        apply_css_text_style(source, &mut next);
    }
    next
}
pub(crate) fn apply_css_text_style(source: &str, next: &mut TextStyle) {
    if let Some(v) = css_property(source, "background-color").and_then(color) {
        next.highlight = Some(v);
    }
    if let Some(v) = css_property(source, "color").and_then(color) {
        next.color = Some(v);
    }
    if let Some(value) = css_property(source, "font-weight") {
        match value.to_ascii_lowercase().as_str() {
            "bold" | "600" | "700" | "800" | "900" => next.bold = true,
            "normal" | "400" => next.bold = false,
            _ => {}
        }
    }
    if let Some(value) = css_property(source, "font-style") {
        if value.eq_ignore_ascii_case("italic") {
            next.italic = true;
        } else if value.eq_ignore_ascii_case("normal") {
            next.italic = false;
        }
    }
}
fn inline(
    nodes: &[HtmlNode],
    style: &TextStyle,
    out: &mut Vec<Inline>,
    resources: &HtmlImages<'_>,
    notes: &HtmlNotes<'_>,
    in_note: bool,
) -> Result<(), String> {
    for node in nodes {
        let HtmlNode::Element(e) = node else {
            if let HtmlNode::Text(t) = node {
                append_html_text(out, t, style, None);
            }
            continue;
        };
        if matches!(e.tag.as_str(), "script" | "style" | "head" | "template") {
            continue;
        }
        if attr(e, "role") == Some("doc-backlink") && in_note {
            continue;
        }
        let scope = direction(e)?;
        let anchor = id(e);
        if !anchor.is_empty() {
            out.push(Inline::Anchor(anchor));
        }
        if attr(e, "role") == Some("doc-noteref") {
            let (definition, note_style, direction, alignment) = &notes[note_id(e, notes)?];
            let mut content = blocks(&definition.children, note_style, resources, notes, true)?;
            apply_alignment(&mut content, *alignment);
            anchor_blocks(&mut content, 0, id(definition));
            if let Some(direction) = direction {
                content = vec![Block::Direction {
                    direction: *direction,
                    blocks: content,
                }];
            }
            out.push(Inline::Note(content));
            continue;
        }
        match e.tag.as_str() {
            "br" => {
                out.push(Inline::Break);
                continue;
            }
            "img" => {
                let mut image = image(e, resources)?;
                image.link = style.link.clone();
                let image = Inline::Image(image);
                out.push(match scope {
                    Some(direction) => Inline::Direction {
                        direction,
                        override_order: false,
                        inlines: vec![image],
                    },
                    None => image,
                });
                continue;
            }
            "input" if attr(e, "type") == Some("checkbox") => {
                let label = if attr(e, "checked").is_some() {
                    "☑ "
                } else {
                    "☐ "
                };
                if let Some(direction) = scope {
                    out.push(Inline::Direction {
                        direction,
                        override_order: false,
                        inlines: vec![Inline::Text {
                            text: label.into(),
                            style: style.clone(),
                        }],
                    });
                } else {
                    append_html_text(out, label, style, None);
                }
                continue;
            }
            "svg" | "math" | "canvas" | "iframe" | "object" | "embed" | "video" | "audio" => {
                return Err(format!(
                    "Render {} to an embedded image before exporting",
                    e.tag
                ));
            }
            _ => {}
        }
        let next = inline_style(e, style);
        if let Some(direction) = scope {
            // Keep whitespace at an inline boundary, including an initial space
            // inside the isolated span, without merging runs across that scope.
            let has_prior = !out.is_empty();
            let mut content = if has_prior {
                vec![Inline::Break]
            } else {
                Vec::new()
            };
            inline(&e.children, &next, &mut content, resources, notes, in_note)?;
            if has_prior {
                content.remove(0);
            }
            out.push(Inline::Direction {
                direction,
                override_order: e.tag == "bdo"
                    || css(e, "unicode-bidi")
                        .is_some_and(|mode| mode.eq_ignore_ascii_case("isolate-override")),
                inlines: content,
            });
        } else {
            inline(&e.children, &next, out, resources, notes, in_note)?;
        }
    }
    Ok(())
}
fn collapse_scope_spaces(inlines: &mut [Inline], previous: &mut Option<char>) {
    for inline in inlines {
        match inline {
            Inline::Text { text, style } => {
                if !style.code && *previous == Some(' ') && text.starts_with(' ') {
                    text.remove(0);
                }
                if let Some(last) = text.chars().last() {
                    *previous = Some(last);
                }
            }
            Inline::Direction { inlines, .. } => collapse_scope_spaces(inlines, previous),
            Inline::Anchor(_) => {}
            _ => *previous = None,
        }
    }
}
fn trim_inline_end(inlines: &mut [Inline]) {
    match inlines.last_mut() {
        Some(Inline::Text { text, style }) if !style.code => {
            text.truncate(text.trim_end_matches(' ').len());
        }
        Some(Inline::Direction { inlines, .. }) => trim_inline_end(inlines),
        _ => {}
    }
}
fn inlines(
    nodes: &[HtmlNode],
    style: &TextStyle,
    resources: &HtmlImages<'_>,
    notes: &HtmlNotes<'_>,
    in_note: bool,
) -> Result<Vec<Inline>, String> {
    let mut out = Vec::new();
    inline(nodes, style, &mut out, resources, notes, in_note)?;
    collapse_scope_spaces(&mut out, &mut None);
    trim_inline_end(&mut out);
    Ok(out)
}
fn is_block(e: &HtmlElement) -> bool {
    matches!(
        e.tag.as_str(),
        "html"
            | "body"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "ul"
            | "ol"
            | "li"
            | "pre"
            | "blockquote"
            | "table"
            | "caption"
            | "thead"
            | "tbody"
            | "tfoot"
            | "tr"
            | "td"
            | "th"
            | "hr"
            | "div"
            | "section"
            | "article"
            | "aside"
            | "figure"
            | "figcaption"
            | "details"
            | "summary"
            | "dl"
            | "dt"
            | "dd"
    ) || e
        .children
        .iter()
        .any(|n| matches!(n,HtmlNode::Element(c) if is_block(c)))
}

pub(crate) fn blocks(
    nodes: &[HtmlNode],
    style: &TextStyle,
    resources: &HtmlImages<'_>,
    notes: &HtmlNotes<'_>,
    in_note: bool,
) -> Result<Vec<Block>, String> {
    let mut out = Vec::new();
    let mut pending = Vec::new();
    let flush = |pending: &mut Vec<HtmlNode>, out: &mut Vec<Block>| -> Result<(), String> {
        if pending.is_empty() {
            return Ok(());
        }
        let runs = inlines(pending, style, resources, notes, in_note)?;
        pending.clear();
        if !runs.is_empty() {
            out.push(Block::Paragraph(Paragraph {
                inlines: runs,
                compact: true,
                ..Default::default()
            }));
        }
        Ok(())
    };
    for node in nodes {
        let HtmlNode::Element(e) = node else {
            pending.push(node.clone());
            continue;
        };
        if matches!(
            e.tag.as_str(),
            "script" | "style" | "head" | "template" | "meta" | "link"
        ) {
            continue;
        }
        if attr(e, "role") == Some("doc-endnotes") {
            flush(&mut pending, &mut out)?;
            let start = out.len();
            anchor_blocks(&mut out, start, id(e));
            for child in &e.children {
                if let HtmlNode::Element(list) = child {
                    let start = out.len();
                    anchor_blocks(&mut out, start, id(list));
                }
            }
            continue;
        }
        if !is_block(e) {
            pending.push(node.clone());
            continue;
        }
        flush(&mut pending, &mut out)?;
        let start = out.len();
        let block_style = inline_style(e, style);
        match e.tag.as_str() {
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => out.push(Block::Heading {
                level: e.tag.as_bytes()[1] - b'0',
                id: id(e),
                inlines: inlines(&e.children, &block_style, resources, notes, in_note)?,
            }),
            "p" | "figcaption" | "summary" | "dt" => {
                if e.children
                    .iter()
                    .any(|node| matches!(node,HtmlNode::Element(child) if is_block(child)))
                {
                    let mut lowered = blocks(&e.children, &block_style, resources, notes, in_note)?;
                    anchor_blocks(&mut lowered, 0, id(e));
                    if align(e) != Align::Default {
                        for block in &mut lowered {
                            if let Block::Paragraph(p) = block {
                                p.align = align(e);
                            }
                        }
                    }
                    out.extend(lowered);
                    direction_blocks(e, &mut out, start)?;
                    continue;
                }
                let mut runs = inlines(&e.children, &block_style, resources, notes, in_note)?;
                if e.tag == "dt" {
                    emphasize_inlines(&mut runs);
                }
                out.push(Block::Paragraph(Paragraph {
                    id: id(e),
                    list_checked: None,
                    inlines: runs,
                    align: align(e),
                    compact: false,
                    keep_with_next: false,
                }));
            }
            "pre" => {
                reject_code_scopes(&e.children)?;
                out.push(Block::Code {
                    language: attr(e, "data-lang").unwrap_or("").into(),
                    text: text(&e.children),
                });
            }
            "ul" | "ol" => {
                let ordered = e.tag == "ol";
                let reversed = ordered && attr(e, "reversed").is_some();
                let mut next = attr(e, "start").and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or_else(|| {
                    if reversed {
                        e.children.iter().filter(|child| matches!(child, HtmlNode::Element(li) if li.tag == "li")).count() as i64
                    } else { 1 }
                });
                let mut start = ordered.then_some(next);
                let css_list_style = css(e, "list-style-type").map(str::to_ascii_lowercase);
                let style = match css_list_style.as_deref().or_else(|| attr(e, "type")) {
                    Some("a" | "lower-alpha" | "lower-latin") => ListStyle::LowerAlpha,
                    Some("A" | "upper-alpha" | "upper-latin") => ListStyle::UpperAlpha,
                    Some("i" | "lower-roman") => ListStyle::LowerRoman,
                    Some("I" | "upper-roman") => ListStyle::UpperRoman,
                    _ => ListStyle::Decimal,
                };
                let delimiter = match attr(e, "data-list-delimiter") {
                    Some("OneParen") => ListDelimiter::OneParen,
                    Some("TwoParens") => ListDelimiter::TwoParens,
                    _ => ListDelimiter::Period,
                };
                let mut items = Vec::new();
                for child in &e.children {
                    if let HtmlNode::Element(li) = child {
                        if li.tag == "li" {
                            let value = if ordered {
                                attr(li, "value")
                                    .and_then(|v| v.trim().parse().ok())
                                    .unwrap_or(next)
                            } else {
                                next
                            };
                            // The shared list model counts upwards. Preserve HTML
                            // counter resets/reversal as consecutive ordered runs.
                            if ordered && !items.is_empty() && (reversed || value != next) {
                                out.push(Block::List {
                                    start,
                                    style,
                                    delimiter,
                                    items: std::mem::take(&mut items),
                                });
                            }
                            if items.is_empty() {
                                start = ordered.then_some(value);
                            }
                            let mut content = blocks(
                                &li.children,
                                &inline_style(li, &block_style),
                                resources,
                                notes,
                                in_note,
                            )?;
                            crate::mark_task_item(&mut content);
                            anchor_blocks(&mut content, 0, id(li));
                            direction_blocks(li, &mut content, 0)?;
                            items.push(content);
                            next = value.saturating_add(if reversed { -1 } else { 1 });
                        }
                    }
                }
                out.push(Block::List {
                    start,
                    style,
                    delimiter,
                    items,
                });
            }
            "blockquote" | "aside" => out.push(quote(e, &block_style, resources, notes, in_note)?),
            "div" if attr(e, "data-tone").is_some() => {
                out.push(quote(e, &block_style, resources, notes, in_note)?)
            }
            "table" => {
                for child in &e.children {
                    if let HtmlNode::Element(caption) = child {
                        if caption.tag == "caption" {
                            let mut content = blocks(
                                &caption.children,
                                &inline_style(caption, &block_style),
                                resources,
                                notes,
                                in_note,
                            )?;
                            for block in &mut content {
                                if let Block::Paragraph(p) = block {
                                    p.keep_with_next = true;
                                }
                            }
                            anchor_blocks(&mut content, 0, id(caption));
                            direction_blocks(caption, &mut content, 0)?;
                            out.extend(content);
                        }
                    }
                }

                let mut rows = Vec::new();
                let mut pending_anchors = Vec::new();
                let implicit_headers = !e
                    .children
                    .iter()
                    .any(|node| matches!(node, HtmlNode::Element(group) if group.tag == "thead"));
                // HTML lays out header/footer groups at the table's edges even
                // when their authored DOM positions differ.
                for section in 0..3 {
                    let nodes = e.children.iter().filter(|node| {
                        let role = match node {
                            HtmlNode::Element(group) if group.tag == "thead" => 0,
                            HtmlNode::Element(group) if group.tag == "tfoot" => 2,
                            _ => 1,
                        };
                        role == section
                    });
                    table_rows(
                        nodes,
                        false,
                        implicit_headers,
                        None,
                        &mut rows,
                        &mut pending_anchors,
                        &block_style,
                        resources,
                        notes,
                        in_note,
                    )?;
                }
                if rows.iter().map(|r| r.cells.len()).sum::<usize>() > 10000 {
                    return Err("Document table cell limit exceeded".into());
                }
                let percent = |value: &str| {
                    value
                        .trim()
                        .strip_suffix('%')
                        .and_then(|v| v.trim().parse::<f64>().ok())
                        .filter(|n| n.is_finite() && *n > 0.)
                        .map(|n| (n / 100.).min(1.))
                };
                let width = css(e, "width")
                    .or_else(|| attr(e, "width"))
                    .and_then(percent);
                let mut column_widths = Vec::new();
                for node in &e.children {
                    if let HtmlNode::Element(group) = node {
                        if group.tag == "colgroup" {
                            for node in &group.children {
                                if let HtmlNode::Element(col) = node {
                                    if col.tag == "col" {
                                        let n = attr(col, "span")
                                            .and_then(|v| v.parse::<usize>().ok())
                                            .unwrap_or(1)
                                            .clamp(1, 1000);
                                        let width = css(col, "width")
                                            .or_else(|| attr(col, "width"))
                                            .and_then(percent)
                                            .unwrap_or(0.);
                                        if column_widths.len() + n > 1000 {
                                            return Err(
                                                "Document table column limit exceeded".into()
                                            );
                                        }
                                        column_widths.extend(std::iter::repeat_n(width, n));
                                    }
                                }
                            }
                        }
                    }
                }
                out.push(Block::Table {
                    rows,
                    width,
                    column_widths,
                });
                let trailing = out.len();
                for anchor in pending_anchors {
                    anchor_blocks(&mut out, trailing, anchor);
                }
            }
            "hr" => out.push(Block::Rule),
            _ => out.extend(blocks(
                &e.children,
                &block_style,
                resources,
                notes,
                in_note,
            )?),
        }
        if !matches!(
            e.tag.as_str(),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "figcaption" | "summary" | "dt"
        ) {
            anchor_blocks(&mut out, start, id(e));
        }
        apply_alignment(&mut out[start..], align(e));
        direction_blocks(e, &mut out, start)?;
    }
    flush(&mut pending, &mut out)?;
    Ok(out)
}
fn reject_code_scopes(nodes: &[HtmlNode]) -> Result<(), String> {
    for node in nodes {
        if let HtmlNode::Element(e) = node {
            if direction(e)?.is_some() {
                return Err(
                    "Inline direction inside a code block requires an export plugin".into(),
                );
            }
            reject_code_scopes(&e.children)?;
        }
    }
    Ok(())
}
pub(crate) fn apply_alignment(blocks: &mut [Block], alignment: Align) {
    if alignment == Align::Default {
        return;
    }
    for block in blocks {
        match block {
            Block::Paragraph(p) if p.align == Align::Default => p.align = alignment,
            Block::Direction { blocks, .. } | Block::Quote { blocks, .. } => {
                apply_alignment(blocks, alignment)
            }
            Block::List { items, .. } => {
                for item in items {
                    apply_alignment(item, alignment);
                }
            }
            Block::Table { rows, .. } => {
                for row in rows {
                    for cell in &mut row.cells {
                        if cell.align == Align::Default {
                            cell.align = alignment;
                        }
                        apply_alignment(&mut cell.blocks, cell.align);
                    }
                }
            }
            _ => {}
        }
    }
}
fn quote_kind(e: &HtmlElement) -> Option<String> {
    attr(e, "data-tone").map(|value| {
        let mut chars = value.chars();
        chars
            .next()
            .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
            .unwrap_or_default()
    })
}
fn quote(
    e: &HtmlElement,
    style: &TextStyle,
    resources: &HtmlImages<'_>,
    notes: &HtmlNotes<'_>,
    in_note: bool,
) -> Result<Block, String> {
    let mut kind = quote_kind(e);
    let children = e
        .children
        .iter()
        .filter(|node| {
            if kind.is_some()
                && let HtmlNode::Element(title) = node
            {
                if attr(title, "class").is_some_and(|classes| {
                    classes
                        .split_whitespace()
                        .any(|class| class == "md-alert-title")
                }) {
                    kind = Some(text(&title.children));
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect::<Vec<_>>();
    Ok(Block::Quote {
        kind,
        blocks: blocks(&children, style, resources, notes, in_note)?,
    })
}
fn emphasize_inlines(inlines: &mut [Inline]) {
    for inline in inlines {
        match inline {
            Inline::Text { style, .. } => style.bold = true,
            Inline::Direction { inlines, .. } => emphasize_inlines(inlines),
            _ => {}
        }
    }
}

fn table_rows<'a>(
    nodes: impl Iterator<Item = &'a HtmlNode>,
    header: bool,
    mut implicit_headers: bool,
    inherited_direction: Option<Direction>,
    out: &mut Vec<TableRow>,
    pending_anchors: &mut Vec<String>,
    style: &TextStyle,
    resources: &HtmlImages<'_>,
    notes: &HtmlNotes<'_>,
    in_note: bool,
) -> Result<(), String> {
    let nodes = nodes.collect::<Vec<_>>();
    // Empty authored rows have no visible cell and are represented by their
    // anchors. Translate row spans into the retained row coordinates so they
    // cannot spill past a group when such rows are omitted.
    let mut occupied_rows = vec![0usize];
    for node in &nodes {
        if let HtmlNode::Element(row) = node {
            if row.tag == "tr" {
                let occupied = row.children.iter().any(|node| matches!(node, HtmlNode::Element(cell) if matches!(cell.tag.as_str(), "td" | "th")));
                occupied_rows.push(occupied_rows.last().unwrap() + usize::from(occupied));
            }
        }
    }
    let mut row_index = 0;
    for node in nodes {
        let HtmlNode::Element(e) = node else {
            continue;
        };
        let row_direction = direction(e)?.or(inherited_direction);
        if matches!(e.tag.as_str(), "tr" | "thead" | "tbody" | "tfoot") {
            let anchor = id(e);
            if !anchor.is_empty() {
                pending_anchors.push(anchor);
            }
        }
        if e.tag != "tr" {
            table_rows(
                e.children.iter(),
                header || e.tag == "thead",
                implicit_headers && (e.tag != "tbody" || e.implicit) && e.tag != "tfoot",
                row_direction,
                out,
                pending_anchors,
                &inline_style(e, style),
                resources,
                notes,
                in_note,
            )?;
            if e.tag == "tbody" {
                implicit_headers = false;
            }
            continue;
        }
        let mut cells = Vec::new();
        let rowspan_for = |cell: &HtmlElement| {
            let remaining_rows = occupied_rows.len() - 1 - row_index;
            let authored_span = match attr(cell, "rowspan")
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(1)
            {
                0 => remaining_rows,
                value => value.min(remaining_rows),
            };
            (occupied_rows[row_index + authored_span] - occupied_rows[row_index]).clamp(1, 10000)
        };
        let row_header = header
            || (implicit_headers
                && out.is_empty()
                && e.children
                    .iter()
                    .filter_map(|node| match node {
                        HtmlNode::Element(cell) if matches!(cell.tag.as_str(), "td" | "th") => {
                            Some(cell)
                        }
                        _ => None,
                    })
                    .all(|cell| cell.tag == "th" && rowspan_for(cell) == 1));
        implicit_headers = false;
        for child in &e.children {
            let HtmlNode::Element(c) = child else {
                continue;
            };
            if !matches!(c.tag.as_str(), "td" | "th") {
                continue;
            }
            let colspan = attr(c, "colspan")
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(1)
                .clamp(1, 1000);
            let rowspan = rowspan_for(c);
            let mut content = blocks(
                &c.children,
                &inline_style(c, &inline_style(e, style)),
                resources,
                notes,
                in_note,
            )?;
            anchor_blocks(&mut content, 0, id(c));
            direction_blocks(c, &mut content, 0)?;
            if let Some(direction) = row_direction {
                content = vec![Block::Direction {
                    direction,
                    blocks: content,
                }];
            }
            cells.push(TableCell {
                header: c.tag == "th"
                    || matches!(
                        attr(c, "role").map(str::trim),
                        Some("rowheader" | "columnheader")
                    ),
                blocks: content,
                align: align(c),
                colspan,
                rowspan,
            });
        }
        row_index += 1;
        if let Some(first) = cells.first_mut() {
            for anchor in pending_anchors.drain(..) {
                anchor_blocks(&mut first.blocks, 0, anchor);
            }
            out.push(TableRow {
                header: row_header,
                cells,
            });
        }
    }
    Ok(())
}

/// Read semantic HTML only. The caller resolves images explicitly; no network or
/// ambient filesystem access occurs during either export.
pub fn from_html(html: &str) -> Result<Document, String> {
    if html.len() > 64 * 1024 * 1024 {
        return Err("E_LIMIT: Document input exceeds 64 MiB".into());
    }
    let nodes = bounded_html_dom(html).ok_or("E_LIMIT: Document nesting limit exceeded")?;
    from_html_nodes(&nodes, &BTreeMap::new(), 1_000_000, 64 * 1024 * 1024)
}

/// Lower an already parsed HTML tree and explicitly supplied resources. Bounds
/// apply before repeated image bytes are copied into the document model.
pub fn from_html_nodes(
    nodes: &[HtmlNode],
    resources: &BTreeMap<String, Vec<u8>>,
    max_nodes: usize,
    max_image_bytes: usize,
) -> Result<Document, String> {
    cooperate::block_on(from_html_nodes_async(
        nodes,
        resources,
        max_nodes,
        95,
        usize::MAX,
        max_image_bytes,
        crate::Format::Docx,
    ))
}

pub(crate) async fn from_html_nodes_async(
    nodes: &[HtmlNode],
    resources: &BTreeMap<String, Vec<u8>>,
    max_nodes: usize,
    max_depth: usize,
    max_images: usize,
    max_image_bytes: usize,
    format: crate::Format,
) -> Result<Document, String> {
    let notes = html_notes(
        nodes,
        &TextStyle::default(),
        max_nodes,
        max_depth,
        64 * 1024 * 1024,
    )
    .await?;
    let mut images = HtmlImages::new(resources, format);
    images
        .admit_nodes(
            nodes,
            max_nodes,
            max_depth,
            max_images,
            max_image_bytes,
            &notes,
        )
        .await?;
    let document = Document {
        title: String::new(),
        blocks: blocks(nodes, &TextStyle::default(), &images, &notes, false)?,
    };
    document_ast_rust::validate_async(&document).await?;
    Ok(document)
}

/// A parsed HTML opening tag. The document mapper owns nesting across typed nodes.
#[derive(Clone, Debug)]
pub struct HtmlScope {
    element: HtmlElement,
    closed: bool,
}

#[derive(Clone, Debug)]
pub enum HtmlToken {
    Open(HtmlScope),
    Close(String),
    Text(String),
}

fn inline_tag(tag: &str) -> bool {
    matches!(
        tag,
        "span"
            | "b"
            | "strong"
            | "i"
            | "em"
            | "u"
            | "s"
            | "del"
            | "strike"
            | "code"
            | "kbd"
            | "samp"
            | "sub"
            | "sup"
            | "mark"
            | "a"
            | "br"
            | "img"
            | "bdi"
            | "bdo"
    )
}
fn admitted_tag(tag: &str) -> bool {
    inline_tag(tag)
        || matches!(
            tag,
            "html"
                | "body"
                | "p"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "ul"
                | "ol"
                | "li"
                | "pre"
                | "blockquote"
                | "table"
                | "caption"
                | "thead"
                | "tbody"
                | "tfoot"
                | "tr"
                | "td"
                | "th"
                | "hr"
                | "div"
                | "section"
                | "article"
                | "aside"
                | "figure"
                | "figcaption"
                | "details"
                | "summary"
                | "dl"
                | "dt"
                | "dd"
                | "colgroup"
                | "col"
        )
}
fn positive_pixels(value: &str) -> bool {
    value
        .trim()
        .strip_suffix("px")
        .unwrap_or(value.trim())
        .parse::<f64>()
        .is_ok_and(|n| n.is_finite() && n > 0. && n <= 100000.)
}
fn percent_width(value: &str) -> bool {
    value
        .trim()
        .strip_suffix('%')
        .and_then(|v| v.trim().parse::<f64>().ok())
        .is_some_and(|n| n.is_finite() && n > 0. && n <= 100.)
}
fn admit_element(e: &HtmlElement) -> Result<(), String> {
    if !admitted_tag(&e.tag) {
        return Err(format!(
            "Unsupported raw HTML element <{}>; use an export plugin",
            e.tag
        ));
    }
    for (name, value) in &e.attrs {
        let name = name.to_ascii_lowercase();
        let value = value.trim();
        let valid = match name.as_str() {
            "id" | "data-heading" if matches!(e.tag.as_str(), "col" | "colgroup") => false,
            "id" | "class" | "title" | "lang" | "dir" | "style" => true,
            "href" if e.tag == "a" => {
                let first = value.split(['/', '?', '#']).next().unwrap_or_default();
                !value.bytes().any(|byte| byte.is_ascii_control())
                    && !first.split_once(':').is_some_and(|(scheme, _)| {
                        !matches!(
                            scheme.to_ascii_lowercase().as_str(),
                            "http" | "https" | "mailto" | "tel"
                        )
                    })
            }
            "src" | "alt" if e.tag == "img" => true,
            "width" if e.tag == "img" => positive_pixels(value),
            "height" if e.tag == "img" => positive_pixels(value),
            "width" if matches!(e.tag.as_str(), "table" | "col") => percent_width(value),
            "align"
                if matches!(
                    e.tag.as_str(),
                    "p" | "td"
                        | "th"
                        | "div"
                        | "section"
                        | "article"
                        | "aside"
                        | "blockquote"
                        | "figure"
                        | "figcaption"
                        | "dt"
                ) =>
            {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "left" | "center" | "right"
                )
            }
            "rowspan" if matches!(e.tag.as_str(), "td" | "th") => {
                value.parse::<usize>().is_ok_and(|n| n <= 1000)
            }
            "colspan" if matches!(e.tag.as_str(), "td" | "th") => {
                value.parse::<usize>().is_ok_and(|n| n > 0 && n <= 1000)
            }
            "span" if e.tag == "col" => value.parse::<usize>().is_ok_and(|n| n > 0 && n <= 1000),
            // HTML scope only defines header-cell relationships; it is inert on td.
            "scope" if e.tag == "td" => true,
            "scope" if e.tag == "th" => matches!(
                value.to_ascii_lowercase().as_str(),
                "row" | "col" | "rowgroup" | "colgroup"
            ),
            "role" if e.tag == "a" => matches!(value, "doc-noteref" | "doc-backlink"),
            "role" if matches!(e.tag.as_str(), "section" | "div") => value == "doc-endnotes",
            "role" if e.tag == "li" => value == "doc-endnote",
            "aria-label" if e.tag == "a" && attr(e, "role") == Some("doc-backlink") => true,
            "data-footnote-label" if e.tag == "sup" => true,
            "role" if matches!(e.tag.as_str(), "td" | "th") => {
                matches!(value, "rowheader" | "columnheader" | "cell")
            }
            "start" if e.tag == "ol" => value.parse::<i64>().is_ok(),
            "value" if e.tag == "li" => value.parse::<i64>().is_ok(),
            "type" if e.tag == "ol" => matches!(value, "1" | "a" | "A" | "i" | "I"),
            "reversed" if e.tag == "ol" => true,
            "open" if e.tag == "details" => true,
            "data-tone" if e.tag == "div" => true,
            "data-heading" => true,
            "data-lang" if e.tag == "pre" => true,
            "data-list-delimiter" if e.tag == "ol" => {
                matches!(value, "Period" | "OneParen" | "TwoParens")
            }
            _ => false,
        };
        if !valid {
            return Err(format!(
                "Unsupported raw HTML attribute {name}={value:?} on <{}>",
                e.tag
            ));
        }
    }
    if let Some(style) = attr(e, "style") {
        for declaration in style.split(';').filter(|s| !s.trim().is_empty()) {
            let (name, value) = declaration
                .split_once(':')
                .ok_or("Malformed raw HTML style declaration")?;
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            let lower = value.to_ascii_lowercase();
            let valid = match name.as_str() {
                "color" | "background-color" => e.tag != "pre" && color(value).is_some(),
                "font-weight" => {
                    e.tag != "pre"
                        && matches!(
                            lower.as_str(),
                            "normal" | "bold" | "400" | "600" | "700" | "800" | "900"
                        )
                }
                "font-style" => e.tag != "pre" && matches!(lower.as_str(), "normal" | "italic"),
                "direction" | "unicode-bidi" => true,
                "text-align" => {
                    matches!(
                        e.tag.as_str(),
                        "p" | "figcaption"
                            | "dt"
                            | "div"
                            | "section"
                            | "article"
                            | "aside"
                            | "figure"
                            | "blockquote"
                            | "table"
                            | "td"
                            | "th"
                            | "ul"
                            | "ol"
                            | "dl"
                            | "dd"
                            | "html"
                            | "body"
                    ) && matches!(lower.as_str(), "left" | "center" | "right")
                }
                "width" if matches!(e.tag.as_str(), "table" | "col") => percent_width(value),
                "width" | "height" if e.tag == "img" => positive_pixels(value),
                "list-style-type" if e.tag == "ol" => matches!(
                    lower.as_str(),
                    "decimal"
                        | "lower-alpha"
                        | "lower-latin"
                        | "upper-alpha"
                        | "upper-latin"
                        | "lower-roman"
                        | "upper-roman"
                ),
                _ => false,
            };
            if !valid {
                return Err(format!(
                    "Unsupported raw HTML style {name}:{value} on <{}>",
                    e.tag
                ));
            }
        }
    }
    direction(e)?;
    Ok(())
}

impl HtmlScope {
    pub fn tag(&self) -> &str {
        &self.element.tag
    }
    pub fn is_void(&self) -> bool {
        self.closed
    }
    pub(crate) fn has_footnotes(&self) -> bool {
        matches!(
            attr(&self.element, "role"),
            Some("doc-noteref" | "doc-endnotes")
        )
    }
    /// Explicit resets cannot override the writers' mandatory heading/header style.
    pub fn resets_bold(&self) -> bool {
        css(&self.element, "font-weight")
            .is_some_and(|value| value.eq_ignore_ascii_case("normal") || value == "400")
    }
    fn forces_bold(&self) -> bool {
        matches!(
            self.tag(),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "th" | "thead"
        ) || attr(&self.element, "role")
            .is_some_and(|role| matches!(role.trim(), "rowheader" | "columnheader"))
    }
    pub fn image_source(&self) -> Option<&str> {
        (self.element.tag == "img")
            .then(|| attr(&self.element, "src"))
            .flatten()
    }
    pub fn inline_style(&self, inherited: &TextStyle) -> Result<TextStyle, String> {
        Ok(inline_style(&self.element, inherited))
    }
    pub fn finish_inlines(
        &self,
        content: Vec<Inline>,
        inherited: &TextStyle,
        resources: &BTreeMap<String, Vec<u8>>,
    ) -> Result<Vec<Inline>, String> {
        let mut images = HtmlImages::new(resources, crate::Format::Docx);
        cooperate::block_on(self.finish_inlines_async(content, inherited, &mut images))
    }
    pub(crate) async fn finish_inlines_async(
        &self,
        mut content: Vec<Inline>,
        inherited: &TextStyle,
        resources: &mut HtmlImages<'_>,
    ) -> Result<Vec<Inline>, String> {
        let e = &self.element;
        if !inline_tag(&e.tag) {
            return Err(format!("Raw HTML <{}> requires a block context", e.tag));
        }
        match e.tag.as_str() {
            "br" => content.push(Inline::Break),
            "img" => {
                resources
                    .prepare(attr(e, "src").ok_or("Image has no embedded source")?)
                    .await?;
                let mut image = image(e, resources)?;
                image.link = inherited.link.clone();
                content.push(Inline::Image(image));
            }
            _ => {}
        }
        if let Some(direction) = direction(e)? {
            content = vec![Inline::Direction {
                direction,
                override_order: e.tag == "bdo"
                    || css(e, "unicode-bidi")
                        .is_some_and(|v| v.eq_ignore_ascii_case("isolate-override")),
                inlines: content,
            }];
        }
        let anchor = id(e);
        if !anchor.is_empty() {
            content.insert(0, Inline::Anchor(anchor));
        }
        Ok(content)
    }
    pub fn finish_blocks(&self, mut content: Vec<Block>) -> Result<Vec<Block>, String> {
        let e = &self.element;
        if !matches!(
            e.tag.as_str(),
            "div"
                | "section"
                | "article"
                | "aside"
                | "figure"
                | "blockquote"
                | "details"
                | "summary"
        ) {
            return Err(format!(
                "Split raw HTML <{}> requires a complete HTML block",
                e.tag
            ));
        }
        apply_alignment(&mut content, align(e));
        anchor_blocks(&mut content, 0, id(e));
        if matches!(e.tag.as_str(), "blockquote" | "aside")
            || e.tag == "div" && attr(e, "data-tone").is_some()
        {
            content = vec![Block::Quote {
                kind: quote_kind(e),
                blocks: content,
            }];
        }
        direction_blocks(e, &mut content, 0)?;
        Ok(content)
    }
}

/// Tokenize only raw HTML fragments, retaining exact source slices for complete islands.
/// Closing-tag balance is checked by the caller across typed Pandoc nodes.
pub fn html_tokens(source: &str) -> Result<Vec<(Range<usize>, HtmlToken)>, String> {
    if source.len() > 64 * 1024 * 1024 {
        return Err("E_LIMIT: Document input exceeds 64 MiB".into());
    }
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < source.len() {
        if out.len() >= 1_000_000 {
            return Err("E_LIMIT: Raw HTML token limit exceeded".into());
        }
        let rest = &source[pos..];
        if rest.starts_with("<!--") {
            let end = rest.find("-->").ok_or("Unclosed raw HTML comment")?;
            pos += end + 3;
        } else if let Some(close) = rest.strip_prefix("</") {
            let end = close.find('>').ok_or("Unclosed raw HTML closing tag")?;
            let tag = close[..end].trim().to_ascii_lowercase();
            if !admitted_tag(&tag) || matches!(tag.as_str(), "br" | "img" | "hr" | "col") {
                return Err(format!("Unsupported raw HTML closing tag </{tag}>"));
            }
            let next = pos + end + 3;
            out.push((pos..next, HtmlToken::Close(tag)));
            pos = next;
        } else if rest.starts_with('<') {
            if !rest.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic) {
                return Err("Malformed or unsupported raw HTML declaration".into());
            }
            let (element, closed, consumed) =
                html_opening_tag(rest).ok_or("Unclosed raw HTML opening tag or attribute")?;
            admit_element(&element)?;
            if closed && !matches!(element.tag.as_str(), "br" | "img" | "hr" | "col") {
                return Err(format!(
                    "Nonvoid raw HTML <{}> requires an explicit closing tag",
                    element.tag
                ));
            }
            let next = pos + consumed;
            out.push((pos..next, HtmlToken::Open(HtmlScope { element, closed })));
            pos = next;
        } else {
            let next = pos + rest.find('<').unwrap_or(rest.len());
            out.push((
                pos..next,
                HtmlToken::Text(decode_html_entities(&source[pos..next], false)),
            ));
            pos = next;
        }
    }
    Ok(out)
}

/// Lower a complete, admitted raw HTML island without fetching resources or serializing typed nodes.
pub fn raw_html_blocks(
    html: &str,
    resources: &BTreeMap<String, Vec<u8>>,
    inherited: &TextStyle,
) -> Result<Vec<Block>, String> {
    let mut images = HtmlImages::new(resources, crate::Format::Docx);
    cooperate::block_on(raw_html_blocks_async(html, &mut images, inherited))
}

pub(crate) async fn raw_html_nodes(
    html: &str,
    tokens: &[(Range<usize>, HtmlToken)],
    inherited: &TextStyle,
    forced_bold: bool,
) -> Result<Vec<HtmlNode>, String> {
    let mut stack: Vec<HtmlScope> = Vec::new();
    for (_, token) in tokens {
        let parent = stack.last().map(HtmlScope::tag);
        if let HtmlToken::Open(scope) = &token {
            let tag = scope.tag();
            if tag == "pre" {
                let mut style = inherited.clone();
                for parent in &stack {
                    style = inline_style(&parent.element, &style);
                }
                style = inline_style(&scope.element, &style);
                if style != TextStyle::default() {
                    return Err("Inherited raw HTML code styles require an export plugin".into());
                }
            }
            if tag == "a" && stack.iter().any(|scope| scope.tag() == "a") {
                return Err("Nested raw HTML links are unsupported".into());
            }
            if scope.resets_bold()
                && (scope.forces_bold()
                    || stack.iter().any(HtmlScope::forces_bold)
                    || forced_bold
                        && !stack
                            .iter()
                            .any(|scope| attr(&scope.element, "role") == Some("doc-endnotes")))
            {
                return Err(
                    "Raw HTML header font-weight overrides require an export plugin".into(),
                );
            }
            let allowed_child = match parent {
                Some("table") => matches!(
                    tag,
                    "caption" | "colgroup" | "thead" | "tbody" | "tfoot" | "tr"
                ),
                Some("thead" | "tbody" | "tfoot") => tag == "tr",
                Some("tr") => matches!(tag, "td" | "th"),
                Some("colgroup") => tag == "col",
                Some("ul" | "ol") => tag == "li",
                Some("pre") => {
                    tag == "code"
                        && scope.element.attrs.iter().all(|(name, _)| {
                            name.eq_ignore_ascii_case("class") || name.eq_ignore_ascii_case("lang")
                        })
                }
                _ if stack.iter().any(|scope| scope.tag() == "pre") => false,
                _ => true,
            };
            let allowed_parent = match tag {
                "caption" | "colgroup" | "thead" | "tbody" | "tfoot" => parent == Some("table"),
                "tr" => matches!(parent, Some("table" | "thead" | "tbody" | "tfoot")),
                "td" | "th" => parent == Some("tr"),
                "col" => parent == Some("colgroup"),
                "li" => matches!(parent, Some("ul" | "ol")),
                "dt" | "dd" => parent == Some("dl"),
                _ => true,
            };
            if !allowed_child || !allowed_parent {
                return Err(format!(
                    "Unsupported raw HTML structure: <{tag}> inside {}",
                    parent.unwrap_or("document")
                ));
            }
        } else if let HtmlToken::Text(text) = &token {
            if !text.trim().is_empty()
                && matches!(
                    parent,
                    Some("table" | "thead" | "tbody" | "tfoot" | "tr" | "colgroup" | "ul" | "ol")
                )
            {
                return Err("Unsupported raw HTML text outside a table cell or list item".into());
            }
        }
        match token {
            HtmlToken::Open(scope) if !scope.is_void() => {
                if stack.len() >= 96 {
                    return Err("E_LIMIT: Document nesting limit exceeded".into());
                }
                stack.push(scope.clone());
            }
            HtmlToken::Close(tag) => {
                if stack.pop().as_ref().map(HtmlScope::tag) != Some(tag.as_str()) {
                    return Err(format!("Unbalanced raw HTML closing tag </{tag}>"));
                }
            }
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err("Unclosed raw HTML element".into());
    }
    bounded_html_dom(html).ok_or("E_LIMIT: Document nesting limit exceeded".into())
}

pub(crate) async fn raw_html_blocks_async(
    html: &str,
    resources: &mut HtmlImages<'_>,
    inherited: &TextStyle,
) -> Result<Vec<Block>, String> {
    let tokens = html_tokens(html)?;
    let nodes = raw_html_nodes(html, &tokens, inherited, false).await?;
    let notes = html_notes(&nodes, inherited, 1_000_000, 95, 64 * 1024 * 1024).await?;
    resources
        .admit_nodes(&nodes, 1_000_000, 95, usize::MAX, 64 * 1024 * 1024, &notes)
        .await?;
    let document = Document {
        title: String::new(),
        blocks: blocks(&nodes, inherited, resources, &notes, false)?,
    };
    document_ast_rust::validate_async(&document).await?;
    Ok(document.blocks)
}

#[cfg(test)]
mod image_admission_tests {
    use super::*;
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };

    fn drive<F: Future>(future: F) -> (F::Output, usize) {
        let mut future = pin!(future);
        let mut context = Context::from_waker(Waker::noop());
        let mut yields = 0;
        loop {
            match future.as_mut().poll(&mut context) {
                Poll::Ready(value) => return (value, yields),
                Poll::Pending => yields += 1,
            }
        }
    }
    fn resources() -> BTreeMap<String, Vec<u8>> {
        let mut state = 7u32;
        let pixels: Vec<_> = (0..128 * 128 * 4)
            .map(|_| {
                state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                (state >> 24) as u8
            })
            .collect();
        BTreeMap::from([(
            "pixel.png".into(),
            terminal_png_rust::png::encode(128, 128, &pixels).unwrap(),
        )])
    }

    #[test]
    fn repeated_note_text_is_bounded_before_lowering_copies_it() {
        let source = format!(
            "<p>{}</p><section role='doc-endnotes'><ol><li id='note'><p>{}</p></li></ol></section>",
            "<a role='doc-noteref' href='#note'>1</a>".repeat(65),
            "x".repeat(1024 * 1024)
        );
        let nodes = bounded_html_dom(&source).unwrap();
        let (result, _) = drive(html_notes(
            &nodes,
            &TextStyle::default(),
            1000,
            95,
            64 * 1024 * 1024,
        ));
        assert!(result.unwrap_err().contains("expanded text"));
    }

    #[test]
    fn html_header_admission_yields_and_repeated_sources_are_cached() {
        let resources = resources();
        let one = bounded_html_dom("<p><img src='pixel.png'></p>").unwrap();
        let two = bounded_html_dom("<p><img src='pixel.png'><img src='pixel.png'></p>").unwrap();
        let (document, first) = drive(from_html_nodes_async(
            &one,
            &resources,
            100,
            95,
            10,
            1024 * 1024,
            crate::Format::Docx,
        ));
        document.unwrap();
        assert!(first > 16, "PNG CRC work must yield to the host");
        let (document, repeated) = drive(from_html_nodes_async(
            &two,
            &resources,
            100,
            95,
            10,
            1024 * 1024,
            crate::Format::Docx,
        ));
        document.unwrap();
        assert!(
            repeated <= first + 8,
            "repeated source rescanned: {first} then {repeated}"
        );
    }

    #[test]
    fn raw_block_and_inline_paths_share_cooperative_image_admission() {
        let resources = resources();
        let mut images = HtmlImages::new(&resources, crate::Format::Docx);
        let style = TextStyle::default();
        let source = "<p><img src='pixel.png'></p>";
        let (blocks, first) = drive(raw_html_blocks_async(source, &mut images, &style));
        blocks.unwrap();
        assert!(first > 16, "raw block CRC work must yield");
        let (blocks, cached) = drive(raw_html_blocks_async(source, &mut images, &style));
        blocks.unwrap();
        assert!(
            first > cached + 16,
            "raw blocks must retain their admitted header cache"
        );
        let HtmlToken::Open(scope) = &html_tokens("<img src='pixel.png'>").unwrap()[0].1 else {
            panic!()
        };
        let (inlines, cached) = drive(scope.finish_inlines_async(vec![], &style, &mut images));
        assert!(matches!(&inlines.unwrap()[0], Inline::Image(_)));
        assert_eq!(cached, 0, "raw inline must reuse the same admitted source");
        let mut fresh = HtmlImages::new(&resources, crate::Format::Docx);
        let (inlines, first) = drive(scope.finish_inlines_async(vec![], &style, &mut fresh));
        inlines.unwrap();
        assert!(first > 16, "raw inline CRC work must yield");
    }
}
