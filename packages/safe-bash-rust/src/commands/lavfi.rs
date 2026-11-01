use super::{png_pixels::Raster, y4m};

pub(super) struct Video {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pattern: Pattern,
}
enum Pattern {
    Color([u8; 3]),
    Test,
    Bars,
}

pub(super) fn color_rgb(name: &str) -> [u8; 3] {
    match name.trim().to_ascii_lowercase().as_str() {
        other @ ("black" | "white" | "red" | "green" | "lime" | "blue" | "yellow" | "cyan"
        | "magenta" | "gray" | "grey" | "orange" | "purple") => {
            let [r, g, b, _] = super::css_named_color(other).unwrap();
            [r, g, b]
        }
        other => other
            .strip_prefix('#')
            .or_else(|| other.strip_prefix("0x"))
            .filter(|hex| hex.len() == 6 && hex.is_ascii())
            .map(|hex| {
                std::array::from_fn(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0))
            })
            .unwrap_or([40, 120, 220]),
    }
}

impl Video {
    pub fn parse(spec: &str) -> Option<Self> {
        let (name, params) = spec.split_once('=').unwrap_or((spec, ""));
        let name = name.trim();
        if !matches!(name, "color" | "smptebars" | "testsrc" | "testsrc2") {
            return None;
        }
        let mut width = 320;
        let mut height = 240;
        let mut fps = 25.;
        let mut duration = 1.;
        let params: std::collections::BTreeMap<_, _> = params
            .split(':')
            .map(|s| {
                let (k, v) = s.split_once('=').unwrap_or(("_0", s));
                (k.trim().to_ascii_lowercase(), v.trim())
            })
            .collect();
        if let Some((w, h)) = params
            .get("size")
            .or(params.get("s"))
            .and_then(|s| s.split_once('x'))
        {
            width = w.parse().ok().filter(|v| *v != 0).unwrap_or(width);
            height = h.parse().ok().filter(|v| *v != 0).unwrap_or(height);
        }
        if let Some(v) = params
            .get("rate")
            .or(params.get("r"))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.)
        {
            fps = v;
        }
        if let Some(v) = params
            .get("duration")
            .or(params.get("d"))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v != 0.)
        {
            duration = v;
        }
        let pattern = match name {
            "smptebars" => Pattern::Bars,
            "testsrc" | "testsrc2" => Pattern::Test,
            "color" => {
                let color = params
                    .get("color")
                    .or(params.get("c"))
                    .or(params.get("_0"))
                    .copied()
                    .filter(|v| !v.is_empty())
                    .unwrap_or("blue");
                Pattern::Color(color_rgb(color))
            }
            _ => return None,
        };
        Some(Self {
            width,
            height,
            duration,
            fps,
            pattern,
        })
    }

    fn image(&self, idx: usize) -> Raster {
        let (w, h) = (self.width as usize, self.height as usize);
        let pixels = match self.pattern {
            Pattern::Color([r, g, b]) => vec![[r, g, b, 255]; w * h],
            _ => {
                let mut pixels = Vec::with_capacity(w * h);
                for y in 0..h {
                    for x in 0..w {
                        let col = x * 7 / w;
                        let [r, g, b] = match self.pattern {
                            Pattern::Test => {
                                let rgb = [
                                    [255, 255, 255],
                                    [255, 255, 0],
                                    [0, 255, 255],
                                    [0, 255, 0],
                                    [255, 0, 255],
                                    [255, 0, 0],
                                    [0, 0, 255],
                                ][col];
                                let scan = idx * 16 % h.max(16);
                                if y >= scan && y < scan + 16 {
                                    rgb.map(|v| v ^ 128)
                                } else {
                                    rgb
                                }
                            }
                            Pattern::Bars if y * 3 < h * 2 => [
                                [191, 191, 191],
                                [191, 191, 0],
                                [0, 191, 191],
                                [0, 191, 0],
                                [191, 0, 191],
                                [191, 0, 0],
                                [0, 0, 191],
                            ][col],
                            Pattern::Bars if y * 4 < h * 3 => [
                                [0, 0, 191],
                                [19; 3],
                                [191, 0, 191],
                                [19; 3],
                                [0, 191, 191],
                                [19; 3],
                                [191; 3],
                            ][col],
                            Pattern::Bars => {
                                let col = if x * 7 < w * 5 {
                                    x * 28 / (w * 5)
                                } else if x * 7 < w * 6 {
                                    4 + (x * 7 - w * 5) * 3 / w
                                } else {
                                    7
                                };
                                [
                                    [0, 33, 76],
                                    [255; 3],
                                    [50, 0, 106],
                                    [19; 3],
                                    [9; 3],
                                    [19; 3],
                                    [29; 3],
                                    [19; 3],
                                ][col]
                            }
                            Pattern::Color(_) => unreachable!(),
                        };
                        pixels.push([r, g, b, 255]);
                    }
                }
                pixels
            }
        };
        Raster {
            width: w,
            height: h,
            alpha: false,
            gray: false,
            density: 72,
            pixels,
        }
    }

    pub fn encode(&self, opts: y4m::Options<'_>, sliced: bool) -> Result<Vec<u8>, &'static str> {
        let (w, h) = (self.width as usize, self.height as usize);
        let count = (opts.end.unwrap_or(self.duration) * self.fps)
            .round()
            .max(1.) as usize;
        if count > opts.limit / size_of::<usize>() {
            return Err("frame index exceeds memory budget");
        }
        let mut fps = self.fps;
        let first = (opts.start * fps).floor() as usize;
        let last = opts
            .end
            .map_or(count, |s| (s * fps).ceil() as usize)
            .min(count);
        let n = last.saturating_sub(first);
        if sliced && n > 0 {
            let end = opts
                .end
                .unwrap_or(count as f64 / fps)
                .min(count as f64 / fps);
            fps = if opts.filters.is_empty() {
                n as f64 / (end - opts.start)
            } else {
                1. / (end - first as f64 / fps).min(1. / fps)
            };
        }
        let limit = opts.limit;
        let has_filters = !opts.filters.is_empty();
        y4m::encode(
            w,
            h,
            (0..n).map(|i| (i as f64 / fps, 1. / fps)),
            y4m::Options {
                start: 0.,
                end: None,
                ..opts
            },
            |i| {
                let im = self.image(first + i);
                if sliced {
                    y4m::materialized(im, has_filters, limit)
                } else {
                    Ok(im)
                }
            },
        )
    }
}
