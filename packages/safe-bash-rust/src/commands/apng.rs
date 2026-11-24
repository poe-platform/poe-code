use super::{InputTime, png_pixels::Raster};

const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

pub(super) fn signature(bytes: &[u8]) -> bool {
    if !bytes.starts_with(SIGNATURE) {
        return false;
    }
    let mut p = 8usize;
    while let Some(header) = bytes.get(p..p.saturating_add(8)) {
        match &header[4..] {
            b"acTL" => return true,
            b"IDAT" | b"IEND" => return false,
            _ => (),
        }
        let Some(end) = p
            .checked_add(u32::from_be_bytes(header[..4].try_into().unwrap()) as usize)
            .and_then(|n| n.checked_add(12))
        else {
            return false;
        };
        p = end;
    }
    false
}

fn chunk(
    output: &mut Vec<u8>,
    tag: &[u8; 4],
    data: &[u8],
    limit: usize,
) -> Result<(), &'static str> {
    if data.len() > u32::MAX as usize
        || output.len().saturating_add(data.len()).saturating_add(12) > limit
    {
        return Err("APNG exceeds memory budget");
    }
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = output.len();
    output.extend_from_slice(tag);
    output.extend_from_slice(data);
    output.extend_from_slice(&crate::commands::codecs::crc32_ieee(&output[start..]).to_be_bytes());
    Ok(())
}

pub(super) struct Frame {
    pub pts: u64,
    pub duration: u64,
    pub packet: Vec<u8>,
    pub image: Raster,
}

pub(super) struct Document {
    pub width: usize,
    pub height: usize,
    pub frames: Vec<Frame>,
    pub ticks: u64,
}

struct Control {
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    duration: u64,
    dispose: u8,
    blend: u8,
}

