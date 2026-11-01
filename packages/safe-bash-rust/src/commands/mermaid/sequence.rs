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
    group: Option<usize>,
}
#[derive(Default)]
struct Links {
    href: Option<String>,
    named: Vec<(String, String)>,
}
#[derive(Clone, Copy, PartialEq)]
enum Placement {
    Left,
    Right,
    Over,
}
struct Note {
    step: usize,
    side: Placement,
    first: usize,
    min: usize,
    max: usize,
    label: String,
}

struct Message {
    from: usize,
    to: usize,
    marker: Marker,
    dashed: bool,
    label: String,
}

fn message(text: &str) -> Option<(&str, &str, &str, Marker, bool, Option<bool>)> {
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
        let activation = match rest.as_bytes().first() {
            Some(b'+') => Some(true),
            Some(b'-') => Some(false),
            _ => None,
        };
        let to = &rest[usize::from(activation.is_some())..];
        if from.is_empty() || to.is_empty() {
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

struct ParticipantBox {
    label: String,
    fill: Option<(String, [u8; 4])>,
}
#[derive(Default)]
pub(in super::super) struct Sequence {
    participants: Vec<Participant>,
    messages: Vec<Message>,
    notes: Vec<Note>,
    boxes: Vec<ParticipantBox>,
    activations: Vec<(usize, usize, bool)>,
    links: BTreeMap<String, Links>,
}

impl Sequence {
    pub fn parse(stmts: &[Statement], limit: usize) -> Result<Option<Self>, String> {
        let mut chart = Self::default();
        let mut ids = BTreeMap::<String, usize>::new();
        let mut open_box: Option<&Statement> = None;
        for stmt in &stmts[1..] {
            let text = stmt.text.trim_end();
            let word = text.split_ascii_whitespace().next().unwrap_or("");
            let rest = text[word.len()..].trim_ascii();
            let step = chart.messages.len() + chart.notes.len();
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
                            group: open_box.map(|_| chart.boxes.len() - 1),
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
                "activate" | "deactivate" => {
                    let id = participant(strip_quotes(rest), None, false)?;
                    chart.activations.push((
                        step.saturating_sub(1),
                        id,
                        word.eq_ignore_ascii_case("activate"),
                    ));
                }
                "note" => {
                    let i = outside(rest, |s| s.starts_with(':'))
                        .ok_or_else(|| fail("Sequence 'Note' requires ': <text>'"))?;
                    let header = rest[..i].trim_ascii();
                    let lower = header.to_ascii_lowercase();
                    let (side, prefix) = [("left of ",Placement::Left),("right of ",Placement::Right),("over ",Placement::Over)].into_iter().find_map(|(prefix,side)|lower.starts_with(prefix).then_some((side,prefix))).ok_or_else(||fail(&format!("Invalid sequence Note placement '{header}' (expected 'left of', 'right of', or 'over')")))?;
                    let mut targets = header[prefix.len()..]
                        .split(',')
                        .map(|s| participant(strip_quotes(s), None, false));
                    let first = targets.next().unwrap()?;
                    let (mut min, mut max) = (first, first);
                    for id in targets {
                        let id = id?;
                        min = min.min(id);
                        max = max.max(id);
                    }
                    if step >= limit / 300 {
                        return Err(BUDGET.into());
                    }
                    chart.notes.push(Note {
                        step,
                        side,
                        first,
                        min,
                        max,
                        label: strip_quotes(&rest[i + 1..]).into(),
                    });
                }
                "box" => {
                    if open_box.is_some() {
                        return Err(fail("Participant boxes cannot be nested"));
                    }
                    let mut end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                    if let Some(i) = rest[..end].find('(') {
                        let mut depth = 0;
                        for (k, ch) in rest[i..].char_indices() {
                            if ch == '(' {
                                depth += 1;
                            } else if ch == ')' {
                                depth -= 1;
                                if depth == 0 {
                                    end = i + k + 1;
                                    break;
                                }
                            }
                        }
                    }
                    let fill = super::styles::css_color(&rest[..end])
                        .ok()
                        .map(|(s, c)| (s.to_owned(), c));
                    let label = if fill.is_some() {
                        rest[end..].trim_ascii()
                    } else {
                        rest
                    };
                    check_label(label, stmt, text)?;
                    chart.boxes.push(ParticipantBox {
                        label: strip_quotes(label).into(),
                        fill,
                    });
                    open_box = Some(stmt);
                }
                "end" => {
                    if open_box.take().is_none() {
                        return Err(fail("Unexpected 'end' without matching sequence block"));
                    }
                }
                "loop" | "opt" | "alt" | "else" => return Ok(None),
                _ => {
                    let Some((from, to, label, marker, dashed, activation)) = message(text) else {
                        return Err(fail(&format!(
                            "Unrecognized sequenceDiagram statement: '{text}'"
                        )));
                    };
                    let from = participant(strip_quotes(from), None, false)?;
                    let to = participant(strip_quotes(to), None, false)?;
                    if chart.messages.len() >= limit / 300 {
                        return Err(BUDGET.into());
                    }
                    if let Some(open) = activation {
                        chart
                            .activations
                            .push((step, if open { to } else { from }, open));
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
        if let Some(stmt) = open_box {
            return Err(stmt.error("E_SYNTAX", &stmt.text, "Unclosed participant box"));
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
        let mut constraints = Vec::new();
        for (msg, pill) in self.messages.iter().zip(&metrics) {
            constraints.push(if msg.from == msg.to {
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
            });
        }
        let mut notes = Vec::with_capacity(self.notes.len());
        for note in self.notes {
            let (lines, w) = text_block(&note.label, 12., false, 240., remaining).ok_or(BUDGET)?;
            remaining -= lines.len();
            let w = (((w + 24.) / 4.).ceil() * 4.).max(96.);
            let h = (lines.len() as f64 * 16. + 16.).max(36.);
            match note.side {
                Placement::Left if note.first > 0 => {
                    constraints.push((note.first - 1, note.first, w + 48.))
                }
                Placement::Right if note.first + 1 < cards.len() => {
                    constraints.push((note.first, note.first + 1, w + 48.))
                }
                _ => (),
            }
            notes.push((note, w, h, lines));
        }
        for (left, right, span) in constraints {
            let delta =
                cards[left].0 + cards[left].1 / 2. + span - (cards[right].0 + cards[right].1 / 2.);
            if delta > 0. {
                budget = budget.checked_sub(cards.len() - right).ok_or(BUDGET)?;
                for c in &mut cards[right..] {
                    c.0 += delta;
                }
            }
        }
        let mut min_x = cards.first().map_or(0., |c| c.0);
        right = cards.last().map_or(160., |c| c.0 + c.1);
        let mut cursor = max_h + 28.;
        let mut placed = Vec::with_capacity(metrics.len());
        let mut events = self.activations.into_iter().peekable();
        let mut stacks = vec![Vec::<f64>::new(); cards.len()];
        let mut seen = vec![false; cards.len()];
        let mut opening_order = Vec::new();
        let mut bars = Vec::new();
        let step_count = self.messages.len() + notes.len();
        let mut messages = self.messages.iter().zip(metrics);
        let mut notes = notes.into_iter().peekable();
        let mut placed_notes = Vec::new();
        for step in 0..step_count.max(1) {
            let note = notes.next_if(|(n, _, _, _)| n.step == step);
            let (msg, pill) = if note.is_none() {
                messages.next().map_or((None, None), |(m, p)| (Some(m), p))
            } else {
                (None, None)
            };
            let (w, h) = pill.as_ref().map_or((0., 0.), |p| (p.0, p.1));
            let y = match msg {
                Some(m) if m.from == m.to => cursor + 8.,
                Some(_) => cursor + h + 10.,
                None if note.is_some() => cursor,
                None => max_h + 20.,
            };
            // The arrow also touches bars that close at this step, including ones
            // opened and closed together. Keep the greatest depth at either tip.
            let mut depths = msg.map_or([0; 2], |m| [stacks[m.from].len(), stacks[m.to].len()]);
            while let Some((_, id, open)) = events.next_if(|e| e.0 == step) {
                let stack = &mut stacks[id];
                if open {
                    if !seen[id] {
                        opening_order.push(id);
                        seen[id] = true;
                    }
                    stack.push(y);
                    if let Some(m) = msg {
                        for (i, p) in [m.from, m.to].into_iter().enumerate() {
                            if p == id {
                                depths[i] = depths[i].max(stack.len());
                            }
                        }
                    }
                } else if let Some(start) = stack.pop() {
                    bars.push((id, stack.len(), start, (y - start).max(16.)));
                }
            }
            if let Some((note, mut w, h, lines)) = note {
                let left = cards[note.min].0 + cards[note.min].1 / 2.;
                let last = cards[note.max].0 + cards[note.max].1 / 2.;
                let x = match note.side {
                    Placement::Left => left - 18. - w,
                    Placement::Right => last + 18.,
                    Placement::Over => {
                        w = w.max(last - left + 48.);
                        ((left + last - w) / 2.).round()
                    }
                };
                min_x = min_x.min(x);
                right = right.max(x + w);
                placed_notes.push((x, y, w, h, lines));
                cursor += h + 18.;
            }
            let Some(msg) = msg else { continue };
            let mut a = cards[msg.from].0 + cards[msg.from].1 / 2.;
            let mut b = cards[msg.to].0 + cards[msg.to].1 / 2.;
            let rightward = b >= a;
            for (x, n, right) in [
                (&mut a, depths[0], rightward),
                (&mut b, depths[1], !rightward),
            ] {
                if n > 0 {
                    *x += if right { 5. + (n - 1) as f64 * 4. } else { -5. };
                }
            }
            let (route, tip, angle, px, py) = if msg.from == msg.to {
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
                cursor = y + 18.;
                let pull = match msg.marker {
                    Marker::Arrow => 6.8,
                    Marker::Open => 0.,
                    Marker::Cross => 5.,
                };
                let end = if rightward { b - pull } else { b + pull };
                (
                    Route {
                        start: (a, y),
                        segments: vec![Segment::Line((end, y))],
                    },
                    (b, y),
                    if rightward { 0. } else { std::f64::consts::PI },
                    ((a + b - w) / 2.).round(),
                    (y - 6. - h).round(),
                )
            };
            right = right.max(route.start.0).max(tip.0);
            if pill.is_some() {
                right = right.max(px + w);
            }
            placed.push((
                route,
                tip,
                angle,
                pill.map(|(w, h, rows)| (px, py, w, h, rows)),
            ));
        }
        let bottom = cursor + 16.;
        for id in opening_order {
            while let Some(start) = stacks[id].pop() {
                bars.push((id, stacks[id].len(), start, (bottom - 14. - start).max(20.)));
            }
        }
        let mut extents = vec![None; self.boxes.len()];
        for (p, c) in self.participants.iter().zip(&cards) {
            if let Some(id) = p.group {
                let [left, r, base] = extents[id].get_or_insert([c.0, c.0 + c.1, bottom + c.2]);
                *left = left.min(c.0);
                *r = r.max(c.0 + c.1);
                *base = base.max(bottom + c.2);
            }
        }
        let mut min_y: f64 = 0.;
        let mut max_y = if cards.is_empty() {
            100.
        } else {
            bottom + max_h
        };
        for [l, r, b] in extents.iter().flatten() {
            min_x = min_x.min(l - 16.);
            right = right.max(r + 16.);
            min_y = -48.;
            max_y = max_y.max(b + 16.);
        }
        let (width, height) = (right - min_x, max_y - min_y);
        let dx = (padding - min_x + 0.5).floor();
        let dy = (padding - min_y + 0.5).floor();
        let mut scene = Scene {
            width: (width + padding * 2.).ceil(),
            height: (height + padding * 2.).ceil(),
            elements: vec![],
            paint: vec![],
        };
        let mut frame_idx = 0;
        for (id, (group, extent)) in self.boxes.into_iter().zip(extents).enumerate() {
            let Some([left, right, base]) = extent else {
                continue;
            };
            let (x, y, w, h) = (left - 16. + dx, dy - 48., right - left + 32., base + 64.);
            let custom = group.fill.as_ref().map(|(s, c)| (s.as_str(), *c));
            let fill = custom.unwrap_or_else(|| theme.color("groupSurface"));
            let header = custom.unwrap_or_else(|| theme.color("groupHeaderSurface"));
            let border = theme.color("groupBorder");
            let (color, ink) = theme.color("text");
            let font = &theme.font;
            charge_attributes(
                &mut budget,
                &[
                    (fill.0, 1),
                    (header.0, 1),
                    (border.0, 2),
                    (font, 1),
                    (color, 1),
                ],
            )?;
            let mut el = super::groups::GroupFrame {
                bounds: [x, y, w, h],
                radius: 0.,
                thickness: 1.,
                fill,
                header,
                border,
            }
            .paint(
                &format!("participant_box_{id}"),
                frame_idx,
                prefix,
                &mut scene.paint,
            );
            frame_idx += 1;
            if !group.label.is_empty() {
                let cx = (left + right) / 2. + dx;
                let baseline = y + 22.;
                write!(el,r#"<text x="{cx}" y="{baseline}" fill="{color}" font-family="{font}" font-size="13" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,esc(&group.label)).unwrap();
                scene.paint.push(Paint::Text {
                    mono: false,
                    start: cx - measure(&group.label, 13., true) / 2.,
                    baseline,
                    size: 13.,
                    weight: 600,
                    color: ink,
                    text: group.label,
                });
            }
            el.push_str("\n</g>");
            scene.elements.push(el);
        }
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
        let (fill, bg) = theme.color("accentSurface");
        let (border, stroke) = theme.color("accentBorder");
        charge_attributes(&mut budget, &[(fill, bars.len()), (border, bars.len())])?;
        for (id, depth, start, h) in bars {
            let x = cards[id].0 + cards[id].1 / 2. - 5. + depth as f64 * 4. + dx;
            let y = start + dy;
            scene.elements.push(format!(r#"<rect x="{x}" y="{y}" width="10" height="{h}" rx="2" fill="{fill}" stroke="{border}" stroke-width="1.25"/>"#));
            scene.paint.push(Paint::Box {
                bounds: [x, y, 10., h],
                shape: Shape::Rounded,
                shadow: None,
                style: BoxStyle {
                    radius: 2.,
                    header: None,
                    fill: bg,
                    border: stroke,
                    thickness: 1.25,
                },
            });
        }
        let edge_layer = scene.elements.len();
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
            if let Some(pill) = pill {
                pills.push(pill);
            }
        }
        scene.elements.splice(edge_layer..edge_layer, edges);
        for (note, (px, py, w, h, rows)) in pills.into_iter().map(|p| (None, p)).chain(
            placed_notes
                .into_iter()
                .enumerate()
                .map(|(i, p)| (Some(i + 1), p)),
        ) {
            let (group, radius, thickness, weight, pad, filter) = if let Some(id) = note {
                (
                    format!(r#"<g class="mmdc-note" data-id="note_{id}">"#),
                    6.,
                    1.25,
                    400,
                    8.,
                    format!(r#" filter="url(#{prefix}mmdc-shadow)""#),
                )
            } else {
                (
                    r#"<g class="mmdc-label-pill">"#.into(),
                    5.,
                    1.,
                    500,
                    4.,
                    String::new(),
                )
            };
            let (x, y) = (px + dx, py + dy);
            let cx = x + w / 2.;
            let (fill, bg) = theme.color(if note.is_some() {
                "noteSurface"
            } else {
                "edgeLabelBackground"
            });
            let (border, stroke) = theme.color(if note.is_some() {
                "noteBorder"
            } else {
                "edgeLabelBorder"
            });
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
                shadow: note.map(|_| shadow),
                style: BoxStyle {
                    radius,
                    header: None,
                    fill: bg,
                    border: stroke,
                    thickness,
                },
            });
            let mut el = format!(
                r#"{group}<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{border}" stroke-width="{thickness}"{filter}/>"#
            );
            for (i, s) in rows.into_iter().enumerate().filter(|(_, s)| !s.is_empty()) {
                let baseline = py + pad + (i as f64 + 0.78) * 16. + dy;
                write!(el,r#"<text x="{cx}" y="{baseline}" fill="{color}" font-family="{font}" font-size="12" font-weight="{weight}" letter-spacing="0.025em" text-anchor="middle">{}</text>"#,esc(&s)).unwrap();
                scene.paint.push(Paint::Text {
                    mono: false,
                    start: cx - measure(&s, 12., false) / 2.,
                    baseline,
                    size: 12.,
                    weight,
                    color: ink,
                    text: s,
                });
            }
            el.push_str("</g>");
            scene.elements.push(el);
        }

        if let Some(t) = title {
            scene.add_title(t, padding, theme);
        }
        Ok(scene)
    }
}
