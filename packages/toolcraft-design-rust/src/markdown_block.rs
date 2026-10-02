//! Native block construction and source mapping. Frontmatter is handled by the
//! document adapter; this module parses the body without changing its offsets.
use crate::markdown_block_scan::{self as scan, Cell, Line, ListMarker};
use crate::markdown_delimiter::CharacterClass;
use crate::markdown_parse_inline as inline;
use crate::markdown_scan::{ascii_whitespace as space, offset_map};
use mcp_protocol_rust::json::Value;
use std::collections::BTreeSet;

pub trait Host {
    type Error;
    fn class(&mut self, unit: Option<u16>) -> Result<CharacterClass, Self::Error>;
    fn too_deep(&mut self) -> Self::Error;
}

#[derive(Clone)]
struct Mapped {
    text: Vec<u16>,
    offsets: Vec<f64>,
    line_break_end: Option<f64>,
}
impl Mapped {
    fn start(&self) -> f64 {
        self.offsets.first().copied().unwrap_or(0.0)
    }
    fn end(&self) -> f64 {
        self.offsets.last().copied().unwrap_or(0.0)
    }
    fn range(&self) -> [f64; 2] {
        [self.start(), self.end()]
    }
}
fn join(parts: Vec<Mapped>) -> Mapped {
    if parts.is_empty() {
        return Mapped {
            text: vec![],
            offsets: vec![0.0],
            line_break_end: None,
        };
    }
    let mut text = Vec::new();
    let mut offsets = Vec::new();
    for (index, part) in parts.into_iter().enumerate() {
        text.extend(part.text);
        offsets.extend(part.offsets.into_iter().skip(usize::from(index != 0)));
    }
    Mapped {
        text,
        offsets,
        line_break_end: None,
    }
}
fn join_lines(lines: Vec<Mapped>) -> Mapped {
    let length = lines.len();
    let mut parts = Vec::new();
    for (index, mut line) in lines.into_iter().enumerate() {
        let end = line.end();
        let next = line.line_break_end.unwrap_or(end);
        line.line_break_end = None;
        parts.push(line);
        if index + 1 < length {
            parts.push(Mapped {
                text: vec![10],
                offsets: vec![end, next],
                line_break_end: None,
            });
        }
    }
    join(parts)
}

