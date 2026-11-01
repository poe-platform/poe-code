use super::{
    Scene, Shape,
    config::{Theme, charge_attributes},
    esc, interaction_href, measure,
    raster::{BoxStyle, Paint},
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
#[derive(Default)]
pub(in super::super) struct Sequence {
    participants: Vec<Participant>,
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
                    if id.is_empty() {
                        return Err(fail("Missing participant identifier in sequenceDiagram"));
                    }
                    if let Some(&idx) = ids.get(id) {
                        let p = &mut chart.participants[idx];
                        p.actor |= actor;
                        if let Some(label) = label {
                            p.label = label.into();
                        }
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
                    }
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
                _ if text.contains('-') => return Ok(None),
                _ => {
                    return Err(fail(&format!(
                        "Unrecognized sequenceDiagram statement: '{text}'"
                    )));
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
        let bottom = max_h + 44.;
        let (min_x, width, height) = cards
            .first()
            .map_or((0., 160., 100.), |c| (c.0, right - c.0, bottom + max_h));
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
        if let Some(t) = title {
            scene.add_title(t, padding, theme);
        }
        Ok(scene)
    }
}
