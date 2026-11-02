use crate::commands::codecs::{adler32, inflate_raw_bounded};

#[derive(Clone)]
pub(super) struct Raster {
    pub width: usize,
    pub height: usize,
    pub alpha: bool,
    pub gray: bool,
    pub density: u32,
    pub orientation: Option<u8>,
    pub pixels: Vec<[u8; 4]>,
}

pub(super) fn still_format(bytes: &[u8]) -> Option<&'static str> {
    if super::jpeg_decode::signature(bytes) { Some("jpeg") }
    else if super::bmp::signature(bytes) { Some("bmp") }
    else if super::tiff::signature(bytes) { Some("tiff") }
    else if super::netpbm::signature(bytes) { Some(match bytes[1] {
        b'1'|b'4' => "pbm", b'2'|b'5' => "pgm", _ => "ppm",
    }) }
    else if super::gif::signature(bytes) && !bytes[6..].starts_with(b"\n__IMG__:") { Some("gif") }
    else if super::webp::signature(bytes) && !bytes[12..].starts_with(b"\n__IMG__:") { Some("webp") }
    else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(29..38) != Some(b"\n__IMG__:") { Some("png") }
    else { super::heif::format(bytes) }
}

pub(super) fn destination(spec: &str) -> Option<(&'static str, &str)> {
    named_destination(spec).or_else(|| (spec=="-" || spec.rsplit_once('.').is_some_and(|(_,ext)| ext.eq_ignore_ascii_case("pnm"))).then_some(("png",spec)))
}

pub(super) fn named_destination(spec: &str) -> Option<(&'static str, &str)> {
    let format=|name:&str| match name.to_ascii_lowercase().as_str() {
        "pdf"=>Some("pdf"),"png"=>Some("png"),"webp"=>Some("webp"),"gif"=>Some("gif"),"jpg"|"jpeg"=>Some("jpeg"),"bmp"=>Some("bmp"),"tiff"|"tif"=>Some("tiff"),
        "heic"=>Some("heic"),"heif"=>Some("heif"),"avif"=>Some("avif"),"ppm"=>Some("ppm"),"pgm"=>Some("pgm"),"pbm"=>Some("pbm"),_=>None
    };
    if let Some((prefix,path))=spec.split_once(':') && let Some(fmt)=format(prefix) {return Some((fmt,path));}
    let (_,ext)=spec.rsplit_once('.')?;
    Some((format(ext)?,spec))
}

impl Raster {
    pub(super) fn remap(&mut self, w: usize, h: usize, mut pixel: impl FnMut(&Self, usize, usize) -> [u8; 4]) {
        let mut out = Vec::with_capacity(w * h);
        for y in 0..h {
            for x in 0..w {
                out.push(pixel(self, x, y));
            }
        }
        self.width = w;
        self.height = h;
        self.pixels = out;
    }

    pub(super) fn entropy(&self) -> f64 {
        let mut bins = [0usize; 256];
        for &[r, g, b, _] in &self.pixels {
            let luma = if self.gray { r } else { super::magick_color::gray(r, g, b) };
            bins[usize::from(luma)] += 1;
        }
        bins.into_iter().filter(|&n| n != 0).fold(0., |entropy, n| {
            let p = n as f64 / self.pixels.len() as f64;
            entropy - p * p.log2()
        })
    }

    pub fn input(spec: &str, bytes: &[u8], limit: usize) -> Result<Option<Self>, String> {
        if let Some(canvas) = super::Canvas::parse(spec) {
            return Ok(Some(Self {
                width: 1,
                height: 1,
                alpha: true,
                gray: false,
                density: 72,
                orientation: None,
                pixels: vec![canvas?.pixel(0, 0, 1, 1)],
            }));
        }
        // Other Rust codecs still emit the legacy private header in place of pixel data.
        if still_format(bytes).is_some() {
            return Self::decode(bytes, limit).map(Some).map_err(String::from);
        }
        Ok(None)
    }
    pub fn publish(
        &self,
        (format,path): (&str,&str),
        quality: f64,
        cwd: &str,
        fs: &dyn super::SafeBashFs,
    ) -> super::BuiltinOutcome {
        let bytes=if format=="png"{self.png()}else{
            match super::frame_output::encode(self,format,quality,self.density,fs.max_input_bytes()) {
                Ok(data)=>data,Err(e)=>return super::err_out(&format!("magick: {e}\n"),1),
            }
        };
        Self::publish_bytes(&bytes,path,cwd,fs)
    }

    pub fn publish_bytes(bytes: &[u8], path: &str, cwd: &str, fs: &dyn super::SafeBashFs) -> super::BuiltinOutcome {
        if path == "-" {
            return super::ok_out(&crate::vfs::bytes_to_stream_string(bytes));
        }
        match super::publish_magick_output(fs, &super::resolve_posix_path(cwd, path), bytes) {
            Ok(()) => super::ok_out(""),
            Err(e) => super::err_out(&format!("shell: line 1: {e}\n"), 1),
        }
    }

