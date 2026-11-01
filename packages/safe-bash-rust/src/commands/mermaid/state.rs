use super::{Graph, Node, Pill, Shape, Statement, scanner::check_label};
use std::collections::BTreeMap;

fn strip_quotes(value: &str) -> &str {
    let s = value.trim_ascii();
    match s.as_bytes() {
        [a @ (b'\'' | b'"'), .., b] if a == b => &s[1..s.len() - 1],
        _ => s,
    }
}

fn outside(s: &str, token: impl Fn(&str) -> bool) -> Option<usize> {
    let mut quote = None;
    for (i, c) in s.char_indices() {
        if let Some(q) = quote {
            if c == q && !s[..i].ends_with('\\') {
                quote = None;
            }
        } else if matches!(c, '\'' | '"') {
            quote = Some(c);
        } else if token(&s[i..]) {
            return Some(i);
        }
    }
    None
}

pub(super) fn parse(
    lines: &[Statement],
    wrapping: f64,
    secondary: f64,
    limit: usize,
) -> Option<Result<Graph<'static>, String>> {
    // Composite transitions still use the existing rendering path.
    if lines[1..]
        .iter()
        .any(|s| s.text.trim_end().ends_with('{') && !s.text.contains("-->"))
    {
        return None;
    }
    Some(flat(lines, wrapping, secondary, limit))
}

