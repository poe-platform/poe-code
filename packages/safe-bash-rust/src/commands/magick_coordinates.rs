use super::png_pixels::Raster;

#[derive(Clone, Copy)]
pub(super) struct Geometry {
    width: Option<f64>,
    height: Option<f64>,
    x: f64,
    y: f64,
    percent: bool,
    subdivide: bool,
}

// ImageMagick offsets are one or two signed decimal numbers after the dimensions.
pub(super) fn split_offsets(spec: &str) -> (&str, &str) {
    let units = spec.trim().trim_end_matches(['%', '@', '!', '<', '>', '^']);
    if let Some(at) = units.find(['+', '-']) {
        let offset = &units[at..];
        let mut parts = offset[1..].split(['+', '-']);
        let decimal = |s: &str| {
            let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
            s.split_once('.')
                .map_or_else(|| digits(s), |(a, b)| digits(a) && digits(b))
        };
        if parts.next().is_some_and(decimal)
            && parts.next().is_none_or(decimal)
            && parts.next().is_none()
        {
            return (&units[..at], offset);
        }
    }
    (units, "")
}

impl Geometry {
    pub fn canvas_size(spec: &str) -> (u32, u32) {
        let g = Self::parse(spec);
        if spec.contains('@') && !g.subdivide {
            return (1, 1);
        }
        let w = g.width.unwrap_or(1.).round().max(1.);
        (w as u32, g.height.unwrap_or(w).round().max(1.) as u32)
    }
    pub fn brightness_contrast(self) -> (f64, f64) {
        (1. + self.height.unwrap_or(0.) / 100., self.width.unwrap_or(0.) / 100. * 255.)
    }

    pub fn sigma(self) -> f64 {
        self.height.or(self.width).unwrap_or(1.).max(0.3)
    }

