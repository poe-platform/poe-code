use super::{
    Marker, Scene, Shape,
    config::{Theme, charge_attributes},
    esc, interaction_href, measure,
    raster::{BoxStyle, Paint},
    route::{Route, Segment},
    scanner::{Statement, check_label, outside, strip_quotes},
    snap, text_block,
};
use mcp_protocol_rust::json::{self, Value};
use std::{collections::BTreeMap, fmt::Write};
const BUDGET: &str = "mmdc: E_LIMIT: Render work budget exceeded\n";

struct Participant {
    id: String,
    label: String,
    actor: bool,
}
#[derive(Default)]
struct Links {
    href: Option<String>,
    named: Vec<(String, String)>,
}
struct Message {
    from: usize,
    to: usize,
    marker: Marker,
    dashed: bool,
    label: String,
}

fn message(text: &str) -> Option<(&str, &str, &str, Marker, bool, bool)> {
    let colon = outside(text, |s| s.starts_with(':')).unwrap_or(text.len());
    let ids = text[..colon].trim_ascii();
    let mut candidate = None;
    outside(ids, |s| {
        let op = ["-->>", "->>", "-->", "->", "--x", "--X", "-x", "-X"]
            .into_iter()
            .find(|op| s.starts_with(op));
        let Some(op) = op else { return false };
        let from = &ids[..ids.len() - s.len()];
        let rest = &s[op.len()..];
        let activation = rest.starts_with(['+', '-']);
        let to = &rest[usize::from(activation)..];
        if from.trim_ascii().is_empty() || to.trim_ascii().is_empty() {
            return false;
        }
        let marker = if op.ends_with(">>") {
            Marker::Arrow
        } else if op.ends_with('>') {
            Marker::Open
        } else {
            Marker::Cross
        };
        let ambiguous = marker == Marker::Cross && op.len() == 2;
        if !ambiguous || candidate.is_none() {
            candidate = Some((
                from,
                to,
                text.get(colon + 1..).unwrap_or(""),
                marker,
                op.starts_with("--"),
                activation,
            ));
        }
        !ambiguous
    });
    candidate
}

#[derive(Default)]
pub(in super::super) struct Sequence {
    participants: Vec<Participant>,
    messages: Vec<Message>,
    links: BTreeMap<String, Links>,
}

