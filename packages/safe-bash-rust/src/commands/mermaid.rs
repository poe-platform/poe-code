// Flowchart parsing and layout.
use super::escape_mmdc_xml as esc;
use std::{collections::BTreeMap, fmt::Write};

#[path = "mermaid/config.rs"]
pub(super) mod config;
#[path = "mermaid/groups.rs"]
mod groups;
use groups::Group;

#[path = "mermaid/labels.rs"]
mod labels;
#[path = "mermaid/pie.rs"]
pub(super) mod pie;
#[path = "mermaid/ranks.rs"]
mod ranks;
#[path = "mermaid/raster.rs"]
mod raster;
#[path = "mermaid/route.rs"]
mod route;

#[path = "mermaid/scanner.rs"]
pub(super) mod scanner;
use scanner::Statement;
#[path = "mermaid/source.rs"]
pub(super) mod source;
#[path = "mermaid/styles.rs"]
mod styles;
use styles::Styles;
pub(super) use styles::css_color;

pub(super) struct Scene {
    pub width: f64,
    pub height: f64,
    pub elements: Vec<String>,
    paint: Vec<raster::Paint>,
}
#[derive(Default)]
struct Node {
    group: Option<usize>,
    id: String,
    order: usize,
    label: String,
    shape: Shape,
    lines: Vec<String>,
    w: i32,
    h: i32,
    x: i32,
    y: i32,
    from: Vec<usize>,
    to: Vec<usize>,
    loops: usize,
    parallel: bool,
    radius: i32,
}
impl Node {
    fn center(&self, x: bool) -> i32 {
        if x {
            self.x + self.w / 2
        } else {
            self.y + self.h / 2
        }
    }
}
#[derive(Default, Clone, Copy, PartialEq)]
enum Shape {
    #[default]
    Rect,
    Rounded,
    Stadium,
    Circle,
    Diamond,
    Cylinder,
    Hexagon,
    Subroutine,
}

const ADVANCES: &[[u8; 6]] = include_bytes!("mermaid/advances.bin").as_chunks::<6>().0;
fn glyph_index(c: char) -> usize {
    let cp = c as u32;
    if let Ok(i) =
        ADVANCES.binary_search_by_key(&cp, |r| u32::from(u16::from_le_bytes([r[0], r[1]])))
    {
        i
    } else if matches!(cp,0x1100..=0x11ff|0x2e80..=0x9fff|0xac00..=0xd7af|0xf900..=0xfaff|0x1f300..=0x1faff)
    {
        ADVANCES.len() + cp as usize % 4
    } else {
        glyph_index('?')
    }
}
fn advance(c: char, bold: bool) -> u32 {
    let Some(r) = ADVANCES.get(glyph_index(c)) else {
        return 980;
    };
    let n = if bold { 4 } else { 2 };
    u16::from_le_bytes([r[n], r[n + 1]]) as u32
}
// ECMAScript switches to exponent notation at these bounds for SVG attributes and labels.
fn nonnegative_number(value: f64) -> String {
    if value >= 1e21 {
        format!("{value:e}").replace('e', "e+")
    } else if value > 0. && value < 1e-6 {
        format!("{value:e}")
    } else {
        value.abs().to_string()
    }
}
fn measure(s: &str, size: f64, bold: bool) -> f64 {
    let units = s.chars().map(|c| u64::from(advance(c, bold))).sum::<u64>() as f64;
    (units / 1000. * size * 100.).ceil() / 100.
}
fn snap(v: f64) -> i32 {
    (v / 8.).ceil() as i32 * 8
}
fn text_block(
    text: &str,
    size: f64,
    bold: bool,
    wrapping_width: f64,
    max_lines: usize,
) -> Option<(Vec<String>, f64)> {
    let mut normalized = String::with_capacity(text.len());
    let mut tail = text;
    while !tail.is_empty() {
        let skip = if tail.starts_with("\\n") || tail.starts_with("\r\n") {
            2
        } else if tail.starts_with('\r') {
            1
        } else if tail.starts_with('<') {
            ["<br>", "<br/>", "<br />"]
                .into_iter()
                .find(|tag| {
                    tail.get(..tag.len())
                        .is_some_and(|p| p.eq_ignore_ascii_case(tag))
                })
                .map_or(0, str::len)
        } else {
            0
        };
        if skip > 0 {
            normalized.push('\n');
            tail = &tail[skip..];
        } else {
            let c = tail.chars().next().unwrap();
            normalized.push(c);
            tail = &tail[c.len_utf8()..];
        }
    }
    let mut lines = Vec::new();
    let width = |units: u64| (units as f64 / 1000. * size * 100.).ceil() / 100.;
    let mut widest = 0_f64;
    let space = u64::from(advance(' ', bold));
    let mut append = |line, units| {
        if lines.len() >= max_lines {
            return None;
        }
        widest = widest.max(width(units));
        lines.push(line);
        Some(())
    };
    for raw in normalized.split('\n') {
        let mut line = String::new();
        let mut units = 0;
        for word in raw.trim().split(' ') {
            let word_units: u64 = word.chars().map(|c| u64::from(advance(c, bold))).sum();
            let candidate = units + word_units + if line.is_empty() { 0 } else { space };
            if width(candidate) <= wrapping_width {
                if !line.is_empty() {
                    line.push(' ');
                }
                line.push_str(word);
                units = candidate;
                continue;
            }
            if !line.is_empty() {
                append(std::mem::take(&mut line), units)?;
                units = 0;
            }
            for c in word.chars() {
                let add = u64::from(advance(c, bold));
                if !line.is_empty() && width(units + add) > wrapping_width {
                    append(std::mem::take(&mut line), units)?;
                    units = 0;
                }
                line.push(c);
                units += add;
            }
        }
        append(line, units)?;
    }
    Some((lines, widest))
}
fn dimensions(
    n: &mut Node,
    horizontal: bool,
    wrapping_width: f64,
    remaining_lines: &mut usize,
) -> Option<()> {
    let tallest;
    (n.lines, tallest) = text_block(&n.label, 13., false, wrapping_width, *remaining_lines)?;
    *remaining_lines -= n.lines.len();
    let text_height = n.lines.len() as f64 * 20.;
    (n.w, n.h) = match n.shape {
        Shape::Diamond => (
            snap((tallest + 36.) * 1.68).max(120),
            snap((text_height + 22.) * 1.68).max(72),
        ),
        Shape::Circle => {
            let d = snap((tallest + 28.).hypot(text_height + 24.)).max(64);
            (d, d)
        }
        Shape::Cylinder => (
            snap(tallest + 30.).max(104),
            snap(text_height + 38.).max(60),
        ),
        Shape::Hexagon | Shape::Subroutine => {
            (snap(tallest + 48.).max(88), snap(text_height + 22.).max(40))
        }
        _ => (snap(tallest + 36.).max(88), snap(text_height + 22.).max(40)),
    };
    n.radius = match n.shape {
        Shape::Circle | Shape::Stadium => n.h / 2,
        Shape::Diamond => 4,
        Shape::Rounded => 12,
        _ => 8,
    };
    let degree = n.from.len().max(n.to.len());
    if degree > 4 {
        let min = snap(((degree - 1) * 12 + 36) as f64);
        if horizontal {
            n.h = n.h.max(min);
        } else {
            n.w = n.w.max(min);
        }
    }
    if n.parallel {
        n.w = n.w.max(128);
        n.h = n.h.max(64);
    }
    Some(())
}
const EDGE_OPS: &[&str] = &[
    "<-.->", "<-->", "<==>", "-..->", "-.->", "--->", "===>", "-.-", "-->", "---", "==>", "===",
    "--x", "--o",
];

