// Sampled PDF images in XObjects and inline content.
use super::super::uint;
use super::{Matrix, ObjectId, Objects, PageSource, Value, pdf_text_layout::Draw};

#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands::archive) enum ImageRead {
    List,
    Pixels,
    Raster,
    Extract {
        fax: bool,
        jpeg: bool,
        png: bool,
        tiff: bool,
    },
}

impl ImageRead {
    pub(in crate::commands::archive) fn format(self, components: usize) -> Option<&'static str> {
        let Self::Extract { png, tiff, .. } = self else {
            return None;
        };
        Some(if png && !(tiff && components == 4) {
            "PNG"
        } else if tiff {
            "TIFF"
        } else {
            "PNM"
        })
    }
}

pub(in crate::commands::archive) enum NativeImage {
    Fax(Vec<u8>, String),
    Pbm(Vec<u8>),
    Jpeg(Vec<u8>),
}

pub(super) enum ImageStream<'a> {
    Object(ObjectId),
    Inline(Value<'static>, &'a [u8]),
}

pub(in crate::commands::archive) struct Image {
    jpeg: bool,
    pub(super) stencil: bool,
    pub(super) mask: Option<ObjectId>,
    pub(super) has_alpha: bool,
    fax: bool,
    bits: usize,
    rgb48: Option<[(f64, f64); 3]>,
    pub native: Option<NativeImage>,
    pub width: usize,
    pub height: usize,
    pub components: usize,
    length: usize,
    pub id: Option<ObjectId>,
    pub(super) interpolate: bool,
    pub matrix: Matrix,
    pub pixels: Vec<[u8; 4]>,
}

