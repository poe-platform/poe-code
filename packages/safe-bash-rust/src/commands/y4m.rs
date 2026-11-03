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
        orientation: None,
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

fn raw_rgb(y: i32, u: i32, v: i32) -> [u8; 4] {
    let c = y.max(0) * 298;
    let sat = |n: i32| ((n + 128) >> 8).clamp(0, 255) as u8;
    [
        sat(c + 409 * v),
        sat(c - 100 * u - 208 * v),
        sat(c + 516 * u),
        255,
    ]
}

// Y4M retains decoded frames and raw packets. Trims select frames by their
// visible interval, while packets keep their original bytes and a clipped duration.
pub(super) struct Clip<'a> {
    pub width: usize,
    pub height: usize,
    fps: f64,
    frames: Vec<&'a [u8]>,
    first: usize,
    pub frames_per_copy: usize,
    pub packet_size: Option<u32>,
    count: usize,
    start: f64,
    tick: u64,
    packet_first: usize,
    period: u64,
    copies: usize,
    pub origin: u64,
}

impl<'a> Stream<'a> {
    pub fn clip(&self, seek: super::InputTime, limit: usize) -> Result<Clip<'a>, &'static str> {
        let mut frames = Vec::new();
        for f in self.frames() {
            if frames.len() >= limit / size_of::<&[u8]>() {
                return Err("frame index exceeds memory budget");
            }
            frames.push(f);
        }
        let duration = 1. / self.fps;
        let start = seek.start.unwrap_or(0.).max(0.);
        let end = seek.end().unwrap_or(frames.len() as f64 / self.fps);
        let pts = |i: usize| i as f64 / self.fps;
        let first = (0..frames.len())
            .find(|&i| pts(i) + duration > start)
            .unwrap_or(frames.len());
        let kept = (first..frames.len()).take_while(|&i| pts(i) < end).count();
        let count = kept
            .checked_mul(seek.loops.saturating_add(1))
            .filter(|&n| n <= limit / size_of::<TimedFrame>())
            .ok_or("frame index exceeds memory budget")?;

        // Concatenation places each copy after the retained packets on the 90 kHz
        // clock. The first packet may start before the requested cut.
        let tick = (90000. / self.fps).round().max(1.) as u64;
        let total_ticks = (frames.len() as u64).saturating_mul(tick);
        let cut = seek.start.is_some() || seek.end().is_some();
        let start_tick = (start * 90000.).round() as u64;
        let end_tick = if cut {
            ((end * 90000.).round() as u64).min(total_ticks)
        } else {
            total_ticks
        };
        let clip_ticks = if start_tick >= end_tick {
            0
        } else {
            end_tick - start_tick / tick * tick
        };
        let copies = seek.loops.saturating_add(1);
        if clip_ticks.div_ceil(tick).saturating_mul(copies as u64)
            > (limit / size_of::<TimedFrame>()) as u64
        {
            return Err("frame index exceeds memory budget");
        }
        let clip = Clip {
            width: self.width as usize,
            height: self.height as usize,
            fps: self.fps,
            frames,
            first,
            frames_per_copy: kept,
            packet_size: (!cut).then_some(self.frame_size as u32),
            count,
            start,
            tick,
            packet_first: (start_tick / tick) as usize,
            period: clip_ticks,
            copies,
            origin: if clip_ticks > 0 && copies == 1 {
                start_tick % tick
            } else {
                0
            },
        };
        if cut && clip.period > 0 {
            clip.check_packet(clip.packet_first)?;
        }
        Ok(clip)
    }
}
impl<'a> Clip<'a> {
    // sliceMp4 tests the fifth payload byte when promoting its first packet,
    // including raw RGBA packets. Here that byte is the second pixel's red channel.
    fn check_packet(&self, index: usize) -> Result<(), &'static str> {
        let pixels = self.width * self.height;
        if pixels < 2 {
            return Ok(());
        }
        let data = self.frames[index];
        let chroma = (data.len() - pixels) / 2;
        let red = raw_rgb(
            i32::from(data[1]) - 16,
            i32::from(data[pixels]) - 128,
            i32::from(data[pixels + chroma]) - 128,
        )[0];
        if red & 31 == 1 {
            Err("H.264 packet decode failed (-1094995529)")
        } else {
            Ok(())
        }
    }
    pub fn check_slice(&self, start: f64, end: f64) -> Result<(), &'static str> {
        let from = self.origin.saturating_add((start * 90000.).round() as u64);
        let until = self
            .origin
            .saturating_add((end.min(self.seconds()) * 90000.).round() as u64);
        if from < until && from < self.media_ticks() {
            self.check_packet(self.packet_first + ((from % self.period) / self.tick) as usize)?;
        }
        Ok(())
    }
    pub fn media_ticks(&self) -> u64 {
        self.period.saturating_mul(self.copies as u64)
    }
    pub fn seconds(&self) -> f64 {
        if self.origin != 0 {
            ((self.period - self.origin) as f64 / 90.).round() / 1000.
        } else {
            self.media_ticks() as f64 / 90000.
        }
    }
    pub fn times(&self) -> impl Iterator<Item = (f64, f64)> {
        (0..self.count).map(|i| {
            (
                ((self.first + i % self.frames_per_copy) as f64 / self.fps - self.start).max(0.)
                    + ((i / self.frames_per_copy) as f64 * self.period as f64) / 90000.,
                1. / self.fps,
            )
        })
    }
    pub fn packets(&self) -> impl Iterator<Item = (&'a [u8], u32)> {
        let n = self.period.div_ceil(self.tick) as usize;
        (0..n * self.copies).map(move |i| {
            let j = i % n;
            (
                self.frames[self.packet_first + j],
                self.tick.min(self.period - j as u64 * self.tick) as u32,
            )
        })
    }
    pub fn raster(&self, frame: &[u8]) -> Raster {
        decode(frame, self.width, self.height, raw_rgb)
    }
    pub fn image(&self, i: usize) -> Raster {
        self.raster(self.frames[self.first + i % self.frames_per_copy])
    }
    pub fn render(
        &self,
        options: Options<'_>,
        emit: impl FnMut(Raster, TimedFrame) -> Result<(), &'static str>,
    ) -> Result<(usize, usize, u32), String> {
        render_frames(
            self.width,
            self.height,
            self.times(),
            options,
            |i| Ok(self.image(i)),
            emit,
        )?;
        Ok((self.width, self.height, 30))
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Buffer {
    Input(usize),
    Filtered(usize),
}

#[derive(Clone, Copy)]
pub(super) struct TimedFrame {
    index: usize,
    pub buffer: Buffer,
    pub pts: f64,
    pub duration: f64,
}

struct TileStage<'a> {
    cols: usize,
    rows: usize,
    margin: i64,
    padding: i64,
    inputs: Vec<TimedFrame>,
    filters: Vec<super::video_filter::Filter<'a>>,
}

