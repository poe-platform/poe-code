#[derive(Clone, Debug, Default, PartialEq)]
struct GvAttrs {
    entries: Vec<(String, String)>,
}

impl GvAttrs {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn insert(&mut self, key: impl Into<String>, value: impl Into<String>) {
        let k = key.into();
        let v = value.into();
        if let Some(existing) = self.entries.iter_mut().find(|(ek, _)| *ek == k) {
            existing.1 = v;
        } else {
            self.entries.push((k, v));
        }
    }

    fn set(&mut self, key: String, value: String) {
        self.insert(key, value);
    }

    fn extend_from(&mut self, other: &GvAttrs) {
        for (k, v) in &other.entries {
            self.insert(k.clone(), v.clone());
        }
    }

    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq)]
struct GvNodeRef {
    id: String,
    port: Option<String>,
    compass: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
enum GvEndpoint {
    Node(GvNodeRef),
    Subgraph(GvSubgraph),
}

#[derive(Clone, Debug, PartialEq)]
struct GvSubgraph {
    id: Option<String>,
    statements: Vec<GvStatement>,
}

#[derive(Clone, Debug, PartialEq)]
enum GvStatement {
    Node {
        node: GvNodeRef,
        attributes: GvAttrs,
    },
    Edge {
        endpoints: Vec<GvEndpoint>,
        attributes: GvAttrs,
    },
    Attributes {
        target: String,
        attributes: GvAttrs,
    },
    Subgraph(GvSubgraph),
}

#[derive(Clone, Debug, PartialEq)]
struct GvDotGraph {
    directed: bool,
    strict: bool,
    id: Option<String>,
    statements: Vec<GvStatement>,
}

#[derive(Clone, Debug, PartialEq)]
enum GvTokenKind {
    Id,
    Html,
    Quoted,
    Symbol,
    Eof,
}

#[derive(Clone, Debug)]
struct GvToken {
    value: String,
    kind: GvTokenKind,
    offset: usize,
}

fn is_gv_compass(s: &str) -> bool {
    matches!(
        s,
        "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw" | "c" | "_"
    )
}

fn is_gv_whitespace(c: char) -> bool {
    matches!(c, ' ' | '\n' | '\r' | '\t' | '\x0c')
}

fn is_gv_digit(c: char) -> bool {
    c.is_ascii_digit()
}

fn is_gv_letter(c: char) -> bool {
    c == '_' || c.is_ascii_alphabetic() || (c as u32) >= 128
}

fn gv_tokenize(source: &str) -> Result<Vec<GvToken>, String> {
    let chars: Vec<(usize, char)> = source.char_indices().collect();
    let mut tokens = Vec::new();
    let mut idx = 0usize;
    let len = chars.len();
    let byte_offset = |i: usize| -> usize {
        if i < len {
            chars[i].0
        } else {
            source.len()
        }
    };

    while idx < len {
        let (offset, c) = chars[idx];
        if is_gv_whitespace(c) {
            idx += 1;
            continue;
        }
        if c == '#' || (c == '/' && idx + 1 < len && chars[idx + 1].1 == '/') {
            while idx < len && chars[idx].1 != '\n' {
                idx += 1;
            }
            continue;
        }
        if c == '/' && idx + 1 < len && chars[idx + 1].1 == '*' {
            idx += 2;
            let mut found = false;
            while idx + 1 < len {
                if chars[idx].1 == '*' && chars[idx + 1].1 == '/' {
                    idx += 2;
                    found = true;
                    break;
                }
                idx += 1;
            }
            if !found {
                return Err(format!("Unterminated comment at offset {}", byte_offset(idx)));
            }
            continue;
        }
        if c == '-' && idx + 1 < len && (chars[idx + 1].1 == '>' || chars[idx + 1].1 == '-') {
            let mut s = String::with_capacity(2);
            s.push(c);
            s.push(chars[idx + 1].1);
            tokens.push(GvToken {
                value: s,
                kind: GvTokenKind::Symbol,
                offset,
            });
            idx += 2;
            continue;
        }
        if matches!(c, '{' | '}' | '[' | ']' | '=' | ':' | ';' | ',' | '+') {
            tokens.push(GvToken {
                value: c.to_string(),
                kind: GvTokenKind::Symbol,
                offset,
            });
            idx += 1;
            continue;
        }
        if c == '"' {
            let mut value = String::new();
            idx += 1;
            while idx < len && chars[idx].1 != '"' {
                if chars[idx].1 == '\\' {
                    idx += 1;
                    if idx == len {
                        return Err(format!("Unterminated escape at offset {}", source.len()));
                    }
                    if chars[idx].1 == '\n' {
                        idx += 1;
                        continue;
                    }
                    if chars[idx].1 == '\r' && idx + 1 < len && chars[idx + 1].1 == '\n' {
                        idx += 2;
                        continue;
                    }
                    let escaped = chars[idx].1;
                    if escaped == '"' || escaped == '\\' {
                        value.push(escaped);
                    } else {
                        value.push('\\');
                        value.push(escaped);
                    }
                    idx += 1;
                } else {
                    value.push(chars[idx].1);
                    idx += 1;
                }
            }
            if idx >= len || chars[idx].1 != '"' {
                return Err(format!("Unterminated string at offset {}", byte_offset(idx)));
            }
            idx += 1;
            tokens.push(GvToken {
                value,
                kind: GvTokenKind::Quoted,
                offset,
            });
            continue;
        }
        if c == '<' {
            let mut depth = 0i32;
            let mut quote: Option<char> = None;
            loop {
                if idx >= len {
                    break;
                }
                let ch = chars[idx].1;
                idx += 1;
                if let Some(q) = quote {
                    if ch == q {
                        quote = None;
                    }
                } else if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                } else if ch == '<' {
                    if idx + 2 < len
                        && chars[idx].1 == '!'
                        && chars[idx + 1].1 == '-'
                        && chars[idx + 2].1 == '-'
                    {
                        idx += 3;
                        let mut found = false;
                        while idx + 2 < len {
                            if chars[idx].1 == '-'
                                && chars[idx + 1].1 == '-'
                                && chars[idx + 2].1 == '>'
                            {
                                idx += 3;
                                found = true;
                                break;
                            }
                            idx += 1;
                        }
                        if !found {
                            return Err(format!(
                                "Unterminated HTML comment at offset {}",
                                byte_offset(idx)
                            ));
                        }
                    } else {
                        depth += 1;
                    }
                } else if ch == '>' {
                    depth -= 1;
                }
                if idx >= len || depth <= 0 {
                    break;
                }
            }
            if depth != 0 || quote.is_some() {
                return Err(format!(
                    "Unterminated HTML ID at offset {}",
                    byte_offset(idx)
                ));
            }
            let end_byte = byte_offset(idx);
            tokens.push(GvToken {
                value: source[offset..end_byte].to_string(),
                kind: GvTokenKind::Html,
                offset,
            });
            continue;
        }
        if is_gv_letter(c) {
            idx += 1;
            while idx < len && (is_gv_letter(chars[idx].1) || is_gv_digit(chars[idx].1)) {
                idx += 1;
            }
        } else if is_gv_digit(c) || c == '.' || c == '-' {
            if c == '-' {
                idx += 1;
            }
            let mut digits = 0usize;
            while idx < len && is_gv_digit(chars[idx].1) {
                idx += 1;
                digits += 1;
            }
            if idx < len && chars[idx].1 == '.' {
                idx += 1;
                while idx < len && is_gv_digit(chars[idx].1) {
                    idx += 1;
                    digits += 1;
                }
            }
            if digits == 0 {
                return Err(format!("Invalid numeric ID at offset {}", byte_offset(idx)));
            }
        } else {
            return Err(format!("Unexpected character at offset {offset}"));
        }
        let end_byte = byte_offset(idx);
        tokens.push(GvToken {
            value: source[offset..end_byte].to_string(),
            kind: GvTokenKind::Id,
            offset,
        });
    }
    tokens.push(GvToken {
        value: String::new(),
        kind: GvTokenKind::Eof,
        offset: source.len(),
    });
    Ok(tokens)
}

struct GvParser {
    tokens: Vec<GvToken>,
    position: usize,
    nesting: usize,
    expected_edge_op: &'static str,
}

impl GvParser {
    fn peek(&self) -> &GvToken {
        &self.tokens[self.position]
    }

    fn fail<T>(&self, message: &str) -> Result<T, String> {
        Err(format!("{message} at offset {}", self.peek().offset))
    }

    fn accept(&mut self, value: &str) -> bool {
        if self.peek().kind == GvTokenKind::Symbol && self.peek().value == value {
            self.position += 1;
            true
        } else {
            false
        }
    }

    fn keyword(&self, value: &str) -> bool {
        self.peek().kind == GvTokenKind::Id && self.peek().value.eq_ignore_ascii_case(value)
    }

    fn expect(&mut self, value: &str) -> Result<(), String> {
        if !self.accept(value) {
            self.fail(&format!("Expected {value}"))
        } else {
            Ok(())
        }
    }

    fn id(&mut self) -> Result<String, String> {
        let token = self.peek().clone();
        if !matches!(
            token.kind,
            GvTokenKind::Id | GvTokenKind::Html | GvTokenKind::Quoted
        ) {
            return self.fail("Expected ID");
        }
        self.position += 1;
        let mut value = token.value;
        if token.kind == GvTokenKind::Quoted {
            while self.accept("+") {
                if self.peek().kind != GvTokenKind::Quoted {
                    return self.fail("Expected quoted string after +");
                }
                value.push_str(&self.peek().value);
                self.position += 1;
            }
        }
        Ok(value)
    }

    fn attrs(&mut self) -> Result<GvAttrs, String> {
        let mut result = GvAttrs::new();
        while self.accept("[") {
            while !self.accept("]") {
                let key = self.id()?;
                self.expect("=")?;
                let val = self.id()?;
                result.insert(key, val);
                self.accept(",");
                self.accept(";");
            }
        }
        Ok(result)
    }

    fn node_ref(&mut self, name: String) -> Result<GvNodeRef, String> {
        let mut result = GvNodeRef {
            id: name,
            port: None,
            compass: None,
        };
        if self.accept(":") {
            let port = self.id()?;
            if self.accept(":") {
                let comp = self.id()?;
                if !is_gv_compass(&comp) {
                    return self.fail("Invalid compass point");
                }
                result.port = Some(port);
                result.compass = Some(comp);
            } else if is_gv_compass(&port) {
                result.compass = Some(port);
            } else {
                result.port = Some(port);
            }
        }
        Ok(result)
    }

    fn subgraph(&mut self) -> Result<GvSubgraph, String> {
        let mut id = None;
        if self.keyword("subgraph") {
            self.position += 1;
            if !(self.peek().kind == GvTokenKind::Symbol && self.peek().value == "{") {
                id = Some(self.id()?);
            }
        }
        let statements = self.statements()?;
        Ok(GvSubgraph { id, statements })
    }

    fn statements(&mut self) -> Result<Vec<GvStatement>, String> {
        self.nesting += 1;
        if self.nesting > 256 {
            return self.fail("DOT nesting exceeds 256");
        }
        self.expect("{")?;
        let mut result = Vec::new();
        while !self.accept("}") {
            if self.accept(";") || self.accept(",") {
                continue;
            }
            if (self.keyword("graph") || self.keyword("node") || self.keyword("edge"))
                && self
                    .tokens
                    .get(self.position + 1)
                    .is_some_and(|t| t.kind == GvTokenKind::Symbol && t.value == "[")
            {
                let target = self.peek().value.to_ascii_lowercase();
                self.position += 1;
                let attributes = self.attrs()?;
                result.push(GvStatement::Attributes { target, attributes });
                continue;
            }
            let endpoint = if self.keyword("subgraph")
                || (self.peek().kind == GvTokenKind::Symbol && self.peek().value == "{")
            {
                GvEndpoint::Subgraph(self.subgraph()?)
            } else {
                let name = self.id()?;
                if self.accept("=") {
                    let val = self.id()?;
                    let mut attributes = GvAttrs::new();
                    attributes.insert(name, val);
                    result.push(GvStatement::Attributes {
                        target: "graph".to_string(),
                        attributes,
                    });
                    continue;
                }
                GvEndpoint::Node(self.node_ref(name)?)
            };
            if self.peek().kind == GvTokenKind::Symbol
                && (self.peek().value == "->" || self.peek().value == "--")
            {
                // checked by caller's directed flag passed via self? Wait: let's store directed on GvParser!
                let mut endpoints = vec![endpoint];
                while self.peek().kind == GvTokenKind::Symbol
                    && (self.peek().value == "->" || self.peek().value == "--")
                {
                    let op = self.peek().value.clone();
                    if op != self.expected_edge_op {
                        return self.fail("Wrong edge operator for graph type");
                    }
                    self.position += 1;
                    let next_ep = if self.keyword("subgraph")
                        || (self.peek().kind == GvTokenKind::Symbol && self.peek().value == "{")
                    {
                        GvEndpoint::Subgraph(self.subgraph()?)
                    } else {
                        let n = self.id()?;
                        GvEndpoint::Node(self.node_ref(n)?)
                    };
                    endpoints.push(next_ep);
                }
                let attributes = self.attrs()?;
                result.push(GvStatement::Edge {
                    endpoints,
                    attributes,
                });
            } else {
                match endpoint {
                    GvEndpoint::Subgraph(sub) => result.push(GvStatement::Subgraph(sub)),
                    GvEndpoint::Node(node) => {
                        let attributes = self.attrs()?;
                        result.push(GvStatement::Node { node, attributes });
                    }
                }
            }
            self.accept(";");
        }
        self.nesting -= 1;
        Ok(result)
    }

}

