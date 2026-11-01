// Flowchart layout for unbranched paths and standalone declarations.
use super::escape_mmdc_xml as esc;
use std::{collections::BTreeMap, fmt::Write};

#[path = "mermaid/pie.rs"]
pub(super) mod pie;
#[path = "mermaid/ranks.rs"]
mod ranks;
#[path = "mermaid/raster.rs"]
mod raster;

pub(super) struct Scene {
    pub width: f64,
    pub height: f64,
    pub elements: Vec<String>,
    paint: Vec<raster::Paint>,
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
fn measure(s: &str, size: f64, bold: bool) -> f64 {
    let units = s.chars().map(|c| u64::from(advance(c, bold))).sum::<u64>() as f64;
    (units / 1000. * size * 100.).ceil() / 100.
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
            let width = measure(word, 13., false);
            if !line.is_empty()
                && measure(&line, 13., false) + measure(" ", 13., false) + width > 200.
            {
                n.lines.push(std::mem::take(&mut line));
            } else if !line.is_empty() {
                line.push(' ');
            }
            for c in word.chars() {
                if !line.is_empty()
                    && measure(&line, 13., false) + f64::from(advance(c, false)) * 0.013 > 200.
                {
                    n.lines.push(std::mem::take(&mut line));
                }
                line.push(c);
            }
        }
        n.lines.push(line);
    }
    for l in &n.lines {
        tallest = f64::max(tallest, measure(l, 13., false));
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
        Shape::Cylinder => (
            snap(tallest + 30.).max(104),
            snap(text_height + 38.).max(60),
        ),
        Shape::Hexagon | Shape::Subroutine => {
            (snap(tallest + 48.).max(88), snap(text_height + 22.).max(40))
        }
        _ => (snap(tallest + 36.).max(88), snap(text_height + 22.).max(40)),
    }
}
const EDGE_OPS: &[&str] = &[
    "<-.->", "<-->", "<==>", "-..->", "-.->", "--->", "===>", "-.-", "-->", "---", "==>", "===",
    "--x", "--o",
];

