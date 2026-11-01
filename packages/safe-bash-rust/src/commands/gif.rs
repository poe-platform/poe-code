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
