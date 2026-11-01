use super::{Graph, Node, Shape, Statement, scanner::check_label};
use std::collections::BTreeMap;

fn quoted(s: &str) -> Option<&str> {
    s.strip_prefix('"')?
        .strip_suffix('"')
        .filter(|v| !v.is_empty() && !v.contains('"'))
}
fn identifier(s: &str) -> Option<&str> {
    quoted(s).or_else(|| {
        (!s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-')))
        .then_some(s)
    })
}

pub(super) fn parse(
    lines: &[Statement],
    wrapping: f64,
    limit: usize,
) -> Result<Option<Graph<'static>>, String> {
    let mut graph = Graph::core(wrapping, limit);
    graph.dir = "TB";
    let mut ids = BTreeMap::<String, usize>::new();
    let mut active = None::<usize>;
    let mut has_members = false;
    for stmt in &lines[1..] {
        let text = stmt.text.trim();
        if active.is_some() {
            if text == "}" {
                active = None;
            } else {
                if text
                    .split('"')
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .take(2)
                    .count()
                    != 2
                {
                    return Err(stmt.error(
                        "E_SYNTAX",
                        text,
                        &format!("Invalid ER attribute declaration '{text}'"),
                    ));
                }
                has_members = true;
            }
            continue;
        }
        let mut words = text.split_whitespace();
        if words
            .next()
            .is_some_and(|s| s.eq_ignore_ascii_case("direction"))
            && let Some(dir) = words.next()
            && words.next().is_none()
        {
            let value = match dir.to_ascii_uppercase().as_str() {
                "TB" | "TD" => Some("TB"),
                "BT" => Some("BT"),
                "LR" => Some("LR"),
                "RL" => Some("RL"),
                _ => None,
            };
            if let Some(value) = value {
                graph.dir = value;
                continue;
            }
        }
        let empty = text
            .strip_suffix('}')
            .and_then(|s| s.trim_end().strip_suffix('{'));
        let block = text.strip_suffix('{');
        let raw = empty.or(block).unwrap_or(text).trim_end();
        let id_end = if let Some(rest) = raw.strip_prefix('"') {
            rest.find('"').map_or(raw.len(), |i| i + 2)
        } else {
            raw.find('[').unwrap_or(raw.len())
        };
        let (s, suffix) = raw.split_at(id_end);
        let block_token = block.is_some() || empty.is_some();
        let tail = if block_token {
            suffix.trim_start()
        } else {
            suffix
        };
        let alias = tail.strip_prefix('[').and_then(|tail| {
            Some((
                identifier(if block_token { s.trim_end() } else { s })?,
                quoted(tail.strip_suffix(']')?.trim())?,
            ))
        });
        let (id, label) = if let Some(pair) = alias {
            pair
        } else if let Some(id) = identifier(raw) {
            (id, id)
        } else if !raw.is_empty() && (block.is_some() || empty.is_some()) {
            let id = raw
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .or_else(|| raw.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
                .unwrap_or(raw);
            (id, id)
        } else if text.contains("--") || text.contains("..") {
            return Ok(None);
        } else {
            return Err(stmt.error(
                "E_SYNTAX",
                text,
                &format!("Unrecognized erDiagram statement '{text}'"),
            ));
        };
        check_label(label, stmt, text)?;
        let idx = if let Some(&i) = ids.get(id) {
            if graph.nodes[i].label == id && label != id {
                graph.nodes[i].label = label.into();
            }
            i
        } else {
            if graph.nodes.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            let i = graph.nodes.len();
            ids.insert(id.into(), i);
            graph.nodes.push(Node {
                id: id.into(),
                label: label.into(),
                order: i,
                shape: Shape::Entity,
                ..Default::default()
            });
            i
        };
        if block.is_some() {
            active = Some(idx);
        }
    }
    if let Some(i) = active {
        let stmt = lines.last().unwrap();
        return Err(stmt.error(
            "E_SYNTAX",
            &stmt.text,
            &format!("Unclosed entity block '{}'", graph.nodes[i].id),
        ));
    }
    Ok((!has_members).then_some(graph))
}
