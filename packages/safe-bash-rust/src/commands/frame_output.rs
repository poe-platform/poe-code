use super::png_pixels::Raster;

#[path = "jpeg.rs"]
mod jpeg;

pub(super) fn image_format(name: &str, numbered: bool) -> Option<&'static str> {
    Some(match name {
        "png" | "image2" | "pgm" | "tga" => "png",
        "tiff" | "tif" if numbered => "png",
        "tiff" | "tif" => "tiff",
        "jpg" | "jpeg" => "jpeg",
        "bmp" => "bmp",
        "ppm" => "ppm",
        _ => return None,
    })
}

fn tiff(im: &Raster, limit: usize) -> Result<Vec<u8>, &'static str> {
    let byte_count = im
        .pixels
        .len()
        .checked_mul(4)
        .ok_or("output byte limit exceeded")?;
    let size = byte_count
        .checked_add(218)
        .filter(|n| *n <= limit && *n <= u32::MAX as usize)
        .ok_or("output byte limit exceeded")?;
    let mut out = Vec::with_capacity(size);
    let directory = 8 + byte_count as u32;
    let bits = directory + 2 + 15 * 12 + 4;
    let (w, h) = (im.width as u32, im.height as u32);
    out.extend_from_slice(b"II\x2a\x00");
    out.extend_from_slice(&directory.to_le_bytes());
    out.extend_from_slice(im.pixels.as_flattened());
    out.extend_from_slice(&15u16.to_le_bytes());
    // Classic TIFF: one uncompressed RGBA strip, straight alpha and 72 DPI.
    for (tag, ty, count, value) in [
        (256u16, 4u16, 1u32, w),
        (257, 4, 1, h),
        (258, 3, 4, bits),
        (259, 3, 1, 1),
        (262, 3, 1, 2),
        (273, 4, 1, 8),
        (274, 3, 1, 1),
        (277, 3, 1, 4),
        (278, 4, 1, h),
        (279, 4, 1, byte_count as u32),
        (282, 5, 1, bits + 8),
        (283, 5, 1, bits + 16),
        (284, 3, 1, 1),
        (296, 3, 1, 2),
        (338, 3, 1, 2),
    ] {
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(&ty.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&value.to_le_bytes());
    }
    for value in [0u32, 0x00080008, 0x00080008, 72, 1, 72, 1] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    Ok(out)
}

