use super::{Node, Shape};
pub(super) const MONO: &[u8] = include_bytes!("mono.bin");
pub(super) fn mono_advance(c: char) -> u32 {
    let pos = 6 * super::glyph_index(c) + 4;
    u16::from_le_bytes([MONO[pos], MONO[pos + 1]]).into()
}
fn mono_width(s: &str, size: f64) -> f64 {
    (s.chars().map(|c| u64::from(mono_advance(c))).sum::<u64>() as f64 / 1000. * size * 100.).ceil()
        / 100.
}
pub(super) struct Member {
    pub kind: String,
    pub name: String,
    pub badge: Option<&'static str>,
}
impl Member {
    pub fn width(&self, size: f64, method: bool) -> f64 {
        let width = if method {
            super::measure(&format!("{}()", self.name), size, false)
        } else {
            super::measure(&self.name, size, false)
        };
        width
            + (if self.kind.is_empty() {
                0.
            } else {
                mono_width(&self.kind, size) + 16.
            })
            + 40.
            + if self.badge.is_some() { 34. } else { 0. }
    }
}
pub fn header_height(n: &Node, text: f64) -> f64 {
    if n.stereotype.is_empty() {
        (text + 16.).max(36.)
    } else {
        (text + 30.).max(46.)
    }
}
pub(super) fn paint_members(
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
    let count = node
        .attributes
        .iter()
        .chain(&node.methods)
        .filter(|a| !a.name.is_empty())
        .count();
    let typed = node
        .attributes
        .iter()
        .chain(&node.methods)
        .filter(|a| !a.kind.is_empty())
        .count();
    let badges = node.attributes.iter().filter(|a| a.badge.is_some()).count();
    charge_attributes(
        budget,
        &[
            (border, 1 + usize::from(!node.methods.is_empty())),
            (text, count),
            (muted, typed),
            (font, count),
            (mono, typed + badges),
            (fill, badges),
            (accent_border, badges),
            (accent, badges),
        ],
    )?;
    let right = x + w;
    for divider_y in std::iter::once(y).chain((!node.methods.is_empty()).then_some(
        y + if node.attributes.is_empty() {
            0.
        } else {
            node.attributes.len() as f64 * 22. + 12.
        },
    )) {
        let y = divider_y;
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
    }
    let mut rows = String::new();
    let mut ops = Vec::new();
    for (i, a) in node.attributes.iter().chain(&node.methods).enumerate() {
        let cursor = y
            + 6.
            + 22. * i as f64
            + if !node.attributes.is_empty() && i >= node.attributes.len() {
                12.
            } else {
                0.
            };
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
                    dashed: false,
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
        if !a.name.is_empty() {
            write!(rows,r#"<text x="{lx}" y="{baseline}" fill="{text}" font-family="{font}" font-size="{sz}" font-weight="500" letter-spacing="0.025em" text-anchor="start">{}</text>"#,esc(&a.name)).unwrap();
            ops.push(Paint::Text {
                mono: false,
                start: lx,
                baseline,
                size,
                weight: 500,
                color: text_rgba,
                text: a.name.clone(),
            });
        }
        if !a.kind.is_empty() {
            write!(rows,r#"<text x="{rx}" y="{baseline}" fill="{muted}" font-family="{mono}" font-size="{sz}" font-weight="400" letter-spacing="0.025em" text-anchor="end">{}</text>"#,esc(&a.kind)).unwrap();
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
    }
    Ok((rows, ops))
}
