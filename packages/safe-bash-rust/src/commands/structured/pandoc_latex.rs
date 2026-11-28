use super::{PandocAttr, PandocInline};

pub(super) fn verbatim(input: &str) -> Option<(&str, usize)> {
    let delimiter = input.chars().next()?;
    if delimiter.is_whitespace() || delimiter.is_ascii_alphabetic() {
        return None;
    }
    let start = delimiter.len_utf8();
    let close = start + input[start..].find(delimiter)?;
    let code = &input[start..close];
    if code.contains(['\n', '\r']) {
        return None;
    }
    Some((code, close + delimiter.len_utf8()))
}

pub(super) fn inlines(
    input: &str,
    grouped: bool,
    depth: usize,
) -> Option<(Vec<PandocInline>, usize)> {
    if depth > 64 {
        return None;
    }
    let mut nodes = Vec::new();
    let mut text = String::new();
    let mut pos = 0;
    while pos < input.len() {
        let ch = input[pos..].chars().next()?;
        if ch == '}' && grouped {
            if !text.is_empty() {
                nodes.push(PandocInline::Text(text));
            }
            return Some((nodes, pos + 1));
        }
        if ch.is_whitespace() {
            if !text.is_empty() {
                nodes.push(PandocInline::Text(std::mem::take(&mut text)));
            }
            if !matches!(
                nodes.last(),
                Some(PandocInline::Space | PandocInline::SoftBreak)
            ) {
                nodes.push(if ch == '\n' {
                    PandocInline::SoftBreak
                } else {
                    PandocInline::Space
                });
            }
            pos += ch.len_utf8();
            continue;
        }
        if ch == '\\' {
            let command_start = pos + 1;
            let end = input[command_start..]
                .find(|ch: char| !ch.is_ascii_alphabetic())
                .map_or(input.len(), |end| command_start + end);
            let command = &input[command_start..end];
            let accent = match (command, input[end..].chars().next()) {
                ("", Some('\'')) => Some((
                    end + 1,
                    "AaCcEeGgIiKkLlMmNnOoPpRrSsUuWwYyZz",
                    "ÁáĆćÉéǴǵÍíḰḱĹĺḾḿŃńÓóṔṕŔŕŚśÚúẂẃÝýŹź",
                    '\u{301}',
                )),
                ("c", _) => Some((
                    end,
                    "CcDdEeGgHhKkLlNnRrSsTt",
                    "ÇçḐḑȨȩĢģḨḩĶķĻļŅņŖŗŞşŢţ",
                    '\u{327}',
                )),
                _ => None,
            };
            if let Some((start, bases, composed, mark)) = accent {
                let rest = input[start..].trim_start();
                let grouped = rest.starts_with('{');
                let argument = if grouped { &rest[1..] } else { rest };
                if let Some(base) = argument.chars().next()
                    && !matches!(base, '\\' | '{' | '}')
                    && (!grouped || argument[base.len_utf8()..].starts_with('}'))
                {
                    if let Some((_, accented)) = bases
                        .chars()
                        .zip(composed.chars())
                        .find(|&(c, _)| c == base)
                    {
                        text.push(accented);
                    } else {
                        text.push(base);
                        text.push(mark);
                    }
                    pos = input.len() - argument.len() + base.len_utf8() + usize::from(grouped);
                    continue;
                }
            }
            let (node, consumed) = if command == "verb" {
                let (code, consumed) = verbatim(&input[end..])?;
                (
                    PandocInline::Code(PandocAttr::default(), code.into()),
                    end + consumed,
                )
            } else if matches!(command, "textbf" | "emph" | "texttt")
                && input[end..].starts_with('{')
            {
                let (children, consumed) = inlines(&input[end + 1..], true, depth + 1)?;
                let node = match command {
                    "textbf" => PandocInline::Strong(children),
                    "emph" => PandocInline::Emph(children),
                    _ => PandocInline::Code(
                        PandocAttr::default(),
                        input[end + 1..end + consumed].into(),
                    ),
                };
                (node, end + 1 + consumed)
            } else {
                // Consume control symbols together so an escaped slash cannot start a command.
                let end = if end == command_start {
                    end + input[end..].chars().next().map_or(0, char::len_utf8)
                } else {
                    end
                };
                text.push_str(
                    &input[if command.is_empty() {
                        command_start
                    } else {
                        pos
                    }..end],
                );
                pos = end;
                continue;
            };
            if !text.is_empty() {
                nodes.push(PandocInline::Text(std::mem::take(&mut text)));
            }
            nodes.push(node);
            pos = consumed;
            continue;
        }
        if ch == '{' {
            if !text.is_empty() {
                nodes.push(PandocInline::Text(std::mem::take(&mut text)));
            }
            let (children, consumed) = inlines(&input[pos + 1..], true, depth + 1)?;
            nodes.extend(children);
            pos += 1 + consumed;
            continue;
        }
        text.push(ch);
        pos += ch.len_utf8();
    }
    if grouped {
        return None;
    }
    if !text.is_empty() {
        nodes.push(PandocInline::Text(text));
    }
    Some((nodes, pos))
}
