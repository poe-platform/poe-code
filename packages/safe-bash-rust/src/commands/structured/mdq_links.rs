use super::mdq_decode_syntax;
use std::collections::HashMap;
use std::fmt::{self, Write};

#[derive(Clone, Debug, Default)]
pub(super) struct Target {
    pub url: String,
    pub title: String,
    pub reference: Option<(String, Style)>,
    pub auto: Option<Auto>,
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.url)?;
        if !self.title.is_empty() {
            let quote = if self.title.contains('"') { '\'' } else { '"' };
            write!(f, " {quote}{}{quote}", self.title)?;
        }
        Ok(())
    }
}

fn skip_space(bytes: &[u8], start: usize) -> usize {
    start
        + bytes[start..]
            .iter()
            .take_while(|c| matches!(c, b' ' | b'\t' | b'\r' | b'\n'))
            .count()
}

fn destination(raw: &str) -> Option<(&str, usize)> {
    let bytes = raw.as_bytes();
    let angle = bytes.first() == Some(&b'<');
    let start = usize::from(angle);
    let mut i = start;
    let mut depth = 0;
    while let Some(&b) = bytes.get(i) {
        if b == b'\\' && bytes.get(i + 1).is_some_and(u8::is_ascii_punctuation) {
            i += 2;
            continue;
        }
        if angle {
            if b == b'>' {
                return Some((&raw[start..i], i + 1));
            }
            if matches!(b, b'<' | b'\n' | b'\r') {
                return None;
            }
        } else {
            if b.is_ascii_whitespace() || b == b')' && depth == 0 {
                break;
            }
            if b.is_ascii_control() {
                return None;
            }
            if b == b'(' {
                depth += 1;
            }
            if b == b')' {
                depth -= 1;
            }
        }
        i += 1;
    }
    (!angle && depth == 0).then(|| (&raw[..i], i))
}

fn title(raw: &str) -> Result<(&str, usize), usize> {
    let bytes = raw.as_bytes();
    let close = match bytes.first().ok_or(0usize)? {
        b'\'' => b'\'',
        b'"' => b'"',
        b'(' => b')',
        _ => return Err(0),
    };
    let mut i = 1;
    while let Some(&c) = bytes.get(i) {
        if c == close {
            return Ok((&raw[1..i], i + 1));
        }
        if close == b')' && c == b'(' {
            return Err(i);
        }
        i += if c == b'\\' && bytes.get(i + 1).is_some_and(u8::is_ascii_punctuation) {
            2
        } else {
            1
        };
    }
    Err(i)
}

impl Target {
    fn decode(url: &str, title: &str) -> Self {
        Self {
            url: Self::encode_uri(&mdq_decode_syntax(url)),
            title: mdq_decode_syntax(title),
            ..Self::default()
        }
    }

    fn encode_uri(url: &str) -> String {
        let mut encoded = String::new();
        for b in url.bytes() {
            if b.is_ascii_alphanumeric() || b";/?:@&=+$,-_.!~*'()#%".contains(&b) {
                encoded.push(b as char);
            } else {
                write!(encoded, "%{b:02X}").unwrap();
            }
        }
        encoded
    }

