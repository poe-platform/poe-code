use super::png_pixels::Raster;

pub(super) enum Frame {
    Rgb(Raster),
    Yuv420 { width: usize, height: usize, planes: Vec<u8> },
}

impl From<Raster> for Frame {
    fn from(image: Raster) -> Self { Self::Rgb(image) }
}

impl Frame {
    pub fn into_raster(self) -> Raster {
        match self {
            Self::Rgb(image) => image,
            Self::Yuv420 { width, height, planes } => decode(&planes, width, height, bt601),
        }
    }
    pub fn pixels(&self) -> usize {
        match self {
            Self::Rgb(image) => image.pixels.len(),
            Self::Yuv420 { width, height, .. } => width * height,
        }
    }
    pub fn bytes(&self) -> usize {
        match self {
            Self::Rgb(image) => image.pixels.capacity() * 4,
            Self::Yuv420 { planes, .. } => planes.capacity(),
        }
    }
}
pub(super) struct Stream<'a> {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_rate: (u32, u32),
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
        let (mut width, mut height, mut frame_rate) = (64u32, 64u32, (25, 1));
        for token in String::from_utf8_lossy(&input[..end]).split_whitespace() {
            if let Some(w) = token.strip_prefix('W') {
                width = integer(w, width)?;
            }
            if let Some(h) = token.strip_prefix('H') {
                height = integer(h, height)?;
            }
            if let Some(rate) = token.strip_prefix('F') {
                let mut parts = rate.split(':');
                frame_rate = (integer(parts.next().unwrap_or(""), 25)?,
                    integer(parts.next().unwrap_or(""), 1)?);
            }
        }
        let frame_size = (u64::from(width) * u64::from(height))
            .checked_add(2 * u64::from(width.div_ceil(2)) * u64::from(height.div_ceil(2)))
            .ok_or("Invalid YUV4MPEG2 dimensions or frame rate")?;
        Ok(Self {
            width,
            height,
            fps: f64::from(frame_rate.0) / f64::from(frame_rate.1),
            frame_rate,
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SyncMode { Auto, Cfr, Vfr, Passthrough, Drop }

impl SyncMode {
    pub(super) fn parse(value: &str, legacy: bool) -> Result<Self, &'static str> {
        match value.to_ascii_lowercase().as_str() {
            "auto" if !legacy => Ok(Self::Auto),
            "cfr" => Ok(Self::Cfr),
            "vfr" => Ok(Self::Vfr),
            "passthrough" => Ok(Self::Passthrough),
            "drop" => Ok(Self::Drop),
            _ if !legacy => Err("Invalid value specified for fps_mode"),
            _ => {
                let number = value.parse::<f64>().ok().filter(|v| !v.is_nan()).ok_or("Expected number for vsync")?;
                if !(-1. ..=2.).contains(&number) { return Err("Value for vsync is not within -1 - 2"); }
                if number.fract() != 0. { return Err("Expected int for vsync"); }
                Ok(match number as i32 { -1 => Self::Auto, 0 => Self::Passthrough, 1 => Self::Cfr, _ => Self::Vfr })
            }
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct Sync {
    pub mode: SyncMode,
    pub rate: Option<f64>,
}

impl Sync {
    pub(super) fn frame_rate(value: &str) -> Result<f64, &'static str> {
        let rate = if let Some((n, d)) = value.split_once('/') {
            n.parse::<f64>().ok().zip(d.parse::<f64>().ok()).map(|(n, d)| n / d)
        } else { value.parse::<f64>().ok() };
        rate.filter(|v| v.is_finite() && *v > 0.).ok_or("Invalid framerate value")
    }

    // Option values are parsed only after the last matching option is known.
    // Indices refer to output mapping order, including preceding audio streams.
    pub(super) fn resolve(
        options: &[(&str, &str)], fallback: Option<Self>, format: &str,
        index: usize, ordinal: usize, copy: bool,
    ) -> Result<Option<Self>, String> {
        let (mut mode, mut rate) = (None, None);
        for &(option, value) in options {
            let (name, selector) = option.split_once(':').unwrap_or((option, ""));
            if copy && name == "-fps_mode" { continue; }
            let (kind, number) = match selector.split_once(':') {
                Some((kind, number)) if matches!(kind, "v" | "V" | "a" | "s" | "d" | "t") => (kind, number),
                _ if matches!(selector, "v" | "V" | "a" | "s" | "d" | "t" | "u") => (selector, ""),
                _ => ("", selector),
            };
            let number = if number.is_empty() { None } else {
                let (digits, radix) = if let Some(hex) = number.strip_prefix("0x").or_else(|| number.strip_prefix("0X")) { (hex, 16) }
                    else if number.len() > 1 && number.starts_with('0') { (&number[1..], 8) }
                    else { (number, 10) };
                Some(usize::from_str_radix(digits, radix).ok().filter(|_| !digits.starts_with(['+', '-']))
                    .ok_or_else(|| format!("Invalid stream specifier: {selector}"))?)
            };
            if !matches!(kind, "" | "v" | "V" | "u") || number.is_some_and(|n| n != if kind.is_empty() { index } else { ordinal }) { continue; }
            if name == "-fps_mode" { mode = Some(value); } else { rate = Some(value); }
        }
        let rate = rate.map(Self::frame_rate).transpose()?;
        if copy { return Ok(None); }
        let mode = mode.map(|value| SyncMode::parse(value, false)).transpose()?;
        if mode.is_none() && rate.is_none() && fallback.is_none() { return Ok(None); }
        let mut mode = mode.or(fallback.map(|sync| sync.mode)).unwrap_or(SyncMode::Auto);
        if rate.is_some() && !matches!(mode, SyncMode::Auto | SyncMode::Cfr) {
            return Err("One of -r/-fpsmax was specified together a non-CFR -vsync/-fps_mode. This is contradictory.".into());
        }
        if mode == SyncMode::Auto && rate.is_none() && matches!(format, "mov" | "mkv" | "webm" | "avi" | "gif" | "apng") { mode = SyncMode::Vfr; }
        Ok(Some(Self { mode, rate }))
    }
}

pub(super) struct Options<'a> {
    pub sync: Option<Sync>,
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
        emit: impl FnMut(Frame, TimedFrame) -> Result<(), &'static str>,
    ) -> Result<(usize, usize, u32), String> {
        render_frames(
            self.width,
            self.height,
            (f64::from(rate_ratio(self.fps).0), Some(self.fps)),
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
    pub rate: f64,
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
    image: &mut impl FnMut(usize) -> Result<Frame, &'static str>,
) -> Result<Frame, String> {
    let Some((stage, prior)) = stages.split_last() else {
        let frame = image(index)?;
        charge_pixels(work, frame.pixels())?;
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
            cell = filter.apply_frame(cell, remaining)?;
            charge_pixels(work, cell.pixels())?;
        }
        let cell = cell.into_raster();
        let (w, h) = *cell_dimensions.get_or_insert((cell.width as i64, cell.height as i64));
        let dim = |n: usize, d: i64| -> Result<usize, &'static str> {
            let n = n as i128;
            let size =
                n * d as i128 + (n - 1) * i128::from(stage.padding) + 2 * i128::from(stage.margin);
            usize::try_from(size).ok().ok_or("invalid tile dimensions")
        };
        if canvas.is_none() {
            let (dw, dh) = (dim(stage.cols, w)?, dim(stage.rows, h)?);
            if dw.max(1).saturating_mul(dh.max(1)) > limit.saturating_sub(cell.pixels.len() * 4) / 4
            {
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
    canvas.map(Frame::Rgb).ok_or_else(|| "missing tile frame".into())
}

pub(super) fn standard_rates() -> impl Iterator<Item = u64> {
    (1..=360).map(|i| i * 1001u64)
        .chain((31..=60).map(|i| i * 12012)).chain([80, 120, 240].map(|i| i * 12012))
        .chain([24, 30, 60, 12, 15, 48].map(|i| i * 12000))
}

// Fit the observed decode timestamps to the same standard clocks used by
// FFmpeg. Callers control how many packets the demuxer probes.
pub(super) fn guess_rate<I: Iterator<Item = u64>>(scale: u32, timestamps: impl Fn() -> I) -> (u64, u64) {
    let mut previous = None;
    let (mut count, mut ticks, mut gcd) = (0usize, 0u64, 0u64);
    for timestamp in timestamps() {
        if let Some(last) = previous && timestamp > last {
            let delta = timestamp - last;
            ticks += delta;
            count += 1;
            if count > 3 {
                let mut divisor = delta;
                while divisor != 0 { (gcd, divisor) = (divisor, gcd % divisor); }
            }
        }
        previous = Some(timestamp);
    }
    if count > 15 && gcd > (u64::from(scale) / 500).max(1) {
        return (u64::from(scale), gcd);
    }
    let mut best = 0.01;
    let mut rate = 0;
    for numerator in standard_rates() {
        let fps = numerator as f64 / 12012.;
        if count <= 1 || fps < 1. || ticks as f64 / f64::from(scale) / (count as f64) < 0.8 / fps { continue; }
        let (mut sums, mut squares, mut seen, mut previous) = ([0.; 2], [0.; 2], 0usize, None);
        for timestamp in timestamps() {
            let last = previous.replace(timestamp);
            if last.is_none_or(|last| timestamp <= last) { continue; }
            seen += 1;
            let time = timestamp as f64 / f64::from(scale) * fps;
            for k in 0..2 {
                let value = time + k as f64 * 0.5;
                let error = value - value.round_ties_even();
                sums[k] += error; squares[k] += error * error;
            }
            if seen.is_multiple_of(10) && (0..2).all(|k| squares[k] / seen as f64 - (sums[k] / seen as f64).powi(2) > 0.04) {
                squares = [2e10; 2]; break;
            }
        }
        for k in 0..2 {
            let error = squares[k] / count as f64 - (sums[k] / count as f64).powi(2);
            if error < best && best > 1e-9 { best = error; rate = numerator; }
        }
    }
    if rate > 0 && rate as f64 / 12012. < 1.01 * f64::from(scale) { (rate, 12012) }
    else { (u64::from(scale), 1) }
}

pub(super) fn rate_ratio(ratio: f64) -> (u32, u32) {
    let mut value = ratio;
    let (mut numerator, mut denominator, mut previous_numerator, mut previous_denominator) =
        (1u64, 0u64, 0u64, 1u64);
    while value.is_finite() {
        let whole = value.floor() as u64;
        let next_numerator = whole
            .saturating_mul(numerator)
            .saturating_add(previous_numerator);
        let next_denominator = whole
            .saturating_mul(denominator)
            .saturating_add(previous_denominator);
        if next_numerator > i32::MAX as u64 || next_denominator > i32::MAX as u64 {
            break;
        }
        (previous_numerator, numerator) = (numerator, next_numerator);
        (previous_denominator, denominator) = (denominator, next_denominator);
        if (numerator as f64 / denominator as f64 - ratio).abs() <= ratio * 1e-12 {
            break;
        }
        value = 1. / (value - whole as f64);
    }
    (numerator as u32, denominator as u32)
}

pub(super) fn header(w: usize, h: usize, fps: f64) -> Vec<u8> {
    let (n, d) = rate_ratio(fps);
    format!("YUV4MPEG2 W{w} H{h} F{n}:{d} Ip A1:1 C420jpeg XYSCSS=420JPEG\n").into_bytes()
}
pub(super) fn render_frames<F: Into<Frame>>(
    w: usize,
    h: usize,
    (mut timescale, frame_rate): (f64, Option<f64>),
    times: impl Iterator<Item = (f64, f64)>,
    opts: Options<'_>,
    mut image: impl FnMut(usize) -> Result<F, &'static str>,
    mut emit: impl FnMut(Frame, TimedFrame) -> Result<(), &'static str>,
) -> Result<(), String> {
    let mut frames = Vec::new();
    for (index, (pts, duration)) in times.enumerate() {
        if (opts.start == 0. && opts.end.is_none())
            || (if opts.sync.is_some() { (pts * timescale).round() >= (opts.start * timescale).round() }
                else { ((pts + duration) * timescale).round() > (opts.start * timescale).round() })
                && opts.end.is_none_or(|t| (pts * timescale).round() < (t * timescale).round())
        {
            if frames.len() >= opts.limit / size_of::<TimedFrame>() {
                return Err("frame index exceeds memory budget".into());
            }
            frames.push(TimedFrame {
                index,
                buffer: Buffer::Input(index),
                rate: frame_rate.unwrap_or(1. / duration),
                pts: (pts - opts.start).max(0.),
                duration,
            });
        }
    }
    let mut end_time = frames.last().map_or(0., |f| f.pts + f.duration);
    let mut frame_rate = frame_rate.unwrap_or_else(|| frames.first().map_or(25., |f| 1. / f.duration));
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
                        rate: frame_rate / cols.saturating_mul(rows) as f64,
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
                frame_rate /= cols.saturating_mul(rows) as f64;
            }
            "reverse" | "setpts" => {
                let mut factor = 1.;
                if key == "reverse" {
                    // Reverse pictures while retaining the presentation clock,
                    // including gaps between loop iterations.
                    for i in 0..frames.len() / 2 {
                        let last = frames.len() - 1 - i;
                        let (left, right) = frames.split_at_mut(last);
                        std::mem::swap(&mut left[i].index, &mut right[0].index);
                        std::mem::swap(&mut left[i].buffer, &mut right[0].buffer);
                    }
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
                for f in &mut frames {
                    if key == "setpts" {
                        f.pts = ((f.pts * timescale).round() * factor).trunc() / timescale;
                        f.duration = (f.duration * factor).max(0.001);
                    }
                }
                if key == "setpts" {
                    end_time = ((end_time * timescale).round() * factor).trunc() / timescale;
                }
            }
            "fps" if !frames.is_empty() => {
                let rate = arg
                    .trim_start_matches("fps=")
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v > 0.)
                    .unwrap_or(25.);
                let first = (frames[0].pts * rate).round() as i64;
                let end = (end_time * rate).round() as i64;
                let n = end.saturating_sub(first) as usize;
                if n > opts.limit / size_of::<TimedFrame>() {
                    return Err("frame index exceeds memory budget".into());
                }
                let mut source = 0;
                frames = (first..end)
                    .map(|i| {
                        while source + 1 < frames.len()
                            && (frames[source + 1].pts * rate).round() as i64 <= i
                        {
                            source += 1;
                        }
                        let src = frames[source];
                        TimedFrame {
                            pts: i as f64 / rate,
                            duration: 1. / rate,
                            ..src
                        }
                    })
                    .collect();
                timescale = rate;
                frame_rate = rate;
                end_time = end as f64 / rate;
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
                        "duration" if !v.is_empty() => {
                            duration = Some(super::parse_ffmpeg_timestamp(v))
                        }
                        _ => {}
                    }
                }
                let end = duration.map_or(end, |d| start + d);
                end_time = end_time.min(end);
                frames.retain(|f| f.pts >= start && f.pts < end);
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
                        | "format"
                )
                {
                    for (i, f) in frames.iter_mut().enumerate() {
                        f.buffer = Buffer::Filtered(i);
                    }
                }
                ops.push(super::video_filter::Filter::new(key, arg));
            }
        }
    }
    if let Some(sync) = opts.sync {
        frames = synchronize(frames, sync, frame_rate, opts.frames, opts.limit)?;
        if let Some(end) = opts.end { frames.retain(|frame| frame.pts + opts.start < end); }
    }
    if let Some(n) = opts.frames {
        frames.truncate(n as usize);
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
    let mut image = |i| image(i).map(Into::into);
    for mut frame in frames {
        frame.rate = opts.sync.and_then(|sync| sync.rate).unwrap_or(frame_rate);
        let mut im = render(&stages, frame.index, opts.limit, &mut work, &mut image)?;
        for op in &ops {
            im = op.apply_frame(im, opts.limit)?;
            charge_pixels(&mut work, im.pixels())?;
        }
        emit(im, frame)?;
    }
    Ok(())
}

