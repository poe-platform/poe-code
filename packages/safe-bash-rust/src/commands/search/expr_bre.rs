// The production expr provider accepts portable ASCII BRE. Compile that grammar
// directly into the shared matcher; bare ERE operators are literal bytes here.
use super::{
    ParsedRegex, RxAtom, RxBranches, RxCase, RxGroup, RxProgram, RxSearch, RxToken,
    posix_class_ranges,
};

const ASCII: &str = "unsupported BRE: portable expr requires non-NUL ASCII patterns and subjects";
const BRACKET: &str = "Unmatched [, [^, [:, [., or [=";

fn bracket(pattern: &mut &[u8]) -> Result<RxAtom, &'static str> {
    if pattern.is_empty() {
        return Err("Invalid regular expression");
    }
    let negate = pattern.starts_with(b"^");
    if negate {
        *pattern = &pattern[1..];
    }
    let mut chars = Vec::new();
    loop {
        let (&first, rest) = pattern.split_first().ok_or(BRACKET)?;
        *pattern = rest;
        if first == b'[' && matches!(rest.first(), Some(b':' | b'.' | b'=')) {
            if rest[0] != b':' {
                return Err("unsupported BRE: collating symbols and equivalence classes");
            }
            let end = rest[1..]
                .iter()
                .position(|&b| b == b':')
                .ok_or("Invalid character class name")?
                + 1;
            let name = std::str::from_utf8(&rest[1..end]).unwrap();
            chars
                .extend_from_slice(posix_class_ranges(name).ok_or("Invalid character class name")?);
            *pattern = rest[end..]
                .strip_prefix(b":]")
                .ok_or("Invalid character class name")?;
            if pattern.starts_with(b"-") && !pattern.starts_with(b"-]") {
                return Err("unsupported BRE: character class range endpoint");
            }
        } else if let [b'-', end, tail @ ..] = rest
            && *end != b']'
        {
            if *end == b'[' && matches!(tail.first(), Some(b':' | b'.' | b'=')) {
                return Err("unsupported BRE: character class range endpoint");
            }
            chars.push((char::from(first), char::from(*end)));
            *pattern = tail;
        } else {
            chars.push((char::from(first), char::from(first)));
        }
        if let Some(tail) = pattern.strip_prefix(b"]") {
            *pattern = tail;
            return Ok(RxAtom::Class { negate, chars });
        }
    }
}

fn number(pattern: &mut &[u8]) -> Result<Option<usize>, &'static str> {
    let count = pattern.iter().take_while(|b| b.is_ascii_digit()).count();
    if count == 0 {
        return Ok(None);
    }
    if count > 5 {
        return Err("Regular expression too big");
    }
    let value = pattern[..count]
        .iter()
        .fold(0, |n, b| n * 10 + usize::from(*b - b'0'));
    if value > 32767 {
        return Err("Regular expression too big");
    }
    *pattern = &pattern[count..];
    Ok(Some(value))
}

fn repeated(pattern: &[u8]) -> bool {
    matches!(pattern, [b'*', ..] | [b'\\', b'+' | b'?' | b'{', ..])
}