    pub fn parse(spec: &str) -> Self {
        let raw = spec.trim();
        let (dims, offset) = split_offsets(raw);
        let mut starts = offset.match_indices(['+', '-']).map(|(i, _)| i).peekable();
        let mut offset_number = || {
            starts
                .next()
                .and_then(|i| {
                    offset[i..starts.peek().copied().unwrap_or(offset.len())]
                        .parse::<f64>()
                        .ok()
                })
                .unwrap_or(0.)
        };
        let dims = dims.trim_end_matches(['%', '@', '!', '<', '>', '^']);
        let (w, h) = dims.split_once(['x', 'X']).unwrap_or((dims, ""));
        let dimension = |s: &str| {
            s.trim_end_matches('%')
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
        };
        Self {
            width: dimension(w),
            height: dimension(h),
            x: offset_number(),
            y: offset_number(),
            percent: raw.contains('%'),
            subdivide: raw.contains('@') && dims.contains(['x', 'X']),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct Gravity(i8, i8);
impl Gravity {
    pub fn offset(self, x: usize, y: usize) -> (usize, usize) {
        (
            Self::axis(x as f64, 0., self.0) as usize,
            Self::axis(y as f64, 0., self.1) as usize,
        )
    }
    pub fn parse(value: &str) -> Self {
        match value
            .to_ascii_lowercase()
            .replace(['-', '_', ' '], "")
            .as_str()
        {
            "northwest" => Self(-1, -1),
            "north" => Self(0, -1),
            "northeast" => Self(1, -1),
            "west" => Self(-1, 0),
            "east" => Self(1, 0),
            "southwest" => Self(-1, 1),
            "south" => Self(0, 1),
            "southeast" => Self(1, 1),
            _ => Self(0, 0),
        }
    }
    fn axis(space: f64, off: f64, gravity: i8) -> f64 {
        match gravity {
            -1 => off,
            1 => space - off,
            _ => space / 2. + off,
        }
    }
}

fn bounded(w: usize, h: usize, limit: usize) -> Result<(), &'static str> {
    if w.saturating_mul(h) > limit / 4 {
        Err("image exceeds memory budget")
    } else {
        Ok(())
    }
}

impl Raster {
    pub fn raise(&mut self, g: Geometry, raised: bool) {
        let border = g.width.unwrap_or(4.).round().max(1.) as usize;
        for (i, pixel) in self.pixels.iter_mut().enumerate() {
            let (x, y) = (i % self.width, i / self.width);
            let top_left = x < border || y < border;
            let bottom_right =
                x >= self.width.saturating_sub(border) || y >= self.height.saturating_sub(border);
            if top_left || bottom_right {
                let lighten = if raised { top_left } else { bottom_right };
                for c in &mut pixel[..3] {
                    *c = if lighten {
                        c.saturating_add(40)
                    } else {
                        c.saturating_sub(40)
                    };
                }
            }
        }
    }

    pub fn shadow(&mut self, g: Geometry, bg: [u8; 4], limit: usize) -> Result<(), &'static str> {
        let opacity = g.width.unwrap_or(80.).clamp(0., 100.) / 100.;
        let sigma = g.height.unwrap_or(3.).max(0.5);
        let pad = ((2. * sigma).ceil() + g.x.abs().max(g.y.abs())).max(2.);
        let (w, h) = (self.width as f64 + 2. * pad, self.height as f64 + 2. * pad);
        if (w * h * 4.).fract() != 0. || w * h * 4. > limit as f64 {
            return Err("EFBIG: file too large");
        }
        if w.fract() != 0. || h.fract() != 0. {
            return Err("Invalid stored image dimensions");
        }
        let (width, height) = (w as usize, h as usize);
        let left = pad + (g.x + 0.5).floor();
        let top = pad + (g.y + 0.5).floor();
        let mut pixels = vec![[0; 4]; width * height];
        // A half-pixel offset starts two bytes into a packed RGBA pixel.
        // Samples beyond the final row are transparent, regardless of adjacent allocations.
        let source = self.pixels.as_flattened();
        let output = pixels.as_flattened_mut();
        for row in 0..self.height {
            let y = top.ceil() as usize + row;
            let first = (((y as f64 - top) * self.width as f64) * 4.) as usize;
            let start = y * width * 4 + (left * 4.) as usize;
            for (x, pixel) in output[start..start + self.width * 4]
                .chunks_exact_mut(4)
                .enumerate()
            {
                let alpha = source.get(first + x * 4 + 3).copied().unwrap_or(0);
                pixel[..3].copy_from_slice(&bg[..3]);
                pixel[3] = (f64::from(alpha) * opacity).round() as u8;
            }
        }
        self.width = width;
        self.height = height;
        self.pixels = pixels;
        self.alpha = true;
        self.blur(sigma, true);
        Ok(())
    }

    pub fn roll(&mut self, g: Geometry) {
        if self.width == 0 || self.height == 0 {
            return;
        }
        let shift = |off, dim: Option<f64>, n| {
            let v = if off == 0. { dim.unwrap_or(0.) } else { off };
            (v + 0.5).floor().rem_euclid(n as f64) as usize
        };
        let dx = shift(g.x, g.width, self.width);
        let dy = shift(g.y, g.height, self.height);
        self.pixels.rotate_right(dy * self.width);
        if dx != 0 {
            for row in self.pixels.chunks_exact_mut(self.width) {
                row.rotate_right(dx);
            }
        }
    }

    pub fn splice(
        &mut self,
        g: Geometry,
        gravity: Gravity,
        bg: [u8; 4],
        limit: usize,
    ) -> Result<(), &'static str> {
        let axis = |n: usize, dim: Option<f64>, off: f64, gravity: i8| {
            let gap = dim.unwrap_or(0.).round().max(0.) as usize;
            let base = if gravity == 0 {
                (n / 2) as f64
            } else if gravity == 1 {
                n as f64
            } else {
                0.
            };
            let at = (base + if gravity == 1 { -off } else { off } + 0.5)
                .floor()
                .clamp(0., n as f64) as usize;
            (at, gap)
        };
        let (left, sw) = axis(self.width, g.width, g.x, gravity.0);
        let (top, sh) = axis(self.height, g.height, g.y, gravity.1);
        let w = self.width.saturating_add(sw);
        let h = self.height.saturating_add(sh);
        bounded(w, h, limit)?;
        if w == 0 || h == 0 {
            return Err("Invalid generated resource dimensions");
        }
        self.remap(w, h, |im, x, y| {
            if (left..left + sw).contains(&x) || (top..top + sh).contains(&y) {
                return bg;
            }
            let sx = if x < left { x } else { x - sw };
            let sy = if y < top { y } else { y - sh };
            im.pixels[sy * im.width + sx]
        });
        self.alpha = true;
        Ok(())
    }

