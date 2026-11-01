use super::png_pixels::Raster;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Kernel {
    Nearest,
    Linear,
    Cubic,
    Mitchell,
    Lanczos2,
    Lanczos3,
}
impl Kernel {
    pub fn parse(raw: &str) -> Self {
        match raw.to_ascii_lowercase().as_str() {
            "point" | "nearest" | "box" => Self::Nearest,
            "triangle" | "linear" | "bilinear" | "hermite" => Self::Linear,
            "cubic" | "catrom" | "spline" => Self::Cubic,
            "mitchell" => Self::Mitchell,
            "lanczos2" => Self::Lanczos2,
            _ => Self::Lanczos3,
        }
    }
    fn weight(self, x: f64) -> f64 {
        let a = x.abs();
        match self {
            Self::Linear => (1. - a).max(0.),
            Self::Cubic if a < 1. => 1.5 * a * a * a - 2.5 * a * a + 1.,
            Self::Cubic if a < 2. => -0.5 * a * a * a + 2.5 * a * a - 4. * a + 2.,
            Self::Mitchell if a < 1. => {
                ((12. - 3. - 2.) * a * a * a + (-18. + 4. + 2.) * a * a + (6. - 2. / 3.)) / 6.
            }
            Self::Mitchell if a < 2. => {
                ((-1. / 3. - 2.) * a * a * a
                    + (2. + 10.) * a * a
                    + (-4. - 16.) * a
                    + (8. / 3. + 8.))
                    / 6.
            }
            Self::Lanczos2 | Self::Lanczos3 => {
                let n = if self == Self::Lanczos2 { 2. } else { 3. };
                let sinc = |x: f64| {
                    if x.abs() < 1e-7 {
                        1.
                    } else {
                        let p = std::f64::consts::PI * x;
                        p.sin() / p
                    }
                };
                if a < n { sinc(x) * sinc(x / n) } else { 0. }
            }
            _ => 0.,
        }
    }
}
fn phase(position: f64) -> usize {
    ((((position * 128.) as i64 & 127) + 1) >> 1) as usize
}
fn cubic(phase: usize) -> [i32; 4] {
    if phase == 64 {
        return [0, 0, 4096, 0];
    }
    let s = phase as f32 / 64.;
    let u = 1. - s;
    let t = -0.5 * s * u;
    let c0 = t * u;
    let c3 = t * s;
    let d = c3 - c0;
    [c0, (u - c0) + d, (s - c3) - d, c3].map(|c| (c * 4096.) as i32)
}
impl Raster {
    fn remap(&mut self, w: usize, h: usize, mut pixel: impl FnMut(&Self, usize, usize) -> [u8; 4]) {
        let mut out = Vec::with_capacity(w * h);
        for y in 0..h {
            for x in 0..w {
                out.push(pixel(self, x, y));
            }
        }
        self.width = w;
        self.height = h;
        self.pixels = out;
    }
    fn at(&self, x: isize, y: isize) -> [u8; 4] {
        self.pixels[y.clamp(0, self.height as isize - 1) as usize * self.width
            + x.clamp(0, self.width as isize - 1) as usize]
    }
    pub fn resize(&mut self, geom: &str, kernel: Kernel, limit: usize) -> Result<(), &'static str> {
        let (w, h) = super::apply_magick_resize_geom(self.width as u32, self.height as u32, geom);
        let (w, h) = (w as usize, h as usize);
        if w == self.width && h == self.height {
            return Ok(());
        }
        if w.saturating_mul(h) > limit / 4 || w == 0 || h == 0 {
            return Err("image exceeds memory budget");
        }
        let (sx, sy) = (
            1. / (self.width as f64 / w as f64),
            1. / (self.height as f64 / h as f64),
        );
        let alpha = self.pixels.iter().any(|p| p[3] != 255);
        if alpha {
            for p in &mut self.pixels {
                let f = f32::from(p[3]) / 255.;
                for c in &mut p[..3] {
                    *c = (f32::from(*c) * f) as u8;
                }
            }
        }
        if kernel == Kernel::Nearest {
            let ix = (self.width / w / 2).max(1);
            let iy = (self.height / h / 2).max(1);
            let (sw, sh) = (self.width / ix, self.height / iy);
            let (sx, sy) = (
                (sx * ix as f64).max(1. / sw as f64),
                (sy * iy as f64).max(1. / sh as f64),
            );
            let (rx, ry) = (sx.max(1.), sy.max(1.));
            let inv = 1. / (rx * ry);
            let coords = |size: usize, n: usize, scale: f64, stride: usize, y: bool| {
                let mut v = Vec::with_capacity(n);
                let f = 1. / scale;
                let mut pos = if scale < 1. {
                    let extra = (size as f64 / f).round().mul_add(f, -(size as f64));
                    0.5 * f - 0.5 - ((extra + 1.) * 0.5 - 1.)
                } else {
                    1.
                };
                let inc = if y { rx * inv } else { ry * inv };
                for i in 0..n {
                    let j = if scale < 1. {
                        let j = pos as usize;
                        pos += f;
                        j
                    } else if rx.fract() != 0. || ry.fract() != 0. {
                        let j = if y { i as f64 * inc + 1. } else { pos };
                        pos += inc;
                        (j as usize).saturating_sub(1)
                    } else {
                        i / (scale as usize).max(1)
                    };
                    v.push(j.min(size - 1) * stride);
                }
                v
            };
            let xs = coords(sw, w, sx, ix, false);
            let ys = coords(sh, h, sy, iy, true);
            self.remap(w, h, |im, x, y| im.pixels[ys[y] * im.width + xs[x]]);
        } else {
            for (vertical, target, scale) in [(true, h, sy), (false, w, sx)] {
                if scale >= 1. {
                    continue;
                }
                let size = if vertical { self.height } else { self.width };
                let mut shrink = 1. / scale;
                let mut extra = (target as f64).mul_add(shrink, -(size as f64));
                let integer = (size / target / 2).max(1);
                if integer > 1 {
                    let n = size.div_ceil(integer);
                    let (ow, oh) = if vertical {
                        (self.width, n)
                    } else {
                        (n, self.height)
                    };
                    self.remap(ow, oh, |im, x, y| {
                        let mut sums = [0u64; 4];
                        for k in 0..integer {
                            let p = if vertical {
                                im.at(x as isize, (y * integer + k) as isize)
                            } else {
                                im.at((x * integer + k) as isize, y as isize)
                            };
                            for (s, v) in sums.iter_mut().zip(p) {
                                *s += u64::from(v);
                            }
                        }
                        sums.map(|s| ((s + (integer / 2) as u64) / integer as u64) as u8)
                    });
                    shrink /= integer as f64;
                    extra /= integer as f64;
                }
                if shrink <= 1. {
                    continue;
                }
                let span = match kernel {
                    Kernel::Linear => 1.,
                    Kernel::Lanczos3 => 3.,
                    _ => 2.,
                };
                let taps = 2 * (span * shrink).round_ties_even() as usize + 1;
                let table: Vec<i32> = (0..65)
                    .flat_map(|phase| {
                        let origin = taps as f64 * 0.5 + phase as f64 / 64. - 1.;
                        let weights: Vec<_> = (0..taps)
                            .map(|i| kernel.weight((i as f64 - origin) / shrink))
                            .collect();
                        let sum: f64 = weights.iter().sum();
                        weights.into_iter().map(move |v| (v / sum * 4096.) as i32)
                    })
                    .collect();
                let mut pos = 0.5 * shrink - 0.5 - ((extra + 1.) * 0.5 - 1.);
                let coordinates: Vec<_> = (0..target)
                    .map(|_| {
                        let v = (pos as isize - (taps / 2) as isize, phase(pos) * taps);
                        pos += shrink;
                        v
                    })
                    .collect();
                let (ow, oh) = if vertical {
                    (self.width, target)
                } else {
                    (target, self.height)
                };
                self.remap(ow, oh, |im, x, y| {
                    let (start, off) = coordinates[if vertical { y } else { x }];
                    let mut sums = [2048; 4];
                    for (j, &wt) in table[off..off + taps].iter().enumerate() {
                        let coord = start + j as isize;
                        let p = if vertical {
                            im.at(x as isize, coord)
                        } else {
                            im.at(coord, y as isize)
                        };
                        for (s, v) in sums.iter_mut().zip(p) {
                            *s += i32::from(v) * wt;
                        }
                    }
                    sums.map(|v| (v >> 12).clamp(0, 255) as u8)
                });
            }
            if sx > 1. || sy > 1. {
                let (rx, ry) = (sx.max(1.), sy.max(1.));
                let inv = 1. / (rx * ry);
                let linear = kernel == Kernel::Linear;
                let offset = if linear { 0.5 } else { 1.5 };
                let mut dx = offset;
                self.remap(w, h, |im, x, y| {
                    if x == 0 {
                        dx = offset;
                    }
                    let dy = y as f64 * (rx * inv) + offset;
                    let (ix, iy) = (dx as isize, dy as isize);
                    let mut sum = [2048; 4];
                    if linear {
                        let sy = (dy.fract() * 4096.) as i32;
                        let sx = (dx.fract() * 4096.) as i32;
                        let c3 = (sy * sx) >> 12;
                        let c1 = ((4096 - sy) * sx) >> 12;
                        for (j, wt) in [4096 - sy - c1, c1, sy - c3, c3].into_iter().enumerate() {
                            for (s, v) in sum
                                .iter_mut()
                                .zip(im.at(ix - 1 + (j % 2) as isize, iy - 1 + (j / 2) as isize))
                            {
                                *s += i32::from(v) * wt;
                            }
                        }
                    } else {
                        let cx = cubic(phase(dx));
                        let cy = cubic(phase(dy));
                        for (j, wy) in cy.into_iter().enumerate() {
                            let mut row = [2048; 4];
                            for (i, wx) in cx.into_iter().enumerate() {
                                for (s, v) in row
                                    .iter_mut()
                                    .zip(im.at(ix - 3 + i as isize, iy - 3 + j as isize))
                                {
                                    *s += i32::from(v) * wx;
                                }
                            }
                            for (s, r) in sum.iter_mut().zip(row) {
                                *s += (r >> 12) * wy;
                            }
                        }
                    }
                    dx += ry * inv;
                    sum.map(|v| (v >> 12).clamp(0, 255) as u8)
                });
            }
        }
        if alpha {
            for p in &mut self.pixels {
                let f = if p[3] == 0 {
                    0.
                } else {
                    255. / f32::from(p[3])
                };
                for c in &mut p[..3] {
                    *c = (f32::from(*c) * f) as u8;
                }
            }
        }
        Ok(())
    }
}
