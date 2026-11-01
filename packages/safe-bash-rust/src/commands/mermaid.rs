// Flowchart layout for unbranched paths and standalone declarations.
use super::escape_mmdc_xml as esc;
use std::{collections::BTreeMap, fmt::Write};

pub(super) struct Scene {
    pub width: f64,
    pub height: f64,
    pub elements: Vec<String>,
}
#[derive(Default)]
struct Node {
    id: String,
    label: String,
    shape: Shape,
    lines: Vec<String>,
    w: i32,
    h: i32,
    x: i32,
    y: i32,
    from: Option<usize>,
    to: Option<usize>,
}
#[derive(Default, Clone, Copy, PartialEq)]
enum Shape {
    #[default]
    Rect,
    Rounded,
    Stadium,
    Circle,
    Diamond,
}

fn advance(c: char, bold: bool) -> u32 {
    // Little-endian code point, regular advance and bold advance from the UI and
    // fallback mono hmtx tables, including each face's tracking.
    let widths = include_bytes!("mermaid/advances.bin").as_chunks::<6>().0;
    let cp = c as u32;
    if let Ok(i) = widths.binary_search_by_key(&cp, |r| u16::from_le_bytes([r[0], r[1]]) as u32) {
        let n = if bold { 4 } else { 2 };
        u16::from_le_bytes([widths[i][n], widths[i][n + 1]]) as u32
    } else if matches!(cp,0x1100..=0x11ff|0x2e80..=0x9fff|0xac00..=0xd7af|0xf900..=0xfaff|0x1f300..=0x1faff)
    {
        980
    } else {
        advance('?', bold)
    }
}
fn measure(s: &str) -> f64 {
    (s.chars().map(|c| u64::from(advance(c, false))).sum::<u64>() as f64 * 1.3).ceil() / 100.
}
fn snap(v: f64) -> i32 {
    (v / 8.).ceil() as i32 * 8
}
fn dimensions(n: &mut Node) {
    let mut tallest = 0.;
    let label = n
        .label
        .replace("\\n", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n");
    for l in label.lines() {
        let mut line = String::new();
        for word in l.split_whitespace() {
            let width = measure(word);
            if !line.is_empty() && measure(&line) + measure(" ") + width > 200. {
                n.lines.push(std::mem::take(&mut line));
            } else if !line.is_empty() {
                line.push(' ');
            }
            for c in word.chars() {
                if !line.is_empty() && measure(&line) + f64::from(advance(c, false)) * 0.013 > 200.
                {
                    n.lines.push(std::mem::take(&mut line));
                }
                line.push(c);
            }
        }
        n.lines.push(line);
    }
    for l in &n.lines {
        tallest = f64::max(tallest, measure(l));
    }
    let text_height = n.lines.len().max(1) as f64 * 20.;
    (n.w, n.h) = match n.shape {
        Shape::Diamond => (
            snap((tallest + 36.) * 1.68).max(120),
            snap((text_height + 22.) * 1.68).max(72),
        ),
        Shape::Circle => {
            let d = snap((tallest + 28.).hypot(text_height + 24.)).max(64);
            (d, d)
        }
        _ => (snap(tallest + 36.).max(88), snap(text_height + 22.).max(40)),
    }
}
fn parse_node<'a>(
    s: &'a str,
    nodes: &mut Vec<Node>,
    ids: &mut BTreeMap<String, usize>,
) -> Option<(usize, &'a str)> {
    let s = s.trim_start();
    let end = s
        .char_indices()
        .find(|&(i, c)| {
            !(c.is_alphanumeric()
                || c == '_'
                || (c == '-' && !s[i..].starts_with("--") && !s[i..].starts_with("-.")))
        })
        .map_or(s.len(), |(i, _)| i);
    if end == 0 || end > 4096 {
        return None;
    }
    let id = &s[..end];
    let i = *ids.entry(id.into()).or_insert_with(|| {
        nodes.push(Node {
            id: id.into(),
            label: id.into(),
            ..Node::default()
        });
        nodes.len() - 1
    });
    let mut rest = s[end..].trim_start();
    for (open, close, shape) in [
        ("((", "))", Shape::Circle),
        ("([", "])", Shape::Stadium),
        ("[", "]", Shape::Rect),
        ("(", ")", Shape::Rounded),
        ("{", "}", Shape::Diamond),
    ] {
        if let Some(tail) = rest.strip_prefix(open) {
            let (label, after) = tail.split_once(close)?;
            nodes[i].label = label.trim().trim_matches('"').to_owned();
            nodes[i].shape = shape;
            rest = after.trim_start();
            break;
        }
    }
    Some((i, rest))
}
const FONT: &str = "Inter, -apple-system, BlinkMacSystemFont, &#39;Segoe UI&#39;, Roboto, Helvetica, Arial, sans-serif";
pub(super) fn layout(
    lines: &[String],
    theme: &str,
    prefix: &str,
    title: Option<&str>,
    limit: usize,
) -> Option<Scene> {
    let mut stmts = lines
        .iter()
        .flat_map(|l| l.split(';'))
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let mut header = stmts.next()?.split_whitespace();
    if !matches!(header.next()?, "graph" | "flowchart") {
        return None;
    }
    let dir = header.next().unwrap_or("TD");
    if !matches!(dir, "TB" | "TD" | "BT" | "LR" | "RL") || header.next().is_some() {
        return None;
    }
    let horizontal = matches!(dir, "LR" | "RL");
    let reversed = matches!(dir, "BT" | "RL");
    let mut nodes = Vec::new();
    let mut ids = BTreeMap::new();
    let mut edges = vec![];
    for stmt in stmts {
        let (mut a, mut rest) = parse_node(stmt, &mut nodes, &mut ids)?;
        while !rest.is_empty() {
            let op = ["-->", "---", "-.->", "==>"]
                .into_iter()
                .find(|op| rest.starts_with(op))?;
            let (b, tail) = parse_node(&rest[op.len()..], &mut nodes, &mut ids)?;
            if nodes[a].to.is_some() || nodes[b].from.is_some() {
                return None;
            }
            nodes[a].to = Some(b);
            nodes[b].from = Some(a);
            edges.push((a, b, op));
            a = b;
            rest = tail;
        }
    }
    if nodes.len() > limit / 300 {
        return None;
    }
    for n in &mut nodes {
        dimensions(n);
    }
    let mut order = Vec::new();
    if !edges.is_empty() {
        if edges.len() + 1 != nodes.len() {
            return None;
        }
        let mut at = Some(nodes.iter().position(|n| n.from.is_none())?);
        while let Some(i) = at {
            order.push(i);
            at = nodes[i].to;
        }
        if order.len() != nodes.len() {
            return None;
        }
    } else {
        order.extend(0..nodes.len());
    }
    // Isolated nodes share a rank, perpendicular to the flow direction.
    let along_x = if edges.is_empty() {
        !horizontal
    } else {
        horizontal
    };
    if reversed && !edges.is_empty() {
        order.reverse();
    }
    let gap = if edges.is_empty() {
        36
    } else if horizontal {
        64
    } else {
        56
    };
    let breadth = nodes
        .iter()
        .map(|n| if along_x { n.h } else { n.w })
        .max()
        .unwrap_or(0);
    let mut pos = 32;
    for i in order {
        let n = &mut nodes[i];
        if along_x {
            n.x = pos;
            n.y = 32 + (breadth - n.h) / 2;
            pos += n.w + gap
        } else {
            n.y = pos;
            n.x = 32 + (breadth - n.w) / 2;
            pos += n.h + gap
        }
    }
    let width = nodes.iter().map(|n| n.x + n.w).max().unwrap_or(152) + 32;
    let height = nodes.iter().map(|n| n.y + n.h).max().unwrap_or(112) + 32;
    let dark = theme == "dark";
    let edge = if dark { "#94a3b8" } else { "#64748b" };
    let mut elements = vec![];
    for (idx, (a, b, op)) in edges.into_iter().enumerate() {
        let (a, b) = (&nodes[a], &nodes[b]);
        let (x, y, ex, ey, dx, dy, angle) = match dir {
            "LR" => (a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, 1., 0., 0),
            "RL" => (a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2, -1., 0., 180),
            "BT" => (a.x + a.w / 2, a.y, b.x + b.w / 2, b.y + b.h, 0., -1., -90),
            _ => (a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, 0., 1., 90),
        };
        let arrow = op != "---";
        let end_x = f64::from(ex) - if arrow { dx * 6.8 } else { 0. };
        let end_y = f64::from(ey) - if arrow { dy * 6.8 } else { 0. };
        let stroke = if op == "==>" { "2.25" } else { "1.25" };
        let dash = if op == "-.->" {
            r#" stroke-dasharray="5 4""#
        } else {
            ""
        };
        let mut el = format!(
            r#"<g class="mmdc-edge" data-id="edge_{}"><path d="M {x} {y} L {end_x} {end_y}" fill="none" stroke="{edge}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"{dash}/>"#,
            idx + 1
        );
        if arrow {
            write!(el,r#"<g transform="translate({ex}, {ey}) rotate({angle})"><path d="M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z" transform="translate(-9, -3.5)" fill="{edge}" stroke="{edge}" stroke-width="1" stroke-linejoin="round"/></g>"#).ok()?;
        }
        el.push_str("</g>");
        elements.push(el);
    }
    for n in nodes {
        let (x, y, w, h) = (n.x, n.y, n.w, n.h);
        let cx = x + w / 2;
        let cy = y + h / 2;
        let (fill, border, color) = if matches!(n.shape, Shape::Rect | Shape::Rounded) {
            if dark {
                ("#1e293b", "#334155", "#f8fafc")
            } else {
                ("#ffffff", "#cbd5e1", "#0f172a")
            }
        } else {
            match theme {
                "dark" => ("#172554", "#3b82f6", "#dbeafe"),
                "forest" => ("#f0fdf4", "#4ade80", "#166534"),
                "neutral" => ("#f1f5f9", "#94a3b8", "#334155"),
                _ => ("#eff6ff", "#60a5fa", "#1e3a8a"),
            }
        };
        let style = format!(
            r#"fill="{fill}" stroke="{border}" stroke-width="1.25" filter="url(#{prefix}mmdc-shadow)""#
        );
        let mut el = format!(r#"<g class="mmdc-node" data-id="{}">"#, esc(&n.id));
        match n.shape {
            Shape::Circle => {
                write!(el, r#"<circle cx="{cx}" cy="{cy}" r="{}" {style}/>"#, w / 2).ok()?
            }
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
                let rx = match n.shape {
                    Shape::Rounded => 12,
                    Shape::Stadium => h / 2,
                    _ => 8,
                };
                write!(
                    el,
                    r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" {style}/>"#
                )
                .ok()?;
            }
        }
        let first_y = cy - (n.lines.len() as i32) * 10 + 14;
        for (i, line) in n.lines.iter().enumerate() {
            if !line.is_empty() {
                write!(el,r#"<text x="{cx}" y="{}" fill="{color}" font-family="{FONT}" font-size="13" font-weight="500" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,first_y+i as i32*20,esc(line)).ok()?;
            }
        }
        el.push_str("</g>");
        elements.push(el);
    }
    let mut width = f64::from(width);
    let mut height = f64::from(height);
    if let Some(t) = title.filter(|t| !t.is_empty()) {
        let text_width = (t.chars().map(|c| u64::from(advance(c, true))).sum::<u64>() as f64 * 1.6)
            .ceil()
            / 100.;
        width = width.max(text_width + 64.);
        let fill = if dark { "#1e293b" } else { "#ffffff" };
        let color = if dark { "#f8fafc" } else { "#0f172a" };
        elements.push(format!(r#"<g class="mmdc-node" data-id="mmdc_title"><rect x="32" y="{height}" width="{}" height="24" rx="0" fill="{fill}" stroke="transparent" stroke-width="0"/><text x="{}" y="{}" fill="{color}" font-family="{FONT}" font-size="16" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{}</text></g>"#, width-64.,width/2.,height+18.,esc(t)));
        height += 56.;
    }
    Some(Scene {
        width,
        height,
        elements,
    })
}