impl Sequence {
    pub fn parse(stmts: &[Statement], limit: usize) -> Result<Option<Self>, String> {
        let mut chart = Self::default();
        let mut ids = BTreeMap::<String, usize>::new();
        for stmt in &stmts[1..] {
            let text = stmt.text.trim_end();
            let word = text.split_ascii_whitespace().next().unwrap_or("");
            let rest = text[word.len()..].trim_ascii();
            let fail = |s: &str| stmt.error("E_SYNTAX", text, s);
            let mut participant =
                |id: &str, label: Option<&str>, actor: bool| -> Result<usize, String> {
                    if id.is_empty() {
                        return Err(fail("Missing participant identifier in sequenceDiagram"));
                    }
                    if let Some(&idx) = ids.get(id) {
                        let p = &mut chart.participants[idx];
                        p.actor |= actor;
                        if let Some(label) = label {
                            p.label = label.into();
                        }
                        Ok(idx)
                    } else {
                        if ids.len() >= limit / 300 {
                            return Err(BUDGET.into());
                        }
                        ids.insert(id.into(), chart.participants.len());
                        chart.participants.push(Participant {
                            id: id.into(),
                            label: label.unwrap_or(id).into(),
                            actor,
                        });
                        Ok(chart.participants.len() - 1)
                    }
                };
            match word.to_ascii_lowercase().as_str() {
                "autonumber" => (),
                "participant" | "actor" => {
                    let actor = word.eq_ignore_ascii_case("actor");
                    let alias = outside(rest, |s| {
                        matches!(
                            s.as_bytes(),
                            [b' ' | b'\t', b'a' | b'A', b's' | b'S', b' ' | b'\t', ..]
                        )
                    });
                    let (id, label) = alias.map_or((strip_quotes(rest), None), |i| {
                        (strip_quotes(&rest[..i]), Some(strip_quotes(&rest[i + 4..])))
                    });
                    participant(id, label, actor)?;
                }
                "click" | "link" | "links" => {
                    check_label(text, stmt, text)?;
                    if word.eq_ignore_ascii_case("click") {
                        let target = rest.split_ascii_whitespace().next().unwrap_or("");
                        if let Some(href) = interaction_href(&rest[target.len()..])? {
                            chart.links.entry(target.into()).or_default().href = Some(esc(href));
                        }
                        continue;
                    }
                    let (id, value) = rest
                        .split_once(':')
                        .ok_or_else(|| fail("Expected a sequence link target"))?;
                    let links = &mut chart.links.entry(id.trim().into()).or_default().named;
                    let mut add = |label: String, url: Value| -> Result<(), String> {
                        let Value::String(ref raw) = url else {
                            return Err(fail("Sequence link URLs must be nonempty strings"));
                        };
                        if raw.is_empty() {
                            return Err(fail("Sequence link URLs must be nonempty strings"));
                        }
                        check_label(&label, stmt, text)?;
                        let quoted = json::stringify(&url);
                        let href = interaction_href(&quoted)?
                            .ok_or_else(|| fail("Expected a sequence link label and URL"))?;
                        links.push((label, esc(href)));
                        Ok(())
                    };
                    if word.eq_ignore_ascii_case("link") {
                        let (label, url) = value
                            .split_once('@')
                            .ok_or_else(|| fail("Expected a sequence link label and URL"))?;
                        add(
                            label.trim().into(),
                            Value::String(url.trim().encode_utf16().collect()),
                        )?;
                    } else {
                        let Ok(Value::Object(mut props)) = json::parse(
                            value.trim().as_bytes(),
                            json::Limits {
                                max_depth: 64,
                                max_bytes: limit,
                                max_nodes: limit / 4,
                            },
                        ) else {
                            return Err(fail("Invalid sequence links mapping"));
                        };
                        props.sort_by_key(|(k, _)| {
                            let s = String::from_utf16_lossy(k);
                            s.parse::<u32>()
                                .ok()
                                .filter(|n| s == n.to_string())
                                .unwrap_or(u32::MAX)
                        });
                        for (k, url) in props {
                            add(String::from_utf16_lossy(&k), url)?;
                        }
                    }
                }
                "activate" | "deactivate" | "note" | "box" | "loop" | "opt" | "alt" | "end"
                | "else" => return Ok(None),
                _ => {
                    let Some((from, to, label, marker, dashed, activation)) = message(text) else {
                        return Err(fail(&format!(
                            "Unrecognized sequenceDiagram statement: '{text}'"
                        )));
                    };
                    if activation {
                        return Ok(None);
                    }
                    let from = participant(strip_quotes(from), None, false)?;
                    let to = participant(strip_quotes(to), None, false)?;
                    if chart.messages.len() >= limit / 300 {
                        return Err(BUDGET.into());
                    }
                    chart.messages.push(Message {
                        from,
                        to,
                        marker,
                        dashed,
                        label: strip_quotes(label).into(),
                    });
                }
            }
        }
        Ok(Some(chart))
    }

