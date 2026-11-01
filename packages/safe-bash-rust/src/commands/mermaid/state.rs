use super::{Graph, Node, Pill, Shape, Statement, scanner::check_label};
use std::collections::BTreeMap;

fn strip_quotes(value: &str) -> &str {
    let s = value.trim_ascii();
    match s.as_bytes() {
        [a @ (b'\'' | b'"'), .., b] if a == b => &s[1..s.len() - 1],
        _ => s,
    }
}

fn outside(s: &str, token: impl Fn(&str) -> bool) -> Option<usize> {
    let mut quote = None;
    for (i, c) in s.char_indices() {
        if let Some(q) = quote {
            if c == q && !s[..i].ends_with('\\') {
                quote = None;
            }
        } else if matches!(c, '\'' | '"') {
            quote = Some(c);
        } else if token(&s[i..]) {
            return Some(i);
        }
    }
    None
}

pub(super) fn parse(
    lines: &[Statement],
    wrapping: f64,
    secondary: f64,
    limit: usize,
) -> Option<Result<Graph<'static>, String>> {
    // Keep the existing rendering path for notes and composite diagrams until their layout is supported.
    if lines[1..].iter().any(|s| {
        s.text.trim_end().ends_with('{')
            || s.text
                .split_ascii_whitespace()
                .next()
                .is_some_and(|w| w.eq_ignore_ascii_case("note"))
    }) {
        return None;
    }
    Some(flat(lines, wrapping, secondary, limit))
}

fn flat(
    lines: &[Statement],
    wrapping: f64,
    secondary: f64,
    limit: usize,
) -> Result<Graph<'static>, String> {
    let mut graph = Graph::core(wrapping, limit);
    graph.dir = "TD";
    graph.edge_id = |i| format!("state_edge_{}", i + 1);
    let mut ids = BTreeMap::<String, usize>::new();
    for stmt in &lines[1..] {
        let text = stmt.text.trim_end();
        let fail = |s: &str| stmt.error("E_SYNTAX", text, s);
        let mut ensure = |nodes: &mut Vec<Node>,
                          raw: &str,
                          label: Option<&str>,
                          shape: Option<Shape>|
         -> Result<usize, String> {
            let id = strip_quotes(raw);
            if id.is_empty() {
                return Err(fail("Empty state identifier"));
            }
            if let Some(label) = label {
                check_label(label, stmt, text)?;
            }
            if let Some(&idx) = ids.get(id) {
                let n = &mut nodes[idx];
                if n.label == n.id
                    && let Some(label) = label
                {
                    n.label = label.into();
                }
                if let Some(shape) = shape {
                    n.shape = shape;
                }
                return Ok(idx);
            }
            if nodes.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            let idx = nodes.len();
            ids.insert(id.into(), idx);
            nodes.push(Node {
                id: id.into(),
                label: label.unwrap_or(id).into(),
                shape: shape.unwrap_or(Shape::Rounded),
                order: idx,
                ..Default::default()
            });
            Ok(idx)
        };
        if text == "}" {
            return Err(fail("Unexpected '}' without open composite state"));
        }
        let kw = text.split_ascii_whitespace().next().unwrap_or("");
        let body = text[kw.len()..].trim_ascii();
        if kw.eq_ignore_ascii_case("direction") {
            graph.dir = match body.to_ascii_uppercase().as_str() {
                "TD" | "TB" => "TD",
                "LR" => "LR",
                "RL" => "RL",
                "BT" => "BT",
                other => return Err(fail(&format!("Invalid stateDiagram direction '{other}'"))),
            };
        } else if kw.eq_ignore_ascii_case("state") {
            let mut body = body;
            let mut shape = None;
            if let Some((before, kind)) = body.strip_suffix(">>").and_then(|s| s.rsplit_once("<<"))
            {
                let kind = kind.trim();
                if !kind.is_empty()
                    && kind
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
                {
                    body = before.trim_end();
                    shape = match kind.to_ascii_lowercase().as_str() {
                        "choice" => Some(Shape::Diamond),
                        "fork" | "join" => Some(Shape::Rect),
                        _ => None,
                    };
                }
            }
            let alias = outside(body, |s| {
                matches!(
                    s.as_bytes(),
                    [b' ' | b'\t', b'a' | b'A', b's' | b'S', b' ' | b'\t', ..]
                )
            });
            let (id, label) = if let Some(i) = alias {
                (strip_quotes(&body[i + 4..]), strip_quotes(&body[..i]))
            } else {
                (strip_quotes(body), strip_quotes(body))
            };
            if id.is_empty() {
                return Err(fail(if alias.is_some() {
                    "Missing state alias after 'as'"
                } else {
                    "Missing state identifier"
                }));
            }
            check_label(label, stmt, text)?;
            let label = if shape == Some(Shape::Diamond) && label == id {
                "?"
            } else if label.is_empty() {
                id
            } else {
                label
            };
            ensure(&mut graph.nodes, id, Some(label), shape)?;
        } else if let Some(i) = outside(text, |s| s.starts_with("-->")) {
            let left = text[..i].trim_ascii();
            let rest = text[i + 3..].trim_ascii();
            let (right, label) = outside(rest, |s| s.starts_with(':')).map_or((rest, ""), |i| {
                (rest[..i].trim_ascii(), strip_quotes(&rest[i + 1..]))
            });
            check_label(label, stmt, text)?;
            if left.is_empty() || right.is_empty() {
                return Err(fail(&format!("Incomplete state transition '{text}'")));
            }
            let mut endpoint = |raw: &str, source| {
                if raw == "[*]" {
                    let (id, shape) = if source {
                        ("__state_start_1", Shape::StateStart)
                    } else {
                        ("__state_end_1", Shape::StateEnd)
                    };
                    ensure(&mut graph.nodes, id, Some(""), Some(shape))
                } else {
                    ensure(&mut graph.nodes, raw, None, None)
                }
            };
            let (from, to) = (endpoint(left, true)?, endpoint(right, false)?);
            if graph.edges.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Edge limit exceeded\n".into());
            }
            graph.connect(from, to, "-->");
            if !label.is_empty() {
                let pill = Pill::new(label, wrapping, secondary, graph.remaining_lines)
                    .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
                graph.remaining_lines -= pill.lines.len();
                graph.edges.last_mut().unwrap().3 = Some(pill);
            }
        } else if let Some(i) = outside(text, |s| s.starts_with(':'))
            && let (id, desc) = (strip_quotes(&text[..i]), strip_quotes(&text[i + 1..]))
            && !id.is_empty()
            && !desc.is_empty()
        {
            check_label(desc, stmt, text)?;
            let idx = ensure(&mut graph.nodes, id, None, None)?;
            let node = &mut graph.nodes[idx];
            if node.id == node.label {
                node.label = format!("{id}\n{desc}");
                check_label(&node.label, stmt, text)?;
            }
        } else {
            return Err(fail(&format!(
                "Unknown or unsupported stateDiagram statement '{text}'"
            )));
        }
    }
    Ok(graph)
}
