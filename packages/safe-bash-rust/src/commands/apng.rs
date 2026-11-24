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
    source: std::ops::Range<usize>,
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
        let mut frame_start = 0;
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
                            source: frame_start..p,
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
                    frame_start = p;
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

fn average_rate(packets: &[super::media_probe::Packet]) -> String {
    let count = packets.len().saturating_sub(2) as u64;
    let ticks = packets.iter().skip(2).map(|p| p.ticks as u64).sum::<u64>();
    if count == 0 || ticks == 0 { return "0/0".into(); }
    // Reduce the observed average with FFmpeg's 60,000 numerator/denominator
    // bound, then choose a standard rate when it is within one percent.
    let (mut num, mut den) = (count * 100000, ticks);
    let (mut prior, mut rate) = ((0u64, 1u64), (1u64, 0u64));
    while den != 0 {
        let mut whole = num / den;
        let next = (whole * rate.0 + prior.0, whole * rate.1 + prior.1);
        if next.0 > 60000 || next.1 > 60000 {
            if rate.0 != 0 { whole = (60000 - prior.0) / rate.0; }
            if rate.1 != 0 { whole = whole.min((60000 - prior.1) / rate.1); }
            if u128::from(den) * u128::from(2 * whole * rate.1 + prior.1) > u128::from(num) * u128::from(rate.1) {
                rate = (whole * rate.0 + prior.0, whole * rate.1 + prior.1);
            }
            break;
        }
        (prior, rate) = (rate, next);
        (num, den) = (den, num % den);
    }
    let mut best = 0.01;
    let fps = rate.0 as f64 / rate.1 as f64;
    for numerator in super::y4m::standard_rates() {
        let error = (fps / (numerator as f64 / 12012.) - 1.).abs();
        if error < best { best = error; rate = (numerator, 12012); }
    }
    super::media_probe::ratio(rate.0, rate.1, '/')
}