impl Image {
    pub(super) fn read(
        objects: &mut Objects<'_>,
        stream: ImageStream<'_>,
        matrix: Matrix,
        limit: usize,
        mode: ImageRead,
    ) -> Option<Option<Self>> {
        let (id, dict, length, encoded) = match stream {
            ImageStream::Object(id) => {
                let (mut dict, cursor) = objects.object(id)?;
                if dict.get(b"Subtype").and_then(Value::word) != Some(b"/Image") {
                    return Some(None);
                }
                let length = objects.stream(&dict, cursor)?.len();
                let bytes = if mode == ImageRead::List {
                    std::borrow::Cow::Borrowed(&[][..])
                } else {
                    objects.raw_stream(id, &mut dict, cursor)?
                };
                (Some(id), dict, length, bytes)
            }
            ImageStream::Inline(dict, bytes) => (None, dict, 0, bytes.into()),
        };
        let filters = match dict.get(b"Filter") {
            None => vec![],
            Some(v) => match objects.filter_value(v.clone())? {
                Value::Array(a) => a,
                v => vec![v],
            },
        };
        let last = match filters.last() {
            Some(v) => Some(objects.filter_value(v.clone())?),
            None => None,
        };
        let fax = matches!(
            last.as_ref().and_then(Value::word),
            Some(b"/CCITTFaxDecode" | b"/CCF")
        );
        let jpeg = matches!(
            last.as_ref().and_then(Value::word),
            Some(b"/DCTDecode" | b"/DCT")
        );
        if !fax && !jpeg {
            for filter in &filters {
                if !matches!(
                    objects.filter_value(filter.clone())?.word(),
                    Some(
                        b"/FlateDecode"
                            | b"/Fl"
                            | b"/LZWDecode"
                            | b"/LZW"
                            | b"/ASCIIHexDecode"
                            | b"/AHx"
                            | b"/ASCII85Decode"
                            | b"/A85"
                            | b"/RunLengthDecode"
                            | b"/RL"
                    )
                ) {
                    return Some(None);
                }
            }
        }
        let number = |k: &[u8]| uint(dict.get(k)?.word()?);
        let (width, height) = (number(b"Width")?, number(b"Height")?);
        let stencil = dict.get(b"ImageMask").and_then(Value::word) == Some(b"true");
        let components = match dict.get(b"ColorSpace").and_then(Value::word) {
            _ if stencil => 1,
            Some(b"/DeviceRGB") => 3,
            Some(b"/DeviceGray") => 1,
            Some(b"/DeviceCMYK") => 4,
            _ => return Some(None),
        };
        let format = mode.format(components);
        if width == 0 || height == 0 {
            return None;
        }
        let bits = if stencil { 1 } else { number(b"BitsPerComponent")? };
        if !matches!(bits, 1 | 2 | 4 | 8 | 16)
            || fax && (bits != 1 || components != 1)
            || jpeg && bits != 8
        {
            return Some(None);
        }
        let mono_extract =
            bits == 1 && components == 1 && matches!(mode, ImageRead::Extract { .. });
        let count = width.checked_mul(height)?;
        let soft_mask = dict.get(b"SMask").and_then(Value::reference);
        let mut mask = soft_mask;
        let mut key = None;
        if mask.is_none() && let Some(entry) = dict.get(b"Mask") {
            match objects.filter_value(entry.clone())? {
                Value::Dict(_) => mask = entry.reference(),
                Value::Array(entries) if matches!(mode, ImageRead::Pixels | ImageRead::Raster) => {
                    let mut ranges = [0i32; 8];
                    for (slot, n) in ranges[..2 * components].iter_mut().zip(entries) {
                        *slot = objects.filter_value(n)?.number()? as i32;
                    }
                    key = Some(ranges);
                }
                _ => {}
            }
        }
        let mut pixels = Vec::new();
        let mut native = None;
        if fax && mode != ImageRead::List {
            let outer = match objects.filter_value(dict.get(b"Filter")?.clone())? {
                Value::Array(mut a) => {
                    a.pop()?;
                    a
                }
                _ => vec![],
            };
            let parms = match dict.get(b"DecodeParms") {
                Some(v) => match objects.filter_value(v.clone())? {
                    Value::Array(a) => a
                        .get(outer.len())
                        .and_then(|v| objects.filter_value(v.clone())),
                    v => Some(v),
                },
                None => None,
            };
            let param = |key: &[u8]| parms.as_ref()?.get(key)?.word();
            let k = match param(b"K") {
                Some(n) => std::str::from_utf8(n).ok()?.parse::<i32>().ok()?,
                None => 0,
            };
            let columns = param(b"Columns").map_or(Some(1728), uint)?;
            let black = param(b"BlackIs1") == Some(b"true");
            let eol = param(b"EndOfLine") == Some(b"true");
            let align = param(b"EncodedByteAlign") == Some(b"true");
            let encoded = if outer.is_empty() {
                encoded
            } else {
                let mut fields = vec![(b"Filter".as_slice().into(), Value::Array(outer))];
                if let Some(v) = dict.get(b"DecodeParms") {
                    fields.push((b"DecodeParms".as_slice().into(), v.clone()));
                }
                objects.decode(&Value::Dict(fields), encoded)?
            };
            if encoded.len() > limit {
                return None;
            }
            if matches!(mode, ImageRead::Extract { fax: true, .. }) {
                let coding = if k < 0 {
                    "-4"
                } else if k > 0 {
                    "-2"
                } else {
                    "-1"
                };
                let line = if eol { "-A" } else { "-P" };
                let polarity = if black { "-W" } else { "-B" };
                native = Some(NativeImage::Fax(
                    encoded.into_owned(),
                    format!("{coding} {line} -X {columns} {polarity} -M\n"),
                ));
            } else {
                if count > limit / 4 || width > columns {
                    return None;
                }
                let inverted = match dict.get(b"Decode") {
                    _ if !mono_extract => false, // Apply Decode after testing the original fax samples.
                    _ if stencil && mono_extract => true,
                    None => false,
                    Some(Value::Array(a)) if a.len() == 2 => match (a[0].number()?, a[1].number()?)
                    {
                        (0., 1.) => false,
                        (1., 0.) => true,
                        _ => return None,
                    },
                    _ => return None,
                };
                let stride = columns.div_ceil(8);
                use crate::commands::archive::fax;
                let rows = fax::decode(
                    &encoded,
                    fax::Coding::Pdf { k, eol, align },
                    columns,
                    stride.checked_mul(height)?,
                    false,
                    limit,
                )?;
                let mut pbm = (stencil && format == Some("PNM")).then(|| format!("P4\n{width} {height}\n").into_bytes());
                for row in rows.chunks_exact(stride) {
                    if let Some(out) = &mut pbm {
                        let used = width.div_ceil(8);
                        out.extend_from_slice(&row[..used]);
                        let start = out.len() - used;
                        let samples = &mut out[start..];
                        // CCITT fills unused bits as white before applying BlackIs1.
                        if width % 8 != 0 { samples[used-1] |= 255 >> (width % 8); }
                        if !black { for b in samples { *b = !*b; } }
                        continue;
                    }
                    pixels.extend((0..width).map(|x| {
                        let bit = row[x / 8] & (128 >> (x % 8)) != 0;
                        let v = if bit ^ !black ^ inverted { 255 } else { 0 };
                        [v, v, v, 255]
                    }));
                }
                native = pbm.map(NativeImage::Pbm);
            }
        } else if jpeg && mode != ImageRead::List {
            let data = objects.decode(&dict, encoded)?;
            if data.len() > limit {
                return None;
            }
            if matches!(mode, ImageRead::Extract { jpeg: true, .. }) {
                native = Some(NativeImage::Jpeg(data.into_owned()));
            } else {
                let parms = match dict.get(b"DecodeParms") {
                    Some(v) => match objects.filter_value(v.clone())? {
                        Value::Array(a) => a
                            .get(filters.len() - 1)
                            .and_then(|p| objects.filter_value(p.clone())),
                        v => Some(v),
                    },
                    None => None,
                };
                let transform = parms
                    .as_ref()
                    .and_then(|v| v.get(b"ColorTransform"))
                    .and_then(Value::number)
                    .map(|n| n != 0.);
                let (header, samples) = crate::commands::archive::jpeg_decode::samples(
                    &data,
                    limit,
                    crate::commands::archive::jpeg_decode::Output::Pdf(transform),
                )
                .ok()?;
                if (
                    header.width as usize,
                    header.height as usize,
                    usize::from(header.channels),
                ) != (width, height, components)
                {
                    return None;
                }
                pixels = samples;
            }
        } else if !fax && mode != ImageRead::List {
            if count > limit / 4 {
                return None;
            }
            let bytes = objects.decode(&dict, encoded)?;
            let stride = width
                .checked_mul(components)?
                .checked_mul(bits)?
                .div_ceil(8);
            if bytes.len() != stride.checked_mul(height)? {
                return None;
            }
            // Monochrome extraction preserves whole scanlines, including the unused bits at the right edge.
            let invert = if stencil && mono_extract {
                true // pdfimages writes the mask samples independently of paint polarity.
            } else if mono_extract && let Some(v) = dict.get(b"Decode") {
                let Value::Array(ranges) = objects.filter_value(v.clone())? else {
                    return None;
                };
                if ranges.len() != 2 {
                    return None;
                }
                (ranges[0].number()? * 255.).round() as u8 != 0
            } else {
                false
            };
            if mono_extract && format == Some("PNM") {
                let mut out = format!("P4\n{width} {height}\n").into_bytes();
                out.extend(bytes.iter().map(|b| if invert { *b } else { !b }));
                native = Some(NativeImage::Pbm(out));
            } else {
                pixels.reserve_exact(count);
                for row in bytes.chunks_exact(stride) {
                    let sample = |i: usize| match bits {
                        16 => row[i * 2], // Poppler uses the high byte of a 16-bit sample.
                        8 => row[i],
                        _ => {
                            let mask = (1u8 << bits) - 1;
                            let bit = i * bits;
                            ((row[bit / 8] >> (8 - bits - bit % 8)) & mask) * (255 / mask)
                        }
                    };
                    for x in 0..width {
                        pixels.push(if components == 1 {
                            let v = sample(x);
                            let v = if invert { !v } else { v };
                            [v, v, v, 255]
                        } else if components == 4 {
                            std::array::from_fn(|k| sample(x * 4 + k))
                        } else {
                            [sample(x * 3), sample(x * 3 + 1), sample(x * 3 + 2), 255]
                        });
                    }
                }
            }
        }
        let mut rgb48 = (bits == 16 && components == 3 && matches!(format, Some("PNG" | "TIFF")))
            .then_some([(0., 1.); 3]);
        // Preserve the key result across color conversion (CMYK uses all four channels).
        let opacity = if let Some(ranges) = key {
            if pixels.len() > limit / 5 { return None; }
            let shift = 8usize.saturating_sub(bits);
            Some(pixels.iter().map(|p| {
                let matched = (0..components).all(|i| {
                    let sample = i32::from(p[i] >> shift);
                    (ranges[2*i]..=ranges[2*i+1]).contains(&sample)
                });
                if matched { 0 } else { 255 }
            }).collect::<Vec<u8>>())
        } else { None };
        let mut ink_ranges = [(0., 1.); 4];
        if !mono_extract && !pixels.is_empty() {
            if let Some(v) = dict.get(b"Decode") {
                let Value::Array(ranges) = objects.filter_value(v.clone())? else {
                    return None;
                };
                if ranges.len() != 2 * components {
                    return None;
                }
                for (i, pair) in ranges.chunks_exact(2).enumerate() {
                    let (lo, hi) = (pair[0].number()?, pair[1].number()?);
                    if let Some(wide) = &mut rgb48 {
                        wide[i] = (lo, hi);
                        continue;
                    }
                    if components == 4 && (key.is_some() || matches!(format, Some("PNG" | "PNM"))) {
                        ink_ranges[i] = (lo, hi);
                        continue;
                    }
                    if (lo, hi) == (0., 1.) {
                        continue;
                    }
                    let map: [u8; 256] =
                        std::array::from_fn(|n| (lo * 255. + (hi - lo) * n as f64).round() as u8);
                    for p in &mut pixels {
                        p[i] = map[usize::from(p[i])];
                    }
                }
                if components == 1 {
                    for p in &mut pixels {
                        *p = [p[0], p[0], p[0], 255];
                    }
                }
            }
            if components == 4 && format != Some("TIFF") {
                // With a color key Poppler uses per-pixel fixed point conversion, as in extraction.
                let render = format.is_none() && key.is_none();
                for p in &mut pixels {
                    let ink = std::array::from_fn(|i| {
                        let (lo, hi) = ink_ranges[i];
                        let v = (lo + (hi - lo) * f64::from(p[i]) / 255.).clamp(0., 1.);
                        if render {
                            v
                        } else {
                            (v * 65536.).floor() / 65536.
                        }
                    });
                    *p = device_cmyk(ink, render);
                }
            }
        }
        if let Some(opacity) = opacity {
            for (p, a) in pixels.iter_mut().zip(opacity) { p[3] = a; }
        }
        if mode == ImageRead::Pixels
            && let Some(mask) = soft_mask
        {
            let (m, _) = objects.object(mask)?;
            if m.get(b"Width")?.number()? != width as f64
                || m.get(b"Height")?.number()? != height as f64
                || m.get(b"BitsPerComponent")?.number()? != 8.
                || m.get(b"ColorSpace")?.word()? != b"/DeviceGray"
            {
                return None;
            }
            let alpha = objects.decoded_stream(mask)?;
            if alpha.len() != count {
                return None;
            }
            for (p, &a) in pixels.iter_mut().zip(alpha.iter()) {
                p[3] = a;
            }
        }
        let interpolate = dict.get(b"Interpolate").and_then(Value::word) == Some(b"true");
        Some(Some(Self {
            stencil,
            mask,
            has_alpha: key.is_some(),
            fax,
            bits,
            rgb48,
            jpeg,
            native,
            width,
            height,
            components,
            length,
            id,
            interpolate,
            matrix,
            pixels,
        }))
    }