    pub fn chop(&mut self, g: Geometry, gravity: Gravity) {
        let cut = |n: usize, dim: Option<f64>, off: f64, gravity| {
            let size = dim.unwrap_or(0.).round().max(0.);
            let at = Gravity::axis(n as f64 - size, off, gravity).trunc();
            if at + size < 0. || at > n as f64 {
                return None;
            }
            let start = at.max(0.) as usize;
            let end = (at + size).clamp(0., n as f64) as usize;
            (end - start < n).then_some((start, end - start))
        };
        if let (Some((left, sw)), Some((top, sh))) = (
            cut(self.width, g.width, g.x, gravity.0),
            cut(self.height, g.height, g.y, gravity.1),
        ) {
            self.remap(self.width - sw, self.height - sh, |im, x, y| {
                im.pixels
                    [(y + usize::from(y >= top) * sh) * im.width + x + usize::from(x >= left) * sw]
            });
        }
    }

    pub fn shave(&mut self, g: Geometry) {
        let left = (g.width.unwrap_or(0.).round() as usize).min((self.width - 1) / 2);
        let top = (g.height.or(g.width).unwrap_or(0.).round() as usize).min((self.height - 1) / 2);
        self.remap(self.width - 2 * left, self.height - 2 * top, |im, x, y| {
            im.pixels[(y + top) * im.width + x + left]
        });
    }