impl Document {
    pub fn read(bytes: &[u8], remaining: &mut usize) -> Result<Self, &'static str> {
        if !bytes.starts_with(SIGNATURE) {
            return Err("Invalid APNG signature");
        }
        let mut doc = Self {
            width: 0,
            height: 0,
            frames: Vec::new(),
            ticks: 0,
        };
        let mut header = None;
        let mut canvas = Vec::new();
        let mut shared: Vec<([u8; 4], Vec<u8>)> = Vec::new();
        let mut control: Option<Control> = None;
        let mut packet = Vec::new();
        let mut pages = 0;
        let mut sequence = 0u32;
        let mut data = false;
        let mut seen_data = false;
        let mut p = 8usize;
        while p < bytes.len() {
            let h = bytes
                .get(p..p.saturating_add(8))
                .ok_or("Truncated APNG input")?;
            let length = u32::from_be_bytes(h[..4].try_into().unwrap()) as usize;
            let end = p
                .checked_add(length)
                .and_then(|n| n.checked_add(12))
                .filter(|&n| n <= bytes.len())
                .ok_or("Truncated APNG chunk")?;
            let payload = &bytes[p + 8..end - 4];
            match &h[4..] {
                b"IHDR" => {
                    if header.is_some() || length != 13 {
                        return Err("Invalid APNG header");
                    }
                    doc.width = u32::from_be_bytes(payload[..4].try_into().unwrap()) as usize;
                    doc.height = u32::from_be_bytes(payload[4..8].try_into().unwrap()) as usize;
                    let size = doc
                        .width
                        .checked_mul(doc.height)
                        .filter(|&n| n > 0)
                        .and_then(|n| n.checked_mul(4))
                        .ok_or("Invalid APNG canvas size")?;
                    if size > *remaining / 4 {
                        return Err("APNG exceeds memory budget");
                    }
                    *remaining -= size;
                    canvas.resize(size / 4, [0u8; 4]);
                    header = Some(payload.to_vec());
                }
                b"acTL" => {
                    if pages != 0 || seen_data || length != 8 {
                        return Err("Invalid APNG animation control");
                    }
                    pages = u32::from_be_bytes(payload[..4].try_into().unwrap());
                    if pages == 0 {
                        return Err("Invalid APNG frame count");
                    }
                }
                b"fcTL" | b"IEND" => {
                    if let Some(c) = control.take() {
                        if !data {
                            return Err("Missing APNG frame data");
                        }
                        chunk(&mut packet, b"IEND", &[], *remaining)?;
                        let size = canvas.len() * 4;
                        if size
                            .saturating_mul(3)
                            .saturating_add(packet.len())
                            .saturating_add(size_of::<Frame>())
                            > *remaining
                        {
                            return Err("APNG exceeds memory budget");
                        }
                        let image = Raster::decode(&packet, *remaining)?;
                        let previous = (c.dispose == 2).then(|| canvas.clone());
                        for y in 0..c.height {
                            for x in 0..c.width {
                                let target = &mut canvas[(c.y + y) * doc.width + c.x + x];
                                let pixel = image.pixels[y * c.width + x];
                                if c.blend == 0 {
                                    *target = pixel;
                                } else {
                                    let a = f64::from(pixel[3]) / 255.;
                                    let b = f64::from(target[3]) / 255. * (1. - a);
                                    let alpha = a + b;
                                    for ch in 0..3 {
                                        target[ch] = if alpha == 0. {
                                            0
                                        } else {
                                            ((f64::from(pixel[ch]) * a + f64::from(target[ch]) * b)
                                                / alpha)
                                                .round()
                                                as u8
                                        };
                                    }
                                    target[3] = (alpha * 255.).round() as u8;
                                }
                            }
                        }
                        *remaining -= size + packet.len() + size_of::<Frame>();
                        doc.frames.push(Frame {
                            pts: doc.ticks,
                            duration: c.duration,
                            packet: std::mem::take(&mut packet),
                            image: Raster {
                                width: doc.width,
                                height: doc.height,
                                alpha: true,
                                gray: false,
                                density: 72,
                                orientation: None,
                                pixels: canvas.clone(),
                            },
                        });
                        doc.ticks = doc
                            .ticks
                            .checked_add(c.duration)
                            .ok_or("APNG duration exceeds limit")?;
                        if let Some(previous) = previous {
                            canvas = previous;
                        } else if c.dispose == 1 {
                            for y in 0..c.height {
                                canvas[(c.y + y) * doc.width + c.x
                                    ..(c.y + y) * doc.width + c.x + c.width]
                                    .fill([0; 4]);
                            }
                        }
                    }
                    if &h[4..] == b"IEND" {
                        if pages == 0 || doc.frames.len() != pages as usize {
                            return Err("Invalid APNG frame count");
                        }
                        *remaining += canvas.len() * 4;
                        return Ok(doc);
                    }
                    if header.is_none()
                        || pages == 0
                        || length != 26
                        || doc.frames.len() >= pages as usize
                    {
                        return Err("Invalid APNG frame control");
                    }
                    if u32::from_be_bytes(payload[..4].try_into().unwrap()) != sequence {
                        return Err("Invalid APNG sequence");
                    }
                    sequence = sequence.checked_add(1).ok_or("Invalid APNG sequence")?;
                    let word =
                        |i| u32::from_be_bytes(payload[i..i + 4].try_into().unwrap()) as usize;
                    let numerator = u16::from_be_bytes(payload[20..22].try_into().unwrap());
                    let denominator = u16::from_be_bytes(payload[22..24].try_into().unwrap());
                    let c = Control {
                        width: word(4),
                        height: word(8),
                        x: word(12),
                        y: word(16),
                        duration: if numerator == 0 {
                            66667
                        } else {
                            (f64::from(numerator) * 1000000.
                                / f64::from(if denominator == 0 { 100 } else { denominator }))
                            .round() as u64
                        },
                        dispose: payload[24],
                        blend: payload[25],
                    };
                    if c.width == 0
                        || c.height == 0
                        || c.x.saturating_add(c.width) > doc.width
                        || c.y.saturating_add(c.height) > doc.height
                        || c.dispose > 2
                        || c.blend > 1
                    {
                        return Err("Invalid APNG frame bounds or operation");
                    }
                    let mut ihdr = header.as_ref().unwrap().clone();
                    ihdr[..4].copy_from_slice(&(c.width as u32).to_be_bytes());
                    ihdr[4..8].copy_from_slice(&(c.height as u32).to_be_bytes());
                    packet.extend_from_slice(SIGNATURE);
                    chunk(&mut packet, b"IHDR", &ihdr, *remaining)?;
                    control = Some(c);
                    data = false;
                }
                b"IDAT" | b"fdAT" => {
                    seen_data = true;
                    let mut payload = payload;
                    if &h[4..] == b"fdAT" {
                        if control.is_none() || length < 4 {
                            return Err("Invalid APNG frame data");
                        }
                        if u32::from_be_bytes(payload[..4].try_into().unwrap()) != sequence {
                            return Err("Invalid APNG sequence");
                        }
                        sequence = sequence.checked_add(1).ok_or("Invalid APNG sequence")?;
                        payload = &payload[4..];
                    }
                    if control.is_some() {
                        if !data {
                            for (tag, bytes) in &shared {
                                chunk(&mut packet, tag, bytes, *remaining)?;
                            }
                        }
                        for bytes in payload.chunks(16384) {
                            chunk(&mut packet, b"IDAT", bytes, *remaining)?;
                        }
                        data = true;
                    }
                }
                b"PLTE" | b"tRNS" if !seen_data => {
                    if length > 768 {
                        return Err("Invalid APNG palette");
                    }
                    *remaining = remaining
                        .checked_sub(length + size_of::<([u8; 4], Vec<u8>)>())
                        .ok_or("APNG exceeds memory budget")?;
                    shared.push((h[4..].try_into().unwrap(), payload.to_vec()));
                }
                _ => (),
            }
            p = end;
        }
        Err("Missing APNG end chunk")
    }

    pub fn frame_rate(&self) -> f64 {
        // APNG's native demuxer reports timestamps on a 100 kHz clock.
        // The default five-second duration probe starts after the first two
        // packets used to establish the decoder parameters.
        let end = self.frames.get(2).map_or(0, |f| f.pts).saturating_add(5_000_000);
        let (num, den) = super::y4m::guess_rate(100000, || self.frames.iter().take_while(|f| f.pts < end).map(|f| (f.pts + 5) / 10));
        num as f64 / den as f64
    }

    pub fn seconds(&self, seek: InputTime) -> f64 {
        let total = self.ticks as f64 / 1000000. * seek.loops.saturating_add(1) as f64;
        (seek.end().unwrap_or(total).min(total) - seek.start.unwrap_or(0.).max(0.)).max(0.)
    }

    pub fn times(
        &self,
        seek: InputTime,
        limit: usize,
    ) -> Result<impl Iterator<Item = (usize, f64, f64)> + '_, &'static str> {
        let count = self
            .frames
            .len()
            .checked_mul(seek.loops.saturating_add(1))
            .filter(|&n| n <= limit / size_of::<Frame>())
            .ok_or("frame index exceeds memory budget")?;
        let start = (seek.start.unwrap_or(0.).max(0.) * 1000000.).round() as u64;
        let end = (seek.end().unwrap_or(f64::INFINITY) * 1000000.).round() as u64;
        Ok((0..count).filter_map(move |i| {
            let index = i % self.frames.len();
            let f = &self.frames[index];
            let pts = f
                .pts
                .saturating_add(self.ticks.saturating_mul((i / self.frames.len()) as u64));
            (pts >= start && pts < end).then_some((
                index,
                pts.saturating_sub(start) as f64 / 1000000.,
                f.duration as f64 / 1000000.,
            ))
        }))
    }
}

