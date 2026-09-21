//! UTF16 file transformations and a dependency-free path glob automaton.
use std::collections::{BTreeSet, HashMap, VecDeque};

pub fn slice_lines(content: &[u16], offset: f64, limit: Option<f64>) -> Vec<u16> {
    if offset == 0.0 && limit.is_none() {
        return content.to_vec();
    }
    if limit == Some(0.0) {
        return vec![];
    }
    let mut start = 0;
    let mut skipped = 0.0;
    while skipped < offset {
        let Some(next) = content[start..].iter().position(|unit| *unit == 10) else {
            return vec![];
        };
        start += next + 1;
        skipped += 1.0;
    }
    let Some(limit) = limit else {
        return content[start..].to_vec();
    };
    let mut end = start;
    let mut taken = 0.0;
    while taken < limit {
        let Some(next) = content[end..].iter().position(|unit| *unit == 10) else {
            return content[start..].to_vec();
        };
        end += next + 1;
        taken += 1.0;
    }
    content[start..end].to_vec()
}

pub fn count_occurrences(text: &[u16], search: &[u16]) -> usize {
    if search.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut offset = 0;
    while let Some(index) = find(&text[offset..], search) {
        count += 1;
        offset += index + search.len();
    }
    count
}
fn find(text: &[u16], search: &[u16]) -> Option<usize> {
    if search.is_empty() {
        return Some(0);
    }
    let mut prefix = vec![0; search.len()];
    let mut matched = 0;
    for index in 1..search.len() {
        while matched > 0 && search[index] != search[matched] {
            matched = prefix[matched - 1];
        }
        if search[index] == search[matched] {
            matched += 1;
        }
        prefix[index] = matched;
    }
    matched = 0;
    for (index, unit) in text.iter().enumerate() {
        while matched > 0 && *unit != search[matched] {
            matched = prefix[matched - 1];
        }
        if *unit == search[matched] {
            matched += 1;
        }
        if matched == search.len() {
            return Some(index + 1 - matched);
        }
    }
    None
}

pub fn replace_text(text: &[u16], search: &[u16], replacement: &[u16], all: bool) -> Vec<u16> {
    if search.is_empty() {
        return text.to_vec();
    }
    let mut output = vec![];
    let mut offset = 0;
    while let Some(index) = find(&text[offset..], search) {
        let index = offset + index;
        let end = index + search.len();
        output.extend_from_slice(&text[offset..index]);
        if all {
            output.extend_from_slice(replacement);
        } else {
            let mut cursor = 0;
            while cursor < replacement.len() {
                if replacement[cursor] == 36 && cursor + 1 < replacement.len() {
                    match replacement[cursor + 1] {
                        36 => output.push(36),
                        38 => output.extend_from_slice(search),
                        96 => output.extend_from_slice(&text[..index]),
                        39 => output.extend_from_slice(&text[end..]),
                        _ => {
                            output.push(36);
                            cursor += 1;
                            continue;
                        }
                    }
                    cursor += 2;
                } else {
                    output.push(replacement[cursor]);
                    cursor += 1;
                }
            }
        }
        offset = end;
        if !all {
            break;
        }
    }
    output.extend_from_slice(&text[offset..]);
    output
}
pub fn image_mime(extension: &[u16]) -> Option<&'static str> {
    match String::from_utf16(extension).ok()?.as_str() {
        ".png" => Some("image/png"),
        ".jpg" | ".jpeg" => Some("image/jpeg"),
        ".gif" => Some("image/gif"),
        ".webp" => Some("image/webp"),
        ".bmp" => Some("image/bmp"),
        ".svg" => Some("image/svg+xml"),
        _ => None,
    }
}

