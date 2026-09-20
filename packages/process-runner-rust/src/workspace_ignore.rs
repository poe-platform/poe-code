//! Workspace transfer's own case-sensitive ignore dialect. Question marks and
//! classes remain literal; additive exclusions never negate Git decisions.
pub struct Source {
    pub base: Vec<u16>,
    pub text: Vec<u16>,
}
struct Rule {
    base: Vec<u16>,
    pattern: Vec<u16>,
    negative: bool,
    directory: bool,
    anchored: bool,
}
pub struct Rules {
    git: Vec<Rule>,
    additive: Vec<Rule>,
}
fn whitespace(unit: u16) -> bool {
    matches!(unit,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
fn strip(text: &[u16]) -> &[u16] {
    let start = text
        .iter()
        .position(|unit| *unit != 47)
        .unwrap_or(text.len());
    let end = text
        .iter()
        .rposition(|unit| *unit != 47)
        .map_or(start, |index| index + 1);
    &text[start..end]
}
fn parse(source: &[u16], base: &[u16], negation: bool, lines: bool) -> Vec<Rule> {
    let mut rules = Vec::new();
    for raw in source.split(|unit| lines && *unit == 10) {
        let end = raw
            .iter()
            .rposition(|unit| !whitespace(*unit))
            .map_or(0, |index| index + 1);
        let mut line = &raw[..end];
        if line.is_empty() || line[0] == 35 {
            continue;
        }
        let escaped = line.starts_with(&[92, 35]) || line.starts_with(&[92, 33]);
        if escaped {
            line = &line[1..];
        }
        let negative = !escaped && negation && line.starts_with(&[33]);
        if negative {
            line = &line[1..];
        }
        if line.is_empty() {
            continue;
        }
        let anchored = line[0] == 47;
        let directory = line.last() == Some(&47);
        if directory {
            line = &line[..line.len() - 1];
        }
        let pattern = strip(line);
        if !pattern.is_empty() {
            rules.push(Rule {
                base: base.to_vec(),
                pattern: pattern.to_vec(),
                negative,
                directory,
                anchored,
            });
        }
    }
    rules
}
fn segment(value: &[u16], pattern: &[u16]) -> bool {
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    let mut next = vec![false; value.len() + 1];
    for unit in pattern {
        next.fill(false);
        if *unit == 42 {
            next.copy_from_slice(&previous);
            for index in 0..value.len() {
                if next[index] {
                    next[index + 1] = true;
                }
            }
        } else {
            for index in 0..value.len() {
                next[index + 1] = previous[index] && value[index] == *unit;
            }
        }
        std::mem::swap(&mut previous, &mut next);
    }
    previous[value.len()]
}
fn path_match(value: &[u16], pattern: &[u16]) -> bool {
    let values = value.split(|unit| *unit == 47).collect::<Vec<_>>();
    let patterns = pattern.split(|unit| *unit == 47).collect::<Vec<_>>();
    let mut previous = vec![false; values.len() + 1];
    previous[0] = true;
    let mut next = vec![false; values.len() + 1];
    for part in patterns {
        next.fill(false);
        if part == [42, 42] {
            next.copy_from_slice(&previous);
            for index in 0..values.len() {
                if next[index] {
                    next[index + 1] = true;
                }
            }
        } else {
            for index in 0..values.len() {
                next[index + 1] = previous[index] && segment(values[index], part);
            }
        }
        std::mem::swap(&mut previous, &mut next);
    }
    previous[values.len()]
}
fn scope<'a>(path: &'a [u16], base: &[u16]) -> Option<&'a [u16]> {
    if base.is_empty() {
        return Some(path);
    }
    if path == base {
        return Some(&[]);
    }
    if path.starts_with(base) && path.get(base.len()) == Some(&47) {
        return Some(&path[base.len() + 1..]);
    }
    None
}
fn directory(path: &[u16], pattern: &[u16], anchored: bool, self_match: bool) -> bool {
    if anchored || pattern.contains(&47) {
        return path == pattern
            || (!self_match && path.starts_with(pattern) && path.get(pattern.len()) == Some(&47));
    }
    let parts = path.split(|unit| *unit == 47).collect::<Vec<_>>();
    parts
        .iter()
        .enumerate()
        .any(|(index, part)| (self_match || index + 1 < parts.len()) && segment(part, pattern))
}
fn rule_match(path: &[u16], rule: &Rule, directory_target: bool, git: bool) -> bool {
    let Some(path) = scope(strip(path), &rule.base) else {
        return false;
    };
    if rule.directory {
        if git && directory_target {
            return directory(path, &rule.pattern, rule.anchored, true);
        }
        if git && rule.negative {
            return false;
        }
        return directory(path, &rule.pattern, rule.anchored, false);
    }
    if rule.anchored || rule.pattern.contains(&47) {
        path_match(path, &rule.pattern)
    } else {
        path.split(|unit| *unit == 47)
            .any(|part| segment(part, &rule.pattern))
    }
}
impl Rules {
    pub fn new(git: &[Source], poe: &[u16], excluded: &[Vec<u16>]) -> Self {
        let git = git
            .iter()
            .flat_map(|source| parse(&source.text, &source.base, true, true))
            .collect();
        let mut additive = parse(poe, &[], false, true);
        additive.extend(parse(
            &".git/".encode_utf16().collect::<Vec<_>>(),
            &[],
            false,
            false,
        ));
        for pattern in excluded {
            additive.extend(parse(pattern, &[], false, false));
        }
        Self { git, additive }
    }
    fn git_ignored(&self, path: &[u16], directory: bool) -> bool {
        let mut ignored = false;
        for rule in &self.git {
            if rule_match(path, rule, directory, true) {
                ignored = !rule.negative;
            }
        }
        ignored
    }
    pub fn ignores(&self, path: &[u16]) -> bool {
        if self.git_ignored(path, false) {
            return true;
        }
        for (index, unit) in path.iter().enumerate() {
            if *unit == 47 && self.git_ignored(&path[..index], true) {
                return true;
            }
        }
        self.additive
            .iter()
            .any(|rule| rule_match(path, rule, false, false))
    }
}
