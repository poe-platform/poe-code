// Pixel coordinates and sample positions follow the Mermaid rasterizer, including
// its separate 8x8 coverage grid for embedded-font glyphs.
use super::advance;
use crate::commands::archive::parse_color;
use std::ops::RangeInclusive;

pub(super) enum Paint {
    Pie {
        cy: f64,
        ends: Vec<(f64, [u8; 4])>,
    },
    Box {
        bounds: [f64; 4],
        radius: f64,
        color: [u8; 4],
    },
    Text {
        start: f64,
        baseline: f64,
        size: f64,
        weight: u16,
        color: [u8; 4],
        text: String,
    },
}
struct Frame {
    pixels: Vec<[u8; 4]>,
    width: usize,
    height: usize,
    scale: f64,
}
const SUB: [f64; 4] = [0.125, 0.375, 0.625, 0.875];
impl Frame {
    fn new(
        width: usize,
        height: usize,
        scale: f64,
        bg: &str,
        limit: usize,
    ) -> Result<Self, String> {
        let n = width
            .checked_mul(height)
            .filter(|n| *n <= limit / 4)
            .ok_or("mmdc: E_LIMIT: Raster pixel limit exceeded\n")?;
        let mut c =
            if bg.trim().eq_ignore_ascii_case("gray") || bg.trim().eq_ignore_ascii_case("grey") {
                [128, 128, 128, 255]
            } else {
                parse_color(bg)
                    .map_err(|_| format!("mmdc: E_CONFIG: Unsupported color format '{bg}'\n"))?
            };
        if c[3] == 0 {
            c = [0; 4];
        }
        Ok(Self {
            pixels: vec![c; n],
            width,
            height,
            scale,
        })
    }
    fn bounds(
        &self,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    ) -> (RangeInclusive<usize>, RangeInclusive<usize>) {
        (
            (x1.floor() as usize)..=(x2.ceil() as usize).min(self.width - 1),
            (y1.floor() as usize)..=(y2.ceil() as usize).min(self.height - 1),
        )
    }
    fn blend(&mut self, x: usize, y: usize, c: [f64; 4], coverage: f64) {
        let a = c[3] / 255. * coverage;
        if a <= 0.001 {
            return;
        }
        let p = &mut self.pixels[y * self.width + x];
        if a >= 0.999 && c[3] == 255. {
            *p = c.map(|n| n as u8);
            return;
        }
        let dst = f64::from(p[3]) / 255.;
        let out = a + dst * (1. - a);
        for i in 0..3 {
            p[i] = ((c[i] * a + f64::from(p[i]) * dst * (1. - a)) / out).round() as u8;
        }
        p[3] = (out * 255.).round() as u8;
    }
    fn draw(&mut self, op: &Paint) {
        let scale = self.scale;
        match op {
            Paint::Pie { cy, ends } => {
                let (cx, cy, r) = (152. * scale, cy * scale, 120. * scale);
                let (xs, ys) = self.bounds(cx - r, cy - r, cx + r, cy + r);
                for y in ys {
                    for x in xs.clone() {
                        let (mut rgb, mut n) = ([0u32; 3], 0u32);
                        for sy in SUB {
                            for sx in SUB {
                                let (dx, dy) = (x as f64 + sx - cx, y as f64 + sy - cy);
                                if dx * dx + dy * dy > r * r {
                                    continue;
                                }
                                let mut a = dy.atan2(dx);
                                if a < -std::f64::consts::FRAC_PI_2 {
                                    a += std::f64::consts::TAU;
                                }
                                let c = ends[ends
                                    .partition_point(|(end, _)| *end <= a)
                                    .min(ends.len() - 1)]
                                .1;
                                for i in 0..3 {
                                    rgb[i] += u32::from(c[i]);
                                }
                                n += 1;
                            }
                        }
                        if n > 0 {
                            let [r, g, b] = rgb.map(|v| f64::from(v) / f64::from(n));
                            self.blend(x, y, [r, g, b, 255.], f64::from(n) / 16.);
                        }
                    }
                }
            }
            Paint::Box {
                bounds: [x, y, w, h],
                radius,
                color,
            } => {
                let (cx, cy, hw, hh) = (
                    (x + w / 2.) * scale,
                    (y + h / 2.) * scale,
                    w / 2. * scale,
                    h / 2. * scale,
                );
                let r = (radius * scale).min(hw).min(hh);
                let (xs, ys) = self.bounds(cx - hw - 2., cy - hh - 2., cx + hw + 2., cy + hh + 2.);
                let dist = |px: f64, py: f64| {
                    let (qx, qy) = ((px - cx).abs() - (hw - r), (py - cy).abs() - (hh - r));
                    qx.max(0.).hypot(qy.max(0.)) + qx.max(qy).min(0.) - r
                };
                for y in ys {
                    for x in xs.clone() {
                        let d = dist(x as f64 + 0.5, y as f64 + 0.5);
                        if d > 1.2 {
                            continue;
                        }
                        let c = color.map(f64::from);
                        if d < -1.2 {
                            self.blend(x, y, c, 1.);
                            continue;
                        }
                        let mut hits = 0;
                        let mut edge = 0;
                        for sy in SUB {
                            for sx in SUB {
                                let d = dist(x as f64 + sx, y as f64 + sy);
                                hits += usize::from(d <= 0.);
                                edge += usize::from(d == 0.);
                            }
                        }
                        self.blend(x, y, c, hits as f64 / 16.);
                        self.blend(x, y, c, edge as f64 / 16.);
                    }
                }
            }
            Paint::Text {
                start,
                baseline,
                size,
                weight,
                color,
                text,
            } => {
                let unit = size * scale / 1000.;
                let boost = if *weight == 500 { 0.08 * scale } else { 0. };
                let mut left = start * scale;
                for c in text.chars() {
                    self.glyph(
                        c,
                        *weight >= 600,
                        left,
                        baseline * scale,
                        unit,
                        boost,
                        *color,
                    );
                    left += f64::from(advance(c, *weight >= 600)) * unit;
                }
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn glyph(
        &mut self,
        c: char,
        bold: bool,
        left: f64,
        baseline: f64,
        unit: f64,
        boost: f64,
        color: [u8; 4],
    ) {
        let data = include_bytes!("outlines.bin");
        let idx = super::glyph_index(c);
        let ptr = (idx * 2 + usize::from(bold)) * 4;
        let mut pos = u32::from_le_bytes(data[ptr..ptr + 4].try_into().unwrap()) as usize;
        let word = |p: &mut usize| {
            let v = i16::from_le_bytes(data[*p..*p + 2].try_into().unwrap());
            *p += 2;
            v
        };
        let [xmin, ymin, xmax, ymax] = std::array::from_fn(|_| f64::from(word(&mut pos)));
        let contours = word(&mut pos);
        if contours == 0 {
            return;
        }
        let (xs, ys) = self.bounds(
            left + xmin * unit - boost - 1.,
            baseline - ymax * unit - 1.,
            left + xmax * unit + boost + 1.,
            baseline - ymin * unit + 1.,
        );
        if xs.is_empty() || ys.is_empty() {
            return;
        }
        let mut edges = Vec::new();
        for _ in 0..contours {
            let n = word(&mut pos) as usize;
            let mut raw = Vec::with_capacity(n);
            for _ in 0..n {
                let x = f64::from(word(&mut pos));
                let y = f64::from(word(&mut pos));
                let on = data[pos] != 0;
                pos += 1;
                raw.push((x, y, on));
            }
            if n < 2 {
                continue;
            }
            let mut pts = Vec::new();
            for (i, &p) in raw.iter().enumerate() {
                let q = raw[(i + 1) % n];
                pts.push(p);
                if !p.2 && !q.2 {
                    pts.push(((p.0 + q.0) / 2., (p.1 + q.1) / 2., true));
                }
            }
            let offset = pts.iter().position(|p| p.2).unwrap_or(0);
            pts.rotate_left(offset);
            let screen = |i: usize| {
                let p = pts[i % pts.len()];
                (left + p.0 * unit, baseline - p.1 * unit)
            };
            let mut poly = Vec::new();
            let mut i = 0;
            while i < pts.len() {
                let a = screen(i);
                poly.push(a);
                if pts[(i + 1) % pts.len()].2 {
                    i += 1;
                    continue;
                }
                let b = screen(i + 1);
                let c = screen(i + 2);
                for s in 1..12 {
                    let t = s as f64 / 12.;
                    let f = 1. - t;
                    poly.push((
                        f * f * a.0 + 2. * f * t * b.0 + t * t * c.0,
                        f * f * a.1 + 2. * f * t * b.1 + t * t * c.1,
                    ));
                }
                i += 2;
            }
            if poly.len() >= 3 {
                for i in 0..poly.len() {
                    edges.push((poly[(i + poly.len() - 1) % poly.len()], poly[i]));
                }
            }
        }
        let lo = *xs.start();
        let hi = *xs.end();
        let mut hits = vec![0u8; hi - lo + 1];
        let mut crossings = Vec::new();
        for y in ys {
            hits.fill(0);
            for sy in 0..8 {
                let sample = y as f64 + (sy as f64 + 0.5) / 8.;
                crossings.clear();
                for &(p, q) in &edges {
                    if (p.1 <= sample && q.1 > sample) || (q.1 <= sample && p.1 > sample) {
                        crossings.push((
                            p.0 + ((sample - p.1) / (q.1 - p.1)) * (q.0 - p.0),
                            if p.1 < q.1 { 1 } else { -1 },
                        ));
                    }
                }
                crossings.sort_by(|a, b| a.0.total_cmp(&b.0));
                let mut winding = 0;
                let mut start = 0.;
                for &(x, dir) in &crossings {
                    let before = winding;
                    winding += dir;
                    if before == 0 {
                        start = x - boost;
                    } else if winding == 0 {
                        let end = x + boost;
                        for px in lo.max(start.floor() as usize)..=hi.min(end.ceil() as usize) {
                            for sx in 0..8 {
                                let sample = px as f64 + (sx as f64 + 0.5) / 8.;
                                if sample >= start && sample <= end {
                                    hits[px - lo] = hits[px - lo].wrapping_add(1);
                                }
                            }
                        }
                    }
                }
            }
            for (i, &n) in hits.iter().enumerate() {
                if n > 0 {
                    self.blend(
                        lo + i,
                        y,
                        color.map(f64::from),
                        (f64::from(n) / 64.).min(1.).powf(0.72),
                    );
                }
            }
        }
    }
}

impl super::Scene {
    pub(in super::super) fn raster(
        &self,
        width: f64,
        height: f64,
        scale: f64,
        bg: &str,
        format: &str,
        limit: usize,
    ) -> Option<Result<Vec<u8>, String>> {
        use crate::commands::archive::{PngEncoding, image_pdf, pixel_png};
        let ops = self.paint.as_ref()?;
        let w = (width * scale).ceil().max(1.) as usize;
        let h = (height * scale).ceil().max(1.) as usize;
        let mut frame = match Frame::new(
            w,
            h,
            (w as f64 / self.width).min(h as f64 / self.height),
            bg,
            limit,
        ) {
            Ok(f) => f,
            Err(e) => return Some(Err(e)),
        };
        for op in ops {
            frame.draw(op);
        }
        Some(if format == "png" {
            Ok(pixel_png(w, h, PngEncoding::Mermaid, |x, y| {
                frame.pixels[y * w + x]
            }))
        } else {
            image_pdf(&frame.pixels, w, h, width * 0.75, height * 0.75, limit)
                .ok_or_else(|| "mmdc: E_LIMIT: Output byte budget exceeded\n".into())
        })
    }
}
