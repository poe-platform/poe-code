use super::png_pixels::Raster;
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

fn decode(frame: &[u8], w: usize, h: usize, rgb: impl Fn(i32, i32, i32) -> [u8; 4]) -> Raster {
    let (y, uv) = frame.split_at(w * h);
    let cw = w.div_ceil(2);
    let (u, v) = uv.split_at(cw * h.div_ceil(2));
    let mut pixels = Vec::with_capacity(w * h);
    for row in 0..h {
        for x in 0..w {
            let i = (row / 2) * cw + x / 2;
            pixels.push(rgb(
                i32::from(y[row * w + x]) - 16,
                i32::from(u[i]) - 128,
                i32::from(v[i]) - 128,
            ));
        }
    }
    raster(w, h, pixels)
}

pub(super) fn append_planes(
    out: &mut Vec<u8>,
    im: &Raster,
    limit: usize,
) -> Result<(), &'static str> {
    let (w, h) = (im.width, im.height);
    let cw = w.div_ceil(2);
    let chroma = cw * h.div_ceil(2);
    let size = w * h + 2 * chroma;
    if size > limit.saturating_sub(out.len()) {
        return Err("output byte limit exceeded");
    }
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

// Slicing lavfi materializes H.264 I_PCM samples. Its 4:2:0 display dimensions
// round up to even numbers, while the Y4M muxer writes the track dimensions.
pub(super) fn materialized(
    mut im: Raster,
    filtered: bool,
    limit: usize,
) -> Result<Raster, &'static str> {
    let (w, h) = (im.width, im.height);
    let (dw, dh) = (w.next_multiple_of(2), h.next_multiple_of(2));
    if dw.saturating_mul(dh) > limit / 4 {
        return Err("image exceeds memory budget");
    }
    if dw != w || dh != h {
        im.remap(dw, dh, |r, x, y| r.pixels[y.min(h - 1) * w + x.min(w - 1)]);
    }
    let mut frame = Vec::new();
    append_planes(&mut frame, &im, limit)?;
    let mut decoded = decode(&frame, dw, dh, bt601);
    if !filtered {
        decoded.width = w;
        decoded.height = h;
        decoded.pixels.truncate(w * h);
    }
    Ok(decoded)
}

// libswscale uses 13 fractional bits for its limited-range BT.601 coefficients.
pub(super) fn bt601(y: i32, u: i32, v: i32) -> [u8; 4] {
    let c = y * 9539;
    let sat = |n: i32| ((n + 4096) >> 13).clamp(0, 255) as u8;
    [
        sat(c + 13075 * v),
        sat(c - 3209 * u - 6660 * v),
        sat(c + 16525 * u),
        255,
    ]
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
        encode(
            w,
            h,
            (0..frames.len()).map(|i| (i as f64 / self.fps, 1. / self.fps)),
            options,
            |i| {
                Ok(decode(frames[i], w, h, |y, u, v| {
                    let c = y.max(0) * 298;
                    let sat = |n: i32| ((n + 128) >> 8).clamp(0, 255) as u8;
                    [
                        sat(c + 409 * v),
                        sat(c - 100 * u - 208 * v),
                        sat(c + 516 * u),
                        255,
                    ]
                }))
            },
        )
    }
}

#[derive(Clone, Copy)]
struct TimedFrame {
    index: usize,
    pts: f64,
    duration: f64,
}

struct TileStage<'a> {
    cols: usize,
    rows: usize,
    margin: i64,
    padding: i64,
    inputs: Vec<TimedFrame>,
    filters: Vec<super::video_filter::Filter<'a>>,
}

