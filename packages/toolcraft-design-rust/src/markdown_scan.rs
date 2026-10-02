//! UTF-16 lexical prerequisites for the Markdown parser. All indices are code units.
//! These follow Toolcraft's grammar, including its deliberately narrow whitespace rules.

#[derive(Debug, PartialEq)]
pub struct Code {
    pub value: Vec<u16>,
    pub end: usize,
}

#[derive(Debug, PartialEq)]
pub struct Label {
    pub content_start: usize,
    pub end: usize,
}

#[derive(Debug, PartialEq)]
pub struct Destination {
    pub url: Vec<u16>,
    pub title: Option<Vec<u16>>,
    pub end: usize,
}

#[derive(Debug, PartialEq)]
pub struct Autolink {
    pub url: Vec<u16>,
    pub text_start: usize,
    pub text_end: usize,
    pub end: usize,
}

pub fn ascii_letter(unit: u16) -> bool {
    matches!(unit, 65..=90 | 97..=122)
}

pub fn digit(unit: u16) -> bool {
    matches!(unit, 48..=57)
}

pub fn escapable(unit: u16) -> bool {
    matches!(unit, 33..=47 | 58..=64 | 91..=96 | 123..=126)
}

pub fn ascii_whitespace(unit: u16) -> bool {
    matches!(unit, 9 | 32)
}

pub fn decode_escapes(input: &[u16]) -> Vec<u16> {
    let mut value = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == 92 && input.get(index + 1).copied().is_some_and(escapable) {
            index += 1;
        }
        value.push(input[index]);
        index += 1;
    }
    value
}

pub fn offset_map(input: &[u16], absolute_start: f64) -> Vec<f64> {
    let mut offsets = vec![absolute_start; input.len() + 1];
    let mut byte_offset = absolute_start;
    let mut index = 0;
    while index < input.len() {
        offsets[index] = byte_offset;
        let unit = input[index];
        if (0xd800..=0xdbff).contains(&unit)
            && input
                .get(index + 1)
                .is_some_and(|low| (0xdc00..=0xdfff).contains(low))
        {
            offsets[index + 1] = byte_offset;
            byte_offset += 4.0;
            index += 2;
        } else {
            byte_offset += if unit <= 0x7f {
                1.0
            } else if unit <= 0x7ff {
                2.0
            } else {
                3.0
            };
            index += 1;
        }
        offsets[index] = byte_offset;
    }
    offsets
}

pub fn run_length(input: &[u16], start: usize, marker: u16) -> usize {
    input
        .get(start..)
        .unwrap_or_default()
        .iter()
        .take_while(|unit| **unit == marker)
        .count()
}

pub fn inline_code(input: &[u16], start: usize) -> Option<Code> {
    let fence = run_length(input, start, 96);
    if fence == 0 {
        return None;
    }
    let mut index = start + fence;
    while index < input.len() {
        if input[index] != 96 {
            index += 1;
            continue;
        }
        let closing = run_length(input, index, 96);
        if closing == fence {
            let mut value = &input[start + fence..index];
            if value.len() >= 2
                && value[0] == 32
                && value[value.len() - 1] == 32
                && (value[1] == 96 || value[value.len() - 2] == 96)
            {
                value = &value[1..value.len() - 1];
            }
            return Some(Code {
                value: value.to_vec(),
                end: index + fence,
            });
        }
        index += closing;
    }
    None
}

