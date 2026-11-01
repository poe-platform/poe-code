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
    secondary: f64,
    limit: usize,
) -> Result<Graph<'_>, String> {
    let mut graph = Graph::core(wrapping, limit);
    graph.dir = "TB";
    graph.edge_id = |i| format!("e_{i}");
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
                graph.nodes[i].attributes.push(super::card::Member {
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
        let mut entity = |id: &str, label: &str| -> Result<usize, String> {
            check_label(label, stmt, text)?;
            Ok(if let Some(&i) = ids.get(id) {
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
            })
        };
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
        } else if let Some((from, op, to, label)) = relationship(text) {
            let a = entity(from, from)?;
            let b = entity(to, to)?;
            check_label(label, stmt, text)?;
            if graph.edges.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Edge limit exceeded\n".into());
            }
            graph.connect(a, b, op);
            if !label.is_empty() {
                let p = super::Pill::new(label, wrapping, secondary, graph.remaining_lines)
                    .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
                graph.remaining_lines -= p.lines.len();
                graph.edges.last_mut().unwrap().3 = Some(p);
            }
            continue;
        } else {
            return Err(stmt.error(
                "E_SYNTAX",
                text,
                &format!("Unrecognized erDiagram statement '{text}'"),
            ));
        };
        let idx = entity(id, label)?;
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
    Ok(graph)
}

fn entity_prefix(s: &str) -> Option<(&str, &str)> {
    let n = if let Some(q) = s.strip_prefix('"') {
        q.find('"')? + 2
    } else {
        s.bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            .count()
    };
    let (token, rest) = s.split_at(n);
    Some((identifier(token)?, rest))
}
fn relationship(s: &str) -> Option<(&str, &str, &str, &str)> {
    let (from, s) = entity_prefix(s)?;
    if !s.starts_with(char::is_whitespace) {
        return None;
    }
    let (op, s) = s.trim_start().split_once(char::is_whitespace)?;
    cardinalities(op)?;
    let (to, s) = entity_prefix(s.trim_start())?;
    let label = if s.trim().is_empty() {
        ""
    } else {
        let t = s.trim_start().strip_prefix(':')?.trim();
        if t.is_empty() {
            return None;
        }
        t.strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| t.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(t)
    };
    Some((from, op, to, label))
}

pub(super) enum Cardinality {
    One,
    Optional,
    Many,
    Any,
}
pub(super) fn cardinalities(s: &str) -> Option<(Cardinality, Cardinality)> {
    let [a, b, c, d, e, f] = *s.as_bytes() else {
        return None;
    };
    if !matches!([c, d], [b'-', b'-'] | [b'.', b'.']) {
        return None;
    }
    let card = |p| match &p {
        b"||" => Some(Cardinality::One),
        b"|o" | b"o|" => Some(Cardinality::Optional),
        b"}|" | b"|{" => Some(Cardinality::Many),
        b"}o" | b"o{" => Some(Cardinality::Any),
        _ => None,
    };
    Some((card([a, b])?, card([e, f])?))
}
impl Cardinality {
    #[allow(clippy::too_many_arguments)]
    pub fn paint(
        &self,
        (x, y): (f64, f64),
        angle: f64,
        (edge, stroke): (&str, [u8; 4]),
        theme: &super::config::Theme,
        budget: &mut usize,
        el: &mut String,
        paint: &mut Vec<super::raster::Paint>,
    ) -> Result<(), String> {
        use super::{
            config::charge_attributes,
            raster::{BoxStyle, Paint},
        };
        use std::fmt::Write;
        let (sin, cos) = angle.sin_cos();
        let transform = |(a, b): (f64, f64)| (x + (a * cos - b * sin), y + (a * sin + b * cos));
        let mut line = |points: &[(f64, f64)]| {
            paint.push(Paint::Path {
                points: points.iter().copied().map(transform).collect(),
                fill: None,
                stroke,
                width: 1.5,
                dashed: false,
            })
        };
        let (d, circle) = match self {
            Self::One => {
                line(&[(-5., -4.5), (-5., 4.5)]);
                line(&[(-9., -4.5), (-9., 4.5)]);
                ("M -5 -4.5 L -5 4.5 M -9 -4.5 L -9 4.5", None)
            }
            Self::Optional => {
                line(&[(-4., -4.5), (-4., 4.5)]);
                ("M -4 -4.5 L -4 4.5", Some(-10.))
            }
            Self::Many => {
                line(&[(-9., -4.5), (-9., 4.5)]);
                line(&[(0., -4.5), (-9., 0.), (0., 4.5)]);
                ("M -9 -4.5 L -9 4.5 M -9 0 L 0 -4.5 M -9 0 L 0 4.5", None)
            }
            Self::Any => {
                line(&[(0., -4.5), (-8., 0.), (0., 4.5)]);
                ("M -8 0 L 0 -4.5 M -8 0 L 0 4.5", Some(-12.))
            }
        };
        charge_attributes(budget, &[(edge, 1 + usize::from(circle.is_some()))])?;
        let join = if matches!(self, Self::Many | Self::Any) {
            r#" stroke-linejoin="round""#
        } else {
            ""
        };
        let degrees = (angle.to_degrees() * 100. + 0.5).floor() / 100.;
        write!(el,r#"<g transform="translate({x}, {y}) rotate({degrees})"><path d="{d}" fill="none" stroke="{edge}" stroke-width="1.5" stroke-linecap="round"{join}/>"#).unwrap();
        if let Some(offset) = circle {
            let (fill, rgba) = theme.color("canvas");
            charge_attributes(budget, &[(fill, 1)])?;
            write!(el,r#"<circle cx="{offset}" cy="0" r="3.2" fill="{fill}" stroke="{edge}" stroke-width="1.5"/>"#).unwrap();
            let (cx, cy) = transform((offset, 0.));
            paint.push(Paint::Box {
                bounds: [cx - 3.2, cy - 3.2, 6.4, 6.4],
                shape: Shape::Rounded,
                shadow: None,
                style: BoxStyle {
                    header: None,
                    radius: 3.2,
                    fill: rgba,
                    border: stroke,
                    thickness: 1.5,
                },
            });
        }
        el.push_str("</g>");
        Ok(())
    }
}
