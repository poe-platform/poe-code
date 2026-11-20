use super::fax;

pub(super) use terminal_png_rust::tiff::{signature, Tiff};

// The image2 command intentionally probes incomplete TIFF metadata and supplies
// an empty/default frame. Pixel decoders and document exports remain strict.
pub(super) fn dimensions(bytes: &[u8], limit: usize) -> Result<(usize, usize), &'static str> {
    let error = "Offset is outside the bounds of the DataView";
    let little = bytes.starts_with(b"II");
    let directory = word(bytes.get(4..8).ok_or(error)?, little) as usize;
    let dir = bytes.get(directory..).ok_or(error)?;
    let count = word(dir.get(..2).ok_or(error)?, little) as usize;
    let entries = dir.get(2..2 + count * 12).ok_or(error)?;
    let mut size = (0, 0);
    for entry in entries.chunks_exact(12) {
        let tag = word(&entry[..2], little);
        if !matches!(tag, 256 | 257) { continue; }
        let stride = match word(&entry[2..4], little) { 3 => 2, 4 => 4, _ => 1 };
        let value = word(&entry[8..8 + stride], little) as usize;
        if tag == 256 { size.0 = value; } else { size.1 = value; }
    }
    if size.0.max(1).saturating_mul(size.1.max(1)) > limit / 4 { return Err("image exceeds memory budget"); }
    Ok(size)
}


fn packbits(row: &[u8], out: &mut Vec<u8>) {
    let mut i = 0;
    while i < row.len() {
        let run = row[i..].iter().take(128).take_while(|&&b| b == row[i]).count();
        if run >= 3 {
            out.extend([1u8.wrapping_sub(run as u8), row[i]]);
            i += run;
        } else {
            let start = i;
            i += 1;
            while i < row.len() && i - start < 128
                && !(i + 2 < row.len() && row[i] == row[i + 1] && row[i] == row[i + 2]) { i += 1; }
            out.push((i - start - 1) as u8);
            out.extend_from_slice(&row[start..i]);
        }
    }
}

pub(super) fn encode(
    pixels: &[[u8; 4]], width: usize, dpi: [f64; 2], color: &str,
    compression: &str, dither: bool, limit: usize,
) -> Option<Vec<u8>> {
    let height = pixels.len() / width;
    let samples: u32 = if matches!(color,"rgba"|"cmyk") { 4 } else if color == "rgb" { 3 } else { 1 };
    let mono = samples == 1 && color == "mono";
    let bits = if mono { 1 } else { 8 };
    let codec = match compression { "none" => 1, "ccittrle" => 2, "ccittfax3" | "ccittt4" => 3, "ccittfax4" | "ccittt6" => 4, "lzw" => 5, "jpeg" => 7, "deflate" => 32946, "packbits" => 32773, _ => return None };
    if matches!(codec, 2..=4) && !mono { return None; }
    let strip = if codec == 7 {
        if samples == 4 || mono { return None; }
        super::jpeg::encode(super::jpeg::Input::Page { width, height, pixels, quality: 75,
            dpi: dpi.map(|v| v as u16), gray: samples == 1 }, limit).ok()?
    } else {
        let stride = if mono { width.div_ceil(8) } else { width.checked_mul(samples as usize)? };
        if stride.checked_mul(height)? > limit { return None; }
        let mut raw = Vec::new();
        let mut row = Vec::with_capacity(stride);
        for (y, line) in pixels.chunks_exact(width).enumerate() {
            row.clear();
            for (x, &[r, g, b, a]) in line.iter().enumerate() {
                if color == "cmyk" { row.extend([r,g,b,a]); } else if samples == 4 {
                    row.extend([r, g, b].map(|v| ((u16::from(v) * u16::from(a) + 127) / 255) as u8));
                    row.push(a);
                } else if samples == 3 {
                    row.extend([r, g, b]);
                } else {
                    let gray = ((30 * u32::from(r) + 59 * u32::from(g) + 11 * u32::from(b) + 50) / 100) as u8;
                    if mono {
                        // Splash's default screen at ordinary raster resolutions.
                        const SCREEN: [[u8; 4]; 4] = [[17,255,34,204],[153,85,170,102],[51,221,1,238],[187,119,136,68]];
                        if x % 8 == 0 { row.push(0); }
                        if gray >= if dither { SCREEN[y % 4][x % 4] } else { 128 } {
                            row[x / 8] |= 128 >> (x % 8);
                        }
                    } else { row.push(gray); }
                }
            }
            if codec == 32773 { packbits(&row, &mut raw); } else { raw.extend_from_slice(&row); }
            if raw.len() > limit { return None; }
        }
        match codec {
            2..=4 => fax::encode(&raw, width, codec, limit)?,
            5 => crate::commands::codecs::tiff_lzw(&raw),
            32946 => crate::commands::codecs::zlib_compress(&raw),
            _ => raw,
        }
    };
    encode_strip(&strip, [width, height], dpi, color, samples, bits, codec, limit)
}