pub fn bracketed_label(input: &[u16], start: usize) -> Option<Label> {
    if input.get(start) != Some(&91) {
        return None;
    }
    let mut depth = 1;
    let mut index = start + 1;
    while index < input.len() {
        match input[index] {
            92 if index + 1 < input.len() => {
                index += 2;
                continue;
            }
            96 => {
                if let Some(code) = inline_code(input, index) {
                    index = code.end;
                    continue;
                }
            }
            91 => depth += 1,
            93 => {
                depth -= 1;
                if depth == 0 {
                    return Some(Label {
                        content_start: start + 1,
                        end: index + 1,
                    });
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn trim_ascii(input: &[u16]) -> &[u16] {
    let start = input
        .iter()
        .position(|unit| !ascii_whitespace(*unit))
        .unwrap_or(input.len());
    let end = input
        .iter()
        .rposition(|unit| !ascii_whitespace(*unit))
        .map_or(start, |index| index + 1);
    &input[start..end]
}

fn escaped(input: &[u16], index: usize) -> bool {
    input[..index]
        .iter()
        .rev()
        .take_while(|unit| **unit == 92)
        .count()
        % 2
        == 1
}

pub fn link_destination(input: &[u16], start: usize) -> Option<Destination> {
    if start >= input.len() {
        return None;
    }
    let mut depth = 1;
    let mut quote = None;
    let mut index = start + 1;
    while index < input.len() {
        let unit = input[index];
        if let Some(delimiter) = quote {
            if unit == 92 && index + 1 < input.len() {
                index += 2;
                continue;
            }
            if unit == delimiter {
                quote = None;
            }
            index += 1;
            continue;
        }
        match unit {
            92 if input.get(index + 1).copied().is_some_and(escapable) => {
                index += 2;
                continue;
            }
            34 | 39 => quote = Some(unit),
            40 => depth += 1,
            41 => {
                depth -= 1;
                if depth == 0 {
                    let (url, title) = destination_content(&input[start + 1..index]);
                    return Some(Destination {
                        url,
                        title,
                        end: index + 1,
                    });
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn destination_content(input: &[u16]) -> (Vec<u16>, Option<Vec<u16>>) {
    let end = input
        .iter()
        .rposition(|unit| !ascii_whitespace(*unit))
        .map_or(0, |index| index + 1);
    if end == 0 {
        return (vec![], None);
    }
    let quote = input[end - 1];
    if matches!(quote, 34 | 39)
        && let Some(title_start) = (0..end - 1)
            .rev()
            .find(|index| input[*index] == quote && !escaped(input, *index))
    {
        let mut separator = title_start;
        while separator > 0 && ascii_whitespace(input[separator - 1]) {
            separator -= 1;
        }
        if separator < title_start {
            return (
                decode_escapes(trim_ascii(&input[..separator])),
                Some(decode_escapes(&input[title_start + 1..end - 1])),
            );
        }
    }
    (decode_escapes(trim_ascii(&input[..end])), None)
}

pub fn angle_autolink(input: &[u16], start: usize) -> Option<Autolink> {
    if start >= input.len() {
        return None;
    }
    let mut index = start + 1;
    while index < input.len() && input[index] != 62 {
        if matches!(input[index], 60 | 10 | 32 | 9) {
            return None;
        }
        index += 1;
    }
    if index >= input.len() || index == start + 1 {
        return None;
    }
    let url = &input[start + 1..index];
    if url.len() < 3 || !ascii_letter(url[0]) {
        return None;
    }
    for position in 1..url.len() {
        let unit = url[position];
        if unit == 58 {
            return (position >= 2).then(|| Autolink {
                url: url.to_vec(),
                text_start: start + 1,
                text_end: index,
                end: index + 1,
            });
        }
        if !ascii_letter(unit) && !digit(unit) && !matches!(unit, 43 | 46 | 45) {
            return None;
        }
    }
    None
}

fn starts_with(input: &[u16], prefix: &[u8]) -> bool {
    input.len() >= prefix.len()
        && input
            .iter()
            .zip(prefix)
            .all(|(left, right)| *left == *right as u16)
}

fn email_local(unit: u16) -> bool {
    ascii_letter(unit) || digit(unit) || matches!(unit, 46 | 95 | 37 | 43 | 45)
}

fn valid_email(input: &[u16]) -> bool {
    let Some(at) = input.iter().position(|unit| *unit == 64) else {
        return false;
    };
    if at == 0 || at + 1 == input.len() {
        return false;
    }
    let domain = &input[at + 1..];
    domain[0] != 46
        && domain[domain.len() - 1] != 46
        && domain.contains(&46)
        && input[..at].iter().all(|unit| email_local(*unit))
        && domain
            .iter()
            .all(|unit| ascii_letter(*unit) || digit(*unit) || matches!(unit, 46 | 45))
}

pub fn literal_autolink(input: &[u16], start: usize) -> Option<Autolink> {
    if start >= input.len() {
        return None;
    }
    if start > 0 {
        let previous = input[start - 1];
        if (previous == 40 && start >= 2 && input[start - 2] == 93)
            || ascii_letter(previous)
            || digit(previous)
            || matches!(previous, 95 | 46 | 43 | 45 | 64 | 47)
        {
            return None;
        }
    }
    let tail = &input[start..];
    let prefix_length = if starts_with(tail, b"https://") {
        8
    } else if starts_with(tail, b"http://") {
        7
    } else {
        0
    };
    let www = starts_with(tail, b"www.");
    if prefix_length == 0 && !www && !email_local(tail[0]) {
        return None;
    }
    let mut end = start;
    while end < input.len() && !matches!(input[end], 10 | 60) && !ascii_whitespace(input[end]) {
        end += 1;
    }
    // Track bracket totals once. Trimming a closer updates only its own balance.
    let mut balances = [0_i64; 3];
    for unit in &input[start..end] {
        match unit {
            40 => balances[0] += 1,
            41 => balances[0] -= 1,
            91 => balances[1] += 1,
            93 => balances[1] -= 1,
            123 => balances[2] += 1,
            125 => balances[2] -= 1,
            _ => {}
        }
    }
    while end > start {
        match input[end - 1] {
            46 | 44 | 58 | 59 | 33 | 63 => end -= 1,
            41 if balances[0] < 0 => {
                end -= 1;
                balances[0] += 1;
            }
            93 if balances[1] < 0 => {
                end -= 1;
                balances[1] += 1;
            }
            125 if balances[2] < 0 => {
                end -= 1;
                balances[2] += 1;
            }
            _ => break,
        }
    }
    let text = &input[start..end];
    let url = if prefix_length > 0 && text.len() > prefix_length {
        text.to_vec()
    } else if www && text.get(4..).is_some_and(|rest| rest.contains(&46)) {
        "http://"
            .encode_utf16()
            .chain(text.iter().copied())
            .collect()
    } else if valid_email(text) {
        "mailto:"
            .encode_utf16()
            .chain(text.iter().copied())
            .collect()
    } else {
        return None;
    };
    Some(Autolink {
        url,
        text_start: start,
        text_end: end,
        end,
    })
}

fn skip_html_space(input: &[u16], start: usize) -> usize {
    start
        + input[start..]
            .iter()
            .take_while(|unit| ascii_whitespace(**unit))
            .count()
}

fn attribute_start(unit: u16) -> bool {
    ascii_letter(unit) || matches!(unit, 58 | 95)
}

fn ascii_lower(unit: u16) -> u16 {
    if (65..=90).contains(&unit) {
        unit + 32
    } else {
        unit
    }
}

const HTML_TAGS: &[&str] = &[
    "a",
    "abbr",
    "address",
    "article",
    "aside",
    "b",
    "base",
    "basefont",
    "bdi",
    "bdo",
    "blockquote",
    "body",
    "br",
    "button",
    "caption",
    "center",
    "cite",
    "code",
    "col",
    "colgroup",
    "data",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "div",
    "dl",
    "dt",
    "em",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "i",
    "img",
    "input",
    "ins",
    "kbd",
    "label",
    "legend",
    "li",
    "link",
    "main",
    "mark",
    "menu",
    "nav",
    "ol",
    "option",
    "p",
    "param",
    "pre",
    "q",
    "rp",
    "rt",
    "rtc",
    "ruby",
    "s",
    "samp",
    "search",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "time",
    "title",
    "tr",
    "u",
    "ul",
    "var",
    "wbr",
];

pub fn inline_html_end(input: &[u16], start: usize) -> Option<usize> {
    if input.get(start) != Some(&60) {
        return None;
    }
    let mut index = start + 1;
    let closing = input.get(index) == Some(&47);
    if closing {
        index += 1;
    }
    let tag_start = index;
    if !input.get(index).copied().is_some_and(ascii_letter) {
        return None;
    }
    index += 1;
    while index < input.len()
        && (ascii_letter(input[index]) || digit(input[index]) || input[index] == 45)
    {
        index += 1;
    }
    let tag: Vec<u16> = input[tag_start..index]
        .iter()
        .map(|unit| ascii_lower(*unit))
        .collect();
    if !HTML_TAGS
        .iter()
        .any(|name| tag.iter().copied().eq(name.bytes().map(u16::from)))
    {
        return None;
    }
    if closing {
        index = skip_html_space(input, index);
        return (input.get(index) == Some(&62)).then_some(index + 1);
    }
    while index < input.len() {
        index = skip_html_space(input, index);
        match input.get(index).copied()? {
            62 => {
                let tag_end = index + 1;
                for candidate in tag_end..input.len() {
                    if input[candidate] != 60 || input.get(candidate + 1) != Some(&47) {
                        continue;
                    }
                    let name_end = candidate + 2 + tag.len();
                    if input.get(candidate + 2..name_end).is_some_and(|name| {
                        name.iter().zip(&tag).all(|(a, b)| {
                            // JS lowercases each UTF-16 unit: Kelvin sign folds to ASCII k.
                            (if *a == 0x212a { 107 } else { ascii_lower(*a) }) == *b
                        })
                    }) {
                        let closing_end = skip_html_space(input, name_end);
                        if input.get(closing_end) == Some(&62) {
                            return Some(closing_end + 1);
                        }
                    }
                }
                return Some(tag_end);
            }
            47 => {
                let end = skip_html_space(input, index + 1);
                return (input.get(end) == Some(&62)).then_some(end + 1);
            }
            unit if attribute_start(unit) => {}
            _ => return None,
        }
        index += 1;
        while index < input.len()
            && (attribute_start(input[index])
                || digit(input[index])
                || matches!(input[index], 45 | 46))
        {
            index += 1;
        }
        index = skip_html_space(input, index);
        if input.get(index) != Some(&61) {
            continue;
        }
        index = skip_html_space(input, index + 1);
        let quote = *input.get(index)?;
        if matches!(quote, 34 | 39) {
            index += 1;
            while index < input.len() && input[index] != quote {
                index += 1;
            }
            if index >= input.len() {
                return None;
            }
            index += 1;
        } else {
            while index < input.len() && !ascii_whitespace(input[index]) && input[index] != 62 {
                if matches!(input[index], 34 | 39 | 60 | 61 | 96) {
                    return None;
                }
                index += 1;
            }
        }
    }
    None
}