fn gv_parse_dot(source: &str) -> Result<GvDotGraph, String> {
    let tokens = gv_tokenize(source)?;
    let mut parser = GvParser {
        tokens,
        position: 0,
        nesting: 0,
        expected_edge_op: "->",
    };
    let mut strict = false;
    if parser.keyword("strict") {
        strict = true;
        parser.position += 1;
    }
    if !parser.keyword("digraph") && !parser.keyword("graph") {
        return parser.fail("Expected graph or digraph");
    }
    let directed = parser.keyword("digraph");
    parser.expected_edge_op = if directed { "->" } else { "--" };
    parser.position += 1;
    let id = if parser.peek().kind != GvTokenKind::Symbol {
        Some(parser.id()?)
    } else {
        None
    };
    let statements = parser.statements()?;
    if parser.peek().kind != GvTokenKind::Eof {
        return parser.fail("Trailing input");
    }
    Ok(GvDotGraph {
        directed,
        strict,
        id,
        statements,
    })
}

fn gv_quote(value: &str) -> String {
    if value.starts_with('<') && value.ends_with('>') {
        return value.to_string();
    }
    format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

fn gv_serialize_dot(graph: &GvDotGraph) -> String {
    fn fmt_attrs(values: &GvAttrs) -> String {
        if values.is_empty() {
            String::new()
        } else {
            let inner: Vec<String> = values
                .entries
                .iter()
                .map(|(k, v)| format!("{}={}", gv_quote(k), gv_quote(v)))
                .collect();
            format!(" [{}]", inner.join(", "))
        }
    }
    fn fmt_ref(node: &GvNodeRef) -> String {
        let mut s = gv_quote(&node.id);
        if let Some(ref p) = node.port {
            s.push(':');
            s.push_str(&gv_quote(p));
        }
        if let Some(ref c) = node.compass {
            s.push(':');
            s.push_str(c);
        }
        s
    }
    fn fmt_sub(sub: &GvSubgraph, directed: bool) -> String {
        let id_part = sub
            .id
            .as_ref()
            .map(|id| format!(" {}", gv_quote(id)))
            .unwrap_or_default();
        format!("subgraph{id_part} {{\n{}}}", fmt_body(&sub.statements, directed))
    }
    fn fmt_body(statements: &[GvStatement], directed: bool) -> String {
        let mut out = String::new();
        for st in statements {
            match st {
                GvStatement::Subgraph(sub) => {
                    out.push_str(&fmt_sub(sub, directed));
                    out.push_str(";\n");
                }
                GvStatement::Node { node, attributes } => {
                    out.push_str(&fmt_ref(node));
                    out.push_str(&fmt_attrs(attributes));
                    out.push_str(";\n");
                }
                GvStatement::Edge {
                    endpoints,
                    attributes,
                } => {
                    let parts: Vec<String> = endpoints
                        .iter()
                        .map(|ep| match ep {
                            GvEndpoint::Subgraph(sub) => fmt_sub(sub, directed),
                            GvEndpoint::Node(r) => fmt_ref(r),
                        })
                        .collect();
                    out.push_str(&parts.join(if directed { " -> " } else { " -- " }));
                    out.push_str(&fmt_attrs(attributes));
                    out.push_str(";\n");
                }
                GvStatement::Attributes { target, attributes } => {
                    if !attributes.is_empty() {
                        out.push_str(target);
                        out.push_str(&fmt_attrs(attributes));
                        out.push_str(";\n");
                    }
                }
            }
        }
        out
    }
    let mut res = String::new();
    if graph.strict {
        res.push_str("strict ");
    }
    res.push_str(if graph.directed { "digraph" } else { "graph" });
    if let Some(ref id) = graph.id {
        res.push(' ');
        res.push_str(&gv_quote(id));
    }
    res.push_str(" {\n");
    res.push_str(&fmt_body(&graph.statements, graph.directed));
    res.push_str("}\n");
    res
}

#[derive(Clone, Debug)]
struct GvModelNode {
    id: String,
    attributes: GvAttrs,
}

#[derive(Clone, Debug)]
struct GvModelEdge {
    tail: GvNodeRef,
    head: GvNodeRef,
    attributes: GvAttrs,
}

#[derive(Clone, Debug)]
struct GvModelCluster {
    id: String,
    attributes: GvAttrs,
    nodes: Vec<String>,
    parent: Option<String>,
}

#[derive(Clone, Debug)]
struct GvRankGroup {
    rank: String,
    nodes: Vec<String>,
}

#[derive(Clone, Debug)]
struct GvGraphModel {
    attributes: GvAttrs,
    nodes: Vec<GvModelNode>,
    edges: Vec<GvModelEdge>,
    clusters: Vec<GvModelCluster>,
    ranks: Vec<GvRankGroup>,
}

#[derive(Clone, Default)]
struct GvScope {
    graph: GvAttrs,
    node: GvAttrs,
    edge: GvAttrs,
}

fn gv_resolve_graph(graph: &GvDotGraph) -> GvGraphModel {
    let mut nodes: Vec<GvModelNode> = Vec::new();
    let mut edges: Vec<GvModelEdge> = Vec::new();
    let mut strict_edges: Vec<((String, String), usize)> = Vec::new();
    let mut clusters: Vec<GvModelCluster> = Vec::new();
    let mut ranks: Vec<GvRankGroup> = Vec::new();

    fn walk(
        statements: &[GvStatement],
        inherited: &GvScope,
        cluster: Option<&str>,
        directed: bool,
        strict: bool,
        nodes: &mut Vec<GvModelNode>,
        edges: &mut Vec<GvModelEdge>,
        strict_edges: &mut Vec<((String, String), usize)>,
        clusters: &mut Vec<GvModelCluster>,
        ranks: &mut Vec<GvRankGroup>,
    ) -> (Vec<String>, GvAttrs) {
        let mut scope = inherited.clone();
        let mut ids: Vec<String> = Vec::new();
        let add_id = |ids: &mut Vec<String>, id: &str| {
            if !ids.iter().any(|x| x == id) {
                ids.push(id.to_string());
            }
        };
        let ensure_node = |r: &GvNodeRef,
                               attrs: &GvAttrs,
                               scope_node: &GvAttrs,
                               nodes: &mut Vec<GvModelNode>,
                               ids: &mut Vec<String>|
         -> GvNodeRef {
            if let Some(existing) = nodes.iter_mut().find(|n| n.id == r.id) {
                existing.attributes.extend_from(attrs);
            } else {
                let mut a = scope_node.clone();
                a.extend_from(attrs);
                nodes.push(GvModelNode {
                    id: r.id.clone(),
                    attributes: a,
                });
            }
            add_id(ids, &r.id);
            r.clone()
        };

        for st in statements {
            match st {
                GvStatement::Attributes { target, attributes } => match target.as_str() {
                    "graph" => scope.graph.extend_from(attributes),
                    "node" => scope.node.extend_from(attributes),
                    "edge" => scope.edge.extend_from(attributes),
                    _ => {}
                },
                GvStatement::Node { node, attributes } => {
                    ensure_node(node, attributes, &scope.node, nodes, &mut ids);
                }
                GvStatement::Subgraph(sub) => {
                    let is_cluster = sub.id.as_deref().is_some_and(|s| s.starts_with("cluster"));
                    let next_cluster = if is_cluster {
                        sub.id.as_deref()
                    } else {
                        cluster
                    };
                    let (nested_ids, nested_attrs) = walk(
                        &sub.statements,
                        &scope,
                        next_cluster,
                        directed,
                        strict,
                        nodes,
                        edges,
                        strict_edges,
                        clusters,
                        ranks,
                    );
                    for id in &nested_ids {
                        add_id(&mut ids, id);
                    }
                    if is_cluster {
                        clusters.push(GvModelCluster {
                            id: sub.id.clone().unwrap_or_default(),
                            attributes: nested_attrs.clone(),
                            nodes: nested_ids.clone(),
                            parent: cluster.map(|s| s.to_string()),
                        });
                    }
                    if let Some(rk) = nested_attrs.get("rank") {
                        ranks.push(GvRankGroup {
                            rank: rk.to_string(),
                            nodes: nested_ids,
                        });
                    }
                }
                GvStatement::Edge {
                    endpoints,
                    attributes,
                } => {
                    let mut resolved_eps: Vec<Vec<GvNodeRef>> = Vec::new();
                    for ep in endpoints {
                        match ep {
                            GvEndpoint::Node(r) => {
                                let nr = ensure_node(
                                    r,
                                    &GvAttrs::new(),
                                    &scope.node,
                                    nodes,
                                    &mut ids,
                                );
                                resolved_eps.push(vec![nr]);
                            }
                            GvEndpoint::Subgraph(sub) => {
                                let is_cluster =
                                    sub.id.as_deref().is_some_and(|s| s.starts_with("cluster"));
                                let next_cluster = if is_cluster {
                                    sub.id.as_deref()
                                } else {
                                    cluster
                                };
                                let (nested_ids, nested_attrs) = walk(
                                    &sub.statements,
                                    &scope,
                                    next_cluster,
                                    directed,
                                    strict,
                                    nodes,
                                    edges,
                                    strict_edges,
                                    clusters,
                                    ranks,
                                );
                                for id in &nested_ids {
                                    add_id(&mut ids, id);
                                }
                                if is_cluster {
                                    clusters.push(GvModelCluster {
                                        id: sub.id.clone().unwrap_or_default(),
                                        attributes: nested_attrs.clone(),
                                        nodes: nested_ids.clone(),
                                        parent: cluster.map(|s| s.to_string()),
                                    });
                                }
                                if let Some(rk) = nested_attrs.get("rank") {
                                    ranks.push(GvRankGroup {
                                        rank: rk.to_string(),
                                        nodes: nested_ids.clone(),
                                    });
                                }
                                resolved_eps.push(
                                    nested_ids
                                        .into_iter()
                                        .map(|id| GvNodeRef {
                                            id,
                                            port: None,
                                            compass: None,
                                        })
                                        .collect(),
                                );
                            }
                        }
                    }
                    for i in 1..resolved_eps.len() {
                        for tail in &resolved_eps[i - 1] {
                            for head in &resolved_eps[i] {
                                let key = if directed || tail.id <= head.id {
                                    (tail.id.clone(), head.id.clone())
                                } else {
                                    (head.id.clone(), tail.id.clone())
                                };
                                if strict
                                    && let Some((_, idx)) =
                                        strict_edges.iter().find(|(k, _)| *k == key)
                                {
                                    edges[*idx].attributes.extend_from(attributes);
                                    continue;
                                }
                                let mut ea = scope.edge.clone();
                                ea.extend_from(attributes);
                                let idx = edges.len();
                                edges.push(GvModelEdge {
                                    tail: tail.clone(),
                                    head: head.clone(),
                                    attributes: ea,
                                });
                                if strict {
                                    strict_edges.push((key, idx));
                                }
                            }
                        }
                    }
                }
            }
        }
        (ids, scope.graph)
    }

    let (_, root_attrs) = walk(
        &graph.statements,
        &GvScope::default(),
        None,
        graph.directed,
        graph.strict,
        &mut nodes,
        &mut edges,
        &mut strict_edges,
        &mut clusters,
        &mut ranks,
    );
    GvGraphModel {
        attributes: root_attrs,
        nodes,
        edges,
        clusters,
        ranks,
    }
}

fn gv_text_width(text: &str, size: f64, font: Option<&str>) -> f64 {
    let font_lc = font.unwrap_or("Times-Roman").to_ascii_lowercase();
    let mono = font_lc.contains("mono") || font_lc.contains("courier");
    let sans = font_lc.contains("arial") || font_lc.contains("helvetica");
    let mut width = 0.0f64;
    for c in text.chars() {
        let advance = if mono {
            0.6
        } else if " ilI.,'!:;|".contains(c) {
            0.278
        } else if "mwMW@%&".contains(c) {
            if c == 'W' || c == 'M' { 0.944 } else { 0.778 }
        } else if c.is_ascii_uppercase() {
            0.667
        } else if (c as u32) >= 0x2e80 {
            1.0
        } else if "frt()[]".contains(c) {
            0.333
        } else if sans {
            0.556
        } else {
            0.5
        };
        width += advance * size;
    }
    width
}

fn gv_numeric(value: Option<&str>, fallback: f64, min: f64) -> f64 {
    let Some(v) = value else {
        return fallback;
    };
    let trimmed = v.trim();
    if trimmed.is_empty() {
        return fallback;
    }
    match trimmed.parse::<f64>() {
        Ok(n) if n.is_finite() && n >= min => n,
        _ => fallback,
    }
}

fn gv_pair(value: Option<&str>, fallback: f64) -> (f64, f64) {
    if let Some(v) = value {
        let mut parts = v.split(',');
        let p0 = parts.next();
        let p1 = parts.next();
        let x = gv_numeric(p0, fallback, 0.0);
        let y = gv_numeric(p1, x, 0.0);
        (x, y)
    } else {
        (fallback, fallback)
    }
}

fn gv_decode_entities(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut result = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '&' {
            result.push(chars[i]);
            i += 1;
            continue;
        }
        let mut end = None;
        for j in (i + 1)..chars.len() {
            if chars[j] == ';' {
                end = Some(j);
                break;
            }
        }
        let Some(end_idx) = end else {
            result.push('&');
            i += 1;
            continue;
        };
        let name: String = chars[i + 1..end_idx].iter().collect();
        let value: Option<String> = match name.as_str() {
            "amp" => Some("&".to_string()),
            "lt" => Some("<".to_string()),
            "gt" => Some(">".to_string()),
            "quot" => Some("\"".to_string()),
            "apos" => Some("'".to_string()),
            "nbsp" => Some(" ".to_string()),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16)
                .ok()
                .filter(|&n| n > 0 && n <= 0x10ffff)
                .and_then(char::from_u32)
                .map(|c| c.to_string()),
            _ if name.starts_with('#') => name[1..]
                .parse::<u32>()
                .ok()
                .filter(|&n| n > 0 && n <= 0x10ffff)
                .and_then(char::from_u32)
                .map(|c| c.to_string()),
            _ => None,
        };
        if let Some(v) = value {
            result.push_str(&v);
            i = end_idx + 1;
        } else {
            result.push('&');
            i += 1;
        }
    }
    result
}

