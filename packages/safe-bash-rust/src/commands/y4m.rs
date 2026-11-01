use super::{magick_resize::Kernel, png_pixels::Raster};
pub(super) struct Stream<'a> {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_size: u64,
    data: &'a [u8],
}
fn integer(input: &str, fallback: u32) -> Result<u32, &'static str> {
    let input = input.strip_prefix('+').unwrap_or(input);
    if input.starts_with('-') {
        return Err("Invalid YUV4MPEG2 dimensions or frame rate");
    }
    let digits = input.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return Ok(fallback);
    }
    let value = input[..digits]
        .parse()
        .map_err(|_| "Invalid YUV4MPEG2 dimensions or frame rate")?;
    Ok(if value == 0 { fallback } else { value })
}

impl<'a> Stream<'a> {
    pub(super) fn parse(input: &'a [u8]) -> Result<Self, &'static str> {
        if !input.starts_with(b"YUV4MPEG2 ") {
            return Err("Invalid YUV4MPEG2 stream: missing 'YUV4MPEG2 ' magic");
        }
        let end = input
            .iter()
            .position(|b| *b == b'\n')
            .unwrap_or(input.len());
        let (mut width, mut height, mut fps) = (64u32, 64u32, 30.);
        for token in String::from_utf8_lossy(&input[..end]).split_whitespace() {
            if let Some(w) = token.strip_prefix('W') {
                width = integer(w, width)?;
            }
            if let Some(h) = token.strip_prefix('H') {
                height = integer(h, height)?;
            }
            if let Some(rate) = token.strip_prefix('F') {
                let mut parts = rate.split(':');
                fps = f64::from(integer(parts.next().unwrap_or(""), 30)?)
                    / f64::from(integer(parts.next().unwrap_or(""), 1)?);
            }
        }
        let frame_size = (u64::from(width) * u64::from(height))
            .checked_add(2 * u64::from(width.div_ceil(2)) * u64::from(height.div_ceil(2)))
            .ok_or("Invalid YUV4MPEG2 dimensions or frame rate")?;
        Ok(Self {
            width,
            height,
            fps,
            frame_size,
            data: input.get(end + 1..).unwrap_or_default(),
        })
    }
    pub fn frames(&self) -> impl Iterator<Item = &'a [u8]> {
        let mut rest = self.data;
        std::iter::from_fn(move || {
            let n = rest.iter().position(|b| *b == b'\n')?;
            let (frame, next) =
                rest[n + 1..].split_at_checked(usize::try_from(self.frame_size).ok()?)?;
            rest = next;
            Some(frame)
        })
    }
}

fn raster(width: usize, height: usize, pixels: Vec<[u8; 4]>) -> Raster {
    Raster {
        width,
        height,
        pixels,
        alpha: false,
        gray: false,
        density: 72,
    }
}

fn decode(frame: &[u8], w: usize, h: usize) -> Raster {
    let (y, uv) = frame.split_at(w * h);
    let cw = w.div_ceil(2);
    let (u, v) = uv.split_at(cw * h.div_ceil(2));
    let mut pixels = Vec::with_capacity(w * h);
    for row in 0..h {
        for x in 0..w {
            let i = (row / 2) * cw + x / 2;
            let c = (i32::from(y[row * w + x]) - 16).max(0) * 298;
            let (u, v) = (i32::from(u[i]) - 128, i32::from(v[i]) - 128);
            let sat = |n: i32| ((n + 128) >> 8).clamp(0, 255) as u8;
            pixels.push([
                sat(c + 409 * v),
                sat(c - 100 * u - 208 * v),
                sat(c + 516 * u),
                255,
            ]);
        }
    }
    raster(w, h, pixels)
}

fn append_planes(out: &mut Vec<u8>, im: &Raster, limit: usize) -> Result<(), &'static str> {
    let (w, h) = (im.width, im.height);
    let cw = w.div_ceil(2);
    let chroma = cw * h.div_ceil(2);
    let size = w * h + 2 * chroma;
    if size + 6 > limit.saturating_sub(out.len()) {
        return Err("output byte limit exceeded");
    }
    out.extend_from_slice(b"FRAME\n");
    let start = out.len();
    out.resize(start + size, 0);
    let (y, uv) = out[start..].split_at_mut(w * h);
    let (u, v) = uv.split_at_mut(chroma);
    for row in (0..h).step_by(2) {
        for col in (0..w).step_by(2) {
            let (mut r, mut g, mut b, mut count) = (0, 0, 0, 0);
            for py in row..(row + 2).min(h) {
                for px in col..(col + 2).min(w) {
                    let i = py * w + px;
                    let [pr, pg, pb, _] = im.pixels[i].map(i32::from);
                    y[i] = (((66 * pr + 129 * pg + 25 * pb + 128) >> 8) + 16) as u8;
                    r += pr;
                    g += pg;
                    b += pb;
                    count += 1;
                }
            }
            let [r, g, b] = [r, g, b].map(|s| (s + count / 2) / count);
            let i = row / 2 * cw + col / 2;
            u[i] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            v[i] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }
    Ok(())
}

