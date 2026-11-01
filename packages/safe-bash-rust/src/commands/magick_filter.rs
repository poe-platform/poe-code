use super::png_pixels::Raster;

// The symmetric integer kernel is constant between changes in weight. Sliding it
// one pixel adds and removes only the two endpoints of each such box, even when
// sigma is much larger than the image.
fn convolve<const C: usize>(
    width: usize,
    height: usize,
    vertical: bool,
    weights: &[i32],
    read: impl Fn(usize) -> [i32; C],
    mut write: impl FnMut(usize, [i64; C]),
) {
    let (len, lines, stride) = if vertical {
        (height, width, width)
    } else {
        (width, height, 1)
    };
    let changes: Vec<_> = weights
        .iter()
        .enumerate()
        .filter_map(|(r, &w)| {
            let delta = w - weights.get(r + 1).copied().unwrap_or(0);
            (delta != 0).then_some((r, i64::from(delta)))
        })
        .collect();
    let half_sum = weights.iter().sum::<i32>();
    let tail = weights.get(len..).unwrap_or_default().iter().sum::<i32>();
    for line in 0..lines {
        let first = if vertical { line } else { line * width };
        let mut sum = read(first).map(|v| i64::from(v) * i64::from(half_sum));
        let last = read(first + (len - 1) * stride);
        for c in 0..C {
            sum[c] += i64::from(tail) * i64::from(last[c]);
        }
        for (k, &w) in weights.iter().enumerate().take(len).skip(1) {
            let p = read(first + k * stride);
            for c in 0..C {
                sum[c] += i64::from(w) * i64::from(p[c]);
            }
        }
        for x in 0..len {
            write(first + x * stride, sum);
            if x + 1 == len {
                break;
            }
            for &(r, delta) in &changes {
                let left = read(first + x.saturating_sub(r) * stride);
                let right = read(first + (x + 1 + r).min(len - 1) * stride);
                for c in 0..C {
                    sum[c] += delta * i64::from(right[c] - left[c]);
                }
            }
        }
    }
}