pub(super) fn encode_strip(strip: &[u8], [width, height]: [usize; 2], dpi: [f64; 2], color: &str,
    samples: u32, bits: u32, codec: u32, limit: usize) -> Option<Vec<u8>> {
    let mut out = b"II*\0\0\0\0\0".to_vec();
    let strip_len = u32::try_from(strip.len()).ok()?;
    if strip.len().checked_add(8)? > limit { return None; }
    out.extend_from_slice(strip);
    if out.len() % 2 != 0 { out.push(0); }
    let bits_field = if samples == 1 { bits } else {
        let offset = u32::try_from(out.len()).ok()?;
        for _ in 0..samples { out.extend_from_slice(&(bits as u16).to_le_bytes()); }
        offset
    };
    let resolutions = u32::try_from(out.len()).ok()?;
    for value in dpi {
        let den = (f64::from(u32::MAX) / value.max(1.)).clamp(1., 65536.) as u32;
        out.extend_from_slice(&((value * f64::from(den)).round() as u32).to_le_bytes());
        out.extend_from_slice(&den.to_le_bytes());
    }
    let directory = u32::try_from(out.len()).ok()?;
    out[4..8].copy_from_slice(&directory.to_le_bytes());
    let ycbcr = codec == 7 && samples == 3;
    let tags = [(256u16,4u16,1,width as u32), (257,4,1,height as u32),
        (258,3,samples,bits_field), (259,3,1,codec),
        (262,3,1,if samples == 1 {1} else if color == "cmyk" {5} else if ycbcr {6} else {2}),
        (273,4,1,8), (277,3,1,samples), (278,4,1,height as u32), (279,4,1,strip_len),
        (282,5,1,resolutions), (283,5,1,resolutions.checked_add(8)?), (284,3,1,1), (296,3,1,2)];
    out.extend_from_slice(&(tags.len() as u16 + u16::from(color == "rgba" || ycbcr)).to_le_bytes());
    for (tag, ty, count, value) in tags.into_iter().chain((color == "rgba").then_some((338,3,1,1)))
        .chain(ycbcr.then_some((530,3,2,0x00010001))) {
        out.extend_from_slice(&tag.to_le_bytes()); out.extend_from_slice(&ty.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes()); out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&0u32.to_le_bytes());
    (out.len() <= limit).then_some(out)
}

fn word(bytes: &[u8], little: bool) -> u32 {
    if little {
        bytes.iter().rev().fold(0, |n, b| n << 8 | u32::from(*b))
    } else {
        bytes.iter().fold(0, |n, b| n << 8 | u32::from(*b))
    }
}

#[cfg(test)]
mod tests {
    use super::super::png_pixels::Raster;
    use super::*;

