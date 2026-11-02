// Byte-oriented Emacs regular expressions, as used by tac -r. Each fragment
// ends in a jump that the surrounding sequence, alternative or repeat patches.
use std::collections::{HashMap, HashSet};

type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone)]
enum Op {
    Byte(u8),
    Dot,
    Set([u64; 4]),
    Assert(u8),
    Save(usize),
    Reference(usize),
    Jump(usize),
    Split(usize, usize),
    Accept,
}

struct Fragment {
    start: usize,
    end: usize,
}
struct Parser<'a> {
    rest: &'a [u8],
    ops: Vec<Op>,
    groups: usize,
    closed: [bool; 9],
    possible_refs: u16,
    references: usize,
}

fn word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn class(name: &[u8], b: u8) -> Result<bool> {
    Ok(match name {
        b"word" => word(b),
        b"alnum" => b.is_ascii_alphanumeric(),
        b"alpha" => b.is_ascii_alphabetic(),
        b"blank" => matches!(b, b' ' | b'\t'),
        b"cntrl" => b.is_ascii_control(),
        b"digit" => b.is_ascii_digit(),
        b"graph" => b.is_ascii_graphic(),
        b"lower" => b.is_ascii_lowercase(),
        b"print" => b == b' ' || b.is_ascii_graphic(),
        b"punct" => b.is_ascii_punctuation(),
        b"space" => b == 32 || (9..=13).contains(&b),
        b"upper" => b.is_ascii_uppercase(),
        b"xdigit" => b.is_ascii_hexdigit(),
        _ => return Err("EINVAL: Invalid character class name"),
    })
}
const BRACKET: &str = "EINVAL: Unmatched [, [^, [:, [., or [=";
enum Element<'a> {
    Byte(u8),
    Class(&'a [u8]),
}