#[derive(Clone, Debug)]
enum Token {
    Literal(u16),
    Any,
    Star,
    Globstar,
    GlobstarSlash,
    Class {
        negated: bool,
        ranges: Vec<(u16, u16)>,
        literal: Option<Vec<u16>>,
    },
    Negative {
        alternatives: Vec<usize>,
        anchored: bool,
        suffix: Option<usize>,
        cross_slash: bool,
    },
    Group {
        kind: u16,
        alternatives: Vec<usize>,
    },
}
#[derive(Debug)]
pub struct Glob {
    sequences: Vec<Vec<Token>>,
    root: usize,
    disabled: bool,
    base: Vec<u16>,
    static_path: Option<Vec<u16>>,
}
struct BraceExpansion {
    end: usize,
    values: Vec<Vec<u16>>,
}
struct Parser<'a> {
    input: &'a [u16],
    index: usize,
    sequences: Vec<Vec<Token>>,
    depth: usize,
    invalid: bool,
}
impl Glob {
    pub fn new(pattern: &[u16]) -> Result<Self, String> {
        let pattern = pattern.strip_prefix(&[46, 47]).unwrap_or(pattern);
        if pattern.len() > 16_384 {
            return Err("Glob pattern exceeds 16384 UTF16 units.".into());
        }
        let disabled = pattern.first() == Some(&33) && pattern.get(1) != Some(&40);
        let dynamic_pattern = pattern.iter().any(|unit| matches!(*unit, 42 | 63 | 92))
            || (pattern.contains(&91) && pattern.contains(&93))
            || (pattern.contains(&40)
                && pattern.contains(&41)
                && (pattern.contains(&124)
                    || pattern
                        .windows(2)
                        .any(|units| matches!(units[0], 33 | 43 | 64) && units[1] == 40)))
            || (pattern.contains(&123)
                && pattern.contains(&125)
                && (pattern.contains(&44) || pattern.windows(2).any(|units| units == [46, 46])));
        let dynamic = pattern
            .iter()
            .enumerate()
            .find(|(index, unit)| {
                matches!(**unit, 40 | 42 | 63 | 91 | 92 | 123)
                    || (matches!(**unit, 33 | 43 | 64) && pattern.get(index + 1) == Some(&40))
            })
            .map(|(index, _)| index)
            .unwrap_or(pattern.len());
        let base_end = pattern[..dynamic]
            .iter()
            .rposition(|unit| *unit == 47)
            .map(|index| index + 1)
            .unwrap_or(0);
        let base = pattern[..base_end].to_vec();
        let mut parser = Parser {
            input: pattern,
            index: 0,
            sequences: vec![],
            depth: 0,
            invalid: false,
        };
        let root = parser.sequence(&[])?;
        Ok(Self {
            sequences: parser.sequences,
            root,
            disabled: disabled || parser.invalid,
            base,
            static_path: if !disabled && !dynamic_pattern {
                Some(pattern.to_vec())
            } else {
                None
            },
        })
    }
    pub fn base(&self) -> &[u16] {
        &self.base
    }
    pub fn static_path(&self) -> Option<&[u16]> {
        self.static_path.as_deref()
    }
    /// Maximum descendant-directory depth after the static prefix, or unbounded.
    pub fn max_depth(&self) -> Option<usize> {
        if self.disabled {
            return Some(0);
        }
        self.sequence_depth(self.root)
            .map(|depth| depth.saturating_sub(self.base.iter().filter(|unit| **unit == 47).count()))
    }
    fn sequence_depth(&self, id: usize) -> Option<usize> {
        let mut depth = 0;
        for token in &self.sequences[id] {
            match token {
                Token::Literal(47) => depth += 1,
                Token::Class {
                    negated: false,
                    ranges,
                    ..
                } if ranges.iter().any(|(a, b)| *a <= 47 && 47 <= *b) => depth += 1,
                Token::Globstar | Token::GlobstarSlash => return None,
                Token::Negative {
                    cross_slash: true, ..
                } => return None,
                Token::Group { kind, alternatives } => {
                    let mut maximum = 0;
                    for id in alternatives {
                        maximum = maximum.max(self.sequence_depth(*id)?);
                    }
                    if matches!(*kind, 42 | 43) && maximum > 0 {
                        return None;
                    }
                    depth += maximum;
                }
                _ => {}
            }
        }
        Some(depth)
    }
    /// Match a path using '/' separators and with hidden files enabled.
    pub fn matches(&self, path: &[u16]) -> bool {
        if self.disabled {
            return false;
        }
        let mut matcher = Matcher {
            glob: self,
            input: path,
            cache: HashMap::new(),
        };
        matcher.sequence(self.root, 0).contains(&path.len())
    }
}
impl Parser<'_> {
    fn closing(&self, begin: usize, open: u16, close: u16) -> Option<usize> {
        let mut depth = 1;
        let mut index = begin;
        while let Some(&unit) = self.input.get(index) {
            if unit == 92 {
                index += 2;
                continue;
            }
            if unit == open {
                depth += 1;
            }
            if unit == close {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            index += 1;
        }
        None
    }
    fn sequence(&mut self, stops: &[u16]) -> Result<usize, String> {
        self.depth += 1;
        if self.depth > 64 {
            return Err("Glob nesting exceeds 64 levels.".into());
        }
        let mut tokens = vec![];
        while let Some(&unit) = self.input.get(self.index) {
            if stops.contains(&unit) {
                break;
            }
            self.index += 1;
            if matches!(unit, 33 | 42 | 43 | 63 | 64)
                && self.input.get(self.index) == Some(&40)
                && self.closing(self.index + 1, 40, 41).is_none()
            {
                self.invalid = true;
            }
            if matches!(unit, 33 | 42 | 43 | 63 | 64)
                && self.input.get(self.index) == Some(&40)
                && self.closing(self.index + 1, 40, 41).is_some()
            {
                self.index += 1;
                let begin = self.index;
                let alternatives = self.alternatives(41, 124)?;
                if unit == 33 {
                    let inner = &self.input[begin..self.index - 1];
                    let remaining = &self.input[self.index..];
                    let cross_slash = inner.contains(&47);
                    let anchored = cross_slash
                        || remaining.is_empty()
                        || remaining.iter().all(|unit| *unit == 41);
                    let has_suffix = inner.contains(&42)
                        && remaining.first() == Some(&46)
                        && remaining[1..]
                            .iter()
                            .all(|unit| !matches!(*unit, 46 | 47 | 92));
                    let suffix = if has_suffix {
                        let index = self.index;
                        let suffix = self.sequence(&[])?;
                        self.index = index;
                        Some(suffix)
                    } else {
                        None
                    };
                    tokens.push(Token::Negative {
                        alternatives,
                        anchored,
                        suffix,
                        cross_slash,
                    });
                } else {
                    tokens.push(Token::Group {
                        kind: unit,
                        alternatives,
                    });
                }
            } else {
                match unit {
                    34 => {
                        while let Some(&quoted) = self.input.get(self.index) {
                            self.index += 1;
                            if quoted == 34 {
                                break;
                            }
                            if quoted == 92 && self.index < self.input.len() {
                                tokens.push(Token::Literal(self.input[self.index]));
                                self.index += 1;
                            } else {
                                tokens.push(Token::Literal(quoted));
                            }
                        }
                    }
                    40 if self.closing(self.index, 40, 41).is_some() => {
                        let alternatives = self.alternatives(41, 124)?;
                        tokens.push(Token::Group {
                            kind: 64,
                            alternatives,
                        });
                    }
                    92 => {
                        if let Some(&escaped) = self.input.get(self.index) {
                            self.index += 1;
                            tokens.push(Token::Literal(escaped));
                        } else {
                            tokens.push(Token::Literal(92));
                        }
                    }
                    42 => {
                        let begin = self.index - 1;
                        while self.input.get(self.index) == Some(&42) {
                            self.index += 1;
                        }
                        let boundary_before = begin == 0 || self.input[begin - 1] == 47;
                        let boundary_after = self.index == self.input.len()
                            || self.input.get(self.index) == Some(&47);
                        if self.index - begin >= 2 && boundary_before && boundary_after {
                            if self.input.get(self.index) == Some(&47) {
                                self.index += 1;
                                tokens.push(Token::GlobstarSlash);
                            } else {
                                tokens.push(Token::Globstar);
                            }
                        } else {
                            tokens.push(Token::Star);
                        }
                    }
                    63 => tokens.push(Token::Any),
                    91 => tokens.push(self.class()),
                    123 => {
                        if self.closing(self.index, 123, 125).is_none() {
                            self.invalid = true;
                            tokens.push(Token::Literal(123));
                            continue;
                        }
                        if let Some(expansion) = self.range()? {
                            self.index = expansion.end;
                            let alternatives = expansion
                                .values
                                .into_iter()
                                .map(|value| {
                                    let id = self.sequences.len();
                                    self.sequences
                                        .push(value.into_iter().map(Token::Literal).collect());
                                    id
                                })
                                .collect();
                            tokens.push(Token::Group {
                                kind: 64,
                                alternatives,
                            });
                        } else {
                            let alternatives = self.alternatives(125, 44)?;
                            if alternatives.len() == 1 {
                                tokens.push(Token::Literal(123));
                                tokens.extend(self.sequences[alternatives[0]].clone());
                                tokens.push(Token::Literal(125));
                            } else {
                                tokens.push(Token::Group {
                                    kind: 64,
                                    alternatives,
                                });
                            }
                        }
                    }
                    _ => tokens.push(Token::Literal(unit)),
                }
            }
        }
        self.depth -= 1;
        let id = self.sequences.len();
        self.sequences.push(tokens);
        Ok(id)
    }
    fn alternatives(&mut self, close: u16, separator: u16) -> Result<Vec<usize>, String> {
        let mut alternatives = vec![];
        loop {
            alternatives.push(self.sequence(&[close, separator])?);
            match self.input.get(self.index) {
                Some(unit) if *unit == separator => self.index += 1,
                Some(unit) if *unit == close => {
                    self.index += 1;
                    return Ok(alternatives);
                }
                _ => return Err("Unclosed glob group.".into()),
            }
        }
    }
    fn class(&mut self) -> Token {
        let begin = self.index;
        let negated = matches!(self.input.get(self.index), Some(33 | 94));
        if negated {
            self.index += 1;
        }
        let mut ranges = vec![];
        while let Some(&unit) = self.input.get(self.index) {
            self.index += 1;
            if unit == 93 && !ranges.is_empty() {
                let body = &self.input[begin..self.index - 1];
                let literal = if !negated
                    && !body.iter().any(|unit| {
                        matches!(
                            *unit,
                            45 | 42
                                | 43
                                | 63
                                | 46
                                | 94
                                | 36
                                | 123
                                | 125
                                | 40
                                | 124
                                | 41
                                | 91
                                | 92
                                | 93
                        )
                    }) {
                    Some(self.input[begin - 1..self.index].to_vec())
                } else {
                    None
                };
                return Token::Class {
                    negated,
                    ranges,
                    literal,
                };
            }
            if unit == 91
                && self.input.get(self.index) == Some(&58)
                && let Some(end) = self.input[self.index + 1..]
                    .windows(2)
                    .position(|units| units == [58, 93])
            {
                let name =
                    String::from_utf16_lossy(&self.input[self.index + 1..self.index + 1 + end]);
                let named = match name.as_str() {
                    "alnum" => vec![(48, 57), (65, 90), (97, 122)],
                    "alpha" => vec![(65, 90), (97, 122)],
                    "ascii" => vec![(0, 127)],
                    "blank" => vec![(9, 9), (32, 32)],
                    "cntrl" => vec![(0, 31), (127, 127)],
                    "digit" => vec![(48, 57)],
                    "graph" => vec![(33, 126)],
                    "lower" => vec![(97, 122)],
                    "print" => vec![(32, 126)],
                    "punct" => vec![(33, 47), (58, 64), (91, 96), (123, 126)],
                    "space" => vec![(9, 13), (32, 32)],
                    "upper" => vec![(65, 90)],
                    "word" => vec![(48, 57), (65, 90), (95, 95), (97, 122)],
                    "xdigit" => vec![(48, 57), (65, 70), (97, 102)],
                    _ => vec![],
                };
                if !named.is_empty() {
                    ranges.extend(named);
                    self.index += end + 3;
                    continue;
                }
            }
            let start = if unit == 92 {
                let value = self.input.get(self.index).copied().unwrap_or(92);
                self.index += usize::from(self.index < self.input.len());
                value
            } else {
                unit
            };
            if self.input.get(self.index) == Some(&45)
                && self
                    .input
                    .get(self.index + 1)
                    .is_some_and(|unit| *unit != 93)
            {
                self.index += 1;
                let end = self.input[self.index];
                self.index += 1;
                ranges.push((start, end));
            } else {
                ranges.push((start, start));
            }
        }
        self.index = begin;
        Token::Literal(91)
    }
    fn range(&self) -> Result<Option<BraceExpansion>, String> {
        let Some(close) = self.input[self.index..]
            .iter()
            .position(|unit| *unit == 125)
        else {
            return Ok(None);
        };
        let value = String::from_utf16_lossy(&self.input[self.index..self.index + close]);
        let parts: Vec<_> = value.split("..").collect();
        if !(2..=3).contains(&parts.len()) {
            return Ok(None);
        }
        let numeric = parts[0]
            .parse::<i64>()
            .ok()
            .zip(parts[1].parse::<i64>().ok());
        let alphabetic = parts[0].chars().count() == 1
            && parts[1].chars().count() == 1
            && parts[0].chars().all(|c| c.is_ascii_alphabetic())
            && parts[1].chars().all(|c| c.is_ascii_alphabetic());
        let (start, end) = if let Some(pair) = numeric {
            pair
        } else if alphabetic {
            (
                i64::from(parts[0].as_bytes()[0]),
                i64::from(parts[1].as_bytes()[0]),
            )
        } else {
            return Ok(None);
        };
        let step = if parts.len() == 3 {
            parts[2]
                .parse::<i64>()
                .ok()
                .and_then(i64::checked_abs)
                .filter(|step| *step > 0)
                .unwrap_or(1)
        } else {
            1
        };
        let distance = (i128::from(end) - i128::from(start)).abs();
        if distance / i128::from(step) > 10_000 {
            return Err("Glob range exceeds 10000 alternatives.".into());
        }
        let padded = numeric.is_some()
            && parts[..2].iter().any(|part| {
                part.trim_start_matches('-').starts_with('0')
                    && part.trim_start_matches('-').len() > 1
            });
        let width = parts[..2].iter().map(|part| part.len()).max().unwrap_or(0);
        let mut values = vec![];
        let mut current = i128::from(start);
        let step = if start <= end {
            i128::from(step)
        } else {
            -i128::from(step)
        };
        loop {
            let text = if alphabetic {
                char::from_u32(current as u32).unwrap_or('\0').to_string()
            } else if padded {
                format!("{:0width$}", current)
            } else {
                current.to_string()
            };
            values.push(text.encode_utf16().collect());
            current += step;
            if (step > 0 && current > i128::from(end)) || (step < 0 && current < i128::from(end)) {
                break;
            }
        }
        Ok(Some(BraceExpansion {
            end: self.index + close + 1,
            values,
        }))
    }
}
struct Matcher<'a> {
    glob: &'a Glob,
    input: &'a [u16],
    cache: HashMap<(usize, usize), Vec<usize>>,
}
impl Matcher<'_> {
    fn sequence(&mut self, id: usize, start: usize) -> Vec<usize> {
        if let Some(value) = self.cache.get(&(id, start)) {
            return value.clone();
        }
        let mut positions = BTreeSet::from([start]);
        for token in &self.glob.sequences[id] {
            let mut next = BTreeSet::new();
            match token {
                Token::Literal(unit) => {
                    for position in positions {
                        if self.input.get(position) == Some(unit) {
                            next.insert(position + 1);
                        }
                    }
                }
                Token::Any => {
                    for position in positions {
                        if self.input.get(position).is_some_and(|unit| *unit != 47) {
                            next.insert(position + 1);
                        }
                    }
                }
                Token::Class {
                    negated,
                    ranges,
                    literal,
                } => {
                    for position in positions {
                        if let Some(unit) = self.input.get(position)
                            && (!*negated || *unit != 47)
                            && ranges.iter().any(|(a, b)| a <= unit && unit <= b) != *negated
                        {
                            next.insert(position + 1);
                        }
                        if let Some(literal) = literal
                            && self.input[position..].starts_with(literal)
                        {
                            next.insert(position + literal.len());
                        }
                    }
                }
                Token::Star | Token::Globstar | Token::GlobstarSlash => {
                    let mut live = false;
                    for position in 0..=self.input.len() {
                        if positions.contains(&position) {
                            live = true;
                            next.insert(position);
                        }
                        if live {
                            match token {
                                Token::Star if self.input.get(position) == Some(&47) => {
                                    live = false
                                }
                                Token::GlobstarSlash => {
                                    if position > 0 && self.input[position - 1] == 47 {
                                        next.insert(position);
                                    }
                                }
                                _ => {
                                    next.insert(position);
                                }
                            }
                        }
                    }
                }
                Token::Negative {
                    alternatives,
                    anchored,
                    suffix,
                    cross_slash,
                } => {
                    for position in positions {
                        let once = self.alternatives(alternatives, position);
                        let forbidden = if let Some(suffix) = suffix {
                            once.iter()
                                .any(|end| !self.sequence(*suffix, *end).is_empty())
                        } else if *anchored {
                            once.contains(&self.input.len())
                        } else {
                            !once.is_empty()
                        };
                        if forbidden {
                            continue;
                        }
                        let end = if *cross_slash {
                            self.input.len()
                        } else {
                            self.input[position..]
                                .iter()
                                .position(|unit| *unit == 47)
                                .map(|length| position + length)
                                .unwrap_or(self.input.len())
                        };
                        next.extend(position..=end);
                    }
                }
                Token::Group { kind, alternatives } => {
                    for position in positions {
                        let once = self.alternatives(alternatives, position);
                        if matches!(*kind, 42 | 43) {
                            if *kind == 42 {
                                next.insert(position);
                            }
                            let mut visited = BTreeSet::new();
                            let mut queue = VecDeque::from(once);
                            while let Some(current) = queue.pop_front() {
                                if !visited.insert(current) {
                                    continue;
                                }
                                next.insert(current);
                                queue.extend(self.alternatives(alternatives, current));
                            }
                        } else {
                            if *kind == 63 {
                                next.insert(position);
                            }
                            next.extend(once);
                        }
                    }
                }
            }
            positions = next;
            if positions.is_empty() {
                break;
            }
        }
        let output: Vec<_> = positions.into_iter().collect();
        self.cache.insert((id, start), output.clone());
        output
    }
    fn alternatives(&mut self, ids: &[usize], start: usize) -> Vec<usize> {
        ids.iter()
            .flat_map(|id| self.sequence(*id, start))
            .collect()
    }
}