pub(super) fn encode(
    im: &Raster,
    format: &str,
    quality: u8,
    density: u32,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (im.width, im.height);
    if w.saturating_mul(h) > limit / 4 {
        return Err("image exceeds memory budget");
    }
    let data = match format {
        "jpeg" => jpeg::encode(im, quality, density, limit)?,
        "tiff" => tiff(im, limit)?,
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
        "pgm" | "pbm" => {
            let mut out = if format == "pgm" {
                format!("P5\n{w} {h}\n255\n")
            } else {
                format!("P4\n{w} {h}\n")
            }
            .into_bytes();
            for row in im.pixels.chunks_exact(w) {
                let mut bits = 0;
                for (i, &[r, g, b, _]) in row.iter().enumerate() {
                    let luma = 0.299 * f64::from(r) + 0.587 * f64::from(g) + 0.114 * f64::from(b);
                    if format == "pgm" {
                        out.push(luma.round() as u8);
                    } else {
                        if luma < 128. {
                            bits |= 1 << (7 - i % 8);
                        }
                        if i % 8 == 7 || i + 1 == w {
                            out.push(bits);
                            bits = 0;
                        }
                    }
                }
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

pub(super) fn sequence(path: &str) -> Result<Option<(usize, usize, usize)>, &'static str> {
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

pub(super) struct ImageSequence {
    pub frames: Vec<Raster>,
    pub fps: f64,
}

impl ImageSequence {
    pub fn template_duration(&self) -> f64 {
        (90000. / self.fps).round().max(1.) / 90000.
    }
    pub fn read(
        fs: &dyn super::SafeBashFs,
        cwd: &str,
        path: &str,
        pattern: (usize, usize, usize),
        start: Option<u64>,
        fps: f64,
        limit: usize,
    ) -> Result<Self, String> {
        let (i, j, width) = pattern;
        let mut index = start.unwrap_or(0);
        let mut frames = Vec::new();
        let mut used = 0;
        loop {
            let name = format!("{}{index:0width$}{}", &path[..i], &path[j..]);
            let full = super::resolve_posix_path(cwd, &name);
            let bytes = match fs.read_file(&full) {
                Ok(b) => b,
                Err(e) if e.starts_with("ENOENT:") => {
                    if index == 0 && start.is_none() {
                        index += 1;
                        continue;
                    }
                    break;
                }
                Err(e) => return Err(e),
            };
            let remaining = limit.saturating_sub(used);
            if bytes.len() > remaining {
                return Err("image exceeds memory budget".into());
            }
            let frame = Raster::decode(&bytes, remaining).map_err(|e| match e {
                "Truncated PNG chunk" | "Truncated PNG image data" => "unexpected end of file",
                _ => e,
            })?;
            used += frame.pixels.len() * 4 + size_of::<Raster>();
            if used > limit {
                return Err("image exceeds memory budget".into());
            }
            frames.push(frame);
            index += 1;
        }
        if frames.is_empty() {
            return Err(format!("{path}: No matching image sequence files found"));
        }
        Ok(Self { frames, fps })
    }
    pub fn render(
        &self,
        opts: super::y4m::Options<'_>,
        emit: impl FnMut(Raster, f64, super::y4m::Buffer) -> Result<(), &'static str>,
    ) -> Result<(usize, usize, u32), &'static str> {
        let (w, h) = (self.frames[0].width, self.frames[0].height);
        super::y4m::render_frames(
            w,
            h,
            (0..self.frames.len()).map(|i| (i as f64 / self.fps, 1. / self.fps)),
            opts,
            |i| Ok(self.frames[i].clone()),
            emit,
        )?;
        Ok((w, h, 30))
    }
}

pub(super) fn still_info(
    bytes: &[u8],
    limit: usize,
) -> Result<(usize, usize, &'static [u8; 4]), &'static str> {
    if super::netpbm::signature(bytes) {
        let image = super::netpbm::Netpbm::parse(bytes, limit)?;
        return Ok((image.width, image.height, image.codec()));
    }
    if super::bmp::signature(bytes) {
        return match super::bmp::Bmp::parse(bytes, limit) {
            Ok(image) => Ok((image.width, image.height, b"bmp ")),
            Err("Offset is outside the bounds of the DataView") if limit < 64 * 64 * 4 => {
                Err("image exceeds memory budget")
            }
            Err("Offset is outside the bounds of the DataView") => Ok((64, 64, b"png ")),
            Err(reason) => Err(reason),
        };
    }
    // image2 retains the PNG dimensions for a damaged image.
    let dimension = |i| {
        bytes
            .get(i..i + 4)
            .map(|b| u32::from_be_bytes(b.try_into().unwrap()) as usize)
            .filter(|n| *n != 0)
            .unwrap_or(64)
    };
    let (w, h) = if bytes.len() >= 24 {
        (dimension(16), dimension(20))
    } else {
        (64, 64)
    };
    if w.saturating_mul(h) > limit / 4 {
        return Err("image exceeds memory budget");
    }
    Ok((w, h, b"png "))
}

pub(super) fn decode_still(bytes: &[u8], limit: usize) -> Result<Raster, &'static str> {
    Ok(match Raster::decode(bytes, limit) {
        Ok(im) => im,
        Err("image exceeds memory budget") => return Err("image exceeds memory budget"),
        Err(_) => {
            let (w, h, _) = still_info(bytes, limit)?;
            Raster {
                width: w,
                height: h,
                alpha: true,
                gray: false,
                density: 72,
                pixels: vec![[180; 4]; w * h],
            }
        }
    })
}

pub(super) fn still_sample(start: f64, end: f64) -> bool {
    (start.max(0.) * 25.).round() < 1. && (end.min(0.04) * 25.).round() >= 1.
}

pub(super) fn render_still(
    bytes: &[u8],
    opts: super::y4m::Options<'_>,
    seek: super::InputTime,
    reslice: bool,
    emit: impl FnMut(Raster, f64, super::y4m::Buffer) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), &'static str> {
    let im = decode_still(bytes, opts.limit)?;
    let (w, h) = (im.width, im.height);
    // A still has one 25 Hz sample. A sub-tick input cut may preserve
    // its decoded pixels but leave no packet duration for a second cut.
    let start = seek.start.unwrap_or(0.).max(0.);
    let end = seek.end().unwrap_or(0.04);
    let visible = start < 0.04 && end > 0.;
    let packet = still_sample(start, end);
    let times = (visible && (!reslice || packet)).then_some((0., 0.04));
    super::y4m::render_frames(w, h, times.into_iter(), opts, |_| Ok(im.clone()), emit)?;
    Ok((w, h, 30))
}

pub(super) fn render(
    fs: &dyn super::SafeBashFs,
    cwd: &str,
    path: &str,
    image_format: Option<&str>,
    pattern: Option<(usize, usize, usize)>,
    mut index: u64,
    decode: impl FnOnce(
        bool,
        &mut dyn FnMut(Raster, f64, super::y4m::Buffer) -> Result<(), &'static str>,
    ) -> Result<(usize, usize, u32), String>,
) -> Result<Option<Vec<u8>>, String> {
    let limit = fs.max_input_bytes();
    let mut data = Vec::new();
    let mut failure = None;
    let mut total = 0usize;
    let mut geometry = None;
    let dims = decode(pattern.is_some(), &mut |mut im, duration, _| {
        if let Some(fmt) = image_format {
            let frame = encode(&im, fmt, 85, 72, limit)?;
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
            let (w, h) = *geometry.get_or_insert((im.width, im.height));
            im.width = w;
            im.height = h;
            im.pixels.resize(w * h, [0; 4]);
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
            encode(&blank, fmt, 85, 72, limit)?
        } else {
            super::y4m::header(w, h, fps)
        };
    }
    Ok(Some(data))
}
