use super::{MdqDefinitions, PandocAttr, PandocBlock, PandocInline, parse_pandoc_md_inlines};
use mcp_protocol_rust::unicode::general_category;
use std::collections::{HashMap, HashSet};

pub(super) fn atx(line: &str) -> Option<(usize, &str)> {
    let level = line.bytes().take_while(|&byte| byte == b'#').count();
    if !(1..=6).contains(&level) || line.len() > level && !line[level..].starts_with([' ', '\t']) {
        return None;
    }
    let mut content = line[level..].trim_matches([' ', '\t']);
    let end = content.trim_end_matches('#').len();
    if end < content.len() && (end == 0 || content[..end].ends_with([' ', '\t'])) {
        content = content[..end].trim_end_matches([' ', '\t']);
    }
    Some((level, content))
}

fn whitespace(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\r' | '\u{000c}')
}

fn heading_whitespace(character: char) -> bool {
    character == '\u{feff}' || character != '\u{0085}' && character.is_whitespace()
}

pub(super) fn attributes(source: &str) -> Option<PandocAttr> {
    let inner = source.strip_prefix('{')?.strip_suffix('}')?;
    let mut rest = inner;
    let mut attr = PandocAttr::default();
    while !rest.is_empty() {
        rest = rest.trim_start_matches(whitespace);
        if rest.is_empty() {
            break;
        }
        let end = rest
            .find(|ch: char| whitespace(ch) || ch == '=')
            .unwrap_or(rest.len());
        let name = &rest[..end];
        if name.is_empty() {
            return None;
        }
        rest = &rest[end..];
        if let Some(tail) = rest.strip_prefix('=') {
            rest = tail;
            let quote = rest.chars().next().filter(|&ch| matches!(ch, '\'' | '"'));
            if quote.is_some() {
                rest = &rest[1..];
            }
            let mut value = String::new();
            while let Some(ch) = rest.chars().next() {
                if quote.map_or_else(|| whitespace(ch), |quote| ch == quote) {
                    break;
                }
                rest = &rest[ch.len_utf8()..];
                if ch == '\\'
                    && let Some(next) = rest.chars().next()
                    && (Some(next) == quote || next == '\\')
                {
                    value.push(next);
                    rest = &rest[next.len_utf8()..];
                } else {
                    value.push(ch);
                }
            }
            if let Some(quote) = quote {
                rest = rest.strip_prefix(quote)?;
            }
            attr.properties.push((name.into(), value));
        } else if let Some(id) = name.strip_prefix('#').filter(|id| !id.is_empty()) {
            attr.id = id.into();
        } else if let Some(class) = name.strip_prefix('.').filter(|class| !class.is_empty()) {
            attr.classes.push(class.into());
        } else {
            return None;
        }
        if rest.chars().next().is_some_and(|ch| !whitespace(ch)) {
            return None;
        }
    }
    Some(attr)
}

pub(super) fn read(
    level: usize,
    source: &str,
    defs: &MdqDefinitions,
    raw_html: bool,
) -> Option<PandocBlock> {
    let mut content = source.trim_end_matches([' ', '\t']);
    let mut attr = PandocAttr::default();
    let attribute_source = content.trim_end_matches(heading_whitespace);
    if defs.pandoc_header_attributes && attribute_source.ends_with('}') {
        let mut characters = attribute_source.char_indices();
        while let Some((at, ch)) = characters.next() {
            if ch == '\\' {
                characters.next();
            } else if ch == '{'
                && let Some(parsed) = attributes(&attribute_source[at..])
            {
                attr = parsed;
                // JavaScript trims the heading text before valid attributes using
                // String.trimEnd, while attribute tokens use ASCII whitespace.
                content = content[..at].trim_end_matches(heading_whitespace);
                break;
            }
        }
    }
    Some(PandocBlock::Header(
        level,
        attr,
        parse_pandoc_md_inlines(content, Some(defs), raw_html)?,
    ))
}

