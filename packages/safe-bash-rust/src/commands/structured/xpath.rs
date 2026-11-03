//! Compile the supported XPath grammar before reading XML. Expressions are
//! postfix programs so even deeply nested parentheses require no recursion.
pub(super) enum Op<'s> {
    Text(&'s str),
    Number(f64),
    Select(usize),
    Negate,
    Binary(&'s str),
    Call(&'s str, usize),
}
pub(super) enum AxisTest<'s> {
    Element(&'s str),
    Attribute(&'s str),
    Text,
    Parent,
    This,
}
pub(super) struct Step<'s> {
    pub descendant: bool,
    pub test: AxisTest<'s>,
    pub predicates: Vec<Vec<Op<'s>>>,
}
pub(super) struct Path<'s> {
    pub absolute: bool,
    pub steps: Vec<Step<'s>>,
}
pub(super) enum Query<'s> {
    Expression(Vec<Op<'s>>),
    Paths(Vec<Path<'s>>),
}

// All parser slices borrow the original query. A bracket's address identifies
// its matching span in every slice, without rescanning nested predicate bodies.
type Brackets = std::collections::HashMap<*const u8, usize>;
fn bracket_spans(source: &str) -> Brackets {
    let mut spans = Brackets::new();
    let mut opens = Vec::new();
    let mut quote = 0;
    for (i, b) in source.bytes().enumerate() {
        if quote != 0 {
            if b == quote {
                quote = 0;
            }
        } else {
            match b {
                b'\'' | b'"' => quote = b,
                b'[' => opens.push(i),
                b']' => {
                    if let Some(open) = opens.pop() {
                        spans.insert(source[open..].as_ptr(), i - open);
                    }
                }
                _ => {}
            }
        }
    }
    spans
}

pub(super) fn compile(source: &str) -> Result<Vec<Query<'_>>, String> {
    let spans = bracket_spans(source);
    let mut result = vec![Query::Paths(vec![])];
    let mut pending = vec![(0, vec![source])];
    while let Some((index, sources)) = pending.pop() {
        // Compile sibling paths left to right before visiting paths nested inside them.
        for (offset, source) in sources.into_iter().enumerate() {
            let first = result.len();
            let mut children = Vec::new();
            result[index + offset] = query(source, &spans, &mut |path| {
                let i = first + children.len();
                children.push(path);
                i
            })?;
            if !children.is_empty() {
                result.resize_with(first + children.len(), || Query::Paths(Vec::new()));
                pending.push((first, children));
            }
        }
    }
    Ok(result)
}

fn space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}
fn start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}
fn part(b: u8) -> bool {
    start(b) || b.is_ascii_digit() || matches!(b, b'-' | b'.')
}

