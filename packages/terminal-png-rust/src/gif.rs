//! GIF pixel decoding with first-frame and animation visitors.
//! The first frame uses the full logical canvas with transparent unpainted pixels,
//! matching browser display. Later disposal restores the declared background or prior frame.
use crate::image::DecodedImage;
use mcp_protocol_rust::cooperate::{block_on, yield_now};

pub fn signature(bytes: &[u8]) -> bool {
    matches!(bytes.get(..6), Some(b"GIF87a" | b"GIF89a"))
}
pub fn dimensions(bytes: &[u8]) -> Result<(u32, u32), &'static str> {
    if !signature(bytes) || bytes.len() < 13 {
        return Err("Invalid GIF header");
    }
    let dim = |i| u32::from(u16::from_le_bytes([bytes[i], bytes[i + 1]]));
    let size = (dim(6), dim(8));
    if size.0 == 0 || size.1 == 0 {
        return Err("Invalid GIF dimensions");
    }
    Ok(size)
}

fn take<'a>(input: &mut &'a [u8], n: usize) -> Result<&'a [u8], &'static str> {
    let head = input.get(..n).ok_or("Truncated GIF data")?;
    *input = &input[n..];
    Ok(head)
}
fn byte(input: &mut &[u8]) -> Result<u8, &'static str> {
    Ok(take(input, 1)?[0])
}
fn palette<'a>(input: &mut &'a [u8], flags: u8) -> Result<&'a [u8], &'static str> {
    take(
        input,
        if flags & 128 == 0 {
            0
        } else {
            3 << ((flags & 7) + 1)
        },
    )
}
async fn skip_blocks(input: &mut &[u8]) -> Result<(), &'static str> {
    loop {
        yield_now().await;
        let n = byte(input)? as usize;
        if n == 0 {
            return Ok(());
        }
        take(input, n)?;
    }
}
fn color(palette: &[u8], index: u8) -> Result<[u8; 4], &'static str> {
    let at = usize::from(index) * 3;
    let rgb = palette.get(at..at + 3).ok_or("Invalid GIF palette index")?;
    Ok([rgb[0], rgb[1], rgb[2], 255])
}

pub fn decode(
    bytes: &[u8],
    remaining_frames: usize,
    limit: usize,
    visit: impl FnMut(&[[u8; 4]], bool) -> Result<(), &'static str>,
) -> Result<DecodedImage, &'static str> {
    block_on(decode_async(bytes, remaining_frames, limit, visit))
}

async fn indices(
    input: &mut &[u8],
    minimum: u8,
    n: usize,
    mut pixel: impl FnMut(u8) -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    if !(2..=8).contains(&minimum) {
        return Err("Invalid GIF LZW minimum code size");
    }
    let clear = 1usize << minimum;
    let mut width = minimum + 1;
    let mut next = clear + 2;
    let mut old = None;
    let mut first = 0;
    // Fixed 16KiB workspace; no compressed stream or index raster is copied.
    let mut prefix = [0u16; 4096];
    let mut suffix = [0u8; 4096];
    let mut stack = [0u8; 4096];
    let (mut buffer, mut bits) = (0u32, 0u8);
    let mut block_left = 0;
    let mut written = 0;
    let mut work = n.saturating_add(1).saturating_mul(32);
    let mut codes = 0;
    loop {
        if codes % 512 == 0 {
            yield_now().await;
        }
        codes += 1;
        work = work.checked_sub(1).ok_or("GIF LZW work limit exceeded")?;
        while bits < width {
            if block_left == 0 {
                block_left = byte(input)? as usize;
                if block_left == 0 {
                    return Err("Truncated GIF LZW data");
                }
                if input.len() < block_left {
                    return Err("Truncated GIF data block");
                }
            }
            buffer |= u32::from(byte(input)?) << bits;
            bits += 8;
            block_left -= 1;
        }
        let code = (buffer as usize) & ((1 << width) - 1);
        buffer >>= width;
        bits -= width;
        if code == clear {
            width = minimum + 1;
            next = clear + 2;
            old = None;
            continue;
        }
        if code == clear + 1 {
            if written != n {
                return Err("Truncated GIF raster");
            }
            take(input, block_left)?;
            skip_blocks(input).await?;
            return Ok(());
        }
        if code > next {
            return Err("Invalid GIF LZW dictionary");
        }
        let mut used = 0;
        let mut c = code;
        if c == next {
            let prev = old.ok_or("Invalid GIF LZW dictionary")?;
            stack[0] = first;
            used = 1;
            c = prev;
        }
        while c >= clear {
            if used >= 4095 || c >= next {
                return Err("Invalid GIF LZW dictionary");
            }
            if used % 512 == 0 {
                yield_now().await;
            }
            work = work.checked_sub(1).ok_or("GIF LZW work limit exceeded")?;
            stack[used] = suffix[c];
            used += 1;
            c = usize::from(prefix[c]);
        }
        first = c as u8;
        stack[used] = first;
        if used + 1 > n - written {
            return Err("GIF raster exceeds frame dimensions");
        }
        for &v in stack[..=used].iter().rev() {
            if written % 4096 == 0 {
                yield_now().await;
            }
            pixel(v)?;
            written += 1;
        }
        if let Some(prev) = old
            && next < 4096
        {
            prefix[next] = prev as u16;
            suffix[next] = first;
            next += 1;
            if next == 1 << width && width < 12 {
                width += 1;
            }
        }
        old = Some(code);
    }
}