fn position(source: &str, at: &str) -> (usize, usize) {
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
fn syntax(source: &str, at: &str, message: String) -> String {
    let (line, column) = position(source, at);
    format!("mmdc: E_SYNTAX (line {line}, column {column}): {message}\n")
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
                || (c == '-' && !EDGE_OPS.iter().any(|op| s[i..].starts_with(op))))
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
        ("[(", ")]", Shape::Cylinder),
        ("[[", "]]", Shape::Subroutine),
        ("{{", "}}", Shape::Hexagon),
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
fn pill_style(label: &str) -> (f64, u16, i32, f64) {
    let (size, weight, radius, pad) = if label.len() <= 4
        && label
            .bytes()
            .all(|b| b.is_ascii_digit() || b".*nN".contains(&b))
    {
        (11., 600, 4, 16.)
    } else {
        (11.5, 500, 5, 18.)
    };
    let units = label
        .chars()
        .map(|c| u64::from(advance(c, weight == 600)))
        .sum::<u64>() as f64;
    (size, weight, radius, (units * size / 1000. + pad).ceil())
}
const FONT: &str = "Inter, -apple-system, BlinkMacSystemFont, &#39;Segoe UI&#39;, Roboto, Helvetica, Arial, sans-serif";
pub(super) fn layout(
    lines: &[&str],
    source: &str,
    theme: &str,
    prefix: &str,
    title: Option<&str>,
    limit: usize,
) -> Option<Result<Scene, String>> {
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
            let (op, tail, label) = if let Some(op) =
                EDGE_OPS.iter().copied().find(|op| rest.starts_with(op))
            {
                let tail = rest[op.len()..].trim_start();
                if let Some(tail) = tail.strip_prefix('|') {
                    let Some((label, tail)) = tail.split_once('|') else {
                        return Some(Err(syntax(
                            source,
                            rest,
                            "Unclosed edge label pipe '|'".into(),
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
                if nodes[a].id.ends_with("--") {
                    let text =
                        String::from_utf16_lossy(&rest.encode_utf16().take(24).collect::<Vec<_>>());
                    return Some(Err(syntax(
                        source,
                        rest,
                        format!("Unexpected flowchart syntax near '{text}'"),
                    )));
                }
                return None;
            };
            if label.contains(['<', '\n']) || measure(label, 13., false) > 200. {
                return None;
            }
            let (b, tail) = parse_node(tail, &mut nodes, &mut ids)?;
            if nodes[a].to.is_some() || nodes[b].from.is_some() {
                return None;
            }
            nodes[a].to = Some(b);
            nodes[b].from = Some(a);
            edges.push((a, b, op, label));
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
    let (width, height) = ranks::place(&mut nodes, &edges, horizontal, reversed)?;
    let dark = theme == "dark";
    let edge = if dark { "#94a3b8" } else { "#64748b" };
    let mut elements = vec![];
    let mut pills = Vec::new();
    use crate::commands::archive::parse_color;
    use raster::{BoxStyle, Paint};
    let mut paint = Vec::new();
    let mut edge_paint = Vec::new();
    let mut pill_paint = Vec::new();
    let edge_color = parse_color(edge).unwrap();
    let shadow = if dark {
        [0, 0, 0, 89]
    } else {
        [15, 23, 42, 15]
    };
    for (idx, (a, b, op, label)) in edges.into_iter().enumerate() {
        let (a, b) = (&nodes[a], &nodes[b]);
        let (x, y, ex, ey, dx, dy, angle) = match dir {
            "LR" => (a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, 1., 0., 0),
            "RL" => (a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2, -1., 0., 180),
            "BT" => (a.x + a.w / 2, a.y, b.x + b.w / 2, b.y + b.h, 0., -1., -90),
            _ => (a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, 0., 1., 90),
        };
        let arrow = op.ends_with('>');
        let start_arrow = op.starts_with('<');
        let end_x = f64::from(ex) - if arrow { dx * 6.8 } else { 0. };
        let end_y = f64::from(ey) - if arrow { dy * 6.8 } else { 0. };
        let stroke = if op.contains("==") { 2.25 } else { 1.25 };
        let dash = if op.contains('.') {
            r#" stroke-dasharray="5 4""#
        } else {
            ""
        };
        let start_x = f64::from(x) + if start_arrow { dx * 6.8 } else { 0. };
        let start_y = f64::from(y) + if start_arrow { dy * 6.8 } else { 0. };
        edge_paint.push(Paint::Path {
            points: vec![(start_x, start_y), (end_x, end_y)],
            fill: None,
            stroke: edge_color,
            width: stroke,
            dashed: !dash.is_empty(),
        });
        let marker =
            |x: i32, y: i32, angle: i32, local: &[(f64, f64)], filled: bool, width: f64| {
                let (sin, cos) = f64::from(angle).to_radians().sin_cos();
                Paint::Path {
                    points: local
                        .iter()
                        .map(|&(a, b)| {
                            (
                                f64::from(x) + (a * cos - b * sin),
                                f64::from(y) + (a * sin + b * cos),
                            )
                        })
                        .collect(),
                    fill: filled.then_some(edge_color),
                    stroke: edge_color,
                    width,
                    dashed: false,
                }
            };
        let mut el = format!(
            r#"<g class="mmdc-edge" data-id="edge_{}"><path d="M {start_x} {start_y} L {end_x} {end_y}" fill="none" stroke="{edge}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"{dash}/>"#,
            idx + 1
        );
        for (show, ex, ey, angle) in [
            (
                start_arrow,
                x,
                y,
                match angle {
                    0 => 180,
                    90 => -90,
                    180 => 0,
                    _ => 90,
                },
            ),
            (arrow, ex, ey, angle),
        ] {
            if show {
                edge_paint.push(marker(
                    ex,
                    ey,
                    angle,
                    &[(-9., -3.5), (0., 0.), (-9., 3.5), (-6.8, 0.)],
                    true,
                    0.9,
                ));
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
        match op {
            "--o" => write!(el,r#"<g transform="translate({ex}, {ey}) rotate({angle})"><path d="M -8 -3.5 L 0 0 L -8 3.5" fill="none" stroke="{edge}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>"#).ok()?,
            "--x" => write!(el,r#"<g transform="translate({ex}, {ey}) rotate({angle})"><path d="M -9 -4 L -1 4 M -9 4 L -1 -4" fill="none" stroke="{edge}" stroke-width="1.75" stroke-linecap="round"/></g>"#).ok()?,
            _ => {}
        }
        if !label.is_empty() {
            let (size, weight, rx, w) = pill_style(label);
            let short = weight == 600;
            let left = ((f64::from(x + ex) - w) * 0.5).round();
            let top = ((f64::from(y + ey) - 23.) * 0.5).round();
            let (fill, border, color) = if dark {
                ("#1e293b", "#334155", "#f8fafc")
            } else {
                ("#ffffff", "#e2e8f0", "#0f172a")
            };
            pill_paint.push(Paint::Box {
                bounds: [left, top, w, 23.],
                shape: Shape::Rounded,
                shadow: None,
                style: BoxStyle {
                    radius: f64::from(rx),
                    fill: parse_color(fill).unwrap(),
                    border: parse_color(border).unwrap(),
                    thickness: 1.,
                },
            });
            pill_paint.push(Paint::Text {
                start: (left + w / 2.).round() - measure(label, size, short) / 2.,
                baseline: top + if short { 14. } else { 15. },
                size,
                weight,
                color: parse_color(color).unwrap(),
                text: label.into(),
            });
            pills.push(format!(r#"<g class="mmdc-label-pill"><rect x="{left}" y="{top}" width="{w}" height="23" rx="{rx}" fill="{fill}" stroke="{border}" stroke-width="1"/><text x="{}" y="{}" fill="{color}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" letter-spacing="0.025em" text-anchor="middle">{}</text></g>"#,(left+w/2.).round(),top+if short{14.}else{15.},esc(label)));
        }
        el.push_str("</g>");
        elements.push(el);
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
        let radius = match n.shape {
            Shape::Circle | Shape::Stadium => h / 2,
            Shape::Diamond => 4,
            Shape::Rounded => 12,
            _ => 8,
        };
        paint.push(Paint::Box {
            bounds: [x.into(), y.into(), w.into(), h.into()],
            shape: n.shape,
            shadow: Some(shadow),
            style: BoxStyle {
                radius: radius.into(),
                fill: parse_color(fill).unwrap(),
                border: parse_color(border).unwrap(),
                thickness: 1.25,
            },
        });
        let join = if matches!(n.shape, Shape::Cylinder | Shape::Hexagon) {
            r#" stroke-linejoin="round""#
        } else {
            ""
        };
        let style = format!(
            r#"fill="{fill}" stroke="{border}" stroke-width="1.25"{join} filter="url(#{prefix}mmdc-shadow)""#
        );
        let mut el = format!(r#"<g class="mmdc-node" data-id="{}">"#, esc(&n.id));
        match n.shape {
            Shape::Cylinder => {
                let rx = w / 2;
                let ry = ((f64::from(w) * 0.075).round() as i32).clamp(9, 11);
                let top = y + ry;
                let bottom = y + h - ry;
                let right = x + w;
                let lid = if dark { "#1e3a8a" } else { "#dbeafe" };
                write!(el,r#"<path d="M {x} {top} A {rx} {ry} 0 0 1 {right} {top} L {right} {bottom} A {rx} {ry} 0 0 1 {x} {bottom} Z" {style}/><ellipse cx="{cx}" cy="{top}" rx="{rx}" ry="{ry}" fill="{lid}" stroke="{border}" stroke-width="1.25"/>"#).ok()?;
            }
            Shape::Hexagon => {
                let left = x + 12;
                let right = x + w;
                let inset = right - 12;
                let bottom = y + h;
                write!(el,r#"<polygon points="{left},{y} {inset},{y} {right},{cy} {inset},{bottom} {left},{bottom} {x},{cy}" {style}/>"#).ok()?;
            }
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
                    color: parse_color(color).unwrap(),
                    text: line.clone(),
                });
                write!(el,r#"<text x="{cx}" y="{}" fill="{color}" font-family="{FONT}" font-size="13" font-weight="500" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,first_y+i as i32*20,esc(line)).ok()?;
            }
        }
        el.push_str("</g>");
        elements.push(el);
    }
    let mut width = f64::from(width);
    let mut height = f64::from(height);
    if let Some(t) = title.filter(|t| !t.is_empty()) {
        let text_width = measure(t, 16., true);
        width = width.max(text_width + 64.);
        let fill = if dark { "#1e293b" } else { "#ffffff" };
        let color = if dark { "#f8fafc" } else { "#0f172a" };
        paint.push(Paint::Box {
            bounds: [32., height, width - 64., 24.],
            shape: Shape::Rect,
            shadow: None,
            style: BoxStyle {
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
        elements.push(format!(r#"<g class="mmdc-node" data-id="mmdc_title"><rect x="32" y="{height}" width="{}" height="24" rx="0" fill="{fill}" stroke="transparent" stroke-width="0"/><text x="{}" y="{}" fill="{color}" font-family="{FONT}" font-size="16" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{}</text></g>"#, width-64.,width/2.,height+18.,esc(t)));
        height += 56.;
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