fn gv_label_lines(label: &str, id: &str) -> Vec<String> {
    if label.starts_with('<') && label.ends_with('>') && label.len() >= 2 {
        let chars: Vec<char> = label.chars().collect();
        let mut text = String::new();
        let mut i = 1usize;
        while i + 1 < chars.len() {
            if chars[i] == '<' {
                let mut end = None;
                for j in (i + 1)..chars.len() {
                    if chars[j] == '>' {
                        end = Some(j);
                        break;
                    }
                }
                let Some(end_idx) = end else {
                    break;
                };
                let tag: String = chars[i + 1..end_idx]
                    .iter()
                    .collect::<String>()
                    .to_ascii_lowercase();
                let tag_trimmed = tag.trim();
                if tag_trimmed.starts_with("br") || tag_trimmed == "/tr" {
                    text.push('\n');
                } else if tag_trimmed == "/td" {
                    text.push(' ');
                }
                i = end_idx + 1;
            } else {
                text.push(chars[i]);
                i += 1;
            }
        }
        return gv_decode_entities(&text)
            .trim()
            .split('\n')
            .map(|s| s.to_string())
            .collect();
    }
    label
        .replace("\\N", id)
        .replace("\\n", "\n")
        .replace("\\l", "\n")
        .replace("\\r", "\n")
        .split('\n')
        .map(|s| s.to_string())
        .collect()
}

#[derive(Clone, Debug)]
struct GvRecordField {
    label: String,
    port: Option<String>,
    children: Option<Vec<GvRecordField>>,
}

fn gv_record_fields(label: &str) -> Vec<GvRecordField> {
    let chars: Vec<char> = label.chars().collect();
    let mut i = 0usize;
    fn parse(chars: &[char], i: &mut usize) -> Vec<GvRecordField> {
        let mut fields: Vec<GvRecordField> = Vec::new();
        let mut text = String::new();
        let mut port: Option<String> = None;
        let flush = |fields: &mut Vec<GvRecordField>, text: &mut String, port: &mut Option<String>| {
            fields.push(GvRecordField {
                label: text.trim().to_string(),
                port: port.take(),
                children: None,
            });
            text.clear();
        };
        while *i < chars.len() {
            let c = chars[*i];
            *i += 1;
            if c == '\\' && *i < chars.len() {
                text.push(chars[*i]);
                *i += 1;
            } else if c == '{' {
                if !text.is_empty() || port.is_some() {
                    flush(&mut fields, &mut text, &mut port);
                }
                let children = parse(chars, i);
                fields.push(GvRecordField {
                    label: String::new(),
                    port: None,
                    children: Some(children),
                });
            } else if c == '}' {
                if !text.is_empty() || port.is_some() || fields.is_empty() {
                    flush(&mut fields, &mut text, &mut port);
                }
                return fields;
            } else if c == '|' {
                if !text.is_empty() || port.is_some() || fields.is_empty() {
                    flush(&mut fields, &mut text, &mut port);
                }
            } else if c == '<' {
                let mut end = None;
                for j in *i..chars.len() {
                    if chars[j] == '>' {
                        end = Some(j);
                        break;
                    }
                }
                if let Some(end_idx) = end {
                    port = Some(chars[*i..end_idx].iter().collect());
                    *i = end_idx + 1;
                } else {
                    text.push(c);
                }
            } else {
                text.push(c);
            }
        }
        if !text.is_empty() || port.is_some() || fields.is_empty() {
            flush(&mut fields, &mut text, &mut port);
        }
        fields
    }
    parse(&chars, &mut i)
}

fn gv_node_size(id: &str, attributes: &GvAttrs) -> (f64, f64) {
    let size = gv_numeric(attributes.get("fontsize"), 14.0, 1.0);
    let shape = attributes.get("shape").unwrap_or("ellipse");
    let raw_label = attributes.get("label").unwrap_or(id);
    let mut lines = gv_label_lines(raw_label, id);
    if shape == "record" || shape == "Mrecord" {
        fn flatten(fields: &[GvRecordField], out: &mut Vec<String>) {
            for f in fields {
                if let Some(ref ch) = f.children {
                    flatten(ch, out);
                } else {
                    out.push(f.label.clone());
                }
            }
        }
        let mut flat = Vec::new();
        flatten(&gv_record_fields(raw_label), &mut flat);
        lines = vec![flat.join("   ")];
    }
    let (mx, my) = gv_pair(attributes.get("margin"), 0.11);
    let max_line_w = lines
        .iter()
        .map(|l| gv_text_width(l, size, attributes.get("fontname")))
        .fold(0.0f64, f64::max);
    let mut width = max_line_w + mx * 144.0;
    let mut height = (lines.len() as f64) * size * 1.2 + my * 144.0;
    if shape == "ellipse" || shape == "oval" || shape == "diamond" {
        width *= std::f64::consts::SQRT_2;
        height *= std::f64::consts::SQRT_2;
    }
    let default_w = if shape == "plaintext" || shape == "none" { 0.0 } else { 0.75 };
    let default_h = if shape == "plaintext" || shape == "none" { 0.0 } else { 0.5 };
    width = width.max(gv_numeric(attributes.get("width"), default_w, 0.0) * 72.0);
    height = height.max(gv_numeric(attributes.get("height"), default_h, 0.0) * 72.0);
    if attributes.get("fixedsize") == Some("true") {
        width = gv_numeric(attributes.get("width"), 0.75, 0.0) * 72.0;
        height = gv_numeric(attributes.get("height"), 0.5, 0.0) * 72.0;
    }
    if shape == "circle" || shape == "doublecircle" {
        let m = width.max(height);
        width = m;
        height = m;
    }
    (width.max(1.0), height.max(1.0))
}

#[derive(Clone, Debug)]
struct GvArc {
    from: usize,
    to: usize,
    minlen: i32,
    weight: f64,
}

#[derive(Clone, Debug)]
struct GvVertex {
    rank: usize,
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    order: usize,
}

fn gv_feedback_order(count: usize, arcs: &[GvArc]) -> Vec<usize> {
    let mut remaining: Vec<usize> = (0..count).collect();
    let mut left: Vec<usize> = Vec::new();
    let mut right: Vec<usize> = Vec::new();
    let mut incoming: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut outgoing: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (idx, arc) in arcs.iter().enumerate() {
        if arc.from != arc.to {
            incoming[arc.to].push(idx);
            outgoing[arc.from].push(idx);
        }
    }
    while !remaining.is_empty() {
        let mut chosen = remaining[0];
        let mut best = f64::NEG_INFINITY;
        for &v in &remaining {
            let has_out = outgoing[v]
                .iter()
                .any(|&ei| remaining.contains(&arcs[ei].to));
            if !has_out {
                right.push(v);
                chosen = v;
                break;
            }
            let has_in = incoming[v]
                .iter()
                .any(|&ei| remaining.contains(&arcs[ei].from));
            if !has_in {
                left.push(v);
                chosen = v;
                break;
            }
            let out_w: f64 = outgoing[v]
                .iter()
                .filter(|&&ei| remaining.contains(&arcs[ei].to))
                .map(|&ei| arcs[ei].weight)
                .sum();
            let in_w: f64 = incoming[v]
                .iter()
                .filter(|&&ei| remaining.contains(&arcs[ei].from))
                .map(|&ei| arcs[ei].weight)
                .sum();
            let score = out_w - in_w;
            if score > best {
                chosen = v;
                best = score;
            }
        }
        if left.last().copied() != Some(chosen) && right.last().copied() != Some(chosen) {
            left.push(chosen);
        }
        remaining.retain(|&x| x != chosen);
    }
    right.reverse();
    left.extend(right);
    left
}

fn gv_assign_ranks(count: usize, arcs: &[GvArc], order: &[usize]) -> Vec<usize> {
    let mut rank: Vec<i32> = vec![0; count];
    let mut outgoing: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (idx, arc) in arcs.iter().enumerate() {
        outgoing[arc.from].push(idx);
    }
    for &v in order {
        for &ei in &outgoing[v] {
            let e = &arcs[ei];
            if rank[v] + e.minlen > rank[e.to] {
                rank[e.to] = rank[v] + e.minlen;
            }
        }
    }
    let slack = |rank: &[i32], e: &GvArc| -> i32 { rank[e.to] - rank[e.from] - e.minlen };
    let mut tree: Vec<usize> = Vec::new();
    let mut connected: Vec<bool> = vec![false; count];
    for seed in 0..count {
        if connected[seed] {
            continue;
        }
        let mut component: Vec<usize> = vec![seed];
        loop {
            let mut boundary: Option<usize> = None;
            let mut least = i32::MAX;
            for (ei, e) in arcs.iter().enumerate() {
                let in_from = component.contains(&e.from);
                let in_to = component.contains(&e.to);
                if in_from != in_to && !connected[e.from] && !connected[e.to] {
                    let s = slack(&rank, e);
                    if s < least {
                        least = s;
                        boundary = Some(ei);
                    }
                }
            }
            let Some(bi) = boundary else {
                break;
            };
            let b = &arcs[bi];
            let shift = if component.contains(&b.from) { least } else { -least };
            for &v in &component {
                rank[v] += shift;
            }
            if !tree.contains(&bi) {
                tree.push(bi);
            }
            if !component.contains(&b.from) {
                component.push(b.from);
            }
            if !component.contains(&b.to) {
                component.push(b.to);
            }
        }
        for v in component {
            connected[v] = true;
        }
    }
    let limit = 32usize.max(count * arcs.len().max(1) * 4);
    for _ in 0..limit {
        let mut changed = false;
        let tree_snapshot = tree.clone();
        for leaving in tree_snapshot {
            let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); count];
            for &ei in &tree {
                if ei != leaving {
                    adjacency[arcs[ei].from].push(arcs[ei].to);
                    adjacency[arcs[ei].to].push(arcs[ei].from);
                }
            }
            let mut side: Vec<bool> = vec![false; count];
            let mut queue: Vec<usize> = vec![arcs[leaving].to];
            side[arcs[leaving].to] = true;
            let mut qi = 0usize;
            while qi < queue.len() {
                let cur = queue[qi];
                qi += 1;
                for &nxt in &adjacency[cur] {
                    if !side[nxt] {
                        side[nxt] = true;
                        queue.push(nxt);
                    }
                }
            }
            let mut cut = 0.0f64;
            for e in arcs {
                if side[e.from] != side[e.to] {
                    cut += if side[e.to] { e.weight } else { -e.weight };
                }
            }
            if cut >= -1e-9 {
                continue;
            }
            let mut entering: Option<usize> = None;
            let mut delta = i32::MAX;
            for (ei, e) in arcs.iter().enumerate() {
                if side[e.from] && !side[e.to] {
                    let s = slack(&rank, e);
                    if s < delta {
                        delta = s;
                        entering = Some(ei);
                    }
                }
            }
            let Some(ent) = entering else {
                continue;
            };
            if delta <= 0 {
                continue;
            }
            for v in 0..count {
                if side[v] {
                    rank[v] += delta;
                }
            }
            tree.retain(|&x| x != leaving);
            if !tree.contains(&ent) {
                tree.push(ent);
            }
            changed = true;
            break;
        }
        if !changed {
            break;
        }
    }
    let min_r = rank.iter().copied().min().unwrap_or(0).min(0);
    rank.into_iter().map(|r| (r - min_r) as usize).collect()
}

fn gv_crossings(layers: &[Vec<usize>], arcs: &[GvArc], vertices: &[GvVertex]) -> usize {
    let mut count = 0usize;
    if layers.len() < 2 {
        return 0;
    }
    for r in 0..(layers.len() - 1) {
        let between: Vec<&GvArc> = arcs
            .iter()
            .filter(|e| vertices[e.from].rank == r && vertices[e.to].rank == r + 1)
            .collect();
        for i in 0..between.len() {
            for j in (i + 1)..between.len() {
                let a = between[i];
                let b = between[j];
                let df = (vertices[a.from].order as isize) - (vertices[b.from].order as isize);
                let dt = (vertices[a.to].order as isize) - (vertices[b.to].order as isize);
                if df * dt < 0 {
                    count += 1;
                }
            }
        }
    }
    count
}

fn gv_median(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let m = values.len() / 2;
    if values.len() % 2 == 1 {
        values[m]
    } else {
        (values[m - 1] + values[m]) / 2.0
    }
}

fn gv_minimize_crossings(layers: &mut Vec<Vec<usize>>, vertices: &mut [GvVertex], arcs: &[GvArc]) {
    let update = |layers: &[Vec<usize>], vertices: &mut [GvVertex]| {
        for layer in layers {
            for (i, &v) in layer.iter().enumerate() {
                vertices[v].order = i;
            }
        }
    };
    update(layers, vertices);
    let mut best = layers.clone();
    let mut best_count = gv_crossings(layers, arcs, vertices);
    let mut incoming: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
    let mut outgoing: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
    for e in arcs {
        incoming[e.to].push(e.from);
        outgoing[e.from].push(e.to);
    }
    for pass in 0..12usize {
        let down = pass % 2 == 0;
        for step in 1..layers.len() {
            let r = if down { step } else { layers.len() - 1 - step };
            let mut scores: Vec<(usize, f64, usize)> = Vec::with_capacity(layers[r].len());
            for &v in &layers[r] {
                let neighbors: Vec<f64> = (if down { &incoming[v] } else { &outgoing[v] })
                    .iter()
                    .map(|&n| vertices[n].order as f64)
                    .collect();
                let score = if !neighbors.is_empty() {
                    if pass % 4 < 2 {
                        neighbors.iter().sum::<f64>() / (neighbors.len() as f64)
                    } else {
                        gv_median(neighbors)
                    }
                } else {
                    vertices[v].order as f64
                };
                scores.push((v, score, vertices[v].order));
            }
            scores.sort_by(|a, b| {
                a.1.partial_cmp(&b.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.2.cmp(&b.2))
            });
            layers[r] = scores.into_iter().map(|(v, _, _)| v).collect();
            update(layers, vertices);
        }
        for _sweep in 0..4 {
            let mut improved = false;
            for r in 0..layers.len() {
                for i in 1..layers[r].len() {
                    let before = gv_crossings(layers, arcs, vertices);
                    layers[r].swap(i - 1, i);
                    update(layers, vertices);
                    if gv_crossings(layers, arcs, vertices) < before {
                        improved = true;
                    } else {
                        layers[r].swap(i - 1, i);
                        update(layers, vertices);
                    }
                }
            }
            if !improved {
                break;
            }
        }
        let count = gv_crossings(layers, arcs, vertices);
        if count < best_count {
            best_count = count;
            best = layers.clone();
        }
    }
    *layers = best;
    update(layers, vertices);
}

