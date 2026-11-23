use super::{ffmpeg_wave::Wave, mp4::mux::Remux};

const STEPS: [i32; 89] = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
    494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
    2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
    10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX: [i32; 8] = [-1, -1, -1, -1, 2, 4, 6, 8];
const COEFFICIENTS: [(i32, i32); 7] = [
    (256, 0),
    (512, -256),
    (0, 0),
    (192, 64),
    (240, 0),
    (460, -208),
    (392, -232),
];
const ADAPTATION: [i32; 16] = [
    230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230,
];

pub(super) fn frames(w: Wave<'_>) -> Result<usize, &'static str> {
    if w.tag == 69 {
        if w.channels != 1 || !(2..=5).contains(&w.bits) {
            return Err("G.726 WAV requires mono 2 to 5-bit audio");
        }
        let packet = packet_size(w)?;
        return w.data.chunks(packet).try_fold(0usize, |n, p| {
            p.len()
                .checked_mul(8)
                .and_then(|v| n.checked_add(v / usize::from(w.bits)))
                .ok_or("audio exceeds memory budget")
        });
    }
    if !matches!(w.channels, 1 | 2) || w.bits != 4 {
        return Err("ADPCM WAV requires mono or stereo 4-bit audio");
    }
    let block = usize::from(w.block_align);
    let header = if w.tag == 2 { 7 } else { 4 } * w.channels;
    if w.tag == 32 {
        return Ok(w.data.len() * 2 / w.channels);
    }
    if block < header || w.tag == 17 && !block.is_multiple_of(4 * w.channels) {
        return Err("Invalid ADPCM WAV block size");
    }
    let mut frames = 0;
    for packet in w.data.chunks(block) {
        if w.tag == 17 {
            let size = packet.len() / (4 * w.channels) * (4 * w.channels);
            if size >= header {
                frames += 1 + (size - header) * 2 / w.channels;
            }
        } else if packet.len() >= header {
            frames += 2 + (packet.len() - header) * 2 / w.channels;
        } else {
            return Err("Truncated MS ADPCM block header");
        }
    }
    Ok(frames)
}

pub(super) fn decode(w: Wave<'_>, limit: usize) -> Result<Vec<u8>, &'static str> {
    let count = frames(w)?;
    if w.tag == 69 {
        return super::g726::decode(w.data, w.bits as u8, false, packet_size(w)?, 0, 0, limit);
    }
    let size = count
        .checked_mul(w.channels * 2)
        .filter(|&n| n <= limit)
        .ok_or("ADPCM decoding exceeds memory budget")?;
    let mut out = vec![0; size];
    let mut frame = 0;
    let word = |bytes: &[u8], at| i16::from_le_bytes([bytes[at], bytes[at + 1]]) as i32;
    if w.tag == 32 {
        let mut predictors = [0i32; 2];
        let mut steps = [127i32; 2];
        for (i, sample) in out.chunks_exact_mut(2).enumerate() {
            let ch = i % w.channels;
            let nibble = (w.data[i / 2] >> (i % 2 * 4)) & 15;
            let magnitude = usize::from(nibble & 7);
            let delta = steps[ch] * (magnitude as i32 * 2 + 1) / 8;
            predictors[ch] = (predictors[ch] + if nibble & 8 != 0 { -delta } else { delta })
                .clamp(-32768, 32767);
            steps[ch] = (steps[ch] * ADAPTATION[magnitude] / 256).clamp(127, 24576);
            sample.copy_from_slice(&(predictors[ch] as i16).to_le_bytes());
        }
        return Ok(out);
    }
    for packet in w.data.chunks(usize::from(w.block_align)) {
        let header = if w.tag == 17 { 4 } else { 7 } * w.channels;
        let len = if w.tag == 17 {
            packet.len() / (4 * w.channels) * (4 * w.channels)
        } else {
            packet.len()
        };
        if len < header {
            continue;
        }
        if w.tag == 17
            && (0..w.channels)
                .any(|ch| u16::from_le_bytes([packet[ch * 4 + 2], packet[ch * 4 + 3]]) > 88)
        {
            continue;
        }
        let frames = if w.tag == 17 { 1 } else { 2 } + (len - header) * 2 / w.channels;
        for ch in 0..w.channels {
            let mut put = |i: usize, value: i32| {
                let at = ((frame + i) * w.channels + ch) * 2;
                out[at..at + 2].copy_from_slice(&(value as i16).to_le_bytes());
            };
            if w.tag == 17 {
                let mut predictor = word(packet, ch * 4);
                let mut index = i32::from(packet[ch * 4 + 2]);
                put(0, predictor);
                for i in 1..frames {
                    let n = i - 1;
                    let byte = packet[header + n / 8 * w.channels * 4 + ch * 4 + n % 8 / 2];
                    let nibble = byte >> (n % 2 * 4) & 15;
                    let step = STEPS[index as usize];
                    let delta = (step >> 3)
                        + if nibble & 1 != 0 { step >> 2 } else { 0 }
                        + if nibble & 2 != 0 { step >> 1 } else { 0 }
                        + if nibble & 4 != 0 { step } else { 0 };
                    predictor = (predictor + if nibble & 8 != 0 { -delta } else { delta })
                        .clamp(-32768, 32767);
                    index = (index + INDEX[usize::from(nibble & 7)]).clamp(0, 88);
                    put(i, predictor);
                }
            } else {
                let &(a, b) = COEFFICIENTS
                    .get(usize::from(packet[ch]))
                    .ok_or("Invalid MS ADPCM predictor")?;
                let mut delta = i16::from_le_bytes([
                    packet[w.channels + ch * 2],
                    packet[w.channels + ch * 2 + 1],
                ]) as i32;
                let mut recent = word(packet, w.channels * 3 + ch * 2);
                let mut previous = word(packet, w.channels * 5 + ch * 2);
                put(0, previous);
                put(1, recent);
                for i in 2..frames {
                    let n = (i - 2) * w.channels + ch;
                    let nibble = (packet[header + n / 2] >> if n % 2 == 0 { 4 } else { 0 }) & 15;
                    let value = ((recent * a + previous * b) / 256
                        + (if nibble < 8 {
                            i32::from(nibble)
                        } else {
                            i32::from(nibble) - 16
                        }) * delta)
                        .clamp(-32768, 32767);
                    previous = recent;
                    recent = value;
                    delta =
                        (delta * ADAPTATION[usize::from(nibble)] / 256).clamp(16, i32::MAX / 768);
                    put(i, value);
                }
            }
        }
        frame += frames;
    }
    if frame == 0 && w.data.len() >= w.channels * 4 {
        return Err("Invalid ADPCM audio data");
    }
    out.truncate(frame * w.channels * 2);
    Ok(out)
}

pub(super) fn encode(
    pcm: &[u8],
    rate: u32,
    channels: usize,
    opts: &Remux<'_>,
) -> Result<Vec<u8>, String> {
    if opts.audio_codec == Some("g726") {
        return super::g726::encode_wav(pcm, rate, channels, opts);
    }
    if !matches!(channels, 1 | 2) {
        return Err("ADPCM encoding supports mono or stereo audio".into());
    }
    let tag = match opts.audio_codec {
        Some("adpcm_ima_wav") => 17,
        Some("adpcm_ms") => 2,
        Some("adpcm_yamaha") => 32,
        _ => return Err("Unsupported ADPCM encoder".into()),
    };
    let block = if tag == 32 { 1024 } else { opts.block_size };
    if !(32..=8192).contains(&block) || !block.is_power_of_two() {
        return Err("Invalid block_size: expected a power of two from 32 to 8192".into());
    }
    if opts.trellis != 0 && tag != 17 {
        return Err("Trellis encoding requires IMA WAV".into());
    }
    let header = match tag {
        17 => 4 * channels,
        2 => 7 * channels,
        _ => 0,
    };
    let frames = (block - header) * 2 / channels
        + match tag {
            17 => 1,
            2 => 2,
            _ => 0,
        };
    let count = pcm.len() / (channels * 2);
    let size = count
        .div_ceil(frames)
        .checked_mul(block)
        .filter(|&n| n <= opts.limit)
        .ok_or("ADPCM encoding exceeds memory budget")?;
    let mut data = vec![0; size];
    let mut indices = [0i32; 2];
    let mut deltas = [16i32; 2];
    let mut predictors = [0i32; 2];
    let mut steps = [127i32; 2];
    let sample = |frame: usize, ch: usize| {
        let at = (frame * channels + ch) * 2;
        pcm.get(at..at + 2)
            .map_or(0, |p| i16::from_le_bytes([p[0], p[1]]) as i32)
    };
    for (b, packet) in data.chunks_exact_mut(block).enumerate() {
        for ch in 0..channels {
            let mut predictor = if tag == 32 {
                predictors[ch]
            } else {
                sample(b * frames + usize::from(tag == 2), ch)
            };
            let mut index = indices[ch];
            let mut delta = deltas[ch];
            let mut step = steps[ch];
            if tag == 17 {
                packet[ch * 4..ch * 4 + 2].copy_from_slice(&(predictor as i16).to_le_bytes());
                packet[ch * 4 + 2] = index as u8;
                if opts.trellis > 0 {
                    let (codes, last) = trellis(
                        frames - 1,
                        |i| sample(b * frames + i + 1, ch),
                        predictor,
                        index,
                        opts.trellis,
                        opts.limit.saturating_sub(size),
                    )?;
                    for (i, pair) in codes.chunks_exact(2).enumerate() {
                        packet[header + i / 4 * channels * 4 + ch * 4 + i % 4] =
                            pair[0] | pair[1] << 4;
                    }
                    indices[ch] = last;
                    continue;
                }
            }
            if tag == 2 {
                packet[channels + ch * 2..channels + ch * 2 + 2]
                    .copy_from_slice(&(delta as u16).to_le_bytes());
                packet[channels * 3 + ch * 2..channels * 3 + ch * 2 + 2]
                    .copy_from_slice(&(predictor as i16).to_le_bytes());
                packet[channels * 5 + ch * 2..channels * 5 + ch * 2 + 2]
                    .copy_from_slice(&(sample(b * frames, ch) as i16).to_le_bytes());
            }
            for i in match tag {
                17 => 1,
                2 => 2,
                _ => 0,
            }..frames
            {
                let difference = sample(b * frames + i, ch) - predictor;
                let nibble = if tag == 2 {
                    let quantized =
                        ((difference + delta / 2 * if difference < 0 { -1 } else { 1 }) / delta)
                            .clamp(-8, 7);
                    predictor = (predictor + quantized * delta).clamp(-32768, 32767);
                    let code = (quantized & 15) as u8;
                    delta = (delta * ADAPTATION[usize::from(code)] / 256).max(16);
                    code
                } else {
                    if tag == 17 {
                        step = STEPS[index as usize];
                    }
                    let magnitude = (difference.abs() * 4 / step).min(7);
                    let code = (magnitude | if difference < 0 { 8 } else { 0 }) as u8;
                    let value = (2 * magnitude + 1) * step / 8;
                    predictor = (predictor + if difference < 0 { -value } else { value })
                        .clamp(-32768, 32767);
                    if tag == 17 {
                        index = (index + INDEX[magnitude as usize]).clamp(0, 88);
                    } else {
                        step = (step * ADAPTATION[magnitude as usize] / 256).clamp(127, 24576);
                    }
                    code
                };
                let (at, shift) = if tag == 17 {
                    let n = i - 1;
                    (
                        header + n / 8 * channels * 4 + ch * 4 + n % 8 / 2,
                        n % 2 * 4,
                    )
                } else {
                    let n = (i - if tag == 2 { 2 } else { 0 }) * channels + ch;
                    (
                        header + n / 2,
                        if tag == 2 { (1 - n % 2) * 4 } else { n % 2 * 4 },
                    )
                };
                packet[at] |= nibble << shift;
            }
            indices[ch] = index;
            deltas[ch] = delta;
            predictors[ch] = predictor;
            steps[ch] = step;
        }
    }
    let mut fmt = Vec::new();
    fmt.extend_from_slice(&(tag as u16).to_le_bytes());
    fmt.extend_from_slice(&(channels as u16).to_le_bytes());
    fmt.extend_from_slice(&rate.to_le_bytes());
    let byte_rate = if tag == 32 {
        16000
    } else {
        (u64::from(rate) * block as u64 / frames as u64) as u32
    };
    fmt.extend_from_slice(&byte_rate.to_le_bytes());
    fmt.extend_from_slice(&(block as u16).to_le_bytes());
    fmt.extend_from_slice(&4u16.to_le_bytes());
    fmt.extend_from_slice(
        &(match tag {
            17 => 2u16,
            2 => 32,
            _ => 0,
        })
        .to_le_bytes(),
    );
    if tag != 32 {
        fmt.extend_from_slice(&(frames as u16).to_le_bytes());
    }
    if tag == 2 {
        fmt.extend_from_slice(&7u16.to_le_bytes());
        for (a, b) in COEFFICIENTS {
            fmt.extend_from_slice(&(a as i16).to_le_bytes());
            fmt.extend_from_slice(&(b as i16).to_le_bytes());
        }
    }
    write(&fmt, &data, count as u64, opts)
}

fn trellis(
    count: usize,
    sample: impl Fn(usize) -> i32,
    predictor: i32,
    index: i32,
    depth: u8,
    limit: usize,
) -> Result<(Vec<u8>, i32), &'static str> {
    #[derive(Clone, Copy)]
    struct Node {
        error: u32,
        predictor: i32,
        index: i32,
        path: usize,
    }
    let width = 1usize
        .checked_shl(u32::from(depth))
        .filter(|_| depth <= 16)
        .ok_or("Invalid trellis depth")?;
    width
        .checked_mul(128 * (size_of::<usize>() + 1) + 2 * size_of::<Node>())
        .and_then(|n| n.checked_add(65536 + count))
        .filter(|&n| n <= limit)
        .ok_or("IMA trellis exceeds memory budget")?;
    let mut previous = vec![0usize; width * 128];
    let mut codes = vec![0u8; width * 128];
    let mut seen = vec![255u8; 65536];
    let mut output = vec![0u8; count];
    let mut nodes = Vec::with_capacity(width);
    let mut next: Vec<Node> = Vec::with_capacity(width);
    nodes.push(Node {
        error: 0,
        predictor,
        index,
        path: 0,
    });
    let mut paths = 0;
    let mut frozen = 0;
    let mut generation = 0;
    for i in 0..count {
        let target = sample(i);
        next.clear();
        let mut heap_position = 0;
        for (j, node) in nodes.iter().enumerate() {
            let range = i32::from(j < width / 2);
            let step = STEPS[node.index as usize];
            let div = (target - node.predictor) * 4 / step;
            let mut low = (div - range).clamp(-7, 6);
            let mut high = (div + range).clamp(-6, 7);
            if low <= 0 {
                low -= 1;
            }
            if high < 0 {
                high -= 1;
            }
            for candidate in low..=high {
                let code = if candidate < 0 {
                    7 - candidate
                } else {
                    candidate
                };
                let delta = step * (2 * (code & 7) + 1) * if code & 8 != 0 { -1 } else { 1 } / 8;
                let value = (node.predictor + delta).clamp(-32768, 32767);
                let difference = (target - value) as i64;
                let error = node.error.wrapping_add((difference * difference) as u32);
                if error < node.error || seen[(value & 65535) as usize] == generation {
                    continue;
                }
                let mut position = if heap_position < width {
                    heap_position
                } else {
                    width / 2 + (heap_position & (width / 2 - 1))
                };
                if heap_position >= width && error > next[position].error {
                    continue;
                }
                heap_position += 1;
                seen[(value & 65535) as usize] = generation;
                let path = if position < next.len() {
                    next[position].path
                } else {
                    let path = paths;
                    paths += 1;
                    path
                };
                let entry = Node {
                    error,
                    predictor: value,
                    index: (node.index + INDEX[(code & 7) as usize]).clamp(0, 88),
                    path,
                };
                if position < next.len() {
                    next[position] = entry;
                } else {
                    next.push(entry);
                }
                codes[path] = code as u8;
                previous[path] = node.path;
                while position > 0 {
                    let parent = (position - 1) / 2;
                    if next[parent].error <= error {
                        break;
                    }
                    next.swap(parent, position);
                    position = parent;
                }
            }
        }
        std::mem::swap(&mut nodes, &mut next);
        generation += 1;
        if generation == 255 {
            seen.fill(255);
            generation = 0;
        }
        let best = *nodes.first().ok_or("IMA trellis has no valid path")?;
        if best.error > 1 << 28 {
            for node in &mut nodes {
                node.error -= best.error;
            }
        }
        if i + 1 == frozen + 128 || i + 1 == count {
            let mut path = best.path;
            for k in (frozen..=i).rev() {
                output[k] = codes[path];
                path = previous[path];
            }
            frozen = i + 1;
            paths = 0;
            nodes.truncate(1);
        }
    }
    Ok((output, nodes[0].index))
}

pub(super) fn write(
    fmt: &[u8],
    data: &[u8],
    frames: u64,
    opts: &Remux<'_>,
) -> Result<Vec<u8>, String> {
    if opts.format != "wav" {
        return Err("ADPCM output requires WAV".into());
    }
    let size =
        12 + 8 + fmt.len() + 8 + data.len() + if opts.stdout { 0 } else { 12 + data.len() % 2 };
    if size > opts.limit || size > u32::MAX as usize {
        return Err("ADPCM output exceeds memory budget".into());
    }
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(
        &(if opts.stdout {
            u32::MAX
        } else {
            size as u32 - 8
        })
        .to_le_bytes(),
    );
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
    out.extend_from_slice(fmt);
    if !opts.stdout {
        out.extend_from_slice(b"fact\x04\0\0\0");
        out.extend_from_slice(&(frames as u32).to_le_bytes());
    }
    out.extend_from_slice(b"data");
    out.extend_from_slice(
        &(if opts.stdout {
            u32::MAX
        } else {
            data.len() as u32
        })
        .to_le_bytes(),
    );
    out.extend_from_slice(data);
    if !opts.stdout && !data.len().is_multiple_of(2) {
        out.push(0);
    }
    Ok(out)
}

pub(super) fn packet_size(w: Wave<'_>) -> Result<usize, &'static str> {
    let block = usize::from(w.block_align);
    if block == 0 {
        return Err("Invalid ADPCM WAV block size");
    }
    let per_packet = if w.tag == 69 {
        (u32::from_le_bytes(w.fmt[8..12].try_into().unwrap()) as usize / 10 / block).max(1)
    } else {
        (w.rate as usize * w.channels / 20 / block).max(1)
    };
    Ok((1 << per_packet.ilog2()) * block)
}

pub(super) fn report(
    w: Wave<'_>,
    filename: &str,
    bytes: usize,
    mut opts: super::media_probe::ProbeOptions<'_>,
) -> Result<String, &'static str> {
    use super::super::structured::JVal::{Number, Object, Str};
    use super::media_probe::{disposition, format_row, report, selected};
    frames(w)?;
    let block = usize::from(w.block_align);
    let packet_size = packet_size(w)?;
    let per_block = if w.tag == 69 {
        block * 8 / usize::from(w.bits)
    } else if w.tag == 32 {
        block * 2 / w.channels
    } else {
        frames(Wave {
            data: &w.data[..w.data.len().min(block)],
            ..w
        })?
    };
    let frames_requested = opts.show.contains("frame") || opts.counts.0;
    if frames_requested {
        decode(w, opts.limit)?;
    }
    let counts = (
        frames_requested,
        opts.show.contains("packet") || opts.counts.1,
    );
    if opts.show.contains("packet") && opts.show.contains("frame") {
        opts.show.remove("packet");
        opts.show.remove("frame");
        opts.show.insert("packet_frame");
    }
    let optional = !matches!(opts.writer, "json" | "xml");
    let enabled = selected(opts.select, "audio", 0, 0);
    let (codec, long, sample) = match w.tag {
        17 => ("adpcm_ima_wav", "ADPCM IMA WAV", "s16p"),
        2 => ("adpcm_ms", "ADPCM Microsoft", "s16"),
        69 => ("adpcm_g726", "G.726 ADPCM", "s16"),
        _ => ("adpcm_yamaha", "ADPCM Yamaha", "s16"),
    };
    let bitrate = u32::from_le_bytes(w.fmt[8..12].try_into().unwrap()) as u64 * 8;
    let mut ticks = w.fact.unwrap_or(0);
    if ticks > 0
        && w.channels > 1
        && ticks.is_multiple_of(w.channels as u64)
        && bitrate > 0
        && ((w.data.len() as f64 * 8. * w.channels as f64 * f64::from(w.rate)
            / ticks as f64
            / bitrate as f64)
            - 1.)
            .abs()
            < 0.3
    {
        ticks /= w.channels as u64;
    }
    if ticks > 0 && w.data.len() as u64 * 8 / ticks / w.channels as u64 > u64::from(w.bits) + 1 {
        ticks = 0;
    }
    if ticks == 0 || w.tag == 32 {
        ticks = (if w.tag == 69 {
            bytes.saturating_sub(w.data_pos)
        } else {
            w.data.len()
        }) as u64
            * 8
            / u64::from(w.bits)
            / w.channels as u64;
    }
    let duration = ticks as f64 / f64::from(w.rate);
    let packets = w.data.len().div_ceil(packet_size);
    let frame_count = if matches!(w.tag, 32 | 69) {
        packets
    } else {
        w.data.len().div_ceil(block)
    };
    report(opts, |section| match section {
        "stream" if enabled => {
            let mut row = vec![
                ("index", Number(0., None)),
                ("codec_name", Str(codec.into())),
                ("codec_long_name", Str(long.into())),
            ];
            if optional {
                row.push(("profile", Str("unknown".into())));
            }
            row.extend([
                ("codec_type", Str("audio".into())),
                (
                    "codec_tag_string",
                    Str(if w.tag == 69 {
                        "E[0][0][0]".into()
                    } else if w.tag == 32 {
                        " [0][0][0]".into()
                    } else {
                        format!("[{}][0][0][0]", w.tag)
                    }),
                ),
                ("codec_tag", Str(format!("0x{:04x}", w.tag))),
                ("sample_fmt", Str(sample.into())),
                ("sample_rate", Str(w.rate.to_string())),
                ("channels", Number(w.channels as f64, None)),
            ]);
            if w.tag == 69 || optional {
                row.push((
                    "channel_layout",
                    Str(if w.tag == 69 { "mono" } else { "unknown" }.into()),
                ));
            }
            row.extend([
                (
                    "bits_per_sample",
                    Number(if w.tag == 69 { 0. } else { 4. }, None),
                ),
                ("initial_padding", Number(0., None)),
            ]);
            if optional {
                row.push(("id", Str("N/A".into())));
            }
            row.extend([
                ("r_frame_rate", Str("0/0".into())),
                ("avg_frame_rate", Str("0/0".into())),
                ("time_base", Str(format!("1/{}", w.rate))),
            ]);
            for (key, value) in [
                ("start_pts", None),
                ("start_time", None),
                ("duration_ts", Some(Number(ticks as f64, None))),
                ("duration", Some(Str(format!("{duration:.6}")))),
                ("bit_rate", Some(Str(bitrate.to_string()))),
                ("max_bit_rate", None),
                ("bits_per_raw_sample", None),
                ("nb_frames", None),
                (
                    "nb_read_frames",
                    counts.0.then(|| Str(frame_count.to_string())),
                ),
                (
                    "nb_read_packets",
                    counts.1.then(|| Str(packets.to_string())),
                ),
            ] {
                if let Some(value) = value {
                    row.push((key, value));
                } else if optional {
                    row.push((key, Str("N/A".into())));
                }
            }
            if w.fmt.len() > 18 {
                row.push(("extradata_size", Number((w.fmt.len() - 18) as f64, None)));
            }
            let mut d = disposition(false);
            d.extend(
                [
                    "non_diegetic",
                    "captions",
                    "descriptions",
                    "metadata",
                    "dependent",
                    "still_image",
                    "multilayer",
                ]
                .map(|k| (k.into(), Number(0., None))),
            );
            row.push(("disposition", Object(d)));
            Box::new(std::iter::once(row))
        }
        "format" => {
            let mut row = format_row(
                filename,
                bytes,
                ("wav", "WAV / WAVE (Waveform Audio)"),
                1,
                duration,
                vec![],
            );
            row.insert(3, ("nb_stream_groups", Number(0., None)));
            row.retain_mut(|(key, value)| {
                if *key == "tags" {
                    return false;
                }
                if *key == "start_time" {
                    *value = Str("N/A".into());
                    return optional;
                }
                if *key == "probe_score" {
                    *value = Number(99., None);
                }
                if *key == "bit_rate" {
                    *value = Str(if ticks == 0 {
                        "N/A".into()
                    } else {
                        (bytes as u128 * 8_000_000
                            / (duration * 1_000_000.).round().max(1.) as u128)
                            .to_string()
                    });
                }
                true
            });
            Box::new(std::iter::once(row))
        }
        "packet" | "frame" | "packet_frame" if enabled => Box::new(
            w.data
                .chunks(packet_size)
                .enumerate()
                .flat_map(move |(p, packet)| {
                    let combined = section == "packet_frame";
                    let count = if matches!(w.tag, 32 | 69) {
                        1
                    } else {
                        packet.len().div_ceil(block)
                    };
                    let duration = if w.tag == 69 {
                        packet.len() * 8 / usize::from(w.bits)
                    } else if w.tag == 32 {
                        packet.len() * 2 / w.channels
                    } else {
                        packet.len() / block * per_block
                    };
                    let pts = if w.tag == 69 {
                        p * (packet_size * 8 / usize::from(w.bits))
                    } else {
                        p * packet_size / block * per_block
                    };
                    let pos = w.data_pos + p * packet_size;
                    (0..if combined {
                        count + 1
                    } else if section == "frame" {
                        count
                    } else {
                        1
                    })
                        .map(move |i| {
                            let frame = section == "frame" || combined && i > 0;
                            let first = !frame || i == usize::from(combined);
                            let time = format!("{:.6}", pts as f64 / f64::from(w.rate));
                            let duration_time =
                                format!("{:.6}", duration as f64 / f64::from(w.rate));
                            let mut row = if frame {
                                vec![
                                    ("media_type", Str("audio".into())),
                                    ("stream_index", Number(0., None)),
                                    ("key_frame", Number(1., None)),
                                ]
                            } else {
                                vec![
                                    ("codec_type", Str("audio".into())),
                                    ("stream_index", Number(0., None)),
                                ]
                            };
                            for key in if frame {
                                &[
                                    "pts",
                                    "pts_time",
                                    "pkt_dts",
                                    "pkt_dts_time",
                                    "best_effort_timestamp",
                                    "best_effort_timestamp_time",
                                ][..]
                            } else {
                                &["pts", "pts_time", "dts", "dts_time"][..]
                            } {
                                if first {
                                    row.push((
                                        key,
                                        if key.ends_with("time") {
                                            Str(time.clone())
                                        } else {
                                            Number(pts as f64, None)
                                        },
                                    ));
                                } else if optional {
                                    row.push((key, Str("N/A".into())));
                                }
                            }
                            row.extend([
                                ("duration", Number(duration as f64, None)),
                                ("duration_time", Str(duration_time)),
                            ]);
                            if frame {
                                row.extend([
                                    ("pkt_pos", Str(pos.to_string())),
                                    ("pkt_size", Str(packet.len().to_string())),
                                    ("sample_fmt", Str(sample.into())),
                                    (
                                        "nb_samples",
                                        Number(
                                            if matches!(w.tag, 32 | 69) {
                                                duration
                                            } else {
                                                per_block
                                            } as f64,
                                            None,
                                        ),
                                    ),
                                    ("channels", Number(w.channels as f64, None)),
                                ]);
                                if w.tag == 69 || optional {
                                    row.push((
                                        "channel_layout",
                                        Str(if w.tag == 69 { "mono" } else { "unknown" }.into()),
                                    ));
                                }
                            } else {
                                row.extend([
                                    ("size", Str(packet.len().to_string())),
                                    ("pos", Str(pos.to_string())),
                                    (
                                        "flags",
                                        Str(if w.truncated && p + 1 == packets {
                                            "K_C"
                                        } else {
                                            "K__"
                                        }
                                        .into()),
                                    ),
                                ]);
                            }
                            if combined {
                                row.insert(
                                    0,
                                    ("type", Str(if frame { "frame" } else { "packet" }.into())),
                                );
                            }
                            row
                        })
                }),
        ),
        _ => Box::new(std::iter::empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::super::ffmpeg_pcm::Format;
    use super::*;

    #[test]
    fn adpcm_wav_bounds_indexes_and_trellis_allocations() {
        let bytes = include_bytes!("../../../mp4-ast/src/fixtures/ima-adpcm.wav");
        let wave = Wave::read(bytes).unwrap();
        assert!(decode(wave, 1).is_err());
        assert!(
            frames(Wave {
                block_align: 0,
                ..wave
            })
            .is_err()
        );
        assert!(trellis(100, |_| 0, 0, 0, 16, 1024).is_err());
        let mut data = wave.data.to_vec();
        for block in data.chunks_mut(usize::from(wave.block_align)) {
            if block.len() >= 4 {
                block[2] = 255;
                block[3] = 255;
            }
        }
        assert!(
            decode(
                Wave {
                    data: &data,
                    ..wave
                },
                1 << 20
            )
            .is_err()
        );
    }

    #[test]
    fn adpcm_wav_ms_bounds_adaptation_on_extreme_nibbles() {
        let mut data = [0x88; 256];
        data[0] = 0;
        data[1..3].copy_from_slice(&32767i16.to_le_bytes());
        data[3..7].fill(0);
        let wave = Wave {
            tag: 2,
            bits: 4,
            block_align: 256,
            ..Wave::raw(Format::Signed(16, false), &data, 8000, 1).unwrap()
        };
        let out = decode(wave, 1 << 20).unwrap();
        assert_eq!(out.len(), 500 * 2);
        assert!(
            out[4..]
                .chunks_exact(2)
                .all(|s| s == i16::MIN.to_le_bytes())
        );
    }
}