struct Cursor<'a> {
    s: &'a str,
    i: usize,
    kind: &'static str,
}
impl<'a> Cursor<'a> {
    fn byte(&self) -> u8 {
        self.s.as_bytes().get(self.i).copied().unwrap_or(0)
    }
    fn skip(&mut self) {
        while space(self.byte()) {
            self.i += 1;
        }
    }
    fn take(&mut self, b: u8) -> bool {
        if self.byte() == b {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn error(&self) -> String {
        let offset = self.s[..self.i.min(self.s.len())].encode_utf16().count()
            + self.i.saturating_sub(self.s.len());
        format!("unsupported XPath {} at offset {offset}", self.kind)
    }
    fn name(&mut self) -> Result<&'a str, String> {
        let i = self.i;
        if !start(self.byte()) {
            return Err(self.error());
        }
        while part(self.byte()) {
            self.i += 1;
        }
        Ok(&self.s[i..self.i])
    }
}

fn query<'a>(
    s: &'a str,
    spans: &Brackets,
    link: &mut impl FnMut(&'a str) -> usize,
) -> Result<Query<'a>, String> {
    let mut c = Cursor {
        s,
        i: 0,
        kind: "syntax",
    };
    c.skip();
    let first = c.i;
    let expr = match c.byte() {
        b'-' | b'(' | b'"' | b'\'' | b'0'..=b'9' => true,
        b'.' => s.as_bytes().get(c.i + 1).is_some_and(u8::is_ascii_digit),
        b if start(b) => {
            let name = c.name()?;
            c.skip();
            c.byte() == b'(' && name != "text"
        }
        _ => false,
    };
    if expr {
        return Ok(Query::Expression(expression(s, spans, link)?));
    }
    c.i = first;
    let mut paths = vec![];
    loop {
        c.skip();
        let absolute = c.byte() == b'/';
        let mut steps = vec![];
        loop {
            let descendant = c.take(b'/') && c.take(b'/');
            c.skip();
            let attr = c.take(b'@');
            let test = if c.take(b'.') {
                if c.take(b'.') {
                    AxisTest::Parent
                } else {
                    AxisTest::This
                }
            } else {
                let name = if c.take(b'*') {
                    "*"
                } else {
                    c.skip();
                    let i = c.i;
                    c.name()?;
                    if c.take(b':') {
                        c.name()?;
                        if c.byte() == b':' {
                            return Err(c.error());
                        }
                    }
                    &s[i..c.i]
                };
                c.skip();
                if c.byte() == b'(' {
                    if name != "text" || attr {
                        return Err(c.error());
                    }
                    c.i += 1;
                    c.skip();
                    if !c.take(b')') {
                        return Err(c.error());
                    }
                    AxisTest::Text
                } else if attr {
                    AxisTest::Attribute(name)
                } else {
                    AxisTest::Element(name)
                }
            };
            c.skip();
            let mut predicates = vec![];
            while c.take(b'[') {
                let open = c.i - 1;
                c.skip();
                let begin = c.i;
                c.i = spans
                    .get(&s[open..].as_ptr())
                    .map_or(s.len(), |span| open + span)
                    .min(s.len());
                if c.i == s.len() {
                    return Err(c.error());
                }
                predicates.push(expression(&s[begin..c.i], spans, link)?);
                c.i += 1;
                c.skip();
            }
            if matches!(test, AxisTest::Attribute(_) | AxisTest::Text) && c.byte() == b'/' {
                return Err(c.error());
            }
            steps.push(Step {
                descendant,
                test,
                predicates,
            });
            if c.byte() != b'/' {
                break;
            }
        }
        paths.push(Path { absolute, steps });
        if !c.take(b'|') {
            break;
        }
    }
    if c.i != s.len() {
        return Err(c.error());
    }
    Ok(Query::Paths(paths))
}