pub(in crate::commands) fn expr_match(
    subject: &str,
    pattern: &str,
) -> Result<String, &'static str> {
    if !pattern.is_ascii() || pattern.contains('\0') {
        return Err(ASCII);
    }
    let mut pattern = pattern.as_bytes();
    let mut parsed = ParsedRegex {
        bounded_error: None,
        cross_line: true,
        requires_vm: false,
        root: Vec::new(),
        groups: Vec::new(),
    };
    let mut branches: RxBranches = vec![Vec::new()];
    let mut stack = Vec::new();
    let mut groups = 0usize;
    let (mut closed, mut referenced, mut ambiguous) = (0u16, 0u16, 0u16);
    while let Some((&byte, tail)) = pattern.split_first() {
        pattern = tail;
        let mut group_start = groups;
        let atom = match byte {
            b'^' if branches.last().unwrap().is_empty() => RxAtom::Begin,
            b'$' if matches!(pattern, [] | [b'\\', b'|' | b')', ..]) => RxAtom::End,
            b'.' => RxAtom::Any {
                newline: true,
                nul: false,
            },
            b'[' => bracket(&mut pattern)?,
            b'\\' => {
                let (&escaped, tail) = pattern.split_first().ok_or("Trailing backslash")?;
                pattern = tail;
                match escaped {
                    b'|' => {
                        branches.push(Vec::new());
                        continue;
                    }
                    b'(' => {
                        stack.push((std::mem::replace(&mut branches, vec![Vec::new()]), groups));
                        groups += 1;
                        continue;
                    }
                    b')' => {
                        let (parent, id) = stack.pop().ok_or(r"Unmatched ) or \)")?;
                        if id < 9 {
                            closed |= 1 << id;
                        }
                        group_start = id;
                        let alternatives = std::mem::replace(&mut branches, parent);
                        let nullable = alternatives.iter().any(|seq| {
                            seq.iter().all(|t| {
                                t.min == 0
                                    || matches!(
                                        t.atom,
                                        RxAtom::Begin
                                            | RxAtom::End
                                            | RxAtom::Backref(_)
                                            | RxAtom::Group { nullable: true, .. }
                                    )
                            })
                        });
                        let mut group = parsed.close_group(alternatives, RxGroup::Capture(None));
                        if let RxAtom::Group { nullable: n, .. } = &mut group {
                            *n = nullable;
                        }
                        group
                    }
                    b'1'..=b'9' => {
                        let id = usize::from(escaped - b'1');
                        if closed & (1 << id) == 0 {
                            return Err("Invalid back reference");
                        }
                        referenced |= 1 << id;
                        RxAtom::Backref(id)
                    }
                    b'+' | b'?' | b'{' => {
                        return Err("unsupported BRE: leading escaped repetition operator");
                    }
                    b'a'..=b'z' | b'A'..=b'Z' | b'0' | b'<' | b'>' | 0x60 | 0x27 => {
                        return Err("unsupported BRE: alphabetic, word or buffer escape");
                    }
                    b => RxAtom::Char(char::from(b)),
                }
            }
            b => RxAtom::Char(char::from(b)),
        };
        let (min, max) = if repeated(pattern) {
            let bounds = match pattern {
                [b'*', rest @ ..] => {
                    pattern = rest;
                    (0, None)
                }
                [b'\\', b'+', rest @ ..] => {
                    pattern = rest;
                    (1, None)
                }
                [b'\\', b'?', rest @ ..] => {
                    pattern = rest;
                    (0, Some(1))
                }
                _ => {
                    pattern = &pattern[2..];
                    let min = number(&mut pattern)?.ok_or(r"Invalid content of \{\}")?;
                    let max = if let Some(rest) = pattern.strip_prefix(b",") {
                        pattern = rest;
                        number(&mut pattern)?
                    } else {
                        Some(min)
                    };
                    pattern = pattern.strip_prefix(br"\}").ok_or(r"Unmatched \{")?;
                    if max.is_some_and(|n| n < min) {
                        return Err(r"Invalid content of \{\}");
                    }
                    (min, max)
                }
            };
            if matches!(atom, RxAtom::Begin | RxAtom::End) {
                return Err("unsupported BRE: repeated anchor");
            }
            if repeated(pattern) {
                return Err("unsupported BRE: stacked repetition operators");
            }
            if bounds.1.is_none_or(|max| max > 1)
                && matches!(atom, RxAtom::Group { nullable: true, .. })
            {
                for id in group_start..groups.min(9) {
                    ambiguous |= 1 << id;
                }
            }
            bounds
        } else {
            (1, Some(1))
        };
        branches.last_mut().unwrap().push(RxToken {
            atom,
            case: RxCase::Sensitive,
            min,
            max,
            lazy: false,
        });
    }
    if !stack.is_empty() {
        return Err(r"Unmatched ( or \(");
    }
    if referenced & ambiguous != 0 {
        return Err("unsupported BRE: backreference to a capture in nullable repetition");
    }
    if !subject.is_ascii() || subject.contains('\0') {
        return Err(ASCII);
    }
    parsed.root = branches;
    let program = RxProgram::new(parsed);
    let hay: Vec<_> = subject.char_indices().collect();
    let matched = program.run(
        &hay,
        0..=hay.len(),
        false,
        RxSearch::Expr,
        groups > 0,
        |_| true,
    );
    if groups == 0 {
        Ok(matched.map_or(0, |m| m.pos).to_string())
    } else {
        Ok(matched
            .and_then(|m| m.caps[0])
            .map_or("", |(a, b)| &subject[a..b])
            .into())
    }
}
