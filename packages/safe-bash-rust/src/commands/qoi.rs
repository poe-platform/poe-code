use super::png_pixels::Raster;

pub(super) struct Image<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub alpha: bool,
    pub linear: bool,
}

impl<'a> Image<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if bytes.len() < 14 || !bytes.starts_with(b"qoif") {
            return Err("Invalid QOI header");
        }
        let width = u32::from_be_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let height = u32::from_be_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let count = width
            .checked_mul(height)
            .filter(|&n| n > 0 && n <= limit / 4)
            .ok_or("QOI image exceeds memory budget")?;
        if !matches!(bytes[12], 3 | 4) || bytes[13] > 1 {
            return Err("Invalid QOI channels or colorspace");
        }
        let mut at = 14;
        let mut pixels = 0;
        while pixels < count {
            let code = *bytes.get(at).ok_or("Truncated QOI opcode")?;
            let (length, run) = match code {
                254 => (4, 1),
                255 => (5, 1),
                128..=191 => (2, 1),
                192..=253 => (1, usize::from(code & 63) + 1),
                _ => (1, 1),
            };
            if length > bytes.len() - at || run > count - pixels {
                return Err("Invalid QOI opcode length");
            }
            pixels += run;
            at += length;
        }
        if bytes.get(at..at + 8) != Some(&[0, 0, 0, 0, 0, 0, 0, 1]) {
            return Err("Invalid QOI end marker");
        }
        Ok(Self {
            data: &bytes[..at + 8],
            width,
            height,
            alpha: bytes[12] == 4,
            linear: bytes[13] == 1,
        })
    }

    pub fn decode(&self) -> Raster {
        let mut pixels = Vec::with_capacity(self.width * self.height);
        let mut index = [[0; 4]; 64];
        let mut pixel = [0, 0, 0, 255];
        let mut at = 14;
        while pixels.len() < self.width * self.height {
            let code = self.data[at];
            at += 1;
            let mut run = 1;
            match code {
                254 => {
                    pixel[..3].copy_from_slice(&self.data[at..at + 3]);
                    at += 3;
                }
                255 => {
                    pixel.copy_from_slice(&self.data[at..at + 4]);
                    at += 4;
                }
                0..=63 => pixel = index[code as usize],
                64..=127 => {
                    for (c, shift) in [4, 2, 0].into_iter().enumerate() {
                        pixel[c] = pixel[c].wrapping_add((code >> shift & 3).wrapping_sub(2));
                    }
                }
                128..=191 => {
                    let green = (code & 63).wrapping_sub(32);
                    let next = self.data[at];
                    at += 1;
                    pixel[0] = pixel[0]
                        .wrapping_add(green)
                        .wrapping_add((next >> 4).wrapping_sub(8));
                    pixel[1] = pixel[1].wrapping_add(green);
                    pixel[2] = pixel[2]
                        .wrapping_add(green)
                        .wrapping_add((next & 15).wrapping_sub(8));
                }
                _ => run = usize::from(code & 63) + 1,
            }
            index[hash(pixel)] = pixel;
            let mut output = pixel;
            if !self.alpha {
                output[3] = 255;
            }
            pixels.resize(pixels.len() + run, output);
        }
        Raster {
            width: self.width,
            height: self.height,
            alpha: self.alpha,
            gray: false,
            density: 72,
            orientation: None,
            pixels,
        }
    }
}

fn hash(p: [u8; 4]) -> usize {
    (usize::from(p[0]) * 3 + usize::from(p[1]) * 5 + usize::from(p[2]) * 7 + usize::from(p[3]) * 11)
        % 64
}

pub(super) fn images(mut bytes: &[u8], limit: usize) -> Result<Vec<Image<'_>>, &'static str> {
    let mut out = Vec::new();
    while !bytes.is_empty() {
        let remaining = limit
            .checked_sub((out.len() + 1) * size_of::<Image>())
            .ok_or("QOI frame index exceeds memory budget")?;
        let im = Image::read(bytes, remaining)?;
        bytes = &bytes[im.data.len()..];
        out.try_reserve_exact(1)
            .map_err(|_| "QOI frame index exceeds memory budget")?;
        out.push(im);
    }
    if out.is_empty() {
        return Err("QOI input has no frames");
    }
    Ok(out)
}

