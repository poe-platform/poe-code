// PDF page coordinates are in points from the bottom left. Rasterize the paths
// at the horizontal resolution, then resample, rotate and crop the bitmap.
use super::pdf_text_layout::Draw;
use super::pdf_bitmap::{Image, ImageStream};
#[path = "pdf_glyph.rs"]
mod pdf_glyph;
use super::{PageSource, Value};
type Point = [f64; 2];
pub(in crate::commands::archive) struct RasterOptions<'a> {
    pub tiff: Option<(&'a str, bool)>,
    pub jpeg: Option<(u8, bool)>,
    pub splash: bool,
    pub format: &'a str,
    pub color: &'a str,
    pub transparent: bool,
    pub antialias: bool,
    pub text_aa: bool,
    pub dpi: [f64; 2],
    pub scale: [i64; 3],
    pub crop: [f64; 4],
    pub cropbox: bool,
    pub limit: usize,
}

fn crop(w: usize, h: usize, [x, y, cw, ch]: [f64; 4]) -> [usize; 4] {
    let x = (x.round() as usize).min(w - 1);
    let y = (y.round() as usize).min(h - 1);
    let span = |size: f64, max: usize| {
        if size > 0. {
            (size.round() as usize).clamp(1, max)
        } else {
            max
        }
    };
    [x, y, span(cw, w - x), span(ch, h - y)]
}
fn div255(n: u32) -> u32 {
    (n + (n >> 8) + 128) >> 8
}

fn over_white(p: &mut [u8; 4]) {
    let alpha = u32::from(p[3]);
    if alpha < 255 {
        for c in &mut p[..3] {
            *c = div255(alpha * u32::from(*c) + (255 - alpha) * 255) as u8;
        }
        p[3] = 255;
    }
}

// Splash samples each stream at its own resolution, including a soft mask.
fn splash_sampler<const N: usize>(
    im: &Image,
    [left, top, sw, sh]: [f64; 4],
    xs: std::ops::Range<usize>,
    ys: std::ops::Range<usize>,
) -> impl FnMut(usize, usize, &mut usize) -> Option<[u8; N]> + '_ {
    let (dx, dy) = (im.width as f64 / sw, im.height as f64 / sh);
    let smooth = !im.stencil && dx <= 1. && dy <= 1. && (im.interpolate || dx > 0.25 && dy > 0.25);
    let mix = |a: u8, b: u8, t: f64| (f64::from(a) * (1. - t) + f64::from(b) * t) as u8;
    // A reduced axis averages whole source samples; an enlarged axis repeats them.
    let span = |i: usize, src: usize, dst: usize| {
        let (i, src, dst) = (i as u64, src as u64, dst as u64);
        if src > dst {
            (i * src / dst) as usize..((i + 1) * src / dst) as usize
        } else {
            let end = ((i + 1) * src).div_ceil(dst) as usize;
            end - 1..end
        }
    };
    let mut v = (ys.start as f64 - top) * dy;
    let start_u = (xs.start as f64 - left) * dx;
    let mut u = start_u;
    move |x, y, work| {
        let value = if smooth {
            let x0 = (u as usize).min(im.width - 1);
            let y0 = (v as usize).min(im.height - 1);
            let row = |j: usize, k: usize| {
                let p = &im.pixels[j * im.width..][..im.width];
                mix(p[x0][k], p[(x0 + 1).min(im.width - 1)][k], u.fract())
            };
            std::array::from_fn(|k| mix(row(y0, k), row((y0 + 1).min(im.height - 1), k), v.fract()))
        } else {
            let cols = span((x as f64 - left) as usize, im.width, sw as usize);
            let rows = span((y as f64 - top) as usize, im.height, sh as usize);
            let count = cols.len().checked_mul(rows.len())?;
            *work = work.checked_sub(count)?;
            let mut sum = [0u64; N];
            for j in rows {
                for p in &im.pixels[j * im.width..][cols.clone()] {
                    if im.stencil {
                        sum[0] += u64::from(p[3] != 0);
                        continue;
                    }
                    for (total, &channel) in sum.iter_mut().zip(p) {
                        *total += u64::from(channel);
                    }
                }
            }
            let reciprocal = (if im.stencil { 255 } else { 1 } << 23) / count as u64;
            sum.map(|n| ((n * reciprocal) >> 23) as u8)
        };
        if x + 1 == xs.end {
            u = start_u;
            v += dy;
        } else {
            u += dx;
        }
        Some(value)
    }
}

fn splash_rgba<'a>(
    im: &'a Image,
    mask: Option<&'a Image>,
    bounds: [f64; 4],
    xs: std::ops::Range<usize>,
    ys: std::ops::Range<usize>,
) -> impl FnMut(usize, usize, &mut usize) -> Option<[u8; 4]> + 'a {
    let mut rgba = splash_sampler::<4>(im, bounds, xs.clone(), ys.clone());
    let mut alpha = mask.or(im.stencil.then_some(im)).map(|m| splash_sampler::<1>(m, bounds, xs, ys));
    move |x, y, work| {
        let mut pixel = if im.stencil { im.pixels[0] } else { rgba(x, y, work)? };
        if let Some(sample) = &mut alpha {
            pixel[3] = sample(x, y, work)?[0];
        } else if !im.has_alpha {
            pixel[3] = 255;
        }
        Some(pixel)
    }
}

