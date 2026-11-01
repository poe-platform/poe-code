use super::raster::{BoxStyle, Paint};
use super::{FONT, Scene, esc, measure};
use crate::commands::archive::parse_color;
use std::fmt::Write;

pub(in super::super) struct Pie {
    pub(in super::super) title: Option<String>,
    show_data: bool,
    slices: Vec<(String, f64)>,
    total: f64,
}

impl Pie {
    pub(in super::super) fn parse(
        stmts: &[super::Statement],
        limit: usize,
    ) -> Result<Self, String> {
        let mut header = stmts[0].text[3..].trim();
        let show_data = header.starts_with("showData");
        if show_data {
            header = header[8..].trim();
        }
        let title = |s: &str| -> Result<String, String> {
            let s = s.trim();
            if let Some(msg) = super::scanner::unsafe_label(s) {
                return Err(format!("mmdc: E_UNSUPPORTED: {msg}\n"));
            }
            Ok(s.into())
        };
        let mut pie = Self {
            title: None,
            show_data,
            slices: Vec::new(),
            total: 0.,
        };
        if let Some(raw) = header.strip_prefix("title ") {
            pie.title = Some(title(raw)?);
        } else if !header.is_empty() {
            return Err("mmdc: E_SYNTAX: Invalid pie header\n".into());
        }
        for stmt in &stmts[1..] {
            let text = stmt.text.trim_end();
            if let Some(raw) = text.strip_prefix("title ") {
                pie.title = Some(title(raw)?);
                continue;
            }
            let fail = |msg: &str| stmt.error("E_SYNTAX", text, msg);
            let bytes = text.as_bytes();
            let quote = bytes[0];
            if !matches!(quote, b'\'' | b'"') {
                return Err(fail("Pie labels must be quoted"));
            }
            let end = (1..bytes.len())
                .find(|&i| bytes[i] == quote && bytes[i - 1] != b'\\')
                .ok_or_else(|| fail("Invalid pie slice"))?;
            let raw = text[end + 1..]
                .trim()
                .strip_prefix(':')
                .ok_or_else(|| fail("Invalid pie slice"))?
                .trim();
            let value = super::number(raw);
            if raw.is_empty() || !value.is_finite() || value < 0. {
                return Err(fail("Pie values must be finite nonnegative numbers"));
            }
            pie.total += value;
            if !pie.total.is_finite() {
                return Err("mmdc: E_SYNTAX: Pie total exceeds numeric range\n".into());
            }
            let label = super::scanner::label(&text[..=end], stmt, text)?;
            if pie.slices.len() >= limit / 256 {
                return Err("mmdc: E_LIMIT: Node limit exceeded\n".into());
            }
            pie.slices.push((label, value));
        }
        if pie.total == 0. {
            return Err("mmdc: E_SYNTAX: Pie requires a positive total\n".into());
        }
        Ok(pie)
    }

