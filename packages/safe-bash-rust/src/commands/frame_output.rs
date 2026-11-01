use super::png_pixels::Raster;

fn encode(im: &Raster, format: &str, limit: usize) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (im.width, im.height);
    if w.saturating_mul(h) > limit / 4 {
        return Err("image exceeds memory budget");
    }
    let data = match format {
        "png" => super::pixel_png(w, h, super::PngEncoding::Density(72), |x, y| {
            im.pixels[y * w + x]
        }),
        "ppm" => {
            let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
            for p in &im.pixels {
                out.extend_from_slice(&p[..3]);
            }
            out
        }
        "bmp" => {
            let row = (3 * w).next_multiple_of(4);
            let size = row * h;
            let mut out = Vec::with_capacity(54 + size);
            out.extend_from_slice(b"BM");
            for v in [
                (54 + size) as u32,
                0,
                54,
                40,
                w as u32,
                h as u32,
                24 << 16 | 1,
                0,
                size as u32,
                2835,
                2835,
                0,
                0,
            ] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            for pixels in im.pixels.chunks_exact(w).rev() {
                for &[r, g, b, _] in pixels {
                    out.extend_from_slice(&[b, g, r]);
                }
                out.resize(out.len() + row - 3 * w, 0);
            }
            out
        }
        _ => return Err("unsupported frame image format"),
    };
    if data.len() > limit {
        return Err("output byte limit exceeded");
    }
    Ok(data)
}

fn sequence(path: &str) -> Result<Option<(usize, usize, usize)>, &'static str> {
    for (i, _) in path.match_indices('%') {
        let suffix = &path[i + 1..];
        let n = suffix.bytes().take_while(u8::is_ascii_digit).count();
        if suffix.as_bytes().get(n) != Some(&b'd') {
            continue;
        }
        let width = if n == 0 {
            0
        } else {
            suffix[..n]
                .parse::<usize>()
                .ok()
                .filter(|&w| w <= 4096)
                .ok_or("image sequence filename is too long")?
        };
        return Ok(Some((i, i + n + 2, width)));
    }
    Ok(None)
}

pub(super) fn render(
    fs: &dyn super::SafeBashFs,
    cwd: &str,
    path: &str,
    image_format: Option<&str>,
    mut index: u64,
    decode: impl FnOnce(
        bool,
        &mut dyn FnMut(Raster, f64, usize) -> Result<(), &'static str>,
    ) -> Result<(usize, usize, u32), String>,
) -> Result<Option<Vec<u8>>, String> {
    let limit = fs.max_input_bytes();
    let pattern = if image_format.is_some() {
        sequence(path)?
    } else {
        None
    };
    let mut data = Vec::new();
    let mut failure = None;
    let mut total = 0usize;
    let dims = decode(pattern.is_some(), &mut |im, duration, _| {
        if let Some(fmt) = image_format {
            let frame = encode(&im, fmt, limit)?;
            if let Some((i, j, width)) = pattern {
                total = total.saturating_add(frame.len());
                if total > limit {
                    return Err("output byte limit exceeded");
                }
                let name = format!("{}{index:0width$}{}", &path[..i], &path[j..]);
                if let Err(e) =
                    super::write_ffmpeg_output(fs, &super::resolve_posix_path(cwd, &name), &frame)
                {
                    failure = Some(e);
                    return Err("writing image sequence");
                }
                index += 1;
            } else {
                data = frame;
            }
        } else {
            if data.is_empty() {
                data =
                    super::y4m::header(im.width, im.height, (1. / duration).round().max(1.) as u32);
            }
            data.extend_from_slice(b"FRAME\n");
            super::y4m::append_planes(&mut data, &im, limit)?;
        }
        Ok(())
    });
    let (w, h, fps) = dims.map_err(|e| failure.unwrap_or(e))?;
    if pattern.is_some() {
        return Ok(None);
    }
    if data.is_empty() {
        data = if let Some(fmt) = image_format {
            if w.saturating_mul(h) > limit / 4 {
                return Err("image exceeds memory budget".into());
            }
            let blank = Raster {
                width: w,
                height: h,
                alpha: true,
                gray: false,
                density: 72,
                pixels: vec![[0; 4]; w * h],
            };
            encode(&blank, fmt, limit)?
        } else {
            super::y4m::header(w, h, fps)
        };
    }
    Ok(Some(data))
}
