// Cairo represents each surface pattern by a separate fixed-point inverse transform.
use super::{Image, Point};

// Pixman's box filter is tabulated at subpixel phases. Each row of fixed-point
// weights sums to one, with the rounding remainder assigned to the center tap.
struct BoxFilter {
    width: usize,
    phases: usize,
    weights: Vec<u32>,
}

impl BoxFilter {
    fn new(scale: f64) -> Self {
        let scale = if scale < 1. / 0.75 {
            1.
        } else {
            scale.min(16.)
        };
        let width = (scale + 1.).ceil() as usize;
        let mut phases = 1;
        while scale * phases as f64 <= 128. {
            phases *= 2;
        }
        let mut weights = vec![0; width * phases];
        for (phase, taps) in weights.chunks_exact_mut(width).enumerate() {
            let frac = (phase as f64 + 0.5) / phases as f64;
            let first = (frac - width as f64 / 2. - 0.5).ceil() - frac + 0.5;
            let mut total = 0.;
            for (i, tap) in taps.iter_mut().enumerate() {
                let v = ((scale + 1.) / 2. - (first + i as f64).abs()).clamp(0., 1.);
                total += v;
                *tap = (v * 65536.) as u32;
            }
            let normalize = 1. / total;
            for tap in taps.iter_mut() {
                *tap = (f64::from(*tap) * normalize) as u32;
            }
            taps[width / 2] += 65536 - taps.iter().sum::<u32>();
        }
        Self {
            width,
            phases,
            weights,
        }
    }

    fn taps(&self, pos: f64) -> (f64, &[u32]) {
        let scaled = (pos * self.phases as f64).floor();
        let phase = scaled.rem_euclid(self.phases as f64) as usize;
        let center = (scaled + 0.5) / self.phases as f64;
        let first = (center - (self.width - 1) as f64 / 2.).ceil() - 1.;
        (first, &self.weights[phase * self.width..][..self.width])
    }
}

