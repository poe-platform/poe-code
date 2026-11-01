use super::{magick_color::parse_color, magick_resize::Kernel, png_pixels::Raster};
use std::borrow::Cow;

pub(super) fn transform<'a>(
    raster: &mut Raster,
    ops: &[(&str, String, String)],
    bytes: &'a [u8],
    limit: usize,
) -> Result<Option<Cow<'a, [u8]>>, String> {
    let mut source = Some(Cow::Borrowed(bytes));
    let (orig_w, orig_h) = (raster.width as f64, raster.height as f64);
    let resize = |op: &str| matches!(op, "z" | "Z" | "rw" | "rh");
    let turn = |op: &str| matches!(op, "r" | "f");
    let crop = ops.iter().rposition(|(op, ..)| matches!(*op, "p" | "c"));
    let has_width = ops.iter().any(|(op, ..)| *op == "rw");
    let first_turn = ops.iter().position(|(op, ..)| turn(op));
    let mut actions: Vec<_> = ops
        .iter()
        .enumerate()
        .filter(|(i, (op, ..))| {
            turn(op) || Some(*i) == crop || resize(op) && !(*op == "rh" && has_width)
        })
        .collect();
    if let Some(first) = first_turn {
        // sips applies rotations/flips in reverse order and switches the two resize slots.
        actions.sort_by_key(|(i, (op, ..))| {
            if turn(op) {
                (2, usize::MAX - i)
            } else if resize(op) {
                (if *i < first { 3 } else { 1 }, *i)
            } else {
                (if *i < first { 0 } else { 4 }, *i)
            }
        });
    }
    let color = ops
        .iter()
        .rev()
        .find(|(op, ..)| *op == "color")
        .map(|(_, s, _)| s.trim());
    let has_alpha =
        super::gif::signature(bytes) || raster.alpha && !super::jpeg_decode::signature(bytes);
    let background = |odd: bool, four_channels: bool| -> Result<[u8; 4], String> {
        let Some(color) = color else {
            return Ok([
                0,
                0,
                0,
                if has_alpha || odd && four_channels {
                    0
                } else {
                    255
                },
            ]);
        };
        let hex = color.trim_start_matches('#');
        if matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            let mut p = parse_color(&format!("#{hex}"))?;
            if odd && four_channels && matches!(hex.len(), 3 | 6) {
                p[3] = 0;
            }
            Ok(p)
        } else {
            parse_color(color)
        }
    };
    let offset = ops
        .iter()
        .rev()
        .find(|(op, ..)| *op == "offset")
        .map(|(_, y, x)| {
            let n = |s: &str| (s.parse::<f64>().unwrap() + 0.5).floor();
            (n(x), n(y))
        });
    let mut dims = (raster.width, raster.height);
    for (_, (op, a, b)) in actions {
        let number = |s: &str| s.parse::<f64>().unwrap().round();
        if (dims.0 == 0 || dims.1 == 0) && (resize(op) || turn(op)) {
            return Err("Invalid stored image dimensions".into());
        }
        if resize(op) {
            let scale = match *op {
                "Z" => number(a) / orig_w.max(orig_h),
                "rw" => number(a) / orig_w,
                _ => number(a) / orig_h,
            };
            let sx = if *op == "z" {
                number(b) / orig_w
            } else {
                scale
            };
            dims = (
                ((dims.0 as f64 * sx).round() as usize).max(1),
                ((dims.1 as f64 * scale).round() as usize).max(1),
            );
            continue;
        }
        if dims != (raster.width, raster.height) {
            apply_resize(raster, dims, limit)?;
        }
        match *op {
            "r" => raster.rotate(a.parse().unwrap(), background(false, raster.alpha)?, limit)?,
            "f" => {
                if a == "vertical" {
                    raster.pixels.reverse();
                }
                for row in raster.pixels.chunks_exact_mut(raster.width) {
                    row.reverse();
                }
            }
            "c" | "p" => {
                let offset = if *op == "c" { offset } else { None };
                let axis = |src: usize, target: usize, offset: Option<f64>| {
                    let Some(pos) = offset else {
                        return (target, (src as f64 - target as f64) / 2.);
                    };
                    // Even an offset beyond the input extracts one edge pixel before padding.
                    let start = pos.clamp(0., src.saturating_sub(1) as f64);
                    let end = (pos + target as f64).min(src as f64).max(start + 1.);
                    let pad = (start - pos).max(0.);
                    (target.max((pad + end - start) as usize), start - pad)
                };
                let (w, left) = axis(raster.width, number(b) as usize, offset.map(|p| p.0));
                let (h, top) = axis(raster.height, number(a) as usize, offset.map(|p| p.1));
                if w == 0 || h == 0 || w.saturating_mul(h) > limit / 4 {
                    return Err("image exceeds memory budget".into());
                }
                let odd = left.fract() != 0. || top.fract() != 0.;
                let bg = background(
                    odd,
                    raster.alpha || source.as_deref().is_some_and(super::gif::signature),
                )?;
                raster.remap(w, h, |im, x, y| {
                    let (sx, sy) = (x as f64 + left, y as f64 + top);
                    let sample = |x: f64, y: f64| {
                        if x >= 0. && x < im.width as f64 && y >= 0. && y < im.height as f64 {
                            im.pixels[y as usize * im.width + x as usize]
                        } else {
                            bg
                        }
                    };
                    if !odd {
                        return sample(sx, sy);
                    }
                    let (ix, iy) = (sx.floor(), sy.floor());
                    let (fx, fy) = (sx - ix, sy - iy);
                    let mut sum = [0.; 4];
                    for (dx, dy, k) in [
                        (0., 0., (1. - fx) * (1. - fy)),
                        (1., 0., fx * (1. - fy)),
                        (0., 1., (1. - fx) * fy),
                        (1., 1., fx * fy),
                    ] {
                        if k != 0. {
                            let p = sample(ix + dx, iy + dy);
                            for i in 0..4 {
                                sum[i] += k * f64::from(p[i]);
                            }
                        }
                    }
                    sum.map(|v| v.round() as u8)
                });
                if odd {
                    // The interpolated canvas is decoded from raw pixels, without source metadata.
                    raster.alpha |= source.as_deref().is_some_and(super::gif::signature);
                    source = None;
                    raster.orientation = None;
                    raster.density = 72;
                    if raster.alpha {
                        raster.gray = false;
                    }
                    dims = (raster.width, raster.height);
                    continue;
                }
            }
            _ => unreachable!(),
        }
        // A flip, rotation, or integer crop/pad encodes and reopens the image.
        // GIF palette and timing can change at each boundary, even for a lossless final format.
        let input = source
            .as_deref()
            .ok_or("Input buffer contains unsupported image format")?;
        if super::jpeg_decode::signature(input) {
            let encoded = super::jpeg::encode(raster, 85., raster.density, limit)?;
            *raster = super::jpeg_decode::decode(&encoded, limit)?;
        } else if super::gif::signature(input) {
            let encoded = super::gif::encode_first_frame(raster, input, limit)?;
            *raster = super::gif::decode(&encoded, 1, limit, |_, _| Ok(()))?;
            source = Some(Cow::Owned(encoded));
        }
        dims = (raster.width, raster.height);
    }
    if dims != (raster.width, raster.height) {
        apply_resize(raster, dims, limit)?;
    }
    Ok(source)
}

fn apply_resize(
    raster: &mut Raster,
    (w, h): (usize, usize),
    limit: usize,
) -> Result<(), &'static str> {
    if w.saturating_mul(h) > limit / 4 {
        return Err("image exceeds memory budget");
    }
    raster.resize(&format!("{w}x{h}!"), Kernel::Lanczos3, limit)
}