fn flat(
    lines: &[Statement],
    wrapping: f64,
    secondary: f64,
    limit: usize,
) -> Result<Graph<'static>, String> {
    let mut graph = Graph::core(wrapping, limit);
    graph.dir = "TD";
    graph.edge_id = |i| format!("state_edge_{}", i + 1);
    let mut ids = BTreeMap::<String, usize>::new();
    let mut stmts = lines[1..].iter();
    while let Some(stmt) = stmts.next() {
        let text = stmt.text.trim_end();
        let fail = |s: &str| stmt.error("E_SYNTAX", text, s);
        let mut ensure = |nodes: &mut Vec<Node>,
                          raw: &str,
                          label: Option<&str>,
                          shape: Option<Shape>|
         -> Result<usize, String> {
            let id = strip_quotes(raw);
            if id.is_empty() {
                return Err(fail("Empty state identifier"));
            }
            if let Some(label) = label {
                check_label(label, stmt, text)?;
            }
            if let Some(&idx) = ids.get(id) {
                let n = &mut nodes[idx];
                if n.label == n.id
                    && let Some(label) = label
                {
                    n.label = label.into();
                }
                if let Some(shape) = shape {
                    n.shape = shape;
                }
                return Ok(idx);
            }
            if nodes.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            let idx = nodes.len();
            ids.insert(id.into(), idx);
            nodes.push(Node {
                id: id.into(),
                label: label.unwrap_or(id).into(),
                shape: shape.unwrap_or(Shape::Rounded),
                order: idx,
                ..Default::default()
            });
            Ok(idx)
        };
        if text == "}" {
            return Err(fail("Unexpected '}' without open composite state"));
        }
        let kw = text.split_ascii_whitespace().next().unwrap_or("");
        let body = text[kw.len()..].trim_ascii();
        if kw.eq_ignore_ascii_case("direction") {
            graph.dir = match body.to_ascii_uppercase().as_str() {
                "TD" | "TB" => "TD",
                "LR" => "LR",
                "RL" => "RL",
                "BT" => "BT",
                other => return Err(fail(&format!("Invalid stateDiagram direction '{other}'"))),
            };
        } else if kw.eq_ignore_ascii_case("note") {
            let colon = outside(body, |s| s.starts_with(':'));
            let header = body[..colon.unwrap_or(body.len())].trim_ascii();
            let lower = header.to_ascii_lowercase();
            let (left, target) = if lower.starts_with("left of ") {
                (true, &header[8..])
            } else if lower.starts_with("right of ") {
                (false, &header[9..])
            } else {
                return Err(fail(&format!(
                    "Invalid stateDiagram note header '{header}' (expected 'left of <State>' or 'right of <State>')"
                )));
            };
            let target = ensure(&mut graph.nodes, target, None, None)?;
            let joined;
            let contents = if let Some(i) = colon {
                strip_quotes(&body[i + 1..])
            } else {
                let mut body = Vec::new();
                loop {
                    let line = stmts
                        .next()
                        .ok_or_else(|| fail("Unclosed multi-line note block (missing 'end note')"))?
                        .text
                        .trim_end();
                    if line.eq_ignore_ascii_case("end note") || line.eq_ignore_ascii_case("endnote")
                    {
                        break;
                    }
                    body.push(line);
                }
                joined = body.join("\n");
                &joined
            };
            check_label(contents, stmt, text)?;
            let (lines, width) =
                super::text_block(contents, secondary, false, wrapping, graph.remaining_lines)
                    .ok_or(BUDGET)?;
            graph.remaining_lines = graph
                .remaining_lines
                .checked_sub(lines.len().max(1))
                .ok_or(BUDGET)?;
            if width.max(lines.len() as f64 * 16.) > f64::from(i32::MAX / 16) {
                return Err(BUDGET.into());
            }
            graph.notes.push(Note {
                target,
                left,
                bounds: [
                    0.,
                    0.,
                    super::snap(width + 28.).max(96).into(),
                    super::snap(lines.len() as f64 * 16. + 16.).max(36).into(),
                ],
                lines,
                size: secondary,
            });
        } else if kw.eq_ignore_ascii_case("state") {
            let mut body = body;
            let mut shape = None;
            if let Some((before, kind)) = body.strip_suffix(">>").and_then(|s| s.rsplit_once("<<"))
            {
                let kind = kind.trim();
                if !kind.is_empty()
                    && kind
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
                {
                    body = before.trim_end();
                    shape = match kind.to_ascii_lowercase().as_str() {
                        "choice" => Some(Shape::Diamond),
                        "fork" | "join" => Some(Shape::Rect),
                        _ => None,
                    };
                }
            }
            let alias = outside(body, |s| {
                matches!(
                    s.as_bytes(),
                    [b' ' | b'\t', b'a' | b'A', b's' | b'S', b' ' | b'\t', ..]
                )
            });
            let (id, label) = if let Some(i) = alias {
                (strip_quotes(&body[i + 4..]), strip_quotes(&body[..i]))
            } else {
                (strip_quotes(body), strip_quotes(body))
            };
            if id.is_empty() {
                return Err(fail(if alias.is_some() {
                    "Missing state alias after 'as'"
                } else {
                    "Missing state identifier"
                }));
            }
            check_label(label, stmt, text)?;
            let label = if shape == Some(Shape::Diamond) && label == id {
                "?"
            } else if label.is_empty() {
                id
            } else {
                label
            };
            ensure(&mut graph.nodes, id, Some(label), shape)?;
        } else if let Some(i) = outside(text, |s| s.starts_with("-->")) {
            let left = text[..i].trim_ascii();
            let rest = text[i + 3..].trim_ascii();
            let (right, label) = outside(rest, |s| s.starts_with(':')).map_or((rest, ""), |i| {
                (rest[..i].trim_ascii(), strip_quotes(&rest[i + 1..]))
            });
            check_label(label, stmt, text)?;
            if left.is_empty() || right.is_empty() {
                return Err(fail(&format!("Incomplete state transition '{text}'")));
            }
            let mut endpoint = |raw: &str, source| {
                if raw == "[*]" {
                    let (id, shape) = if source {
                        ("__state_start_1", Shape::StateStart)
                    } else {
                        ("__state_end_1", Shape::StateEnd)
                    };
                    ensure(&mut graph.nodes, id, Some(""), Some(shape))
                } else {
                    ensure(&mut graph.nodes, raw, None, None)
                }
            };
            let (from, to) = (endpoint(left, true)?, endpoint(right, false)?);
            if graph.edges.len() >= limit / 300 {
                return Err("mmdc: E_LIMIT: Edge limit exceeded\n".into());
            }
            graph.connect(from, to, "-->");
            if !label.is_empty() {
                let pill = Pill::new(label, wrapping, secondary, graph.remaining_lines)
                    .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
                graph.remaining_lines -= pill.lines.len();
                graph.edges.last_mut().unwrap().3 = Some(pill);
            }
        } else if let Some(i) = outside(text, |s| s.starts_with(':'))
            && let (id, desc) = (strip_quotes(&text[..i]), strip_quotes(&text[i + 1..]))
            && !id.is_empty()
            && !desc.is_empty()
        {
            check_label(desc, stmt, text)?;
            let idx = ensure(&mut graph.nodes, id, None, None)?;
            let node = &mut graph.nodes[idx];
            if node.id == node.label {
                node.label = format!("{id}\n{desc}");
                check_label(&node.label, stmt, text)?;
            }
        } else {
            return Err(fail(&format!(
                "Unknown or unsupported stateDiagram statement '{text}'"
            )));
        }
    }
    Ok(graph)
}

