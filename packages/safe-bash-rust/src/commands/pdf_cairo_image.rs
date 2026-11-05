// Cairo represents each surface pattern by a separate fixed-point inverse transform.
use super::{Image, Point};

pub(super) fn sampler(
    image: &Image,
    [a, b, c, d, e, f]: [f64; 6],
    center: Point,
) -> impl Fn(usize, usize) -> [u8; 4] + '_ {
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
            let x = (ey * xy - ex * (yy + j)) / den;
            let y = (ex * yx - ey * (xx + i)) / den;
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
    move |x, y| {
        let (u, v) = (u(x, y), v(x, y));
        let pixel = |x: f64, y: f64| {
            image.pixels[(y as usize).min(image.height - 1) * image.width
                + (x as usize).min(image.width - 1)]
        };
        if !linear {
            return pixel(u.ceil() - 1., v.ceil() - 1.);
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
        std::array::from_fn(|i| {
            let top = u32::from(tl[i]) * (128 - fx) + u32::from(tr[i]) * fx;
            let bottom = u32::from(bl[i]) * (128 - fx) + u32::from(br[i]) * fx;
            ((top * (128 - fy) + bottom * fy) >> 14) as u8
        })
    }
}