fn composite_image_pixel(dest: &mut [u8; 4], value: [u8; 4]) {
    if value[3] == 255 {
        *dest = value;
    } else if value[3] != 0 {
        let (alpha, prior) = (u32::from(value[3]), u32::from(dest[3]));
        let total = alpha + prior - div255(alpha * prior);
        for k in 0..3 {
            dest[k] = (((total - alpha) * u32::from(dest[k]) + alpha * u32::from(value[k])) / total)
                as u8;
        }
        dest[3] = total as u8;
    }
}

// Horizontal subpixel spans of the intersected form bounding boxes, in device space.
type ClipRow = [(f64, f64); 4];
fn clip_coverage(row: &Option<ClipRow>, x: usize) -> u8 {
    let Some(spans) = row else {
        return 255;
    };
    let x = (x * 4) as f64;
    let count: f64 = spans
        .iter()
        .map(|&(a, b)| (b.min(x + 3.) - a.max(x) + 1.).max(0.))
        .sum();
    let coverage = count / 16.;
    (coverage * coverage.sqrt() * 255.).round() as u8
}

struct Bitmap {
    form_clips: Vec<[Point; 4]>,
    clip_antialias: bool,
    white_background: bool,
    w: usize,
    h: usize,
    pixels: Vec<[u8; 4]>,
    work: usize,
}
impl Bitmap {
    fn clip_row(&mut self, y: usize, span: Option<(f64, f64)>) -> Option<Option<ClipRow>> {
        if self.form_clips.is_empty() {
            return Some(None);
        }
        self.work = self.work.checked_sub(16 * self.form_clips.len())?;
        let samples = if self.clip_antialias { 4 } else { 1 };
        let scale = samples as f64;
        let mut spans = [(f64::NEG_INFINITY, f64::INFINITY); 4];
        let mut inside_span = span.is_some_and(|(lo, hi)| lo >= 0. && hi <= self.w as f64);
        for quad in &self.form_clips {
            let [a, b, c, d] = *quad;
            if (a[0] == b[0] && b[1] == c[1]) || (a[1] == b[1] && b[0] == c[0]) {
                // Splash clips rectangles to whole scanlines and quarter-pixel columns.
                let y = y as f64;
                let inside = y >= a[1].min(c[1]).floor() && y < a[1].max(c[1]).ceil();
                inside_span &= span.is_some_and(|(lo, hi)| {
                    lo >= a[0].min(c[0])
                        && hi <= a[0].max(c[0])
                        && y >= a[1].min(c[1])
                        && y + 1. <= a[1].max(c[1])
                });
                for (lo, hi) in &mut spans[..samples] {
                    *lo = lo.max((scale * a[0].min(c[0])).floor());
                    *hi = if inside {
                        hi.min(if self.clip_antialias {
                            (scale * a[0].max(c[0])).floor()
                        } else {
                            a[0].max(c[0]).ceil() - 1.
                        })
                    } else {
                        f64::NEG_INFINITY
                    };
                }
            } else {
                for (i, (lo, hi)) in spans[..samples].iter_mut().enumerate() {
                    let y0 = y as f64 + i as f64 / scale;
                    let y1 = y0 + 1. / scale;
                    let (mut left, mut right) = (f64::INFINITY, f64::NEG_INFINITY);
                    for (p, q) in [(a, b), (b, c), (c, d), (d, a)] {
                        if p[1].max(q[1]) < y0 || p[1].min(q[1]) >= y1 {
                            continue;
                        }
                        let slope = (q[0] - p[0]) / (q[1] - p[1]);
                        let base = p[0] - p[1] * slope;
                        let x = |v: f64| (base + v * slope).clamp(p[0].min(q[0]), p[0].max(q[0]));
                        let (u, v) = if p[1] == q[1] {
                            (p[0], q[0])
                        } else {
                            (x(y0), x(y1))
                        };
                        left = left.min(u.min(v));
                        right = right.max(u.max(v));
                    }
                    // Splash tests the first subscanline before antialiasing a transformed image span.
                    if i == 0 {
                        inside_span &= span.is_some_and(|(s, e)| {
                            scale * s >= (scale * left).floor()
                                && scale * e - 1. <= (scale * right).floor()
                        });
                    }
                    *lo = lo.max((scale * left).floor());
                    *hi = hi.min((scale * right).floor());
                }
            }
        }
        if samples == 1 {
            let (lo, hi) = spans[0];
            spans.fill((lo * 4., hi * 4. + 3.));
        }
        Some((!inside_span).then_some(spans))
    }

