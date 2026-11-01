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

fn diagnostic(source: &str, at: Option<&str>, code: &str, msg: &str) -> String {
    if let Some(at) = at {
        let (line, col) = super::position(source, at);
        format!("mmdc: {code} (line {line}, column {col}): {msg}\n")
    } else {
        format!("mmdc: {code}: {msg}\n")
    }
}
fn safe_label(source: &str, at: Option<&str>, label: String) -> Result<String, String> {
    let lower = label.to_ascii_lowercase();
    for token in [
        "<script",
        "</script",
        "<iframe",
        "<object",
        "<embed",
        "<svg",
        "<img",
        "<a ",
        "javascript:",
        "onerror=",
        "onload=",
    ] {
        if lower.contains(token) {
            return Err(diagnostic(
                source,
                at,
                "E_UNSUPPORTED",
                &format!("Unsupported HTML or active content '{token}' in diagram label"),
            ));
        }
    }
    Ok(label)
}

impl Pie {
    pub(in super::super) fn parse(
        first_statement: &str,
        source: &str,
        limit: usize,
    ) -> Result<Self, String> {
        let mut pie = Self {
            title: None,
            show_data: false,
            slices: Vec::new(),
            total: 0.,
        };
        let mut header = true;
        let mut statement = |stmt: &str| -> Result<(), String> {
            let stmt = stmt.trim();
            if stmt.is_empty() {
                return Ok(());
            }
            if header {
                header = false;
                let mut tail = stmt.strip_prefix("pie").unwrap_or("").trim();
                if let Some(after) = tail.strip_prefix("showData") {
                    pie.show_data = true;
                    tail = after.trim();
                }
                if let Some(title) = tail.strip_prefix("title ") {
                    pie.title = Some(safe_label(source, None, title.trim().into())?);
                } else if !tail.is_empty() {
                    return Err(diagnostic(source, None, "E_SYNTAX", "Invalid pie header"));
                }
                return Ok(());
            }
            if let Some(title) = stmt.strip_prefix("title ") {
                pie.title = Some(safe_label(source, None, title.trim().into())?);
                return Ok(());
            }
            let fail = |m| diagnostic(source, Some(stmt), "E_SYNTAX", m);
            let quote = stmt.as_bytes()[0];
            if !matches!(quote, b'\'' | b'"') {
                return Err(fail("Pie labels must be quoted"));
            }
            let end = (1..stmt.len())
                .find(|&i| stmt.as_bytes()[i] == quote && stmt.as_bytes()[i - 1] != b'\\')
                .ok_or_else(|| fail("Invalid pie slice"))?;
            let raw = stmt[end + 1..]
                .trim()
                .strip_prefix(':')
                .ok_or_else(|| fail("Invalid pie slice"))?
                .trim();
            let radix = if raw.starts_with("0x") || raw.starts_with("0X") {
                16
            } else if raw.starts_with("0o") || raw.starts_with("0O") {
                8
            } else if raw.starts_with("0b") || raw.starts_with("0B") {
                2
            } else {
                0
            };
            let value = if radix == 0 {
                raw.parse::<f64>().ok()
            } else {
                raw[2..]
                    .chars()
                    .try_fold(0., |n, c| {
                        Some(n * f64::from(radix) + f64::from(c.to_digit(radix)?))
                    })
                    .filter(|_| raw.len() > 2)
            };
            let value = value
                .filter(|v| v.is_finite() && *v >= 0.)
                .ok_or_else(|| fail("Pie values must be finite nonnegative numbers"))?;
            pie.total += value;
            if !pie.total.is_finite() {
                return Err(diagnostic(
                    source,
                    None,
                    "E_SYNTAX",
                    "Pie total exceeds numeric range",
                ));
            }
            let mut label = String::new();
            let mut chars = stmt[1..end].chars().peekable();
            while let Some(c) = chars.next() {
                if c == '\\' && matches!(chars.peek(), Some('n' | '\'' | '"' | '\\')) {
                    let c = chars.next().unwrap();
                    label.push(if c == 'n' { '\n' } else { c });
                } else {
                    label.push(c);
                }
            }
            if pie.slices.len() >= limit / 256 {
                return Err(diagnostic(source, None, "E_LIMIT", "Node limit exceeded"));
            }
            pie.slices
                .push((safe_label(source, Some(stmt), label)?, value));
            Ok(())
        };
        let mut quote = None;
        let mut start = None;
        let offset = first_statement.as_ptr() as usize - source.as_ptr() as usize;
        for line in source[offset..].lines() {
            let base = line.as_ptr() as usize - source.as_ptr() as usize;
            let b = line.as_bytes();
            let mut i = 0;
            while i < b.len() {
                let ch = b[i];
                if let Some(q) = quote {
                    if ch == b'\\' {
                        i += 2;
                        continue;
                    }
                    if ch == q {
                        quote = None;
                    }
                } else if ch == b';' || (ch == b'%' && b.get(i + 1) == Some(&b'%')) {
                    if let Some(at) = start.take() {
                        statement(&source[at..base + i])?;
                    }
                    if ch == b'%' {
                        break;
                    }
                } else if !ch.is_ascii_whitespace() {
                    start.get_or_insert(base + i);
                    if matches!(ch, b'\'' | b'"') {
                        quote = Some(ch);
                    }
                }
                i += 1;
            }
            if quote.is_none()
                && let Some(at) = start.take()
            {
                statement(&source[at..base + b.len()])?;
            }
        }
        if let Some(at) = start {
            return Err(diagnostic(
                source,
                Some(&source[at..]),
                "E_SYNTAX",
                "Unterminated quoted string in diagram source",
            ));
        }
        if pie.total == 0. {
            return Err(diagnostic(
                source,
                None,
                "E_SYNTAX",
                "Pie requires a positive total",
            ));
        }
        Ok(pie)
    }

