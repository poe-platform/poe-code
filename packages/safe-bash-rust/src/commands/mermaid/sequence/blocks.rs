use super::super::groups::GroupFrame;
use super::{BUDGET, BoxStyle, Paint, Scene, Shape, Theme, charge_attributes, esc, measure};
use std::{collections::BTreeMap, fmt::Write};

#[derive(Default, Clone)]
pub(super) struct Step {
    pub open: usize,
    pub close: usize,
    pub dividers: Vec<usize>,
    pub top: f64,
    bottom: f64,
    left: f64,
    right: f64,
}
impl Step {
    pub fn finish(&mut self, cursor: &mut f64, left: f64, right: f64) {
        self.bottom = *cursor;
        self.left = left;
        self.right = right;
        *cursor += 20. * self.close as f64;
    }
}

pub(super) struct Block {
    id: usize,
    pub order: usize,
    title: String,
    parent: Option<usize>,
    pub depth: usize,
    pub start: usize,
    pub end: usize,
    pub branches: BTreeMap<usize, String>,
    pub dividers: Vec<(usize, f64)>,
    pub bounds: [f64; 4],
    label_x: f64,
}
impl Block {
    pub fn new(
        id: usize,
        keyword: &str,
        label: &str,
        parent: Option<usize>,
        depth: usize,
        start: usize,
    ) -> Self {
        Self {
            id,
            title: format!("{}  [{label}]", keyword.to_ascii_uppercase()),
            parent,
            depth,
            start,
            end: start,
            order: 0,
            branches: BTreeMap::new(),
            dividers: Vec::new(),
            bounds: [0.; 4],
            label_x: 0.,
        }
    }
}

pub(super) fn place(
    blocks: &mut [Block],
    steps: &[Step],
    centers: &[f64],
    budget: &mut usize,
) -> Result<(), String> {
    // Children were opened after their parents. Walk backwards so a parent
    // already knows the combined extents of its direct children.
    let mut children: Vec<Option<[f64; 4]>> = vec![None; blocks.len()];
    for (i, b) in blocks.iter_mut().enumerate().rev() {
        if b.start == b.end {
            continue;
        }
        *budget = budget.checked_sub(b.end - b.start).ok_or(BUDGET)?;
        let (mut l, mut r) = (f64::INFINITY, f64::NEG_INFINITY);
        for s in &steps[b.start..b.end] {
            l = l.min(s.left);
            r = r.max(s.right);
        }
        let mut top = steps[b.start].top - 38.;
        let mut bottom = steps[b.end - 1].bottom + 12.;
        if let Some([a, t, z, v]) = children[i] {
            l = l.min(a - 18.);
            r = r.max(z + 18.);
            top = top.min(t - 36.);
            bottom = bottom.max(v + 18.);
        }
        let x = (l - 24.).floor();
        let first = centers
            .get(centers.partition_point(|&c| c < x))
            .copied()
            .unwrap_or(x);
        let tw = measure(&b.title, 12., true);
        b.label_x = if x + 12. <= first + 10. && x + 12. + tw >= first - 8. {
            first + 14.
        } else {
            x + 12.
        };
        let w = (((r + 20.).max(b.label_x + tw + 16.) - x) / 4.).ceil() * 4.;
        let y = top.floor();
        let h = (bottom - top).ceil();
        b.bounds = [x, y, w, h];
        if let Some(parent) = b.parent {
            let v = children[parent].get_or_insert([x, y, x + w, y + h]);
            v[0] = v[0].min(x);
            v[1] = v[1].min(y);
            v[2] = v[2].max(x + w);
            v[3] = v[3].max(y + h);
        }
    }
    Ok(())
}