fn gv_assign_coordinates(
    layers: &[Vec<usize>],
    vertices: &mut [GvVertex],
    arcs: &[GvArc],
    nodesep: f64,
    ranksep: f64,
) {
    let mut candidates: Vec<Vec<f64>> = Vec::new();
    for down in [true, false] {
        for right in [false, true] {
            let mut rows: Vec<Vec<usize>> = layers
                .iter()
                .map(|layer| {
                    let mut l = layer.clone();
                    if right {
                        l.reverse();
                    }
                    l
                })
                .collect();
            if !down {
                rows.reverse();
            }
            let mut root: Vec<usize> = (0..vertices.len()).collect();
            let mut align: Vec<usize> = root.clone();
            let mut neighbors: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
            for e in arcs {
                let k = if down { e.to } else { e.from };
                let v = if down { e.from } else { e.to };
                neighbors[k].push(v);
            }
            let mut positions: Vec<usize> = vec![0; vertices.len()];
            for row in &rows {
                for (i, &v) in row.iter().enumerate() {
                    positions[v] = i;
                }
            }
            let mut blocked: Vec<(usize, usize)> = Vec::new();
            for a in arcs {
                for b in arcs {
                    if vertices[a.from].rank != vertices[b.from].rank {
                        continue;
                    }
                    if vertices[b.from].width != 0.0 || vertices[b.to].width != 0.0 {
                        continue;
                    }
                    let df = (positions[a.from] as isize) - (positions[b.from] as isize);
                    let dt = (positions[a.to] as isize) - (positions[b.to] as isize);
                    if df * dt < 0 && !blocked.contains(&(a.from, a.to)) {
                        blocked.push((a.from, a.to));
                    }
                }
            }
            for r in 1..rows.len() {
                let mut previous: isize = -1;
                for &v in &rows[r] {
                    let mut ns = neighbors[v].clone();
                    ns.sort_by_key(|&a| positions[a]);
                    if ns.is_empty() {
                        continue;
                    }
                    let m1 = (ns.len() - 1) / 2;
                    let m2 = ns.len() / 2;
                    for m in [m1, m2] {
                        let Some(&u) = ns.get(m) else {
                            continue;
                        };
                        let key = if down { (u, v) } else { (v, u) };
                        if align[v] == v
                            && (positions[u] as isize) > previous
                            && !blocked.contains(&key)
                        {
                            align[u] = v;
                            root[v] = root[u];
                            align[v] = root[v];
                            previous = positions[u] as isize;
                        }
                    }
                }
            }
            let mut roots: Vec<usize> = Vec::new();
            for &r in &root {
                if !roots.contains(&r) {
                    roots.push(r);
                }
            }
            let mut x: Vec<f64> = vec![0.0; vertices.len()];
            let mut constraints: Vec<(usize, usize, f64)> = Vec::new();
            for row in &rows {
                for i in 1..row.len() {
                    let a = row[i - 1];
                    let b = row[i];
                    if root[a] != root[b] {
                        constraints.push((
                            root[a],
                            root[b],
                            (vertices[a].width + vertices[b].width) / 2.0 + nodesep,
                        ));
                    }
                }
            }
            for _ in 0..roots.len() {
                for &(from, to, gap) in &constraints {
                    if x[from] + gap > x[to] {
                        x[to] = x[from] + gap;
                    }
                }
            }
            let coords: Vec<f64> = (0..vertices.len())
                .map(|v| (if right { -1.0 } else { 1.0 }) * x[root[v]])
                .collect();
            let min_c = coords.iter().copied().fold(0.0f64, f64::min);
            candidates.push(coords.into_iter().map(|val| val - min_c).collect());
        }
    }
    let extents: Vec<f64> = candidates
        .iter()
        .map(|vals| {
            let max_v = vals.iter().copied().fold(0.0f64, f64::max);
            let min_v = vals.iter().copied().fold(0.0f64, f64::min);
            max_v - min_v
        })
        .collect();
    let mut min_ext = f64::INFINITY;
    let mut reference = 0usize;
    for (idx, &ext) in extents.iter().enumerate() {
        if ext < min_ext {
            min_ext = ext;
            reference = idx;
        }
    }
    let target = candidates[reference].clone();
    let target_min = target.iter().copied().fold(0.0f64, f64::min);
    let target_max = target.iter().copied().fold(0.0f64, f64::max);
    for vals in &mut candidates {
        let v_min = vals.iter().copied().fold(0.0f64, f64::min);
        let v_max = vals.iter().copied().fold(0.0f64, f64::max);
        let delta = (target_min + target_max - v_min - v_max) / 2.0;
        for val in vals.iter_mut() {
            *val += delta;
        }
    }
    for v in 0..vertices.len() {
        let col: Vec<f64> = candidates.iter().map(|vals| vals[v]).collect();
        vertices[v].x = gv_median(col);
    }
    for layer in layers {
        for i in 1..layer.len() {
            let a_idx = layer[i - 1];
            let b_idx = layer[i];
            let min_bx =
                vertices[a_idx].x + (vertices[a_idx].width + vertices[b_idx].width) / 2.0 + nodesep;
            if min_bx > vertices[b_idx].x {
                vertices[b_idx].x = min_bx;
            }
        }
    }
    let mut y = 0.0f64;
    let mut previous_height = 0.0f64;
    for layer in layers {
        let height = layer
            .iter()
            .map(|&v| vertices[v].height)
            .fold(0.0f64, f64::max);
        y += previous_height / 2.0 + height / 2.0 + if y != 0.0 { ranksep } else { 0.0 };
        for &v in layer {
            vertices[v].y = y;
        }
        previous_height = height;
    }
}

#[derive(Clone, Copy, Debug)]
struct GvPoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug)]
struct GvLayoutNode {
    id: String,
    attributes: GvAttrs,
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    rank: usize,
    ports: Vec<(String, GvPoint)>,
}

#[derive(Clone, Debug)]
struct GvLayoutEdge {
    tail: GvNodeRef,
    head: GvNodeRef,
    attributes: GvAttrs,
    reversed: bool,
    points: Vec<GvPoint>,
    path: String,
    label: GvPoint,
}

#[derive(Clone, Debug)]
struct GvLayoutCluster {
    id: String,
    parent: Option<String>,
    attributes: GvAttrs,
    nodes: Vec<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug)]
struct GvGraphLayout {
    id: Option<String>,
    directed: bool,
    strict: bool,
    attributes: GvAttrs,
    width: f64,
    height: f64,
    nodes: Vec<GvLayoutNode>,
    edges: Vec<GvLayoutEdge>,
    clusters: Vec<GvLayoutCluster>,
}

#[derive(Clone, Default, Debug)]
struct GvLayoutOptions {
    graph: GvAttrs,
    node: GvAttrs,
    edge: GvAttrs,
}

fn gv_fmt(n: f64) -> String {
    let r = js_math_round(n * 1000.0) / 1000.0;
    if r == 0.0 {
        "0".to_string()
    } else {
        format!("{r}")
    }
}

fn gv_xy(p: GvPoint) -> String {
    format!("{},{}", gv_fmt(p.x), gv_fmt(p.y))
}

fn gv_spline_path(points: &[GvPoint]) -> String {
    if points.len() < 2 {
        return String::new();
    }
    if points.len() == 2 {
        let a = points[0];
        let b = points[1];
        let mid_y = (a.y + b.y) / 2.0;
        return format!(
            "M{}C{} {} {}",
            gv_xy(a),
            gv_xy(GvPoint { x: a.x, y: mid_y }),
            gv_xy(GvPoint { x: b.x, y: mid_y }),
            gv_xy(b)
        );
    }
    let mut p: Vec<GvPoint> = Vec::with_capacity(points.len() + 4);
    p.push(points[0]);
    p.push(points[0]);
    p.extend_from_slice(points);
    let last = *points.last().unwrap();
    p.push(last);
    p.push(last);
    let mut result = format!("M{}", gv_xy(points[0]));
    let mut i = 0usize;
    while i + 3 < p.len() {
        let b = p[i + 1];
        let c = p[i + 2];
        let d = p[i + 3];
        let c1 = GvPoint {
            x: (2.0 * b.x + c.x) / 3.0,
            y: (2.0 * b.y + c.y) / 3.0,
        };
        let c2 = GvPoint {
            x: (b.x + 2.0 * c.x) / 3.0,
            y: (b.y + 2.0 * c.y) / 3.0,
        };
        let end = GvPoint {
            x: (b.x + 4.0 * c.x + d.x) / 6.0,
            y: (b.y + 4.0 * c.y + d.y) / 6.0,
        };
        if i > 0 {
            result.push_str(&format!("C{} {} {}", gv_xy(c1), gv_xy(c2), gv_xy(end)));
        }
        i += 1;
    }
    result
}

fn gv_boundary(node: &GvLayoutNode, toward: GvPoint, r: &GvNodeRef) -> GvPoint {
    let center = if let Some(ref port_name) = r.port
        && let Some((_, pt)) = node.ports.iter().find(|(k, _)| k == port_name)
    {
        *pt
    } else {
        GvPoint {
            x: node.x,
            y: node.y,
        }
    };
    let mut dx = toward.x - center.x;
    let mut dy = toward.y - center.y;
    if r.compass.as_deref() == Some("c") {
        return center;
    }
    if let Some(ref comp) = r.compass {
        let dir = match comp.as_str() {
            "n" => Some((0.0, -1.0)),
            "ne" => Some((1.0, -1.0)),
            "e" => Some((1.0, 0.0)),
            "se" => Some((1.0, 1.0)),
            "s" => Some((0.0, 1.0)),
            "sw" => Some((-1.0, 1.0)),
            "w" => Some((-1.0, 0.0)),
            "nw" => Some((-1.0, -1.0)),
            _ => None,
        };
        if let Some((ddx, ddy)) = dir {
            dx = ddx;
            dy = ddy;
        }
    }
    if dx == 0.0 && dy == 0.0 {
        dy = 1.0;
    }
    let rx = node.width / 2.0;
    let ry = node.height / 2.0;
    let shape = node.attributes.get("shape").unwrap_or("ellipse");
    let scale = if matches!(shape, "ellipse" | "oval" | "circle" | "doublecircle") {
        1.0 / ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)).sqrt()
    } else if shape == "diamond" {
        1.0 / (dx.abs() / rx + dy.abs() / ry)
    } else {
        let sx = if dx != 0.0 { rx / dx.abs() } else { f64::INFINITY };
        let sy = if dy != 0.0 { ry / dy.abs() } else { f64::INFINITY };
        sx.min(sy)
    };
    if r.port.is_some() && r.compass.is_none() {
        return center;
    }
    GvPoint {
        x: center.x + dx * scale,
        y: center.y + dy * scale,
    }
}

fn gv_ports(node: &mut GvLayoutNode) {
    let shape = node.attributes.get("shape").unwrap_or("");
    if shape != "record" && shape != "Mrecord" {
        return;
    }
    fn walk(
        fields: &[GvRecordField],
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        horizontal: bool,
        ports: &mut Vec<(String, GvPoint)>,
    ) {
        let len = fields.len() as f64;
        for (i, field) in fields.iter().enumerate() {
            let width = if horizontal { w / len } else { w };
            let height = if horizontal { h } else { h / len };
            let left = x + if horizontal { (i as f64) * width } else { 0.0 };
            let top = y + if horizontal { 0.0 } else { (i as f64) * height };
            if let Some(ref port) = field.port {
                let pt = GvPoint {
                    x: left + width / 2.0,
                    y: top + height / 2.0,
                };
                if let Some((_, existing)) = ports.iter_mut().find(|(k, _)| k == port) {
                    *existing = pt;
                } else {
                    ports.push((port.clone(), pt));
                }
            }
            if let Some(ref children) = field.children {
                walk(children, left, top, width, height, !horizontal, ports);
            }
        }
    }
    let label = node
        .attributes
        .get("label")
        .unwrap_or(&node.id)
        .to_string();
    let fields = gv_record_fields(&label);
    walk(
        &fields,
        node.x - node.width / 2.0,
        node.y - node.height / 2.0,
        node.width,
        node.height,
        true,
        &mut node.ports,
    );
}