pub(super) fn report(
    bytes: &[u8],
    filename: &str,
    limit: usize,
    mut opts: super::media_probe::ProbeOptions<'_>,
) -> Result<String, &'static str> {
    use super::media_probe::{self, Codec, Packet};
    use crate::commands::structured::JVal::{Number, Object, Str};
    let doc = Document::read(bytes, &mut { limit })?;
    let extra_end = doc.frames[0].source.start;
    let (mut aspect, mut transparent) = (None, false);
    let mut offset = 8;
    while offset < extra_end {
        let size = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let data = &bytes[offset + 8..offset + 8 + size];
        match &bytes[offset + 4..offset + 8] {
            b"tRNS" => transparent = true,
            b"pHYs" if size == 9 => {
                let x = u32::from_be_bytes(data[..4].try_into().unwrap());
                let y = u32::from_be_bytes(data[4..8].try_into().unwrap());
                aspect = (x != 0 && y != 0).then_some((u64::from(x), u64::from(y)));
            }
            _ => (),
        }
        offset += size + 12;
    }
    let depth = bytes[24];
    let pixel = match (bytes[25], depth, transparent) {
        (0, 16, false) => "gray16be", (0, 1, false) => "monob", (0, _, false) => "gray",
        (0 | 4, 16, _) => "ya16be", (0 | 4, _, _) => "ya8",
        (2, 16, false) => "rgb48be", (2, _, false) => "rgb24",
        (2 | 6, 16, _) => "rgba64be", _ => "rgba",
    };
    let packets: Vec<_> = doc.frames.iter().scan(0i64, |pts, frame| {
        let data = &bytes[frame.source.start + 8..frame.source.start + 34];
        let mut num = u64::from(u16::from_be_bytes(data[20..22].try_into().unwrap()));
        let mut den = u64::from(u16::from_be_bytes(data[22..24].try_into().unwrap()));
        if den == 0 { den = 100; }
        if num == 0 { num = 1; den = 15; }
        let ticks = (num * 100000 + den / 2) / den;
        let word = |i| u32::from_be_bytes(data[i..i + 4].try_into().unwrap()) as usize;
        let key = word(4) == doc.width && word(8) == doc.height && word(12) == 0 && word(16) == 0
            && (data[24] == 1 || data[25] == 0 || word(0) == 0 && data[24] == 2);
        let packet = Packet { pts: *pts, dts: *pts, ticks: ticks as f64, size: frame.source.len() as u64, pos: frame.source.start as u64, key };
        *pts += ticks as i64;
        Some(packet)
    }).collect();
    let probe_end = packets.get(2).map_or(0, |p| p.pts) + 500000;
    let probed = packets.partition_point(|p| p.pts < probe_end);
    let rate = super::y4m::guess_rate(100000, || packets[..probed].iter().map(|p| p.dts as u64));
    let rate = media_probe::ratio(rate.0, rate.1, '/');
    let average = average_rate(&packets[..probed]);
    let optional = !matches!(opts.writer, "json" | "xml");
    let counts = (opts.counts.0 || opts.show.contains("frame"), opts.counts.1 || opts.show.contains("packet"));
    if opts.show.contains("frame") && opts.show.contains("packet") {
        opts.show.remove("frame"); opts.show.remove("packet"); opts.show.insert("packet_frame");
    }
    let enabled = media_probe::selected(opts.select, "video", 0, 0);
    let codec = Codec::Video { tag: b"apng", width: Some(doc.width as i64), height: Some(doc.height as u32) };
    media_probe::report(opts, |section| match section {
        "stream" if enabled => {
            let mut row = vec![
                ("index", Number(0., None)), ("codec_name", Str("apng".into())),
                ("codec_long_name", Str("APNG (Animated Portable Network Graphics) image".into())),
            ];
            if optional { row.push(("profile", Str("unknown".into()))); }
            row.extend([
                ("codec_type", Str("video".into())), ("codec_tag_string", Str("[0][0][0][0]".into())), ("codec_tag", Str("0x0000".into())),
                ("width", Number(doc.width as f64, None)), ("height", Number(doc.height as f64, None)),
                ("coded_width", Number(doc.width as f64, None)), ("coded_height", Number(doc.height as f64, None)),
                ("closed_captions", Number(0., None)), ("film_grain", Number(0., None)), ("has_b_frames", Number(0., None)),
            ]);
            if let Some((n, d)) = aspect {
                row.extend([("sample_aspect_ratio", Str(media_probe::ratio(n, d, ':'))), ("display_aspect_ratio", Str(media_probe::ratio(n * doc.width as u64, d * doc.height as u64, ':')))]);
            } else if optional { row.extend([("sample_aspect_ratio", Str("N/A".into())), ("display_aspect_ratio", Str("N/A".into()))]); }
            row.extend([("pix_fmt", Str(pixel.into())), ("level", Number(-99., None)), ("color_range", Str("pc".into())), ("color_space", Str("gbr".into()))]);
            if optional { row.extend([("color_transfer", Str("unknown".into())), ("color_primaries", Str("unknown".into())), ("chroma_location", Str("unspecified".into())), ("field_order", Str("unknown".into()))]); }
            row.push(("refs", Number(1., None)));
            if optional { row.push(("id", Str("N/A".into()))); }
            row.extend([("r_frame_rate", Str(rate.clone())), ("avg_frame_rate", Str(average.clone())), ("time_base", Str("1/100000".into()))]);
            if optional {
                for key in ["start_pts", "start_time", "duration_ts", "duration", "bit_rate", "max_bit_rate", "bits_per_raw_sample", "nb_frames"] { row.push((key, Str("N/A".into()))); }
            }
            for (key, known) in [("nb_read_frames", counts.0), ("nb_read_packets", counts.1)] {
                if known { row.push((key, Str(packets.len().to_string()))); }
                else if optional { row.push((key, Str("N/A".into()))); }
            }
            row.push(("extradata_size", Number((extra_end - 8) as f64, None)));
            let mut disposition = media_probe::disposition(false);
            disposition.extend(["non_diegetic", "captions", "descriptions", "metadata", "dependent", "still_image"].map(|key| (key.into(), Number(0., None))));
            row.push(("disposition", Object(disposition)));
            Box::new(std::iter::once(row))
        }
        "format" => {
            let pipe = matches!(filename, "-" | "pipe:" | "pipe:0");
            let mut row = vec![
                ("filename", Str(if filename == "-" { "fd:" } else { filename }.into())), ("nb_streams", Number(1., None)), ("nb_programs", Number(0., None)), ("nb_stream_groups", Number(0., None)),
                ("format_name", Str("apng".into())), ("format_long_name", Str("Animated Portable Network Graphics".into())),
            ];
            if optional { row.extend([("start_time", Str("N/A".into())), ("duration", Str("N/A".into()))]); }
            if filename == "-" { row.push(("size", Str("0".into()))); }
            else if !pipe { row.push(("size", Str(bytes.len().to_string()))); }
            else if optional { row.push(("size", Str("N/A".into()))); }
            if optional { row.push(("bit_rate", Str("N/A".into()))); }
            row.push(("probe_score", Number(100., None)));
            Box::new(std::iter::once(row))
        }
        "packet" | "frame" | "packet_frame" if enabled => {
            let both = section == "packet_frame";
            Box::new(packets.iter().flat_map(move |packet| (0..if both { 2 } else { 1 }).map(move |part| {
                let frame = section == "frame" || both && part == 1;
                let mut row = codec.record(0, 100000, *packet, frame);
                if frame {
                    row.retain(|(key, _)| !matches!(*key, "pix_fmt" | "pict_type"));
                    for (key, value) in &mut row {
                        match *key {
                            "pkt_duration" => *key = "duration",
                            "pkt_duration_time" => *key = "duration_time",
                            "key_frame" => *value = Number(1., None),
                            _ => (),
                        }
                    }
                    let pos = row.iter().position(|(key, _)| *key == "pkt_size").unwrap();
                    row.insert(pos, ("pkt_pos", Str(packet.pos.to_string())));
                    row.extend(["crop_top", "crop_bottom", "crop_left", "crop_right"].map(|key| (key, Number(0., None))));
                    row.push(("pix_fmt", Str(pixel.into())));
                    if let Some((n, d)) = aspect { row.push(("sample_aspect_ratio", Str(media_probe::ratio(n, d, ':')))); }
                    else if optional { row.push(("sample_aspect_ratio", Str("N/A".into()))); }
                    row.extend([
                        ("pict_type", Str("I".into())), ("interlaced_frame", Number(0., None)), ("top_field_first", Number(0., None)), ("repeat_pict", Number(0., None)),
                        ("color_range", Str("pc".into())), ("color_space", Str("gbr".into())),
                    ]);
                    if optional { row.extend([("color_primaries", Str("unknown".into())), ("color_transfer", Str("unknown".into())), ("chroma_location", Str("unspecified".into()))]); }
                }
                if both { row.insert(0, ("type", Str(if frame { "frame" } else { "packet" }.into()))); }
                row
            })))
        }
        _ => Box::new(std::iter::empty()),
    })
}