    pub(in crate::commands::archive) fn listing(
        &self,
        page: usize,
        idx: usize,
        parent: Option<ObjectId>,
    ) -> String {
        let [a, b, c, d, _, _] = self.matrix;
        let ppi = |pixels: usize, u: f64, v: f64| {
            let value = pixels as f64 * 72. / (u * u + v * v).sqrt();
            if value < 1. {
                format!("{value:5.3}")
            } else {
                format!("{value:5.0}")
            }
        };
        let (x, y) = (ppi(self.width, a, b), ppi(self.height, c, d));
        let object = parent.or(self.id).map_or_else(|| "[inline]  ".to_owned(), |(id, gen_num)| format!(" {id:6} {gen_num:2}"));
        let kind = if parent.is_some() && self.stencil { "mask" } else if parent.is_some() { "smask" } else if self.stencil { "stencil" } else { "image" };
        let (w, h, components) = (self.width, self.height, self.components);
        let color = match components {
            _ if self.stencil => "-",
            1 => "gray",
            4 => "cmyk",
            _ => "rgb",
        };
        let interp = if self.interpolate { "yes" } else { "no" };
        let mut size = self.length as f64;
        let mut unit = "B";
        for suffix in ["K", "M", "G"] {
            if size < 10000. {
                break;
            }
            size /= 1024.;
            unit = suffix;
        }
        let precision = if unit == "B" || size >= 100. {
            0
        } else if size >= 10. {
            1
        } else {
            2
        };
        let size = format!("{size:.precision$}{unit}");
        let enc = if self.fax {
            "ccitt"
        } else if self.jpeg {
            "jpeg"
        } else {
            "image"
        };
        let bpc = self.bits;
        let bytes = (w as u128 * h as u128 * components as u128 * bpc as u128) / 8;
        let pct = self.length as f64 * 100. / bytes as f64;
        let ratio = if bytes == 0 {
            "  - ".to_owned()
        } else if pct < 10. {
            format!("{pct:.1}%")
        } else {
            format!("{pct:.0}%")
        };
        format!(
            "{page:4} {idx:5} {kind:<7}{w:6} {h:5}  {color:<5} {components:3} {bpc:3}  {enc:<5}  {interp:<3}  {object} {x} {y} {size:>5} {ratio:>4}\n"
        )
    }
    pub(in crate::commands::archive) fn bilevel(&self) -> bool {
        self.bits == 1 && self.components == 1
    }
    fn ppi(&self) -> [usize; 2] {
        let [a, b, c, d, _, _] = self.matrix;
        let dpi = |n: usize, extent: f64| {
            if extent > 1e-6 {
                (n as f64 * 72. / extent).round().max(1.) as usize
            } else {
                72
            }
        };
        [dpi(self.width, a.hypot(b)), dpi(self.height, c.hypot(d))]
    }