fn charge_pixels(remaining: &mut usize, pixels: usize) -> Result<(), &'static str> {
    *remaining = remaining
        .checked_sub(pixels)
        .ok_or("video pixel work limit exceeded")?;
    Ok(())
}

// Resolve only the cells used by this output; a frame cap or trim need not render the rest.
fn render(
    stages: &[TileStage<'_>],
    index: usize,
    limit: usize,
    work: &mut usize,
    image: &mut impl FnMut(usize) -> Result<Raster, &'static str>,
) -> Result<Raster, String> {
    let Some((stage, prior)) = stages.split_last() else {
        let frame = image(index)?;
        charge_pixels(work, frame.pixels.len())?;
        return Ok(frame);
    };
    let per = stage.cols.saturating_mul(stage.rows);
    let start = index * per;
    let mut canvas: Option<Raster> = None;
    let mut cell_dimensions = None;
    for (k, entry) in stage.inputs[start..].iter().take(per).enumerate() {
        let remaining = limit - canvas.as_ref().map_or(0, |c| c.pixels.len() * 4);
        let mut cell = render(prior, entry.index, remaining, work, image)?;
        for filter in &stage.filters {
            filter.apply(&mut cell, remaining)?;
            charge_pixels(work, cell.pixels.len())?;
        }
        let (w, h) = *cell_dimensions.get_or_insert((cell.width as i64, cell.height as i64));
        let dim = |n: usize, d: i64| -> Result<usize, &'static str> {
            let n = n as i128;
            let size =
                n * d as i128 + (n - 1) * i128::from(stage.padding) + 2 * i128::from(stage.margin);
            usize::try_from(size)
                .ok()
                .ok_or("invalid tile dimensions")
        };
        if canvas.is_none() {
            let (dw, dh) = (dim(stage.cols, w)?, dim(stage.rows, h)?);
            if dw.max(1).saturating_mul(dh.max(1)) > limit.saturating_sub(cell.pixels.len() * 4) / 4 {
                return Err("image exceeds memory budget".into());
            }
            charge_pixels(work, dw * dh)?;
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
            return Err("offset is out of bounds".into());
        }
        for (dy, row) in cell
            .pixels
            .chunks_exact(cell.width.max(1))
            .take(h as usize)
            .enumerate()
        {
            let i = (y as usize + dy) * dst.width + x as usize;
            let n = row.len().min(w as usize);
            dst.pixels[i..i + n].copy_from_slice(&row[..n]);
        }
    }
    canvas.ok_or_else(|| "missing tile frame".into())
}