// Resolve only the cells used by this output; a frame cap or trim need not render the rest.
fn render(
    stages: &[TileStage<'_>],
    index: usize,
    limit: usize,
    image: &mut impl FnMut(usize) -> Result<Raster, &'static str>,
) -> Result<Raster, &'static str> {
    let Some((stage, prior)) = stages.split_last() else {
        return image(index);
    };
    let per = stage.cols.saturating_mul(stage.rows);
    let start = index * per;
    let mut canvas: Option<Raster> = None;
    for (k, entry) in stage.inputs[start..].iter().take(per).enumerate() {
        let remaining = limit - canvas.as_ref().map_or(0, |c| c.pixels.len() * 4);
        let mut cell = render(prior, entry.index, remaining, image)?;
        for filter in &stage.filters {
            filter.apply(&mut cell, remaining)?;
        }
        let (w, h) = (cell.width as i64, cell.height as i64);
        let dim = |n: usize, d: i64| -> Result<usize, &'static str> {
            let n = n as i128;
            let size =
                n * d as i128 + (n - 1) * i128::from(stage.padding) + 2 * i128::from(stage.margin);
            usize::try_from(size)
                .ok()
                .filter(|s| *s > 0)
                .ok_or("invalid tile dimensions")
        };
        if canvas.is_none() {
            let (dw, dh) = (dim(stage.cols, w)?, dim(stage.rows, h)?);
            if dw.saturating_mul(dh) > limit.saturating_sub(cell.pixels.len() * 4) / 4 {
                return Err("image exceeds memory budget");
            }
            canvas = Some(raster(dw, dh, vec![[0, 0, 0, 255]; dw * dh]));
        }
        let dst = canvas.as_mut().unwrap();
        let x = i128::from(stage.margin)
            + (k % stage.cols) as i128 * (i128::from(w) + i128::from(stage.padding));
        let y = i128::from(stage.margin)
            + (k / stage.cols) as i128 * (i128::from(h) + i128::from(stage.padding));
        if x < 0
            || y < 0
            || x + i128::from(w) > dst.width as i128
            || y + i128::from(h) > dst.height as i128
        {
            return Err("offset is out of bounds");
        }
        for (dy, row) in cell.pixels.chunks_exact(cell.width).enumerate() {
            let i = (y as usize + dy) * dst.width + x as usize;
            dst.pixels[i..i + cell.width].copy_from_slice(row);
        }
    }
    canvas.ok_or("missing tile frame")
}

