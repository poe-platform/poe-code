// PDF page coordinates are in points from the bottom left. Rasterize the paths
// at the horizontal resolution, then resample, rotate and crop the bitmap.
use super::pdf_text_layout::Draw;
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
struct Bitmap {
    w: usize,
    h: usize,
    pixels: Vec<[u8; 4]>,
    work: usize,
}
impl Bitmap {
    fn image(
        &mut self,
        mut im: super::pdf_bitmap::Image,
        ox: f64,
        top: f64,
        scale: f64,
        splash: bool,
    ) -> Option<()> {
        let [a, b, c, d, e, f] = im.matrix;
        let det = a * d - b * c;
        if det.abs() <= 1e-8 {
            return Some(());
        }
        // Splash scales an upright image across inclusive device bounds, then clips it.
        if splash && a > 0. && d > 0. && b == 0. && c == 0. && im.pixels.iter().all(|p| p[3] == 255) {
            let left = ((e - ox) * scale).floor();
            let top_px = ((top - f - d) * scale).floor();
            let right = ((a + e - ox) * scale).floor() + 1.;
            let bottom = ((top - f) * scale).floor() + 1.;
            let sw = right - left;
            let sh = bottom - top_px;
            if sw >= im.width as f64 && sh >= im.height as f64 {
                let xs = (left as usize).min(self.w)..(right as usize).min(self.w);
                let ys = (top_px as usize).min(self.h)..(bottom as usize).min(self.h);
                self.work = self.work.checked_sub(xs.len().checked_mul(ys.len())?)?;
                let dx = im.width as f64 / sw;
                let dy = im.height as f64 / sh;
                let smooth = im.interpolate || dx > 0.25 && dy > 0.25;
                let mix = |a: u8, b: u8, t: f64| (f64::from(a) * (1. - t) + f64::from(b) * t) as u8;
                let mut v = (ys.start as f64 - top_px) * dy;
                for y in ys {
                    let mut u = (xs.start as f64 - left) * dx;
                    for x in xs.clone() {
                        let value = if smooth {
                            let x0 = (u as usize).min(im.width - 1);
                            let y0 = (v as usize).min(im.height - 1);
                            let row = |j: usize, k: usize| {
                                let p = &im.pixels[j * im.width..][..im.width];
                                mix(p[x0][k], p[(x0 + 1).min(im.width - 1)][k], u.fract())
                            };
                            std::array::from_fn(|k| if k == 3 {255} else {mix(row(y0,k), row((y0 + 1).min(im.height - 1),k), v.fract())})
                        } else {
                            let x0 = (((x as f64 - left + 1.) * dx).ceil() - 1.) as usize;
                            let y0 = (((y as f64 - top_px + 1.) * dy).ceil() - 1.) as usize;
                            im.pixels[y0.min(im.height - 1) * im.width + x0.min(im.width - 1)]
                        };
                        self.pixels[y * self.w + x] = value;
                        u += dx;
                    }
                    v += dy;
                }
                return Some(());
            }
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
                let alpha = s[3] / 255.;
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
            for (x, &count) in counts.iter().enumerate() {
                let a = if aa {
                    f64::from(count) / 16.
                } else {
                    f64::from(u8::from(count >= 8))
                };
                if a == 0. {
                    continue;
                }
                let px = &mut self.pixels[y * self.w + x0 + x];
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
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = [0; 13];
    ihdr[..4].copy_from_slice(&(w as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(h as u32).to_be_bytes());
    ihdr[8] = if bilevel { 1 } else { 8 };
    ihdr[9] = if bilevel || format == "PNG8" { 0 } else if rgb { 2 } else { 6 };
    let phys = dpi.map(|[x,y]| {
        let mut field = [0u8; 9];
        field[..4].copy_from_slice(&((x / 0.0254) as u32).to_be_bytes());
        field[4..8].copy_from_slice(&((y / 0.0254) as u32).to_be_bytes());
        field[8] = 1;
        field
    });
    let compressed = crate::commands::codecs::zlib_compress(&raw);
    for (tag, data) in [(b"IHDR", ihdr.as_slice())].into_iter()
        .chain(phys.as_ref().map(|bytes| (b"pHYs", bytes.as_slice())))
        .chain([(b"IDAT", compressed.as_slice()), (b"IEND", &[][..])]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(tag);
        out.extend_from_slice(data);
        out.extend_from_slice(&crate::commands::archive::crc32_ieee(&out[start..]).to_be_bytes());
    }
    Some(out)
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
            w,
            h,
            pixels: vec![if opt.transparent { [0; 4] } else { [255; 4] }; w * h],
            work: opt.limit.saturating_mul(4),
        };
        let mut faces = std::collections::BTreeMap::new();
        let mut fill = [0.; 3];
        let mut stroke = [0.; 3];
        let mut width = 1.;
        let mut paths: Vec<Vec<Point>> = vec![];
        let mut stack = vec![];
        self.draw_page(&page, |event, objects| {
            let (op, args, ctm) = match event {
                Draw::Image(id, matrix) => {
                    if let Some(image) = super::pdf_bitmap::Image::read(objects, id, matrix, opt.limit, super::ImageRead::Pixels)? {
                        bitmap.image(image, ox, oy + ph, sx, opt.splash)?;
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
                pixels.push(bitmap.pixels[src_y.min(h - 1) * w + bx + ix]);
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
