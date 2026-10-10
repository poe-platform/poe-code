use std::collections::{BTreeMap, BTreeSet};
use crate::shell::lexer::{Token, tokenize_shell};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedirectKind {
    Out(u32),
    Append(u32),
    Clobber(u32),
    In(u32),
    ReadWrite(u32),
    HereString(u32),
    HereDoc {
        fd: u32,
        quoted: bool,
        eof_warning: Option<String>,
    },
    DupOut {
        fd: u32,
        explicit_fd: bool,
        raw_move: bool,
    },
    DupIn {
        fd: u32,
        raw_move: bool,
    },
    BothOut,
    BothAppend,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redirect {
    pub kind: RedirectKind,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleCommand {
    pub assignments: Vec<(String, String, bool)>,
    pub words: Vec<String>,
    pub redirects: Vec<Redirect>,
    pub line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaseTerminator {
    Break,
    Fallthrough,
    ContinueTesting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandNode {
    Simple(SimpleCommand),
    Subshell {
        body: Script,
        redirects: Vec<Redirect>,
    },
    Group {
        body: Script,
        redirects: Vec<Redirect>,
    },
    If {
        branches: Vec<(Script, Script)>,
        else_branch: Option<Script>,
        redirects: Vec<Redirect>,
    },
    ForIn {
        var: String,
        items: Vec<String>,
        body: Script,
        redirects: Vec<Redirect>,
    },
    Select {
        var: String,
        items: Vec<String>,
        body: Script,
        redirects: Vec<Redirect>,
    },
    ForArith {
        init: String,
        cond: String,
        step: String,
        body: Script,
        redirects: Vec<Redirect>,
    },
    While {
        until: bool,
        cond: Script,
        body: Script,
        redirects: Vec<Redirect>,
    },
    Case {
        word: String,
        arms: Vec<(Vec<String>, Script, CaseTerminator)>,
        redirects: Vec<Redirect>,
    },
    ArithCommand {
        expr: String,
        redirects: Vec<Redirect>,
    },
    FuncDef {
        name: String,
        body: Script,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pipeline {
    pub negated: bool,
    pub commands: Vec<CommandNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListOp {
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AndOrList {
    pub first: Pipeline,
    pub rest: Vec<(ListOp, Pipeline)>,
    pub background: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Script {
    pub lists: Vec<AndOrList>,
}

pub fn validate_basic_syntax(script: &str) -> Result<(), String> {
    let tokens = tokenize_shell(script)?;
    validate_tokens_syntax(&tokens)
}

pub fn validate_tokens_syntax(tokens: &[Token]) -> Result<(), String> {
    let mut if_depth = 0i32;
    let mut do_depth = 0i32;
    let mut case_depth = 0i32;
    // (base_paren_depth, state: 0=after case, 1=after word, 2=expecting pat/esac, 3=in pat, 4=in arm body)
    let mut case_stack: Vec<(i32, u8)> = Vec::new();
    let mut paren_depth = 0i32;
    let mut brace_depth = 0i32;

    let mut at_cmd_start = true;
    let mut for_state = 0u8; // 0: none, 1: after for/select, 2: after var, 3: in word list
    let mut idx = 0usize;
    while idx < tokens.len() {
        if let Some((base_paren, state)) = case_stack.last_mut()
            && paren_depth == *base_paren
        {
            match *state {
                0 => {
                    if matches!(tokens.get(idx), Some(Token::Word(_))) {
                        *state = 1;
                        at_cmd_start = false;
                        idx += 1;
                        continue;
                    }
                }
                1 => {
                    match tokens.get(idx) {
                        Some(Token::Newline) => {
                            at_cmd_start = false;
                            idx += 1;
                            continue;
                        }
                        Some(Token::Word(w)) if w == "in" => {
                            *state = 2;
                            at_cmd_start = false;
                            idx += 1;
                            continue;
                        }
                        _ => {}
                    }
                }
                2 => {
                    match tokens.get(idx) {
                        Some(Token::Newline) => {
                            at_cmd_start = false;
                            idx += 1;
                            continue;
                        }
                        Some(Token::LParen) => {
                            *state = 3;
                            paren_depth += 1;
                            at_cmd_start = false;
                            idx += 1;
                            continue;
                        }
                        Some(Token::Word(w)) => {
                            if w == "esac" {
                                case_depth -= 1;
                                case_stack.pop();
                                at_cmd_start = false;
                            } else {
                                *state = 3;
                                at_cmd_start = false;
                            }
                            idx += 1;
                            continue;
                        }
                        _ => {}
                    }
                }
                3 => {
                    match tokens.get(idx) {
                        Some(Token::RParen) => {
                            *state = 4;
                            at_cmd_start = true;
                            idx += 1;
                            continue;
                        }
                        _ => {
                            at_cmd_start = false;
                            idx += 1;
                            continue;
                        }
                    }
                }
                4 => {
                    if matches!(tokens.get(idx), Some(Token::Semi))
                        && matches!(tokens.get(idx + 1), Some(Token::Semi))
                    {
                        *state = 2;
                        for_state = 0;
                        at_cmd_start = false;
                        if matches!(tokens.get(idx + 2), Some(Token::Background)) {
                            idx += 3;
                        } else {
                            idx += 2;
                        }
                        continue;
                    }
                    if matches!(tokens.get(idx), Some(Token::Semi))
                        && matches!(tokens.get(idx + 1), Some(Token::Background))
                    {
                        *state = 2;
                        for_state = 0;
                        at_cmd_start = false;
                        idx += 2;
                        continue;
                    }
                }
                _ => {}
            }
        } else if let Some((base_paren, state)) = case_stack.last_mut()
            && *state == 3
            && paren_depth == *base_paren + 1
        {
            if matches!(tokens.get(idx), Some(Token::RParen)) {
                paren_depth -= 1;
                *state = 4;
                at_cmd_start = true;
                idx += 1;
                continue;
            }
            at_cmd_start = false;
            idx += 1;
            continue;
        }

        let tok = &tokens[idx];
        idx += 1;
        match tok {
            Token::Newline => {
                if for_state == 2 {
                    at_cmd_start = false;
                } else {
                    for_state = 0;
                    at_cmd_start = true;
                }
            }
            Token::Semi | Token::Pipe | Token::AndIf | Token::OrIf | Token::Background => {
                for_state = 0;
                at_cmd_start = true;
            }
            Token::LParen => {
                for_state = 0;
                paren_depth += 1;
                at_cmd_start = true;
            }
            Token::RParen => {
                if case_depth > 0 && case_stack.last().map(|(bp, _)| *bp) == Some(paren_depth) {
                    at_cmd_start = true;
                } else {
                    paren_depth -= 1;
                    if paren_depth < 0 {
                        return Err("Syntax error: unexpected `)`".to_string());
                    }
                    if case_depth > 0 && case_stack.last().map(|(bp, _)| *bp) == Some(paren_depth) {
                        at_cmd_start = true;
                    }
                }
            }
            Token::Word(w) => {
                if for_state == 1 {
                    for_state = 2;
                    at_cmd_start = false;
                } else if for_state == 2 {
                    if w == "in" {
                        for_state = 3;
                        at_cmd_start = false;
                    } else if w == "do" {
                        for_state = 0;
                        do_depth += 1;
                        at_cmd_start = true;
                    } else {
                        for_state = 0;
                        at_cmd_start = false;
                    }
                } else if for_state == 3 {
                    at_cmd_start = false;
                } else if at_cmd_start {
                    match w.as_str() {
                        "if" => {
                            if_depth += 1;
                            at_cmd_start = true;
                        }
                        "then" | "elif" | "else" => {
                            if if_depth <= 0 {
                                return Err(format!("Syntax error: unexpected `{w}`"));
                            }
                            at_cmd_start = true;
                        }
                        "fi" => {
                            if_depth -= 1;
                            if if_depth < 0 {
                                return Err("Syntax error: unexpected `fi`".to_string());
                            }
                            at_cmd_start = false;
                        }
                        "for" | "select" => {
                            for_state = 1;
                            at_cmd_start = false;
                        }
                        "while" | "until" => {
                            at_cmd_start = true;
                        }
                        "do" => {
                            do_depth += 1;
                            at_cmd_start = true;
                        }
                        "done" => {
                            do_depth -= 1;
                            if do_depth < 0 {
                                return Err("Syntax error: unexpected `done`".to_string());
                            }
                            at_cmd_start = false;
                        }
                        "case" => {
                            case_depth += 1;
                            case_stack.push((paren_depth, 0));
                            at_cmd_start = false;
                        }
                        "esac" => {
                            case_depth -= 1;
                            case_stack.pop();
                            if case_depth < 0 {
                                return Err("Syntax error: unexpected `esac`".to_string());
                            }
                            at_cmd_start = false;
                        }
                        "{" => {
                            brace_depth += 1;
                            at_cmd_start = true;
                        }
                        "}" => {
                            brace_depth -= 1;
                            if brace_depth < 0 {
                                return Err("Syntax error: unexpected `}`".to_string());
                            }
                            at_cmd_start = false;
                        }
                        "!" => {
                            at_cmd_start = true;
                        }
                        _ => {
                            at_cmd_start = false;
                        }
                    }
                }
            }
            _ => {
                at_cmd_start = false;
            }
        }
    }

    if if_depth != 0 {
        return Err("Syntax error: unexpected end of file (expecting `fi`)".to_string());
    }
    if do_depth != 0 {
        return Err("Syntax error: unexpected end of file (expecting `done`)".to_string());
    }
    if case_depth != 0 {
        return Err("Syntax error: unexpected end of file (expecting `esac`)".to_string());
    }
    if paren_depth != 0 {
        return Err("Syntax error: unclosed `(`".to_string());
    }
    if brace_depth != 0 {
        return Err("Syntax error: unclosed `{`".to_string());
    }
    Ok(())
}

struct AliasTokenState {
    cmd_pos: bool,
    check_next: bool,
    expect_redirect_target: bool,
    expect_case_word: bool,
    expect_case_in: bool,
    in_case_pat: bool,
    expect_for_var: bool,
    expect_for_in: bool,
    prev_was_lparen: bool,
}

impl AliasTokenState {
    fn new() -> Self {
        Self {
            cmd_pos: true,
            check_next: false,
            expect_redirect_target: false,
            expect_case_word: false,
            expect_case_in: false,
            in_case_pat: false,
            expect_for_var: false,
            expect_for_in: false,
            prev_was_lparen: false,
        }
    }

    fn can_expand(&self) -> bool {
        (self.cmd_pos || self.check_next)
            && !self.expect_redirect_target
            && !self.expect_case_word
            && !self.expect_case_in
            && !self.in_case_pat
            && !self.expect_for_var
            && !self.expect_for_in
    }

    fn feed(&mut self, tok: &Token) {
        if self.expect_redirect_target {
            if matches!(tok, Token::Word(_)) {
                self.expect_redirect_target = false;
                return;
            }
            self.expect_redirect_target = false;
        }
        self.check_next = false;
        match tok {
            Token::Semi
            | Token::Newline
            | Token::Pipe
            | Token::Background
            | Token::AndIf
            | Token::OrIf => {
                self.cmd_pos = true;
                self.expect_case_word = false;
                self.expect_case_in = false;
                self.in_case_pat = false;
                self.expect_for_var = false;
                self.expect_for_in = false;
                self.prev_was_lparen = false;
            }
            Token::LParen => {
                self.prev_was_lparen = true;
                if !self.in_case_pat {
                    self.cmd_pos = true;
                }
            }
            Token::RParen => {
                if self.in_case_pat {
                    self.in_case_pat = false;
                    self.cmd_pos = true;
                } else {
                    self.cmd_pos = self.prev_was_lparen;
                }
                self.prev_was_lparen = false;
            }
            Token::RedirectOut(_)
            | Token::RedirectAppend(_)
            | Token::RedirectClobber(_)
            | Token::RedirectIn(_)
            | Token::RedirectReadWrite(_)
            | Token::RedirectHereString(_)
            | Token::RedirectDupOut(_, _)
            | Token::RedirectDupIn(_)
            | Token::RedirectBothOut
            | Token::RedirectBothAppend => {
                self.expect_redirect_target = true;
                self.prev_was_lparen = false;
            }
            Token::RedirectHereDoc { .. } => {
                self.prev_was_lparen = false;
            }
            Token::Word(w) => {
                self.prev_was_lparen = false;
                if matches!(w.as_str(), ";;" | ";&" | ";;&") {
                    self.in_case_pat = true;
                    self.cmd_pos = false;
                } else if self.expect_case_word {
                    self.expect_case_word = false;
                    self.expect_case_in = true;
                    self.cmd_pos = false;
                } else if self.expect_case_in {
                    if w == "in" {
                        self.expect_case_in = false;
                        self.in_case_pat = true;
                        self.cmd_pos = false;
                    }
                } else if self.in_case_pat {
                    if w == "esac" {
                        self.in_case_pat = false;
                        self.cmd_pos = false;
                    }
                } else if self.expect_for_var {
                    self.expect_for_var = false;
                    self.expect_for_in = true;
                    self.cmd_pos = false;
                } else if self.expect_for_in {
                    if w == "in" {
                        self.expect_for_in = false;
                        self.cmd_pos = false;
                    } else if w == "do" {
                        self.expect_for_in = false;
                        self.cmd_pos = true;
                    }
                } else if self.cmd_pos {
                    match w.as_str() {
                        "if" | "then" | "elif" | "else" | "while" | "until" | "do" | "{" | "!"
                        | "time" => {
                            self.cmd_pos = true;
                        }
                        "case" => {
                            self.cmd_pos = false;
                            self.expect_case_word = true;
                        }
                        "for" | "select" => {
                            self.cmd_pos = false;
                            self.expect_for_var = true;
                        }
                        "function" | "[[" => {
                            self.cmd_pos = false;
                        }
                        _ => {
                            self.cmd_pos = parse_assignment_word(w).is_some();
                        }
                    }
                } else if w == "{" {
                    self.cmd_pos = true;
                }
            }
        }
    }
}

fn expand_tokens_with_aliases_inner(
    tokens: &[Token],
    aliases: &BTreeMap<String, String>,
    active: &BTreeSet<String>,
    state: &mut AliasTokenState,
) -> Result<Vec<Token>, String> {
    if aliases.is_empty() {
        return Ok(tokens.to_vec());
    }
    let mut out = Vec::with_capacity(tokens.len());
    let mut idx = 0usize;
    while idx < tokens.len() {
        let tok = &tokens[idx];
        if let Token::Word(w) = tok {
            let is_func_def = matches!(tokens.get(idx + 1), Some(Token::LParen))
                && matches!(tokens.get(idx + 2), Some(Token::RParen));
            if state.can_expand()
                && !is_func_def
                && !w.is_empty()
                && !w.contains(['\'', '"', '\\', '$', '`'])
                && !active.contains(w.as_str())
                && let Some(val) = aliases.get(w.as_str())
            {
                let has_trailing_ws = val.ends_with(' ') || val.ends_with('\t');
                let mut sub_tokens = tokenize_shell(val)?;
                if !val.ends_with('\n') && matches!(sub_tokens.last(), Some(Token::Newline)) {
                    sub_tokens.pop();
                }
                let mut next_active = active.clone();
                next_active.insert(w.clone());
                let sub_expanded =
                    expand_tokens_with_aliases_inner(&sub_tokens, aliases, &next_active, state)?;
                out.extend(sub_expanded);
                if has_trailing_ws {
                    state.check_next = true;
                }
                idx += 1;
                continue;
            }
        }
        state.feed(tok);
        out.push(tok.clone());
        idx += 1;
    }
    Ok(out)
}

pub fn expand_tokens_with_aliases(
    tokens: &[Token],
    aliases: &BTreeMap<String, String>,
) -> Result<Vec<Token>, String> {
    let mut state = AliasTokenState::new();
    expand_tokens_with_aliases_inner(tokens, aliases, &BTreeSet::new(), &mut state)
}

pub fn parse_script(input: &str) -> Result<Script, String> {
    validate_basic_syntax(input)?;
    let tokens = tokenize_shell(input)?;
    let mut pos = 0usize;
    parse_tokens(&tokens, &mut pos, &[])
}

pub fn parse_script_with_aliases(
    input: &str,
    aliases: &BTreeMap<String, String>,
    line_offset: usize,
) -> Result<Script, String> {
    let raw_tokens = tokenize_shell(input)?;
    let expanded = expand_tokens_with_aliases(&raw_tokens, aliases)?;
    validate_tokens_syntax(&expanded)?;
    let mut tokens = Vec::with_capacity(line_offset + expanded.len());
    for _ in 0..line_offset {
        tokens.push(Token::Newline);
    }
    tokens.extend(expanded);
    let mut pos = 0usize;
    parse_tokens(&tokens, &mut pos, &[])
}

pub fn is_incomplete_shell_unit(chunk: &str, aliases: &BTreeMap<String, String>) -> bool {
    let stripped = chunk.strip_suffix('\n').unwrap_or(chunk);
    let trailing_backslashes = stripped.bytes().rev().take_while(|&b| b == b'\\').count();
    if trailing_backslashes % 2 == 1 {
        return true;
    }
    let Ok(raw_tokens) = tokenize_shell(chunk) else {
        return true;
    };
    let Ok(tokens) = expand_tokens_with_aliases(&raw_tokens, aliases) else {
        return true;
    };
    if let Err(err) = validate_tokens_syntax(&tokens) {
        if err.contains("unexpected end of file") || err.contains("unclosed") {
            return true;
        }
    }
    if tokens
        .iter()
        .any(|t| matches!(t, Token::RedirectHereDoc { eof_warning: Some(_), .. }))
    {
        return true;
    }
    let non_nl: Vec<&Token> = tokens
        .iter()
        .filter(|t| !matches!(t, Token::Newline))
        .collect();
    if matches!(
        non_nl.last(),
        Some(Token::Pipe | Token::AndIf | Token::OrIf)
    ) {
        return true;
    }
    if non_nl.len() >= 3
        && matches!(
            non_nl[non_nl.len() - 3..],
            [Token::Word(_), Token::LParen, Token::RParen]
        )
    {
        return true;
    }
    if non_nl.len() >= 2
        && matches!(non_nl[non_nl.len() - 2..], [Token::Word(k), Token::Word(_)] if k == "function")
    {
        return true;
    }
    let mut pending_do = 0i32;
    let mut in_db = false;
    let mut at_start = true;
    let mut for_state = 0u8;
    for tok in &tokens {
        match tok {
            Token::Newline => {
                if for_state != 2 {
                    for_state = 0;
                    at_start = true;
                }
            }
            Token::Semi
            | Token::Pipe
            | Token::AndIf
            | Token::OrIf
            | Token::Background
            | Token::LParen => {
                for_state = 0;
                at_start = true;
            }
            Token::Word(w) => {
                if w == "[[" && at_start {
                    in_db = true;
                } else if w == "]]" {
                    in_db = false;
                }
                if for_state == 1 {
                    for_state = 2;
                    at_start = false;
                } else if for_state == 2 {
                    if w == "in" {
                        for_state = 3;
                        at_start = false;
                    } else if w == "do" && pending_do > 0 {
                        for_state = 0;
                        pending_do -= 1;
                        at_start = true;
                    } else {
                        for_state = 0;
                        at_start = false;
                    }
                } else if for_state == 3 {
                    at_start = false;
                } else if at_start && matches!(w.as_str(), "for" | "select" | "while" | "until") {
                    pending_do += 1;
                    if matches!(w.as_str(), "for" | "select") {
                        for_state = 1;
                        at_start = false;
                    } else {
                        at_start = true;
                    }
                } else if at_start && w == "do" && pending_do > 0 {
                    pending_do -= 1;
                    at_start = true;
                } else {
                    at_start =
                        at_start && matches!(w.as_str(), "if" | "then" | "elif" | "else" | "{");
                }
            }
            _ => {
                at_start = false;
            }
        }
    }
    pending_do > 0 || in_db
}


fn is_valid_loop_ident(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_stop_word(tok: Option<&Token>, stops: &[&str]) -> bool {
    if let Some(Token::Word(w)) = tok {
        stops.contains(&w.as_str())
    } else {
        false
    }
}

fn token_line(tokens: &[Token], idx: usize) -> usize {
    let mut line = 1usize;
    for tok in tokens.iter().take(idx) {
        match tok {
            Token::Newline => line += 1,
            Token::Word(w) => line += w.bytes().filter(|&b| b == b'\n').count(),
            Token::RedirectHereDoc { body, .. } => {
                line += body.bytes().filter(|&b| b == b'\n').count() + 1;
            }
            _ => {}
        }
    }
    line
}

fn skip_newlines(tokens: &[Token], pos: &mut usize) {
    while matches!(tokens.get(*pos), Some(Token::Newline | Token::Semi)) {
        *pos += 1;
    }
}

fn parse_tokens(tokens: &[Token], pos: &mut usize, stops: &[&str]) -> Result<Script, String> {
    let mut lists = Vec::new();
    loop {
        skip_newlines(tokens, pos);
        if *pos >= tokens.len() || matches!(tokens.get(*pos), Some(Token::RParen)) || is_stop_word(tokens.get(*pos), stops) {
            break;
        }
        let mut list = parse_and_or(tokens, pos, stops)?;
        if matches!(tokens.get(*pos), Some(Token::Background)) {
            list.background = true;
            *pos += 1;
        }
        if !list.first.commands.is_empty() || !list.rest.is_empty() {
            lists.push(list);
        }
        while matches!(tokens.get(*pos), Some(Token::Semi | Token::Newline | Token::Background)) {
            *pos += 1;
        }
    }
    Ok(Script { lists })
}

fn parse_and_or(tokens: &[Token], pos: &mut usize, stops: &[&str]) -> Result<AndOrList, String> {
    let first = parse_pipeline(tokens, pos, stops)?;
    let mut rest = Vec::new();
    while let Some(tok) = tokens.get(*pos) {
        let op = match tok {
            Token::AndIf => ListOp::And,
            Token::OrIf => ListOp::Or,
            _ => break,
        };
        *pos += 1;
        while matches!(tokens.get(*pos), Some(Token::Newline)) {
            *pos += 1;
        }
        let next = parse_pipeline(tokens, pos, stops)?;
        rest.push((op, next));
    }
    Ok(AndOrList { first, rest, background: false })
}

fn parse_pipeline(tokens: &[Token], pos: &mut usize, stops: &[&str]) -> Result<Pipeline, String> {
    let mut negated = false;
    if let Some(Token::Word(w)) = tokens.get(*pos)
        && w == "!"
    {
        negated = true;
        *pos += 1;
    }
    let mut commands = Vec::new();
    if let Some(cmd) = parse_command(tokens, pos, stops)? {
        commands.push(cmd);
    }
    while matches!(tokens.get(*pos), Some(Token::Pipe)) {
        *pos += 1;
        while matches!(tokens.get(*pos), Some(Token::Newline)) {
            *pos += 1;
        }
        if let Some(cmd) = parse_command(tokens, pos, stops)? {
            commands.push(cmd);
        }
    }
    Ok(Pipeline { negated, commands })
}

fn parse_trailing_redirects(tokens: &[Token], pos: &mut usize) -> Result<Vec<Redirect>, String> {
    let mut redirects = Vec::new();
    while let Some(tok) = tokens.get(*pos) {
        let r = match tok {
            Token::RedirectOut(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::Out(f), target }
            }
            Token::RedirectAppend(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::Append(f), target }
            }
            Token::RedirectClobber(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::Clobber(f), target }
            }
            Token::RedirectIn(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::In(f), target }
            }
            Token::RedirectReadWrite(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::ReadWrite(f), target }
            }
            Token::RedirectHereString(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::HereString(f), target }
            }
            Token::RedirectHereDoc {
                fd,
                quoted,
                body,
                eof_warning,
                ..
            } => {
                let f = *fd;
                let q = *quoted;
                let b = body.clone();
                let w = eof_warning.clone();
                *pos += 1;
                Redirect {
                    kind: RedirectKind::HereDoc {
                        fd: f,
                        quoted: q,
                        eof_warning: w,
                    },
                    target: b,
                }
            }
            Token::RedirectDupOut(fd, explicit_fd) => {
                let f = *fd;
                let exp_fd = *explicit_fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                let raw_move = is_raw_move_word(&target);
                Redirect {
                    kind: RedirectKind::DupOut {
                        fd: f,
                        explicit_fd: exp_fd,
                        raw_move,
                    },
                    target,
                }
            }
            Token::RedirectDupIn(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                let raw_move = is_raw_move_word(&target);
                Redirect {
                    kind: RedirectKind::DupIn { fd: f, raw_move },
                    target,
                }
            }
            Token::RedirectBothOut => {
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::BothOut, target }
            }
            Token::RedirectBothAppend => {
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::BothAppend, target }
            }
            _ => break,
        };
        redirects.push(r);
    }
    Ok(redirects)
}

fn is_raw_move_word(raw: &str) -> bool {
    if raw == "-" || !raw.ends_with('-') {
        return false;
    }
    let without_dash = &raw[..raw.len() - 1];
    let backslashes = without_dash
        .bytes()
        .rev()
        .take_while(|&b| b == b'\\')
        .count();
    backslashes % 2 == 0
}

fn expect_word(tokens: &[Token], pos: &mut usize) -> Result<String, String> {
    match tokens.get(*pos) {
        Some(Token::Word(w)) => {
            *pos += 1;
            Ok(w.clone())
        }
        _ => Err("Syntax error: expected word after redirect".to_string()),
    }
}

fn parse_command(tokens: &[Token], pos: &mut usize, stops: &[&str]) -> Result<Option<CommandNode>, String> {
    if *pos >= tokens.len() || is_stop_word(tokens.get(*pos), stops) {
        return Ok(None);
    }

    // Subshell (...) or arithmetic ((...))
    if matches!(tokens.get(*pos), Some(Token::LParen)) {
        if matches!(tokens.get(*pos + 1), Some(Token::LParen))
            && let Some(Token::Word(w)) = tokens.get(*pos + 2)
            && let Some(raw_expr) = w.strip_prefix("\x00__ARITH_EXPR__")
            && matches!(tokens.get(*pos + 3), Some(Token::RParen))
            && matches!(tokens.get(*pos + 4), Some(Token::RParen))
        {
            let expr = raw_expr.to_string();
            *pos += 5;
            let redirects = parse_trailing_redirects(tokens, pos)?;
            return Ok(Some(CommandNode::ArithCommand {
                expr,
                redirects,
            }));
        }
        *pos += 1;
        let body = parse_tokens(tokens, pos, &[])?;
        if !matches!(tokens.get(*pos), Some(Token::RParen)) {
            return Err("Syntax error: expected `)`".to_string());
        }
        *pos += 1;
        let redirects = parse_trailing_redirects(tokens, pos)?;
        return Ok(Some(CommandNode::Subshell { body, redirects }));
    }

    if let Some(Token::Word(kw)) = tokens.get(*pos) {
        match kw.as_str() {
            "{" => {
                *pos += 1;
                let body = parse_tokens(tokens, pos, &["}"])?;
                if !is_stop_word(tokens.get(*pos), &["}"]) {
                    return Err("Syntax error: expected `}`".to_string());
                }
                *pos += 1;
                let redirects = parse_trailing_redirects(tokens, pos)?;
                return Ok(Some(CommandNode::Group { body, redirects }));
            }
            "if" => {
                *pos += 1;
                let mut branches = Vec::new();
                let cond = parse_tokens(tokens, pos, &["then"])?;
                if !is_stop_word(tokens.get(*pos), &["then"]) {
                    return Err("Syntax error: expected `then`".to_string());
                }
                *pos += 1;
                let then_body = parse_tokens(tokens, pos, &["elif", "else", "fi"])?;
                branches.push((cond, then_body));

                while is_stop_word(tokens.get(*pos), &["elif"]) {
                    *pos += 1;
                    let econd = parse_tokens(tokens, pos, &["then"])?;
                    if !is_stop_word(tokens.get(*pos), &["then"]) {
                        return Err("Syntax error: expected `then` after `elif`".to_string());
                    }
                    *pos += 1;
                    let ebody = parse_tokens(tokens, pos, &["elif", "else", "fi"])?;
                    branches.push((econd, ebody));
                }

                let else_branch = if is_stop_word(tokens.get(*pos), &["else"]) {
                    *pos += 1;
                    Some(parse_tokens(tokens, pos, &["fi"])?)
                } else {
                    None
                };

                if !is_stop_word(tokens.get(*pos), &["fi"]) {
                    return Err("Syntax error: expected `fi`".to_string());
                }
                *pos += 1;
                let redirects = parse_trailing_redirects(tokens, pos)?;
                return Ok(Some(CommandNode::If {
                    branches,
                    else_branch,
                    redirects,
                }));
            }
            "for" | "select" => {
                let is_select = kw == "select";
                *pos += 1;
                // C-style `for ((init; cond; step)); do ... done`
                if matches!(tokens.get(*pos), Some(Token::LParen)) && matches!(tokens.get(*pos + 1), Some(Token::LParen)) {
                    *pos += 2;
                    let mut clauses = vec![String::new(), String::new(), String::new()];
                    let mut c_idx = 0usize;
                    while *pos < tokens.len() {
                        if matches!(tokens.get(*pos), Some(Token::RParen)) && matches!(tokens.get(*pos + 1), Some(Token::RParen)) {
                            *pos += 2;
                            break;
                        }
                        match &tokens[*pos] {
                            Token::Semi => {
                                if c_idx < 2 {
                                    c_idx += 1;
                                }
                            }
                            Token::Word(w) => {
                                if !clauses[c_idx].is_empty() {
                                    clauses[c_idx].push(' ');
                                }
                                clauses[c_idx].push_str(w);
                            }
                            _ => {}
                        }
                        *pos += 1;
                    }
                    skip_newlines(tokens, pos);
                    if !is_stop_word(tokens.get(*pos), &["do"]) {
                        return Err("Syntax error: expected `do` in arithmetic for loop".to_string());
                    }
                    *pos += 1;
                    let body = parse_tokens(tokens, pos, &["done"])?;
                    if !is_stop_word(tokens.get(*pos), &["done"]) {
                        return Err("Syntax error: expected `done`".to_string());
                    }
                    *pos += 1;
                    let redirects = parse_trailing_redirects(tokens, pos)?;
                    return Ok(Some(CommandNode::ForArith {
                        init: clauses[0].clone(),
                        cond: clauses[1].clone(),
                        step: clauses[2].clone(),
                        body,
                        redirects,
                    }));
                }

                let loop_kw = kw.clone();
                let var = expect_word(tokens, pos)?;
                if !is_valid_loop_ident(&var) {
                    return Err(format!("Syntax error: Invalid {loop_kw} variable"));
                }
                while matches!(tokens.get(*pos), Some(Token::Newline)) {
                    *pos += 1;
                }
                let mut items = Vec::new();
                let has_in = is_stop_word(tokens.get(*pos), &["in"]);
                if has_in {
                    *pos += 1;
                    while let Some(Token::Word(w)) = tokens.get(*pos) {
                        items.push(w.clone());
                        *pos += 1;
                    }
                }
                if matches!(tokens.get(*pos), Some(Token::Semi | Token::Newline)) {
                    *pos += 1;
                } else if has_in {
                    return Err(format!("Syntax error: Expected {loop_kw} separator"));
                }
                if !has_in {
                    items.push("\"$@\"".to_string());
                }
                skip_newlines(tokens, pos);
                if !is_stop_word(tokens.get(*pos), &["do"]) {
                    return Err(format!("Syntax error: expected `do` in {loop_kw} loop"));
                }
                *pos += 1;
                let body = parse_tokens(tokens, pos, &["done"])?;
                if !is_stop_word(tokens.get(*pos), &["done"]) {
                    return Err("Syntax error: expected `done`".to_string());
                }
                *pos += 1;
                let redirects = parse_trailing_redirects(tokens, pos)?;
                if is_select {
                    return Ok(Some(CommandNode::Select {
                        var,
                        items,
                        body,
                        redirects,
                    }));
                }
                return Ok(Some(CommandNode::ForIn {
                    var,
                    items,
                    body,
                    redirects,
                }));
            }
            "while" | "until" => {
                let until = kw == "until";
                *pos += 1;
                let cond = parse_tokens(tokens, pos, &["do"])?;
                if !is_stop_word(tokens.get(*pos), &["do"]) {
                    return Err("Syntax error: expected `do` in while/until loop".to_string());
                }
                *pos += 1;
                let body = parse_tokens(tokens, pos, &["done"])?;
                if !is_stop_word(tokens.get(*pos), &["done"]) {
                    return Err("Syntax error: expected `done`".to_string());
                }
                *pos += 1;
                let redirects = parse_trailing_redirects(tokens, pos)?;
                return Ok(Some(CommandNode::While {
                    until,
                    cond,
                    body,
                    redirects,
                }));
            }
            "case" => {
                *pos += 1;
                let word = expect_word(tokens, pos)?;
                skip_newlines(tokens, pos);
                if !is_stop_word(tokens.get(*pos), &["in"]) {
                    return Err("Syntax error: expected `in` after `case`".to_string());
                }
                *pos += 1;
                let mut arms = Vec::new();
                loop {
                    skip_newlines(tokens, pos);
                    if is_stop_word(tokens.get(*pos), &["esac"]) || *pos >= tokens.len() {
                        break;
                    }
                    if matches!(tokens.get(*pos), Some(Token::LParen)) {
                        *pos += 1;
                    }
                    let mut patterns = Vec::new();
                    while *pos < tokens.len() {
                        if matches!(tokens.get(*pos), Some(Token::RParen)) {
                            *pos += 1;
                            break;
                        }
                        if let Some(Token::Word(p)) = tokens.get(*pos) {
                            patterns.push(p.clone());
                        }
                        *pos += 1;
                    }
                    let mut arm_tokens: Vec<Token> = (1..token_line(tokens, *pos)).map(|_| Token::Newline).collect();
                    let mut term = CaseTerminator::Break;
                    let mut nested_case_depth = 0usize;
                    let mut arm_at_cmd_start = true;
                    while *pos < tokens.len() {
                        if arm_at_cmd_start && is_stop_word(tokens.get(*pos), &["case"]) {
                            nested_case_depth += 1;
                            arm_at_cmd_start = false;
                        } else if is_stop_word(tokens.get(*pos), &["esac"]) {
                            if nested_case_depth == 0 {
                                break;
                            }
                            nested_case_depth -= 1;
                            arm_at_cmd_start = false;
                        } else {
                            match tokens.get(*pos) {
                                Some(
                                    Token::Newline
                                    | Token::Semi
                                    | Token::Pipe
                                    | Token::AndIf
                                    | Token::OrIf
                                    | Token::Background
                                    | Token::LParen
                                    | Token::RParen,
                                ) => {
                                    arm_at_cmd_start = true;
                                }
                                Some(Token::Word(w))
                                    if arm_at_cmd_start
                                        && matches!(
                                            w.as_str(),
                                            "if" | "then" | "elif" | "else" | "while" | "until" | "do" | "{" | "!"
                                        ) =>
                                {
                                    arm_at_cmd_start = true;
                                }
                                _ => {
                                    arm_at_cmd_start = false;
                                }
                            }
                        }
                        if nested_case_depth == 0 {
                            if matches!(tokens.get(*pos), Some(Token::Semi)) && matches!(tokens.get(*pos + 1), Some(Token::Semi)) {
                                if matches!(tokens.get(*pos + 2), Some(Token::Background)) {
                                    *pos += 3;
                                    term = CaseTerminator::ContinueTesting;
                                } else {
                                    *pos += 2;
                                    term = CaseTerminator::Break;
                                }
                                break;
                            }
                            if matches!(tokens.get(*pos), Some(Token::Semi)) && matches!(tokens.get(*pos + 1), Some(Token::Background)) {
                                *pos += 2;
                                term = CaseTerminator::Fallthrough;
                                break;
                            }
                        }
                        arm_tokens.push(tokens[*pos].clone());
                        *pos += 1;
                    }
                    let mut arm_pos = 0usize;
                    let arm_body = parse_tokens(&arm_tokens, &mut arm_pos, &[])?;
                    arms.push((patterns, arm_body, term));
                }
                if is_stop_word(tokens.get(*pos), &["esac"]) {
                    *pos += 1;
                }
                let redirects = parse_trailing_redirects(tokens, pos)?;
                return Ok(Some(CommandNode::Case {
                    word,
                    arms,
                    redirects,
                }));
            }
            _ => {}
        }
    }

    // Function definition `function name() { ... }` or `name() { ... }`
    let func_header = if is_stop_word(tokens.get(*pos), &["function"]) {
        if let Some(Token::Word(name)) = tokens.get(*pos + 1) {
            let mut next_pos = *pos + 2;
            if matches!(tokens.get(next_pos), Some(Token::LParen))
                && matches!(tokens.get(next_pos + 1), Some(Token::RParen))
            {
                next_pos += 2;
            }
            Some((name.clone(), next_pos))
        } else {
            None
        }
    } else if let Some(Token::Word(name)) = tokens.get(*pos)
        && matches!(tokens.get(*pos + 1), Some(Token::LParen))
        && matches!(tokens.get(*pos + 2), Some(Token::RParen))
    {
        Some((name.clone(), *pos + 3))
    } else {
        None
    };

    if let Some((fn_name, next_pos)) = func_header {
        *pos = next_pos;
        skip_newlines(tokens, pos);
        if is_stop_word(tokens.get(*pos), &["{"]) {
            *pos += 1;
            let mut body = parse_tokens(tokens, pos, &["}"])?;
            if !is_stop_word(tokens.get(*pos), &["}"]) {
                return Err("Syntax error: expected `}` in function definition".to_string());
            }
            *pos += 1;
            let fn_redirects = parse_trailing_redirects(tokens, pos)?;
            if !fn_redirects.is_empty() {
                body = Script {
                    lists: vec![AndOrList {
                        first: Pipeline {
                            negated: false,
                            commands: vec![CommandNode::Group {
                                body,
                                redirects: fn_redirects,
                            }],
                        },
                        rest: Vec::new(),
                        background: false,
                    }],
                };
            }
            return Ok(Some(CommandNode::FuncDef {
                name: fn_name,
                body,
            }));
        } else if matches!(tokens.get(*pos), Some(Token::LParen)) {
            *pos += 1;
            let sub_body = parse_tokens(tokens, pos, &[])?;
            if !matches!(tokens.get(*pos), Some(Token::RParen)) {
                return Err("Syntax error: expected `)` in function definition".to_string());
            }
            *pos += 1;
            let fn_redirects = parse_trailing_redirects(tokens, pos)?;
            let body = Script {
                lists: vec![AndOrList {
                    first: Pipeline {
                        negated: false,
                        commands: vec![CommandNode::Subshell {
                            body: sub_body,
                            redirects: fn_redirects,
                        }],
                    },
                    rest: Vec::new(),
                    background: false,
                }],
            };
            return Ok(Some(CommandNode::FuncDef {
                name: fn_name,
                body,
            }));
        }
    }

    let cmd_line = token_line(tokens, *pos);
    let mut assignments = Vec::new();
    let mut words = Vec::new();
    let mut redirects = Vec::new();

    while *pos < tokens.len() {
        if is_stop_word(tokens.get(*pos), stops) {
            break;
        }
        match tokens.get(*pos) {
            Some(
                Token::Semi
                | Token::Newline
                | Token::Pipe
                | Token::AndIf
                | Token::OrIf
                | Token::Background
                | Token::RParen,
            ) => break,
            Some(
                Token::RedirectOut(_)
                | Token::RedirectAppend(_)
                | Token::RedirectClobber(_)
                | Token::RedirectIn(_)
                | Token::RedirectReadWrite(_)
                | Token::RedirectHereString(_)
                | Token::RedirectHereDoc { .. }
                | Token::RedirectDupOut(_, _)
                | Token::RedirectDupIn(_)
                | Token::RedirectBothOut
                | Token::RedirectBothAppend,
            ) => {
                let mut more = parse_trailing_redirects(tokens, pos)?;
                redirects.append(&mut more);
            }
            Some(Token::Word(w)) => {
                if words.is_empty()
                    && let Some((k, v, append)) = parse_assignment_word(w)
                {
                    assignments.push((k, v, append));
                    *pos += 1;
                } else {
                    words.push(w.clone());
                    *pos += 1;
                }
            }
            Some(Token::LParen) => {
                // Array literal assignment e.g. `arr=(a b c)`
                if words.is_empty() && !assignments.is_empty() {
                    *pos += 1;
                    let mut elems = Vec::new();
                    while *pos < tokens.len() && !matches!(tokens.get(*pos), Some(Token::RParen)) {
                        if let Some(Token::Word(elem)) = tokens.get(*pos) {
                            elems.push(elem.clone());
                        }
                        *pos += 1;
                    }
                    if matches!(tokens.get(*pos), Some(Token::RParen)) {
                        *pos += 1;
                    }
                    if let Some(last) = assignments.last_mut() {
                        last.1 = format!("({})", elems.join(" "));
                    }
                } else {
                    break;
                }
            }
            None => break,
        }
    }

    if assignments.is_empty() && words.is_empty() && redirects.is_empty() {
        return Ok(None);
    }
    if !words.is_empty()
        && assignments
            .iter()
            .any(|(k, v, _)| k.contains('[') || (v.starts_with('(') && v.ends_with(')')))
    {
        return Err(
            "Syntax error: Indexed-array command prefixes are unsupported at offset 0".to_string(),
        );
    }

    Ok(Some(CommandNode::Simple(SimpleCommand {
        assignments,
        words,
        redirects,
        line: cmd_line,
    })))
}

fn parse_assignment_word(word: &str) -> Option<(String, String, bool)> {
    let bytes = word.as_bytes();
    if bytes.is_empty() || !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return None;
    }
    let mut i = 1usize;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'[' {
        i += 1;
        let mut depth = 1usize;
        let mut in_q: Option<u8> = None;
        while i < bytes.len() && depth > 0 {
            let b = bytes[i];
            if let Some(q) = in_q {
                if b == b'\\' && q == b'"' && i + 1 < bytes.len() {
                    i += 2;
                    continue;
                }
                if b == q {
                    in_q = None;
                }
            } else if b == b'\'' || b == b'"' {
                in_q = Some(b);
            } else if b == b'[' {
                depth += 1;
            } else if b == b']' {
                depth -= 1;
            }
            i += 1;
        }
        if depth != 0 {
            return None;
        }
    }
    if i >= bytes.len() {
        return None;
    }
    let lhs = &word[..i];
    if word[i..].starts_with("+=") {
        Some((lhs.to_string(), word[i + 2..].to_string(), true))
    } else if word[i..].starts_with('=') {
        Some((lhs.to_string(), word[i + 1..].to_string(), false))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_validate_syntax_and_parse_compound_constructs() {
        validate_basic_syntax("if [ 1 -eq 1 ]; then echo ok; fi").unwrap();
        assert!(validate_basic_syntax("if [ 1 -eq 1 ]; then echo unclosed").is_err());

        let parsed = parse_script(
            "FOO=bar arr+=(1 2); for x in a b; do echo \"$x\"; done && (exit 0)",
        )
        .unwrap();
        assert!(!parsed.lists.is_empty());
    }

    #[test]
    fn unit_parse_case_while_until_functions_and_pipelines() {
        let script = r#"
            my_fn() {
                case "$1" in
                    a|b) echo "ab" ;;
                    *) echo "other" ;;
                esac
            }
            while false; do echo no; done
            until true; do echo no; done
            ! true | false && my_fn a
        "#;
        validate_basic_syntax(script).unwrap();
        let parsed = parse_script(script).unwrap();
        assert!(parsed.lists.len() >= 4);
    }

    #[test]
    fn unit_parse_subshell_redirects_coproc_select_and_arith_for() {
        let script = r#"
            (echo out; echo err >&2) 2>&1 >/dev/null
            for ((i=0; i<2; i++)); do echo "$i"; done
        "#;
        validate_basic_syntax(script).unwrap();
        let parsed = parse_script(script).unwrap();
        assert_eq!(parsed.lists.len(), 2);
    }

    #[test]
    fn unit_validate_basic_syntax_rejects_unmatched_quotes_and_keywords() {
        assert!(validate_basic_syntax("echo \"unterminated").is_err());
        assert!(validate_basic_syntax("if true; then echo hi").is_err());
    }

    #[test]
    fn unit_parse_script_with_aliases_and_incomplete_units() {
        let mut aliases = BTreeMap::new();
        aliases.insert("WHEN".to_string(), "if".to_string());
        aliases.insert("THEN".to_string(), "then".to_string());
        aliases.insert("END".to_string(), "fi".to_string());
        aliases.insert("pfx".to_string(), "echo ".to_string());
        aliases.insert("word".to_string(), "hello".to_string());

        assert!(is_incomplete_shell_unit("WHEN true; THEN\n", &aliases));
        assert!(!is_incomplete_shell_unit(
            "WHEN true; THEN pfx word; END\n",
            &aliases
        ));
        let parsed =
            parse_script_with_aliases("WHEN true; THEN FOO=1 pfx word; END", &aliases, 0).unwrap();
        assert_eq!(parsed.lists.len(), 1);
    }

    #[test]
    fn unit_parse_case_reserved_word_patterns_and_arith_command_redirects() {
        let script = r#"
            (( x = 42 )) 2>/dev/null >out.txt
            case "$kw" in
                fi) echo case ;;
                done) echo done_arm ;;
                (then|else) ;;
            esac
        "#;
        validate_basic_syntax(script).unwrap();
        let parsed = parse_script(script).unwrap();
        assert_eq!(parsed.lists.len(), 2);
        match &parsed.lists[0].first.commands[0] {
            CommandNode::ArithCommand { expr, redirects } => {
                assert_eq!(expr.trim(), "x = 42");
                assert_eq!(redirects.len(), 2);
            }
            other => panic!("expected ArithCommand, got {other:?}"),
        }
    }
}
