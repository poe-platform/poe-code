//! Default YAML 1.2 formatting, adapted from yaml 2.9.0 (ISC; see notices).
use super::{Error, scalar, units};
use crate::value::Value;
use mcp_protocol_rust::numbers;
use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq)]
enum Fold {
    Flow,
    Block,
    Quoted,
}
fn more_indented(text: &[u16], mut i: isize, indent: usize) -> isize {
    let mut end = i;
    let mut start = i + 1;
    let mut ch = text.get(start as usize).copied();
    while matches!(ch, Some(32 | 9)) {
        if i < start + indent as isize {
            i += 1;
            ch = text.get(i as usize).copied();
        } else {
            loop {
                i += 1;
                ch = text.get(i as usize).copied();
                if matches!(ch, None | Some(10)) {
                    break;
                }
            }
            end = i;
            start = i + 1;
            ch = text.get(start as usize).copied();
        }
    }
    end
}
fn fold(text: Vec<u16>, indent: usize, mode: Fold, at_start: Option<usize>) -> (Vec<u16>, bool) {
    let step = (81usize.saturating_sub(indent)).max(21);
    if text.len() <= step {
        return (text, false);
    }
    let mut folds = vec![];
    let mut escaped = HashSet::new();
    let mut end = 80isize - indent as isize;
    if let Some(start) = at_start {
        if start > 60 {
            folds.push(0);
        } else {
            end = 80 - start as isize;
        }
    }
    let mut split = None;
    let mut prev = None;
    let mut overflow = false;
    let mut i = -1isize;
    let mut esc_start = -1;
    let mut esc_end = -1;
    if mode == Fold::Block {
        i = more_indented(&text, i, indent);
        if i != -1 {
            end = i + step as isize;
        }
    }
    loop {
        i += 1;
        let Some(mut ch) = text.get(i as usize).copied() else {
            break;
        };
        if mode == Fold::Quoted && ch == 92 {
            esc_start = i;
            i += match text.get(i as usize + 1) {
                Some(120) => 3,
                Some(117) => 5,
                Some(85) => 9,
                _ => 1,
            };
            esc_end = i;
        }
        if ch == 10 {
            if mode == Fold::Block {
                i = more_indented(&text, i, indent);
            }
            end = i + indent as isize + step as isize;
            split = None;
        } else {
            if ch == 32
                && !matches!(prev, None | Some(32 | 10 | 9))
                && !matches!(text.get(i as usize + 1), None | Some(32 | 10 | 9))
            {
                split = Some(i as usize);
            }
            if i >= end {
                if let Some(pos) = split.take().filter(|pos| *pos != 0) {
                    folds.push(pos);
                    end = pos as isize + step as isize;
                } else if mode == Fold::Quoted {
                    while matches!(prev, Some(32 | 9)) {
                        prev = Some(ch);
                        i += 1;
                        ch = text.get(i as usize).copied().unwrap_or(0);
                        overflow = true;
                    }
                    let j = if i > esc_end + 1 {
                        i - 2
                    } else {
                        esc_start - 1
                    };
                    if j < 0 || !escaped.insert(j as usize) {
                        return (text, overflow);
                    }
                    folds.push(j as usize);
                    end = j + step as isize;
                    split = None;
                } else {
                    overflow = true;
                }
            }
        }
        prev = Some(ch);
    }
    if folds.is_empty() {
        return (text, overflow);
    }
    let mut output = text[..folds[0]].to_vec();
    for (n, pos) in folds.iter().copied().enumerate() {
        let end = folds.get(n + 1).copied().unwrap_or(text.len());
        if pos == 0 {
            output.clear();
            output.push(10);
            output.extend(std::iter::repeat_n(32, indent));
            output.extend_from_slice(&text[..end]);
        } else {
            if escaped.contains(&pos) {
                output.extend([text[pos], 92]);
            }
            output.push(10);
            output.extend(std::iter::repeat_n(32, indent));
            output.extend_from_slice(&text[pos + 1..end]);
        }
    }
    (output, overflow)
}
fn document_marker(text: &[u16]) -> bool {
    text.split(|ch| *ch == 10).any(|line| {
        line.first() == Some(&37)
            || line.starts_with(&[45, 45, 45])
            || line.starts_with(&[46, 46, 46])
    })
}
fn forced_double(text: &[u16]) -> bool {
    let mut i = 0;
    while i < text.len() {
        let ch = text[i];
        if matches!(ch, 0..=8 | 11..=31 | 127..=159) {
            return true;
        }
        if (0xD800..=0xDBFF).contains(&ch)
            && text
                .get(i + 1)
                .is_some_and(|v| (0xDC00..=0xDFFF).contains(v))
        {
            i += 2;
        } else if (0xD800..=0xDFFF).contains(&ch) {
            return true;
        } else {
            i += 1;
        }
    }
    false
}
fn double_quoted(text: &[u16], indent: usize, key: bool, at_start: Option<usize>) -> Vec<u16> {
    // JSON escapes are generated directly so raw UTF-16 and lone surrogates survive.
    let mut json = vec![34];
    let mut i = 0;
    while i < text.len() {
        let ch = text[i];
        let escape = match ch {
            34 => Some("\\\""),
            92 => Some("\\\\"),
            8 => Some("\\b"),
            9 => Some("\\t"),
            10 => Some("\\n"),
            12 => Some("\\f"),
            13 => Some("\\r"),
            _ => None,
        };
        if let Some(escape) = escape {
            json.extend(escape.encode_utf16());
        } else if ch < 32
            || (0xD800..=0xDFFF).contains(&ch)
                && !((0xD800..=0xDBFF).contains(&ch)
                    && text
                        .get(i + 1)
                        .is_some_and(|v| (0xDC00..=0xDFFF).contains(v)))
        {
            json.extend(format!("\\u{ch:04x}").encode_utf16());
        } else {
            json.push(ch);
            if (0xD800..=0xDBFF).contains(&ch) {
                i += 1;
                json.push(text[i]);
            }
        }
        i += 1;
    }
    json.push(34);
    let indent = if indent == 0 && document_marker(text) {
        2
    } else {
        indent
    };
    let mut output = vec![];
    let mut start = 0;
    let mut i = 0;
    while i < json.len() {
        let mut ch = json[i];
        if ch == 32 && json.get(i + 1..i + 3) == Some(&[92, 110]) {
            output.extend_from_slice(&json[start..i]);
            output.extend([92, 32]);
            i += 1;
            start = i;
            ch = 92;
        }
        if ch == 92 {
            match json.get(i + 1) {
                Some(117) => {
                    output.extend_from_slice(&json[start..i]);
                    let code = String::from_utf16(&json[i + 2..i + 6]).unwrap();
                    let short = match code.as_str() {
                        "0000" => Some("\\0"),
                        "0007" => Some("\\a"),
                        "000b" => Some("\\v"),
                        "001b" => Some("\\e"),
                        _ => None,
                    };
                    if let Some(short) = short {
                        output.extend(short.encode_utf16());
                    } else if let Some(suffix) = code.strip_prefix("00") {
                        output.extend([92, 120]);
                        output.extend(suffix.encode_utf16());
                    } else {
                        output.extend_from_slice(&json[i..i + 6]);
                    }
                    i += 5;
                    start = i + 1;
                }
                Some(110) if !key && json.get(i + 2) != Some(&34) && json.len() >= 40 => {
                    output.extend_from_slice(&json[start..i]);
                    output.extend([10, 10]);
                    while json.get(i + 2..i + 4) == Some(&[92, 110]) && json.get(i + 4) != Some(&34)
                    {
                        output.push(10);
                        i += 2;
                    }
                    output.extend(std::iter::repeat_n(32, indent));
                    if json.get(i + 2) == Some(&32) {
                        output.push(92);
                    }
                    i += 1;
                    start = i + 1;
                }
                _ => i += 1,
            }
        }
        i += 1;
    }
    if start == 0 {
        output = json;
    } else {
        output.extend_from_slice(&json[start..]);
    }
    if key {
        output
    } else {
        fold(output, indent, Fold::Quoted, at_start).0
    }
}
fn quoted(text: &[u16], indent: usize, key: bool, at_start: Option<usize>) -> Vec<u16> {
    if text.contains(&34)
        && !text.contains(&39)
        && !(key && text.contains(&10))
        && !text
            .windows(2)
            .any(|p| matches!(p, [32 | 9, 10] | [10, 32 | 9]))
    {
        let indent = if indent == 0 && document_marker(text) {
            2
        } else {
            indent
        };
        let mut output = vec![39];
        let mut i = 0;
        while i < text.len() {
            output.push(text[i]);
            if text[i] == 10 {
                while text.get(i + 1) == Some(&10) {
                    i += 1;
                    output.push(10);
                }
                output.push(10);
                output.extend(std::iter::repeat_n(32, indent));
            }
            i += 1;
        }
        output.push(39);
        if key {
            output
        } else {
            fold(output, indent, Fold::Flow, at_start).0
        }
    } else {
        double_quoted(text, indent, key, at_start)
    }
}
fn indent_newline_runs(text: &[u16], indent: usize, extra: bool) -> Vec<u16> {
    let mut output = vec![];
    let mut i = 0;
    while i < text.len() {
        output.push(text[i]);
        if text[i] == 10 {
            while text.get(i + 1) == Some(&10) {
                i += 1;
                output.push(10);
            }
            if extra {
                output.push(10);
            }
            output.extend(std::iter::repeat_n(32, indent));
        }
        i += 1;
    }
    output
}
fn block(text: &[u16], indent: usize, at_start: Option<usize>) -> Vec<u16> {
    let end_start = text
        .iter()
        .rposition(|ch| !matches!(ch, 10 | 9 | 32))
        .map_or(0, |i| i + 1);
    let mut end = &text[end_start..];
    if end.contains(&10) && end.last() != Some(&10) {
        return quoted(text, indent, false, at_start);
    }
    let indent = if indent == 0 && document_marker(text) {
        2
    } else {
        indent
    };
    let chomp = match end.iter().position(|ch| *ch == 10) {
        None => Some(45),
        Some(i) if end_start == 0 || i != end.len() - 1 => Some(43),
        _ => None,
    };
    if end.last() == Some(&10) {
        end = &end[..end.len() - 1];
    }
    let mut start_space = false;
    let mut start_end = 0;
    let mut last_newline = None;
    while start_end < end_start {
        match text[start_end] {
            32 => start_space = true,
            10 => last_newline = Some(start_end),
            _ => break,
        }
        start_end += 1;
    }
    let start_len = last_newline.map_or(0, |i| i + 1);
    let start = &text[..start_len];
    let body = &text[start_len..end_start];
    let long = text
        .split(|ch| *ch == 10)
        .any(|line| line.len() > 80usize.saturating_sub(indent));
    let mut folded = None;
    if long {
        // Add an extra newline between non-indented lines; more-indented lines
        // retain their literal boundaries under YAML's folded-block rules.
        let mut expanded = vec![];
        let mut i = 0;
        while i < body.len() {
            if body[i] == 10 {
                let begin = i;
                while body.get(i) == Some(&10) {
                    i += 1;
                }
                let prev_start = body[..begin]
                    .iter()
                    .rposition(|ch| *ch == 10)
                    .map_or(0, |n| n + 1);
                let more_before = matches!(body.get(prev_start), Some(32 | 9));
                let more_after = matches!(body.get(i), Some(32 | 9));
                expanded.extend(std::iter::repeat_n(
                    10,
                    i - begin + usize::from(!more_before && !more_after),
                ));
            } else {
                expanded.push(body[i]);
                i += 1;
            }
        }
        let mut full = indent_newline_runs(start, indent, false);
        full.extend(indent_newline_runs(&expanded, indent, false));
        full.extend(indent_newline_runs(end, indent, false));
        let (result, overflow) = fold(full, indent, Fold::Block, Some(indent));
        if !overflow {
            folded = Some(result);
        }
    }
    let mut output = vec![if folded.is_some() { 62 } else { 124 }];
    if start_space {
        output.push(if indent == 0 { 49 } else { 50 });
    }
    if let Some(chomp) = chomp {
        output.push(chomp);
    }
    output.push(10);
    output.extend(std::iter::repeat_n(32, indent));
    if let Some(body) = folded {
        output.extend(body);
    } else {
        output.extend(indent_newline_runs(start, indent, false));
        output.extend(indent_newline_runs(body, indent, false));
        // End newlines add indentation only before a following nonempty line.
        let mut i = 0;
        while i < end.len() {
            output.push(end[i]);
            if end[i] == 10 {
                while end.get(i + 1) == Some(&10) {
                    i += 1;
                    output.push(10);
                }
                if i + 1 < end.len() {
                    output.extend(std::iter::repeat_n(32, indent));
                }
            }
            i += 1;
        }
    }
    output
}
fn string(text: &[u16], indent: usize, key: bool, at_start: Option<usize>) -> Vec<u16> {
    if forced_double(text) {
        return double_quoted(text, indent, key, at_start);
    }
    if !key && text.contains(&10) {
        return block(text, indent, at_start);
    }
    let forbidden = text.is_empty()
        || matches!(
            text.first(),
            Some(
                10 | 9
                    | 32
                    | 44
                    | 91
                    | 93
                    | 123
                    | 125
                    | 35
                    | 38
                    | 42
                    | 33
                    | 124
                    | 62
                    | 39
                    | 34
                    | 37
                    | 64
                    | 96
            )
        )
        || (matches!(text.first(), Some(63 | 45))
            && (text.len() == 1 || matches!(text.get(1), Some(32 | 9))))
        || text
            .windows(2)
            .any(|p| matches!(p, [10 | 58, 32 | 9] | [32 | 9, 10] | [10 | 9 | 32, 35]))
        || matches!(text.last(), Some(10 | 9 | 32 | 58))
        || key && text.contains(&10)
        || !scalar::is_core_string(&String::from_utf16_lossy(text));
    if forbidden || key && indent == 2 && document_marker(text) {
        return quoted(text, indent, key, at_start);
    }
    if !key && indent == 0 && document_marker(text) {
        return block(text, indent, at_start);
    }
    if key {
        text.to_vec()
    } else {
        fold(text.to_vec(), indent, Fold::Flow, at_start).0
    }
}