    fn transformed_image(
        &mut self,
        im: &Image,
        mask: Option<&Image>,
        [a, b, c, d, e, f]: [f64; 6],
        limit: usize,
    ) -> Option<()> {
        // Image coordinates start at the top left. First scale in image space,
        // then map device pixel centers back into that bitmap.
        let corners = [
            [e, f],
            [e + c, f + d],
            [a + c + e, b + d + f],
            [e + a, f + b],
        ];
        let extent = |k: usize| {
            let lo = corners
                .iter()
                .map(|p| p[k])
                .fold(f64::INFINITY, f64::min)
                .floor();
            let hi = corners
                .iter()
                .map(|p| p[k])
                .fold(f64::NEG_INFINITY, f64::max)
                .floor()
                + 1.;
            (lo, hi)
        };
        let ((left, right), (top, bottom)) = (extent(0), extent(1));
        if right <= 0. || left >= self.w as f64 || bottom < 0. || top >= self.h as f64 {
            return Some(());
        }
        let mut sw = right - left;
        let mut sh = bottom - top;
        if a.abs() < b.abs() {
            std::mem::swap(&mut sw, &mut sh);
        }
        if im.stencil || sw <= 1. || sh <= 1. {
            let span = |lo: f64, hi: f64| (hi.floor() - lo.floor()).abs() + 1.;
            sw = span(e, e + a).max(span(f, f + b));
            sh = span(e, e + c).max(span(f, f + d));
            if !im.stencil && b.abs() >= 1. {
                sh = sh.max(1. + c.signum() * (c.floor() - (a * d / b).floor()));
            }
            if !im.stencil && a.abs() >= 1. {
                sh = sh.max(1. + d.signum() * (d.floor() - (b * c / a).floor()));
            }
        }
        let (w, h) = (sw as usize, sh as usize);
        let count = w.checked_mul(h)?;
        if count == 0 || count > limit / 4 {
            return None;
        }
        self.work = self.work.checked_sub(count)?;
        let mut sample = splash_rgba(im, mask, [0., 0., sw, sh], 0..w, 0..h);
        let mut scaled = Vec::with_capacity(count);
        for y in 0..h {
            for x in 0..w {
                scaled.push(sample(x, y, &mut self.work)?);
            }
        }
        let (a, b, c, d) = (a / sw, b / sw, c / sh, d / sh);
        let det = a * d - b * c;
        if det.abs() < 1e-6 {
            return Some(());
        }
        let (xx, xy, yx, yy) = (d / det, -c / det, -b / det, a / det);
        let height = self.h;
        let mut row = |y: usize, xa: f64, xb: f64| -> Option<()> {
            let start = (xa.floor() as usize).min(self.w);
            let mut end = xb.floor() + 1.;
            if start as f64 == end {
                end += 1.;
            }
            let xs = start..(end as usize).min(self.w);
            self.work = self.work.checked_sub(xs.len())?;
            let clip = self.clip_row(y, Some((start as f64, end)))?;
            let py = y as f64 + 0.5 - f;
            for x in xs {
                let px = x as f64 + 0.5 - e;
                let u = ((px * xx + py * xy) as usize).min(w - 1);
                let v = ((px * yx + py * yy) as usize).min(h - 1);
                let mut value = scaled[v * w + u];
                value[3] = div255(u32::from(value[3]) * u32::from(clip_coverage(&clip, x))) as u8;
                composite_image_pixel(&mut self.pixels[y * self.w + x], value);
            }
            Some(())
        };
        let mut first = 0;
        for i in 1..4 {
            if corners[i][1] < corners[first][1] {
                first = i;
            }
        }
        let prev = (first + 3) % 4;
        if (corners[first][1] - corners[prev][1]).abs() <= 1e-6
            && corners[prev][1] < corners[(first + 1) % 4][1]
        {
            first = prev;
        }
        let [p, q, r, s] = std::array::from_fn(|i| corners[(first + i) % 4]);
        let edge = |p: Point, q: Point, y: f64| p[0] + (y - p[1]) * ((q[0] - p[0]) / (q[1] - p[1]));
        let flat = (p[1] - q[1]).abs() <= 1e-6;
        let end = if bottom - top == 1. {
            bottom + 1.
        } else {
            bottom
        };
        for y in (top as usize).min(height)..(end as usize).min(height) {
            let scan = y as f64 + 0.5;
            if flat {
                let x0 = edge(p, s, scan);
                let x1 = edge(q, r, scan);
                row(y, x0.min(x1), x0.max(x1))?;
            } else {
                // At each middle vertex the lower edge takes over on the rounded scanline.
                let qcut = q[1].floor() + if q[1] >= s[1] { end - bottom + 1. } else { 0. };
                let scut = s[1].floor() + if s[1] > q[1] { end - bottom + 1. } else { 0. };
                let xq = if (y as f64) < qcut {
                    edge(p, q, scan)
                } else {
                    edge(q, r, scan)
                };
                let xs = if (y as f64) < scut {
                    edge(p, s, scan)
                } else {
                    edge(s, r, scan)
                };
                if q[0] < s[0] {
                    row(y, xq, xs)?;
                } else {
                    row(y, xs, xq)?;
                }
            }
        }
        Some(())
    }