pub(super) struct Options<'a> {
    pub filters: &'a [String],
    pub frames: Option<u32>,
    pub start: f64,
    pub end: Option<f64>,
    pub no_video: bool,
    pub limit: usize,
}

impl Stream<'_> {
    pub fn encode(&self, options: Options<'_>) -> Result<Vec<u8>, &'static str> {
        let (w, h) = (self.width as usize, self.height as usize);
        let mut frames = Vec::new();
        for f in self.frames() {
            if frames.len() >= options.limit / size_of::<&[u8]>() {
                return Err("frame index exceeds memory budget");
            }
            frames.push(f);
        }
        encode(w, h, self.fps, frames.len(), options, |i| {
            decode(frames[i], w, h)
        })
    }
}

fn encode(
    w: usize,
    h: usize,
    mut fps: f64,
    count: usize,
    opts: Options<'_>,
    mut image: impl FnMut(usize) -> Raster,
) -> Result<Vec<u8>, &'static str> {
    let header =
        |w, h, fps| format!("YUV4MPEG2 W{w} H{h} F{fps}:1 Ip A1:1 C420jpeg\n").into_bytes();
    if opts.no_video {
        return Ok(header(64, 64, 10));
    }
    let mut ids: Vec<usize> = (0..count)
        .filter(|i| {
            (*i + 1) as f64 / fps > opts.start && opts.end.is_none_or(|t| (*i as f64 / fps) < t)
        })
        .collect();
    let mut ops = Vec::new();
    for stage in opts
        .filters
        .iter()
        .flat_map(|s| s.split(','))
        .map(str::trim)
    {
        let (key, arg) = stage.split_once('=').unwrap_or((stage, ""));
        match key {
            "reverse" => ids.reverse(),
            "fps" if !ids.is_empty() => {
                let rate = arg
                    .trim_start_matches("fps=")
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v > 0.)
                    .unwrap_or(25.);
                let n = (ids.len() as f64 / fps * rate).round().max(1.) as usize;
                if n > opts.limit / size_of::<usize>() {
                    return Err("frame index exceeds memory budget");
                }
                ids = (0..n)
                    .map(|i| ids[(i as u64 * ids.len() as u64 / n as u64) as usize])
                    .collect();
                fps = rate;
            }
            "trim" => {
                let mut start = 0.;
                let mut end = f64::INFINITY;
                let mut duration = None;
                for (j, s) in arg.split(':').enumerate() {
                    let (k, v) = s
                        .split_once('=')
                        .unwrap_or((if j == 0 { "start" } else { "" }, s));
                    if let Some(t) = super::parse_ffmpeg_timestamp(v) {
                        match k {
                            "start" => start = t,
                            "end" => end = t,
                            "duration" => duration = Some(t),
                            _ => {}
                        }
                    }
                }
                let mut i = 0;
                ids.retain(|_| {
                    let pts = i as f64 / fps;
                    i += 1;
                    pts + 1. / fps > start && pts < duration.map_or(end, |d| start + d)
                });
            }
            _ => ops.push((key, arg)),
        }
    }
    if let Some(n) = opts.frames {
        ids.truncate(n.max(1) as usize);
    }
    if ids.is_empty() {
        return Ok(header(w, h, 30));
    }
    if w.saturating_mul(h) > opts.limit / 4 {
        return Err("image exceeds memory budget");
    }
    let mut out = Vec::new();
    for id in ids {
        let mut im = image(id);
        for &(op, arg) in &ops {
            let (iw, ih) = (im.width, im.height);
            match op {
                "hflip" => im.pixels.chunks_exact_mut(iw).for_each(|row| row.reverse()),
                "vflip" => im.remap(iw, ih, |im, x, y| im.pixels[(ih - 1 - y) * iw + x]),
                "negate" => im
                    .pixels
                    .iter_mut()
                    .for_each(|p| p[..3].iter_mut().for_each(|v| *v = 255 - *v)),
                "format" if arg.contains("gray") => {
                    for p in &mut im.pixels {
                        let g = super::magick_color::gray(p[0], p[1], p[2]);
                        p[..3].fill(g);
                    }
                }
                "transpose" | "rotate" => im.remap(ih, iw, |im, x, y| {
                    if op == "transpose" && matches!(arg, "2" | "dir=2") {
                        im.pixels[x * iw + iw - 1 - y]
                    } else {
                        im.pixels[(ih - 1 - x) * iw + y]
                    }
                }),
                "scale" => {
                    let (wx, hx) = arg.split_once(':').unwrap_or((arg, "ih"));
                    let dim = |s: &str, base| {
                        super::eval_dim_expr(
                            s.split('=').next_back().unwrap_or(s),
                            iw as u32,
                            ih as u32,
                        )
                        .unwrap_or(base)
                    };
                    let (mut dw, mut dh) = (dim(wx, iw as i32), dim(hx, ih as i32));
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
                        opts.limit,
                    )?;
                }
                _ => {}
            }
        }
        if out.is_empty() {
            out = header(im.width, im.height, fps.round().max(1.) as u32);
        }
        append_planes(&mut out, &im, opts.limit)?;
    }
    Ok(out)
}