    // The input starts just after the opening parenthesis.
    pub(super) fn inline(raw: &str) -> Option<(Self, usize)> {
        let bytes = raw.as_bytes();
        let begin = skip_space(bytes, 0);
        let with_title = |url, at| {
            let (value, used) = title(&raw[at..]).ok()?;
            let end = skip_space(bytes, at + used);
            (bytes.get(end) == Some(&b')')).then(|| (Self::decode(url, value), end + 1))
        };
        if let Some((url, used)) = destination(&raw[begin..]) {
            let after = begin + used;
            let gap = skip_space(bytes, after);
            if bytes.get(gap) == Some(&b')') {
                return Some((Self::decode(url, ""), gap + 1));
            }
            if gap > after
                && let Some(result) = with_title(url, gap)
            {
                return Some(result);
            }
        }
        if begin > 0 {
            with_title("", begin)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Auto {
    Bracketed,
    Bare,
    Www,
}

impl Target {
    pub fn auto_text(&self) -> Option<String> {
        match self.auto? {
            Auto::Bracketed => Some(format!("<{}>", self.url)),
            Auto::Bare => Some(self.url.clone()),
            Auto::Www => None,
        }
    }
}

pub(super) fn autolink(src: &str, at: usize, in_brackets: bool) -> Option<(&str, Target, usize)> {
    let raw = &src[at..];
    let (label, end, style) = if let Some(after) = raw.strip_prefix('<') {
        let end = after
            .bytes()
            .position(|b| b <= 32 || matches!(b, b'<' | b'>'))?;
        if after.as_bytes()[end] != b'>' {
            return None;
        }
        let label = &after[..end];
        let scheme = label.split_once(':').is_some_and(|(s, _)| {
            (2..=32).contains(&s.len())
                && s.as_bytes()[0].is_ascii_alphabetic()
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"+.-".contains(&c))
        });
        if !scheme
            && !label.split_once('@').is_some_and(|(user, host)| {
                !user.is_empty()
                    && user
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b".!#$%&'*+/=?^_`{|}~-".contains(&c))
                    && host.split('.').all(|p| {
                        (1..=63).contains(&p.len())
                            && !p.starts_with('-')
                            && !p.ends_with('-')
                            && p.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                    })
            })
        {
            return None;
        }
        (label, end + 2, Auto::Bracketed)
    } else {
        if in_brackets {
            return None;
        }
        let prev = src[..at].chars().next_back();
        use super::mdq_emphasis::space;
        let scheme = prev
            .is_none_or(|c| space(c) || "*_~(".contains(c))
            .then(|| {
                ["https://", "http://", "ftp://", "www."]
                    .into_iter()
                    .find(|p| raw.starts_with(p))
            })
            .flatten();
        if let Some(prefix) = scheme {
            let www = prefix == "www.";
            let stop = raw.find(|c| space(c) || c == '<').unwrap_or(raw.len());
            let mut label = &raw[..stop];
            let mut balance = label.bytes().fold(0isize, |n, b| {
                n + isize::from(b == b'(') - isize::from(b == b')')
            });
            loop {
                if label.ends_with(['?', '!', '.', ',', ':', '*', '_', '~']) {
                    label = &label[..label.len() - 1];
                } else if label.ends_with(')') && balance < 0 {
                    label = &label[..label.len() - 1];
                    balance += 1;
                } else if let Some(tail) = label.strip_suffix(';') {
                    let head = tail.trim_end_matches(|c: char| c.is_ascii_alphanumeric());
                    if head.len() == tail.len() || !head.ends_with('&') {
                        break;
                    }
                    label = &head[..head.len() - 1];
                } else {
                    break;
                }
            }
            let domain = label
                .get(if www { 0 } else { prefix.len() }..)?
                .split(['/', ':', '?', '#'])
                .next()?;
            let mut parts = domain.rsplit('.');
            if !(0..2).all(|_| {
                parts
                    .next()
                    .is_some_and(|s| !s.is_empty() && !s.contains('_'))
            }) || parts.any(str::is_empty)
            {
                return None;
            }
            (label, label.len(), if www { Auto::Www } else { Auto::Bare })
        } else {
            let local = |b: u8| b.is_ascii_alphanumeric() || b".-_+".contains(&b);
            if prev.is_some_and(|c| c.is_ascii() && local(c as u8)) {
                return None;
            }
            let n = raw.bytes().take_while(|b| local(*b)).count();
            if n == 0 || raw.as_bytes().get(n) != Some(&b'@') {
                return None;
            }
            let domain = &raw[n + 1..];
            let end = domain
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || b".-_".contains(c))
                .count();
            let domain = domain[..end].trim_end_matches('.');
            let end = n + 1 + domain.len();
            if !domain.contains('.')
                || domain.ends_with(['-', '_'])
                || raw.as_bytes().get(end) == Some(&b'+')
            {
                return None;
            }
            (&raw[..end], end, Auto::Bare)
        }
    };
    let url = if style == Auto::Www {
        format!("http://{}", Target::encode_uri(label))
    } else {
        label.into()
    };
    Some((
        label,
        Target {
            url,
            auto: Some(style),
            ..Target::default()
        },
        end,
    ))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Style {
    Full,
    Collapsed,
    Shortcut,
}

pub(super) type Definitions = HashMap<String, Target>;

fn normalized(label: &str) -> String {
    let mut folded = String::new();
    let mut gap = false;
    for c in label.chars() {
        if matches!(c, ' ' | '\t' | '\r' | '\n') {
            gap = !folded.is_empty();
            continue;
        }
        if gap {
            folded.push(' ');
            gap = false;
        }
        // Full case folding expands ligatures and unifies positional letter forms.
        if c == 'ı' {
            folded.push(c);
        } else {
            folded.extend(
                c.to_lowercase()
                    .flat_map(char::to_uppercase)
                    .flat_map(char::to_lowercase),
            );
        }
    }
    folded
}

fn label(raw: &str) -> Option<(&str, usize)> {
    let mut chars = raw.strip_prefix('[')?.char_indices().peekable();
    let mut count = 0;
    while let Some((at, c)) = chars.next() {
        if c == ']' {
            return Some((&raw[1..at + 1], at + 2));
        }
        if c == '[' {
            return None;
        }
        if c == '\\' && chars.next_if(|(_, c)| c.is_ascii_punctuation()).is_some() {
            count += 1;
        }
        count += 1;
        if count > 999 {
            break;
        }
    }
    None
}

fn definition(raw: &str) -> Option<(String, Target, usize)> {
    let (key, after) = label(raw)?;
    if key
        .strip_prefix('^')
        .is_some_and(|note| !note.is_empty() && !note.contains([' ', '\t', '\n']))
    {
        return None;
    }
    let key = normalized(key);
    if key.is_empty() || raw.as_bytes().get(after) != Some(&b':') {
        return None;
    }
    let start = skip_space(raw.as_bytes(), after + 1);
    let (url, used) = destination(&raw[start..])?;
    if used == 0 {
        return None;
    }
    let at = start + used;
    let end = raw[at..].find('\n').map_or(raw.len(), |n| at + n);
    let gap = skip_space(raw.as_bytes(), at);
    if gap == raw.len() {
        return Some((key, Target::decode(url, ""), gap));
    }
    if gap == at {
        return None;
    }
    let parsed = title(&raw[gap..]);
    if let Ok((value, taken)) = parsed {
        let tail = gap + taken;
        let line_end = raw[tail..].find('\n').map_or(raw.len(), |n| tail + n);
        if raw[tail..line_end].trim().is_empty() {
            return Some((
                key,
                Target::decode(url, value),
                (line_end + 1).min(raw.len()),
            ));
        }
    }
    let scanned = match parsed {
        Ok((_, n)) | Err(n) => n,
    };
    (gap + scanned > end).then(|| (key, Target::decode(url, ""), (end + 1).min(raw.len())))
}

pub(super) fn extract<'a>(mut paragraph: &'a str, defs: &mut Definitions) -> &'a str {
    while let Some((key, target, used)) = definition(paragraph) {
        defs.entry(key).or_insert(target);
        paragraph = &paragraph[used..];
    }
    paragraph
}

