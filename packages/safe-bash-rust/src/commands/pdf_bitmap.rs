// Sampled PDF image XObjects with byte-aligned DeviceRGB or DeviceGray samples.
use super::super::uint;
use super::{Matrix, ObjectId, Objects, PageSource, Value, pdf_text_layout::Draw};

pub(in crate::commands::archive) struct Image {
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
        decode: bool,
    ) -> Option<Option<Self>> {
        let (dict, cursor) = objects.object(id)?;
        if dict.get(b"Subtype").and_then(Value::word) != Some(b"/Image")
            || dict
                .get(b"Filter")
                .is_some_and(|v| v.word() != Some(b"/FlateDecode"))
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
        if number(b"BitsPerComponent")? != 8
            || dict.get(b"DecodeParms").is_some()
            || dict.get(b"Decode").is_some()
        {
            return Some(None);
        }
        let count = width.checked_mul(height)?;
        let length = objects.stream(&dict, cursor)?.len();
        let mut pixels = Vec::new();
        if decode {
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
        let size = match self.length {
            n if n >= 1 << 20 => format!("{:.1}M", n as f64 / 1048576.),
            n if n >= 1024 => format!("{:.1}K", n as f64 / 1024.),
            n => format!("{n}B"),
        };
        let ratio = format!(
            "{:.1}%",
            (self.length as f64 / (w as f64 * h as f64 * components as f64) * 100.)
                .clamp(0.1, 999.)
        );
        format!(
            "{page:4} {idx:5} image  {w:5} {h:6} {color:<5} {components:4}   8  image {interp:>6} {id:6} {generation:2} {x:5} {y:5} {size:>5} {ratio:>5}\n"
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

    pub(in crate::commands::archive) fn encode(&self, format: &str) -> Option<Vec<u8>> {
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
        decode: bool,
        mut handle: impl FnMut(Image) -> Option<()>,
    ) -> Option<()> {
        let node = self
            .objects
            .page_dict(*self.pages.get(page.checked_sub(1)?)?, &self.tree)?;
        self.draw_page(&node, |event, objects| {
            if let Draw::Image(id, matrix) = event
                && let Some(image) = Image::read(objects, id, matrix, limit, decode)?
            {
                handle(image)?;
            }
            Some(())
        })
    }
}
