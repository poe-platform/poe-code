//! PNG pixel decoding, including palette/alpha, 16-bit samples and Adam7.
use crate::{image::DecodedImage, inflate::inflate_raw_bounded_async, png::adler32_async};
use mcp_protocol_rust::cooperate::{block_on, yield_now};
pub fn decode(bytes: &[u8], limit: usize) -> Result<DecodedImage, &'static str> {
    block_on(decode_async(bytes, limit))
}
pub async fn decode_async(bytes: &[u8], limit: usize) -> Result<DecodedImage, &'static str> {
    let mut idat = Vec::new();
    let header = crate::image_header::Png::read_async(bytes, |data| {
        if data.len() > limit - idat.len() {
            return Err("image exceeds memory budget");
        }
        idat.extend_from_slice(data);
        Ok(())
    })
    .await?;
    if header.truncated {
        return Err("Truncated PNG chunk");
    }
    let h = header.ihdr.ok_or("Invalid PNG header")?;
    let (density, palette, trns) = (
        header.density,
        header.palette,
        header.transparency.unwrap_or_default(),
    );
    let width = u32::from_be_bytes(h[..4].try_into().unwrap()) as usize;
    let height = u32::from_be_bytes(h[4..8].try_into().unwrap()) as usize;
    let count = width
        .checked_mul(height)
        .filter(|&n| n > 0 && n <= limit / 4)
        .ok_or("image exceeds memory budget")?;
    let depth = h[8] as usize;
    let color = h[9];
    let channels = match (color, depth) {
        (0, 1 | 2 | 4 | 8 | 16) | (3, 1 | 2 | 4 | 8) => 1,
        (2, 8 | 16) => 3,
        (4, 8 | 16) => 2,
        (6, 8 | 16) => 4,
        _ => return Err("Unsupported PNG encoding"),
    };
    let passes: &[(usize, usize, usize, usize)] = match &h[10..13] {
        [0, 0, 0] => &[(0, 0, 1, 1)],
        [0, 0, 1] => &[
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ],
        _ => return Err("Unsupported PNG encoding"),
    };
    let stride = (channels * depth).div_ceil(8);
    let mut layout = Vec::new();
    let mut expected = 0usize;
    for &(x, y, dx, dy) in passes {
        let cols = width.saturating_sub(x).div_ceil(dx);
        let rows = height.saturating_sub(y).div_ceil(dy);
        if rows == 0 || cols == 0 {
            continue;
        }
        let bytes = cols
            .checked_mul(channels * depth)
            .ok_or("image exceeds memory budget")?
            .div_ceil(8);
        expected = (bytes + 1)
            .checked_mul(rows)
            .and_then(|n| expected.checked_add(n))
            .filter(|&n| n <= limit)
            .ok_or("image exceeds memory budget")?;
        layout.push((x, y, dx, dy, cols, rows, bytes));
    }
    if idat.is_empty() {
        return Err("unexpected end of file");
    }
    if idat.len() < 6
        || idat[0] & 15 != 8
        || idat[0] >> 4 > 7
        || u16::from_be_bytes([idat[0], idat[1]]) % 31 != 0
        || idat[1] & 32 != 0
    {
        return Err("Invalid zlib header");
    }
    let (mut raw, end) = inflate_raw_bounded_async(&idat[2..], expected)
        .await
        .map_err(|_| "Invalid PNG image data")?;
    if raw.len() != expected {
        return Err("Truncated PNG image data");
    }
    if idat.get(2 + end..6 + end) != Some(adler32_async(&raw).await.to_be_bytes().as_slice()) {
        return Err("incorrect data check");
    }
    let mut pixels = vec![[0; 4]; count];
    let mut pos = 0;
    for (x0, y0, dx, dy, cols, rows, bytes) in layout {
        for y in 0..rows {
            let filter = raw[pos];
            pos += 1;
            let (prior, current) = raw.split_at_mut(pos);
            let previous = if y == 0 {
                &[]
            } else {
                &prior[pos - bytes - 1..pos - 1]
            };
            unfilter_row_async(&mut current[..bytes], previous, stride, filter).await?;
            let row = &raw[pos..pos + bytes];
            for x in 0..cols {
                if x % 4096 == 0 {
                    yield_now().await;
                }
                let sample = |c| -> u16 {
                    let i: usize = x * channels + c;
                    match depth {
                        16 => u16::from_be_bytes([row[i * 2], row[i * 2 + 1]]),
                        8 => row[i].into(),
                        _ => {
                            u16::from(row[i * depth / 8] >> (8 - depth - (i * depth % 8)))
                                & ((1 << depth) - 1)
                        }
                    }
                };
                let byte = |i| match depth {
                    16 => (sample(i) >> 8) as u8,
                    8 => sample(i) as u8,
                    _ => (sample(i) * 255 / ((1 << depth) - 1)) as u8,
                };
                let transparent = |n| {
                    trns.len() >= n * 2
                        && (0..n).all(|i| {
                            sample(i) == u16::from_be_bytes([trns[2 * i], trns[2 * i + 1]])
                        })
                };
                pixels[(y0 + y * dy) * width + x0 + x * dx] = match color {
                    0 => [
                        byte(0),
                        byte(0),
                        byte(0),
                        if transparent(1) { 0 } else { 255 },
                    ],
                    2 => [
                        byte(0),
                        byte(1),
                        byte(2),
                        if transparent(3) { 0 } else { 255 },
                    ],
                    3 => {
                        let i = sample(0) as usize;
                        [
                            *palette.get(i * 3).unwrap_or(&0),
                            *palette.get(i * 3 + 1).unwrap_or(&0),
                            *palette.get(i * 3 + 2).unwrap_or(&0),
                            *trns.get(i).unwrap_or(&255),
                        ]
                    }
                    4 => [byte(0), byte(0), byte(0), byte(1)],
                    _ => [byte(0), byte(1), byte(2), byte(3)],
                };
            }
            pos += bytes;
        }
    }
    Ok(DecodedImage {
        width,
        height,
        gray: color == 4 || (color == 0 && trns.is_empty()),
        density,
        orientation: header.orientation,
        alpha: matches!(color, 4 | 6) || !trns.is_empty(),
        pixels,
    })
}

pub fn unfilter_row(
    row: &mut [u8],
    previous: &[u8],
    stride: usize,
    filter: u8,
) -> Result<(), &'static str> {
    block_on(unfilter_row_async(row, previous, stride, filter))
}
async fn unfilter_row_async(
    row: &mut [u8],
    previous: &[u8],
    stride: usize,
    filter: u8,
) -> Result<(), &'static str> {
    for i in 0..row.len() {
        if i % 4096 == 0 {
            yield_now().await;
        }
        let left = i.checked_sub(stride).map_or(0, |j| row[j]);
        let up = previous.get(i).copied().unwrap_or(0);
        let pred = match filter {
            0 => return Ok(()),
            1 => left,
            2 => up,
            3 => ((u16::from(left) + u16::from(up)) / 2) as u8,
            4 => {
                let ul = i
                    .checked_sub(stride)
                    .and_then(|j| previous.get(j))
                    .copied()
                    .unwrap_or(0);
                let p = i32::from(left) + i32::from(up) - i32::from(ul);
                [left, up, ul]
                    .into_iter()
                    .min_by_key(|c| (p - i32::from(*c)).abs())
                    .unwrap()
            }
            _ => return Err("Invalid PNG filter"),
        };
        row[i] = row[i].wrapping_add(pred);
    }
    Ok(())
}
