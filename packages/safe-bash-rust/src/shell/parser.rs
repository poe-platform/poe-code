use crate::shell::lexer::{Token, tokenize_shell};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedirectKind {
    Out(u32),
    Append(u32),
    Clobber(u32),
    In(u32),
    HereString(u32),
    HereDoc { fd: u32, quoted: bool },
    DupOut(u32),
    DupIn(u32),
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
    ArithCommand(String),
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
    let mut if_depth = 0i32;
    let mut do_depth = 0i32;
    let mut case_depth = 0i32;
    let mut case_paren_stack: Vec<i32> = Vec::new();
    let mut paren_depth = 0i32;
    let mut brace_depth = 0i32;

    let mut at_cmd_start = true;
    for tok in &tokens {
        match tok {
            Token::Semi | Token::Newline | Token::Pipe | Token::AndIf | Token::OrIf | Token::Background => {
                at_cmd_start = true;
            }
            Token::LParen => {
                paren_depth += 1;
                at_cmd_start = true;
            }
            Token::RParen => {
                if case_depth > 0 && case_paren_stack.last().copied() == Some(paren_depth) {
                    at_cmd_start = true;
                } else {
                    paren_depth -= 1;
                    if paren_depth < 0 {
                        return Err("Syntax error: unexpected `)`".to_string());
                    }
                    if case_depth > 0 && case_paren_stack.last().copied() == Some(paren_depth) {
                        at_cmd_start = true;
                    }
                }
            }
            Token::Word(w) => {
                if at_cmd_start {
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
                            case_paren_stack.push(paren_depth);
                            at_cmd_start = false;
                        }
                        "esac" => {
                            case_depth -= 1;
                            case_paren_stack.pop();
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
                } else if w == "do" && case_depth == 0 {
                    // allow `for x in a b; do` where `;` set at_cmd_start
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

pub fn parse_script(input: &str) -> Result<Script, String> {
    validate_basic_syntax(input)?;
    let tokens = tokenize_shell(input)?;
    let mut pos = 0usize;
    parse_tokens(&tokens, &mut pos, &[])
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
            Token::RedirectHereString(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::HereString(f), target }
            }
            Token::RedirectHereDoc { fd, quoted, body, .. } => {
                let f = *fd;
                let q = *quoted;
                let b = body.clone();
                *pos += 1;
                Redirect { kind: RedirectKind::HereDoc { fd: f, quoted: q }, target: b }
            }
            Token::RedirectDupOut(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::DupOut(f), target }
            }
            Token::RedirectDupIn(fd) => {
                let f = *fd;
                *pos += 1;
                let target = expect_word(tokens, pos)?;
                Redirect { kind: RedirectKind::DupIn(f), target }
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
        if matches!(tokens.get(*pos + 1), Some(Token::LParen)) {
            *pos += 2;
            let mut expr_parts = Vec::new();
            let mut depth = 1i32;
            while *pos < tokens.len() {
                if matches!(tokens.get(*pos), Some(Token::RParen)) && matches!(tokens.get(*pos + 1), Some(Token::RParen)) && depth == 1 {
                    *pos += 2;
                    break;
                }
                match &tokens[*pos] {
                    Token::LParen => {
                        depth += 1;
                        expr_parts.push("(".to_string());
                    }
                    Token::RParen => {
                        depth -= 1;
                        expr_parts.push(")".to_string());
                    }
                    Token::Word(w) => expr_parts.push(w.clone()),
                    Token::Semi => expr_parts.push(";".to_string()),
                    _ => {}
                }
                *pos += 1;
            }
            let _ = parse_trailing_redirects(tokens, pos)?;
            return Ok(Some(CommandNode::ArithCommand(expr_parts.join(" "))));
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

                let var = expect_word(tokens, pos)?;
                let mut items = Vec::new();
                if is_stop_word(tokens.get(*pos), &["in"]) {
                    *pos += 1;
                    while let Some(Token::Word(w)) = tokens.get(*pos) {
                        if w == "do" {
                            break;
                        }
                        items.push(w.clone());
                        *pos += 1;
                    }
                } else {
                    items.push("\"$@\"".to_string());
                }
                skip_newlines(tokens, pos);
                if !is_stop_word(tokens.get(*pos), &["do"]) {
                    return Err("Syntax error: expected `do` in for loop".to_string());
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
                    while *pos < tokens.len() {
                        if is_stop_word(tokens.get(*pos), &["case"]) {
                            nested_case_depth += 1;
                        } else if is_stop_word(tokens.get(*pos), &["esac"]) {
                            if nested_case_depth == 0 {
                                break;
                            }
                            nested_case_depth -= 1;
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
                | Token::RedirectHereString(_)
                | Token::RedirectHereDoc { .. }
                | Token::RedirectDupOut(_)
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
