//! Raster header admission for Office embedding, including independent DPI axes.
//! Mirrors the established DOCX raster-header contract; no pixel decoding occurs.
use crate::png::crc32_async;
use mcp_protocol_rust::cooperate::yield_now;
use std::collections::{BTreeMap, BTreeSet};
const INVALID: &str = "Raster header or density metadata is invalid or unsupported";
type Result<T> = std::result::Result<T, &'static str>;
#[derive(Clone, Debug)]
pub struct RasterHeader {
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
    pub dpi_x: Option<f64>,
    pub dpi_y: Option<f64>,
    /// Original EXIF/TIFF orientation; dimensions above retain the stored axes.
    pub orientation: Option<u8>,
}
struct Reader<'a>(&'a [u8]);
impl Reader<'_> {
    fn slice(&self, at: usize, len: usize) -> Result<&[u8]> {
        self.0
            .get(at..at.checked_add(len).ok_or(INVALID)?)
            .ok_or(INVALID)
    }
    fn u16(&self, at: usize, le: bool) -> Result<u16> {
        let b = self.slice(at, 2)?.try_into().unwrap();
        Ok(if le {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    }
    fn u32(&self, at: usize, le: bool) -> Result<u32> {
        let b = self.slice(at, 4)?.try_into().unwrap();
        Ok(if le {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    }
    fn i32(&self, at: usize) -> Result<i32> {
        Ok(i32::from_le_bytes(self.slice(at, 4)?.try_into().unwrap()))
    }
    fn byte(&self, at: usize) -> Result<u8> {
        self.0.get(at).copied().ok_or(INVALID)
    }
}
fn dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        Err(INVALID)
    } else {
        Ok(())
    }
}
fn dpi(value: f64, factor: f64) -> Result<Option<f64>> {
    if value == 0. {
        Ok(None)
    } else if value < 0. || !(value * factor).is_finite() {
        Err(INVALID)
    } else {
        Ok(Some(value * factor))
    }
}
fn merge(old: Option<f64>, new: Option<f64>) -> Result<Option<f64>> {
    if old.is_some() && new.is_some() && old != new {
        Err(INVALID)
    } else {
        Ok(new.or(old))
    }
}
async fn png(r: &Reader<'_>) -> Result<RasterHeader> {
    let mut at = 8;
    let (mut width, mut height, mut color, mut depth) = (0, 0, 0, 0);
    let (mut data, mut data_len, mut closed, mut palette, mut density, mut ended) =
        (false, 0usize, false, false, false, false);
    let (mut x, mut y) = (None, None);
    let mut orientation = None;
    while at < r.0.len() {
        yield_now().await;
        let len = r.u32(at, false)? as usize;
        let name = r.slice(at + 4, 4)?;
        let start = at + 8;
        r.slice(start, len.checked_add(4).ok_or(INVALID)?)?;
        if !name.iter().all(u8::is_ascii_alphabetic) || name[2].is_ascii_lowercase() {
            return Err(INVALID);
        }
        if crc32_async(r.slice(at + 4, len + 4)?).await != r.u32(start + len, false)? {
            return Err(INVALID);
        }
        match name {
            b"IHDR" => {
                if at != 8 || len != 13 {
                    return Err(INVALID);
                }
                width = r.u32(start, false)?;
                height = r.u32(start + 4, false)?;
                dimensions(width, height)?;
                if width > i32::MAX as u32 || height > i32::MAX as u32 {
                    return Err(INVALID);
                }
                depth = r.byte(start + 8)?;
                color = r.byte(start + 9)?;
                let valid = match color {
                    0 => matches!(depth, 1 | 2 | 4 | 8 | 16),
                    2 | 4 | 6 => matches!(depth, 8 | 16),
                    3 => matches!(depth, 1 | 2 | 4 | 8),
                    _ => false,
                };
                if !valid
                    || r.byte(start + 10)? != 0
                    || r.byte(start + 11)? != 0
                    || r.byte(start + 12)? > 1
                {
                    return Err(INVALID);
                }
            }
            _ if width == 0 => return Err(INVALID),
            b"PLTE" => {
                if palette
                    || data
                    || matches!(color, 0 | 4)
                    || len == 0
                    || len > 768
                    || len % 3 != 0
                    || (color == 3 && len / 3 > 1usize << depth)
                {
                    return Err(INVALID);
                }
                palette = true;
            }
            b"pHYs" => {
                if len != 9 || data || density {
                    return Err(INVALID);
                }
                density = true;
                let unit = r.byte(start + 8)?;
                if unit > 1 {
                    return Err(INVALID);
                }
                if unit == 1 {
                    x = dpi(r.u32(start, false)? as f64, 0.0254)?;
                    y = dpi(r.u32(start + 4, false)? as f64, 0.0254)?;
                }
            }
            b"eXIf" => {
                orientation = crate::image_header::exif(r.slice(start, len)?)
                    .and_then(|(_, value)| value)
                    .or(orientation);
            }
            b"IDAT" => {
                if closed || (color == 3 && !palette) {
                    return Err(INVALID);
                }
                data = true;
                data_len += len;
            }
            b"IEND" => {
                if len != 0 || !data || data_len == 0 || start + 4 != r.0.len() {
                    return Err(INVALID);
                }
                ended = true;
            }
            _ if name[0].is_ascii_uppercase() => return Err(INVALID),
            _ => {}
        }
        if data && name != b"IDAT" {
            closed = true;
        }
        at = start + len + 4;
    }
    if !ended {
        return Err(INVALID);
    }
    Ok(RasterHeader {
        mime: "image/png",
        width,
        height,
        dpi_x: x,
        dpi_y: y,
        orientation,
    })
}
#[derive(Default)]
struct Tiff {
    width: Option<u32>,
    height: Option<u32>,
    x: Option<f64>,
    y: Option<f64>,
    orientation: Option<u8>,
}
async fn tiff(bytes: &[u8]) -> Result<Tiff> {
    let r = Reader(bytes);
    let little = match r.slice(0, 2)? {
        b"II" => true,
        b"MM" => false,
        _ => return Err(INVALID),
    };
    if r.u16(2, little)? != 42 {
        return Err(INVALID);
    }
    let mut pending = vec![(r.u32(4, little)? as usize, true)];
    let mut visited = BTreeSet::new();
    let mut values = BTreeMap::new();
    while let Some((at, first_page)) = pending.pop() {
        yield_now().await;
        if at == 0 {
            continue;
        }
        if at < 8 || !visited.insert(at) {
            return Err(INVALID);
        }
        let count = r.u16(at, little)? as usize;
        r.slice(at + 2, count * 12 + 4)?;
        // Validate image payload spans independently of photometric/compression
        // support: Office can consume profiles our PDF decoder does not support.
        let mut payloads = [None; 6];
        for i in 0..count {
            yield_now().await;
            let start = at + 2 + i * 12;
            let tag = r.u16(start, little)?;
            let kind = r.u16(start + 2, little)?;
            let items = r.u32(start + 4, little)? as usize;
            let size = match kind {
                1 | 2 | 6 | 7 => 1,
                3 | 8 => 2,
                4 | 9 | 11 => 4,
                5 | 10 | 12 => 8,
                _ => return Err(INVALID),
            };
            if items == 0 {
                return Err(INVALID);
            }
            let total = items.checked_mul(size).ok_or(INVALID)?;
            let address = if total <= 4 {
                start + 8
            } else {
                r.u32(start + 8, little)? as usize
            };
            if total > 4 && address < 8 {
                return Err(INVALID);
            }
            r.slice(address, total)?;
            if let Some(index) = [273, 279, 324, 325, 513, 514]
                .iter()
                .position(|value| *value == tag)
            {
                if !matches!(kind, 3 | 4) || payloads[index].is_some() {
                    return Err(INVALID);
                }
                payloads[index] = Some((address, items, kind));
            }
            if !matches!(tag, 256 | 257 | 282 | 283 | 296 | 34665) {
                continue;
            }
            if items != 1 {
                return Err(INVALID);
            }
            let value = if matches!(tag, 282 | 283) {
                if kind != 5 {
                    return Err(INVALID);
                }
                (r.u32(address, little)?, r.u32(address + 4, little)?)
            } else {
                if !matches!(kind, 3 | 4)
                    || (tag == 34665 && kind != 4)
                    || (tag == 296 && kind != 3)
                {
                    return Err(INVALID);
                }
                (
                    if kind == 3 {
                        r.u16(address, little)? as u32
                    } else {
                        r.u32(address, little)?
                    },
                    0,
                )
            };
            if first_page && let Some(prior) = values.insert(tag, value) {
                if prior != value {
                    return Err(INVALID);
                }
            }
            if tag == 34665 {
                if value.0 == 0 {
                    return Err(INVALID);
                }
                pending.push((value.0 as usize, first_page));
            }
        }
        for pair in payloads.chunks_exact(2) {
            let Some((offsets, items, offset_kind)) = pair[0] else {
                if pair[1].is_some() {
                    return Err(INVALID);
                }
                continue;
            };
            if pair[1].is_some_and(|(_, count, _)| count != items) {
                return Err(INVALID);
            }
            let number = |address, index, kind| -> Result<usize> {
                if kind == 3 {
                    Ok(r.u16(address + index * 2, little)? as usize)
                } else {
                    Ok(r.u32(address + index * 4, little)? as usize)
                }
            };
            for index in 0..items {
                yield_now().await;
                let offset = number(offsets, index, offset_kind)?;
                let length = match pair[1] {
                    Some((counts, _, kind)) => number(counts, index, kind)?,
                    None => 1,
                };
                if offset < 8 || length == 0 {
                    return Err(INVALID);
                }
                r.slice(offset, length)?;
            }
        }
        let next = r.u32(at + 2 + count * 12, little)?;
        if next != 0 {
            pending.push((next as usize, false));
        }
    }
    let unit = values.get(&296).map_or(2, |v| v.0);
    if !matches!(unit, 1..=3) {
        return Err(INVALID);
    }
    let resolution = |tag| -> Result<Option<f64>> {
        let Some(&(n, d)) = values.get(&tag) else {
            return Ok(None);
        };
        if d == 0 {
            return Err(INVALID);
        }
        if unit == 1 {
            return Ok(None);
        }
        if n == 0 {
            return Err(INVALID);
        }
        Ok(Some(
            n as f64 / d as f64 * if unit == 3 { 2.54 } else { 1. },
        ))
    };
    Ok(Tiff {
        width: values.get(&256).map(|v| v.0),
        height: values.get(&257).map(|v| v.0),
        x: resolution(282)?,
        y: resolution(283)?,
        orientation: crate::image_header::exif(bytes).and_then(|(_, value)| value),
    })
}
async fn jpeg(r: &Reader<'_>) -> Result<RasterHeader> {
    let (mut at, mut width, mut height, mut scan) = (2, 0, 0, false);
    let (mut x, mut y) = (None, None);
    let mut orientation = None;
    while at < r.0.len() {
        yield_now().await;
        if r.byte(at)? != 255 {
            return Err(INVALID);
        }
        while r.byte(at)? == 255 {
            at += 1;
        }
        let marker = r.byte(at)?;
        at += 1;
        if marker == 217 {
            break;
        }
        if marker == 216 || marker == 0 || (208..=215).contains(&marker) {
            return Err(INVALID);
        }
        if marker == 1 {
            continue;
        }
        let len = r.u16(at, false)? as usize;
        if len < 2 {
            return Err(INVALID);
        }
        r.slice(at, len)?;
        let start = at + 2;
        let payload = len - 2;
        if marker == 224 && payload >= 5 && r.slice(start, 5)? == b"JFIF\0" {
            if payload < 14 {
                return Err(INVALID);
            }
            let unit = r.byte(start + 7)?;
            if unit > 2
                || (r.byte(start + 12)? as usize * r.byte(start + 13)? as usize * 3) > payload - 14
            {
                return Err(INVALID);
            }
            if unit != 0 {
                let factor = if unit == 2 { 2.54 } else { 1. };
                x = merge(x, dpi(r.u16(start + 8, false)? as f64, factor)?)?;
                y = merge(y, dpi(r.u16(start + 10, false)? as f64, factor)?)?;
            }
        } else if marker == 225 && payload >= 6 && r.slice(start, 6)? == b"Exif\0\0" {
            let meta = tiff(r.slice(start + 6, payload - 6)?).await?;
            x = merge(x, meta.x)?;
            y = merge(y, meta.y)?;
            orientation = meta.orientation.or(orientation);
        } else if matches!(marker,192..=195|197..=199|201..=203|205..=207) {
            if payload < 6
                || r.byte(start)? != 8
                || r.byte(start + 5)? == 0
                || payload != 6 + r.byte(start + 5)? as usize * 3
            {
                return Err(INVALID);
            }
            let h = r.u16(start + 1, false)? as u32;
            let w = r.u16(start + 3, false)? as u32;
            dimensions(w, h)?;
            if width != 0 && (width != w || height != h) {
                return Err(INVALID);
            }
            width = w;
            height = h;
        } else if marker == 218 {
            if width == 0
                || payload < 4
                || r.byte(start)? == 0
                || payload != 4 + r.byte(start)? as usize * 2
            {
                return Err(INVALID);
            }
            scan = true;
            break;
        }
        at += len;
    }
    if width == 0 || !scan || r.0.len() < 2 || r.u16(r.0.len() - 2, false)? != 0xffd9 {
        return Err(INVALID);
    }
    Ok(RasterHeader {
        mime: "image/jpeg",
        width,
        height,
        dpi_x: x,
        dpi_y: y,
        orientation,
    })
}
/// Admit embedded Office raster data and retain the physical size from its header.
pub async fn characterize(bytes: &[u8]) -> Result<RasterHeader> {
    let r = Reader(bytes);
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return png(&r).await;
    }
    if bytes.starts_with(&[255, 216]) {
        return jpeg(&r).await;
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        r.slice(0, 13)?;
        let width = r.u16(6, true)? as u32;
        let height = r.u16(8, true)? as u32;
        dimensions(width, height)?;
        let packed = r.byte(10)?;
        if packed & 128 != 0 {
            r.slice(13, 3 * (1usize << ((packed & 7) + 1)))?;
        }
        return Ok(RasterHeader {
            mime: "image/gif",
            width,
            height,
            dpi_x: None,
            dpi_y: None,
            orientation: None,
        });
    }
    if bytes.starts_with(b"BM") {
        let size = r.u32(14, true)? as usize;
        if size == 12 {
            r.slice(14, size)?;
            let width = r.u16(18, true)? as u32;
            let height = r.u16(20, true)? as u32;
            dimensions(width, height)?;
            if r.u16(22, true)? != 1 {
                return Err(INVALID);
            }
            let offset = r.u32(10, true)? as usize;
            if offset < 26 || offset > bytes.len() {
                return Err(INVALID);
            }
            return Ok(RasterHeader {
                mime: "image/bmp",
                width,
                height,
                dpi_x: None,
                dpi_y: None,
                orientation: None,
            });
        }
        if size < 40 {
            return Err(INVALID);
        }
        r.slice(14, size)?;
        let width = r.i32(18)?;
        let height = r.i32(22)?;
        if width <= 0 || height == 0 || r.u16(26, true)? != 1 {
            return Err(INVALID);
        }
        let offset = r.u32(10, true)? as usize;
        if offset < 14 + size || offset > bytes.len() {
            return Err(INVALID);
        }
        if r.u32(30, true)? == 1 {
            if height < 0 || r.u16(28, true)? != 8 {
                return Err(INVALID);
            }
            let colors = r.u32(46, true)? as usize;
            let colors = if colors == 0 { 256 } else { colors };
            if colors > 256 || (14 + size).checked_add(colors * 4).ok_or(INVALID)? > offset {
                return Err(INVALID);
            }
            let declared = r.u32(2, true)? as usize;
            let end = if declared == 0 { bytes.len() } else { declared };
            if end < offset || end > bytes.len() {
                return Err(INVALID);
            }
            let length = r.u32(34, true)? as usize;
            let length = if length == 0 { end - offset } else { length };
            if length > end - offset {
                return Err(INVALID);
            }
            crate::bmp::rle8_packets(
                r.slice(offset, length)?,
                width as usize,
                height as usize,
                colors,
                |_, _, _, _| Ok(()),
            )
            .await?;
        }
        return Ok(RasterHeader {
            mime: "image/bmp",
            width: width as u32,
            height: height.unsigned_abs(),
            dpi_x: dpi(r.i32(38)? as f64, 0.0254)?,
            dpi_y: dpi(r.i32(42)? as f64, 0.0254)?,
            orientation: None,
        });
    }
    if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        let meta = tiff(bytes).await?;
        let width = meta.width.ok_or(INVALID)?;
        let height = meta.height.ok_or(INVALID)?;
        dimensions(width, height)?;
        return Ok(RasterHeader {
            mime: "image/tiff",
            width,
            height,
            dpi_x: meta.x,
            dpi_y: meta.y,
            orientation: meta.orientation,
        });
    }
    Err(INVALID)
}