fn heading_text(nodes: &[PandocInline], text: &mut String) {
    for node in nodes {
        match node {
            PandocInline::Text(value) | PandocInline::Code(_, value) => text.push_str(value),
            PandocInline::Space | PandocInline::SoftBreak | PandocInline::LineBreak => {
                text.push(' ')
            }
            PandocInline::Strong(children)
            | PandocInline::Emph(children)
            | PandocInline::Strikeout(children)
            | PandocInline::Subscript(children)
            | PandocInline::Superscript(children)
            | PandocInline::SmallCaps(children)
            | PandocInline::Quoted(_, children)
            | PandocInline::Span(_, children)
            | PandocInline::Link(_, children, _, _)
            | PandocInline::Image(_, children, _, _) => heading_text(children, text),
            PandocInline::Raw(_, _) | PandocInline::Note(_) => {}
            PandocInline::NoteReference(label) => {
                text.push_str("[^");
                text.push_str(label);
                text.push(']');
            }
        }
    }
}
fn identifier(nodes: &[PandocInline], gfm: bool) -> String {
    let mut text = String::new();
    heading_text(nodes, &mut text);
    let mut identifier = String::new();
    let mut started = gfm;
    for character in text.to_lowercase().chars() {
        let category = general_category(character).as_bytes()[0];
        if !started {
            if category != b'L' {
                continue;
            }
            started = true;
        }
        if matches!(category, b'L' | b'N')
            || matches!(character, '_' | '-')
            || if gfm {
                category == b'M'
            } else {
                character == '.'
            }
        {
            identifier.push(character);
        } else if matches!(character, ' ' | '\n') {
            identifier.push('-');
        }
    }
    if !gfm && identifier.is_empty() {
        identifier.push_str("section");
    }
    identifier
}

// Match the HTML writer's passive attribute vocabulary; authored attributes
// remain unchanged in JSON and are checked only when writing HTML.
pub(super) fn prepare_html_attributes(attr: &mut PandocAttr) -> Result<(), &'static str> {
    let mut seen = HashSet::from(["id", "class"]);
    let mut style = Vec::new();
    for (key, value) in &attr.properties {
        if !seen.insert(key.as_str()) {
            return Err("E_CAPABILITY: Unsupported HTML attribute\n");
        }
        if key == "style" {
            for declaration in value.split(';').filter(|value| !value.trim().is_empty()) {
                let Some((property, setting)) = declaration.split_once(':') else {
                    return Err("E_CAPABILITY: Unsupported HTML style\n");
                };
                let property = property.trim().to_ascii_lowercase();
                let setting = setting.trim().to_ascii_lowercase();
                if !(property == "direction" && matches!(setting.as_str(), "ltr" | "rtl")
                    || property == "unicode-bidi"
                        && matches!(setting.as_str(), "isolate" | "isolate-override"))
                {
                    return Err("E_CAPABILITY: Unsupported HTML style\n");
                }
                style.push(format!("{property}:{setting}"));
            }
        } else {
            if !(matches!(key.as_str(), "title" | "lang" | "dir" | "role" | "scope")
                || key.starts_with("data-")
                || key.starts_with("aria-"))
                || !key
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            {
                return Err("E_CAPABILITY: Unsupported HTML attribute\n");
            }
            if key == "dir" && !matches!(value.as_str(), "ltr" | "rtl" | "auto") {
                return Err("E_CAPABILITY: Invalid HTML direction\n");
            }
        }
        if value.contains('\0') {
            return Err("E_CAPABILITY: NUL cannot be represented in HTML\n");
        }
    }
    if attr.id.contains('\0') || attr.classes.iter().any(|class| class.contains('\0')) {
        return Err("E_CAPABILITY: NUL cannot be represented in HTML\n");
    }
    attr.properties.retain(|(key, _)| key != "style");
    if !style.is_empty() {
        attr.properties.push(("style".into(), style.join(";")));
    }
    Ok(())
}

