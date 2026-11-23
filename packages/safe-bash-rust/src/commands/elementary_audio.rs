use super::media_probe::{ProbeOptions, disposition, format_row, report, selected};

pub(super) struct Document<'a> {
    pub format: &'static str,
    pub tag: &'static [u8; 4],
    pub rate: u32,
    pub channels: u32,
    pub scale: u32,
    pub tick: u32,
    pub config: Vec<u8>,
    pub packets: Vec<&'a [u8]>,
    latm_payloads: Vec<(usize,usize)>,
    layout: &'static str,
    bitrate: u32,
}

struct Bits<'a> {
    bytes: &'a [u8],
    at: usize,
}

pub(super) fn write_latm<'a>(
    config: &[u8],
    packets: impl Iterator<Item = &'a [u8]>,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let mut bits = Bits {
        bytes: config,
        at: 0,
    };
    if bits.read(5)? != 2 {
        return Err("LATM output requires AAC-LC");
    }
    let frequency = bits.read(4)?;
    if frequency == 15 {
        if bits.read(24)? == 0 {
            return Err("Invalid LATM sample rate");
        }
    } else if frequency > 12 {
        return Err("Invalid LATM sample rate");
    }
    if !matches!(bits.read(4)?, 1..=7) || bits.read(3)? != 0 {
        return Err("Unsupported LATM AAC configuration");
    }
    let config_bits = bits.at;
    let mut out = Vec::new();
    for (i, packet) in packets.enumerate() {
        let initial = i % 20 == 0;
        let size = ((if initial { 29 + config_bits } else { 1 })
            + (packet.len() / 255 + 1 + packet.len()) * 8)
            .div_ceil(8);
        if packet.is_empty() || size > 8191 {
            return Err("AAC packet exceeds the LOAS frame size limit");
        }
        if size + 3 > limit.saturating_sub(out.len()) {
            return Err("output byte limit exceeded");
        }
        let start = out.len();
        out.extend_from_slice(&[0x56, 0xe0 | (size >> 8) as u8, size as u8]);
        out.resize(start + 3 + size, 0);
        let mut at = (start + 3) * 8;
        let mut write = |value: u32, n: usize| {
            for bit in (0..n).rev() {
                out[at / 8] |= ((value >> bit & 1) as u8) << (7 - at % 8);
                at += 1;
            }
        };
        write(u32::from(!initial), 1);
        if initial {
            write(0, 1);
            write(1, 1);
            write(0, 13);
            let mut config = Bits {
                bytes: config,
                at: 0,
            };
            for _ in 0..config_bits {
                write(config.read(1)?, 1);
            }
            write(0, 3);
            write(255, 8);
            write(0, 2);
        }
        for _ in 0..packet.len() / 255 {
            write(255, 8);
        }
        write((packet.len() % 255) as u32, 8);
        for byte in packet {
            write(u32::from(*byte), 8);
        }
    }
    Ok(out)
}
impl Bits<'_> {
    fn read(&mut self, n: usize) -> Result<u32, &'static str> {
        if n > 32 || n > self.bytes.len() * 8 - self.at {
            return Err("Truncated LATM payload");
        }
        let mut value = 0;
        for _ in 0..n {
            value = value << 1 | u32::from(self.bytes[self.at / 8] >> (7 - self.at % 8) & 1);
            self.at += 1;
        }
        Ok(value)
    }
}

impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], format: &str, limit: usize) -> Result<Self, &'static str> {
        if bytes.len() > limit {
            return Err("input byte limit exceeded");
        }
        let mut doc = Self {
            format: "",
            tag: b"\0\0\0\0",
            rate: 0,
            channels: 0,
            scale: 0,
            tick: 0,
            config: Vec::new(),
            packets: Vec::new(),
            latm_payloads: Vec::new(),
            layout: "",
            bitrate: 0,
        };
        let mut at = 0;
        match format {
            "amr" => {
                doc.format = "amr";
                doc.channels = 1;
                doc.layout = "mono";
                if bytes.starts_with(b"#!AMR\n") {
                    doc.tag = b"samr";
                    doc.rate = 8000;
                    at = 6;
                } else if bytes.starts_with(b"#!AMR-WB\n") {
                    doc.tag = b"sawb";
                    doc.rate = 16000;
                    at = 9;
                } else {
                    return Err("Invalid AMR header");
                }
                doc.scale = doc.rate;
                doc.tick = doc.rate / 50;
            }
            "ac3" => {
                doc.format = "ac3";
                doc.tag = b"ac-3";
                doc.scale = 90000;
            }
            "latm" => {
                doc.format = "latm";
                doc.scale = 28224000;
            }
            _ => return Err("Unsupported elementary audio format"),
        }
        let mut remaining = limit.saturating_sub(bytes.len());
        while at < bytes.len() {
            let input = &bytes[at..];
            let size = match doc.format {
                "amr" => {
                    let sizes = if doc.rate == 8000 {
                        [13, 14, 16, 18, 20, 21, 27, 32, 6, 0, 0, 0, 0, 0, 0, 1]
                    } else {
                        [18, 24, 33, 37, 41, 47, 51, 59, 61, 6, 0, 0, 0, 0, 1, 1]
                    };
                    let size = sizes[usize::from(input[0] >> 3 & 15)];
                    if input[0] & 0x83 != 0 || size == 0 {
                        return Err("Invalid AMR frame header");
                    }
                    size
                }
                "ac3" => {
                    if input.len() < 7 || !input.starts_with(b"\x0b\x77") {
                        return Err("Invalid AC-3 sync header");
                    }
                    let code = usize::from(input[4] & 63);
                    let rate_code = usize::from(input[4] >> 6);
                    let bsid = input[5] >> 3;
                    if code > 37 || rate_code == 3 || bsid > 10 {
                        return Err("Unsupported AC-3 frame header");
                    }
                    let bitrate = [
                        32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448,
                        512, 576, 640,
                    ][code / 2];
                    let rate = [48000, 44100, 32000][rate_code] >> bsid.saturating_sub(8);
                    let mode = input[6] >> 5;
                    let bit = 4
                        - u8::from(mode & 1 != 0 && mode != 1) * 2
                        - u8::from(mode & 4 != 0) * 2
                        - u8::from(mode == 2) * 2;
                    let lfe = input[6] >> bit & 1;
                    let channels = u32::from([2, 1, 2, 3, 3, 4, 4, 5][usize::from(mode)] + lfe);
                    if doc.rate != 0 && (doc.rate != rate || doc.channels != channels) {
                        return Err("Changing AC-3 audio configuration is not supported");
                    }
                    doc.bitrate = (bitrate as u32 * 1000) >> bsid.saturating_sub(8);
                    doc.rate = rate;
                    doc.channels = channels;
                    doc.tick = 1536 * doc.scale / rate;
                    doc.layout = if lfe == 0 {
                        [
                            "stereo",
                            "mono",
                            "stereo",
                            "3.0",
                            "3.0(back)",
                            "4.0",
                            "quad(side)",
                            "5.0(side)",
                        ][usize::from(mode)]
                    } else {
                        [
                            "2.1",
                            "2 channels (FC+LFE)",
                            "2.1",
                            "3.1",
                            "4 channels (FL+FR+LFE+BC)",
                            "4.1",
                            "5 channels (FL+FR+LFE+SL+SR)",
                            "5.1(side)",
                        ][usize::from(mode)]
                    };
                    if doc.config.is_empty() {
                        let dac3 = (rate_code as u32) << 22
                            | u32::from(bsid) << 17
                            | u32::from(input[5] & 7) << 14
                            | u32::from(mode) << 11
                            | u32::from(lfe) << 10
                            | (code as u32 / 2) << 5;
                        doc.config.extend_from_slice(&dac3.to_be_bytes()[1..]);
                    }
                    match rate_code {
                        0 => bitrate * 4,
                        1 => (bitrate * 320 / 147 + (code & 1)) * 2,
                        _ => bitrate * 6,
                    }
                }
                "latm" => {
                    if input.len() < 3 || input[0] != 0x56 || input[1] & 0xe0 != 0xe0 {
                        return Err("Invalid LOAS sync header");
                    }
                    let size = 3 + (usize::from(input[1] & 31) << 8) + usize::from(input[2]);
                    let mut bits = Bits {
                        bytes: input.get(3..size).ok_or("Truncated LOAS packet")?,
                        at: 0,
                    };
                    if bits.read(1)? == 0 {
                        if bits.read(1)? != 0 {
                            return Err("Unsupported LATM audioMuxVersion");
                        }
                        if bits.read(1)? != 1
                            || bits.read(6)? != 0
                            || bits.read(4)? != 0
                            || bits.read(3)? != 0
                        {
                            return Err("Unsupported LATM subframes, programs or layers");
                        }
                        let start = bits.at;
                        if bits.read(5)? != 2 {
                            return Err("Unsupported LATM audio object type (requires AAC-LC)");
                        }
                        let frequency = bits.read(4)?;
                        let rate = if frequency == 15 {
                            bits.read(24)?
                        } else {
                            *super::adts::RATES
                                .get(frequency as usize)
                                .ok_or("Unsupported LATM sample rate")?
                        };
                        let channels = *[0, 1, 2, 3, 4, 5, 6, 8]
                            .get(bits.read(4)? as usize)
                            .ok_or("Unsupported LATM channel configuration")?;
                        if rate == 0 || channels == 0 || !doc.scale.is_multiple_of(rate) {
                            return Err("Unsupported LATM sample rate or channel configuration");
                        }
                        if bits.read(3)? != 0 {
                            return Err("Unsupported LATM AAC frame configuration");
                        }
                        let end = bits.at;
                        let mut config = Bits {
                            bytes: bits.bytes,
                            at: start,
                        };
                        let mut asc = Vec::new();
                        while config.at < end {
                            let n = (end - config.at).min(8);
                            asc.push((config.read(n)? << (8 - n)) as u8);
                        }
                        if bits.read(3)? != 0 {
                            return Err("Unsupported LATM frame length type");
                        }
                        bits.read(8)?;
                        if bits.read(1)? != 0 {
                            return Err("Unsupported LATM otherDataPresent");
                        }
                        if bits.read(1)? != 0 {
                            bits.read(8)?;
                        }
                        if doc.rate != 0 && doc.config != asc {
                            return Err("Changing LATM audio configuration is not supported");
                        }
                        doc.rate = rate;
                        doc.channels = channels;
                        doc.tick = 1024 * (doc.scale / rate);
                        doc.config = asc;
                        doc.layout = ["", "mono", "stereo", "3.0", "4.0", "5.0", "5.1", "", "7.1"]
                            [channels as usize];
                    } else if doc.rate == 0 {
                        return Err("LATM packet has no initial StreamMuxConfig");
                    }
                    let mut len = 0;
                    loop {
                        let part = bits.read(8)? as usize;
                        len += part;
                        if part != 255 {
                            break;
                        }
                    }
                    if len == 0 || len > (bits.bytes.len() * 8 - bits.at) / 8 {
                        return Err("Truncated LATM AAC payload");
                    }
                    remaining=remaining.checked_sub(2*size_of::<(usize,usize)>()).ok_or("LATM payload index exceeds memory budget")?;
                    doc.latm_payloads.push((bits.at,len));
                    size
                }
                _ => unreachable!(),
            };
            let packet = input.get(..size).ok_or("Truncated audio packet")?;
            remaining = remaining
                .checked_sub(2 * size_of::<&[u8]>())
                .ok_or("audio packets exceed memory budget")?;
            doc.packets.push(packet);
            at += size;
        }
        if doc.packets.is_empty() {
            return Err("Empty elementary audio stream");
        }
        Ok(doc)
    }

    pub fn decode_amr(&self,seek:super::InputTime,limit:usize)->Result<(u32,u32,Vec<u8>),&'static str> {
        let rate=match self.tag {b"samr"=>8000u32,b"sawb"=>16000,_=>return Err("Audio decoding is not supported for this codec")};
        let samples=rate as usize/50;
        let from=(seek.start.unwrap_or(0.).max(0.)*f64::from(rate)).round() as usize;
        let skip=(from/samples).min(self.packets.len());
        if skip==self.packets.len() {return Ok((rate,1,Vec::new()));}
        let copies=seek.loops.checked_add(1).ok_or("AMR loop count exceeds memory budget")?;
        let packets=(0..copies).flat_map(|_|self.packets.iter().skip(skip).copied());
        let budget=limit.saturating_sub(self.packets.capacity()*size_of::<&[u8]>());
        let mut pcm=if self.tag==b"samr" {super::amr_nb::decode(packets,budget)?}else{super::amr_wb::decode(packets,budget)?};
        let until=seek.end().map_or(self.packets.len()*samples,|end|(end.max(0.)*f64::from(rate)).round() as usize).min(self.packets.len()*samples);
        let start=from.min(until).saturating_sub(skip*samples);let end=until.saturating_sub(skip*samples);
        for copy in 0..copies {let offset=copy*(self.packets.len()-skip)*samples*4;pcm.copy_within(offset+start*4..offset+end*4,copy*(end-start)*4);}
        pcm.truncate(copies*(end-start)*4);
        Ok((rate,1,pcm))
    }

    pub fn decode_latm(&self,loops:usize,limit:usize)->Result<(u32,u32,Vec<u8>),&'static str> {
        let copies=loops.checked_add(1).ok_or("AAC loop count exceeds memory budget")?;
        let packets=(0..copies).flat_map(|_|self.packets.iter().zip(&self.latm_payloads).enumerate()).map(|(index,(packet,&(at,len)))| {
            let mut bits=Bits{bytes:&packet[3..],at};let mut data=Vec::with_capacity(len);
            for _ in 0..len {data.push(bits.read(8)? as u8);}
            Ok((index==0,std::borrow::Cow::Owned(data)))
        });
        let retained=self.packets.capacity()*size_of::<&[u8]>()+self.latm_payloads.capacity()*size_of::<(usize,usize)>()+self.config.capacity();
        super::aac::decode(&self.config,packets,limit.saturating_sub(retained))
    }

    pub fn report(
        &self,
        filename: &str,
        bytes: &[u8],
        score: u8,
        opts: ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        use super::super::structured::JVal::{Number, Object, Str};
        if opts.show.contains("frame") || opts.counts.0 {
            return Err("Audio decoding is not supported for this codec");
        }
        let enabled = selected(opts.select, "audio", 0, 0);
        let optional = !matches!(opts.writer, "json" | "xml");
        let count = opts.counts.1 || opts.show.contains("packet");
        let pipe = matches!(filename, "-" | "pipe:" | "pipe:0");
        // Raw AC-3 duration is estimated from physical bytes and the header bitrate.
        let ticks = if self.format == "ac3" {
            (bytes.len() as f64 * 8. / f64::from(self.bitrate) * f64::from(self.scale)).round()
        } else {
            self.packets.len() as f64 * f64::from(self.tick)
        };
        let duration = ticks / f64::from(self.scale);
        let timed = self.format != "latm" && !pipe;
        let (name, long) = match self.tag {
            b"samr" => ("amr_nb", "AMR-NB (Adaptive Multi-Rate NarrowBand)"),
            b"sawb" => ("amr_wb", "AMR-WB (Adaptive Multi-Rate WideBand)"),
            b"ac-3" => ("ac3", "ATSC A/52A (AC-3)"),
            _ => ("aac_latm", "AAC LATM (Advanced Audio Coding LATM syntax)"),
        };
        report(opts, |section| match section {
            "stream" if enabled => {
                let mut row = vec![
                    ("index", Number(0., None)),
                    ("codec_name", Str(name.into())),
                    ("codec_long_name", Str(long.into())),
                ];
                if self.format == "latm" || optional {
                    row.push((
                        "profile",
                        Str(if self.format == "latm" {
                            "LC"
                        } else {
                            "unknown"
                        }
                        .into()),
                    ));
                }
                row.extend([
                    ("codec_type", Str("audio".into())),
                    (
                        "codec_tag_string",
                        Str(if self.format == "amr" {
                            std::str::from_utf8(self.tag).unwrap()
                        } else {
                            "[0][0][0][0]"
                        }
                        .into()),
                    ),
                    (
                        "codec_tag",
                        Str(if self.format == "amr" {
                            format!("0x{:08x}", u32::from_le_bytes(*self.tag))
                        } else {
                            "0x0000".into()
                        }),
                    ),
                    ("sample_fmt", Str("fltp".into())),
                    ("sample_rate", Str(self.rate.to_string())),
                    ("channels", Number(f64::from(self.channels), None)),
                    ("channel_layout", Str(self.layout.into())),
                    ("bits_per_sample", Number(0., None)),
                    ("initial_padding", Number(0., None)),
                ]);
                if optional {
                    row.push(("id", Str("N/A".into())));
                }
                row.extend([
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("1/{}", self.scale))),
                ]);
                for (key, value) in [
                    (
                        "start_pts",
                        (self.format == "ac3").then_some(Number(0., None)),
                    ),
                    (
                        "start_time",
                        (self.format == "ac3").then_some(Str("0.000000".into())),
                    ),
                    ("duration_ts", timed.then_some(Number(ticks, None))),
                    ("duration", timed.then_some(Str(format!("{duration:.6}")))),
                    (
                        "bit_rate",
                        (self.format != "latm").then(|| {
                            Str(if self.format == "ac3" {
                                self.bitrate.to_string()
                            } else {
                                (self.packets.iter().map(|p| p.len()).sum::<usize>() as f64 * 8.
                                    / duration)
                                    .round()
                                    .to_string()
                            })
                        }),
                    ),
                    ("max_bit_rate", None),
                    ("bits_per_raw_sample", None),
                    ("nb_frames", None),
                    ("nb_read_frames", None),
                    (
                        "nb_read_packets",
                        count.then(|| Str(self.packets.len().to_string())),
                    ),
                ] {
                    if let Some(value) = value {
                        row.push((key, value));
                    } else if optional {
                        row.push((key, Str("N/A".into())));
                    }
                }
                if self.format == "latm" {
                    row.push(("extradata_size", Number(self.config.len() as f64, None)));
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
                    ]
                    .map(|k| (k.into(), Number(0., None))),
                );
                row.push(("disposition", Object(d)));
                Box::new(std::iter::once(row))
            }
            "format" => {
                let format = match self.format {
                    "amr" => ("amr", "3GPP AMR"),
                    "ac3" => ("ac3", "raw AC-3"),
                    _ => ("loas", "LOAS AudioSyncStream"),
                };
                let mut row = format_row(
                    if filename == "-" { "fd:" } else { filename },
                    bytes.len(),
                    format,
                    1,
                    duration,
                    vec![],
                );
                row.insert(3, ("nb_stream_groups", Number(0., None)));
                row.retain_mut(|(key, value)| {
                    let known = match *key {
                        "start_time" => self.format == "ac3",
                        "duration" | "bit_rate" => timed,
                        "tags" => return false,
                        "size" => !pipe || filename == "-",
                        _ => true,
                    };
                    if !known {
                        *value = Str("N/A".into());
                        return optional;
                    }
                    if *key == "probe_score" {
                        *value = Number(f64::from(score), None);
                    }
                    if *key == "size" && filename == "-" {
                        *value = Str("0".into());
                    }
                    if *key == "bit_rate" {
                        *value = Str((bytes.len() as u128 * 8_000_000
                            / (duration * 1_000_000.).round() as u128)
                            .to_string());
                    }
                    true
                });
                Box::new(std::iter::once(row))
            }
            "packet" if enabled => Box::new(self.packets.iter().enumerate().map(|(i, p)| {
                let pts = i as u64 * u64::from(self.tick);
                let time = format!("{:.6}", pts as f64 / f64::from(self.scale));
                vec![
                    ("codec_type", Str("audio".into())),
                    ("stream_index", Number(0., None)),
                    ("pts", Number(pts as f64, None)),
                    ("pts_time", Str(time.clone())),
                    ("dts", Number(pts as f64, None)),
                    ("dts_time", Str(time)),
                    ("duration", Number(f64::from(self.tick), None)),
                    (
                        "duration_time",
                        Str(format!(
                            "{:.6}",
                            f64::from(self.tick) / f64::from(self.scale)
                        )),
                    ),
                    ("size", Str(p.len().to_string())),
                    (
                        "pos",
                        Str((p.as_ptr() as usize - bytes.as_ptr() as usize).to_string()),
                    ),
                    ("flags", Str("K__".into())),
                ]
            })),
            _ => Box::new(std::iter::empty()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn elementary_audio_rejects_truncated_packets_and_exhausted_indexes() {
        for (format, bytes) in [
            (
                "amr",
                include_bytes!("../../../mp4-ast/src/fixtures/amr-copy-nb.amr").as_slice(),
            ),
            (
                "amr",
                include_bytes!("../../../mp4-ast/src/fixtures/amr-copy-wb.amr").as_slice(),
            ),
            (
                "latm",
                include_bytes!("../../../mp4-ast/src/fixtures/loas.latm").as_slice(),
            ),
            (
                "ac3",
                include_bytes!("../../../mp4-ast/src/fixtures/packet-copy.ac3").as_slice(),
            ),
        ] {
            let doc = Document::read(bytes, format, 1 << 20).unwrap();
            let first = doc.packets[0];
            let offset = first.as_ptr() as usize - bytes.as_ptr() as usize;
            for end in 0..offset + first.len() {
                assert!(
                    Document::read(&bytes[..end], format, 1 << 20).is_err(),
                    "{format}: {end}"
                );
            }
            assert!(
                Document::read(&bytes[..bytes.len() - 1], format, 1 << 20).is_err(),
                "{format}"
            );
            assert!(
                Document::read(bytes, format, bytes.len() - 1).is_err(),
                "{format}"
            );
            assert!(
                Document::read(bytes, format, bytes.len() + size_of::<&[u8]>()).is_err(),
                "{format}"
            );
        }
    }
    #[test]
    fn elementary_audio_rejects_invalid_framing_and_configuration_changes() {
        let nb = include_bytes!("../../../mp4-ast/src/fixtures/amr-copy-nb.amr");
        for toc in [0x83, 9 << 3, 10 << 3, 14 << 3] {
            let mut bytes = nb.to_vec();
            bytes[6] = toc;
            assert!(Document::read(&bytes, "amr", 1 << 20).is_err());
        }
        let ac3 = include_bytes!("../../../mp4-ast/src/fixtures/packet-copy.ac3");
        for (offset, value) in [(0, 0), (4, 0xc0), (4, 38), (5, 11 << 3), (384 + 6, 0x40)] {
            let mut bytes = ac3.to_vec();
            bytes[offset] = value;
            assert!(Document::read(&bytes, "ac3", 1 << 20).is_err());
        }
        let latm = include_bytes!("../../../mp4-ast/src/fixtures/loas.latm");
        for (offset, value) in [(0, 0), (1, 0xff), (3, 0x80), (3, 0x40), (3, 0)] {
            let mut bytes = latm.to_vec();
            bytes[offset] = value;
            assert!(Document::read(&bytes, "latm", 1 << 20).is_err());
        }
    }
}