impl<'a> Parser<'a> {
    fn element(&mut self) -> Result<Element<'a>> {
        if let [b'[', marker @ (b':' | b'.' | b'='), tail @ ..] = self.rest {
            let bad = if *marker == b':' {
                "EINVAL: Invalid character class name"
            } else {
                "EINVAL: Invalid collation character"
            };
            let len = tail
                .windows(2)
                .take(17)
                .position(|w| w == [*marker, b']'])
                .ok_or(if tail.len() > 16 { bad } else { BRACKET })?;
            let name = &tail[..len];
            self.rest = &tail[len + 2..];
            if *marker == b':' {
                if name == b"word" {
                    return Err(bad);
                }
                class(name, 0)?;
                return Ok(Element::Class(name));
            }
            if let [byte] = name {
                return Ok(Element::Byte(*byte));
            }
            return Err(bad);
        }
        let (&byte, rest) = self.rest.split_first().ok_or(BRACKET)?;
        self.rest = rest;
        Ok(Element::Byte(byte))
    }

    fn bracket(&mut self) -> Result<Op> {
        if self.rest.is_empty() {
            return Err("EINVAL: Invalid regular expression");
        }
        let negate = self.take(b"^");
        let mut bits = [0; 4];
        loop {
            let first = self.element()?;
            if matches!(self.rest, [b'-', end, ..] if *end != b']') {
                self.rest = &self.rest[1..];
                let (Element::Byte(a), Element::Byte(b)) = (first, self.element()?) else {
                    return Err("EINVAL: Invalid range end");
                };
                for byte in a..=b {
                    bits[usize::from(byte / 64)] |= 1u64 << (byte % 64);
                }
            } else {
                match first {
                    Element::Byte(b) => bits[usize::from(b / 64)] |= 1u64 << (b % 64),
                    Element::Class(name) => {
                        for b in 0..=255 {
                            if class(name, b)? {
                                bits[usize::from(b / 64)] |= 1u64 << (b % 64);
                            }
                        }
                    }
                }
            }
            if self.take(b"]") {
                break;
            }
        }
        Ok(Op::Set(if negate { bits.map(|b| !b) } else { bits }))
    }

    fn take(&mut self, token: &[u8]) -> bool {
        if let Some(rest) = self.rest.strip_prefix(token) {
            self.rest = rest;
            true
        } else {
            false
        }
    }
    fn emit(&mut self, op: Op) -> usize {
        let i = self.ops.len();
        self.ops.push(op);
        i
    }
    fn atom(&mut self, op: Op) -> Fragment {
        let start = self.emit(op);
        Fragment {
            start,
            end: self.emit(Op::Jump(0)),
        }
    }
    fn expression(&mut self, depth: usize) -> Result<Fragment> {
        if depth > 64 {
            return Err("EFBIG: regex depth limit exceeded");
        }
        let end = self.emit(Op::Jump(0));
        let mut alternatives = None;
        loop {
            let mut previous = None;
            let mut start = end;
            while !self.rest.is_empty()
                && !self.rest.starts_with(br"\|")
                && !self.rest.starts_with(br"\)")
            {
                let (&b, rest) = self.rest.split_first().unwrap();
                self.rest = rest;
                let base = self.ops.len();
                let first_group = self.groups;
                let mut repeatable = true;
                let mut f = if b == b'\\' && self.take(b"(") {
                    let id = self.groups;
                    self.groups += 1;
                    let child = self.expression(depth + 1)?;
                    if !self.take(br"\)") {
                        return Err(r"EINVAL: Unmatched ( or \(");
                    }
                    if id < 9 {
                        self.closed[id] = true;
                        let first = self.atom(Op::Save(2 * id));
                        let last = self.atom(Op::Save(2 * id + 1));
                        self.ops[first.end] = Op::Jump(child.start);
                        self.ops[child.end] = Op::Jump(last.start);
                        Fragment {
                            start: first.start,
                            end: last.end,
                        }
                    } else {
                        child
                    }
                } else {
                    let op = match b {
                        b'^' if previous.is_none() => Op::Assert(b'^'),
                        b'$' if self.rest.is_empty()
                            || self.rest.starts_with(br"\|")
                            || self.rest.starts_with(br"\)") =>
                        {
                            Op::Assert(b'$')
                        }
                        b'.' => Op::Dot,
                        b'[' => self.bracket()?,
                        b'\\' => {
                            let (&e, rest) = self
                                .rest
                                .split_first()
                                .ok_or("EINVAL: Trailing backslash")?;
                            self.rest = rest;
                            match e {
                                b'1'..=b'9' => {
                                    let id = usize::from(e - b'1');
                                    if !self.closed[id] {
                                        return Err("EINVAL: Invalid back reference");
                                    }
                                    self.references = self.references.max(id + 1);
                                    Op::Reference(id)
                                }
                                b'<' | b'>' | b'b' | b'B' | b'\x60' | b'\'' => Op::Assert(e),
                                b'w' | b'W' | b's' | b'S' => {
                                    let mut bits = [0; 4];
                                    for b in 0..=255 {
                                        if (if e.eq_ignore_ascii_case(&b'w') {
                                            word(b)
                                        } else {
                                            class(b"space", b)?
                                        }) != e.is_ascii_uppercase()
                                        {
                                            bits[usize::from(b / 64)] |= 1u64 << (b % 64);
                                        }
                                    }
                                    Op::Set(bits)
                                }
                                _ => Op::Byte(e),
                            }
                        }
                        _ => Op::Byte(b),
                    };
                    repeatable = !matches!(op, Op::Assert(b'^' | b'$' | b'b' | b'B' | b'<' | b'>'));
                    self.atom(op)
                };
                while repeatable && let [q @ (b'+' | b'*' | b'?'), rest @ ..] = self.rest {
                    self.rest = rest;
                    // The mandatory and optional occurrences of a capture under +
                    // have distinct closing instructions in the reference engine.
                    let repeat = if *q == b'+'
                        && (first_group..self.groups.min(9))
                            .any(|g| self.possible_refs & (1 << g) != 0)
                    {
                        let count = self.ops.len() - base;
                        if self.ops.len() + count > 262144 {
                            return Err("EFBIG: regex nodes limit exceeded");
                        }
                        for i in base..base + count {
                            self.ops.push(match self.ops[i] {
                                Op::Jump(n) => Op::Jump(n + count),
                                Op::Split(a, b) => Op::Split(a + count, b + count),
                                ref op => op.clone(),
                            });
                        }
                        Fragment {
                            start: f.start + count,
                            end: f.end + count,
                        }
                    } else {
                        Fragment {
                            start: f.start,
                            end: f.end,
                        }
                    };
                    let after = self.emit(Op::Jump(0));
                    let split = self.emit(Op::Split(repeat.start, after));
                    self.ops[repeat.end] = Op::Jump(if *q == b'?' { after } else { split });
                    if *q == b'+' {
                        self.ops[f.end] = Op::Jump(split);
                    } else {
                        f.start = split;
                    }
                    f.end = after;
                }
                if let Some(prev) = previous {
                    self.ops[prev] = Op::Jump(f.start);
                } else {
                    start = f.start;
                }
                previous = Some(f.end);
            }
            if let Some(prev) = previous {
                self.ops[prev] = Op::Jump(end);
            }
            alternatives = Some(if let Some(left) = alternatives {
                self.emit(Op::Split(left, start))
            } else {
                start
            });
            if !self.take(br"\|") {
                break;
            }
        }
        Ok(Fragment {
            start: alternatives.unwrap(),
            end,
        })
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct State {
    pc: usize,
    pos: usize,
    captures: Vec<usize>,
}

pub(super) fn reverse(pattern: &[u8], input: &[u8], before: bool, out: &mut Vec<u8>) -> Result<()> {
    if pattern.len() > 65536 {
        return Err("EFBIG: regex input bytes limit exceeded");
    }
    let mut parser = Parser {
        rest: pattern,
        ops: Vec::new(),
        groups: 0,
        closed: [false; 9],
        possible_refs: pattern
            .windows(2)
            .filter(|p| p[0] == b'\\' && (b'1'..=b'9').contains(&p[1]))
            .fold(0, |mask, p| mask | 1 << (p[1] - b'1')),
        references: 0,
    };
    let root = parser.expression(0)?;
    if !parser.rest.is_empty() {
        return Err(r"EINVAL: Unmatched ) or \)");
    }
    parser.ops[root.end] = Op::Accept;
    let mut closes = [0usize; 9];
    for op in &parser.ops {
        if let Op::Save(slot) = op
            && slot % 2 == 1
        {
            closes[slot / 2] += 1;
        }
    }
    let track_closes = closes[..parser.references].iter().any(|&count| count > 1);
    let mut earliest: HashMap<(usize, usize), usize> = HashMap::new();
    let mut maximum = input.len();
    let mut end = maximum;
    let mut stack = Vec::new();
    let mut seen = HashSet::new();
    let mut work = 64_000_000usize;
    for start in (0..input.len()).rev() {
        let mut best = None;
        earliest.clear();
        // A later copy of a group cannot supply a backreference when an
        // earlier copy could have closed at the same byte. Collect reachable
        // closes without shadow filtering on the first pass.
        for collect in [true, false] {
            if collect && !track_closes {
                continue;
            }
            stack.push(State {
                pc: root.start,
                pos: start,
                captures: vec![usize::MAX; parser.references * 3],
            });
            seen.clear();
            while let Some(mut state) = stack.pop() {
                loop {
                    work = work
                        .checked_sub(1)
                        .ok_or("EFBIG: regex work limit exceeded")?;
                    let p = state.pos;
                    match &parser.ops[state.pc] {
                        Op::Accept => {
                            if !collect {
                                best = Some(best.map_or(p, |e: usize| e.max(p)));
                            }
                            break;
                        }
                        Op::Jump(next) => {
                            state.pc = *next;
                            continue;
                        }
                        Op::Split(a, b) => {
                            // Only a split can introduce a cycle. Position and all
                            // live captures determine every possible continuation.
                            if seen.len() >= 131072 {
                                return Err("EFBIG: regex states limit exceeded");
                            }
                            if !seen.insert(state.clone()) {
                                break;
                            }
                            stack.push(State {
                                pc: *b,
                                ..state.clone()
                            });
                            state.pc = *a;
                            continue;
                        }
                        Op::Save(slot) => {
                            let group = slot / 2;
                            if group < parser.references {
                                state.captures[group * 3 + slot % 2] = p;
                                if slot % 2 == 1 {
                                    state.captures[group * 3 + 2] = state.pc;
                                    if collect && closes[group] > 1 {
                                        if earliest.len() >= 131072 {
                                            return Err("EFBIG: regex states limit exceeded");
                                        }
                                        let entry = earliest.entry((group, p)).or_insert(state.pc);
                                        *entry = (*entry).min(state.pc);
                                    }
                                }
                            }
                        }
                        Op::Reference(id) => {
                            let (a, b, closing) = (
                                state.captures[id * 3],
                                state.captures[id * 3 + 1],
                                state.captures[id * 3 + 2],
                            );
                            if !collect
                                && !(start == p && a == p && b == p)
                                && earliest
                                    .get(&(*id, b))
                                    .is_some_and(|&earlier| earlier < closing)
                            {
                                break;
                            }
                            if b == usize::MAX || b < a || b - a > maximum - p {
                                break;
                            }
                            work = work
                                .checked_sub(b - a)
                                .ok_or("EFBIG: regex work limit exceeded")?;
                            if input[a..b] != input[p..p + (b - a)] {
                                break;
                            }
                            state.pos += b - a;
                        }
                        Op::Assert(kind) => {
                            let preceding = p > 0 && word(input[p - 1]);
                            let following = input.get(p).is_some_and(|&b| word(b));
                            if !match kind {
                                b'^' => p == 0 || input[p - 1] == b'\n',
                                b'$' => p == maximum || input[p] == b'\n',
                                b'\x60' => p == 0,
                                b'\'' => p == maximum,
                                b'b' => preceding != following,
                                b'B' => preceding == following,
                                b'<' => !preceding && following,
                                _ => preceding && !following,
                            } {
                                break;
                            }
                        }
                        op => {
                            if p == maximum {
                                break;
                            }
                            let b = input[p];
                            if !match op {
                                Op::Byte(c) => *c == b,
                                Op::Dot => b != b'\n',
                                Op::Set(bits) => {
                                    bits[usize::from(b / 64)] & (1u64 << (b % 64)) != 0
                                }
                                _ => unreachable!(),
                            } {
                                break;
                            }
                            state.pos += 1;
                        }
                    }
                    state.pc += 1;
                }
            }
        }
        if let Some(finish) = best {
            let boundary = if before { start } else { finish };
            out.extend_from_slice(&input[boundary..end]);
            end = boundary;
            maximum = start;
        }
    }
    out.extend_from_slice(&input[..end]);
    Ok(())
}
