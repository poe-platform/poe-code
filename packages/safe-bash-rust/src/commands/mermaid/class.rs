use super::{
    Graph, Group, Node, Shape, Statement,
    card::Member,
    scanner::{check_label, outside, strip_quotes},
};
use std::collections::BTreeMap;

fn member(
    raw: &str,
    node: &mut Node,
    stmt: &Statement,
    remaining: &mut usize,
) -> Result<(), String> {
    let text = raw.trim_ascii();
    let check = |s: &str| check_label(s, stmt, &stmt.text);
    if let Some(s) = text.strip_prefix("<<").and_then(|s| s.strip_suffix(">>"))
        && text.len() > 4
    {
        let s = s.trim_ascii();
        check(s)?;
        if !s.is_empty() {
            node.stereotype = format!("«{s}»");
        }
        return Ok(());
    }
    let (visibility, rest) = if text.starts_with(['+', '-', '#', '~']) {
        (&text[..1], text[1..].trim_ascii())
    } else {
        ("", text)
    };
    let joined;
    let (method, name, kind) = if let Some((open, close)) = rest.find('(').zip(rest.rfind(')'))
        && close > open
    {
        let tail = rest[close + 1..].trim_ascii();
        (
            true,
            rest[..=close].trim_ascii(),
            tail.strip_prefix(':').unwrap_or(tail).trim_ascii(),
        )
    } else if let Some((name, kind)) = rest.split_once(':')
        && !name.is_empty()
    {
        (false, name.trim_ascii(), kind.trim_ascii())
    } else {
        let mut words = rest
            .split(' ')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        let name = words.pop().unwrap_or("");
        joined = words.join(" ");
        (false, name, joined.as_str())
    };
    for s in [name, kind] {
        check_label(s, stmt, &stmt.text)?;
    }
    *remaining = remaining
        .checked_sub(2)
        .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
    (if method {
        &mut node.methods
    } else {
        &mut node.attributes
    })
    .push(Member {
        name: format!("{visibility}{name}"),
        kind: kind.into(),
        badge: None,
    });
    Ok(())
}

pub(super) fn parse(
    lines: &[Statement],
    wrapping: f64,
    limit: usize,
) -> Result<Option<Graph<'static>>, String> {
    let mut graph = Graph::core(wrapping, limit);
    graph.dir = "TD";
    graph.edge_id = |i| format!("class_edge_{}", i + 1);
    let mut ids = BTreeMap::<String, (usize, &Statement)>::new();
    let mut groups = BTreeMap::<String, usize>::new();
    let mut namespace = None::<(usize, &Statement)>;
    let mut active = None::<(usize, &Statement)>;
    for stmt in &lines[1..] {
        let text = stmt.text.trim_end();
        let syntax = |msg: &str| stmt.error("E_SYNTAX", text, msg);
        if text == "}" {
            if active.take().is_none() && namespace.take().is_none() {
                return Err(syntax("Unexpected '}' in classDiagram"));
            }
            continue;
        }
        if let Some((i, _)) = active {
            member(text, &mut graph.nodes[i], stmt, &mut graph.remaining_lines)?;
            continue;
        }
        let word = text.split_ascii_whitespace().next().unwrap_or("");
        let body = text[word.len()..].trim_ascii();
        let mut ensure = |raw: &str| -> Result<(usize, &Statement), String> {
            let id = strip_quotes(raw);
            let (id, label) = if let Some((id, s)) = id.split_once('[')
                && !id.is_empty()
                && let Some(label) = s.strip_suffix(']')
            {
                (id.trim_ascii(), Some(strip_quotes(label)))
            } else {
                (id, None)
            };
            if id.is_empty() {
                return Err(syntax("Missing class identifier in classDiagram"));
            }
            if let Some(s) = label {
                check_label(s, stmt, text)?;
            }
            let group = namespace.map(|(i, _)| i);
            if let Some(&(i, first)) = ids.get(id) {
                let n = &mut graph.nodes[i];
                if let Some(l) = label {
                    n.label = l.into();
                }
                n.group = n.group.or(group);
                return Ok((i, first));
            }
            if graph.nodes.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            let i = graph.nodes.len();
            ids.insert(id.into(), (i, stmt));
            graph.nodes.push(Node {
                id: id.into(),
                label: label.unwrap_or(id).into(),
                group,
                shape: Shape::Class,
                order: i,
                ..Default::default()
            });
            Ok((i, stmt))
        };
        if word.eq_ignore_ascii_case("direction") {
            graph.dir = match body.to_ascii_uppercase().as_str() {
                "TD" | "TB" => "TD",
                "LR" => "LR",
                "RL" => "RL",
                "BT" => "BT",
                x => return Err(syntax(&format!("Invalid classDiagram direction '{x}'"))),
            };
        } else if word.eq_ignore_ascii_case("namespace") {
            let raw = body
                .strip_suffix('{')
                .ok_or_else(|| syntax("Expected '{' at end of 'namespace' declaration"))?;
            let id = strip_quotes(raw);
            if id.is_empty() {
                return Err(syntax("Missing namespace identifier"));
            }
            check_label(id, stmt, text)?;
            let i = *groups.entry(id.into()).or_insert(graph.groups.len());
            if i == graph.groups.len() {
                if i >= limit / 300 {
                    return Err("mmdc: E_LIMIT: Render work budget exceeded\n".into());
                }
                graph.groups.push(Group {
                    id: id.into(),
                    label: id.into(),
                    depth: 1,
                    root: i,
                    ..Default::default()
                });
            }
            namespace = Some((i, stmt));
        } else if word.eq_ignore_ascii_case("class") {
            let body = body
                .strip_suffix('}')
                .and_then(|s| s.trim_end().strip_suffix('{'))
                .unwrap_or(body)
                .trim_end();
            let block = body.strip_suffix('{');
            let raw = block.unwrap_or(body).trim_end();
            let mut stereo = None;
            let joined;
            let id = if let Some((before, rest)) = raw.split_once("<<")
                && !before.is_empty()
                && let Some((s, after)) = rest.split_once(">>")
            {
                let s = s.trim_ascii();
                check_label(s, stmt, text)?;
                stereo = Some(s);
                joined = format!("{before} {after}");
                joined.trim()
            } else {
                raw
            };
            let (i, first) = ensure(id)?;
            if let Some(s) = stereo
                && !s.is_empty()
            {
                graph.nodes[i].stereotype = format!("«{s}»");
            }
            if block.is_some() {
                active = Some((i, first));
            }
        } else {
            let colon = outside(text, |s| s.starts_with(':'));
            let prefix = &text[..colon.unwrap_or(text.len())];
            if outside(prefix, |s| s.starts_with("--") || s.starts_with("..")).is_some() {
                return Ok(None);
            }
            if let Some(i) = colon
                && i > 0
            {
                let (n, _) = ensure(strip_quotes(&text[..i]))?;
                member(
                    &text[i + 1..],
                    &mut graph.nodes[n],
                    stmt,
                    &mut graph.remaining_lines,
                )?;
            } else {
                return Err(syntax(&format!(
                    "Unrecognized classDiagram statement: '{text}'"
                )));
            }
        }
    }
    if let Some((i, s)) = active {
        return Err(s.error(
            "E_SYNTAX",
            &s.text,
            &format!("Unclosed class block '{}'", graph.nodes[i].id),
        ));
    }
    if let Some((i, s)) = namespace {
        return Err(s.error(
            "E_SYNTAX",
            &s.text,
            &format!("Unclosed namespace block '{}'", graph.groups[i].id),
        ));
    }
    Ok(Some(graph))
}