/// A host snapshot retains object identities without transferring JS objects to Rust.
#[derive(Clone, Debug, PartialEq)]
pub enum GraphNode {
    Scalar(Value),
    Sequence(Vec<usize>),
    Mapping(Vec<(usize, usize)>),
    Alias(usize),
}
#[derive(Clone, Debug, PartialEq)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub anchors: Vec<Option<Vec<u16>>>,
    pub root: usize,
}
fn failure(reason: &str) -> Error {
    Error {
        reason: reason.into(),
        offset: 0,
        line: 1,
        column: 1,
    }
}
pub fn stringify(value: &Value) -> Result<Vec<u16>, Error> {
    let mut nodes = vec![GraphNode::Scalar(Value::Null)];
    let mut tasks = vec![(value, 0)];
    while let Some((value, id)) = tasks.pop() {
        nodes[id] = match value {
            Value::Array(items) => {
                let mut children = Vec::with_capacity(items.len());
                for value in items {
                    let id = nodes.len();
                    nodes.push(GraphNode::Scalar(Value::Null));
                    children.push(id);
                    tasks.push((value, id));
                }
                GraphNode::Sequence(children)
            }
            Value::Object(items) => {
                let mut pairs = Vec::with_capacity(items.len());
                for (key, value) in items {
                    if matches!(value, Value::Undefined) {
                        continue;
                    }
                    let key_id = nodes.len();
                    nodes.push(GraphNode::Scalar(Value::String(key.clone())));
                    let value_id = nodes.len();
                    nodes.push(GraphNode::Scalar(Value::Null));
                    pairs.push((key_id, value_id));
                    tasks.push((value, value_id));
                }
                GraphNode::Mapping(pairs)
            }
            value => GraphNode::Scalar(value.clone()),
        };
    }
    stringify_graph(&Graph {
        anchors: vec![None; nodes.len()],
        nodes,
        root: 0,
    })
}
#[derive(Clone, Copy)]
struct Context {
    indent: usize,
    key: bool,
    start: Option<usize>,
}
fn scalar_text(value: &Value, ctx: Context) -> Result<Vec<u16>, Error> {
    Ok(match value {
        Value::Null | Value::Undefined => units("null"),
        Value::Bool(v) => units(if *v { "true" } else { "false" }),
        Value::Number(v) => units(&if v.is_nan() {
            ".nan".into()
        } else if *v == f64::INFINITY {
            ".inf".into()
        } else if *v == f64::NEG_INFINITY {
            "-.inf".into()
        } else if *v == 0.0 && v.is_sign_negative() {
            "-0".into()
        } else {
            numbers::format(*v)
        }),
        Value::BigInt(v) => v.clone(),
        Value::String(v) | Value::DateLiteral(v) => string(v, ctx.indent, ctx.key, ctx.start),
        Value::Date(v) => string(&v.to_iso_string(), ctx.indent, ctx.key, ctx.start),
        Value::Symbol(v) => {
            return Err(failure(&format!(
                "Tag not resolved for Symbol({}) value",
                String::from_utf16_lossy(v)
            )));
        }
        Value::Unsupported(v) => {
            return Err(failure(&format!(
                "Tag not resolved for {} value",
                String::from_utf16_lossy(v)
            )));
        }
        Value::Array(_) | Value::Object(_) => return Err(failure("Collection in scalar snapshot")),
    })
}
fn decorate(
    mut body: Vec<u16>,
    graph: &Graph,
    id: usize,
    ctx: Context,
    collection: bool,
) -> Vec<u16> {
    if let Some(anchor) = &graph.anchors[id] {
        let mut output = vec![38];
        output.extend(anchor);
        if collection {
            output.push(10);
            output.extend(std::iter::repeat_n(32, ctx.indent));
        } else {
            output.push(32);
        }
        output.append(&mut body);
        output
    } else {
        body
    }
}
pub fn stringify_graph(graph: &Graph) -> Result<Vec<u16>, Error> {
    enum Task {
        Visit(usize, Context),
        Sequence(usize, usize, Context),
        Mapping(usize, usize, Context),
        Key(usize, Context, bool),
        Pair(Vec<u16>, Context, bool),
    }
    if graph.anchors.len() != graph.nodes.len() {
        return Err(failure("Invalid configuration anchor snapshot"));
    }
    // Reject malformed native snapshots independently of host validation. Alias
    // edges intentionally do not expand; they permit self-reference in YAML.
    let mut active = HashSet::new();
    let mut admitted = HashSet::new();
    let mut seen_anchors = HashSet::new();
    let mut pending = vec![(graph.root, false, 0usize)];
    while let Some((id, complete, depth)) = pending.pop() {
        if complete {
            active.remove(&id);
            admitted.insert(id);
            continue;
        }
        let node = graph
            .nodes
            .get(id)
            .ok_or_else(|| failure("Invalid configuration node snapshot"))?;
        if admitted.contains(&id) {
            continue;
        }
        if !active.insert(id) {
            return Err(failure("Circular configuration snapshot requires an alias"));
        }
        if graph.anchors[id].is_some() {
            seen_anchors.insert(id);
        }
        pending.push((id, true, depth));
        let children: Vec<usize> = match node {
            GraphNode::Sequence(items) => items.clone(),
            GraphNode::Mapping(items) => items.iter().flat_map(|(k, v)| [*k, *v]).collect(),
            GraphNode::Alias(target) => {
                if !seen_anchors.contains(target) {
                    return Err(failure("Alias anchor must be emitted before its reference"));
                }
                if graph
                    .anchors
                    .get(*target)
                    .and_then(Option::as_ref)
                    .is_none()
                {
                    return Err(failure("Unresolved configuration alias"));
                }
                vec![]
            }
            GraphNode::Scalar(_) => vec![],
        };
        if !children.is_empty() && depth >= 512 {
            return Err(failure("Maximum configuration depth exceeded"));
        }
        pending.extend(children.into_iter().rev().map(|id| (id, false, depth + 1)));
    }
    let mut tasks = vec![Task::Visit(
        graph.root,
        Context {
            indent: 0,
            key: false,
            start: None,
        },
    )];
    let mut results: Vec<Vec<u16>> = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Task::Visit(id, ctx) => match &graph.nodes[id] {
                GraphNode::Alias(target) => {
                    let mut text = vec![42];
                    text.extend(graph.anchors[*target].as_ref().unwrap());
                    results.push(text);
                }
                GraphNode::Scalar(value) => {
                    results.push(decorate(scalar_text(value, ctx)?, graph, id, ctx, false))
                }
                GraphNode::Sequence(items) => {
                    tasks.push(Task::Sequence(id, items.len(), ctx));
                    for child in items.iter().rev() {
                        tasks.push(Task::Visit(
                            *child,
                            Context {
                                indent: ctx.indent + 2,
                                key: false,
                                start: None,
                            },
                        ));
                    }
                }
                GraphNode::Mapping(pairs) => {
                    tasks.push(Task::Mapping(id, pairs.len(), ctx));
                    for (key, value) in pairs.iter().rev() {
                        let explicit = matches!(
                            graph.nodes[*key],
                            GraphNode::Sequence(_) | GraphNode::Mapping(_)
                        );
                        tasks.push(Task::Key(*value, ctx, explicit));
                        tasks.push(Task::Visit(
                            *key,
                            Context {
                                indent: ctx.indent + 2,
                                key: !explicit,
                                start: None,
                            },
                        ));
                    }
                }
            },
            Task::Key(value, ctx, mut explicit) => {
                let rendered = results.pop().unwrap();
                if rendered.len() > 1024 {
                    explicit = true;
                }
                let mut prefix = vec![];
                if explicit {
                    prefix.extend(units("? "));
                }
                prefix.extend(rendered);
                if explicit {
                    prefix.push(10);
                    prefix.extend(std::iter::repeat_n(32, ctx.indent));
                }
                prefix.push(58);
                let start = if !explicit && matches!(graph.nodes[value], GraphNode::Scalar(_)) {
                    Some(prefix.len() + 1)
                } else {
                    None
                };
                let collection = matches!(&graph.nodes[value],GraphNode::Sequence(items) if !items.is_empty())
                    || matches!(&graph.nodes[value],GraphNode::Mapping(items) if !items.is_empty());
                let has_props = graph.anchors[value].is_some();
                let linebreak = collection && !explicit && !has_props;
                tasks.push(Task::Pair(prefix, ctx, linebreak));
                tasks.push(Task::Visit(
                    value,
                    Context {
                        indent: ctx.indent + 2,
                        key: false,
                        start,
                    },
                ));
            }
            Task::Pair(mut prefix, ctx, linebreak) => {
                let value = results.pop().unwrap();
                if linebreak {
                    prefix.push(10);
                    prefix.extend(std::iter::repeat_n(32, ctx.indent + 2));
                } else if !value.is_empty() && value.first() != Some(&10) {
                    prefix.push(32);
                }
                prefix.extend(value);
                results.push(prefix);
            }
            Task::Sequence(id, count, ctx) | Task::Mapping(id, count, ctx) => {
                let sequence = matches!(graph.nodes[id], GraphNode::Sequence(_));
                let mut output = vec![];
                if count == 0 {
                    output.extend(units(if sequence { "[]" } else { "{}" }));
                } else {
                    let start = results.len() - count;
                    for (i, item) in results.drain(start..).enumerate() {
                        if i != 0 {
                            output.push(10);
                            output.extend(std::iter::repeat_n(32, ctx.indent));
                        }
                        if sequence {
                            output.extend(units("- "));
                        }
                        output.extend(item);
                    }
                }
                results.push(decorate(output, graph, id, ctx, count != 0));
            }
        }
    }
    let mut output = results.pop().unwrap();
    output.push(10);
    Ok(output)
}
