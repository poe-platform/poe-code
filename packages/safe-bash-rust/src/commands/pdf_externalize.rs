// Promote inline images to page XObjects while keeping their encoded pixels.
use super::super::{Dict, pdf_rewrite::write_stream};
use super::{
    ObjectId, Objects, PageTree, Value, pdf_content_edit::serialize_content, pdf_stamp::LayerState,
};
use std::collections::BTreeMap;

const LARGE: &str = "PDF output byte limit exceeded";
const BAD: &str = "invalid PDF image";
pub(super) fn image_dict(entries: &Dict<'_>) -> Value<'static> {
    let mut fields: Dict = vec![
        (b"Type".into(), Value::Word(b"/XObject".as_slice().into())),
        (b"Subtype".into(), Value::Word(b"/Image".as_slice().into())),
    ];
    for (key, v) in entries {
        let k: &[u8] = match key.as_ref() {
            b"BPC" => b"BitsPerComponent",
            b"CS" => b"ColorSpace",
            b"D" => b"Decode",
            b"DP" => b"DecodeParms",
            b"F" => b"Filter",
            b"H" => b"Height",
            b"IM" => b"ImageMask",
            b"I" => b"Interpolate",
            b"W" => b"Width",
            other => other,
        };
        let expanded: &[u8] = match (k, v.word()) {
            (b"ColorSpace", Some(b"/G")) => b"/DeviceGray",
            (b"ColorSpace", Some(b"/RGB")) => b"/DeviceRGB",
            (b"ColorSpace", Some(b"/CMYK")) => b"/DeviceCMYK",
            (b"ColorSpace", Some(b"/I")) => b"/Indexed",
            (b"Filter", Some(b"/AHx")) => b"/ASCIIHexDecode",
            (b"Filter", Some(b"/A85")) => b"/ASCII85Decode",
            (b"Filter", Some(b"/LZW")) => b"/LZWDecode",
            (b"Filter", Some(b"/Fl")) => b"/FlateDecode",
            (b"Filter", Some(b"/RL")) => b"/RunLengthDecode",
            (b"Filter", Some(b"/CCF")) => b"/CCITTFaxDecode",
            (b"Filter", Some(b"/DCT")) => b"/DCTDecode",
            _ => b"",
        };
        let value = if expanded.is_empty() {
            v.clone().into_owned()
        } else {
            Value::Word(expanded.into())
        };
        if let Some((_, old)) = fields.iter_mut().find(|(key, _)| key.as_ref() == k) {
            *old = value
        } else {
            fields.push((k.to_vec().into(), value))
        }
    }
    Value::Dict(fields)
}
impl<'a> LayerState<'a> {
    pub(in super::super) fn externalize_images(
        &mut self,
        o: &mut Objects<'a>,
        pages: &[ObjectId],
        tree: &mut PageTree<'a>,
        bodies: &mut BTreeMap<ObjectId, Vec<u8>>,
        next: &mut usize,
        left: &mut usize,
        minimum: u64,
        compress: bool,
    ) -> Result<BTreeMap<ObjectId, Value<'static>>, String> {
        if minimum >= 1 << 53 { return Err("invalid inline-image minimum size".into()); }
        // PDF serialization supplies the physical length. JSON reports the
        // original dictionary, even when an inline image specifies /Length.
        let mut lengths = BTreeMap::new();
        let mut counter = 0;
        for &id in pages {
            let original = o.page_dict(id, tree).ok_or(BAD)?;
            let mut data = vec![];
            self.content(o, original.get(b"Contents"), bodies, &mut data)
                .ok_or(BAD)?;
            let Value::Dict(mut page) = original else {
                return Err(BAD.into());
            };
            let (r, mut root) = self.resources(o, tree, &page, bodies);
            let (cat, mut images) = match root
                .iter()
                .find(|(k, _)| k.as_ref() == b"XObject")
                .and_then(|(_, v)| self.lookup(o, bodies, v))
            {
                Some((r, Value::Dict(d))) => (r, d),
                _ => (None, vec![]),
            };
            let mut modified = false;
            let mut bytes =
                serialize_content(&data, true, &mut o.tokens, *left, |entries, pixels| {
                    if (pixels.len() as u64) < minimum {
                        return Ok(None);
                    }
                    let name = loop {
                        counter += 1;
                        let name = format!("ImExt{counter}");
                        if !images.iter().any(|(k, _)| k.as_ref() == name.as_bytes()) {
                            break name;
                        }
                    };
                    let image = (*next, 0);
                    *next = next.checked_add(1).ok_or(LARGE)?;
                    let d = image_dict(entries);
                    if let Some(length) = d.get(b"Length") {
                        lengths.insert(image, length.clone());
                    }
                    if d.get(b"Filter").is_none() {
                        self.decoded.insert(image);
                    }
                    let mut body = vec![];
                    write_stream(&mut body, d, pixels, None, *left)?;
                    *left = left.checked_sub(body.len()).ok_or(LARGE)?;
                    bodies.insert(image, body);
                    images.push((name.as_bytes().to_vec().into(), Value::Ref(image)));
                    modified = true;
                    Ok(Some(name))
                })?;
            if modified {
                self.save_dict(cat, images, &mut root, b"XObject")
            }
            self.save_dict(r, root, &mut page, b"Resources");
            if modified {
                bytes.pop(); // The content serializer separates operators with one LF.
                self.replace(o, &mut page, &bytes, bodies, next, left, compress)?;
            }
            tree.insert(id, Some(Value::Dict(page)));
        }
        Ok(lengths)
    }
}