    #[test]
    fn jpeg_strips_share_tables_from_the_tiff_directory() {
        let im = Raster {
            width: 3,
            height: 1,
            alpha: false,
            gray: false,
            orientation: None,
            density: 72,
            pixels: vec![[200, 30, 40, 255], [9, 27, 100, 255], [88, 111, 55, 255]],
        };
        let jpeg = super::super::jpeg::encode(super::super::jpeg::Input::Raster(&im, 85., 72), 1 << 20).unwrap();
        let expected = super::super::jpeg_decode::decode(&jpeg, 1 << 20)
            .unwrap()
            .pixels;
        let start = jpeg.windows(2).position(|v| v == [255, 219]).unwrap();
        let end = start + 2 + word(&jpeg[start + 2..start + 4], false) as usize;
        let tables = [&[255, 216], &jpeg[start..end], &[255, 217]].concat();
        let packet = [&jpeg[..start], &jpeg[end..]].concat();
        let fields = [
            (256u16, 4u16, 1, 3),
            (257, 4, 1, 1),
            (259, 4, 1, 7),
            (277, 4, 1, 3),
            (347, 7, tables.len() as u32, 86),
            (273, 4, 1, 86 + tables.len() as u32),
        ];
        let mut bytes = b"MM\0*\0\0\0\x08".to_vec();
        bytes.extend_from_slice(&(fields.len() as u16).to_be_bytes());
        for (tag, ty, n, v) in fields {
            bytes.extend_from_slice(&tag.to_be_bytes());
            bytes.extend_from_slice(&ty.to_be_bytes());
            bytes.extend_from_slice(&n.to_be_bytes());
            bytes.extend_from_slice(&v.to_be_bytes());
        }
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend(tables);
        bytes.extend(packet);
        assert_eq!(
            Tiff::parse(&bytes, 1 << 20)
                .unwrap()
                .decode()
                .unwrap()
                .pixels,
            expected
        );
    }

    #[test]
    fn decodes_libtiff_rle_group3_and_group4_strips() {
        // Same 19x7 bitmap, encoded by libtiff with different strip and fax settings.
        for encoded in [
            // ref
            "49492a001c000000935cdc6ed249622466a0cd66ba492a492500100109000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000040000000601030001000000010000001101040001000000080000001601030001000000070000001701040001000000140000001c010300010000000100000000000000",
            // strips
            "49492a0024000000c93a3b764b92022000026485399835eb92a4000880c463c72e0002200a000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000040000000601030001000000010000000a01030001000000020000001101040003000000ae0000001601030001000000030000001701040003000000a20000001c0103000100000001000000000000000a0000000b0000000700000008000000120000001d000000",
            // tiff_ccitt-0
            "49492a001e00000018ac775d00aceaba06ac300751d7035ed701785d87030a000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000020000000601030001000000010000000a01030001000000020000001101040003000000a800000016010300010000000300000017010400030000009c0000001c01030001000000010000000000000009000000090000000400000008000000110000001a000000",
            // group3-0
            "49492a002600000000880140d6bb2e0090555dd700c80a73008cba1e00bdae030088d77538000b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000bc0000001601030001000000030000001701040003000000b00000001c0103000100000001000000240104000100000000000000000000000c0000000c00000005000000080000001400000020000000",
            // group3-1
            "49492a002800000000180380c83a3b760130abbaae01009815e60008cc9a7500ec751d0018afeb700b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000be0000001601030001000000030000001701040003000000b20000001c0103000100000001000000240104000100000001000000000000000e0000000d00000005000000080000001600000023000000",
            // group3-4
            "49492a002a0000000080180080ac775d0080aceaba060080ac30078051d703805ed7010080785d8703000b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000c00000001601030001000000030000001701040003000000b40000001c0103000100000001000000240104000100000004000000000000000e0000000d00000006000000080000001600000023000000",
            // group3-5
            "49492a002c0000000080310080c83a3b76018059d5750d008059610e80c0ac590780bdae030080f1ba0e07000b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000c20000001601030001000000030000001701040003000000b60000001c0103000100000001000000240104000100000005000000000000000f0000000e00000006000000080000001700000025000000",
        ] {
            let bytes = super::super::hex_dec(encoded);
            let image = Tiff::parse(&bytes, 4096).unwrap().decode().unwrap();
            for (y, row) in image.pixels.chunks_exact(19).enumerate() {
                for (x, &pixel) in row.iter().enumerate() {
                    let v = if y == 3 || y > 0 && (x+y)%7 < 3 {255} else {0};
                    assert_eq!(pixel, [v,v,v,255], "{x},{y}");
                }
            }
        }
    }