pub(super) fn position(source: &str, at: &str) -> (usize, usize) {
    // The statement and token are slices of the original UTF-8 source. Mermaid
    // reports one-based UTF-16 columns, including indentation and the header.
    let offset = at.as_ptr() as usize - source.as_ptr() as usize;
    let before = &source[..offset];
    let line = 1 + before.bytes().filter(|b| *b == b'\n').count();
    let column = 1 + before
        .rsplit('\n')
        .next()
        .unwrap_or("")
        .encode_utf16()
        .count();
    (line, column)
}
fn identifier_len(s: &str, class: bool) -> usize {
    s.char_indices()
        .find(|&(i, c)| {
            !(c.is_alphanumeric()
                || !c.is_ascii()
                || matches!(c, '_' | '.')
                || (class && c == ',')
                || (c == '-' && !EDGE_OPS.iter().any(|op| s[i..].starts_with(op))))
        })
        .map_or(s.len(), |(i, _)| i)
}
fn parse_node<'a>(
    s: &'a str,
    stmt: &Statement,
    styles: &mut Styles<'a>,
    group_id: Option<usize>,
    nodes: &mut Vec<Node>,
    ids: &mut BTreeMap<String, usize>,
) -> Result<(usize, &'a str), String> {
    let s = s.trim_start();
    let end = identifier_len(s, false);
    if end == 0 {
        let text = String::from_utf16_lossy(&s.encode_utf16().take(16).collect::<Vec<_>>());
        return Err(stmt.error(
            "E_SYNTAX",
            s,
            &format!("Expected node identifier at '{text}'"),
        ));
    }
    let id = &s[..end];
    let i = *ids.entry(id.into()).or_insert_with(|| {
        nodes.push(Node {
            id: id.into(),
            order: nodes.len(),
            label: id.into(),
            ..Node::default()
        });
        nodes.len() - 1
    });
    nodes[i].group = nodes[i].group.or(group_id);
    let mut rest = &s[end..];
    let mut raw_label = None;
    for (open, close, shape) in [
        ("((", "))", Shape::Circle),
        ("([", "])", Shape::Stadium),
        ("[(", ")]", Shape::Cylinder),
        ("[[", "]]", Shape::Subroutine),
        ("{{", "}}", Shape::Hexagon),
        ("[", "]", Shape::Rect),
        ("(", ")", Shape::Rounded),
        ("{", "}", Shape::Diamond),
    ] {
        if let Some(tail) = rest.strip_prefix(open) {
            let mut quote = None;
            let mut chars = tail.char_indices();
            let closing = loop {
                let Some((pos, c)) = chars.next() else {
                    return Err(stmt.error(
                        "E_SYNTAX",
                        s,
                        &format!("Unclosed node shape '{open}...{close}'"),
                    ));
                };
                if let Some(q) = quote {
                    if c == '\\' {
                        chars.next();
                    } else if c == q {
                        quote = None;
                    }
                } else if matches!(c, '\'' | '"') {
                    quote = Some(c);
                } else if tail[pos..].starts_with(close) {
                    break pos;
                }
            };
            let after = &tail[closing + close.len()..];
            raw_label = Some(&tail[..closing]);
            nodes[i].shape = shape;
            rest = after;
            break;
        }
    }
    if let Some(classes) = rest.strip_prefix(":::") {
        let len = identifier_len(classes, true);
        let mut names = classes[..len]
            .split(',')
            .filter(|n| !n.is_empty())
            .peekable();
        if names.peek().is_none() {
            return Err(stmt.error("E_SYNTAX", s, "Missing inline class name"));
        }
        for name in names {
            styles.assign(id, name)?;
        }
        rest = &classes[len..];
    }
    if let Some(raw) = raw_label {
        nodes[i].label = scanner::label(raw, stmt, s)?;
    }
    Ok((i, rest.trim_start()))
}
fn parse_group<'a>(
    mut rest: &'a str,
    stmt: &Statement,
    styles: &mut Styles<'a>,
    group_id: Option<usize>,
    nodes: &mut Vec<Node>,
    ids: &mut BTreeMap<String, usize>,
) -> Result<(Vec<usize>, &'a str), String> {
    let mut group = Vec::new();
    loop {
        let (node, tail) = parse_node(rest, stmt, styles, group_id, nodes, ids)?;
        group.push(node);
        let Some(next) = tail.strip_prefix('&') else {
            return Ok((group, tail));
        };
        rest = next;
    }
}
fn interaction_href(source: &str) -> Result<Option<&str>, String> {
    let text = source.trim();
    let text = text.strip_prefix("href ").map(str::trim).unwrap_or(text);
    let Some(quote) = text.chars().next().filter(|q| matches!(q, '\'' | '"')) else {
        return Ok(None);
    };
    let tail = &text[1..];
    let Some(end) = tail
        .match_indices(quote)
        .find_map(|(i, _)| (!tail[..i].ends_with('\\')).then_some(i))
    else {
        return Err("mmdc: E_SYNTAX: Unclosed link URL\n".into());
    };
    let href = &tail[..end];
    if let Some((scheme, _)) = href.split_once(':')
        && !["http", "https", "mailto"]
            .iter()
            .any(|s| s.eq_ignore_ascii_case(scheme))
    {
        return Err("mmdc: E_UNSUPPORTED: Unsupported link URL scheme\n".into());
    }
    Ok(Some(href))
}
type Edge<'a> = (usize, usize, &'a str, Option<Pill>);
#[derive(Clone)]
struct Pill {
    size: f64,
    weight: u16,
    radius: i32,
    width: f64,
    height: f64,
    rank_size: (f64, f64),
    lines: Vec<String>,
}
impl Pill {
    fn new(label: &str, wrapping_width: f64, max_lines: usize) -> Option<Self> {
        let short = label.len() <= 4
            && label
                .bytes()
                .all(|b| b.is_ascii_digit() || b".*nN".contains(&b));
        let (size, weight, radius, pad) = if short {
            (11., 600, 4, 16.)
        } else {
            (11.5, 500, 5, 18.)
        };
        let (lines, text_width) = text_block(label, size, short, wrapping_width, max_lines)?;
        let rank_size = if short {
            let (rank_lines, w) = text_block(label, 11.5, false, wrapping_width, 4)?;
            (w, rank_lines.len() as f64 * 16.)
        } else {
            (text_width, lines.len() as f64 * 16.)
        };
        Some(Self {
            size,
            weight,
            radius,
            width: (text_width + pad).ceil(),
            height: lines.len() as f64 * 16. + 7.,
            rank_size,
            lines,
        })
    }
}
const FONT: &str = "Inter, -apple-system, BlinkMacSystemFont, &#39;Segoe UI&#39;, Roboto, Helvetica, Arial, sans-serif";
pub(super) struct Flowchart<'a> {
    groups: Vec<Group>,
    nodes: Vec<Node>,
    edges: Vec<Edge<'static>>,
    hrefs: BTreeMap<&'a str, &'a str>,
    styles: Styles<'a>,
    dir: &'a str,
    remaining_lines: usize,
    wrapping_width: f64,
}

