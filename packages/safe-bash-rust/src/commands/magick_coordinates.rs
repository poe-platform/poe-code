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

impl Geometry {
    pub fn parse(spec: &str) -> Self {
        let raw = spec.trim();
        let units = raw.trim_end_matches(['%', '@', '!', '<', '>', '^']);
        let split = units.find(['+', '-']).unwrap_or(units.len());
        let (dims, offset) = units.split_at(split);
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
    pub fn rotate(&mut self, degrees: f64, bg: [u8; 4], limit: usize) -> Result<(), &'static str> {
        if !degrees.is_finite() {
            return Err("Invalid affine output dimensions");
        }
        let deg = ((degrees % 360.) + 360.) % 360.;
        for (i, angle) in [0., 90., 180., 270.].iter().enumerate() {
            if (deg - angle).abs() < 1e-6 {
                match i {
                    1 => self.remap(self.height, self.width, |im, x, y| {
                        im.pixels[(im.height - 1 - x) * im.width + y]
                    }),
                    2 => self.pixels.reverse(),
                    3 => self.remap(self.height, self.width, |im, x, y| {
                        im.pixels[x * im.width + im.width - 1 - y]
                    }),
                    _ => {}
                }
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
