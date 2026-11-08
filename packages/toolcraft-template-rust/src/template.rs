//! Own UTF-16 template grammar and partial composition.
use std::collections::HashSet;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub description: Vec<u16>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", String::from_utf16_lossy(&self.description))?;
        if let (Some(line), Some(column)) = (self.line, self.column) {
            write!(f, " at line {line}, column {column}")?;
        }
        Ok(())
    }
}
impl std::error::Error for Error {}
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn error(description: Vec<u16>) -> Error {
    Error {
        description,
        line: None,
        column: None,
    }
}
fn named(prefix: &str, name: &[u16], suffix: &str) -> Error {
    let mut text = u(prefix);
    text.extend_from_slice(name);
    text.extend(u(suffix));
    error(text)
}
fn trim(text: &[u16]) -> &[u16] {
    let start = text.iter().position(|ch| !space(*ch)).unwrap_or(text.len());
    let end = text
        .iter()
        .rposition(|ch| !space(*ch))
        .map_or(start, |i| i + 1);
    &text[start..end]
}
fn space(ch: u16) -> bool {
    matches!(ch,9..=13|32|160|0x1680|0x2000..=0x200A|0x2028|0x2029|0x202F|0x205F|0x3000|0xFEFF)
}
fn find(text: &[u16], needle: &[u16], start: usize) -> Option<usize> {
    text.get(start..)?
        .windows(needle.len())
        .position(|part| part == needle)
        .map(|pos| pos + start)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Text,
    Name,
    Unescaped,
    Section,
    Inverted,
    Partial,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub kind: Kind,
    pub value: Vec<u16>,
    pub start: usize,
    pub end: usize,
    pub raw_start: usize,
    pub raw_end: usize,
    pub children: Vec<usize>,
    pub indent: Vec<u16>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    pub source: Vec<u16>,
    pub tokens: Vec<Token>,
    pub roots: Vec<usize>,
}
#[derive(Clone, Copy, PartialEq)]
enum TagKind {
    Name,
    Unescaped,
    Section,
    Inverted,
    Close,
    Comment,
    Partial,
    Delimiter,
}
struct Tag<'a> {
    kind: TagKind,
    name: &'a [u16],
    end: usize,
}
fn tag(text: &[u16], open: usize) -> Result<Tag<'_>, Error> {
    let triple = text.get(open..open + 3) == Some(&[123, 123, 123]);
    let closing = if triple {
        &[125, 125, 125][..]
    } else {
        &[125, 125][..]
    };
    let start = open + if triple { 3 } else { 2 };
    let Some(close) = find(text, closing, start) else {
        let line_end = text[open..]
            .iter()
            .position(|ch| *ch == 10)
            .map_or(text.len(), |pos| pos + open);
        let mut excerpt = &text[open..line_end];
        while excerpt.last().is_some_and(|ch| space(*ch)) {
            excerpt = &excerpt[..excerpt.len() - 1];
        }
        let mut description = u("Unclosed tag \"");
        description.extend_from_slice(&excerpt[..excerpt.len().min(40)]);
        if excerpt.len() > 40 {
            description.extend(u("..."));
        }
        description.extend(u("\": expected \""));
        description.extend(closing);
        description.push(34);
        return Err(Error {
            description,
            line: Some(text[..open].iter().filter(|ch| **ch == 10).count() + 1),
            column: Some(
                open - text[..open]
                    .iter()
                    .rposition(|ch| *ch == 10)
                    .map_or(0, |i| i + 1)
                    + 1,
            ),
        });
    };
    let raw = trim(&text[start..close]);
    if triple {
        return Ok(Tag {
            kind: TagKind::Unescaped,
            name: raw,
            end: close + 3,
        });
    }
    let kind = match raw.first() {
        Some(35) => TagKind::Section,
        Some(94) => TagKind::Inverted,
        Some(47) => TagKind::Close,
        Some(33) => TagKind::Comment,
        Some(38) => TagKind::Unescaped,
        Some(62) => TagKind::Partial,
        Some(61) if raw.last() == Some(&61) => TagKind::Delimiter,
        _ => TagKind::Name,
    };
    Ok(Tag {
        kind,
        name: if kind == TagKind::Name {
            raw
        } else {
            trim(&raw[1..])
        },
        end: close + 2,
    })
}
fn standalone(text: &[u16], open: usize, end: usize, kind: TagKind) -> Option<(usize, usize)> {
    if matches!(kind, TagKind::Name | TagKind::Unescaped) {
        return None;
    }
    let start = text[..open]
        .iter()
        .rposition(|ch| *ch == 10)
        .map_or(0, |i| i + 1);
    if !text[start..open].iter().all(|ch| space(*ch)) {
        return None;
    }
    let mut next = end;
    while matches!(text.get(next), Some(32 | 9)) {
        next += 1;
    }
    if text.get(next..next + 2) == Some(&[13, 10]) {
        Some((start, next + 2))
    } else if text.get(next) == Some(&10) {
        Some((start, next + 1))
    } else if next == text.len() {
        Some((start, next))
    } else {
        None
    }
}
fn append(program: &mut Program, parent: Option<usize>, value: &[u16], start: usize) {
    if value.is_empty() {
        return;
    }
    let children = parent.map_or(&mut program.roots, |id| &mut program.tokens[id].children);
    let previous = children.last().copied();
    if let Some(id) = previous.filter(|id| program.tokens[*id].kind == Kind::Text) {
        program.tokens[id].value.extend_from_slice(value);
        return;
    }
    let id = program.tokens.len();
    program.tokens.push(Token {
        kind: Kind::Text,
        value: value.to_vec(),
        start,
        end: start + value.len(),
        raw_start: 0,
        raw_end: 0,
        children: vec![],
        indent: vec![],
    });
    if let Some(parent) = parent {
        program.tokens[parent].children.push(id);
    } else {
        program.roots.push(id);
    }
}
pub fn compile(source: &[u16]) -> Result<Program, Error> {
    let mut program = Program {
        source: source.to_vec(),
        tokens: vec![],
        roots: vec![],
    };
    let mut parents: Vec<usize> = vec![];
    let mut index = 0;
    while index < source.len() {
        let Some(open) = find(source, &[123, 123], index) else {
            append(
                &mut program,
                parents.last().copied(),
                &source[index..],
                index,
            );
            break;
        };
        append(
            &mut program,
            parents.last().copied(),
            &source[index..open],
            index,
        );
        let parsed = tag(source, open)?;
        let standalone = standalone(source, open, parsed.end, parsed.kind);
        if let Some((line_start, _)) = standalone {
            let children = parents
                .last()
                .map_or(&mut program.roots, |id| &mut program.tokens[*id].children);
            if let Some(last) = children
                .last()
                .copied()
                .filter(|id| program.tokens[*id].kind == Kind::Text)
            {
                let keep = line_start.saturating_sub(program.tokens[last].start);
                program.tokens[last].value.truncate(keep);
                if program.tokens[last].value.is_empty() {
                    if let Some(parent) = parents.last() {
                        program.tokens[*parent].children.pop();
                    } else {
                        program.roots.pop();
                    }
                }
            }
        }
        index = standalone.map_or(parsed.end, |(_, next)| next);
        match parsed.kind {
            TagKind::Comment => continue,
            TagKind::Delimiter => return Err(error(u("Custom delimiters are not supported"))),
            TagKind::Close => {
                let parent = parents
                    .pop()
                    .ok_or_else(|| named("Closing unopened section \"", parsed.name, "\""))?;
                if program.tokens[parent].value != parsed.name {
                    let mut message = u("Unclosed section \"");
                    message.extend(&program.tokens[parent].value);
                    message.extend(u("\" before closing \""));
                    message.extend(parsed.name);
                    message.push(34);
                    return Err(error(message));
                }
                program.tokens[parent].raw_end = open;
                continue;
            }
            _ => {}
        }
        let kind = match parsed.kind {
            TagKind::Name => Kind::Name,
            TagKind::Unescaped => Kind::Unescaped,
            TagKind::Section => Kind::Section,
            TagKind::Inverted => Kind::Inverted,
            TagKind::Partial => Kind::Partial,
            _ => unreachable!(),
        };
        let id = program.tokens.len();
        program.tokens.push(Token {
            kind,
            value: parsed.name.to_vec(),
            start: open,
            end: parsed.end,
            raw_start: parsed.end,
            raw_end: standalone.map_or(open, |(start, _)| start),
            children: vec![],
            indent: standalone
                .filter(|_| kind == Kind::Partial)
                .map_or_else(Vec::new, |(start, _)| source[start..open].to_vec()),
        });
        if let Some(parent) = parents.last() {
            program.tokens[*parent].children.push(id);
        } else {
            program.roots.push(id);
        }
        if matches!(kind, Kind::Section | Kind::Inverted) {
            parents.push(id);
        }
    }
    if let Some(parent) = parents.last() {
        return Err(named(
            "Unclosed section \"",
            &program.tokens[*parent].value,
            "\"",
        ));
    }
    Ok(program)
}
pub fn partial_names(source: &[u16]) -> Result<Vec<Vec<u16>>, Error> {
    let program = compile(source)?;
    let mut seen = HashSet::new();
    let mut names = vec![];
    for token in program.tokens {
        if token.kind == Kind::Partial && seen.insert(token.value.clone()) {
            names.push(token.value);
        }
    }
    Ok(names)
}
pub trait Partials {
    fn has(&mut self, name: &[u16]) -> Result<bool, Error>;
    fn get(&mut self, name: &[u16]) -> Result<Vec<u16>, Error>;
}
struct SlicePartials<'a>(&'a [(Vec<u16>, Vec<u16>)]);
impl Partials for SlicePartials<'_> {
    fn has(&mut self, name: &[u16]) -> Result<bool, Error> {
        Ok(self.0.iter().any(|(key, _)| key == name))
    }
    fn get(&mut self, name: &[u16]) -> Result<Vec<u16>, Error> {
        self.0
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
            .ok_or_else(|| named("Partial \"", name, "\" not found."))
    }
}
fn check_partial(
    name: &[u16],
    partials: &mut dyn Partials,
    stack: &[Vec<u16>],
) -> Result<(), Error> {
    if !partials.has(name)? {
        return Err(named("Partial \"", name, "\" not found."));
    }
    if stack.iter().any(|key| key == name) {
        let mut message = u("Circular partial reference detected: ");
        for key in stack {
            message.extend(key);
            message.extend(u(" -> "));
        }
        message.extend(name);
        message.push(46);
        return Err(error(message));
    }
    if stack.len() >= 100 {
        return Err(error(u("Maximum partial depth exceeded (100).")));
    }
    Ok(())
}