pub(super) fn parse<'a>(
    lines: &'a [Statement],
    title: &mut Option<String>,
    description: &mut Option<String>,
    wrapping_width: f64,
    limit: usize,
) -> Option<Result<Flowchart<'a>, String>> {
    let mut stmts = lines.iter();
    let header_stmt = stmts.next()?;
    let header = header_stmt.text.trim_end();
    let keyword = header.split_ascii_whitespace().next()?;
    if !matches!(keyword, "graph" | "flowchart") {
        return None;
    }
    let valid_direction = |value: &str| matches!(value, "TB" | "TD" | "BT" | "LR" | "RL");
    let rest = header[keyword.len()..].trim_start();
    let mut dir = "TB";
    if let Some(word) = rest.split_ascii_whitespace().next() {
        if !valid_direction(word) {
            return Some(Err(header_stmt.error(
                "E_SYNTAX",
                word,
                &format!("Invalid flowchart direction '{word}'. Supported: TB, TD, BT, LR, RL"),
            )));
        }
        dir = word;
        let trailing = rest[word.len()..].trim_start();
        if !trailing.is_empty() {
            return Some(Err(header_stmt.error(
                "E_SYNTAX",
                trailing,
                &format!("Unexpected tokens after flowchart header: '{trailing}'"),
            )));
        }
    }
    let mut groups = Vec::<Group>::new();
    let mut current = None;
    let mut auto = 0;
    let mut hrefs = BTreeMap::new();
    let mut styles = Styles::new(limit);
    let mut nodes = Vec::new();
    let mut ids = BTreeMap::new();
    let mut edges = vec![];
    let mut label_bytes = 0usize;
    // Each line generates a text element and a raster draw operation.
    let mut remaining_lines = limit / 256;
    for stmt in stmts {
        let text = stmt.text.trim_end();
        let keyword = text.split_ascii_whitespace().next()?;
        match stmt.read_metadata(title, description) {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => return Some(Err(error)),
        }
        if keyword == "direction" {
            let value = text["direction".len()..].trim();
            if !valid_direction(value) {
                return Some(Err(stmt.error(
                    "E_SYNTAX",
                    text,
                    &format!("Invalid direction '{value}'"),
                )));
            }
            if current.is_none() {
                dir = value;
            }
            continue;
        }
        if matches!(keyword, "click" | "callback") {
            if let Err(error) = scanner::check_label(text, stmt, text) {
                return Some(Err(error));
            }
            if keyword == "click" {
                let rest = text[keyword.len()..].trim();
                if let Some(id) = rest.split_ascii_whitespace().next() {
                    match interaction_href(&rest[id.len()..]) {
                        Ok(Some(href)) => {
                            hrefs.insert(id, href);
                        }
                        Ok(None) => {}
                        Err(error) => return Some(Err(error)),
                    }
                }
            }
            continue;
        }
        if matches!(keyword, "class" | "style" | "classDef" | "linkStyle") {
            if let Err(error) = styles.declaration(keyword, text, stmt) {
                return Some(Err(error));
            }
            continue;
        }
        if keyword == "subgraph" {
            let index = groups.len();
            if index >= limit / 300 {
                return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
            }
            match Group::parse(text, stmt, index, &groups, current, &mut auto) {
                Ok(group) => groups.push(group),
                Err(error) => return Some(Err(error)),
            }
            current = Some(index);
            continue;
        }
        if keyword == "end" {
            let tail = text[3..].trim();
            if !tail.is_empty() {
                return Some(Err(stmt.error(
                    "E_SYNTAX",
                    text,
                    &format!("Unexpected tokens after 'end': '{tail}'"),
                )));
            }
            let Some(index) = current else {
                return Some(Err(stmt.error(
                    "E_SYNTAX",
                    text,
                    "Unexpected 'end' without matching 'subgraph'",
                )));
            };
            current = groups[index].parent;
            continue;
        }
        let (mut sources, mut rest) =
            match parse_group(text, stmt, &mut styles, current, &mut nodes, &mut ids) {
                Ok(node) => node,
                Err(error) => return Some(Err(error)),
            };
        while !rest.is_empty() {
            let (op, tail, label) = if let Some(op) =
                EDGE_OPS.iter().copied().find(|op| rest.starts_with(op))
            {
                let tail = rest[op.len()..].trim_start();
                if let Some(tail) = tail.strip_prefix('|') {
                    let Some((label, tail)) = tail.split_once('|') else {
                        return Some(Err(stmt.error(
                            "E_SYNTAX",
                            rest,
                            "Unclosed edge label pipe '|'",
                        )));
                    };
                    (op, tail, label.trim())
                } else {
                    (op, tail, "")
                }
            } else if let Some(t) = rest.strip_prefix("--") {
                let (label, tail) = t.split_once("-->")?;
                ("-->", tail, label.trim())
            } else {
                if nodes[*sources.last()?].id.ends_with("--")
                    || rest.starts_with('{')
                    || rest.starts_with(':')
                {
                    let text =
                        String::from_utf16_lossy(&rest.encode_utf16().take(24).collect::<Vec<_>>());
                    return Some(Err(stmt.error(
                        "E_SYNTAX",
                        rest,
                        &format!("Unexpected flowchart syntax near '{text}'"),
                    )));
                }
                return None;
            };
            let label = match scanner::label(label, stmt, rest) {
                Ok(label) => label,
                Err(error) => return Some(Err(error)),
            };
            let (targets, tail) =
                match parse_group(tail, stmt, &mut styles, current, &mut nodes, &mut ids) {
                    Ok(group) => group,
                    Err(error) => return Some(Err(error)),
                };
            let count = sources.len().saturating_mul(targets.len());
            label_bytes = label_bytes.saturating_add(label.len().saturating_mul(count));
            if edges.len().saturating_add(count) > limit / 300 || label_bytes > limit {
                return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
            }
            let pill = if label.is_empty() {
                None
            } else {
                let Some(pill) = Pill::new(&label, wrapping_width, remaining_lines / count) else {
                    return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
                };
                remaining_lines -= pill.lines.len() * count;
                Some(pill)
            };
            for &a in &sources {
                for &b in &targets {
                    if a == b {
                        nodes[a].loops += 1;
                    } else {
                        nodes[a].to.push(b);
                        nodes[b].from.push(a);
                    }
                    edges.push((a, b, op, pill.clone()));
                }
            }
            sources = targets;
            rest = tail;
        }
    }
    if let Some(index) = current {
        return Some(Err(header_stmt.error(
            "E_SYNTAX",
            header,
            &format!("Unclosed subgraph '{}' at end of diagram", groups[index].id),
        )));
    }
    if nodes.len() > limit / 300 {
        return None;
    }
    Some(Ok(Flowchart {
        groups,
        nodes,
        edges,
        hrefs,
        styles,
        dir,
        remaining_lines,
        wrapping_width,
    }))
}

