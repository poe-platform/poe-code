use super::super::structured::JVal::{Number, Object, Str};
use super::{
    media_probe::{self, Codec, Packet, ProbeOptions, StreamInfo},
    png_pixels::Raster,
};

pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.len() >= 6 && bytes[..2] == [0, 0] && matches!(bytes[2], 1 | 2) && bytes[3] == 0
}

pub(super) struct Image<'a> {
    pub data: &'a [u8],
    pub tag: &'static [u8; 4],
    pub raster: Raster,
}

pub(super) fn times(
    seek: super::InputTime,
    limit: usize,
) -> Result<impl Iterator<Item = (f64, f64)>, &'static str> {
    let count = seek
        .loops
        .checked_add(1)
        .filter(|&n| n <= limit / size_of::<(f64, f64)>())
        .ok_or("frame index exceeds memory budget")?;
    Ok((0..count).map(|i| (i as f64 / 25., 0.04)))
}

pub(super) fn read<'a>(
    bytes: &'a [u8],
    remaining: &mut usize,
) -> Result<Vec<Image<'a>>, &'static str> {
    if !signature(bytes) {
        return Err("Invalid ICO directory");
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    let directory = 6 + count * 16;
    if count == 0 || directory > bytes.len() {
        return Err("Truncated ICO directory");
    }
    if count > 32 {
        return Err("input stream count exceeds limit");
    }
    *remaining = remaining
        .checked_sub(count * size_of::<Image>())
        .ok_or("image exceeds memory budget")?;
    let mut images = Vec::with_capacity(count);
    for entry in bytes[6..directory].chunks_exact(16) {
        let word = |i| u32::from_le_bytes(entry[i..i + 4].try_into().unwrap()) as u64;
        let (offset, length) = (word(12), word(8));
        if length < 8 || offset < directory as u64 || offset + length > bytes.len() as u64 {
            return Err("Invalid ICO image range");
        }
        let data = &bytes[offset as usize..(offset + length) as usize];
        let mut width = if entry[0] == 0 {
            256
        } else {
            usize::from(entry[0])
        };
        let mut height = if entry[1] == 0 {
            256
        } else {
            usize::from(entry[1])
        };
        let png = data.starts_with(b"\x89PNG\r\n\x1a\n");
        if !png {
            if data.len() < 40 {
                return Err("Truncated ICO DIB");
            }
            let w = i32::from_le_bytes(data[4..8].try_into().unwrap());
            let h = i32::from_le_bytes(data[8..12].try_into().unwrap());
            if w < 1
                || h < 2
                || h % 2 != 0
                || w % 256 != i32::from(entry[0])
                || h / 2 % 256 != i32::from(entry[1])
            {
                return Err("Unsupported ICO DIB dimensions");
            }
            width = w as usize;
            height = h as usize / 2;
        }
        let size = width
            .checked_mul(height)
            .and_then(|n| n.checked_mul(4))
            .ok_or("image exceeds memory budget")?;
        if size > *remaining {
            return Err("image exceeds memory budget");
        }
        let mut raster = if png {
            let image = Raster::decode(data, *remaining)?;
            if image.width != width || image.height != height {
                return Err("ICO PNG dimensions disagree with directory");
            }
            image
        } else {
            dib(data, width, height)?
        };
        raster.alpha = true;
        raster.gray = false;
        raster.density = 72;
        raster.orientation = None;
        *remaining -= size;
        images.push(Image {
            data,
            tag: if png { b"png " } else { b"bmp " },
            raster,
        });
    }
    Ok(images)
}

fn dib(data: &[u8], width: usize, height: usize) -> Result<Raster, &'static str> {
    let word = |i| u32::from_le_bytes(data[i..i + 4].try_into().unwrap()) as u64;
    let header = word(0);
    let bits = u16::from_le_bytes(data[14..16].try_into().unwrap()) as usize;
    if header < 40
        || header > data.len() as u64
        || data[12..14] != [1, 0]
        || word(16) != 0
        || !matches!(bits, 1 | 4 | 8 | 24 | 32)
    {
        return Err("Unsupported ICO DIB layout");
    }
    let colors = if bits <= 8 {
        let n = word(32);
        if n == 0 { 1 << bits } else { n }
    } else {
        0
    };
    if colors > 1 << bits {
        return Err("Invalid ICO palette");
    }
    let start = header + colors * 4;
    let stride = (width as u64 * bits as u64).div_ceil(32) * 4;
    let mask_stride = (width as u64).div_ceil(32) * 4;
    let mask = start + stride * height as u64;
    let end = mask + mask_stride * height as u64;
    if mask > data.len() as u64
        || (bits != 32 || mask < data.len() as u64) && end > data.len() as u64
    {
        return Err("Truncated ICO bitmap");
    }
    let mut pixels = Vec::with_capacity(width * height);
    let mut alpha = false;
    for y in 0..height {
        let row = (start + (height - 1 - y) as u64 * stride) as usize;
        for x in 0..width {
            let pixel = if bits <= 8 {
                let index = (data[row + x * bits / 8] >> (8 - bits - x * bits % 8)) as u64
                    & ((1 << bits) - 1);
                if index >= colors {
                    return Err("Invalid ICO palette index");
                }
                (header + index * 4) as usize
            } else {
                row + x * (bits / 8)
            };
            let a = if bits == 32 { data[pixel + 3] } else { 255 };
            alpha |= bits == 32 && a != 0;
            pixels.push([data[pixel + 2], data[pixel + 1], data[pixel], a]);
        }
    }
    for y in 0..height {
        for x in 0..width {
            let pixel = &mut pixels[y * width + x];
            if bits == 32 && !alpha {
                pixel[3] = 255;
            }
            if end <= data.len() as u64
                && data[(mask + (height - 1 - y) as u64 * mask_stride) as usize + x / 8]
                    & (128 >> (x % 8))
                    != 0
            {
                pixel[3] = 0;
            }
        }
    }
    Ok(Raster {
        width,
        height,
        pixels,
        alpha: true,
        gray: false,
        density: 72,
        orientation: None,
    })
}

