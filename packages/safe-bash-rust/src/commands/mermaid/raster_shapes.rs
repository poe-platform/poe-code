use super::super::Shape;
use super::{Frame, SUB};

#[derive(Clone, Copy)]
pub(in super::super) struct BoxStyle {
    pub radius: f64,
    pub fill: [u8; 4],
    pub border: [u8; 4],
    pub thickness: f64,
}
impl Frame {
    pub(super) fn box_shape(
        &mut self,
        bounds: [f64; 4],
        style: BoxStyle,
        shape: Shape,
        shadow: Option<[u8; 4]>,
    ) {
        let [x, y, w, h] = bounds;
        let scale = self.scale;
        let (cx, cy, hw, hh) = (
            (x + w / 2.) * scale,
            (y + h / 2.) * scale,
            w / 2. * scale,
            h / 2. * scale,
        );
        let r = (style.radius * scale).min(hw).min(hh);
        let half = style.thickness * scale / 2.;
        let dist = |px: f64, py: f64| {
            let (dx, dy) = ((px - cx).abs(), (py - cy).abs());
            if shape == Shape::Diamond {
                return (dx * hh + dy * hw - hw * hh) / hw.hypot(hh);
            }
            let (qx, qy) = (dx - (hw - r), dy - (hh - r));
            qx.max(0.).hypot(qy.max(0.)) + qx.max(qy).min(0.) - r
        };
        if let Some(color) = shadow
            && shape != Shape::Cylinder
        {
            let dy = 1.6 * scale;
            let blur = 3.5 * scale;
            let (xs, ys) = self.bounds(
                cx - hw - blur - 2.,
                cy + dy - hh - blur - 2.,
                cx + hw + blur + 2.,
                cy + dy + hh + blur + 2.,
            );
            for y in ys {
                for x in xs.clone() {
                    let d = dist(x as f64 + 0.5, y as f64 + 0.5 - dy);
                    if d < blur {
                        let t = ((blur - d) / (blur * 1.4)).clamp(0., 1.);
                        self.blend(x, y, color.map(f64::from), t * t * (3. - 2. * t));
                    }
                }
            }
        }
        if shape == Shape::Hexagon {
            let p = [
                (x + 13., y),
                (x + w - 13., y),
                (x + w, y + h / 2.),
                (x + w - 13., y + h),
                (x + 13., y + h),
                (x, y + h / 2.),
            ];
            self.path(&p, Some(style.fill), style.border, style.thickness, false);
            return;
        }
        if shape == Shape::Cylinder {
            let ry = (w * 0.075).round().clamp(9., 11.);
            let mut p = Vec::with_capacity(66);
            for top in [true, false] {
                for i in 0..=32 {
                    let t = std::f64::consts::PI * i as f64 / 32.;
                    let (s, c) = t.sin_cos();
                    p.push(if top {
                        (x + w / 2. * (1. - c), y + ry * (1. - s))
                    } else {
                        (x + w / 2. * (1. + c), y + h - ry + ry * s)
                    });
                }
            }
            self.path(&p, Some(style.fill), style.border, style.thickness, false);
            p.clear();
            for i in 0..=32 {
                let t = std::f64::consts::TAU * i as f64 / 32.;
                let (s, c) = t.sin_cos();
                p.push((x + w / 2. + w / 2. * c, y + ry + ry * s));
            }
            let [r, g, b, a] = style.fill;
            let lid = if r < 128 {
                [
                    r.saturating_add(18),
                    g.saturating_add(28),
                    b.saturating_add(58),
                    a,
                ]
            } else {
                [
                    r.saturating_sub(24),
                    g.saturating_sub(14),
                    b.saturating_sub(4),
                    a,
                ]
            };
            self.path(&p, Some(lid), style.border, style.thickness, false);
            return;
        }
        let (xs, ys) = self.bounds(
            cx - hw - half - 2.,
            cy - hh - half - 2.,
            cx + hw + half + 2.,
            cy + hh + half + 2.,
        );
        for py in ys {
            for px in xs.clone() {
                let d = dist(px as f64 + 0.5, py as f64 + 0.5);
                if d > half + 1.2 {
                    continue;
                }
                if d < -half - 1.2 {
                    self.blend(px, py, style.fill.map(f64::from), 1.);
                    continue;
                }
                let (mut fill, mut border) = (0, 0);
                for sy in SUB {
                    for sx in SUB {
                        let d = dist(px as f64 + sx, py as f64 + sy);
                        fill += u32::from(d <= 0.);
                        border += u32::from(d.abs() <= half);
                    }
                }
                self.blend(px, py, style.fill.map(f64::from), f64::from(fill) / 16.);
                self.blend(px, py, style.border.map(f64::from), f64::from(border) / 16.);
            }
        }
    }

    pub(super) fn path(
        &mut self,
        pts: &[(f64, f64)],
        fill: Option<[u8; 4]>,
        stroke: [u8; 4],
        width: f64,
        dashed: bool,
    ) {
        let scale = self.scale;
        let radius = width * scale / 2.;
        let mut edges = Vec::new();
        let mut arc = 0.;
        let (mut minx, mut miny, mut maxx, mut maxy) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for (i, &(x, y)) in pts.iter().enumerate() {
            let (x, y) = (x * scale, y * scale);
            minx = minx.min(x);
            miny = miny.min(y);
            maxx = maxx.max(x);
            maxy = maxy.max(y);
            if i + 1 == pts.len() && fill.is_none() {
                break;
            }
            let (qx, qy) = pts[(i + 1) % pts.len()];
            let (qx, qy) = (qx * scale, qy * scale);
            let (dx, dy) = (qx - x, qy - y);
            let len = dx.hypot(dy);
            edges.push((x, y, qx, qy, dx, dy, dx * dx + dy * dy, arc, len));
            arc += len;
        }
        let (xs, ys) = self.bounds(
            minx - radius - 2.,
            miny - radius - 2.,
            maxx + radius + 2.,
            maxy + radius + 2.,
        );
        for y in ys {
            for x in xs.clone() {
                let (mut fh, mut sh) = (0, 0);
                for sy in SUB {
                    for sx in SUB {
                        let (px, py) = (x as f64 + sx, y as f64 + sy);
                        let (mut inside, mut edge) = (false, false);
                        for &(ax, ay, bx, by, dx, dy, d2, offset, len) in &edges {
                            if fill.is_some()
                                && (ay > py) != (by > py)
                                && px < ((ax - bx) * (py - by)) / (ay - by + 1e-12) + bx
                            {
                                inside = !inside;
                            }
                            if !edge {
                                let t = if d2 <= 1e-6 {
                                    0.
                                } else {
                                    (((px - ax) * dx + (py - ay) * dy) / d2).clamp(0., 1.)
                                };
                                let (ex, ey) = (px - (ax + t * dx), py - (ay + t * dy));
                                edge = ex * ex + ey * ey <= radius * radius
                                    && (!dashed || (offset + t * len) % (9. * scale) <= 5. * scale);
                            }
                        }
                        fh += u32::from(inside);
                        sh += u32::from(edge);
                    }
                }
                if let Some(c) = fill
                    && fh != 0
                {
                    self.blend(x, y, c.map(f64::from), f64::from(fh) / 16.);
                }
                if sh != 0 {
                    self.blend(x, y, stroke.map(f64::from), f64::from(sh) / 16.);
                }
            }
        }
    }
}
