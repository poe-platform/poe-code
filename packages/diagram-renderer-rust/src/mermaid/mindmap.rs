use super::{
    Graph, Node, Shape, Statement,
    scanner::{check_label, unquote},
};
use std::collections::BTreeSet;

pub(super) fn parse(
    stmts: &[Statement],
    wrapping_width: f64,
    limit: usize,
) -> Result<Graph<'static>, String> {
    let mut graph = Graph::core(wrapping_width, limit);
    let mut parents = Vec::<(usize, usize)>::new();
    let mut ids = BTreeSet::new();
    for stmt in &stmts[1..] {
        let text = stmt.text.trim_end();
        let fail = |msg: &str| stmt.error("E_SYNTAX", text, msg);
        if text.starts_with("::") {
            return Err(stmt.error(
                "E_UNSUPPORTED",
                text,
                "Mindmap icons and CSS classes are unsupported",
            ));
        }
        let mut id = None;
        let mut label = text.to_owned();
        let mut shape = Shape::Rounded;
        for (open, close, candidate) in [
            ("((", "))", Shape::Circle),
            ("{{", "}}", Shape::Hexagon),
            ("[", "]", Shape::Rect),
            ("(", ")", Shape::Rounded),
            (")", "(", Shape::Rounded),
        ] {
            if let Some((prefix, raw)) = text.split_once(open) {
                let value = raw
                    .strip_suffix(close)
                    .ok_or_else(|| fail("Unclosed mindmap shape"))?;
                id = Some(prefix.trim()).filter(|s| !s.is_empty());
                label = unquote(value);
                shape = candidate;
                break;
            }
        }
        if label.is_empty() {
            return Err(fail("Empty mindmap node"));
        }
        while parents.last().is_some_and(|(col, _)| *col >= stmt.column) {
            parents.pop();
        }
        let idx = graph.nodes.len();
        if idx > 0 && parents.is_empty() {
            return Err(fail("Mindmap must have one indented root"));
        }
        let id = id
            .map(str::to_owned)
            .unwrap_or_else(|| format!("mindmap_{idx}"));
        if !ids.insert(id.clone()) {
            return Err(fail(&format!("Duplicate node '{id}'")));
        }
        if idx >= limit / 300 {
            return Err("mmdc: E_LIMIT: Render work budget exceeded\n".into());
        }
        check_label(&label, stmt, text)?;
        graph.nodes.push(Node {
            order: idx,
            id,
            label,
            shape,
            ..Node::default()
        });
        if let Some(&(_, i)) = parents.last() {
            graph.connect(i, idx, "---");
        }
        parents.push((stmt.column, idx));
    }
    if graph.nodes.is_empty() {
        return Err("mmdc: E_SYNTAX: mindmap requires data\n".into());
    }
    Ok(graph)
}
