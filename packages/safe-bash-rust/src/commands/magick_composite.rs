use super::{BuiltinOutcome, SafeBashFs, err_out, png_pixels::Raster, resolve_posix_path};

pub(super) fn blend(s: [u8; 4], mut d: [u8; 4], mode: &str, ws: f64, wd: f64) -> [u8; 4] {
    let sa = f64::from(s[3]) / 255.;
    let da = f64::from(d[3]) / 255.;
    let (mut u, mut v, mut divide, mut alpha) = (sa, da * (1. - sa), true, sa + da * (1. - sa));
    match mode {
        "src" | "source" | "copy" => return s,
        "dst" | "dest" => return d,
        "clear" => return [0; 4],
        "copyopacity" | "copyalpha" | "copyred" | "copygreen" | "copyblue" => {
            let c = match mode {
                "copyred" => 0,
                "copygreen" => 1,
                "copyblue" => 2,
                _ => 3,
            };
            d[c] = s[c];
            return d;
        }
        "difference" => return std::array::from_fn(|i| s[i].abs_diff(d[i])),
        "blend" => {
            return std::array::from_fn(|i| {
                (f64::from(s[i]) * ws + f64::from(d[i]) * wd).round() as u8
            });
        }
        "over" => {
            if s[3] == 255 {
                return s;
            }
            if s[3] == 0 {
                return d;
            }
        }
        "dissolve" => {
            u = sa * ws.min(1.);
            v = da * wd.min(1.) * (1. - u);
            alpha = u + v;
            if alpha <= 1e-6 {
                return [0; 4];
            }
        }
        "in" | "srcin" => {
            u = sa * da;
            v = 0.;
            alpha = u;
            divide = false;
        }
        "out" | "srcout" => {
            u = sa * (1. - da);
            v = 0.;
            alpha = u;
            divide = false;
        }
        "dstin" | "destin" => {
            d[3] = (sa * da * 255.).round() as u8;
            return d;
        }
        "dstout" | "destout" => {
            d[3] = (da * (1. - sa) * 255.).round() as u8;
            return d;
        }
        "atop" | "srcatop" => {
            u = sa * da;
            alpha = da;
            divide = false;
        }
        "dstatop" | "destatop" => {
            u = sa * (1. - da);
            v = da * sa;
            alpha = sa;
            divide = false;
        }
        "xor" => {
            u = sa * (1. - da);
            alpha = u + v;
            divide = false;
        }
        "multiply" | "screen" | "overlay" | "darken" | "lighten" | "exclusion" => {
            let g = sa + da - sa * da;
            for i in 0..3 {
                let a = f64::from(s[i]) / 255.;
                let b = f64::from(d[i]) / 255.;
                let val = match mode {
                    "darken" => (a * sa).min(b * da) + a * sa * (1. - da) + b * da * (1. - sa),
                    "exclusion" => g * (a * sa + b - 2. * a * b * sa),
                    _ => {
                        let f = match mode {
                            "lighten" => a.max(b),
                            "multiply" => a * b,
                            "screen" => a + b - a * b,
                            _ if b <= 0.5 => 2. * a * b,
                            _ => 1. - 2. * (1. - a) * (1. - b),
                        };
                        let c = f * sa * da + a * sa * (1. - da) + b * da * (1. - sa);
                        if mode == "overlay" && g > 1e-6 {
                            c / g
                        } else {
                            c
                        }
                    }
                };
                d[i] = (255. * val).round() as u8;
            }
            d[3] = (255. * g).round() as u8;
            return d;
        }
        "srcover" | "dstover" | "destover" | "plus" | "add" | "lineardodge" | "saturate"
        | "colordodge" | "colorburn" | "hardlight" | "softlight" => {
            if s[3] == 0 {
                return d;
            }
            let inv = 1. / 255.;
            let (sa, da) = (f64::from(s[3]) * inv, f64::from(d[3]) * inv);
            let out_a = match mode {
                "add" | "plus" | "lineardodge" | "saturate" => (sa + da).min(1.),
                "dstover" | "destover" => da + sa * (1. - da),
                _ => sa + da * (1. - sa),
            };
            for i in 0..3 {
                let sp = f64::from(s[i]) * inv * sa;
                let dp = f64::from(d[i]) * inv * da;
                let value = match mode {
                    "srcover" if d[3] == 255 => {
                        (f64::from(s[i]) * f64::from(s[3])
                            + f64::from(d[i]) * f64::from(255 - s[3]))
                            / 255.
                    }
                    "srcover" => ((sp + dp * (1. - sa) + 1e-5) / out_a) * 255.,
                    "dstover" | "destover" => ((dp + sp * (1. - da) + 1e-5) / out_a) * 255.,
                    "add" | "plus" | "lineardodge" => (sp + dp) / out_a * 255. + 1e-5,
                    "saturate" => (sp * sa.min(1. - da) + dp) / out_a * 255. + 1e-5,
                    _ => {
                        let f = match mode {
                            "colordodge" if dp == 0. => 0.,
                            "colordodge" if sp == 1. => 1.,
                            "colordodge" => (dp / (1. - sp)).min(1.),
                            "colorburn" if dp == 1. => 1.,
                            "colorburn" if sp == 0. => 0.,
                            "colorburn" => 1. - ((1. - dp) / sp).min(1.),
                            "hardlight" if sp < 0.5 => 2. * sp * dp,
                            "hardlight" => 1. - 2. * (1. - sp) * (1. - dp),
                            _ if sp < 0.5 => dp - (1. - 2. * sp) * dp * (1. - dp),
                            _ => {
                                dp + (2. * sp - 1.)
                                    * if dp <= 0.25 {
                                        ((16. * dp - 12.) * dp + 3.) * dp
                                    } else {
                                        dp.sqrt() - dp
                                    }
                            }
                        };
                        ((1. - da) * sp + (1. - sa) * dp + sa * da * f) * (255. / out_a) + 1e-5
                    }
                };
                d[i] = value as u8;
            }
            d[3] = (out_a * 255. + 1e-5) as u8;
            return d;
        }
        _ => return d,
    }
    let divisor = if divide { alpha } else { 1. };
    for i in 0..3 {
        d[i] = ((f64::from(s[i]) * u + f64::from(d[i]) * v) / divisor).round() as u8;
    }
    d[3] = (alpha * 255.).round() as u8;
    d
}