fn gv_layout_graph(graph: &GvDotGraph, options: &GvLayoutOptions) -> GvGraphLayout {
    let model = gv_resolve_graph(graph);
    let mut attributes = model.attributes.clone();
    attributes.extend_from(&options.graph);
    let rankdir = attributes.get("rankdir").unwrap_or("TB").to_string();
    let horizontal = rankdir == "LR" || rankdir == "RL";
    let mut nodes: Vec<GvLayoutNode> = model
        .nodes
        .iter()
        .map(|n| {
            let mut attrs = n.attributes.clone();
            attrs.extend_from(&options.node);
            let (width, height) = gv_node_size(&n.id, &attrs);
            GvLayoutNode {
                id: n.id.clone(),
                attributes: attrs,
                width,
                height,
                x: 0.0,
                y: 0.0,
                rank: 0,
                ports: Vec::new(),
            }
        })
        .collect();
    let node_ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let node_index = |id: &str| -> usize {
        node_ids.iter().position(|nid| nid == id).unwrap_or(0)
    };
    let mut parent: Vec<usize> = (0..nodes.len()).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for group in &model.ranks {
        if let Some(first_id) = group.nodes.first() {
            let first_idx = node_index(first_id);
            for id in group.nodes.iter().skip(1) {
                let idx = node_index(id);
                let r1 = find(&mut parent, idx);
                let r0 = find(&mut parent, first_idx);
                parent[r1] = r0;
            }
        }
    }
    let mut representatives: Vec<usize> = Vec::new();
    for i in 0..nodes.len() {
        let r = find(&mut parent, i);
        if !representatives.contains(&r) {
            representatives.push(r);
        }
    }
    let group_of: Vec<usize> = (0..nodes.len())
        .map(|i| {
            let r = find(&mut parent, i);
            representatives.iter().position(|&x| x == r).unwrap_or(0)
        })
        .collect();
    let edge_attributes: Vec<GvAttrs> = model
        .edges
        .iter()
        .map(|e| {
            let mut ea = e.attributes.clone();
            ea.extend_from(&options.edge);
            ea
        })
        .collect();
    let mut original_arcs: Vec<GvArc> = Vec::new();
    for (i, e) in model.edges.iter().enumerate() {
        let from = group_of[node_index(&e.tail.id)];
        let to = group_of[node_index(&e.head.id)];
        if from == to || edge_attributes[i].get("constraint") == Some("false") {
            continue;
        }
        let minlen = (js_math_round(gv_numeric(edge_attributes[i].get("minlen"), 1.0, 0.0)) as i32).max(1);
        let weight = gv_numeric(edge_attributes[i].get("weight"), 1.0, 0.0);
        original_arcs.push(GvArc {
            from,
            to,
            minlen,
            weight,
        });
    }
    let mut order = gv_feedback_order(representatives.len(), &original_arcs);
    let mut min_groups: Vec<usize> = Vec::new();
    let mut max_groups: Vec<usize> = Vec::new();
    for group in &model.ranks {
        if group.rank == "min" || group.rank == "source" {
            for id in &group.nodes {
                let g = group_of[node_index(id)];
                if !min_groups.contains(&g) {
                    min_groups.push(g);
                }
            }
        } else if group.rank == "max" || group.rank == "sink" {
            for id in &group.nodes {
                let g = group_of[node_index(id)];
                if !max_groups.contains(&g) {
                    max_groups.push(g);
                }
            }
        }
    }
    let mut new_order: Vec<usize> = Vec::with_capacity(order.len());
    for &v in &order {
        if min_groups.contains(&v) {
            new_order.push(v);
        }
    }
    for &v in &order {
        if !min_groups.contains(&v) && !max_groups.contains(&v) {
            new_order.push(v);
        }
    }
    for &v in &order {
        if !min_groups.contains(&v) && max_groups.contains(&v) {
            new_order.push(v);
        }
    }
    order = new_order;
    let mut ordinal: Vec<usize> = vec![0; representatives.len()];
    for (i, &v) in order.iter().enumerate() {
        ordinal[v] = i;
    }
    let mut arcs: Vec<GvArc> = original_arcs
        .iter()
        .map(|e| {
            if ordinal[e.from] < ordinal[e.to] {
                e.clone()
            } else {
                GvArc {
                    from: e.to,
                    to: e.from,
                    minlen: e.minlen,
                    weight: e.weight,
                }
            }
        })
        .collect();
    for &min_g in &min_groups {
        for v in 0..representatives.len() {
            if v != min_g && !min_groups.contains(&v) {
                arcs.push(GvArc {
                    from: min_g,
                    to: v,
                    minlen: 1,
                    weight: 0.0,
                });
            }
        }
    }
    for &max_g in &max_groups {
        for v in 0..representatives.len() {
            if v != max_g && !max_groups.contains(&v) {
                arcs.push(GvArc {
                    from: v,
                    to: max_g,
                    minlen: 1,
                    weight: 0.0,
                });
            }
        }
    }
    let ranks = gv_assign_ranks(representatives.len(), &arcs, &order);
    let mut vertices: Vec<GvVertex> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| GvVertex {
            rank: ranks.get(group_of[i]).copied().unwrap_or(0),
            width: if horizontal { n.height } else { n.width },
            height: if horizontal { n.width } else { n.height },
            x: 0.0,
            y: 0.0,
            order: 0,
        })
        .collect();
    let mut segments: Vec<GvArc> = Vec::new();
    let mut routes: Vec<Vec<usize>> = Vec::new();
    for (i, e) in model.edges.iter().enumerate() {
        let mut from = node_index(&e.tail.id);
        let mut to = node_index(&e.head.id);
        let reverse = vertices[from].rank > vertices[to].rank;
        if reverse {
            std::mem::swap(&mut from, &mut to);
        }
        let mut route = vec![from];
        let r_from = vertices[from].rank;
        let r_to = vertices[to].rank;
        if r_to > r_from + 1 {
            for rank in (r_from + 1)..r_to {
                route.push(vertices.len());
                vertices.push(GvVertex {
                    rank,
                    width: 0.0,
                    height: 0.0,
                    x: 0.0,
                    y: 0.0,
                    order: 0,
                });
            }
        }
        route.push(to);
        let weight = gv_numeric(edge_attributes[i].get("weight"), 1.0, 0.0);
        for j in 1..route.len() {
            let u = route[j - 1];
            let v = route[j];
            if vertices[u].rank != vertices[v].rank {
                segments.push(GvArc {
                    from: u,
                    to: v,
                    minlen: 1,
                    weight,
                });
            }
        }
        if reverse {
            route.reverse();
        }
        routes.push(route);
    }
    let max_rank = vertices.iter().map(|v| v.rank).max().unwrap_or(0);
    let mut layers: Vec<Vec<usize>> = vec![Vec::new(); max_rank + 1];
    for (i, v) in vertices.iter().enumerate() {
        layers[v.rank].push(i);
    }
    let mut cluster_of: Vec<(String, isize)> = Vec::new();
    for (ci, c) in model.clusters.iter().enumerate() {
        for id in &c.nodes {
            if let Some((_, existing)) = cluster_of.iter_mut().find(|(k, _)| k == id) {
                *existing = ci as isize;
            } else {
                cluster_of.push((id.clone(), ci as isize));
            }
        }
    }
    let get_cluster = |idx: usize, nodes: &[GvLayoutNode]| -> isize {
        let Some(node) = nodes.get(idx) else {
            return -1;
        };
        cluster_of
            .iter()
            .find(|(k, _)| k == &node.id)
            .map(|(_, c)| *c)
            .unwrap_or(-1)
    };
    for layer in &mut layers {
        layer.sort_by_key(|&a| get_cluster(a, &nodes));
    }
    gv_minimize_crossings(&mut layers, &mut vertices, &segments);
    let nodesep = gv_numeric(attributes.get("nodesep"), 0.25, 0.0) * 72.0;
    let ranksep_first = attributes
        .get("ranksep")
        .and_then(|s| s.split(' ').next());
    let ranksep = gv_numeric(ranksep_first, 0.5, 0.0) * 72.0;
    gv_assign_coordinates(&layers, &mut vertices, &segments, nodesep, ranksep);
    let max_y = vertices
        .iter()
        .map(|v| v.y)
        .fold(0.0f64, f64::max);
    let transform = |vx: f64, vy: f64| -> GvPoint {
        let y = if rankdir == "BT" || rankdir == "RL" {
            max_y - vy
        } else {
            vy
        };
        if horizontal {
            GvPoint { x: y, y: vx }
        } else {
            GvPoint { x: vx, y }
        }
    };
    for (i, n) in nodes.iter_mut().enumerate() {
        let pt = transform(vertices[i].x, vertices[i].y);
        n.x = pt.x;
        n.y = pt.y;
        n.rank = vertices[i].rank;
        gv_ports(n);
    }
    let mut clusters: Vec<GvLayoutCluster> = model
        .clusters
        .iter()
        .map(|c| {
            let members: Vec<&GvLayoutNode> = c
                .nodes
                .iter()
                .map(|id| &nodes[node_index(id)])
                .collect();
            let margin = gv_numeric(c.attributes.get("margin"), 8.0, 0.0);
            let x = (if !members.is_empty() {
                members
                    .iter()
                    .map(|n| n.x - n.width / 2.0)
                    .fold(f64::INFINITY, f64::min)
            } else {
                0.0
            }) - margin;
            let y = (if !members.is_empty() {
                members
                    .iter()
                    .map(|n| n.y - n.height / 2.0)
                    .fold(f64::INFINITY, f64::min)
            } else {
                0.0
            }) - margin
                - if c.attributes.get("label").is_some() {
                    24.0
                } else {
                    0.0
                };
            let right = members
                .iter()
                .map(|n| n.x + n.width / 2.0)
                .fold(x, f64::max)
                + margin;
            let bottom = members
                .iter()
                .map(|n| n.y + n.height / 2.0)
                .fold(y, f64::max)
                + margin;
            GvLayoutCluster {
                id: c.id.clone(),
                parent: c.parent.clone(),
                attributes: c.attributes.clone(),
                nodes: c.nodes.clone(),
                x,
                y,
                width: right - x,
                height: bottom - y,
            }
        })
        .collect();
    for ci in 0..clusters.len() {
        if let Some(ref parent_id) = clusters[ci].parent.clone()
            && let Some(pi) = clusters.iter().position(|item| &item.id == parent_id)
        {
            let cx = clusters[ci].x;
            let cy = clusters[ci].y;
            let cw = clusters[ci].width;
            let ch = clusters[ci].height;
            let right = (clusters[pi].x + clusters[pi].width).max(cx + cw + 8.0);
            let bottom = (clusters[pi].y + clusters[pi].height).max(cy + ch + 8.0);
            clusters[pi].x = clusters[pi].x.min(cx - 8.0);
            clusters[pi].y = clusters[pi].y.min(cy - 8.0);
            clusters[pi].width = right - clusters[pi].x;
            clusters[pi].height = bottom - clusters[pi].y;
        }
    }
    let splines = attributes.get("splines").unwrap_or("true").to_string();
    let mut parallels: Vec<((String, String), usize)> = Vec::new();
    let mut edges: Vec<GvLayoutEdge> = model
        .edges
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let tail_idx = node_index(&e.tail.id);
            let head_idx = node_index(&e.head.id);
            let tail = &nodes[tail_idx];
            let head = &nodes[head_idx];
            let mut points: Vec<GvPoint> = routes[i]
                .iter()
                .map(|&v| transform(vertices[v].x, vertices[v].y))
                .collect();
            let key = (e.tail.id.clone(), e.head.id.clone());
            let parallel = if let Some((_, cnt)) = parallels.iter_mut().find(|(k, _)| *k == key) {
                let cur = *cnt;
                *cnt += 1;
                cur
            } else {
                parallels.push((key, 1));
                0
            };
            if tail_idx == head_idx {
                let p_f = parallel as f64;
                points = vec![
                    GvPoint {
                        x: tail.x + tail.width / 2.0,
                        y: tail.y,
                    },
                    GvPoint {
                        x: tail.x + tail.width / 2.0 + 32.0 + p_f * 12.0,
                        y: tail.y - tail.height,
                    },
                    GvPoint {
                        x: tail.x + tail.width / 2.0 + 32.0 + p_f * 12.0,
                        y: tail.y + tail.height,
                    },
                    GvPoint {
                        x: tail.x + tail.width / 2.0,
                        y: tail.y + tail.height / 4.0,
                    },
                ];
            } else {
                if tail.rank == head.rank {
                    let offset = 30.0 + (parallel as f64) * 12.0;
                    points = vec![
                        GvPoint { x: tail.x, y: tail.y },
                        if horizontal {
                            GvPoint {
                                x: tail.x - tail.width / 2.0 - offset,
                                y: tail.y,
                            }
                        } else {
                            GvPoint {
                                x: tail.x,
                                y: tail.y - tail.height / 2.0 - offset,
                            }
                        },
                        if horizontal {
                            GvPoint {
                                x: head.x - head.width / 2.0 - offset,
                                y: head.y,
                            }
                        } else {
                            GvPoint {
                                x: head.x,
                                y: head.y - head.height / 2.0 - offset,
                            }
                        },
                        GvPoint { x: head.x, y: head.y },
                    ];
                } else if points.len() == 2 && parallel > 0 {
                    let p_f = parallel as f64;
                    points.insert(
                        1,
                        GvPoint {
                            x: (tail.x + head.x) / 2.0 + if horizontal { 0.0 } else { p_f * 16.0 },
                            y: (tail.y + head.y) / 2.0 + if horizontal { p_f * 16.0 } else { 0.0 },
                        },
                    );
                }
                let p1 = points[1];
                points[0] = gv_boundary(tail, p1, &e.tail);
                let p_prev = points[points.len() - 2];
                let last_idx = points.len() - 1;
                points[last_idx] = gv_boundary(head, p_prev, &e.head);
            }
            if splines == "line" || splines == "false" {
                points = vec![points[0], *points.last().unwrap()];
            }
            if splines == "ortho" {
                let mut orthogonal = vec![points[0]];
                for j in 1..points.len() {
                    let a = points[j - 1];
                    let b = points[j];
                    if horizontal {
                        let mx = (a.x + b.x) / 2.0;
                        orthogonal.push(GvPoint { x: mx, y: a.y });
                        orthogonal.push(GvPoint { x: mx, y: b.y });
                    } else {
                        let my = (a.y + b.y) / 2.0;
                        orthogonal.push(GvPoint { x: a.x, y: my });
                        orthogonal.push(GvPoint { x: b.x, y: my });
                    }
                    orthogonal.push(b);
                }
                points = orthogonal;
            }
            let label = points[points.len() / 2];
            GvLayoutEdge {
                tail: e.tail.clone(),
                head: e.head.clone(),
                attributes: edge_attributes[i].clone(),
                reversed: tail.rank > head.rank,
                points,
                path: String::new(),
                label,
            }
        })
        .collect();
    let (mx, my) = gv_pair(attributes.get("margin"), 0.0);
    let (px, py) = gv_pair(attributes.get("pad"), 0.0555);
    let mut all_pts: Vec<GvPoint> = Vec::new();
    for n in &nodes {
        all_pts.push(GvPoint {
            x: n.x - n.width / 2.0,
            y: n.y - n.height / 2.0,
        });
        all_pts.push(GvPoint {
            x: n.x + n.width / 2.0,
            y: n.y + n.height / 2.0,
        });
    }
    for c in &clusters {
        all_pts.push(GvPoint { x: c.x, y: c.y });
        all_pts.push(GvPoint {
            x: c.x + c.width,
            y: c.y + c.height,
        });
    }
    for e in &edges {
        all_pts.extend_from_slice(&e.points);
    }
    let min_x = all_pts.iter().map(|p| p.x).fold(0.0f64, f64::min);
    let min_y = all_pts.iter().map(|p| p.y).fold(0.0f64, f64::min);
    let max_x = all_pts.iter().map(|p| p.x).fold(0.0f64, f64::max);
    let max_extent_y = all_pts.iter().map(|p| p.y).fold(0.0f64, f64::max);
    let dx = (mx + px) * 72.0 - min_x;
    let dy = (my + py) * 72.0 - min_y;
    for n in &mut nodes {
        n.x += dx;
        n.y += dy;
        for (_, pt) in &mut n.ports {
            pt.x += dx;
            pt.y += dy;
        }
    }
    for c in &mut clusters {
        c.x += dx;
        c.y += dy;
    }
    for e in &mut edges {
        for pt in &mut e.points {
            pt.x += dx;
            pt.y += dy;
        }
        e.label.x += dx;
        e.label.y += dy;
        e.path = if splines == "none" || splines.is_empty() {
            String::new()
        } else if splines == "true" || splines == "spline" {
            gv_spline_path(&e.points)
        } else {
            e.points
                .iter()
                .enumerate()
                .map(|(idx, p)| format!("{}{}", if idx > 0 { "L" } else { "M" }, gv_xy(*p)))
                .collect::<Vec<_>>()
                .join("")
        };
    }
    let label_height = if attributes.get("label").is_some() {
        gv_numeric(attributes.get("fontsize"), 14.0, 0.0) * 1.2 + 12.0
    } else {
        0.0
    };
    GvGraphLayout {
        id: graph.id.clone(),
        directed: graph.directed,
        strict: graph.strict,
        attributes,
        width: (max_x - min_x + (mx + px) * 144.0).max(1.0),
        height: (max_extent_y - min_y + (my + py) * 144.0 + label_height).max(1.0),
        nodes,
        edges,
        clusters,
    }
}