    pub(in crate::commands::archive) fn encode(
        &self,
        format: &str,
        limit: usize,
        extracting: bool,
    ) -> Option<Vec<u8>> {
        let dpi = if extracting {
            [72.; 2]
        } else {
            self.ppi().map(|n| n as f64)
        };
        if let Some(ranges) = self.rgb48 {
            let png = format == "PNG";
            let size = self
                .width
                .checked_mul(6)?
                .checked_add(usize::from(png))?
                .checked_mul(self.height)?;
            if size > limit {
                return None;
            }
            let mut raw = Vec::with_capacity(size);
            for row in self.pixels.chunks_exact(self.width) {
                if png {
                    raw.push(0);
                }
                for p in row {
                    for (sample, (lo, hi)) in p.iter().zip(ranges) {
                        let v = (lo + f64::from(*sample) * (hi - lo) / 255.).clamp(0., 1.);
                        // Poppler casts its 16.16 color to unsigned short and passes host-order bytes to both writers.
                        raw.extend_from_slice(&((v * 65536.) as u32 as u16).to_le_bytes());
                    }
                }
            }
            return if png {
                Some(super::pdf_raster::encode_png(
                    self.width,
                    self.height,
                    16,
                    2,
                    Some(dpi),
                    &raw,
                ))
            } else {
                crate::commands::archive::tiff::encode_strip(
                    &raw,
                    [self.width, self.height],
                    dpi,
                    "rgb",
                    3,
                    16,
                    1,
                    limit,
                )
            };
        }
        let color = match (self.bits, self.components) {
            (1, 1) => "mono",
            (_, 1) => "gray",
            (_, 4) => "cmyk",
            _ => "rgb",
        };
        if format == "TIFF" {
            return crate::commands::archive::tiff::encode(
                &self.pixels,
                self.width,
                dpi,
                color,
                "none",
                false,
                limit,
            );
        }
        let format = match (format, color) {
            ("PNG", "mono") => "PNG1",
            ("PNG", "gray")
                if (extracting || self.jpeg) && self.pixels.iter().all(|p| p[3] == 255) =>
            {
                "PNG8"
            }
            _ => format,
        };
        super::pdf_raster::encode(
            self.width,
            self.height,
            &self.pixels,
            format,
            "rgb",
            (extracting || self.fax || self.jpeg).then_some(dpi),
        )
    }
}