impl Raster {
    pub(super) fn blur(&mut self, sigma: f64, alpha: bool) {
        let exp = |i: i32| (-f64::from(i * i) / (2. * sigma * sigma)).exp();
        let mut weights: Vec<i32> = (0..5000)
            .take_while(|&i| exp(i) >= 0.2)
            .map(|i| (20. * exp(i)).round() as i32)
            .collect();
        if weights.len() <= 1 {
            return;
        }
        let total = (2 * weights.iter().sum::<i32>() - weights[0]) as f64;
        let shift = 7 - ((20. / total).log2() + 1.).ceil() as i32;
        let scale = 1 << shift;
        for w in &mut weights {
            *w = (f64::from(*w) / total * f64::from(scale)).round() as i32;
        }
        let mut temp = vec![[0u8; 4]; self.pixels.len()];
        if alpha {
            for p in &mut self.pixels {
                let f = f32::from(p[3]) / 255.;
                for c in &mut p[..3] {
                    *c = (f32::from(*c) * f) as u8;
                }
            }
        }
        for vertical in [false, true] {
            convolve(
                self.width,
                self.height,
                vertical,
                &weights,
                |i| self.pixels[i].map(i32::from),
                |i, sum| {
                    let mut p =
                        sum.map(|n| ((n + i64::from(scale / 2)) >> shift).clamp(0, 255) as u8);
                    if !alpha {
                        p[3] = 255;
                    }
                    temp[i] = p;
                },
            );
            std::mem::swap(&mut self.pixels, &mut temp);
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
    }
}

fn short_lab([r, g, b, a]: [u8; 4], alpha: bool) -> [i16; 3] {
    let f = f32::from(a) / 255.;
    let [r, g, b] = [r, g, b]
        .map(|c| super::magick_color::linear(if alpha { (f32::from(c) * f) as u8 } else { c }));
    let curve = |v: f64| {
        if v > 0.008856 {
            v.cbrt()
        } else {
            7.787 * v + 16. / 116.
        }
    };
    let x = curve((41.24 * r + 35.76 * g + 18.05 * b) / 95.047);
    let y = curve((21.26 * r + 71.52 * g + 7.22 * b) / 100.);
    let z = curve((1.93 * r + 11.92 * g + 95.05 * b) / 108.883);
    [
        (f64::from((116. * y - 16.) as f32) * 327.67) as i16,
        (f64::from((500. * (x - y)) as f32) * 256.) as i16,
        (f64::from((200. * (y - z)) as f32) * 256.) as i16,
    ]
}

fn lab_rgb(l: f64, a: f64, b: f64) -> [u8; 3] {
    let fy = (l + 16.) / 116.;
    let inv = |v: f64| {
        if v > 24. / 116. {
            v * v * v
        } else {
            (v - 16. / 116.) / 7.787
        }
    };
    let x = inv(fy + a / 500.) * 0.95047;
    let y = inv(fy);
    let z = inv(fy - b / 200.) * 1.08883;
    [
        3.2406 * x - 1.5372 * y - 0.4986 * z,
        -0.9689 * x + 1.8758 * y + 0.0415 * z,
        0.0557 * x - 0.204 * y + 1.057 * z,
    ]
    .map(super::magick_color::srgb_byte)
}

impl Raster {
    pub(super) fn sharpen(&mut self, sigma: f64, alpha: bool) {
        let sig2 = 2. * sigma * sigma;
        let radius = (-sig2 * 0.1f64.ln()).sqrt().floor().clamp(1., 5000.) as i32;
        let weights: Vec<_> = (0..=radius)
            .map(|i| (20. * (-f64::from(i * i) / sig2).exp()).round_ties_even() as i32)
            .collect();
        let scale = i64::from(2 * weights.iter().sum::<i32>() - weights[0]);
        let rounded = |n: i64| (n + scale / 2).div_euclid(scale) as i16;
        let light: Vec<_> = self
            .pixels
            .iter()
            .map(|&p| short_lab(p, alpha)[0])
            .collect();
        let mut horizontal = vec![0i16; light.len()];
        convolve(
            self.width,
            self.height,
            false,
            &weights,
            |i| [i32::from(light[i])],
            |i, [sum]| horizontal[i] = rounded(sum),
        );
        convolve(
            self.width,
            self.height,
            true,
            &weights,
            |i| [i32::from(horizontal[i])],
            |i, [sum]| {
                let delta = (f64::from(light[i]) - f64::from(rounded(sum))) / 327.67;
                let boost = if delta < -2. {
                    2. * (delta + 2.) - 2.
                } else if delta < 2. {
                    delta
                } else {
                    2. * (delta - 2.) + 2.
                };
                let l = (f64::from(light[i]) + (boost.clamp(-20., 10.) * 327.67).round_ties_even())
                    .clamp(0., 32767.);
                let p = &mut self.pixels[i];
                let [_, a, b] = short_lab(*p, alpha);
                let rgb = lab_rgb(l / 327.67, f64::from(a) / 256., f64::from(b) / 256.);
                let f = if p[3] == 0 {
                    0.
                } else {
                    255. / f32::from(p[3])
                };
                p[..3].copy_from_slice(
                    &rgb.map(|c| if alpha { (f32::from(c) * f) as u8 } else { c }),
                );
            },
        );
    }
}

pub(super) fn kernel(spec: &str, limit: usize) -> Result<Vec<f64>, &'static str> {
    let spec = spec.split_once(':').map_or(spec, |(_, s)| s);
    let mut weights = Vec::new();
    for word in spec
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
    {
        let value = super::magick_number(word, f64::NAN);
        if value.is_finite() {
            if weights.len() >= limit / size_of::<f64>() {
                return Err("image exceeds memory budget");
            }
            weights.push(value);
        }
    }
    Ok(weights)
}

impl Raster {
    pub(super) fn convolve_rgb(
        &mut self,
        weights: &[f64],
        bias: f64,
        limit: usize,
    ) -> Result<(), &'static str> {
        if weights.is_empty() {
            return Ok(());
        }
        let side = (weights.len() as f64).sqrt().round() as usize;
        if self.pixels.len().saturating_mul(side * side) > limit.saturating_mul(64) {
            return Err("image exceeds work budget");
        }
        self.remap(self.width, self.height, |im, x, y| {
            let mut sum = [bias; 3];
            for (ky, row) in weights.chunks(side).take(side).enumerate() {
                let sy = (y + ky).saturating_sub(side / 2).min(im.height - 1);
                for (kx, &w) in row.iter().enumerate() {
                    let sx = (x + kx).saturating_sub(side / 2).min(im.width - 1);
                    let p = im.pixels[sy * im.width + sx];
                    for c in 0..3 {
                        sum[c] += w * f64::from(p[c]);
                    }
                }
            }
            let [r, g, b] = sum.map(|v| if v.is_finite() { v.round() as u8 } else { 0 });
            [r, g, b, im.pixels[y * im.width + x][3]]
        });
        Ok(())
    }
}
