use super::png_pixels::Raster;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn signature(bytes: &[u8]) -> bool {
    matches!(bytes.get(..6), Some(b"GIF87a" | b"GIF89a"))
}
pub(super) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), &'static str> {
    if bytes.len() < 13 {
        return Err("Invalid GIF header");
    }
    let dim = |i| u32::from(u16::from_le_bytes([bytes[i], bytes[i + 1]]));
    Ok((dim(6), dim(8)))
}

pub(super) fn encode(im: &Raster, limit: usize) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (im.width, im.height);
    if !(1..=65535).contains(&w) || !(1..=65535).contains(&h) {
        return Err("GIF dimensions exceed 16-bit frame fields");
    }
    let mut palette = [[0u8; 3]; 256];
    let mut colors = BTreeMap::new();
    for (i, color) in palette[..254].iter_mut().enumerate() {
        *color = [
            ((((i >> 5) & 7) * 255 + 3) / 7) as u8,
            ((((i >> 2) & 7) * 255 + 3) / 7) as u8,
            ((i & 3) * 85) as u8,
        ];
        colors.insert(*color, i as u8);
    }
    palette[254] = [255; 3];
    colors.insert([255; 3], 254);
    let mut used = BTreeSet::new();
    let mut missing = Vec::new();
    let mut seen = BTreeSet::new();
    let mut transparent = false;
    for &[r, g, b, a] in &im.pixels {
        if a < 128 {
            transparent = true;
            continue;
        }
        let rgb = [r, g, b];
        if let Some(&i) = colors.get(&rgb) {
            used.insert(i);
        } else if missing.len() < 255 && seen.insert(rgb) {
            missing.push(rgb);
        }
    }
    if used.len() + missing.len() <= 254 {
        let mut slots = (1..254).filter(|i| !used.contains(i));
        for (color, i) in missing.into_iter().zip(&mut slots) {
            colors.insert(color, i);
            palette[usize::from(i)] = color;
        }
    }
    let n = w * h;
    let len = (n + n.div_ceil(120) + 1)
        .checked_mul(9)
        .ok_or("output byte limit exceeded")?
        .div_ceil(8);
    let size = 13 + 768 + usize::from(transparent) * 8 + 11 + len + len.div_ceil(255) + 2;
    if size > limit {
        return Err("output byte limit exceeded");
    }
    let mut out = Vec::with_capacity(size);
    let dims = [(w as u16).to_le_bytes(), (h as u16).to_le_bytes()].concat();
    out.extend_from_slice(b"GIF89a");
    out.extend_from_slice(&dims);
    out.extend_from_slice(&[247, 0, 0]);
    out.extend_from_slice(palette.as_flattened());
    if transparent {
        out.extend_from_slice(&[33, 249, 4, 1, 0, 0, 255, 0]);
    }
    out.extend_from_slice(&[44, 0, 0, 0, 0]);
    out.extend_from_slice(&dims);
    out.extend_from_slice(&[0, 8]);
    let mut remaining = 0;
    let mut bytes_left = len;
    let mut emit = |byte| {
        if remaining == 0 {
            remaining = bytes_left.min(255);
            out.push(remaining as u8);
        }
        out.push(byte);
        remaining -= 1;
        bytes_left -= 1;
    };
    let mut pending = 0u32;
    let mut bits = 0;
    let mut code = |v: u16| {
        pending |= u32::from(v) << bits;
        bits += 9;
        while bits >= 8 {
            emit(pending as u8);
            pending >>= 8;
            bits -= 8;
        }
    };
    for (i, &[r, g, b, a]) in im.pixels.iter().enumerate() {
        if i % 120 == 0 {
            code(256);
        }
        let index = if a < 128 {
            255
        } else {
            colors
                .get(&[r, g, b])
                .copied()
                .unwrap_or_else(|| ((r & 224) | ((g >> 3) & 28) | (b >> 6)).min(254))
        };
        code(u16::from(index));
    }
    code(257);
    if bits != 0 {
        emit(pending as u8);
    }
    out.extend_from_slice(&[0, 59]);
    Ok(out)
}

fn take<'a>(input: &mut &'a [u8], n: usize) -> &'a [u8] {
    let (head, tail) = input.split_at(n.min(input.len()));
    *input = tail;
    head
}
fn byte(input: &mut &[u8]) -> u8 {
    take(input, 1).first().copied().unwrap_or(0)
}
fn palette<'a>(input: &mut &'a [u8], flags: u8) -> &'a [u8] {
    take(
        input,
        if flags & 128 == 0 {
            0
        } else {
            3 << ((flags & 7) + 1)
        },
    )
}
fn blocks<'a>(mut input: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
    std::iter::from_fn(move || {
        let n = byte(&mut input) as usize;
        if n == 0 || input.is_empty() {
            input = &[];
            None
        } else {
            Some(take(&mut input, n))
        }
    })
}