pub(super) fn encode(
    im: &Raster,
    alpha: bool,
    linear: bool,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let capacity = im
        .width
        .checked_mul(im.height)
        .and_then(|n| n.checked_mul(if alpha { 5 } else { 4 }))
        .and_then(|n| n.checked_add(22))
        .filter(|&n| n <= limit)
        .ok_or("QOI output exceeds memory budget")?;
    let mut out = Vec::with_capacity(capacity);
    out.extend_from_slice(b"qoif");
    out.extend_from_slice(&(im.width as u32).to_be_bytes());
    out.extend_from_slice(&(im.height as u32).to_be_bytes());
    out.extend_from_slice(&[if alpha { 4 } else { 3 }, u8::from(linear)]);
    let mut index = [[0; 4]; 64];
    let mut previous = [0, 0, 0, 255];
    let mut run = 0u8;
    for &source in &im.pixels {
        let mut pixel = source;
        if !alpha {
            pixel[3] = 255;
        }
        if pixel == previous {
            run += 1;
            if run == 62 {
                out.push(192 | (run - 1));
                run = 0;
            }
        } else {
            if run > 0 {
                out.push(192 | (run - 1));
                run = 0;
            }
            let slot = hash(pixel);
            if index[slot] == pixel {
                out.push(slot as u8);
            } else {
                index[slot] = pixel;
                if pixel[3] != previous[3] {
                    out.push(255);
                    out.extend_from_slice(&pixel);
                } else {
                    let delta = [0, 1, 2].map(|c| pixel[c].wrapping_sub(previous[c]) as i8);
                    let red = delta[0].wrapping_sub(delta[1]);
                    let blue = delta[2].wrapping_sub(delta[1]);
                    if delta.iter().all(|v| (-2..=1).contains(v)) {
                        out.push(
                            64 | ((delta[0] + 2) as u8) << 4
                                | ((delta[1] + 2) as u8) << 2
                                | (delta[2] + 2) as u8,
                        );
                    } else if (-32..=31).contains(&delta[1])
                        && (-8..=7).contains(&red)
                        && (-8..=7).contains(&blue)
                    {
                        out.extend_from_slice(&[
                            128 | (delta[1] + 32) as u8,
                            ((red + 8) as u8) << 4 | (blue + 8) as u8,
                        ]);
                    } else {
                        out.push(254);
                        out.extend_from_slice(&pixel[..3]);
                    }
                }
            }
        }
        previous = pixel;
    }
    if run > 0 {
        out.push(192 | (run - 1));
    }
    out.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
    Ok(out)
}

pub(super) fn render(
    bytes: &[u8],
    opts: super::y4m::Options<'_>,
    seek: super::InputTime,
    emit: impl FnMut(super::y4m::Frame, super::y4m::TimedFrame) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let frames = images(bytes, opts.limit)?;
    let (w, h) = (frames[0].width, frames[0].height);
    let start = (seek.start.unwrap_or(0.).max(0.) * 25.).round() as usize;
    let end = seek
        .end()
        .map_or(frames.len(), |s| (s.max(0.) * 25.).round() as usize)
        .min(frames.len());
    // The image-pipe demuxer has no seek index; seeking beyond tick zero
    // consumes these frames without producing decoded output.
    let length = if start == 0 { end } else { 0 };
    let count = length
        .checked_mul(seek.loops.saturating_add(1))
        .filter(|&n| n <= opts.limit / size_of::<Image>())
        .ok_or("QOI frame index exceeds memory budget")?;
    super::y4m::render_frames(
        w,
        h,
        (25., None),
        (0..count).map(|i| (i as f64 / 25., 0.04)),
        opts,
        |i| Ok(frames[start + i % length].decode()),
        emit,
    )?;
    Ok((w, h, 25))
}