pub(super) fn layout(
    graph: Flowchart<'_>,
    theme: &str,
    prefix: &str,
    title: Option<&str>,
    gaps: (f64, f64),
    padding: f64,
    limit: usize,
) -> Option<Result<Scene, String>> {
    let Flowchart {
        mut groups,
        mut nodes,
        edges,
        hrefs,
        mut styles,
        dir,
        mut remaining_lines,
        wrapping_width,
    } = graph;
    let mut pairs = BTreeMap::new();
    for &(a, b, _, _) in &edges {
        if a != b {
            let total = pairs.entry((a.min(b), a.max(b))).or_insert(0);
            *total += 1;
            if *total > 1 {
                nodes[a].parallel = true;
                nodes[b].parallel = true;
            }
        }
    }
    let horizontal = matches!(dir, "LR" | "RL");
    let reversed = matches!(dir, "BT" | "RL");
    for n in &mut nodes {
        if dimensions(n, horizontal, wrapping_width, &mut remaining_lines).is_none() {
            return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
        }
    }
    if ranks::place(
        &mut nodes, &edges, &groups, horizontal, reversed, gaps, limit,
    )
    .is_none()
    {
        return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
    }
    let Some(group_order) = groups::place(&mut groups, &mut nodes, limit) else {
        return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
    };
    if (!groups.is_empty() || (!horizontal && gaps.0 < 24.))
        && let Err(error) = groups::verify_nodes(&nodes, horizontal, limit)
    {
        return Some(Err(error));
    }
    let Some(route::Routes {
        paths: mut waypoints,
        intersection,
    }) = route::waypoints(&nodes, &groups, &edges, &pairs, horizontal, reversed, limit)
    else {
        return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
    };
    let positions = match labels::place(&nodes, &groups, &edges, &waypoints, limit) {
        Ok(p) => p,
        Err(error) => return Some(Err(error)),
    };
    if let Err(error) = groups::verify(&groups, &group_order, &nodes, &positions, limit) {
        return Some(Err(error));
    }
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    let mut include = |x: f64, y: f64, w: f64, h: f64| {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
    };
    for [x, y, w, h] in groups
        .iter()
        .map(|g| g.bounds)
        .chain(nodes.iter().map(|n| [n.x, n.y, n.w, n.h]))
    {
        include(x.into(), y.into(), w.into(), h.into());
    }
    for &(x, y) in waypoints.iter().flatten() {
        include(x - 4., y - 4., 8., 8.);
    }
    for &[x, y, w, h] in positions.iter().flatten() {
        include(x, y, w, h);
    }
    if !min_x.is_finite() {
        (min_x, min_y, max_x, max_y) = (0., 0., 120., 80.);
    }
    if padding > f64::from(i32::MAX / 4) {
        return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
    }
    let mut width = (max_x - min_x + 2. * padding).ceil();
    let mut height = (max_y - min_y + 2. * padding).ceil();
    let (dx, dy) = (
        (padding - min_x + 0.5).floor() as i32,
        (padding - min_y + 0.5).floor() as i32,
    );
    if dx != 0 || dy != 0 {
        for n in &mut nodes {
            n.x += dx;
            n.y += dy;
        }
        for p in waypoints.iter_mut().flatten() {
            p.0 = route::hundredth(p.0 + f64::from(dx));
            p.1 = route::hundredth(p.1 + f64::from(dy));
        }
    }
    if title.is_some() && padding < 24. {
        for n in &nodes {
            let clearance = height - f64::from(n.y + n.h);
            if clearance < 23.99 {
                return Some(Err(format!(
                    "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 1 (node clearance): nodes '{}' and 'mmdc_title' have clearance {clearance:.2}px (< 24px)\n",
                    n.id
                )));
            }
        }
    }
    let dark = theme == "dark";
    let edge = if dark { "#94a3b8" } else { "#64748b" };
    let mut elements = vec![];
    let mut pills = Vec::new();
    use crate::commands::archive::parse_color;
    use raster::{BoxStyle, Paint};
    let mut paint = Vec::new();
    if !groups.is_empty()
        && waypoints
            .iter()
            .map(Vec::len)
            .sum::<usize>()
            .saturating_mul(groups.len())
            > limit
    {
        return Some(Err("mmdc: E_LIMIT: Render work budget exceeded\n".into()));
    }
    for (idx, group) in group_order.into_iter().enumerate() {
        elements.push(groups[group].paint(idx, prefix, dark, (dx, dy), &waypoints, &mut paint));
    }
    let mut edge_paint = Vec::new();
    let mut pill_paint = Vec::new();
    let edge_color = parse_color(edge).unwrap();
    let shadow = if dark {
        [0, 0, 0, 89]
    } else {
        [15, 23, 42, 15]
    };
    for (idx, ((a, b, op, label), mut points)) in edges.into_iter().zip(waypoints).enumerate() {
        let styled = styles.edge(idx);
        let (edge, edge_color) = styled.stroke.unwrap_or((edge, edge_color));
        if let Err(error) = styles.charge_colors(&[
            (styled.stroke, 5),
            (styled.color, label.as_ref().map_or(0, |p| p.lines.len())),
        ]) {
            return Some(Err(error));
        }
        let (x, y) = points[0];
        let (ex, ey) = *points.last()?;
        let next = points[1];
        let prev = points[points.len() - 2];
        let start_angle = (y - next.1).atan2(x - next.0);
        let angle = (ey - prev.1).atan2(ex - prev.0);
        if let Some(message) = route::attachment_error(&points, &nodes[a], &nodes[b], idx + 1) {
            return Some(Err(format!(
                "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 4 {message}\n"
            )));
        }
        let arrow = op.ends_with('>');
        let start_arrow = op.starts_with('<');
        let stroke = styled
            .width
            .unwrap_or(if op.contains("==") { 2.25 } else { 1.25 });
        let dash = if op.contains('.') {
            r#" stroke-dasharray="5 4""#
        } else {
            ""
        };
        let route = route::Route::rounded(&mut points, start_arrow, arrow);
        let path = route.svg();
        edge_paint.push(Paint::Edge {
            route,
            stroke: edge_color,
            width: stroke,
            dashed: !dash.is_empty(),
        });
        let marker =
            |x: f64, y: f64, angle: f64, local: &[(f64, f64)], filled: bool, width: f64| {
                let (sin, cos) = angle.sin_cos();
                Paint::Path {
                    points: local
                        .iter()
                        .map(|&(a, b)| (x + (a * cos - b * sin), y + (a * sin + b * cos)))
                        .collect(),
                    fill: filled.then_some(edge_color),
                    stroke: edge_color,
                    width,
                    dashed: false,
                }
            };
        let stroke = nonnegative_number(stroke);
        let mut el = format!(
            r#"<g class="mmdc-edge" data-id="edge_{}"><path d="{path}" fill="none" stroke="{edge}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"{dash}/>"#,
            idx + 1
        );
        let degrees = |angle: f64| ((angle.to_degrees() * 100. + 0.5).floor()) / 100.;
        for (show, ex, ey, angle) in [(start_arrow, x, y, start_angle), (arrow, ex, ey, angle)] {
            if show {
                edge_paint.push(marker(
                    ex,
                    ey,
                    angle,
                    &[(-9., -3.5), (0., 0.), (-9., 3.5), (-6.8, 0.)],
                    true,
                    0.9,
                ));
                let angle = degrees(angle);
                write!(el,r#"<g transform="translate({ex}, {ey}) rotate({angle})"><path d="M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z" transform="translate(-9, -3.5)" fill="{edge}" stroke="{edge}" stroke-width="1" stroke-linejoin="round"/></g>"#).ok()?;
            }
        }
        if op == "--o" {
            edge_paint.push(marker(
                ex,
                ey,
                angle,
                &[(-8., -3.5), (0., 0.), (-8., 3.5)],
                false,
                1.5,
            ));
        } else if op == "--x" {
            for points in [[(-9., -4.), (-1., 4.)], [(-9., 4.), (-1., -4.)]] {
                edge_paint.push(marker(ex, ey, angle, &points, false, 1.75));
            }
        }
        let angle = degrees(angle);
        match op {
            "--o" => write!(el,r#"<g transform="translate({ex}, {ey}) rotate({angle})"><path d="M -8 -3.5 L 0 0 L -8 3.5" fill="none" stroke="{edge}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>"#).ok()?,
            "--x" => write!(el,r#"<g transform="translate({ex}, {ey}) rotate({angle})"><path d="M -9 -4 L -1 4 M -9 4 L -1 -4" fill="none" stroke="{edge}" stroke-width="1.75" stroke-linecap="round"/></g>"#).ok()?,
            _ => {}
        }
        if let (
            Some([px, py, w, h]),
            Some(Pill {
                size,
                weight,
                radius: rx,
                lines,
                ..
            }),
        ) = (positions[idx], label)
        {
            let short = weight == 600;
            let left = px + f64::from(dx);
            let top = py + f64::from(dy);
            let (fill, border, color) = if dark {
                ("#1e293b", "#334155", "#f8fafc")
            } else {
                ("#ffffff", "#e2e8f0", "#0f172a")
            };
            let (color, text_rgba) = styled
                .color
                .unwrap_or_else(|| (color, parse_color(color).unwrap()));
            pill_paint.push(Paint::Box {
                bounds: [left, top, w, h],
                shape: Shape::Rounded,
                shadow: None,
                style: BoxStyle {
                    header: None,
                    radius: f64::from(rx),
                    fill: parse_color(fill).unwrap(),
                    border: parse_color(border).unwrap(),
                    thickness: 1.,
                },
            });
            let mut pill = format!(
                r#"<g class="mmdc-label-pill"><rect x="{left}" y="{top}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{border}" stroke-width="1"/>"#
            );
            let cx = (left + w / 2.).round();
            for (i, text) in lines.into_iter().enumerate().filter(|(_, t)| !t.is_empty()) {
                let baseline = top + if short { 14. } else { 15. } + i as f64 * 16.;
                write!(pill,r#"<text x="{cx}" y="{baseline}" fill="{color}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,esc(&text)).ok()?;
                pill_paint.push(Paint::Text {
                    start: cx - measure(&text, size, short) / 2.,
                    baseline,
                    size,
                    weight,
                    color: text_rgba,
                    text,
                });
            }
            pill.push_str("</g>");
            pills.push(pill);
        }
        el.push_str("</g>");
        elements.push(el);
    }
    if let Some(error) = intersection {
        return Some(Err(error));
    }
    for n in nodes {
        let (x, y, w, h) = (n.x, n.y, n.w, n.h);
        let cx = x + w / 2;
        let cy = y + h / 2;
        let accent = match theme {
            "dark" => ("#172554", "#3b82f6", "#dbeafe"),
            "forest" => ("#f0fdf4", "#4ade80", "#166534"),
            "neutral" => ("#f1f5f9", "#94a3b8", "#334155"),
            _ => ("#eff6ff", "#60a5fa", "#1e3a8a"),
        };
        let (fill, border, color) =
            if matches!(n.shape, Shape::Rect | Shape::Rounded | Shape::Subroutine) {
                if dark {
                    ("#1e293b", "#334155", "#f8fafc")
                } else {
                    ("#ffffff", "#cbd5e1", "#0f172a")
                }
            } else {
                accent
            };
        let styled = styles.node(&n.id);
        if let Err(error) = styles.charge_colors(&[
            (styled.fill, 1),
            (styled.stroke, 2),
            (styled.color, n.lines.len()),
        ]) {
            return Some(Err(error));
        }
        let (fill, fill_rgba) = styled
            .fill
            .unwrap_or_else(|| (fill, parse_color(fill).unwrap()));
        let (border, border_rgba) = styled
            .stroke
            .unwrap_or_else(|| (border, parse_color(border).unwrap()));
        let (color, text_rgba) = styled
            .color
            .unwrap_or_else(|| (color, parse_color(color).unwrap()));
        let thickness = styled.width.unwrap_or(1.25);
        let radius = n.radius;
        paint.push(Paint::Box {
            bounds: [x.into(), y.into(), w.into(), h.into()],
            shape: n.shape,
            shadow: Some(shadow),
            style: BoxStyle {
                header: None,
                radius: radius.into(),
                fill: fill_rgba,
                border: border_rgba,
                thickness,
            },
        });
        let join = if matches!(n.shape, Shape::Cylinder | Shape::Hexagon) {
            r#" stroke-linejoin="round""#
        } else {
            ""
        };
        let thickness = nonnegative_number(thickness);
        let style = format!(
            r#"fill="{fill}" stroke="{border}" stroke-width="{thickness}"{join} filter="url(#{prefix}mmdc-shadow)""#
        );
        let mut el = format!(r#"<g class="mmdc-node" data-id="{}">"#, esc(&n.id));
        match n.shape {
            Shape::Cylinder => {
                let rx = w / 2;
                let ry = ((f64::from(w) * 0.075).round() as i32).clamp(9, 11);
                let top = y + ry;
                let bottom = y + h - ry;
                let right = x + w;
                let lid = if fill.eq_ignore_ascii_case("#172554") {
                    "#1e3a8a"
                } else {
                    "#dbeafe"
                };
                write!(el,r#"<path d="M {x} {top} A {rx} {ry} 0 0 1 {right} {top} L {right} {bottom} A {rx} {ry} 0 0 1 {x} {bottom} Z" {style}/><ellipse cx="{cx}" cy="{top}" rx="{rx}" ry="{ry}" fill="{lid}" stroke="{border}" stroke-width="{thickness}"/>"#).ok()?;
            }
            Shape::Hexagon => {
                let left = x + 12;
                let right = x + w;
                let inset = right - 12;
                let bottom = y + h;
                write!(el,r#"<polygon points="{left},{y} {inset},{y} {right},{cy} {inset},{bottom} {left},{bottom} {x},{cy}" {style}/>"#).ok()?;
            }
            Shape::Circle => write!(
                el,
                r#"<circle cx="{cx}" cy="{cy}" r="{}" {style}/>"#,
                w.min(h) / 2
            )
            .ok()?,
            Shape::Diamond => {
                let mut path = String::new();
                let (wx, hy) = (w as f64 / 2., h as f64 / 2.);
                let len = wx.hypot(hy);
                let (ox, oy) = (wx / len * 4., hy / len * 4.);
                let p = |px: i32, py: i32, dx: f64, dy: f64| {
                    format!(
                        "{} {}",
                        ((px as f64 + dx) * 100.).round() / 100.,
                        ((py as f64 + dy) * 100.).round() / 100.
                    )
                };
                let start = p(cx, y, ox, oy);
                write!(path, "M {start}").ok()?;
                for (px, py, ax, ay, bx, by) in [
                    (x + w, cy, -ox, -oy, -ox, oy),
                    (cx, y + h, ox, -oy, -ox, -oy),
                    (x, cy, ox, oy, ox, -oy),
                    (cx, y, -ox, oy, ox, oy),
                ] {
                    write!(
                        path,
                        " L {} Q {px} {py} {}",
                        p(px, py, ax, ay),
                        p(px, py, bx, by)
                    )
                    .ok()?;
                }
                write!(el, r#"<path d="{path} Z" {style}/>"#).ok()?;
            }
            _ => {
                let rx = radius;
                write!(
                    el,
                    r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" {style}/>"#
                )
                .ok()?;
            }
        }
        if n.shape == Shape::Subroutine {
            for pos in [x + 11, x + w - 11] {
                paint.push(Paint::Path {
                    points: vec![(pos.into(), y.into()), (pos.into(), (y + h).into())],
                    fill: None,
                    stroke: parse_color(accent.1).unwrap(),
                    width: 1.5,
                    dashed: false,
                });
                write!(el,r#"<line x1="{pos}" y1="{y}" x2="{pos}" y2="{}" stroke="{}" stroke-width="1"/>"#,y+h,accent.1).ok()?;
            }
        }
        let first_y =
            cy - (n.lines.len() as i32) * 10 + 14 + if n.shape == Shape::Cylinder { 8 } else { 0 };
        for (i, line) in n.lines.iter().enumerate() {
            if !line.is_empty() {
                paint.push(Paint::Text {
                    start: f64::from(cx) - measure(line, 13., false) / 2.,
                    baseline: f64::from(first_y + i as i32 * 20),
                    size: 13.,
                    weight: 500,
                    color: text_rgba,
                    text: line.clone(),
                });
                write!(el,r#"<text x="{cx}" y="{}" fill="{color}" font-family="{FONT}" font-size="13" font-weight="500" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,first_y+i as i32*20,esc(line)).ok()?;
            }
        }
        el.push_str("</g>");
        if let Some(href) = hrefs.get(n.id.as_str()) {
            el = format!(r#"<a href="{}">{el}</a>"#, esc(href));
        }
        elements.push(el);
    }
    if let Some(t) = title {
        let text_width = measure(t, 16., true);
        width = width.max(text_width + 2. * padding);
        let fill = if dark { "#1e293b" } else { "#ffffff" };
        let color = if dark { "#f8fafc" } else { "#0f172a" };
        paint.push(Paint::Box {
            bounds: [padding, height, width - 2. * padding, 24.],
            shape: Shape::Rect,
            shadow: None,
            style: BoxStyle {
                header: None,
                radius: 0.,
                fill: parse_color(fill).unwrap(),
                border: [0; 4],
                thickness: 0.,
            },
        });
        paint.push(Paint::Text {
            start: (width - text_width) / 2.,
            baseline: height + 18.,
            size: 16.,
            weight: 600,
            color: parse_color(color).unwrap(),
            text: t.into(),
        });
        elements.push(format!(r#"<g class="mmdc-node" data-id="mmdc_title"><rect x="{padding}" y="{height}" width="{}" height="24" rx="0" fill="{fill}" stroke="transparent" stroke-width="0"/><text x="{}" y="{}" fill="{color}" font-family="{FONT}" font-size="16" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{}</text></g>"#, width-2.*padding,width/2.,height+18.,esc(t)));
        height += 24. + padding;
    }
    elements.extend(pills);
    paint.extend(edge_paint);
    paint.extend(pill_paint);
    Some(Ok(Scene {
        width,
        height,
        paint,
        elements,
    }))
}