pub(super) fn encode(
    w: usize,
    h: usize,
    times: impl Iterator<Item = (f64, f64)>,
    opts: Options<'_>,
    image: impl FnMut(usize) -> Result<Raster, &'static str>,
) -> Result<Vec<u8>, &'static str> {
    let header =
        |w, h, fps| format!("YUV4MPEG2 W{w} H{h} F{fps}:1 Ip A1:1 C420jpeg\n").into_bytes();
    if opts.no_video {
        return Ok(header(64, 64, 10));
    }
    let limit = opts.limit;
    let mut out = Vec::new();
    render_frames(w, h, times, opts, image, |im, duration| {
        if out.is_empty() {
            out = header(im.width, im.height, (1. / duration).round().max(1.) as u32)
        }
        out.extend_from_slice(b"FRAME\n");
        append_planes(&mut out, &im, limit)
    })?;
    if out.is_empty() {
        out = header(w, h, 30)
    }
    Ok(out)
}
pub(super) fn render_frames(
    w: usize,
    h: usize,
    times: impl Iterator<Item = (f64, f64)>,
    opts: Options<'_>,
    mut image: impl FnMut(usize) -> Result<Raster, &'static str>,
    mut emit: impl FnMut(Raster, f64) -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    let mut frames = Vec::new();
    for (index, (pts, duration)) in times.enumerate() {
        if pts + duration > opts.start && opts.end.is_none_or(|t| pts < t) {
            if frames.len() >= opts.limit / size_of::<TimedFrame>() {
                return Err("frame index exceeds memory budget");
            }
            frames.push(TimedFrame {
                index,
                pts: (pts - opts.start).max(0.),
                duration,
            });
        }
    }
    let mut ops = Vec::new();
    let mut stages = Vec::new();
    for stage in opts
        .filters
        .iter()
        .flat_map(|s| s.split(','))
        .map(str::trim)
    {
        let (key, arg) = stage.split_once('=').unwrap_or((stage, ""));
        match key {
            "tile" if !frames.is_empty() => {
                let layout = arg
                    .split(':')
                    .find_map(|s| s.strip_prefix("layout="))
                    .or_else(|| arg.split(':').next())
                    .unwrap_or("");
                let (cols, rows) = layout.split_once(['x', 'X']).unwrap_or((layout, ""));
                let dimension = |s: &str| {
                    s.parse::<i32>()
                        .ok()
                        .filter(|&n| n != 0)
                        .unwrap_or(2)
                        .max(1) as usize
                };
                let (cols, rows) = (dimension(cols), dimension(rows));
                let setting = |key: &str| {
                    arg.split(':')
                        .filter_map(|s| s.split_once('='))
                        .find(|(k, _)| *k == key)
                        .and_then(|(_, v)| v.parse::<i64>().ok())
                        .unwrap_or(0)
                };
                let (margin, padding) = (setting("margin"), setting("padding"));
                if cols == 1 && rows == 1 && margin == 0 {
                    continue;
                }
                // Each nested tile renders one child layer on the Wasm stack.
                if stages.len() >= 64 {
                    return Err("video tile nesting limit exceeded");
                }
                let previous = std::mem::take(&mut frames);
                frames = previous
                    .chunks(cols.saturating_mul(rows))
                    .enumerate()
                    .map(|(index, group)| TimedFrame {
                        index,
                        pts: group[0].pts,
                        duration: group.iter().map(|f| f.duration).sum(),
                    })
                    .collect();
                stages.push(TileStage {
                    cols,
                    rows,
                    margin,
                    padding,
                    inputs: previous,
                    filters: std::mem::take(&mut ops),
                });
            }
            "reverse" | "setpts" => {
                let mut factor = 1.;
                if key == "reverse" {
                    frames.reverse();
                } else {
                    let expr = arg.trim_start_matches("expr=").trim().to_ascii_uppercase();
                    if let Some(mult) = expr
                        .strip_suffix("PTS")
                        .and_then(|s| s.trim_end().strip_suffix('*'))
                    {
                        factor = mult.trim().parse().ok().filter(|v| *v != 0.).unwrap_or(1.);
                    } else if let Some(div) = expr
                        .strip_prefix("PTS")
                        .and_then(|s| s.trim_start().strip_prefix('/'))
                    {
                        factor = 1. / div.trim().parse().ok().filter(|v| *v != 0.).unwrap_or(1.);
                    }
                }
                let mut pts = 0.;
                for f in &mut frames {
                    f.pts = pts;
                    if key == "setpts" {
                        f.duration = (f.duration * factor).max(0.001);
                    }
                    pts += f.duration;
                }
            }
            "fps" if !frames.is_empty() => {
                let rate = arg
                    .trim_start_matches("fps=")
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v > 0.)
                    .unwrap_or(25.);
                let total: f64 = frames.iter().map(|f| f.duration).sum();
                let n = (total * rate).round().max(1.) as usize;
                if n > opts.limit / size_of::<TimedFrame>() {
                    return Err("frame index exceeds memory budget");
                }
                frames = (0..n)
                    .map(|i| TimedFrame {
                        index: frames
                            [((i as f64 / n as f64) * frames.len() as f64).floor() as usize]
                            .index,
                        pts: i as f64 / rate,
                        duration: 1. / rate,
                    })
                    .collect();
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
                let end = duration.map_or(end, |d| start + d);
                frames.retain_mut(|f| {
                    let keep = f.pts + f.duration > start && f.pts < end;
                    f.pts = (f.pts - start).max(0.);
                    keep
                });
            }
            _ => ops.push(super::video_filter::Filter::new(key, arg)),
        }
    }
    if let Some(n) = opts.frames {
        frames.truncate(n.max(1) as usize);
    }
    if frames.is_empty() {
        return Ok(());
    }
    if w.saturating_mul(h) > opts.limit / 4 {
        return Err("image exceeds memory budget");
    }
    for frame in frames {
        let mut im = render(&stages, frame.index, opts.limit, &mut image)?;
        for op in &ops {
            op.apply(&mut im, opts.limit)?;
        }
        emit(im, frame.duration)?;
    }
    Ok(())
}