pub(super) fn report(
    bytes: &[u8],
    filename: &str,
    limit: usize,
    mut opts: super::media_probe::ProbeOptions<'_>,
) -> Result<String, &'static str> {
    use super::super::structured::JVal::{Number, Object, Str};
    let frames = images(bytes, limit)?;
    let first = &frames[0];
    let optional = !matches!(opts.writer, "json" | "xml");
    let counts = (
        opts.show.contains("frame") || opts.counts.0,
        opts.show.contains("packet") || opts.counts.1,
    );
    let enabled = super::media_probe::selected(opts.select, "video", 0, 0);
    if opts.show.contains("frame") && opts.show.contains("packet") {
        opts.show.remove("frame");
        opts.show.remove("packet");
        opts.show.insert("packet_frame");
    }
    super::media_probe::report(opts, |section| match section {
        "stream" if enabled => {
            let mut row = vec![
                ("index", Number(0., None)),
                ("codec_name", Str("qoi".into())),
                ("codec_long_name", Str("QOI (Quite OK Image)".into())),
            ];
            if optional {
                row.push(("profile", Str("unknown".into())));
            }
            row.extend([
                ("codec_type", Str("video".into())),
                ("codec_tag_string", Str("[0][0][0][0]".into())),
                ("codec_tag", Str("0x0000".into())),
                ("width", Number(first.width as f64, None)),
                ("height", Number(first.height as f64, None)),
                ("coded_width", Number(first.width as f64, None)),
                ("coded_height", Number(first.height as f64, None)),
                ("has_b_frames", Number(0., None)),
            ]);
            if optional {
                row.extend([
                    ("sample_aspect_ratio", Str("N/A".into())),
                    ("display_aspect_ratio", Str("N/A".into())),
                ]);
            }
            row.extend([
                (
                    "pix_fmt",
                    Str(if first.alpha { "rgba" } else { "rgb24" }.into()),
                ),
                ("level", Number(-99., None)),
            ]);
            for (k, v) in [
                ("color_range", "unknown"),
                ("color_space", "unknown"),
                (
                    "color_transfer",
                    if first.linear { "linear" } else { "unknown" },
                ),
                ("color_primaries", "unknown"),
                ("chroma_location", "unspecified"),
                ("field_order", "unknown"),
            ] {
                if optional || k == "color_transfer" && first.linear {
                    row.push((k, Str(v.into())));
                }
            }
            row.push(("refs", Number(1., None)));
            if optional {
                row.push(("id", Str("N/A".into())));
            }
            row.extend([
                ("r_frame_rate", Str("25/1".into())),
                ("avg_frame_rate", Str("25/1".into())),
                ("time_base", Str("1/25".into())),
            ]);
            if optional {
                for k in [
                    "start_pts",
                    "start_time",
                    "duration_ts",
                    "duration",
                    "bit_rate",
                    "max_bit_rate",
                    "bits_per_raw_sample",
                    "nb_frames",
                ] {
                    row.push((k, Str("N/A".into())));
                }
            }
            for (k, known) in [("nb_read_frames", counts.0), ("nb_read_packets", counts.1)] {
                if known {
                    row.push((k, Str(frames.len().to_string())));
                } else if optional {
                    row.push((k, Str("N/A".into())));
                }
            }
            let mut disposition = super::media_probe::disposition(false);
            disposition.extend(
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
            row.push(("disposition", Object(disposition)));
            Box::new(std::iter::once(row))
        }
        "format" => {
            let pipe = matches!(filename, "-" | "pipe:" | "pipe:0");
            let mut row = vec![
                ("filename", Str(filename.into())),
                ("nb_streams", Number(1., None)),
                ("nb_programs", Number(0., None)),
                ("nb_stream_groups", Number(0., None)),
                ("format_name", Str("qoi_pipe".into())),
                ("format_long_name", Str("piped qoi sequence".into())),
            ];
            if optional {
                row.extend([
                    ("start_time", Str("N/A".into())),
                    ("duration", Str("N/A".into())),
                ]);
            }
            if !pipe || filename == "-" {
                row.push((
                    "size",
                    Str(if pipe {
                        "0".into()
                    } else {
                        bytes.len().to_string()
                    }),
                ));
            } else if optional {
                row.push(("size", Str("N/A".into())));
            }
            if optional {
                row.push(("bit_rate", Str("N/A".into())));
            }
            row.push(("probe_score", Number(99., None)));
            Box::new(std::iter::once(row))
        }
        "packet" | "frame" | "packet_frame" if enabled => {
            let combined = section == "packet_frame";
            Box::new(frames.iter().enumerate().flat_map(move |(i, im)| {
                (0..if combined { 2 } else { 1 }).map(move |part| {
                    let frame = section == "frame" || combined && part == 1;
                    let time = format!("{:.6}", i as f64 / 25.);
                    let mut row = if frame {
                        vec![
                            ("media_type", Str("video".into())),
                            ("stream_index", Number(0., None)),
                            ("key_frame", Number(1., None)),
                        ]
                    } else {
                        vec![
                            ("codec_type", Str("video".into())),
                            ("stream_index", Number(0., None)),
                        ]
                    };
                    for k in if frame {
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
                        row.push((
                            k,
                            if k.ends_with("time") {
                                Str(time.clone())
                            } else {
                                Number(i as f64, None)
                            },
                        ));
                    }
                    row.extend([
                        ("duration", Number(1., None)),
                        ("duration_time", Str("0.040000".into())),
                    ]);
                    let pos = im.data.as_ptr() as usize - bytes.as_ptr() as usize;
                    if frame {
                        row.extend([
                            ("pkt_pos", Str(pos.to_string())),
                            ("pkt_size", Str(im.data.len().to_string())),
                            ("width", Number(im.width as f64, None)),
                            ("height", Number(im.height as f64, None)),
                        ]);
                        for k in ["crop_top", "crop_bottom", "crop_left", "crop_right"] {
                            row.push((k, Number(0., None)));
                        }
                        row.push((
                            "pix_fmt",
                            Str(if im.alpha { "rgba" } else { "rgb24" }.into()),
                        ));
                        if optional {
                            row.push(("sample_aspect_ratio", Str("N/A".into())));
                        }
                        row.push(("pict_type", Str("I".into())));
                        for k in [
                            "interlaced_frame",
                            "top_field_first",
                            "lossless",
                            "repeat_pict",
                        ] {
                            row.push((k, Number(0., None)));
                        }
                        for (k, v) in [
                            ("color_range", "unknown"),
                            ("color_space", "unknown"),
                            ("color_primaries", "unknown"),
                            (
                                "color_transfer",
                                if im.linear { "linear" } else { "unknown" },
                            ),
                            ("chroma_location", "unspecified"),
                            ("alpha_mode", "unspecified"),
                        ] {
                            if optional || k == "color_transfer" && im.linear {
                                row.push((k, Str(v.into())));
                            }
                        }
                    } else {
                        row.extend([
                            ("size", Str(im.data.len().to_string())),
                            ("pos", Str(pos.to_string())),
                            ("flags", Str("K__".into())),
                        ]);
                    }
                    if i > 0 {
                        row.retain_mut(|(key, value)| {
                            if !matches!(*key, "pos" | "pkt_pos") {
                                return true;
                            }
                            *value = Str("N/A".into());
                            optional
                        });
                    }
                    if combined {
                        row.insert(
                            0,
                            ("type", Str(if frame { "frame" } else { "packet" }.into())),
                        );
                    }
                    row
                })
            }))
        }
        _ => Box::new(std::iter::empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qoi_bounds_dimensions_runs_and_end_markers() {
        let mut bytes = b"qoif\0\0\0\x01\0\0\0\x01\x04\0\xc0\0\0\0\0\0\0\0\x01".to_vec();
        assert!(Image::read(&bytes, 3).is_err());
        assert_eq!(
            Image::read(&bytes, 4).unwrap().decode().pixels,
            [[0, 0, 0, 255]]
        );
        bytes[14] = 0xc1;
        assert!(Image::read(&bytes, 1024).is_err());
        bytes[14] = 0xc0;
        bytes.pop();
        assert!(Image::read(&bytes, 1024).is_err());
        bytes[4..12].fill(255);
        assert!(Image::read(&bytes, usize::MAX).is_err());
    }
}