    pub fn layout(
        self,
        theme: &Theme,
        padding: f64,
        prefix: &str,
        title: Option<&str>,
        mut budget: usize,
    ) -> Result<Scene, String> {
        if padding > f64::from(i32::MAX / 4) {
            return Err(BUDGET.into());
        }
        let mut cards = Vec::with_capacity(self.participants.len());
        let mut remaining = budget / 256;
        let mut right = 0.;
        let mut max_h = 44.;
        for p in &self.participants {
            let links = self.links.get(&p.id);
            let named = links.is_some_and(|l| !l.named.is_empty());
            let href = links.and_then(|l| l.href.as_deref());
            let mut lines = Vec::new();
            let mut width: f64 = 0.;
            let base = if p.actor {
                format!("«actor»\n{}", p.label)
            } else {
                p.label.clone()
            };
            for (label, link) in std::iter::once((base.as_str(), if named { href } else { None }))
                .chain(
                    links
                        .into_iter()
                        .flat_map(|l| l.named.iter())
                        .map(|(s, h)| (s.as_str(), Some(h.as_str()))),
                )
            {
                let (rows, w) = text_block(label, 13., true, 240., remaining).ok_or(BUDGET)?;
                remaining -= rows.len();
                width = width.max(w);
                lines.extend(rows.into_iter().map(|s| (s, link)));
            }
            let w = f64::from(snap(width + 32.).max(108));
            let h = f64::from(snap(lines.len() as f64 * 18. + 20.).max(44));
            let x = if cards.is_empty() {
                -w / 2.
            } else {
                right + 56.
            };
            right = x + w;
            max_h = h.max(max_h);
            cards.push((x, w, h, lines, if named { None } else { href }));
        }
        let mut metrics = Vec::with_capacity(self.messages.len());
        for msg in &self.messages {
            metrics.push(if msg.label.is_empty() {
                None
            } else {
                let (lines, w) =
                    text_block(&msg.label, 12., false, 240., remaining).ok_or(BUDGET)?;
                remaining -= lines.len();
                Some((
                    ((w + 16.) / 4.).ceil() * 4.,
                    lines.len() as f64 * 16. + 8.,
                    lines,
                ))
            });
        }
        // Moving a suffix only widens existing spans, so one pass satisfies all constraints.
        for (msg, pill) in self.messages.iter().zip(&metrics) {
            let (left, right, span) = if msg.from == msg.to {
                let next = msg.from + 1;
                if next == cards.len() {
                    continue;
                }
                (
                    msg.from,
                    next,
                    54. + pill.as_ref().map_or(16., |p| p.0 + 20.) + cards[next].1 / 2.,
                )
            } else {
                (
                    msg.from.min(msg.to),
                    msg.from.max(msg.to),
                    64. + pill.as_ref().map_or(48., |p| p.0),
                )
            };
            let delta =
                cards[left].0 + cards[left].1 / 2. + span - (cards[right].0 + cards[right].1 / 2.);
            if delta > 0. {
                budget = budget.checked_sub(cards.len() - right).ok_or(BUDGET)?;
                for c in &mut cards[right..] {
                    c.0 += delta;
                }
            }
        }
        let min_x = cards.first().map_or(0., |c| c.0);
        right = cards.last().map_or(160., |c| c.0 + c.1);
        let mut cursor = max_h + 28.;
        let mut placed = Vec::with_capacity(metrics.len());
        for (msg, pill) in self.messages.iter().zip(metrics) {
            let a = cards[msg.from].0 + cards[msg.from].1 / 2.;
            let b = cards[msg.to].0 + cards[msg.to].1 / 2.;
            let (w, h) = pill.as_ref().map_or((0., 0.), |p| (p.0, p.1));
            let (route, tip, angle, px, py) = if msg.from == msg.to {
                let y = cursor + 8.;
                let loop_h = (h + 6.).max(28.);
                let end = y + loop_h;
                let outer = a + 42.;
                right = right.max(outer + if pill.is_some() { 10. + w } else { 0. });
                cursor += loop_h + 22.;
                (
                    Route::rounded(
                        &mut [(a, y), (outer, y), (outer, end), (a, end)],
                        [0., if msg.marker == Marker::Arrow { 6.8 } else { 0. }],
                        6.,
                    ),
                    (a, end),
                    std::f64::consts::PI,
                    outer + 10.,
                    ((y + end - h) / 2.).round(),
                )
            } else {
                let y = cursor + h + 10.;
                cursor = y + 18.;
                let pull = match msg.marker {
                    Marker::Arrow => 6.8,
                    Marker::Open => 0.,
                    Marker::Cross => 5.,
                };
                let end = if b > a { b - pull } else { b + pull };
                (
                    Route {
                        start: (a, y),
                        segments: vec![Segment::Line((end, y))],
                    },
                    (b, y),
                    if b > a { 0. } else { std::f64::consts::PI },
                    ((a + b - w) / 2.).round(),
                    (y - 6. - h).round(),
                )
            };
            placed.push((
                route,
                tip,
                angle,
                pill.map(|(w, h, rows)| (px, py, w, h, rows)),
            ));
        }
        let bottom = cursor + 16.;
        let (width, height) = (
            right - min_x,
            if cards.is_empty() {
                100.
            } else {
                bottom + max_h
            },
        );
        let dx = (padding - min_x + 0.5).floor();
        let dy = (padding + 0.5).floor();
        let mut scene = Scene {
            width: (width + padding * 2.).ceil(),
            height: (height + padding * 2.).ceil(),
            elements: vec![],
            paint: vec![],
        };
        let (strong, line_color) = theme.color("borderStrong");
        charge_attributes(&mut budget, &[(strong, cards.len())])?;
        for (x, w, h, _, _) in &cards {
            let x = x + w / 2. + dx;
            let y = h + dy;
            let end = bottom + dy;
            scene.elements.push(format!(r#"<line x1="{x}" y1="{y}" x2="{x}" y2="{end}" stroke="{strong}" stroke-width="1.25" stroke-dasharray="5 5"/>"#));
            scene.paint.push(Paint::Path {
                points: vec![(x, y), (x, end)],
                fill: None,
                stroke: line_color,
                width: 1.25,
                dashed: true,
            });
        }
        let font = &theme.font;
        let (fill, rgba) = theme.color("surface");
        let shadow = theme.color("shadowColor").1;
        for (p, (raw_x, w, h, lines, href)) in self.participants.iter().zip(cards) {
            let x = raw_x + dx;
            let cx = x + w / 2.;
            let (border, stroke) = theme.color(if p.actor { "accentBorder" } else { "border" });
            for (suffix, raw_y) in [("", 0.), ("__footer", bottom)] {
                let y = raw_y + dy;
                charge_attributes(
                    &mut budget,
                    &[(fill, 1), (border, 1), (href.unwrap_or(""), 1)],
                )?;
                let mut el = format!(
                    r#"<g class="mmdc-node" data-id="{}{suffix}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{border}" stroke-width="1.5" filter="url(#{prefix}mmdc-shadow)"/>"#,
                    esc(&p.id)
                );
                scene.paint.push(Paint::Box {
                    bounds: [x, y, w, h],
                    shape: Shape::Rounded,
                    shadow: Some(shadow),
                    style: BoxStyle {
                        radius: 8.,
                        header: None,
                        fill: rgba,
                        border: stroke,
                        thickness: 1.5,
                    },
                });
                for (i, (s, link)) in lines.iter().enumerate().filter(|(_, l)| !l.0.is_empty()) {
                    let actor = p.actor && i == 0;
                    let (size, weight) = if actor { (11., 500) } else { (13., 600) };
                    let (color, ink) = theme.color(if actor { "mutedText" } else { "text" });
                    let baseline = raw_y + 10. + (i as f64 + 0.78) * 18. + dy;
                    charge_attributes(
                        &mut budget,
                        &[(font, 1), (color, 1), (link.unwrap_or(""), 1)],
                    )?;
                    if let Some(link) = link {
                        write!(el, r#"<a href="{link}">"#).unwrap();
                    }
                    write!(el,r#"<text x="{cx}" y="{baseline}" fill="{color}" font-family="{font}" font-size="{size}" font-weight="{weight}" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,esc(s)).unwrap();
                    if link.is_some() {
                        el.push_str("</a>");
                    }
                    scene.paint.push(Paint::Text {
                        mono: false,
                        start: cx - measure(s, 13., true) / 2.,
                        baseline,
                        size,
                        weight,
                        color: ink,
                        text: s.clone(),
                    });
                }
                el.push_str("</g>");
                scene.elements.push(if let Some(href) = href {
                    format!(r#"<a href="{href}">{el}</a>"#)
                } else {
                    el
                });
            }
        }
        let mut edges = Vec::with_capacity(placed.len());
        let mut pills = Vec::new();
        let (edge, ink) = theme.color("edge");
        for (i, (msg, (mut route, tip, angle, pill))) in
            self.messages.iter().zip(placed).enumerate()
        {
            let shift = |p: &mut (f64, f64)| {
                p.0 += dx;
                p.1 += dy;
            };
            shift(&mut route.start);
            for seg in &mut route.segments {
                match seg {
                    Segment::Line(p) => shift(p),
                    Segment::Quad(a, b) => {
                        shift(a);
                        shift(b);
                    }
                }
            }
            charge_attributes(&mut budget, &[(edge, 3)])?;
            let path = route.svg();
            let dash = if msg.dashed {
                r#" stroke-dasharray="5 4""#
            } else {
                ""
            };
            let mut el = format!(
                r#"<g class="mmdc-edge" data-id="seq_msg_{}"><path d="{path}" fill="none" stroke="{edge}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"{dash}/>"#,
                i + 1
            );
            scene.paint.push(Paint::Edge {
                route,
                stroke: ink,
                width: 1.5,
                dashed: msg.dashed,
            });
            msg.marker.paint(
                (tip.0 + dx, tip.1 + dy),
                angle,
                (edge, ink),
                &mut el,
                &mut scene.paint,
            );
            el.push_str("</g>");
            edges.push(el);
            if let Some((px, py, w, h, rows)) = pill {
                let (x, y) = (px + dx, py + dy);
                let cx = x + w / 2.;
                let (fill, bg) = theme.color("edgeLabelBackground");
                let (border, stroke) = theme.color("edgeLabelBorder");
                let (color, ink) = theme.color("text");
                charge_attributes(
                    &mut budget,
                    &[
                        (fill, 1),
                        (border, 1),
                        (font, rows.len()),
                        (color, rows.len()),
                    ],
                )?;
                scene.paint.push(Paint::Box {
                    bounds: [x, y, w, h],
                    shape: Shape::Rounded,
                    shadow: None,
                    style: BoxStyle {
                        radius: 5.,
                        header: None,
                        fill: bg,
                        border: stroke,
                        thickness: 1.,
                    },
                });
                let mut el = format!(
                    r#"<g class="mmdc-label-pill"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{fill}" stroke="{border}" stroke-width="1"/>"#
                );
                for (i, s) in rows.into_iter().enumerate().filter(|(_, s)| !s.is_empty()) {
                    let baseline = py + 4. + (i as f64 + 0.78) * 16. + dy;
                    write!(el,r#"<text x="{cx}" y="{baseline}" fill="{color}" font-family="{font}" font-size="12" font-weight="500" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,esc(&s)).unwrap();
                    scene.paint.push(Paint::Text {
                        mono: false,
                        start: cx - measure(&s, 12., false) / 2.,
                        baseline,
                        size: 12.,
                        weight: 500,
                        color: ink,
                        text: s,
                    });
                }
                el.push_str("</g>");
                pills.push(el);
            }
        }
        scene
            .elements
            .splice(self.participants.len()..self.participants.len(), edges);
        scene.elements.extend(pills);
        if let Some(t) = title {
            scene.add_title(t, padding, theme);
        }
        Ok(scene)
    }
}
