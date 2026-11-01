use super::{
    Graph, Node, Shape, Statement,
    scanner::{check_label, unquote},
};
use std::collections::BTreeMap;

// Attributes can contain quoted spaces; a colon belongs to the preceding word.
fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut quote = None;
    for (i, c) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ' ')))
    {
        if let Some(q) = quote {
            if c == q && !text[..i].ends_with('\\') {
                quote = None
            }
        } else if matches!(c, '\'' | '"') {
            quote = Some(c)
        } else if matches!(c, ' ' | '\t' | '\n' | '\r') {
            if i > start {
                out.push(unquote(&text[start..i]))
            }
            start = i + 1;
        }
    }
    out
}

pub(super) fn parse(
    lines: &[Statement],
    wrapping_width: f64,
    limit: usize,
) -> Result<Graph<'static>, String> {
    let mut graph = Graph::core(wrapping_width, limit);
    graph.dir = match lines[0].text["gitGraph".len()..].trim() {
        "" | ":" | "LR" | "LR:" => "LR",
        "BT" | "BT:" => "BT",
        "TB" | "TB:" => "TD",
        _ => return Err("mmdc: E_SYNTAX: Invalid gitGraph direction\n".into()),
    };
    let mut current = String::from("main");
    let mut branches = BTreeMap::from([(current.clone(), None::<usize>)]);
    let mut ids = BTreeMap::<String, usize>::new();
    let mut label_bytes = limit;
    for stmt in &lines[1..] {
        let text = stmt.text.trim_end();
        let fail = |message: &str| stmt.error("E_SYNTAX", text, message);
        let tokens = words(text);
        let cmd = tokens.first().map_or("undefined", String::as_str);
        let mut named = BTreeMap::new();
        let mut args = Vec::new();
        let mut tail = tokens.iter().skip(1).map(String::as_str);
        while let Some(word) = tail.next() {
            if let Some(key) = word.strip_suffix(':') {
                named.insert(
                    key,
                    tail.next()
                        .ok_or_else(|| fail("Missing gitGraph attribute value"))?,
                );
            } else {
                args.push(word);
            }
        }
        let target = args.first().copied().unwrap_or("");
        let parent = branches[&current];
        if cmd == "branch" {
            if target.is_empty()
                || branches.contains_key(target)
                || args.len() != 1
                || named.keys().any(|&k| k != "order")
            {
                return Err(fail("Invalid or duplicate branch"));
            }
            if branches.len() >= limit / 256 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            branches.insert(target.into(), parent);
            current = target.into();
            continue;
        }
        if matches!(cmd, "checkout" | "switch") {
            if target.is_empty() || !branches.contains_key(target) || tokens.len() != 2 {
                return Err(fail("Unknown checkout branch"));
            }
            current = target.into();
            continue;
        }
        if !matches!(cmd, "commit" | "merge" | "cherry-pick") {
            return Err(stmt.error(
                "E_UNSUPPORTED",
                text,
                &format!("Unsupported gitGraph command '{cmd}'"),
            ));
        }
        if named
            .keys()
            .any(|&key| !matches!(key, "id" | "tag" | "type" | "parent"))
        {
            return Err(fail("Unknown commit attribute"));
        }
        let kind = named.get("type").copied().unwrap_or("");
        if !matches!(kind, "" | "NORMAL" | "REVERSE" | "HIGHLIGHT") {
            return Err(fail("Invalid commit type"));
        }
        if args.len() != usize::from(cmd == "merge") {
            return Err(fail("Invalid commit arguments"));
        }
        let other = match cmd {
            "merge" => branches.get(target).copied().flatten(),
            "cherry-pick" => named.get("id").and_then(|&id| ids.get(id)).copied(),
            _ => None,
        };
        if cmd != "commit"
            && (other == parent || other.is_none_or(|i| graph.nodes[i].id.is_empty()))
        {
            return Err(fail("Invalid merge or cherry-pick target"));
        }
        let idx = graph.nodes.len();
        let id = if cmd == "cherry-pick" {
            format!("cherry_{idx}")
        } else {
            named
                .get("id")
                .map_or_else(|| format!("commit_{idx}"), |s| (*s).into())
        };
        if ids.insert(id.clone(), idx).is_some() {
            return Err(fail(&format!("Duplicate node '{id}'")));
        }
        let mut label = format!("{current}\n{id}");
        if cmd == "cherry-pick" {
            label.push_str("\ncherry-pick ");
            label.push_str(&graph.nodes[other.unwrap()].id);
        }
        if let Some(&tag) = named.get("tag").filter(|v| !v.is_empty()) {
            label.push('\n');
            label.push_str(tag);
        }
        if !matches!(kind, "" | "NORMAL") {
            label.push('\n');
            label.push_str(kind);
        }
        if idx >= limit / 300 || label.len() > label_bytes {
            return Err("mmdc: E_LIMIT: Render work budget exceeded\n".into());
        }
        label_bytes -= label.len();
        check_label(&label, stmt, text)?;
        graph.nodes.push(Node {
            order: idx,
            label,
            id,
            shape: Shape::Circle,
            ..Node::default()
        });
        if let Some(p) = parent.filter(|&i| !graph.nodes[i].id.is_empty()) {
            graph.connect(p, idx, "-->")
        }
        if let Some(p) = other {
            graph.connect(p, idx, "-->")
        }
        *branches.get_mut(&current).unwrap() = Some(idx);
    }
    if graph.nodes.is_empty() {
        return Err("mmdc: E_SYNTAX: gitGraph requires data\n".into());
    }
    Ok(graph)
}