fn gv_xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn gv_svg_style(a: &GvAttrs, filled: bool) -> String {
    let style_str = a.get("style").unwrap_or("");
    let fill_val = if filled || style_str.contains("filled") {
        a.get("fillcolor").unwrap_or("lightgrey")
    } else {
        "none"
    };
    let stroke_val = a.get("color").unwrap_or("black");
    let mut parts = vec![
        format!("fill=\"{}\"", gv_xml_escape(fill_val)),
        format!("stroke=\"{}\"", gv_xml_escape(stroke_val)),
    ];
    if let Some(pw) = a.get("penwidth") {
        parts.push(format!(
            "stroke-width=\"{}\"",
            gv_fmt(gv_numeric(Some(pw), 1.0, 0.0))
        ));
    }
    if style_str.contains("dashed") {
        parts.push("stroke-dasharray=\"5,3\"".to_string());
    }
    if style_str.contains("dotted") {
        parts.push("stroke-dasharray=\"1,3\"".to_string());
    }
    parts.join(" ")
}

fn gv_svg_text(label: &str, x: f64, y: f64, a: &GvAttrs, id: &str) -> String {
    let size = gv_numeric(a.get("fontsize"), 14.0, 1.0);
    let lines = gv_label_lines(label, id);
    let font_family = gv_xml_escape(a.get("fontname").unwrap_or("Times,serif"));
    let fill = gv_xml_escape(a.get("fontcolor").unwrap_or("black"));
    let n_lines = lines.len() as f64;
    lines
        .into_iter()
        .enumerate()
        .map(|(i, line)| {
            let ty = y + ((i as f64) - (n_lines - 1.0) / 2.0) * size * 1.2 + size * 0.35;
            format!(
                "<text text-anchor=\"middle\" x=\"{}\" y=\"{}\" font-family=\"{}\" font-size=\"{}\" fill=\"{}\">{}</text>",
                gv_fmt(x),
                gv_fmt(ty),
                font_family,
                gv_fmt(size),
                fill,
                gv_xml_escape(&line)
            )
        })
        .collect::<Vec<_>>()
        .join("")
}

fn gv_svg_shape(node: &GvLayoutNode) -> String {
    let x = node.x;
    let y = node.y;
    let w = node.width;
    let h = node.height;
    let a = &node.attributes;
    let s = a.get("shape").unwrap_or("ellipse");
    let left = x - w / 2.0;
    let top = y - h / 2.0;
    let right = x + w / 2.0;
    let bottom = y + h / 2.0;
    let st = gv_svg_style(a, false);
    let path = |d: &str| format!("<path {st} d=\"{d}\"/>");
    let polygon = |pts: &[GvPoint]| {
        let p_str = pts
            .iter()
            .map(|p| format!("{},{}", gv_fmt(p.x), gv_fmt(p.y)))
            .collect::<Vec<_>>()
            .join(" ");
        format!("<polygon {st} points=\"{p_str}\"/>")
    };
    let rect = |radius: f64| {
        let rx_attr = if radius != 0.0 {
            format!(" rx=\"{}\"", gv_fmt(radius))
        } else {
            String::new()
        };
        format!(
            "<rect {st} x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{rx_attr}/>",
            gv_fmt(left),
            gv_fmt(top),
            gv_fmt(w),
            gv_fmt(h)
        )
    };
    let ellipse = |rx: f64, ry: f64| {
        format!(
            "<ellipse {st} cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\"/>",
            gv_fmt(x),
            gv_fmt(y),
            gv_fmt(rx),
            gv_fmt(ry)
        )
    };
    if s == "plaintext" || s == "none" {
        return String::new();
    }
    if s == "ellipse" || s == "oval" || s == "circle" {
        return ellipse(w / 2.0, h / 2.0);
    }
    if s == "doublecircle" {
        return format!(
            "{}{}",
            ellipse(w / 2.0, h / 2.0),
            ellipse((w / 2.0 - 4.0).max(1.0), (h / 2.0 - 4.0).max(1.0))
        );
    }
    if s == "diamond" {
        return polygon(&[
            GvPoint { x, y: top },
            GvPoint { x: right, y },
            GvPoint { x, y: bottom },
            GvPoint { x: left, y },
        ]);
    }
    if s == "cylinder" {
        let arc = (h / 5.0).min(10.0);
        let d1 = format!(
            "M{},{}C{},{} {},{} {},{}L{},{}C{},{} {},{} {},{}Z",
            gv_fmt(left),
            gv_fmt(top + arc),
            gv_fmt(left),
            gv_fmt(top - arc / 3.0),
            gv_fmt(right),
            gv_fmt(top - arc / 3.0),
            gv_fmt(right),
            gv_fmt(top + arc),
            gv_fmt(right),
            gv_fmt(bottom - arc),
            gv_fmt(right),
            gv_fmt(bottom + arc / 3.0),
            gv_fmt(left),
            gv_fmt(bottom + arc / 3.0),
            gv_fmt(left),
            gv_fmt(bottom - arc)
        );
        let d2 = format!(
            "M{},{}C{},{} {},{} {},{}",
            gv_fmt(left),
            gv_fmt(top + arc),
            gv_fmt(left),
            gv_fmt(top + arc * 2.0),
            gv_fmt(right),
            gv_fmt(top + arc * 2.0),
            gv_fmt(right),
            gv_fmt(top + arc)
        );
        return format!("{}{}", path(&d1), path(&d2));
    }
    if s == "folder" || s == "tab" {
        return polygon(&[
            GvPoint { x: left, y: top + 8.0 },
            GvPoint { x: left, y: top },
            GvPoint {
                x: left + w * 0.35,
                y: top,
            },
            GvPoint {
                x: left + w * 0.35 + 8.0,
                y: top + 8.0,
            },
            GvPoint {
                x: right,
                y: top + 8.0,
            },
            GvPoint {
                x: right,
                y: bottom,
            },
            GvPoint { x: left, y: bottom },
        ]);
    }
    if s == "note" {
        let d = format!(
            "M{},{}L{},{}L{},{}",
            gv_fmt(right - 10.0),
            gv_fmt(top),
            gv_fmt(right - 10.0),
            gv_fmt(top + 10.0),
            gv_fmt(right),
            gv_fmt(top + 10.0)
        );
        return format!(
            "{}{}",
            polygon(&[
                GvPoint { x: left, y: top },
                GvPoint {
                    x: right - 10.0,
                    y: top
                },
                GvPoint {
                    x: right,
                    y: top + 10.0
                },
                GvPoint {
                    x: right,
                    y: bottom
                },
                GvPoint { x: left, y: bottom },
            ]),
            path(&d)
        );
    }
    if s == "component" {
        return format!(
            "{}<rect {st} x=\"{}\" y=\"{}\" width=\"8\" height=\"{}\"/><rect {st} x=\"{}\" y=\"{}\" width=\"8\" height=\"{}\"/>",
            rect(0.0),
            gv_fmt(left - 4.0),
            gv_fmt(top + h * 0.2),
            gv_fmt(h * 0.2),
            gv_fmt(left - 4.0),
            gv_fmt(top + h * 0.6),
            gv_fmt(h * 0.2)
        );
    }
    let rounded = s == "Mrecord"
        || a.get("style")
            .map(|st| st.contains("rounded"))
            .unwrap_or(false);
    rect(if rounded { 8.0 } else { 0.0 })
}

fn gv_svg_record(node: &GvLayoutNode) -> String {
    fn walk(
        fields: &[GvRecordField],
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        horizontal: bool,
        node: &GvLayoutNode,
    ) -> String {
        let len = fields.len() as f64;
        fields
            .iter()
            .enumerate()
            .map(|(i, field)| {
                let width = if horizontal { w / len } else { w };
                let height = if horizontal { h } else { h / len };
                let left = x + if horizontal { (i as f64) * width } else { 0.0 };
                let top = y + if horizontal { 0.0 } else { (i as f64) * height };
                let divider = if i > 0 {
                    let stroke = gv_xml_escape(node.attributes.get("color").unwrap_or("black"));
                    let ex = if horizontal { left } else { left + width };
                    let ey = if horizontal { top + height } else { top };
                    format!(
                        "<path fill=\"none\" stroke=\"{stroke}\" d=\"M{},{}L{},{}\"/>",
                        gv_fmt(left),
                        gv_fmt(top),
                        gv_fmt(ex),
                        gv_fmt(ey)
                    )
                } else {
                    String::new()
                };
                let body = if let Some(ref children) = field.children {
                    walk(children, left, top, width, height, !horizontal, node)
                } else {
                    gv_svg_text(
                        &field.label,
                        left + width / 2.0,
                        top + height / 2.0,
                        &node.attributes,
                        &node.id,
                    )
                };
                format!("{divider}{body}")
            })
            .collect::<Vec<_>>()
            .join("")
    }
    let raw_label = node.attributes.get("label").unwrap_or(&node.id);
    let fields = gv_record_fields(raw_label);
    walk(
        &fields,
        node.x - node.width / 2.0,
        node.y - node.height / 2.0,
        node.width,
        node.height,
        true,
        node,
    )
}

fn gv_svg_arrow(point: GvPoint, previous: GvPoint, attributes: &GvAttrs) -> String {
    let size = gv_numeric(attributes.get("arrowsize"), 1.0, 0.0) * 10.0;
    let mut dx = point.x - previous.x;
    let mut dy = point.y - previous.y;
    let mut length = dx.hypot(dy);
    if length == 0.0 {
        length = 1.0;
    }
    dx /= length;
    dy /= length;
    let base_x = point.x - size * dx;
    let base_y = point.y - size * dy;
    let color = gv_xml_escape(attributes.get("color").unwrap_or("black"));
    format!(
        "<polygon fill=\"{color}\" stroke=\"{color}\" points=\"{},{} {},{} {},{}\"/>",
        gv_fmt(point.x),
        gv_fmt(point.y),
        gv_fmt(base_x + dy * size * 0.4),
        gv_fmt(base_y - dx * size * 0.4),
        gv_fmt(base_x - dy * size * 0.4),
        gv_fmt(base_y + dx * size * 0.4)
    )
}

