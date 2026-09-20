//! Own ignore-library-compatible matcher with no regex or runtime dependencies.
//! Matching uses UTF-16 units and dynamic programming rather than backtracking.
enum Token {
    Literal(u16),
    Any,
    Star,
    DeepPrefix,
    DeepTail,
    Class(Vec<(u16, u16)>),
    Never,
}
struct Rule {
    tokens: Vec<Token>,
    anchored: bool,
    directory: bool,
    negative: bool,
}
pub struct DockerIgnore {
    rules: Vec<Rule>,
}
fn whitespace(unit: u16) -> bool {
    matches!(unit,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
fn fold(unit: u16) -> u16 {
    let Some(c) = char::from_u32(unit as u32) else {
        return unit;
    };
    let mut upper = c.to_uppercase();
    let Some(first) = upper.next() else {
        return unit;
    };
    if upper.next().is_some() || first as u32 > 65535 || (unit >= 128 && (first as u32) < 128) {
        return unit;
    }
    first as u16
}
fn compile(pattern: &[u16], directory: bool) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < pattern.len() {
        match pattern[index] {
            92 => {
                let slashes = pattern[index..]
                    .iter()
                    .take_while(|unit| **unit == 92)
                    .count();
                if pattern.get(index + slashes) == Some(&42)
                    && index + slashes + 1 == pattern.len()
                    && !directory
                {
                    if slashes % 2 == 0 {
                        tokens.push(Token::Never);
                    } else {
                        tokens.extend((0..slashes / 2).map(|_| Token::Literal(92)));
                        tokens.push(Token::Star);
                    }
                    index = pattern.len();
                    continue;
                }
                index += 1;
                if let Some(unit) = pattern.get(index) {
                    if *unit == 63 {
                        tokens.push(Token::Never);
                    } else {
                        tokens.push(Token::Literal(if whitespace(*unit) {
                            32
                        } else {
                            fold(*unit)
                        }));
                    }
                } else {
                    tokens.push(Token::Never);
                }
            }
            63 => tokens.push(Token::Any),
            42 => {
                let start = index;
                while pattern.get(index + 1) == Some(&42) {
                    index += 1;
                }
                let full_segment = index - start == 1 && (start == 0 || pattern[start - 1] == 47);
                if full_segment && pattern.get(index + 1) == Some(&47) {
                    tokens.push(Token::DeepPrefix);
                    index += 1;
                } else if full_segment && index + 1 == pattern.len() && start > 0 {
                    tokens.push(Token::DeepTail);
                } else {
                    tokens.push(Token::Star);
                }
            }
            91 => {
                let start = index + 1;
                let close = pattern[start..]
                    .iter()
                    .position(|unit| matches!(unit, 47 | 93))
                    .map(|offset| start + offset);
                if let Some(close) = close
                    && pattern[close] == 93
                {
                    let mut units = Vec::new();
                    let mut cursor = start;
                    while cursor < close {
                        if pattern[cursor] == 92 && cursor + 1 < close {
                            cursor += 1;
                        }
                        units.push(pattern[cursor]);
                        cursor += 1;
                    }
                    let mut ranges = Vec::new();
                    let mut cursor = 0;
                    while cursor < units.len() {
                        if cursor + 2 < units.len() && units[cursor + 1] == 45 {
                            if units[cursor] <= units[cursor + 2] {
                                ranges.push((fold(units[cursor]), fold(units[cursor + 2])));
                            }
                            cursor += 3;
                        } else {
                            let unit = fold(units[cursor]);
                            ranges.push((unit, unit));
                            cursor += 1;
                        }
                    }
                    tokens.push(Token::Class(ranges));
                    index = close;
                } else {
                    tokens.push(Token::Never);
                }
            }
            unit => tokens.push(Token::Literal(fold(unit))),
        }
        index += 1;
    }
    tokens
}
fn matches(value: &[u16], tokens: &[Token]) -> bool {
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    let mut next = vec![false; value.len() + 1];
    for token in tokens {
        next.fill(false);
        match token {
            Token::Literal(unit) => {
                for index in 0..value.len() {
                    next[index + 1] = previous[index] && fold(value[index]) == *unit;
                }
            }
            Token::Any => {
                for index in 0..value.len() {
                    next[index + 1] = previous[index] && value[index] != 47;
                }
            }
            Token::Class(ranges) => {
                for index in 0..value.len() {
                    let unit = fold(value[index]);
                    next[index + 1] = previous[index]
                        && value[index] != 47
                        && ranges
                            .iter()
                            .any(|(from, to)| (*from..=*to).contains(&unit));
                }
            }
            Token::Star => {
                next.copy_from_slice(&previous);
                for index in 0..value.len() {
                    if value[index] != 47 && next[index] {
                        next[index + 1] = true;
                    }
                }
            }
            Token::DeepPrefix => {
                let mut reachable = false;
                for index in 0..=value.len() {
                    reachable |= previous[index];
                    next[index] =
                        previous[index] || (index > 0 && value[index - 1] == 47 && reachable);
                }
            }
            Token::DeepTail => {
                let mut reachable = false;
                for index in 1..=value.len() {
                    reachable |= previous[index - 1];
                    next[index] = reachable;
                }
            }
            Token::Never => {}
        }
        std::mem::swap(&mut previous, &mut next);
    }
    previous[value.len()]
}
impl DockerIgnore {
    pub fn new(source: &[u16]) -> Self {
        let mut rules = Vec::new();
        for raw in source.split(|unit| *unit == 10) {
            if raw.is_empty() || raw[0] == 35 || raw.iter().all(|unit| whitespace(*unit)) {
                continue;
            }
            let trailing = raw.iter().rev().take_while(|unit| **unit == 92).count();
            if trailing % 2 == 1 {
                continue;
            }
            let negative = raw[0] == 33;
            let mut pattern = raw[usize::from(negative)..].to_vec();
            if pattern.starts_with(&[92, 33]) || pattern.starts_with(&[92, 35]) {
                pattern.remove(0);
            }
            if pattern.first() == Some(&0xfeff) {
                pattern.remove(0);
            }
            let end = pattern
                .iter()
                .rposition(|unit| !whitespace(*unit))
                .map_or(0, |index| index + 1);
            if end < pattern.len() {
                let slashes = pattern[..end]
                    .iter()
                    .rev()
                    .take_while(|unit| **unit == 92)
                    .count();
                pattern.truncate(end);
                if slashes % 2 == 1 {
                    pattern.pop();
                    pattern.push(32);
                }
            }
            if pattern.is_empty() {
                continue;
            }
            let anchored = pattern[0] == 47;
            if anchored {
                pattern.remove(0);
            }
            let directory = pattern.last() == Some(&47);
            if directory {
                pattern.pop();
            }
            let anchored = anchored || pattern.contains(&47);
            if directory {
                while pattern.ends_with(&[47, 42, 42]) {
                    pattern.truncate(pattern.len() - 3);
                }
            }
            if pattern.is_empty() {
                continue;
            }
            rules.push(Rule {
                tokens: compile(&pattern, directory),
                anchored,
                directory,
                negative,
            });
        }
        Self { rules }
    }
    fn target_ignored(&self, path: &[u16], directory: bool) -> bool {
        let mut ignored = false;
        for rule in &self.rules {
            if rule.directory && !directory {
                continue;
            }
            let target = if rule.anchored {
                path
            } else {
                path.rsplit(|unit| *unit == 47).next().unwrap_or(path)
            };
            if matches(target, &rule.tokens) {
                ignored = !rule.negative;
            }
        }
        ignored
    }
    pub fn ignores(&self, path: &[u16], directory: bool) -> bool {
        for (index, unit) in path.iter().enumerate() {
            if *unit == 47 && self.target_ignored(&path[..index], true) {
                return true;
            }
        }
        self.target_ignored(path, directory)
    }
}