pub(super) fn write(images: &[Raster], limit: usize) -> Result<Vec<u8>, &'static str> {
    if images.is_empty() || images.len() > 65535 {
        return Err("ICO requires between 1 and 65535 images");
    }
    let mut size = 6 + images.len() * 16;
    if size > limit {
        return Err("output byte limit exceeded");
    }
    let mut payloads = Vec::new();
    for image in images {
        if image.width == 0 || image.height == 0 || image.width > 256 || image.height > 256 {
            return Err("ICO dimensions must be between 1 and 256");
        }
        let png = super::frame_output::encode(image, "png", 100., 0, limit - size)?;
        size = size
            .checked_add(png.len())
            .filter(|&n| n <= limit && n <= u32::MAX as usize)
            .ok_or("output byte limit exceeded")?;
        payloads.push(png);
    }
    let mut bytes = vec![0; 6 + images.len() * 16];
    bytes[2] = 1;
    bytes[4..6].copy_from_slice(&(images.len() as u16).to_le_bytes());
    for (i, (image, png)) in images.iter().zip(payloads).enumerate() {
        let p = 6 + i * 16;
        bytes[p] = image.width as u8;
        bytes[p + 1] = image.height as u8;
        bytes[p + 4] = 1;
        bytes[p + 6] = 32;
        bytes[p + 8..p + 12].copy_from_slice(&(png.len() as u32).to_le_bytes());
        let offset = bytes.len() as u32;
        bytes[p + 12..p + 16].copy_from_slice(&offset.to_le_bytes());
        bytes.extend_from_slice(&png);
    }
    Ok(bytes)
}

pub(super) fn report(
    bytes: &[u8],
    filename: &str,
    limit: usize,
    mut opts: ProbeOptions<'_>,
) -> Result<String, &'static str> {
    let images = read(bytes, &mut { limit })?;
    if opts.writer == "json" && opts.show.contains("frame") && opts.show.contains("packet") {
        opts.show.remove("frame");
        opts.show.remove("packet");
        opts.show.insert("packet_frame");
    }
    let select = opts.select;
    let counts = opts.counts;
    media_probe::report(opts, |section| {
        let rows = images
            .iter()
            .enumerate()
            .filter(move |(i, _)| media_probe::selected(select, "video", *i, *i))
            .flat_map(move |(i, image)| {
                let codec = Codec::Video {
                    tag: image.tag,
                    width: Some(image.raster.width as i64),
                    height: Some(image.raster.height as u32),
                };
                let packet = Packet {
                    pts: 0,
                    dts: 0,
                    ticks: 1.,
                    size: image.data.len() as u64,
                    pos: 0,
                    key: true,
                };
                let stream = || {
                    StreamInfo {
                        codec,
                        scale: 25,
                        start: 0,
                        ticks: 1.,
                        sample_ticks: 1.,
                        id: i as u64 + 1,
                        language: "und".into(),
                        profile: None,
                        count: 1,
                        payload_bytes: image.data.len() as u64,
                        has_cts: false,
                    }
                    .stream(i, counts)
                };
                let mut rows = match section {
                    "stream" => vec![stream()],
                    "packet" | "frame" => vec![codec.record(i, 25, packet, section == "frame")],
                    "packet_frame" => [false, true]
                        .into_iter()
                        .map(|frame| {
                            let mut row = codec.record(i, 25, packet, frame);
                            row.insert(
                                0,
                                ("type", Str(if frame { "frame" } else { "packet" }.into())),
                            );
                            row
                        })
                        .collect(),
                    _ => Vec::new(),
                };
                for row in &mut rows {
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
                    for (key, value) in row {
                        match *key {
                            "pix_fmt" => *value = Str("rgba".into()),
                            "codec_tag" => {
                                *value = Str(format!("0x{:08x}", u32::from_le_bytes(*image.tag)))
                            }
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
                            _ => {}
                        }
                    }
                }
                rows
            });
        if section == "format" {
            let mut row = media_probe::format_row(
                filename,
                bytes.len(),
                ("ico", "Microsoft Windows ICO"),
                images.len(),
                0.04,
                vec![],
            );
            row.insert(3, ("nb_stream_groups", Number(0., None)));
            Box::new(std::iter::once(row))
        } else {
            Box::new(rows)
        }
    })
}
