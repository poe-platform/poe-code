use super::{js_number, png_pixels::Raster};

pub(super) fn radii(spec: &str) -> (usize, usize) {
    let size = spec.split_once(':').map_or(spec, |(_, v)| v);
    if size.contains('x') {
        let mut dims = size.split('x').map(|s| {
            let n = js_number(s, 0.);
            ((if n == 0. || n.is_nan() { 3. } else { n }) / 2.)
                .floor()
                .max(1.) as usize
        });
        return (dims.next().unwrap(), dims.next().unwrap());
    }
    let r = js_number(size, 1.).round().max(1.) as usize;
    (r, r)
}

// Count repeated edge pixels without iterating outside the image.
fn span(center: usize, radius: usize, last: usize) -> impl Iterator<Item = (usize, u64)> {
    (center.saturating_sub(radius)..=center.saturating_add(radius).min(last)).map(move |v| {
        let left = if v == 0 {
            radius.saturating_sub(center)
        } else {
            0
        };
        let right = if v == last {
            radius.saturating_sub(last - center)
        } else {
            0
        };
        (v, 1 + left as u64 + right as u64)
    })
}

#[derive(Clone, Copy)]
enum Rank {
    Min,
    Max,
    Median,
}

fn neighborhood(
    source: &[[u8; 4]],
    w: usize,
    (rx, ry): (usize, usize),
    mode: Rank,
    limit: usize,
) -> Result<Vec<[u8; 4]>, &'static str> {
    let h = source.len() / w;
    let (rx, ry) = if matches!(mode, Rank::Median) {
        (rx, ry)
    } else {
        (rx.min(w), ry.min(h))
    };
    let side = |r: usize| (r as u64).checked_mul(2)?.checked_add(1);
    let area = side(rx)
        .and_then(|x| side(ry)?.checked_mul(x))
        .ok_or("image exceeds work budget")?;
    if source
        .len()
        .saturating_mul(ry.saturating_mul(2).saturating_add(1).min(h))
        > limit.saturating_mul(64)
    {
        return Err("image exceeds work budget");
    }
    let rank = match mode {
        Rank::Min => 0,
        Rank::Max => area - 1,
        Rank::Median => area / 2,
    };
    let mut output = Vec::with_capacity(source.len());
    for y in 0..h {
        let mut hist = [[0u64; 256]; 4];
        for (sy, rows) in span(y, ry, h - 1) {
            for (sx, cols) in span(0, rx, w - 1) {
                let p = source[sy * w + sx];
                for c in 0..4 {
                    hist[c][usize::from(p[c])] += rows * cols;
                }
            }
        }
        for x in 0..w {
            output.push(std::array::from_fn(|c| {
                let mut n = 0;
                hist[c]
                    .iter()
                    .position(|v| {
                        n += v;
                        n > rank
                    })
                    .unwrap_or(255) as u8
            }));
            if x + 1 == w {
                break;
            }
            let leaving = x.saturating_sub(rx);
            let entering = (x + 1).saturating_add(rx).min(w - 1);
            for (sy, count) in span(y, ry, h - 1) {
                let a = source[sy * w + leaving];
                let b = source[sy * w + entering];
                for c in 0..4 {
                    hist[c][usize::from(a[c])] -= count;
                    hist[c][usize::from(b[c])] += count;
                }
            }
        }
    }
    Ok(output)
}

impl Raster {
    pub(super) fn trim(&mut self, fuzz: f64, limit: usize) -> Result<(), &'static str> {
        let filtered;
        let detection = if self.width < 3 || self.height < 3 {
            &self.pixels
        } else {
            filtered = neighborhood(&self.pixels, self.width, (1, 1), Rank::Median, limit)?;
            &filtered
        };
        let premul = |[r, g, b, a]: [u8; 4]| {
            let f = f64::from(a) / 255.;
            [
                f * f64::from(r),
                f * f64::from(g),
                f * f64::from(b),
                f64::from(a),
            ]
        };
        let bg = premul(detection[0]);
        let (mut x0, mut y0, mut x1, mut y1) = (self.width, self.height, 0, 0);
        for (i, &p) in detection.iter().enumerate() {
            if !premul(p)
                .into_iter()
                .zip(bg)
                .all(|(a, b)| (a - b).abs() <= fuzz)
            {
                let (x, y) = (i % self.width, i / self.width);
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
            }
        }
        if x1 > x0 && (x1 - x0, y1 - y0) != (self.width, self.height) {
            self.remap(x1 - x0, y1 - y0, |im, x, y| {
                im.pixels[(y0 + y) * im.width + x0 + x]
            });
        }
        Ok(())
    }

    pub(super) fn morphology(
        &mut self,
        method: &str,
        (rx, ry): (usize, usize),
        limit: usize,
    ) -> Result<(), &'static str> {
        let filter =
            |source: &[[u8; 4]], mode| neighborhood(source, self.width, (rx, ry), mode, limit);
        let subtract = |a: &mut [[u8; 4]], b: &[[u8; 4]], reverse: bool| {
            for (a, b) in a.iter_mut().zip(b) {
                for c in 0..4 {
                    a[c] = if reverse {
                        b[c].saturating_sub(a[c])
                    } else {
                        a[c].saturating_sub(b[c])
                    };
                }
            }
        };
        let first = match method {
            "erode" | "minimum" | "open" | "edgein" | "tophat" => Rank::Min,
            "median" => Rank::Median,
            _ => Rank::Max,
        };
        let mut out = filter(&self.pixels, first)?;
        match method {
            "open" | "tophat" => out = filter(&out, Rank::Max)?,
            "close" | "bottomhat" => out = filter(&out, Rank::Min)?,
            "edge" | "gradient" => subtract(&mut out, &filter(&self.pixels, Rank::Min)?, false),
            _ => {}
        }
        match method {
            "edgein" | "tophat" => subtract(&mut out, &self.pixels, true),
            "edgeout" | "bottomhat" => subtract(&mut out, &self.pixels, false),
            _ => {}
        }
        self.pixels = out;
        Ok(())
    }
}
