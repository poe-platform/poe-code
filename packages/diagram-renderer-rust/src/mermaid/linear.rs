use super::{Graph, Group, Node, Shape, Statement, number, scanner::check_label};

pub(super) fn parse(
    family: &str,
    stmts: &[Statement],
    title: &mut Option<String>,
    wrapping_width: f64,
    limit: usize,
) -> Result<Graph<'static>, String> {
    let mut graph = Graph::core(wrapping_width, limit);
    for stmt in &stmts[1..] {
        let text = stmt.text.trim_end();
        if let Some(raw) = text.strip_prefix("title ") {
            check_label(raw.trim(), stmt, text)?;
            *title = Some(raw.trim().into());
            continue;
        }
        if graph.nodes.len() + graph.groups.len() > limit / 300 {
            return Err("mmdc: E_LIMIT: Render work budget exceeded\n".into());
        }
        if let Some(raw) = text.strip_prefix("section ") {
            let raw = raw.trim();
            check_label(raw, stmt, text)?;
            let index = graph.groups.len();
            graph.groups.push(Group {
                id: format!("section_{index}"),
                label: raw.into(),
                root: index,
                depth: 1,
                ..Group::default()
            });
            continue;
        }
        let mut fields = text.split(':').map(str::trim);
        let first = fields.next().unwrap();
        let label = if family == "journey" {
            let score = number(fields.next().unwrap_or(""));
            let actors = fields.next().unwrap_or("");
            if first.is_empty()
                || score.fract() != 0.
                || !(1. ..=5.).contains(&score)
                || fields.next().is_some()
            {
                return Err(stmt.error(
                    "E_SYNTAX",
                    text,
                    "Journey tasks require a score from 1 to 5",
                ));
            }
            let mut label = format!("{first}\nScore: {score}/5");
            if !actors.is_empty() {
                label.push('\n');
                label.push_str(actors)
            }
            label
        } else {
            let mut label = first.to_string();
            let mut empty_event = false;
            for field in fields {
                empty_event |= field.is_empty();
                label.push('\n');
                label.push_str(field);
            }
            if first.is_empty() {
                if graph.nodes.is_empty() || empty_event || label.is_empty() {
                    return Err(stmt.error("E_SYNTAX", text, "Timeline event requires a period"));
                }
                check_label(&label, stmt, text)?;
                graph.nodes.last_mut().unwrap().label.push_str(&label);
                continue;
            }
            if empty_event {
                return Err(stmt.error("E_SYNTAX", text, "Empty timeline event"));
            }
            label
        };
        check_label(&label, stmt, text)?;
        let i = graph.nodes.len();
        let node = Node {
            group: graph.groups.len().checked_sub(1),
            id: format!("{family}_{i}"),
            order: i,
            label,
            shape: Shape::Rounded,
            ..Node::default()
        };
        graph.nodes.push(node);
        if i > 0 {
            graph.connect(i - 1, i, "-->");
        }
    }
    if graph.nodes.is_empty() {
        return Err(format!("mmdc: E_SYNTAX: {family} requires data\n"));
    }
    Ok(graph)
}
