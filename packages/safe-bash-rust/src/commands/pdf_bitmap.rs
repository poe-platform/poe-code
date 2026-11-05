// Sampled PDF image XObjects.
use super::super::uint;
use super::{Matrix, ObjectId, Objects, PageSource, Value, pdf_text_layout::Draw};

#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands::archive) enum ImageRead {
    List,
    Pixels,
    NativeFax,
}

pub(in crate::commands::archive) struct Image {
    pub bilevel: bool,
    pub native: Option<(Vec<u8>, String)>,
    pub width: usize,
    pub height: usize,
    components: usize,
    length: usize,
    pub id: ObjectId,
    interpolate: bool,
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
        if !bilevel
            && (filters.len() > 1 || last.is_some_and(|v| v.word() != Some(b"/FlateDecode")))
        {
            return Some(None);
        }
        let number = |k: &[u8]| uint(dict.get(k)?.word()?);
        let (width, height) = (number(b"Width")?, number(b"Height")?);
        let components = match dict.get(b"ColorSpace").and_then(Value::word) {
            Some(b"/DeviceRGB") => 3,
            Some(b"/DeviceGray") => 1,
            _ => return Some(None),
        };
        if width == 0 || height == 0 {
            return None;
        }
        if bilevel && (number(b"BitsPerComponent")? != 1 || components != 1)
            || !bilevel
                && (number(b"BitsPerComponent")? != 8
                    || dict.get(b"DecodeParms").is_some()
                    || dict.get(b"Decode").is_some())
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
            if mode == ImageRead::NativeFax {
                let coding = if k < 0 {
                    "-4"
                } else if k > 0 {
                    "-2"
                } else {
                    "-1"
                };
                let line = if eol { "-A" } else { "-P" };
                let polarity = if black { "-W" } else { "-B" };
                native = Some((
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
        } else if !bilevel && mode != ImageRead::List {
            if count > limit / 4 {
                return None;
            }
            let bytes = objects.decoded_stream(id)?;
            if bytes.len() != count.checked_mul(components)? {
                return None;
            }
            let mask = if let Some(mask) = dict.get(b"SMask").and_then(Value::reference) {
                let (dict, _) = objects.object(mask)?;
                if dict.get(b"Width").and_then(Value::word).and_then(uint) != Some(width)
                    || dict.get(b"Height").and_then(Value::word).and_then(uint) != Some(height)
                    || dict.get(b"ColorSpace")?.word()? != b"/DeviceGray"
                    || dict.get(b"BitsPerComponent")?.word()? != b"8"
                {
                    return None;
                }
                let bits = objects.decoded_stream(mask)?;
                if bits.len() != count {
                    return None;
                }
                Some(bits)
            } else {
                None
            };
            pixels = bytes
                .chunks_exact(components)
                .enumerate()
                .map(|(i, v)| {
                    let [r, g, b] = if let [r, g, b] = *v {
                        [r, g, b]
                    } else {
                        [v[0]; 3]
                    };
                    [r, g, b, mask.as_ref().map_or(255, |a| a[i])]
                })
                .collect();
        }
        let interpolate = dict.get(b"Interpolate").and_then(Value::word) == Some(b"true");
        Some(Some(Self {
            bilevel,
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

    pub(in crate::commands::archive) fn listing(&self, page: usize, idx: usize) -> String {
        let [x, y] = self.ppi();
        let (id, generation) = self.id;
        let (w, h, components) = (self.width, self.height, self.components);
        let color = if components == 1 { "gray" } else { "rgb" };
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
            "{page:4} {idx:5} image  {w:6} {h:5}  {color:<5} {components:3} {bpc:3}  {enc:<5}  {interp:<3}   {id:6} {generation:2} {x:5} {y:5} {size:>5} {ratio:>4}\n"
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
    ) -> Option<Vec<u8>> {
        if self.bilevel {
            let dpi = self.ppi().map(|v| v as f64);
            if format == "TIFF" {
                return crate::commands::archive::tiff::encode(
                    &self.pixels,
                    self.width,
                    dpi,
                    "mono",
                    "none",
                    false,
                    limit,
                );
            }
            return super::pdf_raster::encode(
                self.width,
                self.height,
                &self.pixels,
                if format == "PNG" { "PNG1" } else { format },
                "mono",
                Some(dpi),
            );
        }
        if format == "TIFF" {
            let w = self.width as u32;
            let h = self.height as u32;
            let size = w.checked_mul(h)?.checked_mul(3)?;
            let mut out = b"II\x2a\0\x08\0\0\0\x0c\0".to_vec();
            for (tag, ty, count, val) in [
                (256u16, 4u16, 1u32, w),
                (257, 4, 1, h),
                (258, 3, 3, 158),
                (259, 3, 1, 1),
                (262, 3, 1, 2),
                (273, 4, 1, 180),
                (277, 3, 1, 3),
                (278, 4, 1, h),
                (279, 4, 1, size),
                (282, 5, 1, 164),
                (283, 5, 1, 172),
                (296, 3, 1, 2),
            ] {
                out.extend_from_slice(&tag.to_le_bytes());
                out.extend_from_slice(&ty.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
                out.extend_from_slice(&val.to_le_bytes());
            }
            out.extend_from_slice(&[0, 0, 0, 0, 8, 0, 8, 0, 8, 0]);
            for n in [self.ppi()[0] as u32, 1, self.ppi()[0] as u32, 1] {
                out.extend_from_slice(&n.to_le_bytes());
            }
            for px in &self.pixels {
                out.extend_from_slice(&px[..3]);
            }
            return Some(out);
        }
        super::pdf_raster::encode(self.width, self.height, &self.pixels, format, "rgb", None)
    }
}

impl PageSource<'_> {
    pub(in crate::commands::archive) fn images(
        &mut self,
        page: usize,
        limit: usize,
        mode: ImageRead,
        mut handle: impl FnMut(Image) -> Option<()>,
    ) -> Option<()> {
        let node = self
            .objects
            .page_dict(*self.pages.get(page.checked_sub(1)?)?, &self.tree)?;
        self.draw_page(&node, |event, objects| {
            if let Draw::Image(id, matrix) = event
                && let Some(image) = Image::read(objects, id, matrix, limit, mode)?
            {
                handle(image)?;
            }
            Some(())
        })
    }
}