    pub(in super::super) fn layout(&self, theme: &str, padding: f64) -> Scene {
        let mut labels = Vec::new();
        let mut legend: f64 = 120.;
        for (label, v) in &self.slices {
            let data = if self.show_data {
                format!(" [{}]", super::nonnegative_number(*v))
            } else {
                String::new()
            };
            let pct = 100. * (v / self.total);
            // Exact halfway cases for one decimal place have a fractional part
            // of .25 or .75. ECMAScript toFixed rounds these upwards.
            let percent = if matches!(pct.fract(), 0.25 | 0.75) {
                let tenths = (pct * 10.).round() as u32;
                format!("{}.{}", tenths / 10, tenths % 10)
            } else {
                format!("{pct:.1}")
            };
            let label = format!("{label}{data} ({percent}%)");
            legend = legend.max(measure(&label, 13., false));
            labels.push(label);
        }
        legend += 24.;
        let title = self.title.as_deref().filter(|s| !s.is_empty());
        let title_h = if title.is_some() { 40. } else { 0. };
        let cx = padding + 120.;
        let cy = padding + title_h + 120.;
        let legend_x = padding + 280.;
        let text_x = padding + 292.;
        let title_width = title.map_or(0., |t| measure(t, 16., true));
        let width = (padding * 2. + 280. + legend).max(title_width + padding * 2.);
        let height = padding * 2. + title_h + 240.max(self.slices.len() * 48) as f64;
        let mut elements = Vec::new();
        let mut nodes = Vec::new();
        let mut paint = Vec::new();
        let mut ends = Vec::new();
        let mut angle = -std::f64::consts::FRAC_PI_2;
        let colors = [
            ("#4e79a7", "#fff"),
            ("#f28e2b", "#0f172a"),
            ("#e15759", "#fff"),
            ("#76b7b2", "#0f172a"),
            ("#59a14f", "#fff"),
            ("#edc948", "#0f172a"),
            ("#b07aa1", "#0f172a"),
            ("#ff9da7", "#0f172a"),
        ];
        for (i, ((_, v), label)) in self.slices.iter().zip(labels).enumerate() {
            let (fill, color) = colors[i % colors.len()];
            let sweep = std::f64::consts::TAU * (v / self.total);
            let steps = ((sweep * 60.).ceil() as usize).max(1);
            let mut points = format!("{cx},{cy}");
            for j in 0..=steps {
                let t = angle + sweep * j as f64 / steps as f64;
                let (sin, cos) = sector_sin_cos(t);
                write!(points, " {},{}", cx + 120. * cos, cy + 120. * sin).unwrap();
            }
            angle += sweep;
            ends.push((angle, parse_color(fill).unwrap()));
            elements.push(format!(
                r#"<polygon class="mmdc-pie-slice" points="{points}" fill="{fill}" />"#
            ));
            let y = padding + title_h + (i * 48) as f64;
            paint.push(Paint::Box {
                bounds: [legend_x, y, legend, 24.],
                shape: super::Shape::Rect,
                shadow: None,
                style: BoxStyle {
                    header: None,
                    radius: 3.,
                    fill: parse_color(fill).unwrap(),
                    border: parse_color(fill).unwrap(),
                    thickness: 0.,
                },
            });
            paint.push(Paint::Text {
                start: text_x,
                baseline: y + 17.,
                size: 13.,
                weight: 400,
                color: parse_color(color).unwrap(),
                text: label.clone(),
            });
            nodes.push(format!(r#"<g class="mmdc-node" data-id="legend_{i}"><rect x="{legend_x}" y="{y}" width="{legend}" height="24" rx="3" fill="{fill}" stroke="{fill}" stroke-width="0"/><text x="{text_x}" y="{}" fill="{color}" font-family="{FONT}" font-size="13" font-weight="400" letter-spacing="0.025em" text-anchor="start">{}</text></g>"# ,y+17.,esc(&label)));
        }
        elements.extend(nodes);
        paint.insert(0, Paint::Pie { cx, cy, ends });
        if let Some(t) = title {
            let color = if theme == "dark" {
                "#f8fafc"
            } else {
                "#0f172a"
            };
            paint.push(Paint::Text {
                start: (width - title_width) / 2.,
                baseline: padding + 13.,
                size: 16.,
                weight: 600,
                color: parse_color(color).unwrap(),
                text: t.into(),
            });
            elements.push(format!(r#"<g class="mmdc-node" data-id="pie_title"><rect x="{padding}" y="{padding}" width="{}" height="16" rx="0" fill="transparent" stroke="transparent" stroke-width="0"/><text x="{}" y="{}" fill="{color}" font-family="{FONT}" font-size="16" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{}</text></g>"#,width-2.*padding,width/2.,padding+13.,esc(t)));
        }
        Scene {
            width,
            height,
            elements,
            paint,
        }
    }
}

// SVG serializes every sector point at full double precision. Use the fdlibm
// kernel order used by V8, including the low part of the reduced angle. Pie
// angles only range from -pi/2 through 3pi/2.
//
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
fn sector_sin_cos(angle: f64) -> (f64, f64) {
    let n = (angle / std::f64::consts::FRAC_PI_2).round();
    let head = angle - n * 1.570_796_326_734_125_6;
    let tail = n * 6.077_100_506_506_192e-11;
    let x = head - tail;
    let y = (head - x) - tail;
    let z = x * x;
    let v = z * x;
    let r = 8.333_333_333_322_49e-3
        + z * (-1.984_126_982_985_795e-4
            + z * (2.755_731_370_707_006_8e-6
                + z * (-2.505_076_025_340_686_3e-8 + z * 1.589_690_995_211_55e-10)));
    let s1 = -1.666_666_666_666_663_2e-1;
    let sin = if n == 0. {
        x + v * (s1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * s1)
    };
    let r = z
        * (4.166_666_666_666_66e-2
            + z * (-1.388_888_888_887_411e-3
                + z * (2.480_158_728_947_673e-5
                    + z * (-2.755_731_435_139_066_3e-7
                        + z * (2.087_572_321_298_175e-9 - z * 1.135_964_755_778_819_5e-11)))));
    let correction = z * r - x * y;
    let q = if x.abs() < 0.3 {
        0.
    } else if x.abs() > 0.78125 {
        0.28125
    } else {
        f64::from_bits((x.abs() / 4.).to_bits() & 0xffff_ffff_0000_0000)
    };
    let cos = (1. - q) - ((0.5 * z - q) - correction);
    match (n as i32).rem_euclid(4) {
        0 => (sin, cos),
        1 => (cos, -sin),
        2 => (-sin, -cos),
        _ => (-cos, sin),
    }
}