const BUDGET: &str = "mmdc: E_LIMIT: Render work budget exceeded\n";
pub(super) struct Note {
    pub target: usize,
    left: bool,
    pub bounds: [f64; 4],
    lines: Vec<String>,
    size: f64,
}

pub(super) fn place_notes(
    notes: &mut [Note],
    nodes: &[Node],
    groups: &[super::Group],
    pills: &[Option<[f64; 4]>],
    paths: &[Vec<super::route::Point>],
    mut work: usize,
) -> Result<(), String> {
    if notes.is_empty() {
        return Ok(());
    }
    let mut obstacles = Vec::new();
    obstacles.extend(
        nodes
            .iter()
            .map(|n| ([n.x, n.y, n.w, n.h].map(f64::from), 24.)),
    );
    obstacles.extend(groups.iter().map(|g| (g.header(), 10.)));
    obstacles.extend(pills.iter().flatten().map(|&b| (b, 12.)));
    for path in paths {
        for segment in path.windows(2) {
            let ((x, y), (a, b)) = (segment[0], segment[1]);
            obstacles.push((
                [
                    x.min(a),
                    y.min(b),
                    (x - a).abs().max(1.),
                    (y - b).abs().max(1.),
                ],
                12.,
            ));
        }
    }
    for n in notes {
        let target = &nodes[n.target];
        let [_, _, w, h] = n.bounds;
        let mut x = target.x as f64
            + if n.left {
                -w - 32.
            } else {
                f64::from(target.w) + 32.
            };
        loop {
            n.bounds = [x, target.y.into(), w, h];
            work = work.checked_sub(obstacles.len()).ok_or(BUDGET)?;
            if !obstacles
                .iter()
                .any(|&(b, gap)| super::labels::overlaps(n.bounds, b, gap))
            {
                break;
            }
            x += if n.left { -36. } else { 36. };
        }
        obstacles.push((n.bounds, 16.));
    }
    Ok(())
}

impl Note {
    pub fn paint(
        self,
        id: usize,
        (dx, dy): (i32, i32),
        prefix: &str,
        theme: &super::config::Theme,
        budget: &mut usize,
        scene: &mut super::Scene,
    ) -> Result<(), String> {
        use super::{
            esc,
            raster::{BoxStyle, Paint},
        };
        use std::fmt::Write;
        let [x, y, w, h] = self.bounds;
        let (x, y) = (x + f64::from(dx), y + f64::from(dy));
        let (fill, fill_rgba) = theme.color("noteSurface");
        let (border, stroke) = theme.color("noteBorder");
        let (color, rgba) = theme.color("noteText");
        let font = &theme.font;
        let count = self.lines.iter().filter(|s| !s.is_empty()).count();
        super::config::charge_attributes(
            budget,
            &[(fill, 1), (border, 1), (font, count), (color, count)],
        )?;
        scene.paint.push(Paint::Box {
            bounds: [x, y, w, h],
            shape: Shape::Rounded,
            shadow: Some(theme.color("shadowColor").1),
            style: BoxStyle {
                header: None,
                radius: 6.,
                fill: fill_rgba,
                border: stroke,
                thickness: 1.25,
            },
        });
        let mut el = format!(
            r#"<g class="mmdc-note" data-id="state_note_{id}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{border}" stroke-width="1.25" filter="url(#{prefix}mmdc-shadow)"/>"#
        );
        let size = self.size;
        for (i, text) in self
            .lines
            .into_iter()
            .enumerate()
            .filter(|(_, s)| !s.is_empty())
        {
            let (x, y) = (x + 14., y + 19. + i as f64 * 16.);
            write!(el,r#"<text x="{x}" y="{y}" fill="{color}" font-family="{font}" font-size="{}" font-weight="500" letter-spacing="0.025em" text-anchor="start">{}</text>"#,super::nonnegative_number(size),esc(&text)).unwrap();
            scene.paint.push(Paint::Text {
                start: x,
                baseline: y,
                size,
                weight: 500,
                color: rgba,
                text,
            });
        }
        el.push_str("</g>");
        scene.elements.push(el);
        Ok(())
    }
}