fn synchronize(frames: Vec<TimedFrame>, sync: Sync, source_rate: f64, cap: Option<u32>, limit: usize) -> Result<Vec<TimedFrame>, &'static str> {
    if frames.is_empty() { return Ok(frames); }
    let rate = sync.rate.unwrap_or(source_rate);
    if !rate.is_finite() || rate <= 0. { return Err("Invalid video frame rate"); }
    let mut output = Vec::new();
    let mut next = 0i64;
    let mut previous = None;
    let mut history = [0usize; 3];
    let max = cap.map_or(usize::MAX, |n| n as usize);
    for frame in frames {
        let mut pts = frame.pts * rate;
        let mut duration = frame.duration * rate;
        let mut drift = pts - next as f64;
        let mut delta = drift + duration;
        let mut count = 1usize;
        let mut repeat_previous = 0usize;
        if drift < 0. && delta > 0. && !matches!(sync.mode, SyncMode::Passthrough | SyncMode::Drop) {
            pts = next as f64;
            duration += drift;
            drift = 0.;
        }
        match sync.mode {
            SyncMode::Auto | SyncMode::Cfr => {
                if sync.mode == SyncMode::Auto && output.is_empty() && drift >= 0.5 {
                    delta = duration;
                    drift = 0.;
                    next = pts.round() as i64;
                }
                if delta < -1.1 { count = 0; }
                else if delta > 1.1 {
                    count = (delta as f32).round_ties_even().max(0.) as usize;
                    if drift > 1.1 { repeat_previous = ((drift - 0.6) as f32).round_ties_even().max(0.) as usize; }
                }
                duration = 1.;
            }
            SyncMode::Vfr => {
                if delta <= -0.6 { count = 0; }
                else if delta > 0.6 { next = pts.round() as i64; }
                duration = duration.round();
            }
            SyncMode::Passthrough => { next = pts.round() as i64; duration = duration.round(); }
            SyncMode::Drop => { duration = duration.round(); }
        }
        history.rotate_right(1);
        history[0] = repeat_previous;
        count = count.min(max.saturating_sub(output.len()));
        if count > (limit / size_of::<TimedFrame>()).saturating_sub(output.len()) { return Err("frame index exceeds memory budget"); }
        for i in 0..count {
            let source = if i < repeat_previous { previous.unwrap_or(frame) } else { frame };
            output.push(TimedFrame { pts: next as f64 / rate, duration: duration / rate, ..source });
            next += 1;
        }
        previous = Some(frame);
        if output.len() == max { break; }
    }
    if let Some(frame) = previous {
        history.sort_unstable();
        let count = history[1].min(max.saturating_sub(output.len()));
        if count > (limit / size_of::<TimedFrame>()).saturating_sub(output.len()) { return Err("frame index exceeds memory budget"); }
        for _ in 0..count {
            output.push(TimedFrame { pts: next as f64 / rate, duration: 1. / rate, ..frame });
            next += 1;
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fps_selects_variable_duration_frames_by_presentation_time() {
        let spec = super::super::lavfi::Video::parse("color=s=2x2:r=10:d=1").unwrap();
        let mut selected = Vec::new();
        render_frames(
            2,
            2,
            (1000000., None),
            [(0., 0.2), (0.2, 0.4), (0.6, 0.2)].into_iter(),
            Options {sync: None,
                filters: &["fps=10".into()],
                frames: None,
                start: 0.,
                end: None,
                no_video: false,
                limit: 65536,
            },
            |i| {
                let mut image = spec.image(i);
                image.pixels.fill([i as u8, 0, 0, 255]);
                Ok(image)
            },
            |image, _| {
                selected.push(image.into_raster().pixels[0][0]);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(selected, [0, 0, 1, 1, 1, 1, 2, 2]);
    }

    #[test]
    fn repeated_frames_cannot_hide_pixel_work_behind_a_small_encoded_output() {
        let spec = super::super::lavfi::Video::parse("color=s=128x128:r=100:d=1").unwrap();
        let result = render_frames(
            128,
            128,
            (100., None),
            (0..100).map(|i| (i as f64 / 100., 0.01)),
            Options {sync: None,
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
