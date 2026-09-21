//! Presentation-only shell scanning. Never executes commands or expands host variables.
type Text = Vec<u16>;
pub const VERBS: [(&str, &str); 9] = [
    ("read", "Read"),
    ("edit", "Edit"),
    ("write", "Write"),
    ("delete", "Delete"),
    ("move", "Move"),
    ("search", "Search"),
    ("fetch", "Fetch"),
    ("think", "Think"),
    ("switch_mode", "Switch mode"),
];
fn u(s: &str) -> Text {
    s.encode_utf16().collect()
}
fn eq(value: &[u16], s: &str) -> bool {
    value.iter().copied().eq(s.encode_utf16())
}
fn starts(value: &[u16], s: &str) -> bool {
    value.len() >= s.len() && value.iter().take(s.len()).copied().eq(s.encode_utf16())
}
fn join(values: &[Text], separator: &str) -> Text {
    let sep = u(separator);
    let mut out = vec![];
    for (i, v) in values.iter().enumerate() {
        if i > 0 {
            out.extend(&sep);
        }
        out.extend(v);
    }
    out
}
fn prefix(s: &str, value: &[u16]) -> Text {
    [u(s), value.to_vec()].concat()
}
fn base(value: &[u16]) -> &[u16] {
    value.rsplit(|c| *c == 47).next().unwrap_or(&[])
}
fn member(value: &[u16], values: &[&str]) -> bool {
    values.iter().any(|s| eq(value, s))
}
#[derive(Clone, Debug)]
enum Token {
    Word(Text),
    Op(&'static str),
    Other,
}
fn word(token: Option<&Token>) -> Option<&[u16]> {
    if let Some(Token::Word(v)) = token {
        Some(v)
    } else {
        None
    }
}
fn control(value: &[u16]) -> Option<(&'static str, usize)> {
    [
        "||", "&&", ";;", "|&", "<(", "<<<", ">>", ">&", "<&", "&", ";", "(", ")", "|", "<", ">",
    ]
    .into_iter()
    .find_map(|s| starts(value, s).then_some((s, s.len())))
}
fn whitespace(c: u16) -> bool {
    mcp_protocol_rust::strings::trim_ecmascript(&[c]).is_empty()
}
fn variable(source: &[u16], i: &mut usize) -> Result<Text, ()> {
    *i += 1;
    let start = *i;
    if source.get(*i) == Some(&123) {
        *i += 1;
        let begin = *i;
        if source.get(*i) == Some(&125) {
            return Err(());
        }
        let mut depth = 1;
        while *i < source.len() {
            if source[*i] == 123 && *i > 0 && source[*i - 1] == 36 {
                depth += 1;
            }
            if source[*i] == 125 {
                depth -= 1;
                if depth == 0 {
                    let result = prefix("$", &source[begin..*i]);
                    *i += 1;
                    return Ok(result);
                }
            }
            *i += 1;
        }
        return Err(());
    }
    if source
        .get(*i)
        .is_some_and(|c| [42, 64, 35, 63, 36, 33, 95, 45].contains(c))
    {
        let result = prefix("$", &source[*i..*i + 1]);
        *i = (*i + 2).min(source.len());
        return Ok(result);
    }
    while source.get(*i).is_some_and(|c| {
        (48..=57).contains(c) || (65..=90).contains(c) || (97..=122).contains(c) || *c == 95
    }) {
        *i += 1;
    }
    Ok(prefix("$", &source[start..*i]))
}
fn token_end(source: &[u16], mut i: usize) -> usize {
    while i < source.len() {
        let c = source[i];
        if whitespace(c) || control(&source[i..]).is_some() {
            break;
        }
        if c == 92 && i + 1 < source.len() {
            i += 2;
            continue;
        }
        if c == 34 || c == 39 {
            let start = i;
            i += 1;
            while i < source.len() && source[i] != c {
                if c == 34 && source[i] == 92 && source.get(i + 1) == Some(&34) {
                    i += 1;
                }
                i += 1;
            }
            if i == source.len() {
                return start;
            }
        }
        i += 1;
    }
    i
}
fn parse(source: &[u16]) -> Result<Vec<Token>, ()> {
    let mut out = vec![];
    let mut i = 0;
    while i < source.len() {
        if whitespace(source[i]) {
            i += 1;
            continue;
        }
        if let Some((op, n)) = control(&source[i..]) {
            out.push(Token::Op(op));
            i += n;
            continue;
        }
        if (source[i] == 34 || source[i] == 39) && !source[i + 1..].contains(&source[i]) {
            i += 1;
            continue;
        }
        let end = token_end(source, i);
        let mut value = vec![];
        let mut quote = None;
        let mut glob = false;
        let mut started = false;
        while i < end {
            let c = source[i];
            if quote.is_none() && (whitespace(c) || control(&source[i..]).is_some()) {
                break;
            }
            started = true;
            if quote.is_none() && (c == 42 || c == 63) {
                glob = true;
            }
            if quote == Some(c) {
                quote = None;
                i += 1;
            } else if quote == Some(39) {
                value.push(c);
                i += 1;
            } else if c == 92 {
                i += 1;
                if let Some(next) = source.get(i).filter(|_| i < end) {
                    if quote == Some(34) && ![34, 92, 36].contains(next) {
                        value.push(92);
                    }
                    if quote.is_none() && (*next == 42 || *next == 63) {
                        glob = true;
                    }
                    value.push(*next);
                    i += 1;
                }
            } else if c == 36 {
                value.extend(variable(&source[..end], &mut i)?);
            } else if quote.is_none() && (c == 34 || c == 39) {
                quote = Some(c);
                i += 1;
            } else if quote.is_none() && c == 35 {
                if !value.is_empty() {
                    out.push(Token::Word(value));
                }
                out.push(Token::Other);
                return Ok(out);
            } else {
                value.push(c);
                i += 1;
            }
        }
        if started {
            out.push(if glob {
                Token::Other
            } else {
                Token::Word(value)
            });
        } else if end == i {
            i += 1;
        }
    }
    Ok(out)
}
pub fn command(source: &[u16]) -> Text {
    if source.len() > 8192 {
        return u("Run shell script");
    }
    let Ok(mut tokens) = parse(source) else {
        return prefix("Run ", source);
    };
    let mut command = source.to_vec();
    for _ in 0..3 {
        let program = base(word(tokens.first()).unwrap_or(&[]));
        if !member(program, &["sh", "bash", "zsh", "dash", "ksh"]) {
            break;
        }
        let flag = tokens
            .iter()
            .position(|v| word(Some(v)).is_some_and(|w| w.first() == Some(&45) && w.contains(&99)));
        let Some(next) = flag.and_then(|i| word(tokens.get(i + 1))) else {
            break;
        };
        command = next.to_vec();
        let Ok(parsed) = parse(&command) else {
            return prefix("Run ", source);
        };
        tokens = parsed;
    }
    let program = word(tokens.first())
        .map(base)
        .unwrap_or(&[99, 111, 109, 109, 97, 110, 100]);
    if command.contains(&10) {
        return [u("Run "), program.to_vec(), u(" script")].concat();
    }
    let mut directory = None;
    if word(tokens.first()).is_some_and(|v| eq(v, "cd")) {
        let target_index = if word(tokens.get(1)).is_some_and(|v| eq(v, "--")) {
            2
        } else {
            1
        };
        let target = word(tokens.get(target_index));
        if target.is_some_and(|v| {
            !v.is_empty() && !eq(v, "-") && (target_index == 2 || v.first() != Some(&45))
        }) && matches!(tokens.get(target_index + 1), Some(Token::Op("&&")))
            && tokens.len() > target_index + 2
        {
            directory = target.map(<[u16]>::to_vec);
            tokens = tokens[target_index + 2..].to_vec();
        }
    }
    let location = directory.as_ref().map_or(vec![], |v| prefix(" · ", v));
    let mut groups: Vec<Vec<Vec<Text>>> = vec![vec![vec![]]];
    for (index, token) in tokens.iter().enumerate() {
        match token {
            Token::Word(v) => groups
                .last_mut()
                .unwrap()
                .last_mut()
                .unwrap()
                .push(v.clone()),
            Token::Op("|") => groups.last_mut().unwrap().push(vec![]),
            Token::Op(";" | "&&" | "||") => groups.push(vec![vec![]]),
            Token::Op(">" | ">>" | ">&") if groups.len() == 1 && groups[0].len() == 1 => {
                let action = words(&groups[0][0]);
                let redirects = tokens[index + 1..]
                    .iter()
                    .all(|t| matches!(t, Token::Word(_) | Token::Op(">" | ">>" | ">&")));
                return if directory.is_none() && redirects && starts(&action, "Run ") {
                    action
                } else {
                    prefix("Run ", &command)
                };
            }
            _ => return prefix("Run ", &command),
        }
    }
    let actions = groups
        .into_iter()
        .filter(|p| !p[0].is_empty())
        .map(|p| {
            let action = words(&p[0]);
            if p.len() == 1 {
                return action;
            }
            let previews = p[1..].iter().all(|w| {
                let program = base(w.first().map_or(&[], Vec::as_slice));
                if member(program, &["head", "tail"]) {
                    return starts(&words(w), "Run ");
                }
                eq(program, "sort")
                    && w[1..].iter().all(|v| {
                        v.first() == Some(&45)
                            && !starts(v, "--output")
                            && (starts(v, "--") || !v[1..].contains(&111))
                    })
            });
            if previews
                && ["Read ", "Search ", "List files"]
                    .iter()
                    .any(|s| starts(&action, s))
            {
                action
            } else {
                prefix("Run ", &command)
            }
        })
        .collect::<Vec<_>>();
    if actions.len() > 1 && actions.iter().all(|a| starts(a, "Read ")) {
        let targets = actions.iter().map(|a| a[5..].to_vec()).collect::<Vec<_>>();
        return [u("Read "), join(&targets, ", "), location].concat();
    }
    if actions.len() == 1 {
        return if starts(&actions[0], "Run ") {
            prefix("Run ", &command)
        } else {
            [actions[0].clone(), location].concat()
        };
    }
    if actions.len() > 1 {
        prefix("Run ", &command)
    } else {
        u("Run command")
    }
}
fn words(values: &[Text]) -> Text {
    let program = base(values.first().map_or(&[], Vec::as_slice));
    if eq(program, "git") && values.get(1).is_some_and(|v| eq(v, "grep")) {
        return words(&[vec![u("grep")], values[2..].to_vec()].concat());
    }
    if eq(program, "git") && values.get(1).is_some_and(|v| eq(v, "ls-files")) {
        return words(&[vec![u("rg"), u("--files")], values[2..].to_vec()].concat());
    }
    if eq(program, "sed") {
        return sed(values).unwrap_or_else(|| prefix("Run ", &join(values, " ")));
    }
    if member(program, &["cat", "head", "tail"]) {
        let mut args = vec![];
        let mut options = true;
        let mut i = 1;
        while i < values.len() {
            let v = &values[i];
            i += 1;
            if options && eq(v, "--") {
                options = false;
                continue;
            }
            if options && member(v, &["-n", "-c", "--lines", "--bytes"]) {
                i += 1;
                continue;
            }
            if options && v.first() == Some(&45) {
                continue;
            }
            args.push(v.clone());
        }
        if !args.is_empty() {
            return prefix("Read ", &join(&args, ", "));
        }
    }
    if member(program, &["rg", "grep"]) {
        return search(values).unwrap_or_else(|| prefix("Run ", &join(values, " ")));
    }
    if eq(program, "ls") {
        let args = values[1..]
            .iter()
            .filter(|v| v.first() != Some(&45))
            .cloned()
            .collect::<Vec<_>>();
        return if args.is_empty() {
            u("List files")
        } else {
            prefix("List files in ", &join(&args, ", "))
        };
    }
    prefix("Run ", &join(values, " "))
}
fn search(values: &[Text]) -> Option<Text> {
    let mut operands = vec![];
    let mut queries = vec![];
    let mut files = vec![];
    let grep = eq(base(&values[0]), "grep");
    let arguments = if grep { "efABCmDd" } else { "efgtTABCmMjErd" };
    let mut options = true;
    let mut list = false;
    let mut i = 1;
    while i < values.len() {
        let v = &values[i];
        i += 1;
        if options && eq(v, "--") {
            options = false;
            continue;
        }
        if !options || v.first() != Some(&45) || eq(v, "-") {
            operands.push(v.clone());
            continue;
        }
        if eq(v, "--files") {
            list = true;
            continue;
        }
        if starts(v, "--") {
            let equals = v.iter().position(|c| *c == 61);
            let name = &v[..equals.unwrap_or(v.len())];
            if grep && eq(name, "--color") {
                continue;
            }
            if member(
                name,
                &[
                    "--regexp",
                    "--file",
                    "--glob",
                    "--iglob",
                    "--type",
                    "--type-not",
                    "--after-context",
                    "--before-context",
                    "--context",
                    "--max-count",
                    "--max-depth",
                    "--max-columns",
                    "--threads",
                    "--encoding",
                    "--include",
                    "--exclude",
                    "--exclude-dir",
                    "--exclude-from",
                    "--ignore-file",
                    "--type-add",
                    "--type-clear",
                    "--replace",
                    "--pre",
                    "--pre-glob",
                    "--sort",
                    "--sortr",
                    "--color",
                    "--colors",
                    "--engine",
                    "--label",
                    "--devices",
                    "--directories",
                    "--binary-files",
                ],
            ) {
                let value = if let Some(j) = equals {
                    v[j + 1..].to_vec()
                } else {
                    let value = values.get(i)?.clone();
                    i += 1;
                    value
                };
                if eq(name, "--regexp") {
                    queries.push(value);
                } else if eq(name, "--file") {
                    files.push(value);
                }
            }
            continue;
        }
        for flag in 1..v.len() {
            let ch = v[flag];
            if !arguments.encode_utf16().any(|a| a == ch) {
                continue;
            }
            let value = if flag + 1 < v.len() {
                v[flag + 1..].to_vec()
            } else {
                let value = values.get(i)?.clone();
                i += 1;
                value
            };
            if ch == 101 {
                queries.push(value);
            } else if ch == 102 {
                files.push(value);
            }
            break;
        }
    }
    let scope = |v: &[Text]| {
        if v.is_empty() {
            vec![]
        } else {
            prefix(" in ", &join(v, ", "))
        }
    };
    if list {
        return Some([u("List files"), scope(&operands)].concat());
    }
    if queries.is_empty() && files.is_empty() {
        if operands.is_empty() {
            return None;
        }
        queries.push(operands.remove(0));
    }
    if queries.iter().any(Vec::is_empty) {
        return None;
    }
    let query = join(&queries, ", ");
    let patterns = if files.is_empty() {
        vec![]
    } else {
        [
            u(if query.is_empty() {
                "using "
            } else {
                ", patterns from "
            }),
            join(&files, ", "),
        ]
        .concat()
    };
    Some([u("Search "), query, patterns, scope(&operands)].concat())
}
fn sed(values: &[Text]) -> Option<Text> {
    let mut operands = vec![];
    let mut scripts = vec![];
    let mut options = true;
    let mut edit = false;
    let mut file = false;
    let mut i = 1;
    while i < values.len() {
        let v = &values[i];
        i += 1;
        if !options || v.first() != Some(&45) {
            operands.push(v.clone());
            continue;
        }
        if eq(v, "--") {
            options = false;
            continue;
        }
        if member(
            v,
            &[
                "--quiet",
                "--silent",
                "--regexp-extended",
                "--unbuffered",
                "--separate",
                "--posix",
            ],
        ) {
            continue;
        }
        if eq(v, "--in-place") || starts(v, "--in-place=") {
            edit = true;
            continue;
        }
        if eq(v, "--expression") || starts(v, "--expression=") {
            scripts.push(if eq(v, "--expression") {
                let value = values.get(i).cloned().unwrap_or_default();
                i += 1;
                value
            } else {
                v[13..].to_vec()
            });
            continue;
        }
        if eq(v, "--file") || starts(v, "--file=") {
            file = true;
            if eq(v, "--file") {
                i += 1;
            }
            continue;
        }
        if starts(v, "--") {
            return None;
        }
        for flag in 1..v.len() {
            let ch = v[flag];
            if "nErsu".encode_utf16().any(|c| c == ch) {
                continue;
            }
            if ch == 105 {
                edit = true;
                if flag == v.len() - 1 && values.get(i).is_some_and(Vec::is_empty) {
                    i += 1;
                }
                break;
            }
            if ch == 101 || ch == 102 {
                let value = if flag + 1 < v.len() {
                    v[flag + 1..].to_vec()
                } else {
                    let value = values.get(i).cloned().unwrap_or_default();
                    i += 1;
                    value
                };
                if ch == 101 {
                    scripts.push(value);
                } else {
                    file = true;
                }
                break;
            }
            return None;
        }
    }
    if scripts.is_empty() && !file {
        scripts.push(if operands.is_empty() {
            vec![]
        } else {
            operands.remove(0)
        });
    }
    if operands.is_empty() {
        return None;
    }
    if edit {
        return Some(prefix("Edit ", &join(&operands, ", ")));
    }
    if file
        || !scripts.iter().all(|v| {
            let expression = mcp_protocol_rust::strings::trim_ecmascript(v);
            if expression.last() != Some(&112) {
                return false;
            }
            let range = &expression[..expression.len() - 1];
            if range.is_empty() {
                return true;
            }
            let addresses = range.split(|c| *c == 44).collect::<Vec<_>>();
            addresses.len() <= 2
                && addresses.iter().all(|a| {
                    eq(a, "$") || (!a.is_empty() && a.iter().all(|c| (48..=57).contains(c)))
                })
        })
    {
        return None;
    }
    Some(prefix("Read ", &join(&operands, ", ")))
}
pub fn tool_name(title: &[u16]) -> Text {
    let parts = if starts(title, "mcp__") {
        split(&title[5..], &u("__"))
    } else {
        title.split(|c| *c == 46).map(<[u16]>::to_vec).collect()
    };
    if parts.len() < 2
        || parts.iter().any(|part| {
            part.is_empty()
                || part.iter().any(|c| {
                    !(48..=57).contains(c)
                        && !(65..=90).contains(c)
                        && !(97..=122).contains(c)
                        && *c != 95
                        && *c != 45
                })
        })
    {
        return prefix("Use ", title);
    }
    let name = parts.last().unwrap();
    let mut label = vec![];
    for (i, c) in name.iter().enumerate() {
        if *c == 95 || *c == 45 {
            label.push(32);
        } else {
            if i > 0 && (65..=90).contains(c) && (97..=122).contains(&name[i - 1]) {
                label.push(32);
            }
            label.push(if (65..=90).contains(c) { *c + 32 } else { *c });
        }
    }
    if let Some(c) = label.first_mut().filter(|c| (97..=122).contains(&**c)) {
        *c -= 32;
    }
    [label, u(" · "), join(&parts[..parts.len() - 1], ".")].concat()
}
fn split(value: &[u16], needle: &[u16]) -> Vec<Text> {
    let mut result = vec![];
    let mut start = 0;
    let mut i = 0;
    while i + needle.len() <= value.len() {
        if value[i..].starts_with(needle) {
            result.push(value[start..i].to_vec());
            i += needle.len();
            start = i;
        } else {
            i += 1;
        }
    }
    result.push(value[start..].to_vec());
    result
}
pub fn action(
    kind: &str,
    title: &[u16],
    detail: &[u16],
    target: &[u16],
    query: Option<&[u16]>,
    location: Option<&[u16]>,
    inherited_verb: Option<&[u16]>,
) -> Text {
    if kind == "exec" || kind == "execute" {
        return command(detail);
    }
    let Some(verb) = VERBS
        .iter()
        .find_map(|(name, verb)| (*name == kind).then_some(*verb))
    else {
        return inherited_verb.map_or_else(
            || tool_name(title),
            |verb| [verb.to_vec(), u(" "), target.to_vec()].concat(),
        );
    };
    let value = if kind == "search" {
        query.unwrap_or(target)
    } else {
        target
    };
    let mut label = [u(verb), u(" "), value.to_vec()].concat();
    if kind == "search"
        && query.is_some()
        && let Some(location) = location
    {
        label.extend(prefix(" in ", location));
    }
    label
}
