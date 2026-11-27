use super::{parse_float_prefix, png_pixels::Raster};

pub(super) enum Adjustment<'a> {
    AutoLevel(Option<[bool; 4]>),
    AutoGamma,
    Equalize(Option<[bool; 4]>),
    Stretch(&'a str),
}

fn stretch(table: &mut [u8; 256], low: usize, high: usize) {
    if high > low {
        for (i, value) in table.iter_mut().enumerate() {
            *value = ((i as f64 - low as f64) / (high - low) as f64 * 255.).round() as u8;
        }
    }
}

impl Adjustment<'_> {
    pub fn apply(&self, image: &mut Raster) {
        let mut hist = [[0usize; 256]; 4];
        for pixel in &image.pixels {
            for (channel, value) in hist.iter_mut().zip(pixel) {
                channel[usize::from(*value)] += 1;
            }
        }
        let mut tables = [std::array::from_fn(|i| i as u8); 4];
        let count = image.pixels.len();
        match self {
            Self::AutoLevel(mask) => {
                let lows = hist
                    .each_ref()
                    .map(|h| h.iter().position(|&n| n != 0).unwrap_or(255));
                let highs = hist
                    .each_ref()
                    .map(|h| h.iter().rposition(|&n| n != 0).unwrap_or(0));
                if let Some(active) = mask {
                    for c in 0..4 {
                        if active[c] {
                            stretch(&mut tables[c], lows[c], highs[c]);
                        }
                    }
                } else {
                    let low = lows[0].min(lows[1]).min(lows[2]);
                    let high = highs[0].max(highs[1]).max(highs[2]);
                    for table in &mut tables[..3] {
                        stretch(table, low, high);
                    }
                }
            }
            Self::AutoGamma => {
                let channels = if image.alpha { 4 } else { 3 };
                let total: u64 = hist[..channels]
                    .iter()
                    .flat_map(|h| h.iter().enumerate())
                    .map(|(value, &n)| value as u64 * n as u64)
                    .sum();
                let mean = total as f64 / (count as f64 * channels as f64 * 255.);
                if mean > 0. && mean < 1. {
                    let exponent = 0.5_f64.ln() / mean.ln();
                    tables[..channels].fill(std::array::from_fn(|i| {
                        ((i as f64 / 255.).powf(exponent) * 255.).round() as u8
                    }));
                }
            }
            Self::Equalize(mask) => {
                // Default equalization shares a Q16 intensity histogram across channels.
                let intensity_hist = mask.is_none().then(|| {
                    let mut bins = vec![0usize; 65536];
                    for pixel in &image.pixels {
                        let value = (super::magick_color::intensity(pixel) * 257.).round() as usize;
                        bins[value.min(65535)] += 1;
                    }
                    bins
                });
                let active = mask.unwrap_or([true, true, true, image.alpha]);
                let scale = if intensity_hist.is_some() { 257 } else { 1 };
                for (c, table) in tables.iter_mut().enumerate() {
                    if !active[c] {
                        continue;
                    }
                    let h = intensity_hist.as_deref().unwrap_or(&hist[c]);
                    // Subtract the zero bin, not the first occupied bin.
                    let black = h[0];
                    if count == black {
                        continue;
                    }
                    let mut sum = 0;
                    let mut bin = 0;
                    for (value, mapped) in table.iter_mut().enumerate() {
                        while bin <= value * scale {
                            sum += h[bin];
                            bin += 1;
                        }
                        *mapped =
                            ((sum - black) as f64 / (count - black) as f64 * 255.).round() as u8;
                    }
                }
            }
            Self::Stretch(spec) => {
                let mut parts = spec.split('x');
                let number = |s: &str| {
                    let n = parse_float_prefix(s);
                    if n.is_nan() { 0. } else { n }
                };
                let black = number(parts.next().unwrap_or(""));
                let white = parts.next().map_or(black, number);
                let (low_target, high_target) = if spec.contains('%') {
                    (
                        black / 100. * count as f64,
                        (100. - white) / 100. * count as f64,
                    )
                } else {
                    (black, count as f64 - white)
                };
                for (h, table) in hist.iter().zip(&mut tables[..3]) {
                    let mut sum = 0;
                    let mut low = None;
                    let mut high = None;
                    for (v, n) in h.iter().enumerate() {
                        sum += n;
                        if low.is_none() && sum as f64 > low_target {
                            low = Some(v);
                        }
                        if high.is_none() && sum as f64 >= high_target {
                            high = Some(v);
                        }
                    }
                    stretch(table, low.unwrap_or(0), high.unwrap_or(255));
                }
            }
        }
        for pixel in &mut image.pixels {
            for (value, table) in pixel.iter_mut().zip(&tables) {
                *value = table[usize::from(*value)];
            }
        }
    }
}
