use super::{magick_resize::Kernel, png_pixels::Raster};

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
    pub fn apply(&self, im: &mut Raster, limit: usize) -> Result<(), &'static str> {
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
            "format" if self.raw.contains("gray") => {
                for p in &mut im.pixels {
                    let g = super::magick_color::gray(p[0], p[1], p[2]);
                    p[..3].fill(g);
                }
            }
            "transpose" | "rotate" => im.remap(ih, iw, |im, x, y| {
                if self.name == "transpose" && self.param(&["dir"], 0) == Some("2") {
                    im.pixels[x * iw + iw - 1 - y]
                } else {
                    im.pixels[(ih - 1 - x) * iw + y]
                }
            }),
            "crop" if iw==0 || ih==0 => return Err("extract_area: bad extract area"),
            "crop" => {
                let w = dim(&["w"], 0, iw).clamp(1, iw as i32) as usize;
                let h = dim(&["h"], 1, ih).clamp(1, ih as i32) as usize;
                let x = num(&["x"], 2, (iw - w) as i64 / 2).clamp(0, (iw - w) as i64) as usize;
                let y = num(&["y"], 3, (ih - h) as i64 / 2).clamp(0, (ih - h) as i64) as usize;
                im.remap(w, h, |im, dx, dy| im.pixels[(y + dy) * iw + x + dx]);
            }
            "pad" => {
                let w = dim(&["w", "width"], 0, iw).max(iw as i32) as usize;
                let h = dim(&["h", "height"], 1, ih).max(ih as i32) as usize;
                if w.saturating_mul(h) > limit / 4 {
                    return Err("image exceeds memory budget");
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
            "scale" if iw==0 || ih==0 => return Err("offset is out of bounds"),
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
                im.resize(
                    &format!("{}x{}!", dw.max(2), dh.max(2)),
                    Kernel::Lanczos3,
                    limit,
                )?;
            }
            _ => {}
        }
        Ok(())
    }
}