    pub fn png(&self) -> Vec<u8> {
        let pixel = |x: usize, y: usize| self.pixels[y * self.width + x];
        match (self.gray, self.alpha || self.pixels.iter().any(|p| p[3] < 255)) {
            (true, true) => {
                super::pixel_png(self.width, self.height, super::PngEncoding::SplitDensity(self.density,self.orientation), |x, y| {
                    let [v, _, _, a] = pixel(x, y);
                    [v, a]
                })
            }
            (true, false) => {
                super::pixel_png(self.width, self.height, super::PngEncoding::SplitDensity(self.density,self.orientation), |x, y| {
                    [pixel(x, y)[0]]
                })
            }
            (false, false) => {
                super::pixel_png(self.width, self.height, super::PngEncoding::SplitDensity(self.density,self.orientation), |x, y| {
                    let [r, g, b, _] = pixel(x, y);
                    [r, g, b]
                })
            }
            (false, true) => super::pixel_png(self.width, self.height, super::PngEncoding::SplitDensity(self.density,self.orientation), pixel),
        }
    }
    pub fn decode(bytes: &[u8], limit: usize) -> Result<Self, &'static str> {
        if super::gif::signature(bytes) { return super::gif::decode(bytes,1,limit, |_,_| Ok(())); }
        if super::webp::signature(bytes) { return super::webp::decode(bytes,limit); }
        if super::jpeg_decode::signature(bytes) {return super::jpeg_decode::decode(bytes,limit);}
        if super::netpbm::signature(bytes) {
            return Ok(super::netpbm::Netpbm::parse(bytes, limit)?.decode());
        }
        if super::tiff::signature(bytes) {
            return super::tiff::Tiff::parse(bytes, limit)?.decode();
        }
        if super::bmp::signature(bytes) {
            return Ok(super::bmp::Bmp::parse(bytes, limit)?.decode());
        }
        if super::heif::format(bytes).is_some() {return super::heif::decode(bytes,limit);}
        let mut idat = Vec::new();
        let header = super::image_header::Png::read(bytes, |data| {
            if data.len() > limit - idat.len() { return Err("image exceeds memory budget"); }
            idat.extend_from_slice(data);
            Ok(())
        })?;
        if header.truncated { return Err("Truncated PNG chunk"); }
        let h = header.ihdr.ok_or("Invalid PNG header")?;
        let (density, palette, trns) = (header.density, header.palette, header.transparency.unwrap_or_default());
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
        if idat.is_empty() { return Err("unexpected end of file"); }
        if idat.len() < 6
            || idat[0] & 15 != 8
            || idat[0] >> 4 > 7
            || u16::from_be_bytes([idat[0], idat[1]]) % 31 != 0
            || idat[1] & 32 != 0
        {
            return Err("Invalid zlib header");
        }
        let (mut raw, end) =
            inflate_raw_bounded(&idat[2..], expected).map_err(|_| "Invalid PNG image data")?;
        if raw.len() != expected {
            return Err("Truncated PNG image data");
        }
        if idat.get(2 + end..6 + end) != Some(adler32(&raw).to_be_bytes().as_slice()) {
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
                unfilter_row(&mut current[..bytes], previous, stride, filter)?;
                let row = &raw[pos..pos + bytes];
                for x in 0..cols {
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
        Ok(Self {
            width,
            height,
            gray: color == 4 || (color == 0 && trns.is_empty()),
            density,
            orientation:header.orientation,
            alpha: matches!(color, 4 | 6) || !trns.is_empty(),
            pixels,
        })
    }
}

pub(super) fn unfilter_row(
    row: &mut [u8],
    previous: &[u8],
    stride: usize,
    filter: u8,
) -> Result<(), &'static str> {
    for i in 0..row.len() {
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adam7_packed_palette_with_filters_and_transparency_is_bounded() {
        let bytes = super::super::hex_dec(
            "89504e470d0a1a0a0000000d494844520000000b000000090203000001ee0d0e280000000c504c5445050c131a21282f363d444b52a0086cc50000000474524e5300010203196e3f950000003749444154789c1dc6c10dc0200c04c1b5cfdda49e5024500fa5f04990413c461a61e88ac3893af57ecec930507d00cffca390962c8dd637e9c90ded1d9867660000000049454e44ae426082",
        );
        assert!(Raster::decode(&bytes, 395).is_err());
        let image = Raster::decode(&bytes, 396).unwrap();
        assert_eq!((image.width, image.height, image.alpha), (11, 9, true));
        for (i, p) in image.pixels.iter().enumerate() {
            let n = ((i / 11) * 7 + (i % 11) * 12) % 4;
            assert_eq!(
                *p,
                [
                    (n * 21 + 5) as u8,
                    (n * 21 + 12) as u8,
                    (n * 21 + 19) as u8,
                    n as u8
                ]
            );
        }
    }
}