pub(super) fn write(
    frames: &[(Raster, super::y4m::TimedFrame)],
    plays: u32,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let first = frames
        .first()
        .ok_or("No video frame in the requested presentation interval")?;
    let mut output = SIGNATURE.to_vec();
    let mut sequence = 0u32;
    let mut delay = 0.;
    for (i, (image, time)) in frames.iter().enumerate() {
        if (image.width, image.height) != (first.0.width, first.0.height) {
            return Err("APNG frames must have the same dimensions");
        }
        if image.pixels.len().saturating_mul(8) > limit.saturating_sub(output.len()) {
            return Err("APNG exceeds memory budget");
        }
        let png = super::pixel_png(
            image.width,
            image.height,
            super::PngEncoding::Unspecified,
            |x, y| image.pixels[y * image.width + x],
        );
        delay = if let Some((_, next)) = frames.get(i + 1) {
            (next.pts - time.pts) * 1000.
        } else if i > 0 {
            delay
        } else {
            time.duration * 1000.
        };
        let mut p = 8;
        while p < png.len() {
            let len = u32::from_be_bytes(png[p..p + 4].try_into().unwrap()) as usize;
            let data = &png[p + 8..p + 8 + len];
            match &png[p + 4..p + 8] {
                b"IHDR" => {
                    if i == 0 {
                        chunk(&mut output, b"IHDR", data, limit)?;
                        let count = u32::try_from(frames.len())
                            .map_err(|_| "APNG frame count exceeds limit")?;
                        let mut control = count.to_be_bytes().to_vec();
                        control.extend_from_slice(&plays.to_be_bytes());
                        chunk(&mut output, b"acTL", &control, limit)?;
                    }
                    let mut control = [0; 26];
                    control[..4].copy_from_slice(&sequence.to_be_bytes());
                    sequence = sequence
                        .checked_add(1)
                        .ok_or("APNG sequence exceeds limit")?;
                    control[4..8].copy_from_slice(&(image.width as u32).to_be_bytes());
                    control[8..12].copy_from_slice(&(image.height as u32).to_be_bytes());
                    let (mut numerator, mut denominator) = (delay.round().max(0.) as u64, 1000u64);
                    let (mut a, mut b) = (numerator, denominator);
                    while b != 0 {
                        (a, b) = (b, a % b);
                    }
                    numerator /= a;
                    denominator /= a;
                    if numerator > 65535 {
                        denominator = (65535 * denominator / numerator).max(1);
                        numerator = (delay * denominator as f64 / 1000.)
                            .round()
                            .clamp(0., 65535.) as u64;
                    }
                    control[20..22].copy_from_slice(&(numerator as u16).to_be_bytes());
                    control[22..24].copy_from_slice(&(denominator as u16).to_be_bytes());
                    chunk(&mut output, b"fcTL", &control, limit)?;
                }
                b"IDAT" if i == 0 => chunk(&mut output, b"IDAT", data, limit)?,
                b"IDAT" => {
                    let mut payload = sequence.to_be_bytes().to_vec();
                    sequence = sequence
                        .checked_add(1)
                        .ok_or("APNG sequence exceeds limit")?;
                    payload.extend_from_slice(data);
                    chunk(&mut output, b"fdAT", &payload, limit)?;
                }
                _ => (),
            }
            p += len + 12;
        }
    }
    chunk(&mut output, b"IEND", &[], limit)?;
    Ok(output)
}