pub struct Node {
    pub kind: &'static str,
    pub fields: Vec<(&'static str, Value)>,
    pub children: Option<Vec<Node>>,
    pub range: [f64; 2],
    source: Option<Mapped>,
}
impl Node {
    fn container(
        kind: &'static str,
        fields: Vec<(&'static str, Value)>,
        children: Vec<Node>,
        range: [f64; 2],
    ) -> Self {
        Self {
            kind,
            fields,
            children: Some(children),
            range,
            source: None,
        }
    }
    fn text_container(
        kind: &'static str,
        fields: Vec<(&'static str, Value)>,
        source: Mapped,
        range: [f64; 2],
    ) -> Self {
        Self {
            kind,
            fields,
            children: Some(vec![]),
            range,
            source: Some(source),
        }
    }
}
fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn paragraph(lines: Vec<Mapped>) -> Node {
    let start = lines.first().map_or(0.0, Mapped::start);
    let source = join_lines(lines);
    let range = [start, source.end()];
    Node::text_container("paragraph", vec![], source, range)
}

struct State {
    input: Mapped,
    position: usize,
    prefer_list: bool,
}
impl State {
    fn line(&self) -> Line {
        scan::read_line(&self.input.text, self.position)
    }
    fn text(&self, line: Line) -> &[u16] {
        &self.input.text[line.start..line.end]
    }
    fn range(&self, start: usize) -> [f64; 2] {
        [
            self.input
                .offsets
                .get(start)
                .copied()
                .unwrap_or(self.input.end()),
            self.input
                .offsets
                .get(self.position)
                .copied()
                .unwrap_or(self.input.end()),
        ]
    }
    fn slice(&self, line: Line, start: usize, end: usize) -> Mapped {
        Mapped {
            text: self.input.text[line.start + start..line.start + end].to_vec(),
            offsets: self.input.offsets[(line.start + start).min(self.input.offsets.len())
                ..(line.start + end + 1).min(self.input.offsets.len())]
                .to_vec(),
            line_break_end: Some(
                self.input
                    .offsets
                    .get(line.next)
                    .copied()
                    .unwrap_or(self.input.end()),
            ),
        }
    }
    fn line_break(&self, line: Line) -> Option<Mapped> {
        (line.next > line.end).then(|| Mapped {
            text: vec![10],
            offsets: vec![
                self.input.offsets.get(line.end).copied().unwrap_or(0.0),
                self.input.offsets.get(line.next).copied().unwrap_or(0.0),
            ],
            line_break_end: None,
        })
    }
    fn stripped(&self, line: Line, required: usize) -> Option<Mapped> {
        let (columns, offset) = scan::leading_whitespace(self.text(line));
        if columns < required {
            return None;
        }
        let prefix_start = self
            .input
            .offsets
            .get(line.start + offset)
            .copied()
            .unwrap_or(0.0);
        let mut parts = Vec::new();
        if columns > required {
            parts.push(Mapped {
                text: vec![32; columns - required],
                offsets: vec![prefix_start; columns - required + 1],
                line_break_end: None,
            });
        }
        parts.push(self.slice(line, offset, line.end - line.start));
        let mut value = join(parts);
        value.line_break_end = Some(
            self.input
                .offsets
                .get(line.next)
                .copied()
                .unwrap_or(self.input.end()),
        );
        Some(value)
    }
    fn blank(&self, line: Line) -> Mapped {
        Mapped {
            text: vec![],
            offsets: vec![self.input.offsets.get(line.end).copied().unwrap_or(0.0)],
            line_break_end: Some(
                self.input
                    .offsets
                    .get(line.next)
                    .copied()
                    .unwrap_or(self.input.end()),
            ),
        }
    }
    fn starts_block(&self, position: usize) -> bool {
        let line = scan::read_line(&self.input.text, position);
        scan::simple_block(self.text(line))
            || (line.next < self.input.text.len() && {
                let next = scan::read_line(&self.input.text, line.next);
                scan::table_header(self.text(line), self.text(next)).is_some()
            })
    }
}

fn code(state: &mut State) -> Option<Node> {
    let start = state.position;
    let opening = state.line();
    let fence = scan::opening_fence(state.text(opening))?;
    state.position = opening.next;
    let mut value = Vec::new();
    let mut first = true;
    while state.position < state.input.text.len() {
        let line = state.line();
        if scan::closing_fence(state.text(line), fence.marker, fence.length) {
            state.position = line.next;
            break;
        }
        if !first {
            value.push(10);
        }
        first = false;
        value.extend_from_slice(state.text(line));
        state.position = line.next;
    }
    let mut fields = Vec::new();
    if let Some(lang) = fence.lang {
        fields.push(("lang", Value::String(lang)));
    }
    if let Some(meta) = fence.meta {
        fields.push(("meta", Value::String(meta)));
    }
    fields.push(("value", Value::String(value)));
    Some(Node {
        kind: "code",
        fields,
        children: None,
        range: state.range(start),
        source: None,
    })
}
fn heading(state: &mut State, setext: bool) -> Option<Node> {
    let start = state.position;
    let line = state.line();
    let (depth, content_start, content_end, next) = if setext {
        if line.next >= state.input.text.len() {
            return None;
        }
        let underline = scan::read_line(&state.input.text, line.next);
        let depth = scan::setext(state.text(underline))?;
        let (left, right) = scan::trim_range(state.text(line));
        (depth, left, right, underline.next)
    } else {
        let heading = scan::heading(state.text(line))?;
        (heading.depth, heading.start, heading.end, line.next)
    };
    state.position = next;
    Some(Node::text_container(
        "heading",
        vec![("depth", Value::Number(depth as f64))],
        state.slice(line, content_start, content_end),
        state.range(start),
    ))
}
fn thematic(state: &mut State) -> Option<Node> {
    let start = state.position;
    let line = state.line();
    if !scan::thematic_break(state.text(line)) {
        return None;
    }
    state.position = line.next;
    Some(Node {
        kind: "thematicBreak",
        fields: vec![],
        children: None,
        range: state.range(start),
        source: None,
    })
}
fn quote<H: Host>(state: &mut State, host: &mut H, depth: usize) -> Result<Option<Node>, H::Error> {
    let start = state.position;
    let first = state.line();
    let Some(first_content) = scan::blockquote(state.text(first)) else {
        return Ok(None);
    };
    let alert = scan::alert(&state.text(first)[first_content..]);
    let mut parts = Vec::new();
    let mut previous = None;
    if let Some((_, content_start)) = alert {
        state.position = first.next;
        let content_start = first_content + content_start;
        if content_start < first.end - first.start {
            parts.push(state.slice(first, content_start, first.end - first.start));
            previous = Some(first);
        }
    }
    while state.position < state.input.text.len() {
        let line = state.line();
        let Some(content_start) = scan::blockquote(state.text(line)) else {
            break;
        };
        if let Some(previous) = previous
            && let Some(line_break) = state.line_break(previous)
        {
            parts.push(line_break);
        }
        parts.push(state.slice(line, content_start, line.end - line.start));
        state.position = line.next;
        previous = Some(line);
    }
    let children = blocks(join(parts), state.prefer_list, host, depth + 1)?;
    let fields = alert.map_or_else(Vec::new, |(kind, _)| vec![("kind", string(kind))]);
    Ok(Some(Node::container(
        if alert.is_some() {
            "alert"
        } else {
            "blockquote"
        },
        fields,
        children,
        state.range(start),
    )))
}
fn item_children<H: Host>(
    first: Mapped,
    continuation: Vec<Mapped>,
    prefer_list: bool,
    host: &mut H,
    depth: usize,
) -> Result<Vec<Node>, H::Error> {
    let mut result = Vec::new();
    let mut paragraph_lines = if first.text.is_empty() {
        vec![]
    } else {
        vec![first]
    };
    let mut lines = continuation.into_iter().peekable();
    while let Some(line) = lines.next() {
        if line.text.iter().all(|unit| space(*unit)) {
            if !paragraph_lines.is_empty() {
                result.push(paragraph(std::mem::take(&mut paragraph_lines)));
            }
            continue;
        }
        if scan::simple_block(&line.text)
            || lines
                .peek()
                .is_some_and(|next| scan::table_header(&line.text, &next.text).is_some())
        {
            if !paragraph_lines.is_empty() {
                result.push(paragraph(paragraph_lines));
            }
            let remaining = std::iter::once(line).chain(lines).collect();
            result.extend(blocks(join_lines(remaining), prefer_list, host, depth + 1)?);
            return Ok(result);
        }
        paragraph_lines.push(line);
    }
    if !paragraph_lines.is_empty() {
        result.push(paragraph(paragraph_lines));
    }
    Ok(result)
}
fn continuation(state: &mut State, indent: usize, sibling: Option<ListMarker>) -> Vec<Mapped> {
    let mut lines = Vec::new();
    let mut blanks = Vec::new();
    while state.position < state.input.text.len() {
        let line = state.line();
        if state.text(line).iter().all(|unit| space(*unit)) {
            blanks.push(state.blank(line));
            state.position = line.next;
            continue;
        }
        if let Some(sibling) = sibling
            && let Some(marker) = scan::list_marker(state.text(line))
            && marker.ordered == sibling.ordered
            && marker.indent == sibling.indent
        {
            break;
        }
        let Some(stripped) = state.stripped(line, indent) else {
            break;
        };
        state.position = line.next;
        lines.append(&mut blanks);
        lines.push(stripped);
    }
    lines
}
fn list<H: Host>(state: &mut State, host: &mut H, depth: usize) -> Result<Option<Node>, H::Error> {
    let start = state.position;
    let Some(first_marker) = scan::list_marker(state.text(state.line())) else {
        return Ok(None);
    };
    let mut children = Vec::new();
    while state.position < state.input.text.len() {
        let item_start = state.position;
        let line = state.line();
        let Some(marker) = scan::list_marker(state.text(line)) else {
            break;
        };
        if marker.ordered != first_marker.ordered || marker.indent != first_marker.indent {
            break;
        }
        state.position = line.next;
        let task = scan::task(&state.text(line)[marker.content_start..]);
        let content_start = marker.content_start + task.map_or(0, |(_, start)| start);
        let first = state.slice(line, content_start, line.end - line.start);
        let continuation = continuation(state, marker.content_indent, Some(first_marker));
        let inner = item_children(first, continuation, true, host, depth)?;
        let fields = task.map_or_else(Vec::new, |(checked, _)| {
            vec![("checked", Value::Bool(checked))]
        });
        children.push(Node::container(
            "listItem",
            fields,
            inner,
            state.range(item_start),
        ));
    }
    let mut fields = vec![("ordered", Value::Bool(first_marker.ordered))];
    if let Some(start) = first_marker.start {
        fields.push(("start", Value::Number(start)));
    }
    Ok(Some(Node::container(
        "list",
        fields,
        children,
        state.range(start),
    )))
}
fn html(state: &mut State) -> Option<Node> {
    let start = state.position;
    let first = state.line();
    let tag = scan::html_tag(state.text(first))?;
    let name: Vec<u16> = tag.name.encode_utf16().collect();
    let contained = tag.closing
        || tag.self_closing
        || scan::void_html_tag(tag.name)
        || scan::contains_closing_html(state.text(first), &name, tag.end);
    let mut value = state.text(first).to_vec();
    state.position = first.next;
    if !contained {
        while state.position < state.input.text.len() {
            let line = state.line();
            value.push(10);
            value.extend_from_slice(state.text(line));
            state.position = line.next;
            if scan::contains_closing_html(state.text(line), &name, 0) {
                break;
            }
        }
    }
    Some(Node {
        kind: "html",
        fields: vec![("value", Value::String(value))],
        children: None,
        range: state.range(start),
        source: None,
    })
}
fn row(state: &State, line: Line, cells: Vec<Cell>) -> Node {
    let children = cells
        .into_iter()
        .map(|cell| {
            let mut source = state.slice(line, cell.start, cell.end);
            source.text = cell.value;
            let range = source.range();
            Node::text_container("tableCell", vec![], source, range)
        })
        .collect();
    Node::container(
        "tableRow",
        vec![],
        children,
        [
            state.input.offsets.get(line.start).copied().unwrap_or(0.0),
            state
                .input
                .offsets
                .get(line.next)
                .or_else(|| state.input.offsets.get(line.end))
                .copied()
                .unwrap_or(0.0),
        ],
    )
}
fn table(state: &mut State) -> Option<Node> {
    let start = state.position;
    let header = state.line();
    if scan::list_marker(state.text(header)).is_some()
        || scan::blockquote(state.text(header)).is_some()
        || header.next >= state.input.text.len()
    {
        return None;
    }
    let separator = scan::read_line(&state.input.text, header.next);
    let (cells, align) = scan::table_header(state.text(header), state.text(separator))?;
    let columns = cells.len();
    let mut children = vec![row(state, header, cells)];
    state.position = separator.next;
    while state.position < state.input.text.len() {
        let line = state.line();
        if state.text(line).iter().all(|unit| space(*unit)) || scan::simple_block(state.text(line))
        {
            break;
        }
        let Some(mut cells) = scan::table_cells(state.text(line)) else {
            break;
        };
        cells.truncate(columns);
        let end = cells.last().map_or(0, |cell| cell.end);
        cells.resize_with(columns, || Cell {
            value: vec![],
            start: end,
            end,
        });
        children.push(row(state, line, cells));
        state.position = line.next;
    }
    let align = Value::Array(
        align
            .into_iter()
            .map(|value| value.map_or(Value::Null, string))
            .collect(),
    );
    Some(Node::container(
        "table",
        vec![("align", align)],
        children,
        state.range(start),
    ))
}
fn footnote<H: Host>(
    state: &mut State,
    host: &mut H,
    depth: usize,
) -> Result<Option<Node>, H::Error> {
    let start = state.position;
    let first = state.line();
    let Some((label, content_start)) = scan::footnote(state.text(first)) else {
        return Ok(None);
    };
    state.position = first.next;
    let lines = continuation(state, 4, None);
    let children = item_children(
        state.slice(first, content_start, first.end - first.start),
        lines,
        state.prefer_list,
        host,
        depth,
    )?;
    Ok(Some(Node::container(
        "footnoteDefinition",
        vec![("label", Value::String(label))],
        children,
        state.range(start),
    )))
}
fn blocks<H: Host>(
    input: Mapped,
    prefer_list: bool,
    host: &mut H,
    depth: usize,
) -> Result<Vec<Node>, H::Error> {
    if depth >= 128 {
        return Err(host.too_deep());
    }
    let mut state = State {
        input,
        position: 0,
        prefer_list,
    };
    let mut result = Vec::new();
    while state.position < state.input.text.len() {
        let line = state.line();
        if state.text(line).iter().all(|unit| space(*unit)) {
            state.position = line.next;
            continue;
        }
        if let Some(node) = code(&mut state).or_else(|| heading(&mut state, false)) {
            result.push(node);
            continue;
        }
        if !prefer_list && let Some(node) = thematic(&mut state) {
            result.push(node);
            continue;
        }
        if let Some(node) = quote(&mut state, host, depth)? {
            result.push(node);
            continue;
        }
        if let Some(node) = list(&mut state, host, depth)? {
            result.push(node);
            continue;
        }
        if let Some(node) = html(&mut state) {
            result.push(node);
            continue;
        }
        if prefer_list && let Some(node) = thematic(&mut state) {
            result.push(node);
            continue;
        }
        if let Some(node) = table(&mut state) {
            result.push(node);
            continue;
        }
        if let Some(node) = footnote(&mut state, host, depth)? {
            result.push(node);
            continue;
        }
        if let Some(node) = heading(&mut state, true) {
            result.push(node);
            continue;
        }
        let start = state.position;
        let mut lines = Vec::new();
        while state.position < state.input.text.len() {
            let line = state.line();
            if state.text(line).iter().all(|unit| space(*unit))
                || (!lines.is_empty() && state.starts_block(state.position))
            {
                break;
            }
            lines.push(line);
            state.position = line.next;
        }
        let mut parts = Vec::new();
        for (index, line) in lines.iter().copied().enumerate() {
            parts.push(state.slice(line, 0, line.end - line.start));
            if index + 1 < lines.len()
                && let Some(line_break) = state.line_break(line)
            {
                parts.push(line_break);
            }
        }
        result.push(Node::text_container(
            "paragraph",
            vec![],
            join(parts),
            state.range(start),
        ));
    }
    Ok(result)
}

struct InlineHost<'a, H: Host> {
    host: &'a mut H,
    labels: &'a BTreeSet<Vec<u16>>,
    maps: Vec<Vec<f64>>,
    ranges: Vec<[f64; 2]>,
}
impl<H: Host> InlineHost<'_, H> {
    fn save_range(&mut self, range: [f64; 2]) -> usize {
        let index = self.ranges.len();
        self.ranges.push(range);
        index
    }
    fn convert(&self, node: inline::Node) -> Node {
        Node {
            kind: node.kind,
            fields: node
                .fields
                .into_iter()
                .map(|(key, value)| (key, Value::String(value)))
                .collect(),
            children: node
                .children
                .map(|nodes| nodes.into_iter().map(|node| self.convert(node)).collect()),
            range: self.ranges[node.range],
            source: None,
        }
    }
}
impl<H: Host> inline::Host for InlineHost<'_, H> {
    type Error = H::Error;
    fn class(&mut self, unit: Option<u16>) -> Result<CharacterClass, Self::Error> {
        self.host.class(unit)
    }
    fn range(
        &mut self,
        offsets: usize,
        start: usize,
        end: usize,
        delimiter: bool,
    ) -> Result<usize, Self::Error> {
        let map = &self.maps[offsets];
        let last = map.last().copied().unwrap_or(0.0);
        Ok(self.save_range([
            map.get(start)
                .copied()
                .unwrap_or(if delimiter { 0.0 } else { last }),
            map.get(end).copied().unwrap_or(last),
        ]))
    }
    fn slice_offsets(
        &mut self,
        offsets: usize,
        start: usize,
        end: usize,
        _source: &[u16],
    ) -> Result<usize, Self::Error> {
        let map = &self.maps[offsets];
        let sliced = map[start.min(map.len())..(end + 1).min(map.len())].to_vec();
        let index = self.maps.len();
        self.maps.push(sliced);
        Ok(index)
    }
    fn merge_ranges(&mut self, left: usize, right: usize) -> Result<usize, Self::Error> {
        let a = self.ranges[left];
        let b = self.ranges[right];
        let min = if a[0].is_nan() || b[0].is_nan() {
            f64::NAN
        } else {
            a[0].min(b[0])
        };
        let max = if a[1].is_nan() || b[1].is_nan() {
            f64::NAN
        } else {
            a[1].max(b[1])
        };
        Ok(self.save_range([min, max]))
    }
    fn wrapper_range(
        &mut self,
        left: usize,
        right: usize,
        _opener: usize,
        _closer: usize,
    ) -> Result<usize, Self::Error> {
        Ok(self.save_range([self.ranges[left][0], self.ranges[right][1]]))
    }
    fn footnote(&mut self, label: &[u16]) -> Result<bool, Self::Error> {
        Ok(self.labels.contains(label))
    }
    fn too_deep(&mut self) -> Self::Error {
        self.host.too_deep()
    }
}
fn labels(nodes: &[Node], output: &mut BTreeSet<Vec<u16>>) {
    for node in nodes {
        if node.kind == "footnoteDefinition"
            && let Some((_, Value::String(label))) = node.fields.first()
        {
            output.insert(label.clone());
        }
        if let Some(children) = &node.children {
            labels(children, output);
        }
    }
}
fn apply_inline<H: Host>(
    nodes: &mut [Node],
    labels: &BTreeSet<Vec<u16>>,
    host: &mut H,
    depth: usize,
) -> Result<(), H::Error> {
    if depth >= 128 {
        return Err(host.too_deep());
    }
    for node in nodes {
        if let Some(source) = node.source.take() {
            let mut inline_host = InlineHost {
                host,
                labels,
                maps: vec![source.offsets],
                ranges: vec![],
            };
            let children = inline::parse(
                &source.text,
                inline::Options {
                    offsets: 0,
                    footnotes: true,
                    literal: true,
                },
                &mut inline_host,
                0,
            )?;
            node.children = Some(
                children
                    .into_iter()
                    .map(|child| inline_host.convert(child))
                    .collect(),
            );
        } else if let Some(children) = &mut node.children {
            apply_inline(children, labels, host, depth + 1)?;
        }
    }
    Ok(())
}
pub fn parse<H: Host>(
    input: &[u16],
    offset: f64,
    prefer_list: bool,
    host: &mut H,
) -> Result<Vec<Node>, H::Error> {
    let source = Mapped {
        text: input.to_vec(),
        offsets: offset_map(input, offset),
        line_break_end: None,
    };
    let mut nodes = blocks(source, prefer_list, host, 0)?;
    let mut footnotes = BTreeSet::new();
    labels(&nodes, &mut footnotes);
    apply_inline(&mut nodes, &footnotes, host, 0)?;
    Ok(nodes)
}