pub(super) fn sampler(
    image: &Image,
    [a, b, c, d, e, f]: [f64; 6],
    center: Point,
) -> impl Fn(usize, usize, &mut usize) -> Option<[u8; 4]> + '_ {
    let (w, h) = (image.width as f64, image.height as f64);
    let det = a * d - b * c;
    let (xx, xy, yx, yy) = (w * d / det, -w * c / det, -h * b / det, h * a / det);
    let (ex, ey) = (-xx * e - xy * f, -yx * e - yy * f);
    // Split large translations between the device offset and the pattern,
    // minimizing the larger of the two before rounding to 16.16 precision.
    let (mut tx, mut ty) = (ex, ey);
    for i in [-1., 1.] {
        for j in [-1., 1.] {
            let den = (xx + i) * (yy + j) - xy * yx;
            if den.abs() < f64::EPSILON {
                continue;
            }
            // Cairo shares the rounded reciprocal between axes. Dividing each
            // numerator instead can break a tie and choose a different pixel offset.
            let inv = den.recip();
            let x = (ey * xy - ex * (yy + j)) * inv;
            let y = (ex * yx - ey * (xx + i)) * inv;
            if x.abs().max(y.abs()) < tx.abs().max(ty.abs()) {
                (tx, ty) = (x, y);
            }
        }
    }
    let (tx, ty) = (tx.floor(), ty.floor());
    let coord = |u: f64, v: f64, t: f64| {
        let (du, dv) = (
            (u * 65536.).round_ties_even(),
            (v * 65536.).round_ties_even(),
        );
        // Keep the transform anchored at the center of the destination bounds.
        let exact = ((center[0] + tx) * u + (center[1] + ty) * v + t) * 65536.;
        let offset = (exact - (du * center[0] + dv * center[1] + 0.5).floor()).round_ties_even();
        move |x: usize, y: usize| {
            ((x as f64 + 0.5 - tx) * du + (y as f64 + 0.5 - ty) * dv + offset + 0.5).floor()
                / 65536.
        }
    };
    let u = coord(xx, xy, ex);
    let v = coord(yx, yy, ey);
    let (s1, s2) = (a * a + b * b, c * c + d * d);
    let delta = (s1 - s2).hypot(2. * (a * c + b * d));
    let major = ((s1 + s2 + delta) / 2.).sqrt();
    let minor = ((s1 + s2 - delta).max(0.) / 2.).sqrt();
    let (sx, sy) = if w > h {
        (major, minor)
    } else {
        (minor, major)
    };
    let ox = e + c;
    let oy = f + d;
    let sw = ((ox + sx + 0.01).round() - 1. - (ox - 0.01).round()).abs() + 1.;
    let sh = ((oy + sy - 0.01).ceil() - (oy + 0.01).floor())
        .abs()
        .max(1.);
    let linear = image.interpolate || (sw < 4. * w && sh < 4. * h);
    let bilinear = |x: f64, y: f64, t: f64| {
        let h = x * x + y * y;
        h < 1. / (0.75 * 0.75)
            || (3.99 < h
                && h < 4.01
                && (x * y * 256.).round_ties_even() == 0.
                && (t * 256.).round_ties_even() % 256. == 0.)
    };
    let filters = (linear && !(bilinear(xx, xy, ex) && bilinear(yx, yy, ey)))
        .then(|| (BoxFilter::new(xx.hypot(xy)), BoxFilter::new(yx.hypot(yy))));
    move |x, y, work| {
        let (u, v) = (u(x, y), v(x, y));
        let pixel = |x: f64, y: f64| {
            image.pixels[(y as usize).min(image.height - 1) * image.width
                + (x as usize).min(image.width - 1)]
        };
        if !linear {
            return Some(pixel(u.ceil() - 1., v.ceil() - 1.));
        }
        if let Some((cols, rows)) = &filters {
            let (left, wx) = cols.taps(u);
            let (top, wy) = rows.taps(v);
            *work = work.checked_sub(wx.len() * wy.len())?;
            let mut sum = [0u32; 4];
            for (j, &fy) in wy.iter().enumerate() {
                if fy == 0 {
                    continue;
                }
                for (i, &fx) in wx.iter().enumerate() {
                    if fx == 0 {
                        continue;
                    }
                    let weight = ((u64::from(fx) * u64::from(fy) + 32768) >> 16) as u32;
                    let p = pixel(left + i as f64, top + j as f64);
                    for k in 0..4 {
                        sum[k] += u32::from(p[k]) * weight;
                    }
                }
            }
            return Some(sum.map(|s| ((s + 32768) >> 16).min(255) as u8));
        }
        let (x, y) = (u - 0.5, v - 0.5);
        let (ix, iy) = (x.floor(), y.floor());
        let (fx, fy) = (((x - ix) * 128.) as u32, ((y - iy) * 128.) as u32);
        let [tl, tr, bl, br] = [
            pixel(ix, iy),
            pixel(ix + 1., iy),
            pixel(ix, iy + 1.),
            pixel(ix + 1., iy + 1.),
        ];
        Some(std::array::from_fn(|i| {
            let top = u32::from(tl[i]) * (128 - fx) + u32::from(tr[i]) * fx;
            let bottom = u32::from(bl[i]) * (128 - fx) + u32::from(br[i]) * fx;
            ((top * (128 - fy) + bottom * fy) >> 14) as u8
        }))
    }
}

// Cairo measures polygon edges in 1/256-pixel units horizontally and uses
// 15 subrows vertically. An uninterrupted pair of edges takes the analytic
// scanline path; a vertex inside the row switches to horizontal subspans.
pub(super) struct Footprint([Point; 4]);

pub(super) enum Coverage {
    Box { left: f64, right: f64, height: f64 },
    Edges([ScanEdge; 2]),
    Spans([(f64, f64); 15]),
}

// Keep both endpoints over a shared denominator: rounding their positions
// before finding column crossings can move a crossing by one subrow.
#[derive(Clone, Copy, Default)]
pub(super) struct ScanEdge {
    top: f64,
    bottom: f64,
    denominator: f64,
    next_sample: f64,
}

impl Footprint {
    pub(super) fn new([a, b, c, d, e, f]: [f64; 6]) -> Self {
        let corners = [
            [e, f],
            [e + a, f + b],
            [e + a + c, f + b + d],
            [e + c, f + d],
        ]
        .map(|p| p.map(|v| (v * 256.).round_ties_even()));
        Self(corners)
    }