pub(super) fn assign(blocks: &mut [PandocBlock], defs: &MdqDefinitions) {
    struct Identifiers {
        used: HashSet<String>,
        counts: HashMap<String, usize>,
        auto: bool,
        gfm: bool,
    }
    impl Identifiers {
        fn inlines(&mut self, nodes: &mut [PandocInline]) {
            for node in nodes {
                match node {
                    PandocInline::Note(blocks) => self.blocks(blocks),
                    PandocInline::Strong(children)
                    | PandocInline::Emph(children)
                    | PandocInline::Strikeout(children)
                    | PandocInline::Subscript(children)
                    | PandocInline::Superscript(children)
                    | PandocInline::SmallCaps(children)
                    | PandocInline::Quoted(_, children)
                    | PandocInline::Span(_, children)
                    | PandocInline::Link(_, children, _, _)
                    | PandocInline::Image(_, children, _, _) => self.inlines(children),
                    _ => {}
                }
            }
        }
        fn blocks(&mut self, blocks: &mut [PandocBlock]) {
            for block in blocks {
                match block {
                    PandocBlock::Header(_, attr, nodes) => {
                        self.inlines(nodes);
                        if attr.id.is_empty() && (self.auto || self.gfm) {
                            let base = identifier(nodes, self.gfm);
                            let count = self.counts.entry(base.clone()).or_default();
                            let mut id = base.clone();
                            if self.gfm {
                                if *count != 0 {
                                    id = format!("{base}-{count}");
                                }
                                *count += 1;
                            } else if self.used.contains(&id) {
                                *count = (*count).max(1);
                                loop {
                                    id = format!("{base}-{count}");
                                    *count += 1;
                                    if !self.used.contains(&id) {
                                        break;
                                    }
                                }
                            }
                            attr.id = id;
                        }
                        if !self.gfm && !attr.id.is_empty() {
                            self.used.insert(attr.id.clone());
                        }
                    }
                    PandocBlock::Para(nodes) | PandocBlock::Plain(nodes) => self.inlines(nodes),
                    PandocBlock::Figure(_, short, caption, children) => {
                        if let Some(short) = short {
                            self.inlines(short);
                        }
                        self.blocks(caption);
                        self.blocks(children);
                    }
                    PandocBlock::BlockQuote(blocks) | PandocBlock::Div(_, blocks) => {
                        self.blocks(blocks)
                    }
                    PandocBlock::List(_, items) => {
                        for blocks in items {
                            self.blocks(blocks);
                        }
                    }
                    PandocBlock::Table(table) => {
                        for cell in table.head.iter_mut().chain(&mut table.body).flatten() {
                            self.blocks(&mut cell.blocks);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    Identifiers {
        used: HashSet::new(),
        counts: HashMap::new(),
        auto: defs.pandoc_auto_identifiers,
        gfm: defs.pandoc_gfm_auto_identifiers,
    }
    .blocks(blocks);
}

pub(super) fn shift(blocks: &mut [PandocBlock], amount: i32) {
    fn inlines(nodes: &mut [PandocInline], amount: i32) {
        for node in nodes {
            match node {
                PandocInline::Note(blocks) => shift(blocks, amount),
                PandocInline::Strong(children)
                | PandocInline::Emph(children)
                | PandocInline::Strikeout(children)
                | PandocInline::Subscript(children)
                | PandocInline::Superscript(children)
                | PandocInline::SmallCaps(children)
                | PandocInline::Quoted(_, children)
                | PandocInline::Span(_, children)
                | PandocInline::Link(_, children, _, _)
                | PandocInline::Image(_, children, _, _) => inlines(children, amount),
                _ => {}
            }
        }
    }
    for block in blocks {
        if let PandocBlock::Header(level, _, nodes) = block {
            let adjusted = (*level as i32) + amount;
            if adjusted < 1 {
                *block = PandocBlock::Para(std::mem::take(nodes));
            } else {
                *level = adjusted.min(6) as usize;
            }
        }
        match block {
            PandocBlock::Header(_, _, nodes)
            | PandocBlock::Para(nodes)
            | PandocBlock::Plain(nodes) => inlines(nodes, amount),
            PandocBlock::Figure(_, short, caption, children) => {
                if let Some(short) = short {
                    inlines(short, amount);
                }
                shift(caption, amount);
                shift(children, amount);
            }
            PandocBlock::BlockQuote(blocks) | PandocBlock::Div(_, blocks) => shift(blocks, amount),
            PandocBlock::List(_, items) => {
                for blocks in items {
                    shift(blocks, amount);
                }
            }
            PandocBlock::Table(table) => {
                for cell in table.head.iter_mut().chain(&mut table.body).flatten() {
                    shift(&mut cell.blocks, amount);
                }
            }
            _ => {}
        }
    }
}