fn gv_render_svg(layout: &GvGraphLayout) -> String {
    let mut content: Vec<String> = vec![format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}pt\" height=\"{}pt\" viewBox=\"0 0 {} {}\"><g class=\"graph\"><title>{}</title>",
        gv_fmt(layout.width),
        gv_fmt(layout.height),
        gv_fmt(layout.width),
        gv_fmt(layout.height),
        gv_xml_escape(layout.id.as_deref().unwrap_or("G"))
    )];
    if let Some(bg) = layout.attributes.get("bgcolor") {
        content.push(format!(
            "<rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"{}\"/>",
            gv_fmt(layout.width),
            gv_fmt(layout.height),
            gv_xml_escape(bg)
        ));
    }
    for c in layout.clusters.iter().rev() {
        let lbl = if let Some(l) = c.attributes.get("label") {
            gv_svg_text(l, c.x + c.width / 2.0, c.y + 12.0, &c.attributes, "")
        } else {
            String::new()
        };
        content.push(format!(
            "<g class=\"cluster\"><title>{}</title><rect {} x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/>{lbl}</g>",
            gv_xml_escape(&c.id),
            gv_svg_style(&c.attributes, false),
            gv_fmt(c.x),
            gv_fmt(c.y),
            gv_fmt(c.width),
            gv_fmt(c.height)
        ));
    }
    for e in &layout.edges {
        if e.attributes
            .get("style")
            .map(|s| s.contains("invis"))
            .unwrap_or(false)
        {
            continue;
        }
        let op = if layout.directed { "-&gt;" } else { "--" };
        content.push(format!(
            "<g class=\"edge\"><title>{}{op}{}</title>",
            gv_xml_escape(&e.tail.id),
            gv_xml_escape(&e.head.id)
        ));
        if !e.path.is_empty() {
            let mut path_attrs = e.attributes.clone();
            path_attrs.set("fillcolor".to_string(), "none".to_string());
            content.push(format!(
                "<path {} d=\"{}\"/>",
                gv_svg_style(&path_attrs, false),
                e.path
            ));
            let dir = e.attributes.get("dir").unwrap_or("");
            let arrowhead = e.attributes.get("arrowhead").unwrap_or("");
            if ((layout.directed && dir != "none" && dir != "back")
                || dir == "both"
                || dir == "forward")
                && arrowhead != "none"
                && e.points.len() >= 2
            {
                content.push(gv_svg_arrow(
                    e.points[e.points.len() - 1],
                    e.points[e.points.len() - 2],
                    &e.attributes,
                ));
            }
            let arrowtail = e.attributes.get("arrowtail").unwrap_or("");
            if (dir == "back" || dir == "both") && arrowtail != "none" && e.points.len() >= 2 {
                content.push(gv_svg_arrow(e.points[0], e.points[1], &e.attributes));
            }
        }
        if let Some(lbl) = e.attributes.get("label") {
            content.push(gv_svg_text(
                lbl,
                e.label.x,
                e.label.y - 8.0,
                &e.attributes,
                "",
            ));
        }
        content.push("</g>".to_string());
    }
    for n in &layout.nodes {
        if n.attributes
            .get("style")
            .map(|s| s.contains("invis"))
            .unwrap_or(false)
        {
            continue;
        }
        let shape_str = gv_svg_shape(n);
        let shape_name = n.attributes.get("shape").unwrap_or("ellipse");
        let body = if shape_name == "record" || shape_name == "Mrecord" {
            gv_svg_record(n)
        } else {
            let lbl = n.attributes.get("label").unwrap_or(&n.id);
            gv_svg_text(lbl, n.x, n.y, &n.attributes, &n.id)
        };
        content.push(format!(
            "<g class=\"node\"><title>{}</title>{shape_str}{body}</g>",
            gv_xml_escape(&n.id)
        ));
    }
    if let Some(lbl) = layout.attributes.get("label") {
        content.push(gv_svg_text(
            lbl,
            layout.width / 2.0,
            layout.height - 12.0,
            &layout.attributes,
            "",
        ));
    }
    content.push("</g></svg>".to_string());
    content.join("")
}

fn gv_admit(graph: &GvDotGraph) -> Result<(), String> {
    let max_nodes = 256usize;
    let max_edges = 2048usize;
    let max_layout_cost = 100_000_000u128;
    let mut nodes: Vec<String> = Vec::new();
    let mut edges = 0usize;
    let mut minlen = 1usize;
    let mut count = 0usize;
    let mut extremal = false;
    fn add_unique(vec: &mut Vec<String>, id: &str) {
        if !vec.iter().any(|x| x == id) {
            vec.push(id.to_string());
        }
    }
    fn visit(
        statements: &[GvStatement],
        nodes: &mut Vec<String>,
        edges: &mut usize,
        minlen: &mut usize,
        count: &mut usize,
        extremal: &mut bool,
        max_nodes: usize,
        max_edges: usize,
    ) -> Result<Vec<String>, String> {
        let mut local: Vec<String> = Vec::new();
        for s in statements {
            *count += 1;
            let attrs_opt = match s {
                GvStatement::Attributes { attributes, .. } => Some(attributes),
                GvStatement::Node { attributes, .. } => Some(attributes),
                GvStatement::Edge { attributes, .. } => Some(attributes),
                GvStatement::Subgraph(_) => None,
            };
            if let Some(attrs) = attrs_opt {
                if let Some(ml) = attrs.get("minlen")
                    && let Ok(n) = ml.trim().parse::<f64>()
                    && n.is_finite()
                {
                    let r = js_math_round(n);
                    if r > (*minlen as f64) {
                        *minlen = r as usize;
                    }
                }
                if matches!(attrs.get("rank"), Some("min" | "max" | "source" | "sink")) {
                    *extremal = true;
                }
            }
            match s {
                GvStatement::Node { node, .. } => {
                    add_unique(nodes, &node.id);
                    add_unique(&mut local, &node.id);
                }
                GvStatement::Subgraph(sub) => {
                    let sub_ids = visit(
                        &sub.statements,
                        nodes,
                        edges,
                        minlen,
                        count,
                        extremal,
                        max_nodes,
                        max_edges,
                    )?;
                    for id in sub_ids {
                        add_unique(&mut local, &id);
                    }
                }
                GvStatement::Edge { endpoints, .. } => {
                    let mut previous = 0usize;
                    for end in endpoints {
                        let ids = match end {
                            GvEndpoint::Node(n) => vec![n.id.clone()],
                            GvEndpoint::Subgraph(sub) => visit(
                                &sub.statements,
                                nodes,
                                edges,
                                minlen,
                                count,
                                extremal,
                                max_nodes,
                                max_edges,
                            )?,
                        };
                        *edges += previous * ids.len();
                        previous = ids.len();
                        for id in &ids {
                            add_unique(nodes, id);
                            add_unique(&mut local, id);
                        }
                        if *edges > max_edges {
                            return Err("edge limit exceeded".to_string());
                        }
                    }
                }
                _ => {}
            }
            if nodes.len() > max_nodes {
                return Err("node limit exceeded".to_string());
            }
        }
        Ok(local)
    }
    visit(
        &graph.statements,
        &mut nodes,
        &mut edges,
        &mut minlen,
        &mut count,
        &mut extremal,
        max_nodes,
        max_edges,
    )?;
    let count_u = count as u128;
    let edges_u = edges as u128;
    let minlen_u = minlen as u128;
    let ext_u = if extremal { count_u * count_u } else { 0 };
    let expanded = count_u + (edges_u + ext_u) * count_u * minlen_u;
    let cost = expanded.saturating_mul(expanded);
    if cost > max_layout_cost {
        return Err("graph layout cost limit exceeded".to_string());
    }
    Ok(())
}

fn gv_spring(graph: &mut GvGraphLayout) {
    let n = graph.nodes.len();
    if n == 0 {
        return;
    }
    let radius = 72.0f64.max((n as f64) * 18.0);
    let mut positions: Vec<GvPoint> = (0..n)
        .map(|i| {
            let angle = (2.0 * std::f64::consts::PI * (i as f64)) / (n as f64);
            GvPoint {
                x: radius * angle.cos(),
                y: radius * angle.sin(),
            }
        })
        .collect();
    let node_index = |id: &str, nodes: &[GvLayoutNode]| -> usize {
        nodes.iter().position(|v| v.id == id).unwrap_or(0)
    };
    for iteration in 0..120usize {
        let mut force: Vec<GvPoint> = vec![GvPoint { x: 0.0, y: 0.0 }; n];
        for i in 0..n {
            for j in (i + 1)..n {
                let dx = positions[i].x - positions[j].x;
                let dy = positions[i].y - positions[j].y;
                let d = dx.hypot(dy).max(1.0);
                let f = 6400.0 / (d * d);
                force[i].x += dx * f;
                force[i].y += dy * f;
                force[j].x -= dx * f;
                force[j].y -= dy * f;
            }
        }
        for edge in &graph.edges {
            let a = node_index(&edge.tail.id, &graph.nodes);
            let b = node_index(&edge.head.id, &graph.nodes);
            if a == b {
                continue;
            }
            let dx = positions[b].x - positions[a].x;
            let dy = positions[b].y - positions[a].y;
            let d = dx.hypot(dy).max(1.0);
            let f = d / 80.0;
            force[a].x += dx * f;
            force[a].y += dy * f;
            force[b].x -= dx * f;
            force[b].y -= dy * f;
        }
        let temperature = 12.0 * (1.0 - (iteration as f64) / 120.0);
        for i in 0..n {
            let f = force[i];
            let length = f.x.hypot(f.y).max(1.0);
            let step = length.min(temperature);
            positions[i].x += (f.x / length) * step;
            positions[i].y += (f.y / length) * step;
        }
    }
    let mut expansion = 1.0f64;
    for i in 0..n {
        for j in (i + 1)..n {
            let dx = (positions[i].x - positions[j].x).abs();
            let dy = (positions[i].y - positions[j].y).abs();
            let rx = if dx != 0.0 {
                ((graph.nodes[i].width + graph.nodes[j].width) / 2.0 + 8.0) / dx
            } else {
                f64::INFINITY
            };
            let ry = if dy != 0.0 {
                ((graph.nodes[i].height + graph.nodes[j].height) / 2.0 + 8.0) / dy
            } else {
                f64::INFINITY
            };
            expansion = expansion.max(rx.min(ry));
        }
    }
    for pos in &mut positions {
        pos.x *= expansion;
        pos.y *= expansion;
    }
    for (i, node) in graph.nodes.iter_mut().enumerate() {
        let x = positions[i].x;
        let y = positions[i].y;
        let ox = node.x;
        let oy = node.y;
        for (_, port) in &mut node.ports {
            port.x += x - ox;
            port.y += y - oy;
        }
        node.x = x;
        node.y = y;
    }
    for edge in &mut graph.edges {
        let a_idx = node_index(&edge.tail.id, &graph.nodes);
        let b_idx = node_index(&edge.head.id, &graph.nodes);
        let a = &graph.nodes[a_idx];
        let b = &graph.nodes[b_idx];
        if a_idx == b_idx {
            edge.points = vec![
                GvPoint {
                    x: a.x,
                    y: a.y - a.height / 2.0,
                },
                GvPoint {
                    x: a.x + a.width,
                    y: a.y - a.height,
                },
                GvPoint {
                    x: a.x + a.width,
                    y: a.y,
                },
                GvPoint {
                    x: a.x + a.width / 2.0,
                    y: a.y,
                },
            ];
        } else {
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let attachment = |v: &GvLayoutNode, sign: f64| -> GvPoint {
                let scale = 1.0
                    / (dx.abs() / (v.width / 2.0))
                        .max(dy.abs() / (v.height / 2.0))
                        .max(1.0);
                GvPoint {
                    x: v.x + sign * dx * scale,
                    y: v.y + sign * dy * scale,
                }
            };
            edge.points = vec![attachment(a, 1.0), attachment(b, -1.0)];
        }
        edge.label = GvPoint {
            x: (a.x + b.x) / 2.0,
            y: (a.y + b.y) / 2.0,
        };
    }
    for cluster in &mut graph.clusters {
        let members: Vec<&GvLayoutNode> = graph
            .nodes
            .iter()
            .filter(|v| cluster.nodes.contains(&v.id))
            .collect();
        if members.is_empty() {
            continue;
        }
        cluster.x = members
            .iter()
            .map(|v| v.x - v.width / 2.0)
            .fold(f64::INFINITY, f64::min)
            - 10.0;
        cluster.y = members
            .iter()
            .map(|v| v.y - v.height / 2.0)
            .fold(f64::INFINITY, f64::min)
            - 20.0;
        cluster.width = members
            .iter()
            .map(|v| v.x + v.width / 2.0)
            .fold(f64::NEG_INFINITY, f64::max)
            + 10.0
            - cluster.x;
        cluster.height = members
            .iter()
            .map(|v| v.y + v.height / 2.0)
            .fold(f64::NEG_INFINITY, f64::max)
            + 10.0
            - cluster.y;
    }
    for ci in 0..graph.clusters.len() {
        if let Some(ref parent_id) = graph.clusters[ci].parent.clone()
            && let Some(pi) = graph.clusters.iter().position(|c| &c.id == parent_id)
        {
            let cx = graph.clusters[ci].x;
            let cy = graph.clusters[ci].y;
            let cw = graph.clusters[ci].width;
            let ch = graph.clusters[ci].height;
            let right = (graph.clusters[pi].x + graph.clusters[pi].width).max(cx + cw + 8.0);
            let bottom = (graph.clusters[pi].y + graph.clusters[pi].height).max(cy + ch + 8.0);
            graph.clusters[pi].x = graph.clusters[pi].x.min(cx - 8.0);
            graph.clusters[pi].y = graph.clusters[pi].y.min(cy - 8.0);
            graph.clusters[pi].width = right - graph.clusters[pi].x;
            graph.clusters[pi].height = bottom - graph.clusters[pi].y;
        }
    }
    let mut extents: Vec<GvPoint> = Vec::new();
    for v in &graph.nodes {
        extents.push(GvPoint {
            x: v.x - v.width / 2.0,
            y: v.y - v.height / 2.0,
        });
        extents.push(GvPoint {
            x: v.x + v.width / 2.0,
            y: v.y + v.height / 2.0,
        });
    }
    for c in &graph.clusters {
        extents.push(GvPoint { x: c.x, y: c.y });
        extents.push(GvPoint {
            x: c.x + c.width,
            y: c.y + c.height,
        });
    }
    for e in &graph.edges {
        extents.extend_from_slice(&e.points);
    }
    let left = extents.iter().map(|p| p.x).fold(f64::INFINITY, f64::min) - 18.0;
    let top = extents.iter().map(|p| p.y).fold(f64::INFINITY, f64::min) - 18.0;
    let max_x = extents
        .iter()
        .map(|p| p.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = extents
        .iter()
        .map(|p| p.y)
        .fold(f64::NEG_INFINITY, f64::max);
    graph.width = max_x - left + 18.0;
    graph.height = max_y - top + 18.0;
    for node in &mut graph.nodes {
        node.x -= left;
        node.y -= top;
        for (_, port) in &mut node.ports {
            port.x -= left;
            port.y -= top;
        }
    }
    for cluster in &mut graph.clusters {
        cluster.x -= left;
        cluster.y -= top;
    }
    for edge in &mut graph.edges {
        for point in &mut edge.points {
            point.x -= left;
            point.y -= top;
        }
        edge.label.x -= left;
        edge.label.y -= top;
        edge.path = if edge.points.len() == 4 {
            let p0 = edge.points[0];
            let rest = edge.points[1..]
                .iter()
                .map(|p| format!("{},{}", gv_json_num(p.x), gv_json_num(p.y)))
                .collect::<Vec<_>>()
                .join(" ");
            format!("M{},{}C{rest}", gv_json_num(p0.x), gv_json_num(p0.y))
        } else {
            edge.points
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    format!(
                        "{}{},{}",
                        if i > 0 { "L" } else { "M" },
                        gv_json_num(p.x),
                        gv_json_num(p.y)
                    )
                })
                .collect::<Vec<_>>()
                .join("")
        };
    }
}

