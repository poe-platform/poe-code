use super::{
    Scene, Shape, diamond_path, esc, measure,
    raster::{BoxStyle, Paint},
    scanner::{Statement, check_label},
};
use crate::commands::coreutils::{civil_from_days, days_from_civil};
use std::collections::BTreeMap;

const DAY: f64 = 86_400_000.;
struct Task {
    id: String,
    label: String,
    section: Option<usize>,
    start: f64,
    end: f64,
    status: String,
    milestone: bool,
}
pub(in super::super) struct Gantt {
    sections: Vec<String>,
    tasks: Vec<Task>,
}
fn date(s: &str) -> Option<f64> {
    if s.len() != 10
        || !s.is_ascii()
        || &s[4..5] != "-"
        || &s[7..8] != "-"
        || !s
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return None;
    }
    let year = s[..4].parse::<i32>().ok()?;
    let month = s[5..7].parse::<i32>().ok()?;
    let day = s[8..].parse::<i32>().ok()?;
    if !(1..=12).contains(&month) || !(1..=super::super::days_in_month(year, month)).contains(&day)
    {
        return None;
    }
    Some(days_from_civil(year.into(), month.into(), day.into()) as f64 * DAY)
}
fn duration(s: &str) -> Option<f64> {
    let split = s.find(|c: char| !c.is_ascii_digit() && c != '.')?;
    let factor = match &s[split..] {
        "ms" => 1.,
        "s" => 1_000.,
        "m" => 60_000.,
        "h" => 3_600_000.,
        "d" => DAY,
        "w" => 7. * DAY,
        _ => return None,
    };
    Some(s[..split].parse::<f64>().ok()? * factor)
}
fn time_label(ms: f64, with_time: bool) -> String {
    let ms = ms as i64;
    let (y, m, d) = civil_from_days(ms.div_euclid(DAY as i64));
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else {
        format!("{y:+07}")
    };
    let sec = ms.rem_euclid(DAY as i64) / 1000;
    let mut iso = format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        sec / 3600,
        sec / 60 % 60,
        sec % 60
    );
    iso.truncate(if with_time { 19 } else { 10 });
    iso
}
impl Gantt {
    pub(in super::super) fn parse(
        stmts: &[Statement],
        title: &mut Option<String>,
        limit: usize,
    ) -> Result<Self, String> {
        let mut chart = Self {
            sections: Vec::new(),
            tasks: Vec::new(),
        };
        let mut ends = BTreeMap::<String, f64>::new();
        for stmt in stmts.iter().skip(1) {
            let text = stmt.text.trim_end();
            let fail = |msg: &str| stmt.error("E_SYNTAX", text, msg);
            if let Some(value) = text.strip_prefix("title ") {
                check_label(value.trim(), stmt, text)?;
                *title = Some(value.trim().into());
                continue;
            }
            if let Some(value) = text.strip_prefix("dateFormat ") {
                if value.trim() != "YYYY-MM-DD" {
                    return Err(stmt.error(
                        "E_UNSUPPORTED",
                        text,
                        "Gantt dateFormat supports YYYY-MM-DD",
                    ));
                }
                continue;
            }
            if chart.sections.len() + chart.tasks.len() >= limit / 1024 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            if let Some(value) = text.strip_prefix("section ") {
                check_label(value.trim(), stmt, text)?;
                chart.sections.push(value.trim().into());
                continue;
            }
            let (label, schedule) = text
                .split_once(':')
                .filter(|(l, _)| !l.is_empty())
                .ok_or_else(|| fail("Gantt task requires a label and schedule"))?;
            let mut fields = schedule.split(',').map(str::trim).peekable();
            let mut tags = Vec::new();
            while let Some(tag) =
                fields.next_if(|s| matches!(*s, "done" | "active" | "crit" | "milestone"))
            {
                tags.push(tag)
            }
            let rest: Vec<_> = fields.take(4).collect();
            let (id, rest) = match rest.as_slice() {
                [id, _, _] => (Some(*id), &rest[1..]),
                [id, _] if date(id).is_none() && !id.starts_with("after ") => {
                    (Some(*id), &rest[1..])
                }
                _ => (None, rest.as_slice()),
            };
            if rest.contains(&"") {
                return Err(fail("Invalid Gantt schedule"));
            }
            let (start, raw_end) = match rest {
                [start, end] => (
                    if let Some(deps) = start.strip_prefix("after ") {
                        let mut latest = None;
                        for dep in deps.split(' ').filter(|d| !d.is_empty()) {
                            let &end = ends
                                .get(dep)
                                .ok_or_else(|| fail("Unknown Gantt dependency"))?;
                            latest = Some(latest.map_or(end, |v: f64| v.max(end)));
                        }
                        Some(latest.ok_or_else(|| fail("Unknown Gantt dependency"))?)
                    } else {
                        date(start)
                    },
                    *end,
                ),
                [end] => (chart.tasks.last().map(|t| t.end), *end),
                _ => return Err(fail("Invalid Gantt schedule")),
            };
            let invalid =
                || fail("Gantt requires valid dates, dependencies, and nonnegative durations");
            let start = start.ok_or_else(invalid)?;
            let end = duration(raw_end)
                .map(|len| start + len)
                .or_else(|| date(raw_end))
                .filter(|end| *end >= start && end.abs() <= 8.64e15)
                .ok_or_else(invalid)?;
            let id = id
                .map(str::to_owned)
                .unwrap_or_else(|| format!("gantt_{}", chart.tasks.len()));
            if ends.insert(id.clone(), end).is_some() {
                return Err(fail(&format!("Duplicate node '{id}'")));
            }
            let label = label.trim();
            check_label(label, stmt, text)?;
            chart.tasks.push(Task {
                id,
                label: label.into(),
                section: chart.sections.len().checked_sub(1),
                start,
                end,
                milestone: tags.contains(&"milestone"),
                status: tags.join(", "),
            });
        }
        if chart.tasks.is_empty() {
            return Err("mmdc: E_SYNTAX: gantt requires data\n".into());
        }
        Ok(chart)
    }
    pub(in super::super) fn layout(
        self,
        theme: &super::config::Theme,
        padding: f64,
        title: Option<&str>,
        mut limit: usize,
    ) -> Result<Scene, String> {
        let (color, text_rgba) = theme.color("text");
        let font = &theme.font;
        let (border, border_rgba) = theme.color("border");
        let accent = theme.color("accent");
        let headings = self
            .tasks
            .iter()
            .enumerate()
            .filter(|(i, t)| {
                t.section.is_some() && (*i == 0 || t.section != self.tasks[i - 1].section)
            })
            .count();
        let labels = self.tasks.len() * 2 + 2 + headings + usize::from(title.is_some());
        super::config::charge_attributes(
            &mut limit,
            &[(font, labels), (color, labels), (border, self.tasks.len())],
        )?;
        let (mut start, mut end, mut label_width) = (f64::INFINITY, f64::NEG_INFINITY, 120_f64);
        for t in &self.tasks {
            start = start.min(t.start);
            end = end.max(t.end);
            label_width = label_width.max(measure(&t.label, 13., false) + 16.)
        }
        let time = |v| time_label(v, end - start < DAY);
        let plot = padding + label_width + 32.;
        let width = plot + 600. + padding + 8.;
        let mut scene = Scene {
            width,
            height: 0.,
            elements: Vec::new(),
            paint: Vec::new(),
        };
        let text = |scene: &mut Scene,
                    id: &str,
                    value: &str,
                    x: f64,
                    y: f64,
                    w: f64,
                    right: bool| {
            let tx = if right { x + w } else { x };
            let baseline = y + 17.;
            let anchor = if right { "end" } else { "start" };
            scene.elements.push(format!(r#"<g class="mmdc-node" data-id="{}"><rect x="{x}" y="{y}" width="{w}" height="24" rx="0" fill="transparent" stroke="transparent" stroke-width="0"/><text x="{tx}" y="{baseline}" fill="{color}" font-family="{font}" font-size="13" font-weight="400" letter-spacing="0.025em" text-anchor="{anchor}">{}</text></g>"#,esc(id),esc(value)));
            scene.paint.push(Paint::Text {
                start: if right {
                    tx - measure(value, 13., false)
                } else {
                    tx
                },
                baseline,
                size: 13.,
                weight: 400,
                color: text_rgba,
                text: value.into(),
            });
        };
        text(
            &mut scene,
            "gantt_start",
            &time(start),
            plot,
            padding,
            284.,
            false,
        );
        text(
            &mut scene,
            "gantt_end",
            &time(end),
            plot + 316.,
            padding,
            284.,
            true,
        );
        let mut y = padding + 48.;
        let mut prev = None;
        let span = (end - start).max(1.);
        for t in self.tasks {
            if let Some(idx) = t.section
                && prev != t.section
            {
                text(
                    &mut scene,
                    &format!("heading_section_{idx}"),
                    &self.sections[idx],
                    padding,
                    y,
                    width - 2. * padding,
                    false,
                );
                y += 48.;
            }
            prev = t.section;
            text(
                &mut scene,
                &format!("label_{}", t.id),
                &t.label,
                padding,
                y,
                label_width,
                false,
            );
            let x = plot + (t.start - start) / span * 600. - if t.milestone { 8. } else { 0. };
            let w = if t.milestone {
                16.
            } else {
                ((t.end - t.start) / span * 600.).max(1.)
            };
            let (fill, fill_rgba) = if t.status.contains("crit") {
                ("#dc2626", [220, 38, 38, 255])
            } else if t.status.contains("done") {
                ("#64748b", [100, 116, 139, 255])
            } else {
                accent
            };
            super::config::charge_attributes(&mut limit, &[(fill, 1)])?;
            let shape = if t.milestone {
                format!(r#"<path d="{}""#, diamond_path(x, y, w, 24.))
            } else {
                format!(r#"<rect x="{x}" y="{y}" width="{w}" height="24" rx="3""#)
            };
            scene.elements.push(format!(r#"<g class="mmdc-node" data-id="{}">{shape} fill="{fill}" stroke="{border}" stroke-width="1"/></g>"#,esc(&t.id)));
            scene.paint.push(Paint::Box {
                bounds: [x, y, w, 24.],
                shape: if t.milestone {
                    Shape::Diamond
                } else {
                    Shape::Rect
                },
                shadow: None,
                style: BoxStyle {
                    radius: 3.,
                    fill: fill_rgba,
                    border: border_rgba,
                    thickness: 1.,
                    header: None,
                },
            });
            let mut schedule = format!("{} → {}", time(t.start), time(t.end));
            if !t.status.is_empty() {
                schedule.push_str(" · ");
                schedule.push_str(&t.status)
            }
            text(
                &mut scene,
                &format!("schedule_{}", t.id),
                &schedule,
                plot,
                y + 48.,
                600.,
                false,
            );
            y += 96.;
        }
        scene.height = y + padding;
        if let Some(t) = title {
            scene.add_title(t, padding, theme)
        }
        Ok(scene)
    }
}