enum Pending<'a> {
    Group(Option<&'a str>, usize),
    Binary(&'a str, u8),
    Negate,
}
fn flush<'a>(stack: &mut Vec<Pending<'a>>, out: &mut Vec<Op<'a>>, min: u8) {
    while let Some(op) = stack.last() {
        match *op {
            Pending::Group(..) => break,
            Pending::Binary(_, p) if p < min => break,
            Pending::Binary(op, _) => out.push(Op::Binary(op)),
            Pending::Negate => out.push(Op::Negate),
        }
        stack.pop();
    }
}
fn arity(name: &str) -> Option<std::ops::RangeInclusive<usize>> {
    Some(match name {
        "true" | "false" | "position" | "last" => 0..=0,
        "contains" | "starts-with" | "substring-before" | "substring-after" => 2..=2,
        "normalize-space" | "string-length" | "string" | "number" | "name" | "local-name"
        | "namespace-uri" => 0..=1,
        "not" | "count" | "boolean" | "sum" | "floor" | "ceiling" | "round" => 1..=1,
        "substring" => 2..=3,
        "concat" => 2..=usize::MAX,
        "translate" => 3..=3,
        _ => return None,
    })
}
fn expression<'a>(
    s: &'a str,
    spans: &Brackets,
    link: &mut impl FnMut(&'a str) -> usize,
) -> Result<Vec<Op<'a>>, String> {
    let mut c = Cursor {
        s,
        i: 0,
        kind: "predicate",
    };
    let mut out = vec![];
    let mut stack = vec![];
    let mut expecting = true;
    loop {
        c.skip();
        if c.i == s.len() {
            break;
        }
        let b = c.byte();
        if b == b')' {
            if expecting && !matches!(stack.last(), Some(Pending::Group(..))) {
                return Err(c.error());
            }
            flush(&mut stack, &mut out, 0);
            let Some(Pending::Group(name, commas)) = stack.pop() else {
                return Err(c.error());
            };
            if expecting && (commas > 0 || name.is_none()) {
                return Err(c.error());
            }
            if let Some(name) = name {
                let count = if expecting { 0 } else { commas + 1 };
                if !arity(name).unwrap().contains(&count) {
                    return Err(c.error());
                }
                out.push(Op::Call(name, count));
            }
            c.i += 1;
            expecting = false;
            continue;
        }
        if b == b',' {
            if expecting {
                return Err(c.error());
            }
            flush(&mut stack, &mut out, 0);
            let Some(Pending::Group(Some(_), n)) = stack.last_mut() else {
                return Err(c.error());
            };
            *n += 1;
            c.i += 1;
            expecting = true;
            continue;
        }
        if !expecting {
            let begin = c.i;
            match b {
                b'+' | b'-' => c.i += 1,
                b'=' | b'!' | b'<' | b'>' => {
                    c.i += 1;
                    c.take(b'=');
                }
                _ => {
                    c.name()?;
                }
            }
            let op = &s[begin..c.i];
            let p = match op {
                "or" => 1,
                "and" => 2,
                "=" | "!=" => 3,
                "<" | "<=" | ">" | ">=" => 4,
                "+" | "-" => 5,
                _ => return Err(c.error()),
            };
            flush(&mut stack, &mut out, p);
            stack.push(Pending::Binary(op, p));
            expecting = true;
            continue;
        }
        if c.take(b'-') {
            stack.push(Pending::Negate);
            continue;
        }
        let begin = c.i;
        let path = match b {
            b'/' | b'@' => true,
            b'.' => !s.as_bytes().get(c.i + 1).is_some_and(u8::is_ascii_digit),
            b if start(b) => {
                c.name()?;
                c.skip();
                let path = c.byte() != b'(' || s[begin..].starts_with("text");
                c.i = begin;
                path
            }
            _ => false,
        };
        if path {
            let mut quote = 0;
            let mut brackets = 0i32;
            let mut parens = 0i32;
            while c.i < s.len() {
                let ch = c.byte();
                if quote != 0 {
                    if ch == quote {
                        quote = 0;
                    }
                } else if matches!(ch, b'\'' | b'"') {
                    quote = ch;
                } else if ch == b'[' {
                    if brackets == 0
                        && let Some(&span) = spans.get(&s[c.i..].as_ptr())
                        && span < s.len() - c.i
                    {
                        c.i += span + 1;
                        continue;
                    }
                    brackets += 1;
                } else if ch == b']' {
                    brackets -= 1;
                } else if brackets == 0 && ch == b'(' {
                    parens += 1;
                } else if brackets == 0 && ch == b')' {
                    if parens == 0 {
                        break;
                    }
                    parens -= 1;
                } else if brackets == 0 && parens == 0 {
                    if matches!(ch, b'+' | b',' | b'=' | b'!' | b'<' | b'>') {
                        break;
                    }
                    if space(ch) {
                        let where_ = c.i;
                        c.skip();
                        let next = c.byte();
                        let previous = s.as_bytes()[where_ - 1];
                        if !matches!(previous, b'/' | b'|') && !matches!(next, b'/' | b'|') {
                            c.i = where_;
                            break;
                        }
                        continue;
                    }
                }
                c.i += 1;
            }
            out.push(Op::Select(link(&s[begin..c.i])));
            expecting = false;
            continue;
        }
        if c.take(b'(') {
            stack.push(Pending::Group(None, 0));
        } else if matches!(b, b'\'' | b'"') {
            c.i += 1;
            let begin = c.i;
            while c.i < s.len() && c.byte() != b {
                c.i += 1;
            }
            if !c.take(b) {
                return Err(c.error());
            }
            out.push(Op::Text(&s[begin..c.i - 1]));
            expecting = false;
        } else if b.is_ascii_digit() || b == b'.' {
            while c.byte().is_ascii_digit() {
                c.i += 1
            }
            if c.take(b'.') {
                while c.byte().is_ascii_digit() {
                    c.i += 1
                }
            }
            out.push(Op::Number(s[begin..c.i].parse().map_err(|_| c.error())?));
            expecting = false;
        } else {
            let name = c.name()?;
            c.skip();
            let paren = c.byte() == b'(';
            // Production consumes one UTF-16 unit even on a missing '('.
            if !paren {
                return Err(format!(
                    "unsupported XPath predicate at offset {}",
                    s[..c.i].encode_utf16().count() + 1
                ));
            }
            c.i += 1;
            if arity(name).is_none() {
                return Err(c.error());
            }
            stack.push(Pending::Group(Some(name), 0));
        }
    }
    if expecting {
        return Err(c.error());
    }
    flush(&mut stack, &mut out, 0);
    if !stack.is_empty() {
        return Err(c.error());
    }
    Ok(out)
}
