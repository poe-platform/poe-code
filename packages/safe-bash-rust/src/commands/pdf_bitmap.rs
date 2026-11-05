// Sampled PDF image XObjects.
use super::super::uint;
use super::{Matrix, ObjectId, Objects, PageSource, Value, pdf_text_layout::Draw};

#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands::archive) enum ImageRead {
    List,
    Pixels,
    Extract { fax: bool, jpeg: bool, tiff: bool },
}

pub(in crate::commands::archive) enum NativeImage {
    Fax(Vec<u8>, String),
    Jpeg(Vec<u8>),
}

pub(in crate::commands::archive) struct Image {
    jpeg: bool,
    pub(super) soft_mask: Option<ObjectId>,
    pub bilevel: bool,
    pub native: Option<NativeImage>,
    pub width: usize,
    pub height: usize,
    components: usize,
    length: usize,
    pub id: ObjectId,
    pub(super) interpolate: bool,
    pub matrix: Matrix,
    pub pixels: Vec<[u8; 4]>,
}

impl Image {
    pub(super) fn read(
        objects: &mut Objects<'_>,
        id: ObjectId,
        matrix: Matrix,
        limit: usize,
        mode: ImageRead,
    ) -> Option<Option<Self>> {
        let (mut dict, cursor) = objects.object(id)?;
        if dict.get(b"Subtype").and_then(Value::word) != Some(b"/Image") {
            return Some(None);
        }
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
        let bilevel = matches!(
            last.as_ref().and_then(Value::word),
            Some(b"/CCITTFaxDecode" | b"/CCF")
        );
        let jpeg = matches!(
            last.as_ref().and_then(Value::word),
            Some(b"/DCTDecode" | b"/DCT")
        );
        if !bilevel
            && !jpeg
            && (filters.len() > 1 || last.is_some_and(|v| v.word() != Some(b"/FlateDecode")))
        {
            return Some(None);
        }
        let number = |k: &[u8]| uint(dict.get(k)?.word()?);
        let (width, height) = (number(b"Width")?, number(b"Height")?);
        let components = match dict.get(b"ColorSpace").and_then(Value::word) {
            Some(b"/DeviceRGB") => 3,
            Some(b"/DeviceGray") => 1,
            Some(b"/DeviceCMYK") if jpeg => 4,
            _ => return Some(None),
        };
        if width == 0 || height == 0 {
            return None;
        }
        if bilevel && (number(b"BitsPerComponent")? != 1 || components != 1)
            || !bilevel
                && (number(b"BitsPerComponent")? != 8
                    || !jpeg
                        && (dict.get(b"DecodeParms").is_some() || dict.get(b"Decode").is_some()))
        {
            return Some(None);
        }
        let count = width.checked_mul(height)?;
        let length = objects.stream(&dict, cursor)?.len();
        let mut pixels = Vec::new();
        let mut native = None;
        if bilevel && mode != ImageRead::List {
            let encoded = objects.raw_stream(id, &mut dict, cursor)?;
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
                for row in rows.chunks_exact(stride) {
                    pixels.extend((0..width).map(|x| {
                        let bit = row[x / 8] & (128 >> (x % 8)) != 0;
                        let v = if bit ^ !black ^ inverted { 255 } else { 0 };
                        [v, v, v, 255]
                    }));
                }
            }
        } else if jpeg && mode != ImageRead::List {
            let data = objects.decoded_stream(id)?;
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
                if let Some(v) = dict.get(b"Decode") {
                    let Value::Array(ranges) = objects.filter_value(v.clone())? else {
                        return None;
                    };
                    if ranges.len() != 2 * components {
                        return None;
                    }
                    for (i, pair) in ranges.chunks_exact(2).enumerate() {
                        let (lo, hi) = (pair[0].number()?, pair[1].number()?);
                        if (lo, hi) == (0., 1.) {
                            continue;
                        }
                        let map: [u8; 256] = std::array::from_fn(|n| {
                            (lo * 255. + (hi - lo) * n as f64).round() as u8
                        });
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
                if components == 4 && !matches!(mode, ImageRead::Extract { tiff: true, .. }) {
                    for p in &mut pixels {
                        *p = device_cmyk(*p, mode == ImageRead::Pixels);
                    }
                }
            }
        } else if !bilevel && mode != ImageRead::List {
            if count > limit / 4 {
                return None;
            }
            let bytes = objects.decoded_stream(id)?;
            if bytes.len() != count.checked_mul(components)? {
                return None;
            }
            pixels = bytes
                .chunks_exact(components)
                .map(|v| {
                    let [r, g, b] = if let [r, g, b] = *v {
                        [r, g, b]
                    } else {
                        [v[0]; 3]
                    };
                    [r, g, b, 255]
                })
                .collect();
        }
        let soft_mask = dict.get(b"SMask").and_then(Value::reference);
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
            soft_mask,
            bilevel,
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
        let [x, y] = self.ppi();
        let (id, generation) = parent.unwrap_or(self.id);
        let kind = if parent.is_some() { "smask" } else { "image" };
        let (w, h, components) = (self.width, self.height, self.components);
        let color = match components {
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
        let (bpc, enc) = if self.bilevel {
            (1, "ccitt")
        } else if self.jpeg {
            (8, "jpeg")
        } else {
            (8, "image")
        };
        let bytes = (w as u128 * h as u128 * components as u128 * bpc) / 8;
        let pct = self.length as f64 * 100. / bytes as f64;
        let ratio = if bytes == 0 {
            "  - ".to_owned()
        } else if pct < 10. {
            format!("{pct:.1}%")
        } else {
            format!("{pct:.0}%")
        };
        format!(
            "{page:4} {idx:5} {kind:<6} {w:6} {h:5}  {color:<5} {components:3} {bpc:3}  {enc:<5}  {interp:<3}   {id:6} {generation:2} {x:5} {y:5} {size:>5} {ratio:>4}\n"
        )
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
        let dpi = self.ppi().map(|n| n as f64);
        let color = match (self.bilevel, self.components) {
            (true, _) => "mono",
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
            (extracting || self.bilevel || self.jpeg).then_some(dpi),
        )
    }
}

// Interpolate the RGB values of the sixteen DeviceCMYK ink combinations.
fn device_cmyk(ink: [u8; 4], render: bool) -> [u8; 4] {
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
    let [c, m, y, k] = ink.map(|v| {
        if render {
            f64::from(v) / 255.
        } else {
            f64::from((u32::from(v) << 16) / 255) / 65536.
        }
    });
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
            if let Draw::Image(id, matrix) = event
                && let Some(image) = Image::read(objects, id, matrix, limit, mode)?
            {
                let soft_mask = image.soft_mask;
                handle(image, None)?;
                if mode != ImageRead::Pixels
                    && let Some(mask) = soft_mask
                    && let Some(mask_image) = Image::read(objects, mask, matrix, limit, mode)?
                {
                    handle(mask_image, Some(id))?;
                }
            }
            Some(())
        })
    }
}
