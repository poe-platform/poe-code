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
