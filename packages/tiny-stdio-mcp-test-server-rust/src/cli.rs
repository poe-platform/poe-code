//! The fixture CLI grammar; no command framework or operating-system dependency.
use crate::{Tool, object, text};
use mcp_protocol_rust::json::Value;

fn equals(units: &[u16], value: &str) -> bool {
    value.encode_utf16().eq(units.iter().copied())
}
fn join(parts: &[&[u16]]) -> Vec<u16> {
    parts.iter().flat_map(|part| part.iter().copied()).collect()
}
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn response(code: u8, stdout: Vec<u16>, stderr: Vec<u16>) -> Value {
    object(&[
        ("exitCode", Value::Number(f64::from(code))),
        ("stdout", Value::String(stdout)),
        ("stderr", Value::String(stderr)),
    ])
}
pub fn help(command: &[u16], serve: bool) -> Vec<u16> {
    let suffix = if serve {
        " serve [options] <tool>\n\nStart an MCP server on stdin/stdout\n\nArguments:\n  tool        Tool to serve (encrypt, word-of-the-day)\n\nOptions:\n  -h, --help  display help for command\n"
    } else {
        " [options] [command]\n\nTest MCP server with example tools for integration testing\n\nOptions:\n  -V, --version   output the version number\n  -h, --help      display help for command\n\nCommands:\n  serve <tool>    Start an MCP server on stdin/stdout\n  help [command]  display help for command\n"
    };
    join(&[&units("Usage: "), command, &units(suffix)])
}
fn distance(word: &[u16], candidate: &[u16]) -> usize {
    if word.len().abs_diff(candidate.len()) > 3 {
        return word.len().max(candidate.len());
    }
    let mut previous: Vec<_> = (0..=candidate.len()).collect();
    let mut before_previous = previous.clone();
    for (index, unit) in word.iter().enumerate() {
        let mut next = vec![index + 1; candidate.len() + 1];
        for (column, other) in candidate.iter().enumerate() {
            next[column + 1] = (previous[column + 1] + 1)
                .min(next[column] + 1)
                .min(previous[column] + usize::from(unit != other));
            if index > 0
                && column > 0
                && *unit == candidate[column - 1]
                && word[index - 1] == *other
            {
                next[column + 1] = next[column + 1].min(before_previous[column - 1] + 1);
            }
        }
        before_previous = previous;
        previous = next;
    }
    previous[candidate.len()]
}
fn suggestion(word: &[u16], candidates: &[&str]) -> Vec<u16> {
    let option = word.starts_with(&[45, 45]);
    let word = if option { &word[2..] } else { word };
    let mut best = 3;
    let mut similar = vec![];
    for candidate in candidates {
        let compared = if option {
            candidate.trim_start_matches("--")
        } else {
            candidate
        };
        let compared = units(compared);
        let edits = distance(word, &compared);
        let length = word.len().max(compared.len());
        if (length.saturating_sub(edits)) as f64 / length as f64 <= 0.4 {
            continue;
        }
        if edits < best {
            best = edits;
            similar.clear();
        }
        if edits == best {
            similar.push(*candidate);
        }
    }
    similar.sort_unstable();
    match similar.len() {
        0 => vec![],
        1 => units(&format!("\n(Did you mean {}?)", similar[0])),
        _ => units(&format!("\n(Did you mean one of {}?)", similar.join(", "))),
    }
}
pub fn plan(args: &[Vec<u16>], command: &[u16], version: &[u16]) -> Value {
    let mut positional = vec![];
    let mut unknown = None;
    let mut parsing = true;
    let mut version_requested = false;
    let mut help_requested = None;
    for arg in args {
        if parsing && equals(arg, "--") {
            parsing = false;
            continue;
        }
        if parsing && (equals(arg, "--version") || arg.starts_with(&[45, 86])) {
            version_requested = true;
            continue;
        }
        if parsing && (equals(arg, "--help") || equals(arg, "-h")) {
            if help_requested.is_none() {
                help_requested = Some((
                    positional
                        .first()
                        .is_some_and(|value: &&Vec<u16>| equals(value, "serve")),
                    positional.is_empty(),
                ));
            }
            continue;
        }
        if parsing && arg.starts_with(&[45]) && arg.len() > 1 {
            if unknown.is_none() {
                unknown = Some((arg, positional.len()));
            }
            continue;
        }
        if unknown.is_some()
            && positional
                .first()
                .is_some_and(|value| equals(value, "help"))
        {
            continue;
        }
        positional.push(arg);
    }
    if version_requested {
        return response(0, join(&[version, &[10]]), vec![]);
    }
    let implicit_help = positional
        .first()
        .is_some_and(|value| equals(value, "help"))
        && unknown.as_ref().is_none_or(|(_, position)| *position > 0);
    if let Some((serve, before_command)) = help_requested
        && (before_command || !implicit_help)
    {
        return response(0, help(command, serve), vec![]);
    }
    if implicit_help {
        return match positional.get(1) {
            None => response(0, help(command, false), vec![]),
            Some(value) if equals(value, "serve") => response(0, help(command, true), vec![]),
            _ => response(1, vec![], help(command, false)),
        };
    }
    if let Some((option, _)) = unknown {
        let suggestions = suggestion(option, &["--help", "--version"]);
        return response(
            1,
            vec![],
            join(&[
                &units("error: unknown option '"),
                option,
                &units("'"),
                &suggestions,
                &[10],
            ]),
        );
    }
    let Some(first) = positional.first() else {
        return response(1, vec![], help(command, false));
    };
    if !equals(first, "serve") {
        return response(
            1,
            vec![],
            join(&[
                &units("error: unknown command '"),
                first,
                &units("'"),
                &suggestion(first, &["serve", "help"]),
                &[10],
            ]),
        );
    }
    let Some(tool) = positional.get(1) else {
        return response(
            1,
            vec![],
            units("error: missing required argument 'tool'\n"),
        );
    };
    if positional.len() > 2 {
        return response(
            1,
            vec![],
            units(&format!(
                "error: too many arguments for 'serve'. Expected 1 argument but got {}.\n",
                positional.len() - 1
            )),
        );
    }
    if let Some(tool) = Tool::from_name(tool) {
        return object(&[("tool", text(tool.serve_name()))]);
    }
    response(
        1,
        vec![],
        join(&[
            &units("Unknown tool: "),
            tool,
            &units(". Available: encrypt, word-of-the-day\n"),
        ]),
    )
}