fn gv_json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn gv_json_num(n: f64) -> String {
    if !n.is_finite() {
        "null".to_string()
    } else if n == 0.0 {
        "0".to_string()
    } else {
        format!("{n}")
    }
}

fn gv_json_attrs(attrs: &GvAttrs) -> String {
    let inner = attrs
        .entries
        .iter()
        .map(|(k, v)| format!("{}:{}", gv_json_str(k), gv_json_str(v)))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{inner}}}")
}

fn gv_json_noderef(r: &GvNodeRef) -> String {
    let mut parts = vec![format!("\"id\":{}", gv_json_str(&r.id))];
    if let Some(ref p) = r.port {
        parts.push(format!("\"port\":{}", gv_json_str(p)));
    }
    if let Some(ref c) = r.compass {
        parts.push(format!("\"compass\":{}", gv_json_str(c)));
    }
    format!("{{{}}}", parts.join(","))
}

fn gv_json_point(p: GvPoint) -> String {
    format!("{{\"x\":{},\"y\":{}}}", gv_json_num(p.x), gv_json_num(p.y))
}

fn gv_serialize_json(g: &GvGraphLayout) -> String {
    let mut fields: Vec<String> = Vec::new();
    if let Some(ref id) = g.id {
        fields.push(format!("\"id\":{}", gv_json_str(id)));
    }
    fields.push(format!("\"directed\":{}", g.directed));
    fields.push(format!("\"strict\":{}", g.strict));
    fields.push(format!("\"attributes\":{}", gv_json_attrs(&g.attributes)));
    let nodes_json = g
        .nodes
        .iter()
        .map(|n| {
            let ports_json = n
                .ports
                .iter()
                .map(|(k, pt)| format!("{}:{}", gv_json_str(k), gv_json_point(*pt)))
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"id\":{},\"attributes\":{},\"width\":{},\"height\":{},\"x\":{},\"y\":{},\"rank\":{},\"ports\":{{{ports_json}}}}}",
                gv_json_str(&n.id),
                gv_json_attrs(&n.attributes),
                gv_json_num(n.width),
                gv_json_num(n.height),
                gv_json_num(n.x),
                gv_json_num(n.y),
                n.rank
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    fields.push(format!("\"nodes\":[{nodes_json}]"));
    let edges_json = g
        .edges
        .iter()
        .map(|e| {
            let pts_json = e
                .points
                .iter()
                .map(|p| gv_json_point(*p))
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"tail\":{},\"head\":{},\"attributes\":{},\"reversed\":{},\"points\":[{pts_json}],\"path\":{},\"label\":{}}}",
                gv_json_noderef(&e.tail),
                gv_json_noderef(&e.head),
                gv_json_attrs(&e.attributes),
                e.reversed,
                gv_json_str(&e.path),
                gv_json_point(e.label)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    fields.push(format!("\"edges\":[{edges_json}]"));
    let clusters_json = g
        .clusters
        .iter()
        .map(|c| {
            let mut cf = vec![format!("\"id\":{}", gv_json_str(&c.id))];
            if let Some(ref p) = c.parent {
                cf.push(format!("\"parent\":{}", gv_json_str(p)));
            }
            cf.push(format!("\"attributes\":{}", gv_json_attrs(&c.attributes)));
            let cn = c
                .nodes
                .iter()
                .map(|id| gv_json_str(id))
                .collect::<Vec<_>>()
                .join(",");
            cf.push(format!("\"nodes\":[{cn}]"));
            cf.push(format!("\"x\":{}", gv_json_num(c.x)));
            cf.push(format!("\"y\":{}", gv_json_num(c.y)));
            cf.push(format!("\"width\":{}", gv_json_num(c.width)));
            cf.push(format!("\"height\":{}", gv_json_num(c.height)));
            format!("{{{}}}", cf.join(","))
        })
        .collect::<Vec<_>>()
        .join(",");
    fields.push(format!("\"clusters\":[{clusters_json}]"));
    fields.push(format!("\"width\":{}", gv_json_num(g.width)));
    fields.push(format!("\"height\":{}", gv_json_num(g.height)));
    format!("{{{}}}\n", fields.join(","))
}

fn gv_plain(g: &GvGraphLayout) -> String {
    let inch = |n: f64| -> String {
        let s = format!("{:.5}", n / 72.0);
        let parsed: f64 = s.parse().unwrap_or(0.0);
        if parsed == 0.0 {
            "0".to_string()
        } else {
            format!("{parsed}")
        }
    };
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("graph 1 {} {}", inch(g.width), inch(g.height)));
    for n in &g.nodes {
        lines.push(format!(
            "node {} {} {} {} {} {} {} {} {} {}",
            gv_json_str(&n.id),
            inch(n.x),
            inch(g.height - n.y),
            inch(n.width),
            inch(n.height),
            gv_json_str(n.attributes.get("label").unwrap_or(&n.id)),
            gv_json_str(n.attributes.get("style").unwrap_or("solid")),
            gv_json_str(n.attributes.get("shape").unwrap_or("ellipse")),
            gv_json_str(n.attributes.get("color").unwrap_or("black")),
            gv_json_str(n.attributes.get("fillcolor").unwrap_or("lightgrey"))
        ));
    }
    for e in &g.edges {
        let pts_str = e
            .points
            .iter()
            .map(|p| format!("{} {}", inch(p.x), inch(g.height - p.y)))
            .collect::<Vec<_>>()
            .join(" ");
        let lbl_part = if let Some(lbl) = e.attributes.get("label") {
            format!(
                " {} {} {}",
                gv_json_str(lbl),
                inch(e.label.x),
                inch(g.height - e.label.y)
            )
        } else {
            String::new()
        };
        lines.push(format!(
            "edge {} {} {} {}{} {} {}",
            gv_json_str(&e.tail.id),
            gv_json_str(&e.head.id),
            e.points.len(),
            pts_str,
            lbl_part,
            gv_json_str(e.attributes.get("style").unwrap_or("solid")),
            gv_json_str(e.attributes.get("color").unwrap_or("black"))
        ));
    }
    lines.push("stop".to_string());
    lines.push(String::new());
    lines.join("\n")
}

fn gv_render_graph(
    source: &str,
    format: &str,
    layout: &str,
    options: &GvLayoutOptions,
) -> Result<Vec<u8>, String> {
    let mut ast = gv_parse_dot(source)?;
    for (target, attrs) in [
        ("edge", &options.edge),
        ("node", &options.node),
        ("graph", &options.graph),
    ] {
        ast.statements.insert(
            0,
            GvStatement::Attributes {
                target: target.to_string(),
                attributes: attrs.clone(),
            },
        );
    }
    gv_admit(&ast)?;
    if format == "canon" {
        return Ok(gv_serialize_dot(&ast).into_bytes());
    }
    let mut graph = gv_layout_graph(&ast, options);
    if layout == "neato" {
        let n_u = graph.nodes.len() as u128;
        if 120 * n_u * n_u > 100_000_000 {
            return Err("graph layout cost limit exceeded".to_string());
        }
        gv_spring(&mut graph);
    }
    if format == "json" {
        return Ok(gv_serialize_json(&graph).into_bytes());
    }
    if format == "plain" {
        return Ok(gv_plain(&graph).into_bytes());
    }
    if format == "dot" {
        let mut bb_attrs = GvAttrs::new();
        bb_attrs.set(
            "bb".to_string(),
            format!("0,0,{},{}", gv_json_num(graph.width), gv_json_num(graph.height)),
        );
        ast.statements.push(GvStatement::Attributes {
            target: "graph".to_string(),
            attributes: bb_attrs,
        });
        for node in &graph.nodes {
            let mut na = GvAttrs::new();
            na.set(
                "pos".to_string(),
                format!("{},{}", gv_json_num(node.x), gv_json_num(graph.height - node.y)),
            );
            na.set("width".to_string(), gv_json_num(node.width / 72.0));
            na.set("height".to_string(), gv_json_num(node.height / 72.0));
            ast.statements.push(GvStatement::Node {
                node: GvNodeRef {
                    id: node.id.clone(),
                    port: None,
                    compass: None,
                },
                attributes: na,
            });
        }
        return Ok(gv_serialize_dot(&ast).into_bytes());
    }
    let svg_str = gv_render_svg(&graph);
    if format == "svg" {
        return Ok(svg_str.into_bytes());
    }
    if format == "pdf" {
        let root = parse_svg_xml(&svg_str)?;
        let width = parse_svg_length_px(root.get_attr("width"), graph.width)?;
        let height = parse_svg_length_px(root.get_attr("height"), graph.height)?;
        let mut texts = Vec::new();
        collect_svg_texts(&root, &mut texts);
        let mut doc = PdfDoc::new();
        doc.version = "1.7".to_string();
        doc.page_w = width * 0.75;
        doc.page_h = height * 0.75;
        doc.pages.push(PdfPage {
            rot: 0,
            text: texts.join("\n"),
            html: String::new(),
            images: Vec::new(),
            urls: Vec::new(),
        });
        return Ok(doc.serialize());
    }
    let area = graph.width.ceil() * graph.height.ceil();
    if !area.is_finite() || area > 16_000_000.0 {
        return Err("raster pixel limit exceeded".to_string());
    }
    if !matches!(format, "png" | "jpg" | "jpeg" | "webp") {
        return Err(format!("unknown format: {format}"));
    }
    let base_w: f64 = gv_fmt(graph.width).parse().unwrap_or(graph.width);
    let base_h: f64 = gv_fmt(graph.height).parse().unwrap_or(graph.height);
    let w = js_math_round(base_w).max(1.0) as u32;
    let h = js_math_round(base_h).max(1.0) as u32;
    let fmt = match format {
        "png" => "PNG",
        "jpg" | "jpeg" => "JPEG",
        "webp" => "WEBP",
        _ => "PNG",
    };
    let im = ImageMeta {
        fmt: fmt.to_string(),
        w,
        h,
        cs: "sRGB".to_string(),
        exif: BTreeMap::new(),
    };
    Ok(write_image_bytes(&im))
}

fn cmd_graphviz(
    name: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut format = "svg".to_string();
    let mut layout = name.to_string();
    let mut outfile = "-".to_string();
    let mut end = false;
    let mut files: Vec<String> = Vec::new();
    let mut options = GvLayoutOptions::default();
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !end && arg == "--" {
            end = true;
            i += 1;
            continue;
        }
        if !end && (arg == "--help" || arg == "-?") {
            return ok_out(&format!(
                "Usage: {name} [-Tsvg|pdf|png|jpg|jpeg|webp|json|dot|canon|plain] [-o FILE]\n       [-Gname=value] [-Nname=value] [-Ename=value] [-Kdot|neato] [FILE ...]\nReads stdin when FILE is omitted or -. -V prints version.\n"
            ));
        }
        if !end && arg == "-V" {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{name} (Safe Bash Graphviz) 0.0.1\n"),
                exit_code: 0,
            };
        }
        if !end && arg.starts_with('-') && arg != "-" {
            let flag = arg.as_bytes()[1] as char;
            let value = if arg.len() > 2 {
                Some(arg[2..].to_string())
            } else {
                i += 1;
                args.get(i).cloned()
            };
            let Some(val) = value.filter(|v| !v.is_empty()) else {
                return err_out(&format!("{name}: missing value for -{flag}\n"), 1);
            };
            if flag == 'T' {
                format = val;
            } else if flag == 'K' {
                layout = val;
            } else if flag == 'o' {
                outfile = val;
            } else if flag == 'G' || flag == 'N' || flag == 'E' {
                let Some(eq) = val.find('=') else {
                    return err_out(&format!("{name}: expected -{flag}name=value\n"), 1);
                };
                if eq < 1 {
                    return err_out(&format!("{name}: expected -{flag}name=value\n"), 1);
                }
                let k = val[..eq].to_string();
                let v = val[eq + 1..].to_string();
                match flag {
                    'G' => options.graph.set(k, v),
                    'N' => options.node.set(k, v),
                    _ => options.edge.set(k, v),
                }
            } else {
                return err_out(&format!("{name}: unknown option: {arg}\n"), 1);
            }
            i += 1;
            continue;
        }
        files.push(arg.to_string());
        i += 1;
    }
    if !matches!(
        format.as_str(),
        "svg" | "pdf" | "png" | "jpg" | "jpeg" | "webp" | "json" | "dot" | "canon" | "plain"
    ) {
        return err_out(&format!("{name}: unknown format: {format}\n"), 1);
    }
    if layout != "dot" && layout != "neato" {
        return err_out(
            &format!("{name}: unsupported layout: {layout} (choose dot or neato)\n"),
            1,
        );
    }
    if files.is_empty() {
        files.push("-".to_string());
    }
    let mut total_in = 0usize;
    let mut out_bytes: Vec<u8> = Vec::new();
    for file in &files {
        let raw_bytes = if file == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, file);
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => return err_out(&format!("{name}: {file}: No such file or directory\n"), 1),
            }
        };
        total_in += raw_bytes.len();
        if total_in > 1_048_576 {
            return err_out(&format!("{name}: input byte limit exceeded\n"), 1);
        }
        let Ok(source) = String::from_utf8(raw_bytes) else {
            return err_out(&format!("{name}: invalid utf-8 input\n"), 1);
        };
        let rendered = match gv_render_graph(&source, &format, &layout, &options) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
        };
        if out_bytes.len() + rendered.len() > 16_777_216 {
            return err_out(&format!("{name}: output byte limit exceeded\n"), 1);
        }
        out_bytes.extend_from_slice(&rendered);
    }
    if outfile == "-" {
        ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
    } else {
        let full = resolve_posix_path(cwd, &outfile);
        let _ = fs.write_file(&full, &out_bytes);
        ok_out("")
    }
}