fn indent_partial(source: &[u16], indent: &[u16]) -> Vec<u16> {
    let mut output = vec![];
    for (i, line) in source.split(|ch| *ch == 10).enumerate() {
        if i != 0 {
            output.push(10);
        }
        if !line.is_empty() {
            output.extend(indent);
        }
        output.extend(line);
    }
    output
}
pub fn expand_partials(
    source: &[u16],
    partials: &[(Vec<u16>, Vec<u16>)],
) -> Result<Vec<u16>, Error> {
    expand_with(source, &mut SlicePartials(partials))
}
pub fn expand_with(source: &[u16], partials: &mut dyn Partials) -> Result<Vec<u16>, Error> {
    struct Frame {
        source: Vec<u16>,
        index: usize,
        name: Option<Vec<u16>>,
    }
    let mut frames = vec![Frame {
        source: source.to_vec(),
        index: 0,
        name: None,
    }];
    let mut names = vec![];
    let mut output = vec![];
    while let Some(frame) = frames.last_mut() {
        if frame.index == frame.source.len() {
            if frame.name.is_some() {
                names.pop();
            }
            frames.pop();
            continue;
        }
        let Some(open) = find(&frame.source, &[123, 123], frame.index) else {
            output.extend(&frame.source[frame.index..]);
            frame.index = frame.source.len();
            continue;
        };
        let parsed = tag(&frame.source, open)?;
        if parsed.kind != TagKind::Partial {
            output.extend(&frame.source[frame.index..parsed.end]);
            frame.index = parsed.end;
            continue;
        }
        check_partial(parsed.name, partials, &names)?;
        let name = parsed.name.to_vec();
        let standalone = standalone(&frame.source, open, parsed.end, parsed.kind);
        let before_end = standalone.map_or(open, |(start, _)| start);
        // String.slice clamps an end before the start to an empty string.
        if before_end > frame.index {
            output.extend(&frame.source[frame.index..before_end]);
        }
        let indent = standalone.map_or(&[][..], |(start, _)| &frame.source[start..open]);
        let child = indent_partial(&partials.get(parsed.name)?, indent);
        frame.index = standalone.map_or(parsed.end, |(_, next)| next);
        names.push(name.clone());
        frames.push(Frame {
            source: child,
            index: 0,
            name: Some(name),
        });
    }
    Ok(output)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValueKind {
    Other,
    Object,
    String,
    Number,
    Array,
    Function,
}
#[derive(Clone, Debug)]
pub struct Lookup {
    pub hit: bool,
    pub truthy: bool,
    pub nullish: bool,
    pub kind: ValueKind,
    pub handle: usize,
    pub empty: bool,
}
/// Host values stay in the caller. The core requests only visited lookups,
/// coercion, scopes, lazy array iteration and section lambdas.
pub trait Environment: Partials {
    fn lookup(&mut self, context: usize, name: &[u16]) -> Result<Lookup, Error>;
    fn text(&mut self, handle: usize) -> Result<Vec<u16>, Error>;
    fn push(&mut self, parent: usize, handle: usize) -> Result<usize, Error>;
    fn iterate(&mut self, handle: usize) -> Result<usize, Error>;
    fn next(&mut self, iterator: usize) -> Result<Option<usize>, Error>;
    fn close(&mut self, iterator: usize);
    fn lambda(
        &mut self,
        handle: usize,
        context: usize,
        raw: &[u16],
        stack: &[Vec<u16>],
    ) -> Result<Vec<u16>, Error>;
}
#[derive(Default)]
pub struct RenderOptions<'a> {
    pub escape_none: bool,
    pub validate: bool,
    pub yield_text: Option<&'a [u16]>,
    pub in_context: bool,
    pub partial_stack: Vec<Vec<u16>>,
}
fn html(text: &[u16]) -> Vec<u16> {
    let mut output = vec![];
    for ch in text {
        match ch {
            38 => output.extend(u("&amp;")),
            60 => output.extend(u("&lt;")),
            62 => output.extend(u("&gt;")),
            34 => output.extend(u("&quot;")),
            39 => output.extend(u("&#39;")),
            47 => output.extend(u("&#x2F;")),
            96 => output.extend(u("&#x60;")),
            61 => output.extend(u("&#x3D;")),
            _ => output.push(*ch),
        }
    }
    output
}
pub fn render(
    source: &[u16],
    context: usize,
    env: &mut dyn Environment,
    options: RenderOptions<'_>,
) -> Result<Vec<u16>, Error> {
    use std::sync::Arc;
    let prepared = if !options.in_context
        && let Some(yield_text) = options.yield_text
    {
        let expanded = expand_with(source, env)?;
        let needle = u("{{yield}}");
        let mut prepared = vec![];
        let mut index = 0;
        while let Some(open) = find(&expanded, &needle, index) {
            prepared.extend(&expanded[index..open]);
            prepared.extend(yield_text);
            index = open + needle.len();
        }
        prepared.extend(&expanded[index..]);
        prepared
    } else {
        source.to_vec()
    };
    let program = Arc::new(compile(&prepared)?);
    if !options.in_context {
        let mut pending: Vec<_> = program
            .roots
            .iter()
            .rev()
            .map(|id| (program.clone(), *id, vec![]))
            .collect();
        while let Some((program, id, stack)) = pending.pop() {
            let token = &program.tokens[id];
            if token.kind == Kind::Partial {
                check_partial(&token.value, env, &stack)?;
                let partial = Arc::new(compile(&env.get(&token.value)?)?);
                let mut stack = stack;
                stack.push(token.value.clone());
                pending.extend(
                    partial
                        .roots
                        .iter()
                        .rev()
                        .map(|id| (partial.clone(), *id, stack.clone())),
                );
            } else {
                pending.extend(
                    token
                        .children
                        .iter()
                        .rev()
                        .map(|id| (program.clone(), *id, stack.clone())),
                );
            }
        }
    }
    enum Task {
        Token(Arc<Program>, usize, usize, Vec<Vec<u16>>, bool),
        Iterate(Arc<Program>, Vec<usize>, usize, usize, Vec<Vec<u16>>, bool),
    }
    let mut tasks = vec![];
    let validation = if options.validate && !options.in_context {
        Some(Arc::new(compile(&expand_with(&prepared, env)?)?))
    } else {
        None
    };
    tasks.extend(program.roots.iter().rev().map(|id| {
        Task::Token(
            program.clone(),
            *id,
            context,
            options.partial_stack.clone(),
            false,
        )
    }));
    if let Some(validation) = validation {
        tasks.extend(
            validation
                .roots
                .iter()
                .rev()
                .map(|id| Task::Token(validation.clone(), *id, context, vec![], true)),
        );
    }
    let mut output = vec![];
    let mut iterators = vec![];
    let result = (|| {
        while let Some(task) = tasks.pop() {
            let (program, id, context, stack, validation) = match task {
                Task::Token(p, id, ctx, s, v) => (p, id, ctx, s, v),
                Task::Iterate(program, children, parent, iterator, stack, validation) => {
                    let next = match env.next(iterator) {
                        Ok(next) => next,
                        Err(error) => {
                            iterators.pop();
                            return Err(error);
                        }
                    };
                    if let Some(value) = next {
                        let context = env.push(parent, value)?;
                        tasks.push(Task::Iterate(
                            program.clone(),
                            children.clone(),
                            parent,
                            iterator,
                            stack.clone(),
                            validation,
                        ));
                        tasks.extend(children.iter().rev().map(|id| {
                            Task::Token(program.clone(), *id, context, stack.clone(), validation)
                        }));
                    } else {
                        iterators.pop();
                    }
                    continue;
                }
            };
            let token = &program.tokens[id];
            if token.kind == Kind::Text {
                if !validation {
                    output.extend(&token.value);
                }
                continue;
            }
            if token.kind == Kind::Partial {
                if validation {
                    continue;
                }
                check_partial(&token.value, env, &stack)?;
                let partial = Arc::new(compile(&indent_partial(
                    &env.get(&token.value)?,
                    &token.indent,
                ))?);
                let mut stack = stack;
                stack.push(token.value.clone());
                tasks.extend(
                    partial
                        .roots
                        .iter()
                        .rev()
                        .map(|id| Task::Token(partial.clone(), *id, context, stack.clone(), false)),
                );
                continue;
            }
            let value = env.lookup(context, &token.value)?;
            if validation {
                if !value.hit {
                    return Err(named("Template variable \"", &token.value, "\" not found."));
                }
                if matches!(token.kind, Kind::Name | Kind::Unescaped) {
                    continue;
                }
                if value.kind == ValueKind::Array && !value.empty {
                    let iterator = env.iterate(value.handle)?;
                    iterators.push(iterator);
                    tasks.push(Task::Iterate(
                        program.clone(),
                        token.children.clone(),
                        context,
                        iterator,
                        stack,
                        true,
                    ));
                    continue;
                }
                let child_context = if matches!(
                    value.kind,
                    ValueKind::Object | ValueKind::String | ValueKind::Number
                ) && !value.nullish
                {
                    env.push(context, value.handle)?
                } else {
                    context
                };
                tasks.extend(token.children.iter().rev().map(|id| {
                    Task::Token(program.clone(), *id, child_context, stack.clone(), true)
                }));
                continue;
            }
            if matches!(token.kind, Kind::Name | Kind::Unescaped) {
                if !value.hit || value.nullish {
                    if options.validate {
                        return Err(named("Template variable \"", &token.value, "\" not found."));
                    }
                    if options.yield_text.is_some() && options.escape_none {
                        output.extend(&program.source[token.start..token.end]);
                    }
                } else {
                    let text = env.text(value.handle)?;
                    output.extend(if token.kind == Kind::Name && !options.escape_none {
                        html(&text)
                    } else {
                        text
                    });
                }
                continue;
            }
            if !value.hit && options.validate {
                return Err(named("Template variable \"", &token.value, "\" not found."));
            }
            if token.kind == Kind::Inverted {
                if !value.truthy || (value.kind == ValueKind::Array && value.empty) {
                    tasks.extend(token.children.iter().rev().map(|id| {
                        Task::Token(program.clone(), *id, context, stack.clone(), false)
                    }));
                }
                continue;
            }
            if !value.truthy {
                continue;
            }
            if value.kind == ValueKind::Array {
                let iterator = env.iterate(value.handle)?;
                iterators.push(iterator);
                tasks.push(Task::Iterate(
                    program.clone(),
                    token.children.clone(),
                    context,
                    iterator,
                    stack,
                    false,
                ));
                continue;
            }
            if value.kind == ValueKind::Function {
                output.extend(env.lambda(
                    value.handle,
                    context,
                    &program.source[token.raw_start..token.raw_end],
                    &stack,
                )?);
                continue;
            }
            let child_context = if matches!(
                value.kind,
                ValueKind::Object | ValueKind::String | ValueKind::Number
            ) {
                env.push(context, value.handle)?
            } else {
                context
            };
            tasks.extend(
                token.children.iter().rev().map(|id| {
                    Task::Token(program.clone(), *id, child_context, stack.clone(), false)
                }),
            );
        }
        Ok(output)
    })();
    if result.is_err() {
        for iterator in iterators.into_iter().rev() {
            env.close(iterator);
        }
    }
    result
}