pub(super) fn run(
    cmd: &str,
    args: &[String],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    let mut quality=92.;
    let mut mode = "over".to_owned();
    let mut gravity = "northwest".to_owned();
    let mut amounts = "";
    let mut geometry = "";
    let mut operands = Vec::new();
    let mut iter = args.iter().map(String::as_str);
    while let Some(arg) = iter.next() {
        match arg {
            "-compose" => {
                mode = iter
                    .next()?
                    .to_ascii_lowercase()
                    .replace(['-', '_', ' '], "")
            }
            "-gravity" => {
                gravity = iter
                    .next()?
                    .to_ascii_lowercase()
                    .replace(['-', '_', ' '], "")
            }
            "-geometry" => geometry = iter.next()?,
            "-blend" | "-watermark" | "-dissolve" => {
                mode = if arg == "-dissolve" {
                    "dissolve"
                } else {
                    "blend"
                }
                .into();
                amounts = iter.next()?;
            }
            "-define" => {
                let def = iter.next()?;
                if let Some(v) = def.strip_prefix("compose:args=") {
                    amounts = v;
                }
            }
            "-quality" => quality=super::magick_quality(iter.next()?),
            "-background" => {
                iter.next()?;
            }
            "-composite" => {}
            a if a.starts_with('-') && a != "-" => return None,
            a => operands.push(a),
        }
    }
    let &[first, second, dest] = operands.as_slice() else {
        return None;
    };
    let dest=super::png_pixels::destination(dest)?;
    let (base, overlay) = if cmd == "composite" {
        (second, first)
    } else {
        (first, second)
    };
    let load = |name: &str| {
        let path = name.strip_prefix("png:").unwrap_or(name);
        let bytes = if super::Canvas::parse(name).is_some() {
            Vec::new()
        } else {
            fs.read_file(&resolve_posix_path(cwd, path)).ok()?
        };
        Raster::input(name, &bytes, fs.max_input_bytes()).transpose()
    };
    let mut base = match load(base)? {
        Ok(im) => im,
        Err(e) => return Some(err_out(&format!("magick: {e}\n"), 1)),
    };
    let mut overlay = match load(overlay)? {
        Ok(im) => im,
        Err(e) => return Some(err_out(&format!("magick: {e}\n"), 1)),
    };
    if let Err(e) = overlay.resize(
        geometry,
        super::magick_resize::Kernel::Lanczos3,
        fs.max_input_bytes(),
    ) {
        return Some(err_out(&format!("magick: {e}\n"), 1));
    }
    let offsets = geometry
        .find(['+', '-'])
        .map(|i| &geometry[i..])
        .unwrap_or("");
    let mut xy = offsets.match_indices(['+', '-']).map(|(i, _)| i).peekable();
    let mut number = || {
        xy.next()
            .and_then(|i| {
                offsets[i..xy.peek().copied().unwrap_or(offsets.len())]
                    .parse::<i32>()
                    .ok()
            })
            .unwrap_or(0) as i64
    };
    let (gx, gy) = (number(), number());
    let w = base.width as i64 - overlay.width as i64;
    let h = base.height as i64 - overlay.height as i64;
    let left = match gravity.as_str() {
        "northwest" | "southwest" | "west" => gx,
        "north" | "south" | "center" | "centre" => (w + 2 * gx) / 2,
        "east" | "northeast" | "southeast" => w - gx,
        _ => (w + 2 * gx) / 2,
    };
    let top = match gravity.as_str() {
        "northwest" | "northeast" | "north" => gy,
        "southwest" | "southeast" | "south" => h - gy,
        _ => (h + 2 * gy) / 2,
    };
    let mut values = amounts.split(['x', 'X', ',']);
    let pct = |s: &str| {
        s.trim()
            .trim_end_matches('%')
            .parse::<f64>()
            .unwrap_or(0.)
            .max(0.)
            / 100.
    };
    let ws = values
        .next()
        .filter(|s| !s.is_empty())
        .map(pct)
        .unwrap_or(if mode == "blend" { 0.5 } else { 1. });
    let wd = values.next().map(pct).unwrap_or(if mode == "blend" {
        (1. - ws).max(0.)
    } else {
        1.
    });
    for y in top.max(0)..(top + overlay.height as i64).min(base.height as i64) {
        for x in left.max(0)..(left + overlay.width as i64).min(base.width as i64) {
            let src = overlay.pixels[(y - top) as usize * overlay.width + (x - left) as usize];
            let dst = &mut base.pixels[y as usize * base.width + x as usize];
            *dst = blend(src, *dst, &mode, ws, wd);
        }
    }
    base.alpha |= !matches!(
        mode.as_str(),
        "over"
            | "srcover"
            | "dstover"
            | "destover"
            | "plus"
            | "add"
            | "lineardodge"
            | "colordodge"
            | "colorburn"
            | "hardlight"
            | "softlight"
            | "saturate"
    ) || base.pixels.iter().any(|p| p[3] < 255);
    Some(base.publish(dest, quality, cwd, fs))
}