pub async fn decode_async(
    bytes: &[u8],
    mut remaining_frames: usize,
    limit: usize,
    mut visit: impl FnMut(&[[u8; 4]], bool) -> Result<(), &'static str>,
) -> Result<DecodedImage, &'static str> {
    if remaining_frames == 0 {
        return Err("GIF frame limit must be positive");
    }
    let (w, h) = dimensions(bytes)?;
    let (w, h) = (w as usize, h as usize);
    let count = w
        .checked_mul(h)
        .filter(|&n| n <= limit / 4)
        .ok_or("image exceeds memory budget")?;
    let mut input = &bytes[13..];
    let global = palette(&mut input, bytes[10])?;
    let background = if global.is_empty() {
        [0, 0, 0, 255]
    } else {
        color(global, bytes[11])?
    };
    let mut pixels = vec![[0u8; 4]; count];
    let mut transparent = None;
    let mut declared_alpha = false;
    let mut disposal = 0;
    let mut prior: Option<(u8, usize, usize, usize, usize, [u8; 4])> = None;
    let mut saved = Vec::new();
    let mut work = (limit / 4).saturating_mul(32);
    let mut frames = 0;
    loop {
        yield_now().await;
        match byte(&mut input)? {
            59 => break,
            33 => {
                let label = byte(&mut input)?;
                if label == 249 {
                    if byte(&mut input)? != 4 {
                        return Err("Invalid GIF graphic control extension");
                    }
                    let gce = take(&mut input, 4)?;
                    disposal = (gce[0] >> 2) & 7;
                    if gce[0] & 0xe0 != 0 || disposal > 3 {
                        return Err("Unsupported GIF disposal method");
                    }
                    transparent = (gce[0] & 1 != 0).then_some(gce[3]);
                    if byte(&mut input)? != 0 {
                        return Err("Invalid GIF graphic control terminator");
                    }
                } else if label == 1 {
                    return Err("Unsupported GIF plain text extension");
                } else {
                    skip_blocks(&mut input).await?;
                }
            }
            44 => {
                let head = take(&mut input, 9)?;
                let word = |i| usize::from(u16::from_le_bytes([head[i], head[i + 1]]));
                let (left, top, iw, ih) = (word(0), word(2), word(4), word(6));
                let flags = head[8];
                if iw == 0 || ih == 0 || left + iw > w || top + ih > h || flags & 0x18 != 0 {
                    return Err("Invalid GIF frame dimensions or flags");
                }
                let colors = if flags & 128 != 0 {
                    palette(&mut input, flags)?
                } else {
                    global
                };
                if colors.is_empty() {
                    return Err("GIF frame has no color palette");
                }
                if let Some(index) = transparent {
                    color(colors, index)?;
                }
                let minimum = byte(&mut input)?;
                let n = iw
                    .checked_mul(ih)
                    .filter(|&n| n <= limit / 4)
                    .ok_or("image exceeds memory budget")?;
                let clear_color = if transparent.is_some() {
                    [0; 4]
                } else {
                    background
                };
                if let Some((op, l, t, r, b, clear_color)) = prior.take() {
                    if op == 2 {
                        for y in t..b {
                            if (y - t) % 32 == 0 {
                                yield_now().await;
                            }
                            pixels[y * w + l..y * w + r].fill(clear_color);
                        }
                    } else if op == 3 {
                        std::mem::swap(&mut saved, &mut pixels);
                    }
                }
                if remaining_frames > 1 {
                    work = work
                        .checked_sub(n.saturating_add(if disposal == 3 { count } else { 0 }))
                        .ok_or("GIF pixel work limit exceeded")?;
                    if disposal == 3 {
                        if count > limit / 8 {
                            return Err("image exceeds memory budget");
                        }
                        saved.resize(count, [0; 4]);
                        for (dst, src) in saved.chunks_mut(4096).zip(pixels.chunks(4096)) {
                            dst.copy_from_slice(src);
                            yield_now().await;
                        }
                    }
                    prior = Some((disposal, left, top, left + iw, top + ih, clear_color));
                }
                let (mut x, mut y, mut pass) = (0, 0, 0);
                indices(&mut input, minimum, n, |index| {
                    let rgba = color(colors, index)?;
                    if Some(index) != transparent {
                        pixels[(y + top) * w + x + left] = rgba;
                    }
                    x += 1;
                    if x == iw {
                        x = 0;
                        if flags & 64 != 0 {
                            y += [8, 8, 4, 2][pass];
                            while y >= ih && pass < 3 {
                                pass += 1;
                                y = [0, 4, 2, 1][pass];
                            }
                        } else {
                            y += 1;
                        }
                    }
                    Ok(())
                })
                .await?;
                frames += 1;
                declared_alpha |= transparent.is_some();
                visit(&pixels, declared_alpha)?;
                remaining_frames -= 1;
                if remaining_frames == 0 {
                    if !matches!(input.first(), Some(33 | 44 | 59)) {
                        return Err("Truncated or invalid GIF trailer");
                    }
                    break;
                }
                transparent = None;
                disposal = 0;
            }
            _ => return Err("Invalid GIF block"),
        }
    }
    if frames == 0 {
        return Err("GIF contains no image frame");
    }
    Ok(DecodedImage {
        width: w,
        height: h,
        alpha: declared_alpha || pixels.iter().any(|p| p[3] < 255),
        gray: false,
        density: 72,
        orientation: None,
        pixels,
    })
}