pub(super) fn reference(raw: &str, display: &str, defs: &Definitions) -> Option<(Target, usize)> {
    if defs.is_empty() {
        return None;
    }
    let explicit = label(raw);
    let (key, size, style) = match explicit {
        Some((key, n)) if !key.is_empty() => (key, n, Style::Full),
        _ => {
            let (_, n) = label(display)?;
            if n != display.len() {
                return None;
            }
            (
                &display[1..n - 1],
                explicit.map_or(0, |v| v.1),
                if explicit.is_some() {
                    Style::Collapsed
                } else {
                    Style::Shortcut
                },
            )
        }
    };
    let mut target = defs.get(&normalized(key))?.clone();
    target.reference = Some((key.to_string(), style));
    Some((target, size))
}

#[derive(Default)]
pub(super) struct References<'a> {
    pub format: &'a str,
    pub per_section: bool,
    pub targets: Vec<(String, Target)>,
    pub emitted: usize,
    indices: HashMap<String, usize>,
    numbers: HashMap<String, String>,
    next: usize,
}

impl<'a> References<'a> {
    pub fn new(format: &'a str, per_section: bool) -> Self {
        Self {
            format,
            per_section,
            next: 1,
            ..Self::default()
        }
    }

    pub fn suffix(&mut self, target: &Target) -> String {
        if self.format == "inline" || self.format == "keep" && target.reference.is_none() {
            return format!("({target})");
        }
        let mut fresh = || {
            let n = self.next;
            self.next += 1;
            n.to_string()
        };
        let id = match &target.reference {
            None => fresh(),
            Some((key, Style::Full))
                if self.format == "never-inline" && key.bytes().all(|b| b.is_ascii_digit()) =>
            {
                self.numbers
                    .entry(key.clone())
                    .or_insert_with(fresh)
                    .clone()
            }
            Some((key, _)) => key.clone(),
        };
        if let Some(&i) = self.indices.get(&id) {
            self.targets[i].1 = target.clone();
        } else {
            self.indices.insert(id.clone(), self.targets.len());
            self.targets.push((id.clone(), target.clone()));
        }
        match target.reference {
            Some((_, Style::Collapsed)) => "[]".into(),
            Some((_, Style::Shortcut)) => String::new(),
            _ => format!("[{id}]"),
        }
    }

    pub fn text(&mut self, src: &str, defs: &Definitions) -> String {
        if !super::mdq_has_links(src) {
            return super::mdq_text_span(src, false);
        }
        let mut text = String::new();
        super::mdq_inline_parts(
            defs,
            src,
            false,
            |t| self.suffix(t),
            |part, _| text.push_str(part),
        );
        text
    }

    pub fn write_pending(&mut self, w: &mut super::MdqWriter) {
        if self.emitted == self.targets.len() {
            return;
        }
        w.block(super::MdqLayout::Plain, |w| {
            let mut pending: Vec<_> = self.targets[self.emitted..].iter().collect();
            super::mdq_order::sort(&mut pending, |(a, _), (b, _)| {
                if [a, b].iter().all(|k| k.bytes().all(|c| c.is_ascii_digit())) {
                    a.parse::<f64>().unwrap() < b.parse::<f64>().unwrap()
                } else {
                    a.encode_utf16().lt(b.encode_utf16())
                }
            });
            for (i, (id, target)) in pending.into_iter().enumerate() {
                if i != 0 {
                    w.write("\n", true);
                }
                w.write(&format!("[{id}"), true);
                w.write(&format!("]: {target}"), false);
            }
        });
        self.emitted = self.targets.len();
    }
}
