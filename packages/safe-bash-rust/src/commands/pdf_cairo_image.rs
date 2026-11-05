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
            // Standalone stencils have transparent borders. Poppler fills the
            // rectangle directly for a one-pixel stencil.
            if image.stencil
                && (image.width != 1 || image.height != 1)
                && (x < 0. || x >= w || y < 0. || y >= h)
            {
                return [0; 4];
            }
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