pub(super) fn report(
    bytes: &[u8],
    filename: &str,
    limit: usize,
    mut opts: super::media_probe::ProbeOptions<'_>,
) -> Result<String, &'static str> {
    use super::media_probe::{self, Codec, Packet, StreamInfo};
    use crate::commands::structured::JVal::{Number, Object, Str};
    let doc = Document::read(bytes, &mut { limit })?;
    let counts = (
        opts.counts.0 || opts.show.contains("frame"),
        opts.counts.1 || opts.show.contains("packet"),
    );
    if opts.writer == "json" && opts.show.contains("frame") && opts.show.contains("packet") {
        opts.show.remove("frame");
        opts.show.remove("packet");
        opts.show.insert("packet_frame");
    }
    let select = opts.select;
    let codec = Codec::Video {
        tag: b"apng",
        width: Some(doc.width as i64),
        height: Some(doc.height as u32),
    };
    media_probe::report(opts, |section| {
        if section == "format" {
            let mut row = media_probe::format_row(
                filename,
                bytes.len(),
                ("apng", "Animated Portable Network Graphics"),
                1,
                doc.ticks as f64 / 1000000.,
                vec![],
            );
            row.insert(3, ("nb_stream_groups", Number(0., None)));
            return Box::new(std::iter::once(row));
        }
        if !media_probe::selected(select, "video", 0, 0) {
            return Box::new(std::iter::empty());
        }
        let rows: Box<dyn Iterator<Item = _>> = if section == "stream" {
            Box::new(std::iter::once(
                StreamInfo {
                    codec,
                    scale: 1000000,
                    start: 0,
                    ticks: doc.ticks as f64,
                    sample_ticks: doc.ticks as f64,
                    id: 1,
                    language: "und".into(),
                    profile: None,
                    count: doc.frames.len(),
                    payload_bytes: doc.frames.iter().map(|f| f.packet.len() as u64).sum(),
                    has_cts: false,
                }
                .stream(0, counts),
            ))
        } else if matches!(section, "frame" | "packet" | "packet_frame") {
            let both = section == "packet_frame";
            let want_frame = section == "frame";
            Box::new(
                doc.frames
                    .iter()
                    .scan(0u64, move |pos, f| {
                        let packet = Packet {
                            pts: f.pts as i64,
                            dts: f.pts as i64,
                            ticks: f.duration as f64,
                            size: f.packet.len() as u64,
                            pos: *pos,
                            key: true,
                        };
                        *pos += f.packet.len() as u64;
                        Some(packet)
                    })
                    .flat_map(move |packet| {
                        [false, true]
                            .into_iter()
                            .filter(move |&frame| both || frame == want_frame)
                            .map(move |frame| {
                                let mut row = codec.record(0, 1000000, packet, frame);
                                if both {
                                    row.insert(
                                        0,
                                        (
                                            "type",
                                            Str(if frame { "frame" } else { "packet" }.into()),
                                        ),
                                    );
                                }
                                row
                            })
                    }),
            )
        } else {
            Box::new(std::iter::empty())
        };
        Box::new(rows.map(|mut row| {
            row.retain(|(key, _)| {
                !matches!(
                    *key,
                    "sample_aspect_ratio"
                        | "display_aspect_ratio"
                        | "color_range"
                        | "color_space"
                        | "pict_type"
                )
            });
            for (key, value) in &mut row {
                match *key {
                    "pix_fmt" => *value = Str("rgba".into()),
                    "codec_tag" => *value = Str("0x676e7061".into()),
                    "flags" => *value = Str("K__".into()),
                    "disposition" => {
                        if let Object(values) = value {
                            values.extend(
                                [
                                    "non_diegetic",
                                    "captions",
                                    "descriptions",
                                    "metadata",
                                    "dependent",
                                    "still_image",
                                    "multilayer",
                                ]
                                .map(|key| (key.into(), Number(0., None))),
                            );
                        }
                    }
                    _ => (),
                }
            }
            row
        }))
    })
}