fn indices(
    input: &[u8],
    minimum: u8,
    n: usize,
    mut pixel: impl FnMut(u8),
) -> Result<(), &'static str> {
    if minimum > 11 {
        return Err("Invalid GIF LZW dictionary");
    }
    let clear = 1usize << minimum;
    let mut width = minimum + 1;
    let mut next = clear + 2;
    let mut old = None;
    let mut first = 0;
    let mut prefix = [0u16; 4096];
    let mut suffix = [0u8; 4096];
    let mut stack = [0u8; 4096];
    let mut bytes = blocks(input).flatten();
    let (mut buffer, mut bits) = (0u32, 0u8);
    let mut written = 0;
    'decode: while written < n {
        while bits < width {
            let Some(&v) = bytes.next() else {
                break 'decode;
            };
            buffer |= u32::from(v) << bits;
            bits += 8;
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
            break;
        }
        let mut used = 0;
        let mut c = code;
        if c >= next {
            let Some(prev) = old else { break };
            stack[0] = first;
            used = 1;
            c = prev;
        }
        while c >= clear {
            if used >= 4095 || c >= next {
                return Err("Invalid GIF LZW dictionary");
            }
            stack[used] = suffix[c];
            used += 1;
            c = usize::from(prefix[c]);
        }
        first = c as u8;
        stack[used] = first;
        for &v in stack[..=used].iter().rev().take(n - written) {
            pixel(v);
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
    for _ in written..n {
        pixel(0);
    }
    Ok(())
}

pub(super) fn decode(bytes: &[u8], last: bool, limit: usize) -> Result<Raster, &'static str> {
    let (w, h) = dimensions(bytes)?;
    let (w, h) = (w as usize, h as usize);
    let count = w
        .checked_mul(h)
        .filter(|&n| n <= limit / 4)
        .ok_or("image exceeds memory budget")?;
    let mut pixels = vec![[0u8; 4]; count];
    let mut input = &bytes[13..];
    let global = palette(&mut input, bytes[10]);
    let mut transparent = None;
    let mut disposal = 0;
    let mut prior = None;
    let mut saved = Vec::new();
    let mut work = (limit / 4).saturating_mul(32);
    while let Some((&intro, rest)) = input.split_first() {
        input = rest;
        match intro {
            33 => {
                let label = byte(&mut input);
                if label == 249 {
                    let n = byte(&mut input) as usize;
                    let gce = take(&mut input, n);
                    disposal = (gce.first().copied().unwrap_or(0) >> 2) & 7;
                    transparent = if gce.first().is_some_and(|f| f & 1 != 0) {
                        gce.get(3).copied()
                    } else {
                        None
                    };
                    byte(&mut input);
                } else {
                    loop {
                        let len = byte(&mut input);
                        if len == 0 {
                            break;
                        }
                        take(&mut input, len as usize);
                    }
                }
            }
            44 => {
                let head = take(&mut input, 9);
                let word = |i| {
                    usize::from(u16::from_le_bytes([
                        head.get(i).copied().unwrap_or(0),
                        head.get(i + 1).copied().unwrap_or(0),
                    ]))
                };
                let (left, top, iw, ih) = (word(0), word(2), word(4), word(6));
                let flags = head.get(8).copied().unwrap_or(0);
                let colors = if flags & 128 != 0 {
                    palette(&mut input, flags)
                } else {
                    global
                };
                let min = byte(&mut input);
                let n = iw
                    .checked_mul(ih)
                    .filter(|&n| n <= limit / 4)
                    .ok_or("image exceeds memory budget")?;
                if let Some((op, l, t, r, b)) = prior.take() {
                    if op == 2 {
                        for y in t..b {
                            pixels[y * w + l..y * w + r].fill([0; 4]);
                        }
                    } else if op == 3 {
                        std::mem::swap(&mut saved, &mut pixels);
                    }
                }
                if last {
                    work = work
                        .checked_sub(n.saturating_add(if disposal == 3 { count } else { 0 }))
                        .ok_or("GIF pixel work limit exceeded")?;
                    if disposal == 3 {
                        if count > limit / 8 {
                            return Err("image exceeds memory budget");
                        }
                        saved.clone_from(&pixels);
                    }
                    prior = Some((
                        disposal,
                        left.min(w),
                        top.min(h),
                        (left + iw).min(w),
                        (top + ih).min(h),
                    ));
                }
                let (mut x, mut y, mut pass) = (0, 0, 0);
                indices(input, min, n, |index| {
                    if x + left < w && y + top < h && Some(index) != transparent {
                        let i = usize::from(index) * 3;
                        pixels[(y + top) * w + x + left] = [
                            colors.get(i).copied().unwrap_or(0),
                            colors.get(i + 1).copied().unwrap_or(0),
                            colors.get(i + 2).copied().unwrap_or(0),
                            255,
                        ];
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
                })?;
                if !last {
                    break;
                }
                loop {
                    let n = byte(&mut input);
                    if n == 0 {
                        break;
                    }
                    take(&mut input, n as usize);
                }
                transparent = None;
                disposal = 0;
            }
            _ => break,
        }
    }
    Ok(Raster {
        width: w,
        height: h,
        alpha: true,
        gray: false,
        density: 72,
        orientation: None,
        pixels,
    })
}