    pub fn crop(&mut self, g: Geometry, gravity: Gravity) {
        let (w, h) = (self.width as f64, self.height as f64);
        let (left, top, right, bottom) = if g.subdivide {
            let cols = g.width.unwrap_or(1.).round().max(1.);
            let rows = g.height.unwrap_or(1.).round().max(1.);
            (
                ((cols - 1.) * w / cols).round().min(w - 1.),
                ((rows - 1.) * h / rows).round().min(h - 1.),
                w,
                h,
            )
        } else {
            let (cw, ch) = if g.percent {
                (
                    w * g.width.or(g.height).unwrap_or(100.) / 100.,
                    h * g.height.or(g.width).unwrap_or(100.) / 100.,
                )
            } else {
                (g.width.unwrap_or(w), g.height.unwrap_or(h))
            };
            let (cw, ch) = (cw.round().max(1.), ch.round().max(1.));
            let x = Gravity::axis(w - cw, g.x, gravity.0).trunc();
            let y = Gravity::axis(h - ch, g.y, gravity.1).trunc();
            if x == w || y == h {
                return;
            }
            (x.max(0.), y.max(0.), (x + cw).min(w), (y + ch).min(h))
        };
        let (left, top, w, h) = if right <= left || bottom <= top {
            (0, 0, 1, 1)
        } else {
            (
                left as usize,
                top as usize,
                (right - left) as usize,
                (bottom - top) as usize,
            )
        };
        self.remap(w, h, |im, x, y| im.pixels[(y + top) * im.width + left + x]);
    }
    pub fn border(&mut self, g: Geometry, bg: [u8; 4], limit: usize) -> Result<(), &'static str> {
        let x = g.width.unwrap_or(0.).round().max(0.) as usize;
        let y = g.height.unwrap_or(x as f64).round().max(0.) as usize;
        let w = self.width.saturating_add(x.saturating_mul(2));
        let h = self.height.saturating_add(y.saturating_mul(2));
        bounded(w, h, limit)?;
        self.remap(w, h, |im, i, j| {
            if i >= x && i < w - x && j >= y && j < h - y {
                im.pixels[(j - y) * im.width + i - x]
            } else {
                bg
            }
        });
        self.alpha |= bg[3] < 255;
        Ok(())
    }
    pub fn extent(
        &mut self,
        g: Geometry,
        gravity: Gravity,
        bg: [u8; 4],
        limit: usize,
    ) -> Result<(), &'static str> {
        let w = g.width.unwrap_or(self.width as f64).round().max(1.) as usize;
        let h = g.height.unwrap_or(self.height as f64).round().max(1.) as usize;
        bounded(w, h, limit)?;
        let axis = |space: f64, off: f64, gr: i8| {
            (Gravity::axis(space, 0., gr).trunc() + if gr == 1 { off } else { -off } + 0.5).floor()
        };
        let left = axis(w as f64 - self.width as f64, g.x, gravity.0);
        let top = axis(h as f64 - self.height as f64, g.y, gravity.1);
        self.remap(w, h, |im, x, y| {
            let (sx, sy) = (x as f64 - left, y as f64 - top);
            if sx < 0. || sy < 0. || sx >= im.width as f64 || sy >= im.height as f64 {
                bg
            } else {
                super::magick_composite::blend(
                    im.pixels[sy as usize * im.width + sx as usize],
                    bg,
                    "srcover",
                    1.,
                    1.,
                )
            }
        });
        self.gray = false;
        self.alpha = true;
        self.density = 72;
        Ok(())
    }
    pub fn orient(&mut self, code: u8) {
        match code {
            2 | 4 => {
                if code == 4 {
                    self.pixels.reverse();
                }
                for row in self.pixels.chunks_exact_mut(self.width.max(1)) {
                    row.reverse();
                }
            }
            3 => self.pixels.reverse(),
            5..=8 => self.remap(self.height, self.width, |im, x, y| {
                let sx = if code >= 7 { im.width - 1 - y } else { y };
                let sy = if matches!(code, 6 | 7) {
                    im.height - 1 - x
                } else {
                    x
                };
                im.pixels[sy * im.width + sx]
            }),
            _ => {}
        }
    }

    pub fn rotate(&mut self, degrees: f64, bg: [u8; 4], limit: usize) -> Result<(), &'static str> {
        if !degrees.is_finite() {
            return Err("Invalid affine output dimensions");
        }
        let deg = ((degrees % 360.) + 360.) % 360.;
        for (i, angle) in [0., 90., 180., 270.].iter().enumerate() {
            if (deg - angle).abs() < 1e-6 {
                self.orient([1, 6, 3, 8][i]);
                return Ok(());
            }
        }
        let (sin, cos) = (deg * std::f64::consts::PI / 180.).sin_cos();
        let (sw, sh) = (self.width as f64, self.height as f64);
        let bounds = |a: f64, b: f64| {
            let extrem = [0., a * sw, b * sh, a * sw + b * sh];
            let low = extrem.into_iter().fold(0., f64::min);
            let high = extrem.into_iter().fold(0., f64::max);
            ((low + 0.5).floor(), (high - low).round().max(1.) as usize)
        };
        let (left, w) = bounds(cos, -sin);
        let (top, h) = bounds(sin, cos);
        bounded(w, h, limit)?;
        let det = cos * cos + sin * sin;
        let mut outside = bg;
        for c in &mut outside[..3] {
            *c = if bg[3] == 0 {
                0
            } else {
                (255. / f32::from(bg[3]) * f32::from(*c)) as u8
            };
        }
        self.remap(w, h, |im, x, y| {
            let (ox, oy) = (x as f64 + left, y as f64 + top);
            let (sx, sy) = ((cos * ox + sin * oy) / det, (-sin * ox + cos * oy) / det);
            if sx <= -1. || sy <= -1. || sx >= sw || sy >= sh {
                return outside;
            }
            let (ix, iy) = (sx.floor() as isize, sy.floor() as isize);
            let (fx, fy) = (sx - sx.floor(), sy - sy.floor());
            let mut sum = [0.; 4];
            for (x, y, weight) in [
                (ix, iy, (1. - fx) * (1. - fy)),
                (ix + 1, iy, fx * (1. - fy)),
                (ix, iy + 1, (1. - fx) * fy),
                (ix + 1, iy + 1, fx * fy),
            ] {
                let p = if x < 0 || y < 0 || x as usize >= im.width || y as usize >= im.height {
                    bg
                } else {
                    im.pixels[y as usize * im.width + x as usize]
                };
                for c in 0..3 {
                    sum[c] += (f64::from(p[c]) * f64::from(p[3])) / 255. * weight;
                }
                sum[3] += f64::from(p[3]) * weight;
            }
            [0, 1, 2, 3].map(|c| {
                if c == 3 {
                    sum[c].round() as u8
                } else if sum[3] > 0. {
                    (sum[c] * 255. / sum[3]).round() as u8
                } else {
                    0
                }
            })
        });
        self.alpha |= bg[3] < 255;
        Ok(())
    }
}

#[cfg(test)]
mod shadow_tests {
    use super::*;

    #[test]
    fn fractional_shadow_reads_only_source_bytes() {
        let mut image = Raster {
            width: 1,
            height: 1,
            pixels: vec![[1, 2, 3, 255]],
            gray: false,
            alpha: true,
            orientation: None,
            density: 72,
        };
        image
            .shadow(Geometry::parse("100x0.5+1.5+0"), [8, 9, 10, 255], 1024)
            .unwrap();
        assert_eq!((image.width, image.height), (6, 6));
        let row = &image.pixels[18..24];
        assert_eq!(row[4..], [[0, 0, 8, 9], [10, 0, 0, 0]]);
    }
}