    pub(super) fn row(&self, y: usize, width: usize) -> Coverage {
        let [a, b, c, d] = self.0;
        if (a[0] == b[0] && a[1] == d[1]) || (a[1] == b[1] && a[0] == d[0]) {
            let y = y as f64 * 256.;
            return Coverage::Box {
                left: a[0].min(c[0]),
                right: a[0].max(c[0]),
                height: (a[1].max(c[1]).min(y + 256.) - a[1].min(c[1]).max(y)).max(0.),
            };
        }
        let start = y as f64 * 15.;
        let mut lines = [ScanEdge::default(); 2];
        let mut count = 0;
        let mut spans = [(f64::INFINITY, f64::NEG_INFINITY); 15];
        let mut whole = true;
        for (i, &p) in self.0.iter().enumerate() {
            let q = self.0[(i + 1) % 4];
            let ([x0, y0], [x1, y1]) = if p[1] < q[1] { (p, q) } else { (q, p) };
            let grid_y = |v: f64| (v * 15. / 256. + 0.5).floor();
            let from = (grid_y(y0) - start).clamp(0., 15.) as usize;
            let to = (grid_y(y1) - start).clamp(0., 15.) as usize;
            if from == to {
                continue;
            }
            let den = 2. * (y1 - y0) * 15.;
            let slope = 512. * (x1 - x0);
            let start_x = x0 * den + 2. * (start * 256. - y0 * 15.) * (x1 - x0);
            let sample = |sub: f64| ((start_x + sub * slope + den / 2.) / den).floor();
            if from == 0 && to == 15 && count < 2 {
                // The full-row stepper subtracts half its integer step and
                // half its remainder separately from the first sample.
                let top = start_x + (slope / den).trunc() % 2. * den / 2.;
                let bottom = top + 15. * slope;
                lines[count] = ScanEdge {
                    top,
                    bottom,
                    denominator: den,
                    next_sample: sample(15.5),
                };
                // Clipping against the page introduces a vertex wherever
                // an edge crosses either side within the row.
                for boundary in [0., width as f64 * 256. * den] {
                    let end_x = start_x + 15. * slope;
                    if start_x.min(end_x) < boundary && boundary < start_x.max(end_x) {
                        whole = false;
                    }
                }
                count += 1;
            } else {
                whole = false;
            }
            for (sub, span) in spans.iter_mut().enumerate().take(to).skip(from) {
                let sample = sample(sub as f64 + 0.5);
                span.0 = span.0.min(sample);
                span.1 = span.1.max(sample);
            }
        }
        let middle = |e: &ScanEdge| (e.top + e.bottom) / e.denominator;
        if count == 2 && middle(&lines[0]) > middle(&lines[1]) {
            lines.swap(0, 1);
        }
        whole &= count == 2 && lines[0].next_sample <= lines[1].next_sample;
        if whole {
            Coverage::Edges(lines)
        } else {
            Coverage::Spans(spans)
        }
    }
}

impl Coverage {
    pub(super) fn alpha(&self, col: usize) -> u8 {
        let x = col as f64 * 256.;
        let area = match self {
            Self::Box {
                left,
                right,
                height,
            } => {
                let width = (right.min(x + 256.) - left.max(x)).max(0.);
                return (width * height / 256.) as u8;
            }
            Self::Edges(lines) => lines[1].area_to_left(x) - lines[0].area_to_left(x),
            Self::Spans(spans) => spans
                .iter()
                .map(|&(l, r)| 2. * (r.min(x + 256.) - l.max(x)).max(0.))
                .sum(),
        };
        ((area * 17. + 256.) / 512.).floor().clamp(0., 255.) as u8
    }
}

impl ScanEdge {
    // Twice the subpixel area left of this edge inside the column.
    fn area_to_left(&self, x: f64) -> f64 {
        let den = self.denominator;
        let (lo, hi) = (
            self.top.min(self.bottom) - x * den,
            self.top.max(self.bottom) - x * den,
        );
        if hi <= 0. {
            return 0.;
        }
        if lo >= 256. * den {
            return 7680.;
        }
        if lo == hi {
            return 30. * (lo / den).floor();
        }
        let height = |at: f64| ((at * den - lo) * 15. / (hi - lo)).floor().clamp(0., 15.);
        let end = height(256.);
        ((lo / den).floor().clamp(0., 256.) + (hi / den).floor().clamp(0., 256.))
            * (end - height(0.))
            + 512. * (15. - end)
    }
}