    pub(in super::super) fn layout(&self, theme: &str) -> Scene {
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
        let title_h = if title.is_some() { 40 } else { 0 };
        let cy = 152 + title_h;
        let title_width = title.map_or(0., |t| measure(t, 16., true));
        let width = (344. + legend).max(title_width + 64.);
        let height = (64 + title_h + 240.max(self.slices.len() * 48)) as f64;
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
            let mut points = format!("152,{cy}");
            for j in 0..=steps {
                let t = angle + sweep * j as f64 / steps as f64;
                let (sin, cos) = sector_sin_cos(t);
                write!(points, " {},{}", 152. + 120. * cos, cy as f64 + 120. * sin).unwrap();
            }
            angle += sweep;
            ends.push((angle, parse_color(fill).unwrap()));
            elements.push(format!(
                r#"<polygon class="mmdc-pie-slice" points="{points}" fill="{fill}" />"#
            ));
            let y = 32 + title_h + i * 48;
            paint.push(Paint::Box {
                bounds: [312., y as f64, legend, 24.],
                shape: super::Shape::Rect,
                shadow: None,
                style: BoxStyle {
                    radius: 3.,
                    fill: parse_color(fill).unwrap(),
                    border: parse_color(fill).unwrap(),
                    thickness: 0.,
                },
            });
            paint.push(Paint::Text {
                start: 324.,
                baseline: (y + 17) as f64,
                size: 13.,
                weight: 400,
                color: parse_color(color).unwrap(),
                text: label.clone(),
            });
            nodes.push(format!(r#"<g class="mmdc-node" data-id="legend_{i}"><rect x="312" y="{y}" width="{legend}" height="24" rx="3" fill="{fill}" stroke="{fill}" stroke-width="0"/><text x="324" y="{}" fill="{color}" font-family="{FONT}" font-size="13" font-weight="400" letter-spacing="0.025em" text-anchor="start">{}</text></g>"#,y+17,esc(&label)));
        }
        elements.extend(nodes);
        paint.insert(
            0,
            Paint::Pie {
                cy: cy as f64,
                ends,
            },
        );
        if let Some(t) = title {
            let color = if theme == "dark" {
                "#f8fafc"
            } else {
                "#0f172a"
            };
            paint.push(Paint::Text {
                start: (width - title_width) / 2.,
                baseline: 45.,
                size: 16.,
                weight: 600,
                color: parse_color(color).unwrap(),
                text: t.into(),
            });
            elements.push(format!(r#"<g class="mmdc-node" data-id="pie_title"><rect x="32" y="32" width="{}" height="16" rx="0" fill="transparent" stroke="transparent" stroke-width="0"/><text x="{}" y="45" fill="{color}" font-family="{FONT}" font-size="16" font-weight="600" letter-spacing="0.025em" text-anchor="middle">{}</text></g>"#,width-64.,width/2.,esc(t)));
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
