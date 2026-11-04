// du matches UTF-16 code units at the start of any path component.
pub(super) struct Pattern(Vec<Token>);

enum Token {
    Star,
    Any,
    Literal(u16),
    Class(bool, Vec<(u16, u16)>),
}

fn class(units: &[u16]) -> Option<(Token, usize)> {
    let mut i = 1;
    let negated = units.get(i).is_some_and(|&c| c == u16::from(b'!') || c == u16::from(b'^'));
    i += usize::from(negated);
    let mut ranges = Vec::new();
    let atom = |i: usize| -> Option<(u16, usize)> {
        let i = if units.get(i) == Some(&u16::from(b'\\')) && i + 1 < units.len() { i + 1 } else { i };
        Some((*units.get(i)?, i + 1))
    };
    let named = |i: usize| {
        if !units[i..].starts_with(&b"[:".map(u16::from)) { return None; }
        let end = i + 2 + units[i + 2..].windows(2).position(|pair| pair == b":]".map(u16::from))?;
        let name = String::from_utf16(&units[i + 2..end]).ok()?;
        Some((crate::commands::search::posix_class_ranges(&name)?, end + 2))
    };
    while i < units.len() {
        if units[i] == u16::from(b']') && !ranges.is_empty() {
            return Some((Token::Class(negated, ranges), i + 1));
        }
        if let Some((group, next)) = named(i) {
            ranges.extend(group.iter().map(|&(lo, hi)| (lo as u16, hi as u16)));
            i = next;
            continue;
        }
        let (lo, next) = atom(i)?;
        i = next;
        if units.get(i) == Some(&u16::from(b'-')) && units.get(i + 1).is_some_and(|&u| u != u16::from(b']')) && named(i + 1).is_none() {
            let (hi, next) = atom(i + 1)?;
            ranges.push((lo, hi));
            i = next;
        } else {
            ranges.push((lo, lo));
        }
    }
    None
}

impl Pattern {
    pub(super) fn new(text: &str) -> Self {
        let units: Vec<_> = text.encode_utf16().collect();
        let mut tokens = Vec::new();
        let mut i = 0;
        while i < units.len() {
            let unit = units[i];
            let (token, used) = match u8::try_from(unit) {
                Ok(b'*') => (Token::Star, 1),
                Ok(b'?') => (Token::Any, 1),
                Ok(b'[') => class(&units[i..]).unwrap_or((Token::Literal(unit), 1)),
                Ok(b'\\') if i + 1 < units.len() => (Token::Literal(units[i + 1]), 2),
                _ => (Token::Literal(unit), 1),
            };
            tokens.push(token);
            i += used;
        }
        Self(tokens)
    }

    pub(super) fn matches(&self, path: &[u16]) -> bool {
        let mut positions = vec![0];
        positions.extend(path.iter().enumerate().filter_map(|(i,&c)| (c == u16::from(b'/')).then_some(i + 1)));
        for token in &self.0 {
            if matches!(token, Token::Star) {
                let start = positions[0];
                positions.clear();
                positions.extend(start..=path.len());
            } else {
                positions.retain_mut(|i| {
                    let Some(&c) = path.get(*i) else { return false };
                    *i += 1;
                    match token {
                        Token::Literal(unit) => *unit == c,
                        Token::Any => true,
                        Token::Class(negated, ranges) => *negated != ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi),
                        Token::Star => unreachable!(),
                    }
                });
                if positions.is_empty() { return false; }
            }
        }
        positions.last() == Some(&path.len())
    }
}
