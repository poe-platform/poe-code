// Map PDF page coordinates (points from the bottom left) into output pixels before rasterizing.
use super::pdf_text_layout::Draw;
use super::pdf_bitmap::{Image, ImageStream};
#[path = "pdf_cairo_image.rs"]
mod pdf_cairo_image;
#[path = "pdf_cairo_path.rs"]
mod pdf_cairo_path;
#[path = "pdf_glyph.rs"]
mod pdf_glyph;
use super::{PageSource, Value};
type Point = [f64; 2];
#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands::archive) enum RasterBackend {
    Splash,
    Cairo,
    Svg,
}

pub(in crate::commands::archive) struct RasterOptions<'a> {
    pub tiff: Option<(&'a str, bool)>,
    pub jpeg: Option<(u8, bool)>,
    pub backend: RasterBackend,
    pub format: &'a str,
    pub color: &'a str,
    pub transparent: bool,
    pub antialias: bool,
    pub text_aa: bool,
    pub dpi: [f64; 2],
    pub scale: [i64; 3],
    pub scale_before_rotation: bool,
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

fn mul255(a: u32, b: u32) -> u32 {
    let n = a * b + 128;
    (n + (n >> 8)) >> 8
}

// The span compositor rounds solid fills with 127; Pixman uses 128 for
// surface patterns. The mask scales premultiplied source channels.
fn cairo_over(dest: &mut [u8; 4], src: &[u8], mask: u32, alpha: u32, bias: u32) {
    let scale = |a: u32, b: u32| {
        let t = a * b + bias;
        (t + (t >> 8)) >> 8
    };
    let old = u32::from(dest[3]);
    let out = alpha + scale(old, 255 - alpha);
    for k in 0..3 {
        let c = scale(src[k].into(), mask) + scale(mul255(dest[k].into(), old), 255 - alpha);
        dest[k] = ((c * 255 + out / 2) / out).min(255) as u8;
    }
    dest[3] = out as u8;
}

fn over_white(p: &mut [u8; 4], backend: RasterBackend) {
    let alpha = u32::from(p[3]);
    if alpha < 255 {
        for c in &mut p[..3] {
            *c = if backend == RasterBackend::Cairo {
                (mul255(alpha, u32::from(*c)) + 255 - alpha) as u8
            } else {
                div255(alpha * u32::from(*c) + (255 - alpha) * 255) as u8
            };
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

// Poppler stores device color operands in 16.16. Its lexer accumulates the
// fractional digits in order, which matters on exact fixed-point boundaries.
fn cairo_component(value: &Value<'_>) -> Option<f64> {
    let c = value.poppler_number()?.clamp(0., 1.);
    let fixed = (c * 65536.) as u32;
    // Cairo takes the high byte of its rounded 16-bit solid color.
    Some(f64::from((fixed * 65535 + 32768) >> 24) / 255.)
}

struct Bitmap {
    page_clip: Point,
    backend: RasterBackend,
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
        opacity: f64,
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
                value[3] = (f64::from(value[3]) * opacity).round() as u8;
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
        matrix: [f64; 6],
        limit: usize,
        opacity: f64,
    ) -> Option<()> {
        let [a, b, c, d, e, f] = matrix;
        let det = a * d - b * c;
        if det.abs() <= 1e-8 {
            return Some(());
        }
        // Splash scales an upright image across inclusive device bounds, then clips it.
        if self.backend == RasterBackend::Splash && !(a > 0. && b == 0. && c == 0.) {
            return self.transformed_image(&im, mask.as_ref(), matrix, limit, opacity);
        }
        if self.backend == RasterBackend::Splash {
            let left = e.floor();
            let top_px = (f + d.min(0.)).floor();
            let right = (a + e).floor() + 1.;
            let bottom = (f + d.max(0.)).floor() + 1.;
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
                    value[3] = (f64::from(value[3]) * opacity).round() as u8;
                    composite_image_pixel(&mut self.pixels[dest_y * self.w + x], value);
                }
            }
            return Some(());
        }
        let [p, q, r, s] = pdf_cairo_path::image_corners(matrix);
        let rectangle = (p[0] == q[0] && p[1] == s[1]) || (p[1] == q[1] && p[0] == s[0]);
        let aa = self.clip_antialias;
        let bounds = |values: [f64; 4], axis: usize, max: usize| {
            if !aa && rectangle {
                // Cairo snaps boxes to pixels before anchoring its image filters.
                let pixel = |fixed: f64| (((fixed + 127.) / 256.).floor() as usize).min(max);
                return pixel(p[axis].min(r[axis]))..pixel(p[axis].max(r[axis]).min(self.page_clip[axis]));
            }
            let lo = values.into_iter().fold(f64::INFINITY, f64::min).floor() as usize;
            let hi = values.into_iter().fold(f64::NEG_INFINITY, f64::max).ceil() as usize;
            lo.min(max)..hi.min(max)
        };
        let xs = bounds([e, a + e, a + c + e, c + e], 0, self.w);
        let ys = bounds([f, b + f, b + d + f, d + f], 1, self.h);
        if xs.is_empty() || ys.is_empty() {
            return Some(());
        }
        self.work = self.work.checked_sub(xs.len().checked_mul(ys.len())?)?;
        // Cairo filters premultiplied channels. A PDF color key gives binary
        // opacity; transparent source samples contribute no color.
        if im.has_alpha {
            for p in &mut im.pixels {
                if p[3] == 0 {
                    *p = [0; 4];
                }
            }
        }
        let center = [
            (xs.start + xs.end) as f64 / 2.,
            (ys.start + ys.end) as f64 / 2.,
        ];
        let mut edges = if rectangle { Vec::new() } else {
            pdf_cairo_path::clipped_edges(&[(p, q), (q, r), (r, s), (s, p)], self.page_clip)
        };
        let mut areas = if rectangle || !aa { Vec::new() } else { vec![0.; xs.len()] };
        let image = pdf_cairo_image::sampler(&im, matrix, center);
        let mask = mask
            .as_ref()
            .map(|m| pdf_cairo_image::sampler(m, matrix, center));
        for y in ys {
            let box_row = (rectangle && aa).then(|| pdf_cairo_path::Coverage::rectangle(p, r, y, self.page_clip));
            let mut pixels = xs.clone();
            if !aa && !rectangle {
                // A transformed image is convex: each row has at most one covered span.
                pixels.end = pixels.start;
                pdf_cairo_path::mono_row(&edges, y, false, &mut self.work, |start, end| {
                    pixels = start.max(xs.start)..end.min(xs.end);
                })?;
            } else if !rectangle {
                pdf_cairo_path::path_row(&mut edges, y, xs.start, &mut areas, false, &mut self.work)?;
            }
            let clip = self.clip_row(y, None)?;
            for x in pixels {
                let coverage = if !aa { 255 } else if let Some(row) = &box_row { row.alpha(x) }
                    else { pdf_cairo_path::area_alpha(areas[x - xs.start]) };
                let mut opacity = mul255(mul255(coverage.into(), clip_coverage(&clip, x).into()), (opacity * 255.).round() as u32);
                if opacity == 0 {
                    continue;
                }
                if let Some(mask) = &mask {
                    opacity = mul255(mask(x, y, &mut self.work)?[0].into(), opacity);
                    if opacity == 0 {
                        continue;
                    }
                }
                let src = image(x, y, &mut self.work)?;
                let alpha = mul255(src[3].into(), opacity);
                if alpha == 0 {
                    continue;
                }
                let (color, mask) = if im.stencil { (&im.pixels[0], alpha) } else { (&src, opacity) };
                cairo_over(&mut self.pixels[y * self.w + x], color, mask, alpha, 128);
            }
        }
        Some(())
    }

    fn paint(&mut self, paths: &[Vec<Point>], color: [f64; 3], opacity: f64, even: bool, aa: bool, boxes: bool) -> Option<()> {
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
        if self.backend == RasterBackend::Cairo {
            let fixed = |p: Point| p.map(|v| (v * 256.).round_ties_even());
            for (p, q) in &mut edges {
                *p = fixed(*p);
                *q = fixed(*q);
            }
            // Horizontal segments have already been dropped. A rectangle leaves
            // two opposing vertical edges with matching endpoints.
            let rect = match &edges[..] {
                [(a, b), (c, d)] if boxes && a[0] == b[0] && c[0] == d[0] && a[1] == d[1] && b[1] == c[1] => Some((*a, *c)),
                _ => None,
            };
            let mut clipped = if !aa || rect.is_none() { pdf_cairo_path::clipped_edges(&edges, self.page_clip) } else { Vec::new() };
            let solid = color.map(|c| (c * 255.).round() as u8);
            let mut areas = vec![0.; x1 - x0];
            for y in y0..y1 {
                let clip = self.clip_row(y, None)?;
                let mut draw = |x, coverage: u8| {
                    let alpha = mul255(mul255(coverage.into(), clip_coverage(&clip, x).into()), (opacity * 255.).round() as u32);
                    if alpha > 0 {
                        cairo_over(&mut self.pixels[y * self.w + x], &solid, alpha, alpha, 127);
                    }
                };
                if !aa {
                    pdf_cairo_path::mono_row(&clipped, y, even, &mut self.work, |start, end| {
                        for x in start.max(x0)..end.min(x1) { draw(x, 255); }
                    })?;
                    continue;
                }
                let box_row = rect.map(|(a, c)| pdf_cairo_path::Coverage::rectangle(a, c, y, self.page_clip));
                if box_row.is_none() {
                    pdf_cairo_path::path_row(
                        &mut clipped,
                        y,
                        x0,
                        &mut areas,
                        even,
                        &mut self.work,
                    )?;
                }
                for (i, &area) in areas.iter().enumerate() {
                    let x = x0 + i;
                    let coverage = box_row
                        .as_ref()
                        .map_or_else(|| pdf_cairo_path::area_alpha(area), |r| r.alpha(x));
                    draw(x, coverage);
                }
            }
            return Some(());
        }
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
                } * (f64::from(clip_coverage(&clip,x0+x)) / 255.) * opacity;
                if a == 0. {
                    continue;
                }
                let px = &mut self.pixels[y * self.w + x0 + x];
                if self.white_background && self.backend != RasterBackend::Cairo { over_white(px, self.backend); }
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
                        .and_then(|v| v.rectangle(Value::poppler_number));
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
        let (x0, x1) = (cx.min(dx).clamp(ox, ox + pw), cx.max(dx).clamp(ox, ox + pw));
        let (y0, y1) = (cy.min(dy).clamp(oy, oy + ph), cy.max(dy).clamp(oy, oy + ph));
        let mut boxpt = [x1 - x0, y1 - y0];
        // pdftoppm sizes the unrotated page, then swaps the slice dimensions.
        // pdftocairo sizes the rotated page. Both use output-axis DPI when drawing.
        let splash = opt.backend == RasterBackend::Splash;
        let rotate_slice = quarter && splash && !opt.scale_before_rotation;
        if quarter && !rotate_slice { boxpt.swap(0, 1); }
        let [max, tx, ty] = opt.scale;
        let mut dpi = opt.dpi;
        let mut target = [tx, ty];
        if max > 0 {
            let long = usize::from(boxpt[1] >= boxpt[0]);
            if boxpt[long] == 0. { return None; }
            dpi = [72. * max as f64 / boxpt[long]; 2];
            target = [0; 2];
            target[long] = max;
        } else {
            for i in 0..2 {
                if target[i] > 0 {
                    if boxpt[i] == 0. { return None; }
                    dpi[i] = 72. * target[i] as f64 / boxpt[i];
                    if target[1 - i] < 0 { dpi[1 - i] = dpi[i]; }
                }
            }
        }
        let [sx, sy] = dpi.map(|n| n / 72.);
        let mut size = [0, 1].map(|i| {
            // Splash uses explicit targets verbatim, while Cairo rounds the scaled page.
            let pixels = if splash && target[i] > 0 { target[i] as f64 }
                else if splash && max > 0 { boxpt[i] * (dpi[i] / 72.) }
                else { boxpt[i] * dpi[i] / 72. };
            pixels.ceil().max(1.) as usize
        });
        if rotate_slice { size.swap(0, 1); }
        let [left, top, w, h] = crop(size[0], size[1], opt.crop);
        if w.checked_mul(h)? > opt.limit / 4 { return None; }
        let axis = |x: f64, y: f64| {
            let [u, v] = match rot {
                90 => [y, x],
                180 => [-x, y],
                270 => [-y, -x],
                _ => [x, -y],
            };
            [u * sx, v * sy]
        };
        let (ox, oy) = match rot {
            90 => (x0, y0),
            180 => (x1, y0),
            270 => (x1, y1),
            _ => (x0, y1),
        };
        // The page matrix translates in device space after scaling.
        let [u0, v0] = axis(-ox, -oy);
        let (tx, ty) = (u0 - left as f64, v0 - top as f64);
        let point = |x, y| {
            let [u, v] = axis(x, y);
            [u + tx, v + ty]
        };
        let page_clip = if opt.backend == RasterBackend::Cairo
            && (opt.cropbox || cropbox.is_none_or(|b| b == [x0, y0, x1, y1])) {
            [(boxpt[0] * sx - left as f64).min(w as f64), (boxpt[1] * sy - top as f64).min(h as f64)]
        } else { [w as f64, h as f64] };
        let mut bitmap = Bitmap {
            page_clip: page_clip.map(|v| (v * 256.).round_ties_even()),
            backend: opt.backend,
            form_clips: vec![],
            clip_antialias: opt.antialias,
            white_background: !opt.transparent,
            w,
            h,
            // pdftocairo composites the completed ARGB surface over white at export.
            pixels: vec![if opt.backend == RasterBackend::Svg { [255; 4] } else { [0; 4] }; w * h],
            work: opt.limit.saturating_mul(4),
        };
        let mut faces = std::collections::BTreeMap::new();
        let mut fill = [0.; 3];
        let mut stroke = [0.; 3];
        let mut width = 1.;
        let (mut fill_alpha, mut stroke_alpha) = (1., 1.);
        let mut paths: Vec<Vec<Point>> = vec![];
        let mut stack = vec![];
        let mut forms = vec![];
        self.draw_page(&page, |event, objects| {
            let (op, args, ctm) = match event {
                Draw::Opacity { fill, stroke } => {
                    if let Some(alpha) = fill { fill_alpha = alpha; }
                    if let Some(alpha) = stroke { stroke_alpha = alpha; }
                    return Some(());
                }
                Draw::BeginForm([x0, y0, x1, y1], [a, b, c, d, e, f]) => {
                    let pt = |x, y| point(a * x + c * y + e, b * x + d * y + f);
                    bitmap
                        .form_clips
                        .push([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]);
                    forms.push((
                        fill,
                        stroke,
                        width,
                        fill_alpha,
                        stroke_alpha,
                        std::mem::take(&mut paths),
                        std::mem::take(&mut stack),
                    ));
                    return Some(());
                }
                Draw::EndForm => {
                    (fill, stroke, width, fill_alpha, stroke_alpha, paths, stack) = forms.pop()?;
                    bitmap.form_clips.pop()?;
                    return Some(());
                }
                Draw::Image(stream, matrix) => {
                    let mode = super::ImageRead::Raster;
                    if let Some(mut image) = Image::read(objects, stream, matrix, opt.limit, mode)? {
                        if image.stencil {
                            // Convert PDF 16.16 color components to device bytes.
                            let [r, g, b] = fill.map(|c: f64| ((((c.clamp(0., 1.) * 65536.) as u32) * 255 + 32768) >> 16) as u8);
                            for p in &mut image.pixels {
                                *p = [r, g, b, 255 - p[0]];
                            }
                        }
                        let mask = match image.mask {
                            Some(id) => {
                                let mut mask = Image::read(objects, ImageStream::Object(id), matrix, opt.limit, mode)??;
                                if mask.components != 1 { return None; }
                                if opt.backend == RasterBackend::Splash && mask.stencil && mask.width <= image.width && mask.height <= image.height {
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
                        let [a, b, c, d, e, f] = image.matrix;
                        let [xx, yx] = axis(a, b);
                        let [xy, yy] = axis(-c, -d);
                        let [tx, ty] = point(e + c, f + d);
                        bitmap.image(image, mask, [xx, yx, xy, yy, tx, ty], opt.limit, fill_alpha)?;
                    }
                    return Some(());
                }
                Draw::Operator(op, args, ctm) => (op, args, ctm),
                Draw::Glyph {
                    byte,
                    family,
                    program,
                    matrix,
                    mode,
                    ..
                } => {
                    if matches!(mode, 0 | 2 | 4 | 6) {
                        let outline = pdf_glyph::outline(
                            &mut faces,
                            family,
                            program,
                            byte,
                            &mut bitmap.work,
                            |x, y| point(x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]),
                        )?;
                        bitmap.paint(&outline, fill, fill_alpha, false, opt.text_aa, true)?;
                    }
                    return Some(());
                }
            };
            let n = |i: usize| args.get(i)?.poppler_number();
            let pt = |x, y| point(x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]);
            match op {
                b"q" => {
                    if stack.len() >= 256 {
                        return None;
                    }
                    stack.push((fill, stroke, width, fill_alpha, stroke_alpha));
                }
                b"Q" => {
                    if let Some(state) = stack.pop() {
                        (fill, stroke, width, fill_alpha, stroke_alpha) = state;
                    }
                }
                b"rg" | b"RG" | b"g" | b"G" => {
                    let component = |i| if opt.backend == RasterBackend::Splash { n(i) } else { cairo_component(args.get(i)?) };
                    let c = if op.len() == 2 {
                        [component(0)?, component(1)?, component(2)?]
                    } else {
                        [component(0)?; 3]
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
                        bitmap.paint(&paths, fill, fill_alpha, op.ends_with(b"*"), opt.antialias, true)?;
                    }
                    if !matches!(op, b"f" | b"F" | b"f*") {
                        let [xx, yx] = axis(ctm[0], ctm[1]);
                        let [xy, yy] = axis(ctm[2], ctm[3]);
                        let det = xx * yy - xy * yx;
                        let cairo = opt.backend == RasterBackend::Cairo;
                        let adjusted = cairo && (width * (xx + xy)).abs() <= 1.
                            && (width * (yx + yy)).abs() <= 1. && det != 0.;
                        let half = if adjusted {
                            ((yy - xy) / det).abs().min(((xx - yx) / det).abs()) / 2.
                        } else { width / 2. };
                        let fixed = |v: f64| (v * 256.).round_ties_even() / 256.;
                        let mut outlines = vec![];
                        for path in &paths {
                            for seg in path.windows(2) {
                                let mut a = seg[0];
                                let mut b = seg[1];
                                if cairo {
                                    if adjusted && ((b[0] - a[0]).abs() < 0.5 || (b[1] - a[1]).abs() < 0.5) {
                                        a = a.map(|v| v.floor() + 0.5);
                                        b = b.map(|v| v.floor() + 0.5);
                                    } else {
                                        a = a.map(fixed);
                                        b = b.map(fixed);
                                    }
                                }
                                let (x, y) = (b[0] - a[0], b[1] - a[1]);
                                // Normalize the tangent in user space; the line width is
                                // specified there, even for unequal DPI or a sheared CTM.
                                let (ux, uy) = (yy * x - xy * y, xx * y - yx * x);
                                let len = ux.hypot(uy);
                                if len == 0. {
                                    continue;
                                }
                                let (u, v) = (-uy / len * half, ux / len * half);
                                let mut normal = [xx * u + xy * v, yx * u + yy * v];
                                if cairo { normal = normal.map(fixed); }
                                let [nx, ny] = normal;
                                outlines.push(vec![
                                    [a[0] + nx, a[1] + ny],
                                    [b[0] + nx, b[1] + ny],
                                    [b[0] - nx, b[1] - ny],
                                    [a[0] - nx, a[1] - ny],
                                ]);
                            }
                        }
                        bitmap.paint(&outlines, stroke, stroke_alpha, false, opt.antialias, xy == 0. && yx == 0.)?;
                    }
                    paths.clear();
                }
                b"n" => paths.clear(),
                _ => {}
            }
            Some(())
        })?;
        let mut pixels = bitmap.pixels;
        if bitmap.white_background {
            for p in &mut pixels { over_white(p, bitmap.backend); }
        }
        if let Some((compression, dither)) = opt.tiff {
            return crate::commands::archive::tiff::encode(&pixels, w, dpi, if opt.transparent { "rgba" } else { opt.color }, compression, dither, opt.limit);
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
                width: w, height: h, pixels: &pixels, quality,
                dpi: dpi.map(|v| v as u16), gray,
            }, opt.limit).ok();
        }
        encode(w, h, &pixels, opt.format, opt.color, (opt.format == "PNG").then_some(dpi))
    }
}