pub(super) fn header(w: usize, h: usize, fps: u32) -> Vec<u8> {
    format!("YUV4MPEG2 W{w} H{h} F{fps}:1 Ip A1:1 C420jpeg\n").into_bytes()
}
pub(super) fn render_frames(
    w: usize,
    h: usize,
    times: impl Iterator<Item = (f64, f64)>,
    opts: Options<'_>,
    mut image: impl FnMut(usize) -> Result<Raster, &'static str>,
    mut emit: impl FnMut(Raster, TimedFrame) -> Result<(), &'static str>,
) -> Result<(), String> {
    let mut frames = Vec::new();
    for (index, (pts, duration)) in times.enumerate() {
        if (opts.start == 0. && opts.end.is_none())
            || pts + duration > opts.start && opts.end.is_none_or(|t| pts < t)
        {
            if frames.len() >= opts.limit / size_of::<TimedFrame>() {
                return Err("frame index exceeds memory budget".into());
            }
            frames.push(TimedFrame {
                index,
                buffer: Buffer::Input(index),
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
                    return Err("video tile nesting limit exceeded".into());
                }
                let previous = std::mem::take(&mut frames);
                frames = previous
                    .chunks(cols.saturating_mul(rows))
                    .enumerate()
                    .map(|(index, group)| TimedFrame {
                        index,
                        buffer: Buffer::Filtered(index),
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
                    return Err("frame index exceeds memory budget".into());
                }
                frames = (0..n)
                    .map(|i| {
                        let src =
                            frames[((i as f64 / n as f64) * frames.len() as f64).floor() as usize];
                        TimedFrame {
                            pts: i as f64 / rate,
                            duration: 1. / rate,
                            ..src
                        }
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
                    match k {
                        "start" => start = super::parse_ffmpeg_timestamp(v),
                        "end" if !v.is_empty() => end = super::parse_ffmpeg_timestamp(v),
                        "duration" if !v.is_empty() => duration = Some(super::parse_ffmpeg_timestamp(v)),
                        _ => {}
                    }
                }
                let end = duration.map_or(end, |d| start + d);
                frames.retain_mut(|f| {
                    let keep = f.pts + f.duration > start && f.pts < end;
                    f.pts = (f.pts - start).max(0.);
                    keep
                });
            }
            _ => {
                // A spatial transform gives each occurrence its own pixel buffer.
                if matches!(
                    key,
                    "hflip"
                        | "vflip"
                        | "scale"
                        | "crop"
                        | "pad"
                        | "negate"
                        | "transpose"
                        | "rotate"
                        | "drawbox"
                        | "drawtext"
                        | "subtitles"
                ) || key == "format" && arg.contains("gray")
                {
                    for (i, f) in frames.iter_mut().enumerate() {
                        f.buffer = Buffer::Filtered(i);
                    }
                }
                ops.push(super::video_filter::Filter::new(key, arg));
            }
        }
    }
    if let Some(n) = opts.frames {
        frames.truncate(n.max(1) as usize);
    }
    if frames.is_empty() {
        return Ok(());
    }
    if w.saturating_mul(h) > opts.limit / 4 {
        return Err("image exceeds memory budget".into());
    }
    // As with H.264 replay, allow 32 input budgets of work. Count RGBA pixels
    // even when identical frames compress to only a few bytes.
    let mut work = (opts.limit / 4).saturating_mul(32);
    for frame in frames {
        let mut im = render(&stages, frame.index, opts.limit, &mut work, &mut image)?;
        for op in &ops {
            op.apply(&mut im, opts.limit)?;
            charge_pixels(&mut work, im.pixels.len())?;
        }
        emit(im, frame)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_frames_cannot_hide_pixel_work_behind_a_small_encoded_output() {
        let spec = super::super::lavfi::Video::parse("color=s=128x128:r=100:d=1").unwrap();
        let result = render_frames(
            128,
            128,
            (0..100).map(|i| (i as f64 / 100., 0.01)),
            Options {
                filters: &[],
                frames: None,
                start: 0.,
                end: None,
                no_video: false,
                limit: 128 * 1024,
            },
            |i| Ok(spec.image(i)),
            |_, _| Ok(()),
        );
        assert_eq!(result, Err("video pixel work limit exceeded".into()));
    }
}
