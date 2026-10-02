//! Markdown code highlighting over JavaScript UTF-16 code units.
//! Tokens retain source ranges; adjacent equal kinds coalesce without copying text.
#[path = "code_highlight_tables.rs"]
mod tables;

#[derive(Clone, Copy)]
enum Family {
    Lexical,
    Data,
    Style,
    Line,
    Markup,
}
struct Language {
    family: Family,
    spec: &'static str,
}
struct LexicalSpec {
    keywords: &'static [&'static str],
    types: &'static [&'static str],
    constants: &'static [&'static str],
    booleans: &'static [&'static str],
    nulls: &'static [&'static str],
    commands: &'static [&'static str],
    line_comments: &'static [&'static str],
    block_comments: &'static [(&'static str, &'static str)],
    string_quotes: &'static [&'static str],
    template_quotes: bool,
    triple_string_quotes: bool,
    decorators: bool,
    rust_attributes: bool,
    variable_prefix: bool,
    flags: bool,
    case_insensitive: bool,
}
impl LexicalSpec {
    const EMPTY: Self = Self {
        keywords: &[],
        types: &[],
        constants: &[],
        booleans: &[],
        nulls: &[],
        commands: &[],
        line_comments: &[],
        block_comments: &[],
        string_quotes: &[],
        template_quotes: false,
        triple_string_quotes: false,
        decorators: false,
        rust_attributes: false,
        variable_prefix: false,
        flags: false,
        case_insensitive: false,
    };
}
#[derive(Debug, PartialEq)]
pub struct Token {
    pub kind: &'static str,
    pub start: usize,
    pub end: usize,
}
struct Emitter {
    tokens: Vec<Token>,
}
impl Emitter {
    fn push(&mut self, kind: &'static str, start: usize, end: usize) {
        if end <= start {
            return;
        }
        if let Some(previous) = self.tokens.last_mut()
            && previous.kind == kind
        {
            previous.end = end;
            return;
        }
        self.tokens.push(Token { kind, start, end });
    }
}
pub fn language_known(alias: &str) -> bool {
    tables::language(alias).is_some()
}
pub fn highlight(source: &[u16], alias: &str) -> Vec<Token> {
    let Some(language) = tables::language(alias) else {
        return vec![];
    };
    let tokens = match language.family {
        Family::Lexical => lexical(source, language.spec),
        Family::Data => match language.spec {
            "ini" | "toml" => line_data(source, true),
            "yaml" => line_data(source, false),
            _ => json(source, language.spec == "jsonc"),
        },
        Family::Style => style(source),
        Family::Line => line(source, language.spec),
        Family::Markup => markup(source),
    };
    if tokens.iter().any(|token| token.kind != "plain") {
        tokens
    } else {
        vec![]
    }
}
fn unit(source: &[u16], index: usize) -> u16 {
    source.get(index).copied().unwrap_or(u16::MAX)
}
fn alpha(c: u16) -> bool {
    matches!(c, 65..=90 | 97..=122)
}
fn digit(c: u16) -> bool {
    matches!(c, 48..=57)
}
fn hex(c: u16) -> bool {
    matches!(c, 48..=57 | 65..=70 | 97..=102)
}
fn whitespace(c: u16) -> bool {
    matches!(c, 32 | 10 | 13 | 9)
}
fn spaces(c: u16) -> bool {
    matches!(c, 32 | 9)
}
fn identifier_start(c: u16) -> bool {
    alpha(c) || matches!(c, 95 | 36)
}
fn identifier_part(c: u16) -> bool {
    identifier_start(c) || digit(c)
}
fn css_start(c: u16) -> bool {
    alpha(c) || matches!(c, 95 | 45 | 46)
}
fn css_part(c: u16) -> bool {
    css_start(c) || digit(c)
}
fn flag_start(c: u16) -> bool {
    alpha(c) || c == 45
}
fn flag_part(c: u16) -> bool {
    flag_start(c) || digit(c)
}
fn starts(source: &[u16], index: usize, marker: &str) -> bool {
    source
        .get(index..index + marker.len())
        .is_some_and(|slice| slice.iter().copied().eq(marker.bytes().map(u16::from)))
}
fn scan(source: &[u16], mut index: usize, predicate: fn(u16) -> bool) -> usize {
    while index < source.len() && predicate(source[index]) {
        index += 1;
    }
    index
}
fn identifier(source: &[u16], index: usize) -> usize {
    if identifier_start(unit(source, index)) {
        scan(source, index + 1, identifier_part)
    } else {
        index
    }
}
fn css_name(source: &[u16], index: usize) -> usize {
    if css_start(unit(source, index)) {
        scan(source, index + 1, css_part)
    } else {
        index
    }
}
fn number(source: &[u16], start: usize) -> usize {
    let mut index = start + usize::from(unit(source, start) == 45);
    let digits_start = index;
    index = scan(source, index, digit);
    let mut has_digit = index > digits_start;
    if unit(source, index) == 46 && digit(unit(source, index + 1)) {
        index = scan(source, index + 1, digit);
        has_digit = true;
    }
    if !has_digit {
        return start;
    }
    if matches!(unit(source, index), 101 | 69)
        && (digit(unit(source, index + 1)) || matches!(unit(source, index + 1), 43 | 45))
    {
        let exponent_start = index;
        index += 1;
        if matches!(unit(source, index), 43 | 45) {
            index += 1;
        }
        let digits_start = index;
        index = scan(source, index, digit);
        if index == digits_start {
            return exponent_start;
        }
    }
    index
}
fn quoted(source: &[u16], mut index: usize, quote: u16, triple: bool) -> usize {
    index += if triple { 3 } else { 1 };
    while index < source.len() {
        if source[index] == 92 {
            index = source.len().min(index + 2);
            continue;
        }
        if source[index] == quote
            && (!triple || (unit(source, index + 1) == quote && unit(source, index + 2) == quote))
        {
            return index + if triple { 3 } else { 1 };
        }
        index += 1;
    }
    index
}
fn until(source: &[u16], mut index: usize, marker: &str) -> usize {
    while index < source.len() {
        if starts(source, index, marker) {
            return index + marker.len();
        }
        index += 1;
    }
    index
}
fn line_end(source: &[u16], index: usize) -> usize {
    scan(source, index, |c| c != 10)
}
fn line_comment(source: &[u16], index: usize, markers: &[&str]) -> usize {
    if markers.iter().any(|marker| starts(source, index, marker)) {
        line_end(source, index)
    } else {
        index
    }
}
fn block_comment(source: &[u16], index: usize, markers: &[(&str, &str)]) -> usize {
    for (start, end) in markers {
        if starts(source, index, start) {
            return until(source, index + start.len(), end);
        }
    }
    index
}
fn lexical_word(word: &[u16], spec: &LexicalSpec) -> &'static str {
    // Identifier readers accept ASCII only; no Unicode folding is needed here.
    for (kind, words) in [
        ("boolean", spec.booleans),
        ("null", spec.nulls),
        ("keyword", spec.keywords),
        ("type", spec.types),
        ("command", spec.commands),
        ("number", spec.constants),
    ] {
        if words.iter().any(|entry| {
            word.len() == entry.len()
                && (word.iter().copied().eq(entry.bytes().map(u16::from))
                    || (spec.case_insensitive
                        && word
                            .iter()
                            .map(|c| (*c as u8).to_ascii_lowercase())
                            .eq(entry.bytes())))
        }) {
            return kind;
        }
    }
    "plain"
}
fn data_word(word: &[u16]) -> &'static str {
    for (kind, words) in [
        ("boolean", &["true", "false"][..]),
        ("null", &["null", "Null", "NULL", "~"][..]),
    ] {
        if words
            .iter()
            .any(|entry| word.iter().copied().eq(entry.bytes().map(u16::from)))
        {
            return kind;
        }
    }
    "plain"
}
fn lexical(source: &[u16], name: &str) -> Vec<Token> {
    let Some(spec) = tables::lexical(name) else {
        return vec![];
    };
    let mut emitter = Emitter { tokens: vec![] };
    let mut index = 0;
    while index < source.len() {
        let start = index;
        let c = source[index];
        index = scan(source, index, whitespace);
        if index > start {
            emitter.push("plain", start, index);
            continue;
        }
        index = line_comment(source, index, spec.line_comments);
        if index > start {
            emitter.push("comment", start, index);
            continue;
        }
        index = block_comment(source, index, spec.block_comments);
        if index > start {
            emitter.push("comment", start, index);
            continue;
        }
        if spec.rust_attributes && starts(source, index, "#[") {
            index = until(source, index + 2, "]");
            emitter.push("decorator", start, index);
            continue;
        }
        if spec.decorators && c == 64 && identifier_start(unit(source, index + 1)) {
            index = identifier(source, index + 1);
            emitter.push("decorator", start, index);
            continue;
        }
        if spec.variable_prefix && c == 36 && identifier_start(unit(source, index + 1)) {
            index = identifier(source, index + 1);
            let kind = lexical_word(&source[start..index], spec);
            emitter.push(
                if kind == "plain" { "variable" } else { kind },
                start,
                index,
            );
            continue;
        }
        if identifier_start(c) {
            let end = scan(source, index + 1, |c| identifier_part(c) || c == 45);
            if lexical_word(&source[start..end], spec) == "command" {
                index = end;
                emitter.push("command", start, index);
                continue;
            }
        }
        if spec.flags && c == 45 && flag_start(unit(source, index + 1)) {
            index = scan(source, index + 1, flag_part);
            emitter.push("flag", start, index);
            continue;
        }
        if spec.triple_string_quotes
            && matches!(c, 34 | 39)
            && unit(source, index + 1) == c
            && unit(source, index + 2) == c
        {
            index = quoted(source, index, c, true);
            emitter.push("string", start, index);
            continue;
        }
        if spec
            .string_quotes
            .iter()
            .any(|quote| u16::from(quote.as_bytes()[0]) == c)
        {
            index = quoted(source, index, c, false);
            emitter.push("string", start, index);
            continue;
        }
        if spec.template_quotes && c == 96 {
            index = quoted(source, index, c, false);
            emitter.push("template", start, index);
            continue;
        }
        index = number(source, index);
        if index > start {
            emitter.push("number", start, index);
            continue;
        }
        index = identifier(source, index);
        if index > start {
            emitter.push(lexical_word(&source[start..index], spec), start, index);
            continue;
        }
        index = start + 1;
        emitter.push("plain", start, index);
    }
    emitter.tokens
}
fn json(source: &[u16], comments: bool) -> Vec<Token> {
    let mut emitter = Emitter { tokens: vec![] };
    let mut index = 0;
    while index < source.len() {
        let start = index;
        index = scan(source, index, whitespace);
        if index > start {
            emitter.push("plain", start, index);
            continue;
        }
        if comments {
            index = line_comment(source, index, &["//"]);
            if index == start {
                index = block_comment(source, index, &[("/*", "*/")]);
            }
            if index > start {
                emitter.push("comment", start, index);
                continue;
            }
        }
        if source[index] == 34 {
            index = quoted(source, index, 34, false);
            let kind = if unit(source, scan(source, index, whitespace)) == 58 {
                "key"
            } else {
                "string"
            };
            emitter.push(kind, start, index);
            continue;
        }
        index = number(source, index);
        if index > start {
            emitter.push("number", start, index);
            continue;
        }
        index = identifier(source, index);
        if index > start {
            emitter.push(data_word(&source[start..index]), start, index);
            continue;
        }
        index = start + 1;
        emitter.push("plain", start, index);
    }
    emitter.tokens
}
fn key(source: &[u16], start: usize, config: bool) -> usize {
    let mut index = start;
    while index < source.len() {
        let c = source[index];
        if c == 58 || (config && c == 61) {
            if config {
                while index > start && spaces(source[index - 1]) {
                    index -= 1;
                }
            }
            return index;
        }
        if matches!(c, 10 | 35)
            || (config && c == 59)
            || (!config && matches!(c, 123 | 125 | 91 | 93))
        {
            return start;
        }
        index += 1;
    }
    start
}
fn line_data(source: &[u16], config: bool) -> Vec<Token> {
    let mut emitter = Emitter { tokens: vec![] };
    let mut index = 0;
    let mut at_start = true;
    while index < source.len() {
        let start = index;
        let c = source[index];
        if c == 10 {
            index += 1;
            emitter.push("plain", start, index);
            at_start = true;
            continue;
        }
        index = scan(source, index, spaces);
        if index > start {
            emitter.push("plain", start, index);
            continue;
        }
        let kind;
        if c == 35 || (config && c == 59) {
            index = line_end(source, index);
            kind = "comment";
        } else if !config && matches!(c, 34 | 39) {
            index = quoted(source, index, c, false);
            kind = "string";
        } else if config && at_start && c == 91 {
            index = until(source, index + 1, "]");
            kind = "selector";
        } else {
            let key_end = if at_start {
                key(source, index, config)
            } else {
                index
            };
            if key_end > index {
                index = key_end;
                kind = "key";
            } else if config && matches!(c, 34 | 39) {
                index = quoted(source, index, c, false);
                kind = "string";
            } else {
                index = number(source, index);
                if index > start {
                    kind = "number";
                } else {
                    index = identifier(source, index);
                    if index > start {
                        kind = data_word(&source[start..index]);
                    } else {
                        index = start + 1;
                        kind = "plain";
                    }
                }
            }
        }
        emitter.push(kind, start, index);
        at_start = false;
    }
    emitter.tokens
}
fn style(source: &[u16]) -> Vec<Token> {
    let mut emitter = Emitter { tokens: vec![] };
    let mut index = 0;
    while index < source.len() {
        let start = index;
        index = scan(source, index, whitespace);
        if index > start {
            emitter.push("plain", start, index);
            continue;
        }
        index = block_comment(source, index, &[("/*", "*/")]);
        if index > start {
            emitter.push("comment", start, index);
            continue;
        }
        if unit(source, index) == 64 {
            index = css_name(source, index + 1);
            if index > start + 1 {
                emitter.push("at-rule", start, index);
                continue;
            }
            // The reference retains the increment even when '@' has no CSS name.
        }
        if unit(source, index) == 35 && hex(unit(source, index + 1)) {
            index += 1;
            let limit = source.len().min(index + 8);
            while index < limit && hex(source[index]) {
                index += 1;
            }
            emitter.push("color", start, index);
            continue;
        }
        if starts(source, index, "!important") {
            index += 10;
            emitter.push("important", start, index);
            continue;
        }
        if matches!(unit(source, index), 34 | 39) {
            index = quoted(source, index, source[index], false);
            emitter.push("string", start, index);
            continue;
        }
        index = number(source, index);
        if index > start {
            emitter.push("number", start, index);
            continue;
        }
        index = css_name(source, index);
        if index > start {
            let kind = if unit(source, scan(source, index, whitespace)) == 58 {
                "property"
            } else {
                "selector"
            };
            emitter.push(kind, start, index);
            continue;
        }
        index = start + 1;
        emitter.push("plain", start, index);
    }
    emitter.tokens
}
fn line(source: &[u16], spec: &str) -> Vec<Token> {
    let mut emitter = Emitter { tokens: vec![] };
    let mut index = 0;
    let mut at_start = true;
    while index < source.len() {
        let start = index;
        let c = source[index];
        if c == 10 {
            index += 1;
            emitter.push("plain", start, index);
            at_start = true;
            continue;
        }
        let kind;
        if at_start && spec == "diff" && matches!(c, 43 | 45) {
            index = line_end(source, index);
            kind = if c == 43 { "string" } else { "important" };
        } else if at_start && spec == "markdown" && c == 35 {
            index = line_end(source, index);
            kind = "keyword";
        } else {
            let directive = if at_start && spec == "dockerfile" {
                identifier(source, index)
            } else {
                index
            };
            if directive > index {
                index = directive;
                kind = "directive";
            } else if c == 35 && spec != "diff" {
                index = line_end(source, index);
                kind = "comment";
            } else if matches!(c, 34 | 39) {
                index = quoted(source, index, c, false);
                kind = "string";
            } else {
                index = number(source, index);
                if index > start {
                    kind = "number";
                } else {
                    index = start + 1;
                    kind = "plain";
                }
            }
        }
        emitter.push(kind, start, index);
        at_start = false;
    }
    emitter.tokens
}
fn markup(source: &[u16]) -> Vec<Token> {
    let mut emitter = Emitter { tokens: vec![] };
    let mut index = 0;
    while index < source.len() {
        let start = index;
        if starts(source, index, "<!--") {
            index = until(source, index + 4, "-->");
            emitter.push("comment", start, index);
            continue;
        }
        if source[index] != 60 {
            index += 1;
            emitter.push("plain", start, index);
            continue;
        }
        emitter.push("punctuation", index, index + 1);
        index += 1;
        if unit(source, index) == 47 {
            emitter.push("punctuation", index, index + 1);
            index += 1;
        }
        let tag_start = index;
        index = identifier(source, index);
        emitter.push("tag", tag_start, index);
        while index < source.len() && source[index] != 62 {
            let start = index;
            index = scan(source, index, whitespace);
            if index > start {
                emitter.push("plain", start, index);
                continue;
            }
            if matches!(source[index], 34 | 39) {
                index = quoted(source, index, source[index], false);
                emitter.push("string", start, index);
                continue;
            }
            index = identifier(source, index);
            if index > start {
                emitter.push("attribute", start, index);
                continue;
            }
            index = start + 1;
            emitter.push("punctuation", start, index);
        }
        if unit(source, index) == 62 {
            emitter.push("punctuation", index, index + 1);
            index += 1;
        }
    }
    emitter.tokens
}
