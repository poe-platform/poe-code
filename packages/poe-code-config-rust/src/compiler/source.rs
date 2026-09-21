use super::lex::{Kind, Token, lex};
use super::{Field, Fragment, Source, text, u};
use mcp_protocol_rust::json::Value;
use std::collections::{HashMap, HashSet};
type Span = (usize, usize);
struct Parser<'a> {
    path: &'a str,
    raw: &'a [u16],
    tokens: Vec<Token>,
    mates: Vec<Option<usize>>,
}
impl Parser<'_> {
    fn error(&self, message: &str) -> String {
        format!("{}: {}", self.path, message)
    }
    fn next(&self, index: usize) -> usize {
        self.mates[index]
            .filter(|mate| *mate > index)
            .map_or(index + 1, |mate| mate + 1)
    }
    fn split(&self, start: usize, end: usize, separator: u8) -> Vec<Span> {
        let mut parts = vec![];
        let mut cursor = start;
        let mut begin = start;
        while cursor < end {
            if self.tokens[cursor].symbol(separator) {
                if cursor > begin {
                    parts.push((begin, cursor));
                }
                begin = cursor + 1;
                cursor += 1;
            } else {
                cursor = self.next(cursor);
            }
        }
        if begin < end {
            parts.push((begin, end));
        }
        parts
    }
    fn group(&self, span: Span, symbol: u8) -> bool {
        span.0 < span.1
            && self.tokens[span.0].symbol(symbol)
            && self.mates[span.0] == Some(span.1 - 1)
    }
    fn safe(&self, name: Vec<u16>) -> Result<Vec<u16>, String> {
        if name == u("__proto__") {
            Err(self.error(&format!("Unsafe config schema name \"{}\"", text(&name))))
        } else {
            Ok(name)
        }
    }
    fn name(&self, span: Span) -> Result<Vec<u16>, String> {
        if span.1 == span.0 + 1 {
            match &self.tokens[span.0].kind {
                Kind::Ident(value) | Kind::Quoted(value) => return self.safe(value.clone()),
                _ => {}
            }
        }
        Err(self.error("config schema property names must be static"))
    }
    fn property(&self, span: Span, message: &str) -> Result<(Vec<u16>, Span), String> {
        let (start, end) = span;
        let mut cursor = start;
        while cursor < end {
            if self.tokens[cursor].symbol(b':') {
                let name = self.name((start, cursor))?;
                if cursor + 1 == end {
                    return Err(self.error(message));
                }
                return Ok((name, (cursor + 1, end)));
            }
            cursor = self.next(cursor);
        }
        Err(self.error(message))
    }
    fn metadata(&self, span: Span) -> Result<Vec<(Vec<u16>, Span)>, String> {
        let mut seen = HashSet::new();
        let mut properties = vec![];
        for span in self.split(span.0 + 1, span.1 - 1, b',') {
            let (name, span) =
                self.property(span, "object literals in config schemas must be static")?;
            if !seen.insert(name.clone()) {
                return Err(
                    self.error(&format!("duplicate object literal key \"{}\"", text(&name)))
                );
            }
            properties.push((name, span));
        }
        Ok(properties)
    }
    fn literal(&self, span: Span, depth: usize) -> Result<Value, String> {
        if depth > 128 {
            return Err(self.error("Static config literal depth exceeded (128)."));
        }
        if span.1 == span.0 + 1 {
            match &self.tokens[span.0].kind {
                Kind::Quoted(value) | Kind::Template(value, false) => {
                    return Ok(Value::String(value.clone()));
                }
                Kind::Number(value) => {
                    let normalized: Vec<u16> =
                        value.iter().copied().filter(|unit| *unit != 95).collect();
                    let number = crate::coerce::number_text(&normalized)
                        .or_else(|| String::from_utf16(&normalized).ok()?.parse::<f64>().ok());
                    if let Some(value) = number {
                        return Ok(Value::Number(value));
                    }
                }
                _ => {}
            }
            for (keyword, value) in [
                ("true", Value::Bool(true)),
                ("false", Value::Bool(false)),
                ("null", Value::Null),
            ] {
                if self.tokens[span.0].is(keyword) {
                    return Ok(value);
                }
            }
        }
        if self.group(span, b'{') {
            let mut fields = vec![];
            let mut seen = HashSet::new();
            for part in self.split(span.0 + 1, span.1 - 1, b',') {
                let (name, value) =
                    self.property(part, "object literals in config schemas must be static")?;
                if !seen.insert(name.clone()) {
                    return Err(
                        self.error(&format!("duplicate object literal key \"{}\"", text(&name)))
                    );
                }
                fields.push((name, self.literal(value, depth + 1)?));
            }
            return Ok(Value::Object(fields));
        }
        if self.group(span, b'[') {
            return Err(self.error("array literals are not supported in v1 config schemas"));
        }
        Err(self.error("config schemas must contain only static literal values"))
    }
    fn field(&self, name: Vec<u16>, span: Span) -> Result<Field, String> {
        if !self.group(span, b'{') {
            return Err(self.error(&format!(
                "config field \"{}\" must be an object literal",
                text(&name)
            )));
        }
        let metadata = self.metadata(span)?;
        let map: HashMap<_, _> = metadata.iter().cloned().collect();
        let Some(type_span) = map.get(&u("type")) else {
            return Err(self.error(&format!(
                "config field \"{}\" type must be a string literal",
                text(&name)
            )));
        };
        let kind = self.literal(*type_span, 0)?;
        if kind == Value::String(u("json")) {
            return Err(self.error(&format!(
                "config field \"{}\" uses json, which schema compilation does not support yet",
                text(&name)
            )));
        }
        for (key, _) in &metadata {
            if !["type", "default", "doc", "env"]
                .iter()
                .any(|name| *key == u(name))
            {
                return Err(self.error(&format!(
                    "Unsupported metadata \"{}\" on config field \"{}\"",
                    text(key),
                    text(&name)
                )));
            }
        }
        let Value::String(kind) = kind else {
            return Err(self.error(&format!(
                "config field \"{}\" must use a primitive type supported by schema compilation",
                text(&name)
            )));
        };
        if !["string", "number", "boolean"]
            .iter()
            .any(|name| kind == u(name))
        {
            return Err(self.error(&format!(
                "config field \"{}\" must use a primitive type supported by schema compilation",
                text(&name)
            )));
        }
        let literal = |key: &str| {
            map.get(&u(key))
                .map(|span| self.literal(*span, 0))
                .transpose()
        };
        // The original evaluates all three optional literals before type diagnostics.
        let default = literal("default")?;
        let doc = literal("doc")?;
        let env = literal("env")?;
        let Some(default) = default.filter(|value| {
            matches!(
                (text(&kind).as_str(), value),
                ("string", Value::String(_))
                    | ("number", Value::Number(_))
                    | ("boolean", Value::Bool(_))
            )
        }) else {
            return Err(self.error(&format!(
                "config field \"{}\" default must match its type",
                text(&name)
            )));
        };
        let Some(Value::String(doc)) = doc else {
            return Err(self.error(&format!(
                "config field \"{}\" doc must be a string literal",
                text(&name)
            )));
        };
        if env.is_some_and(|value| !matches!(value, Value::String(_))) {
            return Err(self.error(&format!(
                "config field \"{}\" env must be a string literal",
                text(&name)
            )));
        }
        Ok(Field {
            name,
            kind,
            default,
            doc,
        })
    }
    fn fragment(&self, span: Span) -> Result<Fragment, String> {
        let arguments = self.split(span.0 + 1, span.1 - 1, b',');
        let Some(&(start, end)) = arguments.first() else {
            return Err(self.error("defineScope scope name must be a string literal"));
        };
        let scope = if end == start + 1 {
            if let Kind::Quoted(value) = &self.tokens[start].kind {
                self.safe(value.clone())?
            } else {
                return Err(self.error("defineScope scope name must be a string literal"));
            }
        } else {
            return Err(self.error("defineScope scope name must be a string literal"));
        };
        let Some(&schema) = arguments.get(1) else {
            return Err(self.error("defineScope schema must be an object literal"));
        };
        if !self.group(schema, b'{') {
            return Err(self.error("defineScope schema must be an object literal"));
        }
        let mut seen = HashSet::new();
        let mut fields = vec![];
        for part in self.split(schema.0 + 1, schema.1 - 1, b',') {
            let (name, span) =
                self.property(part, "scope schema fields must be property assignments")?;
            if !seen.insert(name.clone()) {
                return Err(format!(
                    "Duplicate config field \"{}.{}\" in {}",
                    text(&scope),
                    text(&name),
                    self.path
                ));
            }
            fields.push(self.field(name, span)?);
        }
        Ok(Fragment {
            scope,
            fields,
            source: self.path.to_owned(),
        })
    }
    fn line_before(&self, index: usize) -> bool {
        index > 0
            && self.raw[self.tokens[index - 1].end..self.tokens[index].start]
                .iter()
                .any(|unit| matches!(unit, 10 | 13 | 8232 | 8233))
    }
    fn specifier(&self, start: usize, end: usize, side_effect: bool) -> Option<Vec<u16>> {
        if side_effect
            && let Some(Token {
                kind: Kind::Quoted(value),
                ..
            }) = self.tokens.get(start + 1)
        {
            return Some(value.clone());
        }
        let mut cursor = start + 1;
        while cursor < end {
            if self.tokens[cursor].is("from")
                && let Some(Token {
                    kind: Kind::Quoted(value),
                    ..
                }) = self.tokens.get(cursor + 1)
            {
                return Some(value.clone());
            }
            cursor = self.next(cursor);
        }
        None
    }
    fn statement_end(&self, start: usize) -> usize {
        let mut cursor = start;
        while cursor < self.tokens.len() {
            if self.tokens[cursor].symbol(b';') {
                return cursor;
            }
            if cursor > start
                && self.line_before(cursor)
                && self.tokens[cursor - 1].symbol(b')')
                && matches!(self.tokens[cursor].kind, Kind::Ident(_))
                && !["as", "satisfies", "in", "instanceof"]
                    .iter()
                    .any(|keyword| self.tokens[cursor].is(keyword))
            {
                return cursor;
            }
            if cursor > start
                && (self.tokens[cursor].is("export")
                    || self.tokens[cursor].is("import")
                    || self.line_before(cursor)
                        && [
                            "import",
                            "export",
                            "const",
                            "let",
                            "var",
                            "function",
                            "class",
                            "interface",
                            "type",
                        ]
                        .iter()
                        .any(|word| self.tokens[cursor].is(word)))
            {
                return cursor;
            }
            cursor = self.next(cursor);
        }
        cursor
    }
    fn variables(&self, start: usize) -> Vec<(Vec<u16>, Span)> {
        let end = self.statement_end(start);
        let mut result = vec![];
        let mut spans = vec![];
        let mut cursor = start + 1;
        let mut begin = cursor;
        while cursor < end {
            let separator = self.tokens[cursor].symbol(b',')
                && self
                    .tokens
                    .get(cursor + 1)
                    .is_some_and(|token| matches!(token.kind, Kind::Ident(_)))
                && (cursor + 2 >= end
                    || self.tokens[cursor + 2].symbol(b'=')
                    || self.tokens[cursor + 2].symbol(b':')
                    || self.tokens[cursor + 2].symbol(b','));
            if separator {
                spans.push((begin, cursor));
                begin = cursor + 1;
                cursor += 1;
            } else {
                cursor = self.next(cursor);
            }
        }
        if begin < end {
            spans.push((begin, end));
        }
        for (begin, end) in spans {
            let Kind::Ident(name) = &self.tokens[begin].kind else {
                continue;
            };
            let mut cursor = begin + 1;
            while cursor < end {
                if self.tokens[cursor].symbol(b'=')
                    && !self
                        .tokens
                        .get(cursor + 1)
                        .is_some_and(|token| token.symbol(b'>'))
                {
                    result.push((name.clone(), (cursor + 1, end)));
                    break;
                }
                cursor = self.next(cursor);
            }
        }
        result
    }
}
pub fn scan(path: &str, raw: &[u16], mode: super::Mode) -> Result<Source, String> {
    let (tokens, mates) = lex(raw).map_err(|message| format!("{path}: {message}"))?;
    let parser = Parser {
        path,
        raw,
        tokens,
        mates,
    };
    let mut names = HashSet::new();
    let mut exported = HashSet::new();
    let mut declarations = vec![];
    let mut imports = vec![];
    let mut exports = vec![];
    let mut cursor = 0;
    while cursor < parser.tokens.len() {
        let token = &parser.tokens[cursor];
        if token.is("import")
            && !parser
                .tokens
                .get(cursor + 1)
                .is_some_and(|token| token.symbol(b'(') || token.symbol(b'.'))
        {
            let end = parser.statement_end(cursor);
            let module = parser.specifier(cursor, end, true);
            if let Some(module) = module {
                if !parser
                    .tokens
                    .get(cursor + 1)
                    .is_some_and(|token| token.is("type"))
                {
                    imports.push(module.clone());
                }
                if [
                    "@poe-code/poe-code-config",
                    "@poe-code/poe-code-config/core",
                    "@poe-code/poe-code-config-rust",
                    "@poe-code/poe-code-config-rust/core",
                ]
                .iter()
                .any(|name| module == u(name))
                    && let Some(open) = (cursor + 1..end).find(|i| parser.tokens[*i].symbol(b'{'))
                {
                    let close = parser.mates[open].unwrap();
                    for (start, end) in parser.split(open + 1, close, b',') {
                        let start = if parser.tokens[start].is("type") {
                            start + 1
                        } else {
                            start
                        };
                        if start < end && parser.tokens[start].is("defineScope") {
                            let alias = if start + 2 < end && parser.tokens[start + 1].is("as") {
                                &parser.tokens[start + 2]
                            } else {
                                &parser.tokens[start]
                            };
                            if let Kind::Ident(name) = &alias.kind {
                                names.insert(name.clone());
                            }
                        }
                    }
                }
            }
            cursor = end;
            continue;
        }
        if token.is("export") {
            let end = parser.statement_end(cursor);
            let next = cursor + 1;
            if parser
                .tokens
                .get(next)
                .is_some_and(|token| token.is("const") || token.is("let") || token.is("var"))
            {
                let vars = parser.variables(next);
                for (name, span) in vars {
                    exported.insert(name.clone());
                    declarations.push((name, span));
                }
                cursor = parser.statement_end(next);
                continue;
            }
            if parser
                .tokens
                .get(next)
                .is_some_and(|token| token.symbol(b'{'))
            {
                let close = parser.mates[next].unwrap();
                for (start, end) in parser.split(next + 1, close, b',') {
                    let exported_name = if start + 2 < end && parser.tokens[start + 1].is("as") {
                        &parser.tokens[start + 2]
                    } else {
                        &parser.tokens[start]
                    };
                    if let Kind::Ident(name) = &exported_name.kind {
                        exported.insert(name.clone());
                    }
                }
            }
            if !parser
                .tokens
                .get(next)
                .is_some_and(|token| token.is("type"))
                && let Some(module) = parser.specifier(cursor, end, false)
            {
                exports.push(module);
            }
            cursor = end;
            continue;
        }
        if token.is("const") || token.is("let") || token.is("var") {
            declarations.extend(parser.variables(cursor));
            cursor = parser.statement_end(cursor);
            continue;
        }
        cursor = parser.next(cursor);
    }
    if matches!(mode, super::Mode::Imports) {
        imports.extend(exports);
        return Ok(Source {
            imports,
            fragments: vec![],
        });
    }
    let mut fragments = vec![];
    for (name, (start, end)) in declarations {
        if !exported.contains(&name) || start >= end {
            continue;
        }
        let Kind::Ident(callee) = &parser.tokens[start].kind else {
            continue;
        };
        if !names.contains(callee) {
            continue;
        }
        let mut open = start + 1;
        if open < end && parser.tokens[open].symbol(b'<') {
            let mut nesting = 1;
            open += 1;
            while open < end && nesting > 0 {
                if parser.tokens[open].symbol(b'<') {
                    nesting += 1;
                    open += 1;
                } else if parser.tokens[open].symbol(b'>') && !parser.tokens[open - 1].symbol(b'=')
                {
                    nesting -= 1;
                    open += 1;
                } else {
                    open = parser.next(open);
                }
            }
        }
        if open < end && parser.tokens[open].symbol(b'(') && parser.mates[open] == Some(end - 1) {
            fragments.push(parser.fragment((open, end))?);
        }
    }
    imports.extend(exports);
    Ok(Source { imports, fragments })
}
