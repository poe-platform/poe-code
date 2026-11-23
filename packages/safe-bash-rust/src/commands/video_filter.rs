use super::png_pixels::Raster;

pub(super) struct Filter<'a> {
    name: &'a str,
    raw: &'a str,
    args: Vec<&'a str>,
}

impl<'a> Filter<'a> {
    pub fn new(name: &'a str, raw: &'a str) -> Self {
        Self {
            name,
            raw,
            args: raw.split(':').collect(),
        }
    }
    fn param(&self, keys: &[&str], pos: usize) -> Option<&'a str> {
        keys.iter()
            .find_map(|key| {
                self.args
                    .iter()
                    .rev()
                    .filter_map(|a| a.split_once('='))
                    .find(|(k, _)| k.trim().eq_ignore_ascii_case(key))
                    .map(|(_, v)| v.trim())
            })
            .or_else(|| self.args.get(pos).map(|s| s.trim()))
    }
    pub fn apply(&self, im: &mut Raster, limit: usize) -> Result<(), String> {
        let (iw, ih) = (im.width, im.height);
        let dim = |keys: &[&str], pos, base: usize| {
            self.param(keys, pos)
                .and_then(|s| super::eval_dim_expr(s, iw as u32, ih as u32))
                .unwrap_or(base as i32)
        };
        let num = |keys: &[&str], pos, default| {
            self.param(keys, pos)
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(default)
        };
        let color =
            |default| super::lavfi::color_rgb(self.param(&["color", "c"], 4).unwrap_or(default));
        match self.name {
            "hflip" => im.pixels.chunks_exact_mut(iw.max(1)).for_each(|row| row.reverse()),
            "vflip" => im.remap(iw, ih, |im, x, y| im.pixels[(ih - 1 - y) * iw + x]),
            "negate" => im
                .pixels
                .iter_mut()
                .for_each(|p| p[..3].iter_mut().for_each(|v| *v = 255 - *v)),
            "format" if self.param(&["pix_fmts"], 0).is_some_and(|s| s.split('|').all(|f| matches!(f, "rgb24" | "rgba"))) => {
                let formats = self.param(&["pix_fmts"], 0).unwrap();
                let current = if im.alpha { "rgba" } else { "rgb24" };
                let selected = if formats.split('|').any(|f| f == current) {
                    current
                } else {
                    formats.split('|').next().unwrap()
                };
                im.alpha = selected == "rgba";
                im.gray = false;
                if !im.alpha {
                    for p in &mut im.pixels { p[3] = 255; }
                }
            }
            "format" if self.raw.contains("gray") => {
                for p in &mut im.pixels {
                    let [r, g, b, _] = p.map(i32::from);
                    // FFmpeg first rounds BT.601 luma to six fractional bits,
                    // then expands the limited range before rounding to gray8.
                    let limited = (8414*r + 16519*g + 3208*b + (16<<15) + 256) >> 9;
                    let full = (limited*2*19078 - 39084288) >> 14;
                    let g = ((full + 64) >> 7).clamp(0, 255) as u8;
                    p[..3].fill(g);
                    p[3] = 255;
                }
                im.alpha = false;
                im.gray = true;
            }
            "transpose" | "rotate" => im.remap(ih, iw, |im, x, y| {
                if self.name == "transpose" && self.param(&["dir"], 0) == Some("2") {
                    im.pixels[x * iw + iw - 1 - y]
                } else {
                    im.pixels[(ih - 1 - x) * iw + y]
                }
            }),
            "crop" => {
                let w = dim(&["w"], 0, iw).max(1).min(iw as i32) as usize;
                let h = dim(&["h"], 1, ih).max(1).min(ih as i32) as usize;
                let x = num(&["x"], 2, (iw - w) as i64 / 2).clamp(0, (iw - w) as i64) as usize;
                let y = num(&["y"], 3, (ih - h) as i64 / 2).clamp(0, (ih - h) as i64) as usize;
                if w == 0 || h == 0 {
                    return Err(format!("extract_area: bad extract area (left={x}, top={y}, width={w}, height={h} on {iw}x{ih})"));
                }
                im.remap(w, h, |im, dx, dy| im.pixels[(y + dy) * iw + x + dx]);
            }
            "pad" => {
                let w = dim(&["w", "width"], 0, iw).max(iw as i32) as usize;
                let h = dim(&["h", "height"], 1, ih).max(ih as i32) as usize;
                if w.saturating_mul(h) > limit / 4 {
                    return Err("image exceeds memory budget".into());
                }
                let x = num(&["x"], 2, 0).clamp(0, (w - iw) as i64) as usize;
                let y = num(&["y"], 3, 0).clamp(0, (h - ih) as i64) as usize;
                let [r, g, b] = color("black");
                im.remap(w, h, |im, dx, dy| {
                    if (x..x + iw).contains(&dx) && (y..y + ih).contains(&dy) {
                        im.pixels[(dy - y) * iw + dx - x]
                    } else {
                        [r, g, b, 255]
                    }
                });
            }
            "drawbox" => {
                let x = num(&["x"], 0, 0);
                let y = num(&["y"], 1, 0);
                let w = num(&["w", "width"], 2, 16);
                let h = num(&["h", "height"], 3, 16);
                let [r, g, b] = color("red");
                let left = x.clamp(0, iw as i64) as usize;
                let right = x
                    .saturating_add(if w == 0 { 16 } else { w })
                    .clamp(0, iw as i64) as usize;
                let bottom = y
                    .saturating_add(if h == 0 { 16 } else { h })
                    .clamp(0, ih as i64) as usize;
                if right > left {
                    for row in y.max(0) as usize..bottom {
                        im.pixels[row * iw + left..row * iw + right].fill([r, g, b, 255]);
                    }
                }
            }
            "scale" if iw==0 || ih==0 => return Err("offset is out of bounds".into()),
            "scale" => {
                let (mut dw, mut dh) = (dim(&["w", "width"], 0, iw), dim(&["h", "height"], 1, ih));
                let auto = |d: i32, other: i32, n: usize, m: usize| {
                    let v = (other as f64 * n as f64 / m as f64).round().max(2.) as i32;
                    if d == -2 { v.saturating_add(v % 2) } else { v }
                };
                if dw < 0 && dh > 0 {
                    dw = auto(dw, dh, iw, ih);
                } else if dh < 0 && dw > 0 {
                    dh = auto(dh, dw, ih, iw);
                }
                if !im.alpha {
                    im.resize(&format!("{}x{}!", dw.max(2), dh.max(2)), super::magick_resize::Kernel::Lanczos3, limit)?;
                    return Ok(());
                }
                let (width, height) = (dw.max(2) as usize, dh.max(2) as usize);
                let size = width.checked_mul(height).filter(|&n| n <= limit / 4).ok_or("image exceeds memory budget")?;
                let tap_count = |source: usize, target: usize| if source == target { 1 } else { source.saturating_sub(2).min(1 + (4. * (source as f64 / target as f64).max(1.)).ceil() as usize).max(1) };
                let weights = |source: usize, target: usize| {
                    let step = (source as f64 * 65536. / target as f64).round();
                    let taps = tap_count(source, target);
                    (0..target).map(|destination| {
                        let center = (destination as f64 + 0.5) * step / 65536. - 0.5;
                        let start = (center - (taps as f64 - 2.) / 2.).trunc() as i64;
                        let mut row = (0..taps).map(|tap| {
                            let distance = (start as f64 + tap as f64 - center).abs() * (target as f64 / source as f64).min(1.);
                            let weight = if distance < 1. { 1. + distance * distance * (1.4 * distance - 2.4) } else if distance < 2. { 0.6 * (4. + distance * (-8. + distance * (5. - distance))) } else { 0. };
                            ((start + tap as i64).clamp(0, source as i64 - 1) as usize, weight)
                        }).collect::<Vec<_>>();
                        let sum = row.iter().map(|t| t.1).sum::<f64>();
                        for tap in &mut row { tap.1 /= sum; }
                        row
                    }).collect::<Vec<_>>()
                };
                let horizontal_size = width.saturating_mul(tap_count(iw, width));
                let vertical_size = height.saturating_mul(tap_count(ih, height));
                let allocation = horizontal_size.saturating_add(vertical_size).saturating_mul(size_of::<(usize, f64)>()).saturating_add(width.saturating_add(height).saturating_mul(size_of::<Vec<(usize, f64)>>())).saturating_add(size.saturating_mul(4));
                if allocation > limit { return Err("image exceeds memory budget".into()); }
                if horizontal_size.saturating_mul(vertical_size) > limit.saturating_mul(32) { return Err("image scaling work limit exceeded".into()); }
                let horizontal = weights(iw, width);
                let vertical = weights(ih, height);
                let mut pixels = Vec::with_capacity(size);
                for row in &vertical {
                    for column in &horizontal {
                        let mut pixel = [0.; 4];
                        for &(y, wy) in row {
                            for &(x, wx) in column {
                                for (out, &value) in pixel.iter_mut().zip(&im.pixels[y * iw + x]) { *out += f64::from(value) * (wy * wx); }
                            }
                        }
                        pixels.push(pixel.map(|v| v.round().clamp(0., 255.) as u8));
                    }
                }
                im.pixels = pixels; im.width = width; im.height = height;
            }
            _ => {}
        }
        Ok(())
    }
}