// Interpolate the RGB values of the sixteen DeviceCMYK ink combinations.
fn device_cmyk([c, m, y, k]: [f64; 4], render: bool) -> [u8; 4] {
    const RGB: [[f64; 3]; 16] = [
        [1., 1., 1.],
        [0.1373, 0.1216, 0.1255],
        [1., 0.9490, 0.],
        [0.1098, 0.1020, 0.],
        [0.9255, 0., 0.5490],
        [0.1412, 0., 0.],
        [0.9294, 0.1098, 0.1412],
        [0.1333, 0., 0.],
        [0., 0.6784, 0.9373],
        [0., 0.0588, 0.1412],
        [0., 0.6510, 0.3137],
        [0., 0.0745, 0.],
        [0.1804, 0.1922, 0.5725],
        [0., 0., 0.0078],
        [0.2118, 0.2119, 0.2235],
        [0., 0., 0.],
    ];
    // pdfimages uses 16-bit fixed point color values. Splash converts a row directly to bytes.
    let mut rgb = [0.; 3];
    for (i, corner) in RGB.iter().enumerate() {
        let w = (if i & 8 == 0 { 1. - c } else { c })
            * (if i & 4 == 0 { 1. - m } else { m })
            * (if i & 2 == 0 { 1. - y } else { y })
            * (if i & 1 == 0 { 1. - k } else { k });
        for j in 0..3 {
            rgb[j] += corner[j] * w;
        }
    }
    let [r, g, b] = rgb.map(|n| {
        if render {
            (n * 255.) as u8
        } else {
            ((((n * 65536.) as u32) * 255 + 32768) >> 16) as u8
        }
    });
    [r, g, b, 255]
}

impl PageSource<'_> {
    pub(in crate::commands::archive) fn images(
        &mut self,
        page: usize,
        limit: usize,
        mode: ImageRead,
        mut handle: impl FnMut(Image, Option<ObjectId>) -> Option<()>,
    ) -> Option<()> {
        let node = self
            .objects
            .page_dict(*self.pages.get(page.checked_sub(1)?)?, &self.tree)?;
        self.draw_page(&node, |event, objects| {
            if let Draw::Image(stream, matrix) = event
                && let Some(image) = Image::read(objects, stream, matrix, limit, mode)?
            {
                let id = image.id;
                let mask = image.mask;
                handle(image, None)?;
                if mode != ImageRead::Pixels
                    && let Some(mask) = mask
                    && let Some(mask_image) = Image::read(objects, ImageStream::Object(mask), matrix, limit, mode)?
                {
                    handle(mask_image, id)?;
                }
            }
            Some(())
        })
    }
}