    #[test]
    fn bilevel_strips_respect_row_padding_fill_order_and_photometric_interpretation() {
        for order in [1, 2] {
            for photo in [0, 1] {
                let fields = [(256u16,9u32),(257,2),(258,1),(259,1),(262,photo),(266,order),(273,8),(277,1),(279,4)];
                let mut bytes = b"II*\0\x0c\0\0\0".to_vec();
                for b in [0xaau8,0xff,0x55,0x7f] { bytes.push(if order == 2 { b.reverse_bits() } else { b }); }
                bytes.extend_from_slice(&(fields.len() as u16).to_le_bytes());
                for (tag,v) in fields {
                    bytes.extend_from_slice(&tag.to_le_bytes()); bytes.extend_from_slice(&4u16.to_le_bytes());
                    bytes.extend_from_slice(&1u32.to_le_bytes()); bytes.extend_from_slice(&v.to_le_bytes());
                }
                bytes.extend_from_slice(&[0;4]);
                let image = Tiff::parse(&bytes, 4096).unwrap().decode().unwrap();
                for (i,pixel) in image.pixels.iter().enumerate() {
                    let g = if (i % 2 == 0) == (photo == 1) { 255 } else { 0 };
                    assert_eq!(*pixel,[g,g,g,255], "pixel {i}, order {order}, photometric {photo}");
                }
            }
        }
    }

    #[test]
    fn places_tiff_tiles_at_their_visible_edges() {
        let fields = [
            (256u16, 3u32),
            (257, 3),
            (258, 8),
            (277, 1),
            (262, 1),
            (322, 2),
            (323, 2),
            (324, 122),
            (325, 138),
        ];
        let mut b = b"MM\0*\0\0\0\x08".to_vec();
        b.extend_from_slice(&(fields.len() as u16).to_be_bytes());
        for (tag, v) in fields {
            b.extend_from_slice(&tag.to_be_bytes());
            b.extend_from_slice(&4u16.to_be_bytes());
            b.extend_from_slice(&(if matches!(tag, 324 | 325) { 4u32 } else { 1 }).to_be_bytes());
            b.extend_from_slice(&v.to_be_bytes());
        }
        for v in [0u32, 154, 158, 162, 166, 4, 4, 4, 4] {
            b.extend_from_slice(&v.to_be_bytes());
        }
        b.extend_from_slice(&[1, 2, 4, 5, 3, 99, 6, 99, 7, 8, 99, 99, 9, 99, 99, 99]);
        let image = Tiff::parse(&b, 8192).unwrap().decode().unwrap();
        assert_eq!(
            image.pixels,
            [1, 2, 3, 4, 5, 6, 7, 8, 9].map(|g| [g, g, g, 255])
        );
    }

    #[test]
    fn decompresses_predictor_encoded_big_endian_strips() {
        // Two grayscale rows; each strip resets the horizontal predictor.
        let rows = [[8u8, 2, 4], [20, 254, 3]];
        for compression in [5u32, 8, 32773] {
            let mut strips = Vec::new();
            for row in rows {
                strips.push(match compression {
                    5 => {
                        let mut bits = 0u64;
                        for code in [256, row[0] as u16, row[1] as u16, row[2] as u16, 257] {
                            bits = bits << 9 | u64::from(code);
                        }
                        (bits << 3).to_be_bytes()[2..].to_vec()
                    }
                    8 => crate::commands::codecs::zlib_compress(&row),
                    _ => [vec![2], row.to_vec()].concat(),
                });
            }
            let mut b = b"MM\0*\0\0\0\x08".to_vec();
            let fields = [
                (256, 3),
                (257, 2),
                (258, 8),
                (259, compression),
                (273, 134),
                (277, 1),
                (278, 1),
                (279, 142),
                (317, 2),
                (262, 1),
            ];
            b.extend_from_slice(&(fields.len() as u16).to_be_bytes());
            for (tag, v) in fields {
                b.extend_from_slice(&(tag as u16).to_be_bytes());
                b.extend_from_slice(&4u16.to_be_bytes());
                b.extend_from_slice(
                    &(if matches!(tag, 273 | 279) { 2u32 } else { 1 }).to_be_bytes(),
                );
                b.extend_from_slice(&v.to_be_bytes());
            }
            for v in [
                0u32,
                150,
                150 + strips[0].len() as u32,
                strips[0].len() as u32,
                strips[1].len() as u32,
            ] {
                b.extend_from_slice(&v.to_be_bytes());
            }
            for strip in strips {
                b.extend(strip);
            }
            let image = Tiff::parse(&b, 8192).unwrap().decode().unwrap();
            assert_eq!(
                image.pixels,
                [8, 10, 14, 20, 18, 21].map(|g| [g, g, g, 255]),
                "compression {compression}"
            );
        }
    }
}