    fn image(
        &mut self,
        mut im: Image,
        mask: Option<Image>,
        ox: f64,
        top: f64,
        scale: f64,
        splash: bool,
        limit: usize,
    ) -> Option<()> {
        let [a, b, c, d, e, f] = im.matrix;
        let det = a * d - b * c;
        if det.abs() <= 1e-8 {
            return Some(());
        }
        // Splash scales an upright image across inclusive device bounds, then clips it.
        if splash && !(a > 0. && b == 0. && c == 0.) {
            return self.transformed_image(
                &im,
                mask.as_ref(),
                [
                    a * scale,
                    -b * scale,
                    -c * scale,
                    d * scale,
                    c * scale + (e * scale - ox * scale),
                    -d * scale + (top * scale - f * scale),
                ],
                limit,
            );
        }
        if splash {
            let left = ((e - ox) * scale).floor();
            let top_px = ((top - f - d.max(0.)) * scale).floor();
            let right = ((a + e - ox) * scale).floor() + 1.;
            let bottom = ((top - f - d.min(0.)) * scale).floor() + 1.;
            let (sw, sh) = (right - left, bottom - top_px);
            if !(1. ..=i32::MAX as f64).contains(&sw) || !(1. ..=i32::MAX as f64).contains(&sh) {
                return None;
            }
            let xs = (left as usize).min(self.w)..(right as usize).min(self.w);
            let ys = (top_px as usize).min(self.h)..(bottom as usize).min(self.h);
            self.work = self.work.checked_sub(xs.len().checked_mul(ys.len())?)?;
            if xs.is_empty() || ys.is_empty() {
                return Some(());
            }
            let (start_y, ys) = if d < 0. {
                (
                    0.,
                    (bottom - ys.end as f64) as usize..(bottom - ys.start as f64) as usize,
                )
            } else {
                (top_px, ys)
            };
            let bounds = [left, start_y, sw, sh];
            let mut sample = splash_rgba(&im, mask.as_ref(), bounds, xs.clone(), ys.clone());
            for y in ys {
                let dest_y = if d < 0. {
                    (bottom - 1. - y as f64) as usize
                } else {
                    y
                };
                let clip = self.clip_row(dest_y, None)?;
                for x in xs.clone() {
                    let mut value = sample(x, y, &mut self.work)?;
                    value[3] =
                        div255(u32::from(value[3]) * u32::from(clip_coverage(&clip, x))) as u8;
                    composite_image_pixel(&mut self.pixels[dest_y * self.w + x], value);
                }
            }
            return Some(());
        }
        let bounds = |values: [f64; 4], max: usize| {
            let lo = values.into_iter().fold(f64::INFINITY, f64::min).floor() as usize;
            let hi = values.into_iter().fold(f64::NEG_INFINITY, f64::max).ceil() as usize;
            lo.min(max)..hi.min(max)
        };
        let xs = bounds(
            [e, a + e, a + c + e, c + e].map(|x| (x - ox) * scale),
            self.w,
        );
        let ys = bounds(
            [f, b + f, b + d + f, d + f].map(|y| (top - y) * scale),
            self.h,
        );
        if xs.is_empty() || ys.is_empty() {
            return Some(());
        }
        self.work = self.work.checked_sub(xs.len().checked_mul(ys.len())?)?;
        let (mut w, mut h) = (im.width, im.height);
        let ax = a * scale / w as f64;
        let ay = b * scale / w as f64;
        let bx = c * scale / h as f64;
        let by = d * scale / h as f64;
        let (s1, s2) = (ax * ax + ay * ay, bx * bx + by * by);
        let smooth = ((s1 + s2 + (s1 - s2).hypot(2. * (ax * bx + ay * by))) / 2.) as f32 <= 1.;
        let mut wx = d.hypot(c) * w as f64 / (det * scale).abs();
        let mut hy = b.hypot(a) * h as f64 / (det * scale).abs();
        let linear = |pixels: &[[u8; 4]], w: usize, h: usize, x: f64, y: f64| {
            let (x, y) = (x.clamp(0., (w - 1) as f64), y.clamp(0., (h - 1) as f64));
            let mut sample = [0.; 4];
            for j in 0..2 {
                for i in 0..2 {
                    let p = pixels[(y as usize + j).min(h - 1) * w + (x as usize + i).min(w - 1)];
                    let alpha = f64::from(p[3])
                        * if i == 1 { x.fract() } else { 1. - x.fract() }
                        * if j == 1 { y.fract() } else { 1. - y.fract() };
                    for k in 0..3 {
                        sample[k] += f64::from(p[k]) * alpha;
                    }
                    sample[3] += alpha;
                }
            }
            if sample[3] > 0. {
                for k in 0..3 {
                    sample[k] /= sample[3];
                }
            }
            sample
        };
        while wx > 2. && w > 1 || hy > 2. && h > 1 {
            let nw = if wx > 2. { w.div_ceil(2) } else { w };
            let nh = if hy > 2. { h.div_ceil(2) } else { h };
            self.work = self.work.checked_sub(nw * nh)?;
            let mut level = Vec::with_capacity(nw * nh);
            for y in 0..nh {
                for x in 0..nw {
                    level.push(
                        linear(
                            &im.pixels,
                            w,
                            h,
                            (x as f64 + 0.5) * w as f64 / nw as f64 - 0.5,
                            (y as f64 + 0.5) * h as f64 / nh as f64 - 0.5,
                        )
                        .map(|v| v.round() as u8),
                    );
                }
            }
            wx /= w as f64 / nw as f64;
            hy /= h as f64 / nh as f64;
            w = nw;
            h = nh;
            im.pixels = level;
        }
        for y in ys {
            let clip = self.clip_row(y, None)?;
            for x in xs.clone() {
                let dy = top - (y as f64 + 0.5) / scale - f;
                let dx = ox + (x as f64 + 0.5) / scale - e;
                let (u, v) = ((d * dx - c * dy) / det, (-b * dx + a * dy) / det);
                if !(0. ..=1.).contains(&u) || !(0. ..=1.).contains(&v) {
                    continue;
                }
                let (u, v) = (u * w as f64, (1. - v) * h as f64);
                let s = if smooth {
                    linear(&im.pixels, w, h, u - 0.5, v - 0.5)
                } else {
                    im.pixels[(v as usize).min(h - 1) * w + (u as usize).min(w - 1)].map(f64::from)
                };
                let dest = &mut self.pixels[y * self.w + x];
                let alpha = s[3] / 255. * (f64::from(clip_coverage(&clip,x)) / 255.);
                if alpha == 0. {
                    continue;
                }
                let remain = f64::from(dest[3]) / 255. * (1. - alpha);
                let total = alpha + remain;
                for k in 0..3 {
                    dest[k] = ((s[k] / 255. * alpha + f64::from(dest[k]) / 255. * remain) / total
                        * 255.)
                        .round() as u8;
                }
                dest[3] = (total * 255.).round() as u8;
            }
        }
        Some(())
    }

