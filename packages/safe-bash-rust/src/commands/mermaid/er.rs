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

    for stmt in &lines[1..] {
        let text = stmt.text.trim();
        if let Some(i) = active {
            if text == "}" {
                active = None;
            } else {
                let mut words = text.split('"').next().unwrap_or("").split_whitespace();
                let (Some(kind), Some(name)) = (words.next(), words.next()) else {
                    return Err(stmt.error(
                        "E_SYNTAX",
                        text,
                        &format!("Invalid ER attribute declaration '{text}'"),
                    ));
                };
                let badge = words.flat_map(|w| w.split(',')).find_map(|s| {
                    ["PK", "FK", "UK"]
                        .into_iter()
                        .find(|b| s.eq_ignore_ascii_case(b))
                });
                graph.remaining_lines = graph
                    .remaining_lines
                    .checked_sub(2 + usize::from(badge.is_some()))
                    .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
                graph.nodes[i].attributes.push(Attribute {
                    kind: kind.into(),
                    name: name.into(),
                    badge,
                });
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
    Ok(Some(graph))
}

pub(super) const MONO: &[u8] = include_bytes!("mono.bin");
pub(super) fn mono_advance(c: char) -> u32 {
    let pos = 6 * super::glyph_index(c) + 4;
    u16::from_le_bytes([MONO[pos], MONO[pos + 1]]).into()
}
fn mono_width(s: &str, size: f64) -> f64 {
    (s.chars().map(|c| u64::from(mono_advance(c))).sum::<u64>() as f64 / 1000. * size * 100.).ceil()
        / 100.
}
pub(super) struct Attribute {
    kind: String,
    name: String,
    badge: Option<&'static str>,
}
impl Attribute {
    pub fn width(&self, size: f64) -> f64 {
        super::measure(&self.name, size, false)
            + mono_width(&self.kind, size)
            + 56.
            + if self.badge.is_some() { 34. } else { 0. }
    }
}

pub(super) fn paint_attributes(
    node: &Node,
    hh: f64,
    theme: &super::config::Theme,
    size: f64,
    el: &mut String,
    paint: &mut Vec<super::raster::Paint>,
    budget: &mut usize,
) -> Result<(String, Vec<super::raster::Paint>), String> {
    use super::{
        config::charge_attributes,
        esc, nonnegative_number,
        raster::{BoxStyle, Paint},
    };
    use std::fmt::Write;
    let (x, y, w) = (f64::from(node.x), f64::from(node.y) + hh, f64::from(node.w));
    let (border, stroke) = theme.color("border");
    let (text, text_rgba) = theme.color("text");
    let (muted, muted_rgba) = theme.color("mutedText");
    let (fill, fill_rgba) = theme.color("accentSurface");
    let (accent_border, accent_stroke) = theme.color("accentBorder");
    let (accent, accent_rgba) = theme.color("accent");
    let (font, mono) = (&theme.font, &theme.mono_font);
    let count = node.attributes.len();
    let badges = node.attributes.iter().filter(|a| a.badge.is_some()).count();
    charge_attributes(
        budget,
        &[
            (border, 1),
            (text, count),
            (muted, count),
            (font, count),
            (mono, count + badges),
            (fill, badges),
            (accent_border, badges),
            (accent, badges),
        ],
    )?;
    let right = x + w;
    write!(
        el,
        r#"<line x1="{x}" y1="{y}" x2="{right}" y2="{y}" stroke="{border}" stroke-width="1"/>"#
    )
    .unwrap();
    paint.push(Paint::Path {
        points: vec![(x, y), (right, y)],
        fill: None,
        stroke,
        width: 1.,
        dashed: false,
    });
    let mut rows = String::new();
    let mut ops = Vec::new();
    for (i, a) in node.attributes.iter().enumerate() {
        let cursor = y + 6. + 22. * i as f64;
        let baseline = cursor + 15.;
        let lx = x + 14.;
        let mut rx = right - 14.;
        if let Some(badge) = a.badge {
            let bx = rx - 26.;
            let by = cursor + 3.;
            let cx = (bx + 13. + 0.5).floor();
            let cy = (by + 11. + 0.5).floor();
            write!(el,r#"<rect x="{bx}" y="{by}" width="26" height="15" rx="4" fill="{fill}" stroke="{accent_border}" stroke-width="1"/><text x="{cx}" y="{cy}" fill="{accent}" font-family="{mono}" font-size="9.5" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{badge}</text>"#).unwrap();
            paint.push(Paint::Box {
                bounds: [bx, by, 26., 15.],
                shape: Shape::Rounded,
                shadow: None,
                style: BoxStyle {
                    radius: 4.,
                    header: None,
                    fill: fill_rgba,
                    border: accent_stroke,
                    thickness: 1.,
                },
            });
            paint.push(Paint::Text {
                mono: true,
                start: cx - mono_width(badge, 9.5) / 2.,
                baseline: cy,
                size: 9.5,
                weight: 600,
                color: accent_rgba,
                text: badge.into(),
            });
            rx = bx - 8.;
        }
        let sz = nonnegative_number(size);
        write!(rows,r#"<text x="{lx}" y="{baseline}" fill="{text}" font-family="{font}" font-size="{sz}" font-weight="500" letter-spacing="0.025em" text-anchor="start">{}</text><text x="{rx}" y="{baseline}" fill="{muted}" font-family="{mono}" font-size="{sz}" font-weight="400" letter-spacing="0.025em" text-anchor="end">{}</text>"#,esc(&a.name),esc(&a.kind)).unwrap();
        ops.push(Paint::Text {
            mono: false,
            start: lx,
            baseline,
            size,
            weight: 500,
            color: text_rgba,
            text: a.name.clone(),
        });
        ops.push(Paint::Text {
            mono: true,
            start: rx - mono_width(&a.kind, size),
            baseline,
            size,
            weight: 400,
            color: muted_rgba,
            text: a.kind.clone(),
        });
    }
    Ok((rows, ops))
}