impl Block {
    #[allow(clippy::too_many_arguments)]
    pub fn paint(
        self,
        idx: usize,
        prefix: &str,
        (dx, dy): (f64, f64),
        theme: &Theme,
        budget: &mut usize,
        scene: &mut Scene,
        headers: &mut Vec<Paint>,
    ) -> Result<(), String> {
        let [gx, gy, w, h] = self.bounds;
        let (x, y, lx) = (gx + dx, gy + dy, self.label_x + dx);
        let (fill, header, border) = (
            theme.color("groupSurface"),
            theme.color("surfaceElevated"),
            theme.color("groupBorder"),
        );
        let (color, ink) = theme.color("text");
        let font = &theme.font;
        charge_attributes(
            budget,
            &[
                (fill.0, 1),
                (header.0, 1),
                (border.0, 2),
                (color, 1),
                (font, 1),
            ],
        )?;
        let mut el = GroupFrame {
            bounds: [x, y, w, h],
            header_height: 28.,
            dashed: true,
            radius: 8.,
            thickness: 1.25,
            fill,
            header,
            border,
        }
        .paint(
            &format!("seq_block_{}", self.id),
            idx,
            prefix,
            &mut scene.paint,
        );
        let ly = gy + 18. + dy;
        write!(el,r#"<text x="{lx}" y="{ly}" fill="{color}" font-family="{font}" font-size="12" font-weight="600" letter-spacing="0.025em" text-anchor="start">{}</text>"#,esc(&self.title)).unwrap();
        headers.push(Paint::Box {
            bounds: [x + 1., y + 1., w - 2., 28.],
            shape: Shape::Rounded,
            shadow: None,
            style: BoxStyle {
                dashed: false,
                radius: 7.,
                fill: header.1,
                header: None,
                border: border.1,
                thickness: 1.,
            },
        });
        for layer in [&mut scene.paint, headers] {
            layer.push(Paint::Text {
                mono: false,
                start: lx,
                baseline: ly,
                size: 12.,
                weight: 600,
                color: ink,
                text: self.title.clone(),
            });
        }
        let (surface, bg) = theme.color("surface");
        let (outline, stroke) = theme.color("border");
        let (muted, mink) = theme.color("mutedText");
        charge_attributes(
            budget,
            &[
                (border.0, self.dividers.len()),
                (surface, self.dividers.len()),
                (outline, self.dividers.len()),
                (font, self.dividers.len()),
                (muted, self.dividers.len()),
            ],
        )?;
        for (step, raw_y) in self.dividers {
            let label = format!("[{}]", self.branches[&step]);
            let y = raw_y + dy;
            let right = x + w;
            let line = border.0;
            el.push('\n');
            write!(el,r#"<line x1="{x}" y1="{y}" x2="{right}" y2="{y}" stroke="{line}" stroke-width="1" stroke-dasharray="5 4"/>"#).unwrap();
            scene.paint.push(Paint::Path {
                points: vec![(x, y), (right, y)],
                fill: None,
                stroke: border.1,
                width: 1.,
                dashed: true,
            });
            let (px, py, pw, ly) = (
                lx - 6.,
                y + 3.,
                (measure(&label, 11., true) + 12.).ceil(),
                raw_y + 15. + dy,
            );
            el.push('\n');
            write!(el,r#"<rect x="{px}" y="{py}" width="{pw}" height="17" rx="4" fill="{surface}" stroke="{outline}" stroke-width="0.75"/>"#).unwrap();
            scene.paint.push(Paint::Box {
                bounds: [px, py, pw, 17.],
                shape: Shape::Rounded,
                shadow: None,
                style: BoxStyle {
                    dashed: false,
                    radius: 4.,
                    header: None,
                    fill: bg,
                    border: stroke,
                    thickness: 0.75,
                },
            });
            el.push('\n');
            write!(el,r#"<text x="{lx}" y="{ly}" fill="{muted}" font-family="{font}" font-size="11" font-weight="600" letter-spacing="0.025em" text-anchor="start">{}</text>"#,esc(&label)).unwrap();
            scene.paint.push(Paint::Text {
                mono: false,
                start: lx,
                baseline: ly,
                size: 11.,
                weight: 600,
                color: mink,
                text: label,
            });
        }
        el.push_str("\n</g>");
        scene.elements.push(el);
        Ok(())
    }
}