    fn paint(&mut self, paths: &[Vec<Point>], color: [f64; 3], even: bool, aa: bool) -> Option<()> {
        let mut lo = [self.w as f64, self.h as f64];
        let mut hi = [0f64; 2];
        let mut edges = vec![];
        for path in paths {
            for (&a, &b) in path.iter().zip(path.iter().cycle().skip(1)) {
                if a[1] == b[1] {
                    continue;
                }
                for i in 0..2 {
                    lo[i] = lo[i].min(a[i]).min(b[i]);
                    hi[i] = hi[i].max(a[i]).max(b[i]);
                }
                edges.push((a, b));
            }
        }
        let (x0, y0) = (lo[0].floor() as usize, lo[1].floor() as usize);
        let x1 = self.w.min(hi[0].ceil() as usize);
        let y1 = self.h.min(hi[1].ceil() as usize);
        if x1 <= x0 || y1 <= y0 {
            return Some(());
        }
        self.work = self
            .work
            .checked_sub((y1 - y0).checked_mul((x1 - x0).checked_add(edges.len())?)?)?;
        let inside = |v: i32| if even { v % 2 != 0 } else { v != 0 };
        let mut counts = vec![0u8; x1 - x0];
        let mut crossings = Vec::with_capacity(edges.len());
        for y in y0..y1 {
            counts.fill(0);
            for row in 0..4 {
                crossings.clear();
                let sy = y as f64 + (row as f64 + 0.5) / 4.;
                for &(a, b) in &edges {
                    if (a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy) {
                        let x = a[0] + (sy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
                        crossings.push((x, if even || a[1] < b[1] { 1 } else { -1 }));
                    }
                }
                crossings.sort_by(|a, b| a.0.total_cmp(&b.0));
                let mut it = crossings.iter().peekable();
                let mut winding = 0;
                for (col, count) in counts.iter_mut().enumerate() {
                    for sub in 0..4 {
                        let sx = (x0 + col) as f64 + (sub as f64 + 0.5) / 4.;
                        while it.peek().is_some_and(|(x, _)| *x < sx) {
                            winding += it.next()?.1;
                        }
                        if inside(winding) || it.peek().is_some_and(|(x, _)| *x == sx) {
                            *count += 1;
                        }
                    }
                }
            }
            let clip = self.clip_row(y, None)?;
            for (x, &count) in counts.iter().enumerate() {
                let a = if aa {
                    f64::from(count) / 16.
                } else {
                    f64::from(u8::from(count >= 8))
                } * (f64::from(clip_coverage(&clip,x0+x)) / 255.);
                if a == 0. {
                    continue;
                }
                let px = &mut self.pixels[y * self.w + x0 + x];
                if self.white_background { over_white(px); }
                let remain = f64::from(px[3]) / 255. * (1. - a);
                let out = a + remain;
                for i in 0..3 {
                    px[i] = (((color[i].clamp(0., 1.) * a + f64::from(px[i]) / 255. * remain)
                        / out)
                        * 255.)
                        .round() as u8;
                }
                px[3] = (out * 255.).round() as u8;
            }
        }
        Some(())
    }
}
pub(super) fn encode(w: usize, h: usize, pixels: &[[u8; 4]], format: &str, mode: &str, dpi: Option<[f64; 2]>) -> Option<Vec<u8>> {
    let bilevel = format == "PNG1";
    let png = matches!(format,"PNG"|"RGBA"|"PNG1"|"PNG8");
    let rgb = format=="PNG" && pixels.iter().all(|p| p[3] == 255);
    let mut raw = match format {
        "PNG" | "RGBA" | "PNG1" | "PNG8" => vec![],
        "PBM" => format!("P4\n{w} {h}\n").into_bytes(),
        "PGM" => format!("P5\n{w} {h}\n255\n").into_bytes(),
        "PPM" => format!("P6\n{w} {h}\n255\n").into_bytes(),
        _ => return None,
    };
    for row in pixels.chunks_exact(w) {
        if png {
            raw.push(0);
        }
        let mut packed = 0;
        for (i, p) in row.iter().enumerate() {
            let lum = 0.299 * f64::from(p[0]) + 0.587 * f64::from(p[1]) + 0.114 * f64::from(p[2]);
            match format {
                "PBM" | "PNG1" => {
                    if (lum < 128.) != bilevel {
                        packed |= 128 >> (i % 8);
                    }
                    if i % 8 == 7 || i + 1 == w {
                        raw.push(packed);
                        packed = 0;
                    }
                }
                "PNG8" => raw.push(p[0]),
                "PGM" => raw.push(lum.round() as u8),
                _ => {
                    if png && mode != "rgb" {
                        let mut v = lum.round() as u8;
                        if mode == "mono" {
                            v = if v < 128 { 0 } else { 255 };
                        }
                        raw.extend_from_slice(&[v; 3]);
                    } else {
                        raw.extend_from_slice(&p[..3]);
                    }
                    if png && !rgb {
                        raw.push(p[3]);
                    }
                }
            }
        }
    }
    if !png {
        return Some(raw);
    }
    Some(encode_png(w, h, if bilevel { 1 } else { 8 },
        if bilevel || format == "PNG8" { 0 } else if rgb { 2 } else { 6 }, dpi, &raw))
}

pub(super) fn encode_png(w: usize, h: usize, depth: u8, color: u8, dpi: Option<[f64; 2]>, raw: &[u8]) -> Vec<u8> {
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = [0; 13];
    ihdr[..4].copy_from_slice(&(w as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(h as u32).to_be_bytes());
    ihdr[8] = depth;
    ihdr[9] = color;
    let phys = dpi.map(|[x,y]| {
        let mut field = [0u8; 9];
        field[..4].copy_from_slice(&((x / 0.0254) as u32).to_be_bytes());
        field[4..8].copy_from_slice(&((y / 0.0254) as u32).to_be_bytes());
        field[8] = 1;
        field
    });
    let compressed = crate::commands::codecs::zlib_compress(raw);
    for (tag, data) in [(b"IHDR", ihdr.as_slice())].into_iter()
        .chain(phys.as_ref().map(|bytes| (b"pHYs", bytes.as_slice())))
        .chain([(b"IDAT", compressed.as_slice()), (b"IEND", &[][..])]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(tag);
        out.extend_from_slice(data);
        out.extend_from_slice(&crate::commands::archive::crc32_ieee(&out[start..]).to_be_bytes());
    }
    out
}

impl PageSource<'_> {
    pub(in crate::commands::archive) fn raster(
        &mut self,
        pno: usize,
        opt: &RasterOptions<'_>,
    ) -> Option<Vec<u8>> {
        let page = self
            .objects
            .page_dict(*self.pages.get(pno.checked_sub(1)?)?, &self.tree)?;
        let mut media = None;
        let mut cropbox = None;
        let mut rot = None;
        let mut node = &page;
        for _ in 0..128 {
            for (key, target) in [
                (b"MediaBox".as_slice(), &mut media),
                (b"CropBox", &mut cropbox),
            ] {
                if target.is_none() {
                    *target = node
                        .get(key)
                        .and_then(|v| self.objects.resolve(v))
                        .and_then(|v| v.rectangle());
                }
            }
            if rot.is_none() {
                rot = node
                    .get(b"Rotate")
                    .and_then(|v| self.objects.resolve(v))
                    .and_then(|v| v.number());
            }
            let Some(parent) = node
                .get(b"Parent")
                .and_then(Value::reference)
                .and_then(|p| self.tree.get(&p))
                .and_then(Option::as_ref)
            else {
                break;
            };
            node = parent;
        }
        let [x0, y0, x1, y1] = media.unwrap_or([0., 0., 612., 792.]);
        let (pw, ph) = ((x1 - x0).abs(), (y1 - y0).abs());
        let (ox, oy) = (x0.min(x1), y0.min(y1));
        let rot = (rot.unwrap_or(0.) as i32).rem_euclid(360);
        let quarter = matches!(rot, 90 | 270);
        let [cx, cy, dx, dy] = if opt.cropbox {
            cropbox.unwrap_or([ox, oy, ox + pw, oy + ph])
        } else {
            [ox, oy, ox + pw, oy + ph]
        };
        let mut boxpt = [
            (dx.max(cx) - ox).clamp(0., pw) - (cx.min(dx) - ox).clamp(0., pw),
            (dy.max(cy) - oy).clamp(0., ph) - (cy.min(dy) - oy).clamp(0., ph),
        ];
        if quarter {
            boxpt.swap(0, 1);
        }
        let [mut sx, mut sy] = opt.dpi.map(|n| n / 72.);
        let [max, tx, ty] = opt.scale;
        if max > 0 {
            sx = max as f64 / boxpt[0].max(boxpt[1]).max(1.);
            sy = sx;
        } else {
            if tx > 0 {
                sx = tx as f64 / boxpt[0].max(1.);
                if ty < 0 {
                    sy = sx;
                }
            }
            if ty > 0 {
                sy = ty as f64 / boxpt[1].max(1.);
                if tx < 0 {
                    sx = sy;
                }
            }
        }
        let w = (pw * sx).ceil().max(1.) as usize;
        let h = (ph * sx).ceil().max(1.) as usize;
        let resample = (sx - sy).abs() > 1e-6;
        let target_h = if resample {
            (ph * sy).ceil().max(1.) as usize
        } else {
            h
        };
        if w.checked_mul(h.max(target_h))? > opt.limit / 4 {
            return None;
        }
        let mut bitmap = Bitmap {
            form_clips: vec![],
            clip_antialias: opt.antialias,
            white_background: !opt.transparent,
            w,
            h,
            pixels: vec![if opt.transparent || opt.splash { [0; 4] } else { [255; 4] }; w * h],
            work: opt.limit.saturating_mul(4),
        };
        let mut faces = std::collections::BTreeMap::new();
        let mut fill = [0.; 3];
        let mut stroke = [0.; 3];
        let mut width = 1.;
        let mut paths: Vec<Vec<Point>> = vec![];
        let mut stack = vec![];
        let mut forms = vec![];
        self.draw_page(&page, |event, objects| {
            let (op, args, ctm) = match event {
                Draw::BeginForm([x0, y0, x1, y1], [a, b, c, d, e, f]) => {
                    let pt = |x, y| {
                        [
                            (a * x + c * y + e - ox) * sx,
                            (oy + ph - (b * x + d * y + f)) * sx,
                        ]
                    };
                    bitmap
                        .form_clips
                        .push([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]);
                    forms.push((
                        fill,
                        stroke,
                        width,
                        std::mem::take(&mut paths),
                        std::mem::take(&mut stack),
                    ));
                    return Some(());
                }
                Draw::EndForm => {
                    (fill, stroke, width, paths, stack) = forms.pop()?;
                    bitmap.form_clips.pop()?;
                    return Some(());
                }
                Draw::Image(stream, matrix) => {
                    let mode = if opt.splash { super::ImageRead::Raster } else { super::ImageRead::Pixels };
                    if let Some(mut image) = Image::read(objects, stream, matrix, opt.limit, mode)? {
                        if image.stencil {
                            // Convert PDF 16.16 color components to device bytes.
                            let [r, g, b] = fill.map(|c: f64| ((((c.clamp(0., 1.) * 65536.) as u32) * 255 + 32768) >> 16) as u8);
                            for p in &mut image.pixels {
                                *p = [r, g, b, 255 - p[0]];
                            }
                        }
                        let mask = match (opt.splash, image.mask) {
                            (true, Some(id)) => {
                                let mut mask = Image::read(objects, ImageStream::Object(id), matrix, opt.limit, mode)??;
                                if mask.components != 1 { return None; }
                                if mask.stencil && mask.width <= image.width && mask.height <= image.height {
                                    // Splash expands the one-bit mask over the inclusive image bounds,
                                    // then resamples those alpha values together with the image.
                                    let coord = |i: usize, src: usize, dst: usize| ((((i as u64 + 1) * src as u64) - 1) / (dst as u64 + 1)) as usize;
                                    for (y, row) in image.pixels.chunks_exact_mut(image.width).enumerate() {
                                        let offset = coord(y, mask.height, image.height) * mask.width;
                                        for (x, p) in row.iter_mut().enumerate() {
                                            p[3] = 255 - mask.pixels[offset + coord(x, mask.width, image.width)][0];
                                        }
                                    }
                                    image.has_alpha = true;
                                    None
                                } else {
                                    if mask.stencil {
                                        mask.stencil = false;
                                        for p in &mut mask.pixels { p[0] = 255 - p[0]; }
                                    }
                                    Some(mask)
                                }
                            }
                            _ => None,
                        };
                        bitmap.image(image, mask, ox, oy + ph, sx, opt.splash, opt.limit)?;
                    }
                    return Some(());
                }
                Draw::Operator(op, args, ctm) => (op, args, ctm),
                Draw::Glyph {
                    byte,
                    family,
                    matrix,
                    mode,
                    ..
                } => {
                    if matches!(mode, 0 | 2 | 4 | 6) {
                        let outline = pdf_glyph::outline(
                            &mut faces,
                            family,
                            byte,
                            &mut bitmap.work,
                            |x, y| {
                                [
                                    (x * matrix[0] + y * matrix[2] + matrix[4] - ox) * sx,
                                    (ph - (x * matrix[1] + y * matrix[3] + matrix[5] - oy)) * sx,
                                ]
                            },
                        )?;
                        bitmap.paint(&outline, fill, false, opt.text_aa)?;
                    }
                    return Some(());
                }
            };
            let n = |i: usize| args.get(i)?.number();
            let pt = |x: f64, y: f64| {
                [
                    (x * ctm[0] + y * ctm[2] + ctm[4] - ox) * sx,
                    (ph - (x * ctm[1] + y * ctm[3] + ctm[5] - oy)) * sx,
                ]
            };
            match op {
                b"q" => {
                    if stack.len() >= 256 {
                        return None;
                    }
                    stack.push((fill, stroke, width));
                }
                b"Q" => {
                    if let Some(state) = stack.pop() {
                        (fill, stroke, width) = state;
                    }
                }
                b"rg" | b"RG" | b"g" | b"G" => {
                    let c = if op.len() == 2 {
                        [n(0)?, n(1)?, n(2)?]
                    } else {
                        [n(0)?; 3]
                    };
                    if op[0].is_ascii_lowercase() {
                        fill = c;
                    } else {
                        stroke = c;
                    }
                }
                b"w" => width = n(0)?,
                b"re" => {
                    let (x, y, w, h) = (n(0)?, n(1)?, n(2)?, n(3)?);
                    paths.push(vec![
                        pt(x, y),
                        pt(x + w, y),
                        pt(x + w, y + h),
                        pt(x, y + h),
                        pt(x, y),
                    ]);
                }
                b"m" => paths.push(vec![pt(n(0)?, n(1)?)]),
                b"l" => paths.last_mut()?.push(pt(n(0)?, n(1)?)),
                b"c" | b"v" | b"y" => {
                    let path = paths.last_mut()?;
                    let start = *path.last()?;
                    let (a, b, end) = match op {
                        b"c" => (pt(n(0)?, n(1)?), pt(n(2)?, n(3)?), pt(n(4)?, n(5)?)),
                        b"v" => (start, pt(n(0)?, n(1)?), pt(n(2)?, n(3)?)),
                        _ => (pt(n(0)?, n(1)?), pt(n(2)?, n(3)?), pt(n(2)?, n(3)?)),
                    };
                    pdf_glyph::cubic(path, start, a, b, end, &mut bitmap.work)?;
                }
                b"h" => {
                    if let Some(path) = paths.last_mut() {
                        path.push(*path.first()?);
                    }
                }
                b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*" | b"S" | b"s" => {
                    if op != b"S" && op != b"s" {
                        bitmap.paint(&paths, fill, op.ends_with(b"*"), opt.antialias)?;
                    }
                    if !matches!(op, b"f" | b"F" | b"f*") {
                        let half = width * sx * ctm[0].hypot(ctm[1]) / 2.;
                        let mut outlines = vec![];
                        for path in &paths {
                            for seg in path.windows(2) {
                                let [a, b] = [seg[0], seg[1]];
                                let (x, y) = (b[0] - a[0], b[1] - a[1]);
                                let len = x.hypot(y);
                                if len == 0. {
                                    continue;
                                }
                                let (nx, ny) = (-y / len * half, x / len * half);
                                outlines.push(vec![
                                    [a[0] + nx, a[1] + ny],
                                    [b[0] + nx, b[1] + ny],
                                    [b[0] - nx, b[1] - ny],
                                    [a[0] - nx, a[1] - ny],
                                ]);
                            }
                        }
                        bitmap.paint(&outlines, stroke, false, opt.antialias)?;
                    }
                    paths.clear();
                }
                b"n" => paths.clear(),
                _ => {}
            }
            Some(())
        })?;
        let [bx, by, bw, bh] = crop(
            w,
            target_h,
            [
                (cx.min(dx) - ox) * sx,
                (ph - (dy.max(cy) - oy)) * sy,
                ((dx - cx).abs() * sx).ceil(),
                ((dy - cy).abs() * sy).ceil(),
            ],
        );
        let (rw, rh) = if quarter { (bh, bw) } else { (bw, bh) };
        let [left, top, ow, oh] = crop(rw, rh, opt.crop);
        let mut pixels = Vec::with_capacity(ow * oh);
        for y in top..top + oh {
            for x in left..left + ow {
                let (ix, iy) = match rot {
                    90 => (y, bh - 1 - x),
                    180 => (bw - 1 - x, bh - 1 - y),
                    270 => (bw - 1 - y, x),
                    _ => (x, y),
                };
                let src_y = if resample {
                    ((by + iy) as f64 / target_h as f64 * h as f64).floor() as usize
                } else {
                    by + iy
                };
                let mut p = bitmap.pixels[src_y.min(h - 1) * w + bx + ix];
                if bitmap.white_background { over_white(&mut p); }
                pixels.push(p);
            }
        }
        if let Some((compression, dither)) = opt.tiff {
            return crate::commands::archive::tiff::encode(&pixels, ow, [sx * 72., sy * 72.], if opt.transparent { "rgba" } else { opt.color }, compression, dither, opt.limit);
        }
        if let Some((quality, gray)) = opt.jpeg {
            use crate::commands::archive::jpeg;
            if opt.color != "rgb" {
                for p in &mut pixels {
                    let lum = (0.299 * f64::from(p[0]) + 0.587 * f64::from(p[1]) + 0.114 * f64::from(p[2])).round() as u8;
                    p[..3].fill(if opt.color == "mono" { if lum < 128 { 0 } else { 255 } } else { lum });
                }
            }
            return jpeg::encode(jpeg::Input::Page {
                width: ow, height: oh, pixels: &pixels, quality,
                dpi: [(sx * 72.) as u16, (sy * 72.) as u16], gray,
            }, opt.limit).ok();
        }
        encode(ow, oh, &pixels, opt.format, opt.color, (opt.format == "PNG").then_some([sx * 72., sy * 72.]))
    }
}
