// PDFtk's dump_data records describe edits to an existing PDF. Properties not
// present in the input stay in the original object, including non-string values.
use super::super::{PdfDoc, decode_pdftk_entities as text, hex_enc};
use super::{
    Dict, ObjectId, Objects, Value, pdf_render,
    pdf_rewrite::{encode, set},
    pdf_string,
};
use std::collections::BTreeMap;

#[derive(Default)]
pub(in super::super) struct Updates {
    info: Vec<(String, String)>,
    ids: [Option<Vec<u8>>; 2],
    pages: BTreeMap<usize, Geometry>,
    bookmarks: Vec<(usize, String, usize)>,
    labels: Vec<(usize, usize, String, String)>,
}
#[derive(Default)]
struct Geometry {
    rotation: Option<i32>,
    dimensions: Option<[f64; 2]>,
    media: Option<[f64; 4]>,
    crop: Option<[f64; 4]>,
}
fn rectangle<const N: usize>(s: &str) -> Option<[f64; N]> {
    let mut nums = s
        .split(' ')
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().parse::<f64>().ok().filter(|x| x.is_finite()));
    let mut v = [0.; N];
    for n in &mut v {
        *n = nums.next()??;
    }
    if N == 4 && nums.any(|v| v.is_none()) {
        return None;
    }
    Some(v)
}
fn integer(s: &str) -> f64 {
    let n = s.trim_start_matches(['+', '-']);
    let digits = n.len() - n.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    s[..s.len() - n.len() + digits].parse().unwrap_or(0.)
}
impl Updates {
    pub(in super::super) fn parse(input: &str) -> Self {
        let mut edits = Self::default();
        let mut stanza = "";
        let mut fields = BTreeMap::new();
        let mut flush = |stanza: &str, f: &mut BTreeMap<&str, &str>| {
            let get = |key| f.get(key).copied().unwrap_or("");
            let pos = |key| integer(get(key)).clamp(1., 9_007_199_254_740_991.) as usize;
            match stanza {
                "BookmarkBegin" if !get("BookmarkTitle").is_empty() => edits.bookmarks.push((
                    pos("BookmarkLevel"),
                    text(get("BookmarkTitle")),
                    pos("BookmarkPageNumber"),
                )),
                "PageLabelBegin" => edits.labels.push((
                    pos("PageLabelNewIndex") - 1,
                    pos("PageLabelStart"),
                    text(get("PageLabelPrefix")),
                    f.get("PageLabelNumStyle")
                        .copied()
                        .unwrap_or("DecimalArabicNumerals")
                        .to_owned(),
                )),
                "PageMediaBegin" if integer(get("PageMediaNumber")) >= 1. => {
                    let g = edits.pages.entry(pos("PageMediaNumber")).or_default();
                    if let Some(v) = f.get("PageMediaRotation") {
                        let v = integer(v);
                        g.rotation = Some(if v.is_finite() {
                            (((v / 90. + 0.5).floor() * 90.).rem_euclid(360.)) as i32
                        } else {
                            0
                        });
                    }
                    if let Some(v) = rectangle(get("PageMediaRect")) {
                        g.media = Some(v);
                    }
                    if let Some(v) = rectangle(get("PageMediaDimensions")) {
                        g.dimensions = Some(v);
                    }
                    if let Some(v) = rectangle(get("PageMediaCropRect")) {
                        g.crop = Some(v);
                    }
                }
                _ => (),
            }
            f.clear();
        };
        for line in input.lines().map(str::trim) {
            if matches!(
                line,
                "InfoBegin" | "BookmarkBegin" | "PageLabelBegin" | "PageMediaBegin"
            ) {
                flush(stanza, &mut fields);
                stanza = line;
            } else if let Some((key, value)) = line.split_once(':') {
                let value = value.trim();
                match key {
                    "PdfID0" | "PdfID1" => {
                        let units: Vec<_> = value.encode_utf16().collect();
                        edits.ids[usize::from(key == "PdfID1")] = Some(
                            units
                                .chunks_exact(2)
                                .map(|p| {
                                    let s = String::from_utf16_lossy(p);
                                    let s = s.trim_start();
                                    let digits =
                                        s.bytes().take_while(u8::is_ascii_hexdigit).count();
                                    u8::from_str_radix(&s[..digits], 16).unwrap_or(0)
                                })
                                .collect(),
                        );
                    }
                    "InfoValue" if stanza == "InfoBegin" => {
                        if let Some(k) = fields.get("InfoKey").copied().filter(|k| !k.is_empty()) {
                            edits.info.push((text(k), text(value)));
                            stanza = "";
                        }
                    }
                    "PageMediaCropBox" => {
                        fields.insert("PageMediaCropRect", value);
                    }
                    "InfoKey"
                    | "BookmarkTitle"
                    | "BookmarkPageNumber"
                    | "BookmarkLevel"
                    | "PageLabelNumStyle"
                    | "PageLabelStart"
                    | "PageLabelNewIndex"
                    | "PageLabelPrefix"
                    | "PageMediaNumber"
                    | "PageMediaRotation"
                    | "PageMediaDimensions"
                    | "PageMediaRect"
                    | "PageMediaCropRect" => {
                        fields.insert(key, value);
                    }
                    _ => (),
                }
            }
        }
        flush(stanza, &mut fields);
        edits
    }

    pub(in super::super) fn apply_legacy(self, doc: &mut PdfDoc) {
        for (key, value) in self.info {
            if key == "Title" {
                doc.title.clone_from(&value);
            }
            if key == "Author" {
                doc.author.clone_from(&value);
            }
            if let Some((_, old)) = doc.info.iter_mut().find(|(k, _)| *k == key) {
                *old = value;
            } else {
                doc.info.push((key, value));
            }
        }
        for (v, slot) in self
            .ids
            .into_iter()
            .zip([&mut doc.pdf_id0, &mut doc.pdf_id1])
        {
            if let Some(v) = v {
                *slot = hex_enc(&v);
            }
        }
        if !self.bookmarks.is_empty() {
            doc.bookmarks = self
                .bookmarks
                .into_iter()
                .map(|(l, t, p)| (t, l.to_string(), p.to_string()))
                .collect();
        }
        if !self.labels.is_empty() {
            doc.page_labels = self
                .labels
                .into_iter()
                .map(|(i, s, p, k)| ((i + 1).to_string(), s.to_string(), p, k))
                .collect();
        }
        for (p, g) in self.pages {
            let Some(page) = doc.pages.get_mut(p - 1) else {
                continue;
            };
            if let Some(r) = g.rotation {
                page.rot = r;
            }
            let (w, h, c) = doc
                .page_media
                .entry(p)
                .or_insert((doc.page_w, doc.page_h, None));
            if let Some([width, height]) =
                g.media.map(|[a, b, c, d]| [c - a, d - b]).or(g.dimensions)
            {
                *w = width;
                *h = height;
            }
            if p == 1 {
                doc.page_w = *w;
                doc.page_h = *h;
            }
            if g.crop.is_some() {
                *c = g.crop;
            }
        }
    }

    pub(super) fn edit_page(&self, number: usize, d: &mut Dict) {
        let Some(g) = self.pages.get(&number) else {
            return;
        };
        let word = |n: f64| Value::Word(n.to_string().into_bytes().into());
        if let Some(r) = g.rotation {
            set(d, b"Rotate", word(f64::from(r)));
        }
        if let Some(r) = g
            .media
            .or_else(|| g.dimensions.map(|[w, h]| [0., 0., w, h]))
        {
            set(
                d,
                b"MediaBox",
                Value::Array(r.into_iter().map(word).collect()),
            );
        }
        if let Some(r) = g.crop {
            set(
                d,
                b"CropBox",
                Value::Array(r.into_iter().map(word).collect()),
            );
        }
    }

    pub(super) fn apply<'a>(
        &self,
        objects: &mut Objects<'a>,
        trailer: &mut Value<'a>,
        catalog: &mut Value<'a>,
        pages: &[ObjectId],
        changed: &mut BTreeMap<ObjectId, Vec<u8>>,
        limit: usize,
    ) -> Result<(), String> {
        let invalid = "invalid PDF object graph";
        let mut next = objects
            .xref
            .keys()
            .chain(pages.iter())
            .max()
            .ok_or(invalid)?
            .0
            .checked_add(1)
            .ok_or(invalid)?;
        let mut remaining = limit;
        let mut store = |id, v: &Value| -> Result<(), String> {
            let mut body = Vec::new();
            encode(v, &mut body)?;
            remaining = remaining
                .checked_sub(body.len())
                .ok_or("PDF output byte limit exceeded")?;
            changed.insert(id, body);
            Ok(())
        };
        let Value::Dict(tr) = trailer else {
            return Err(invalid.into());
        };
        let Value::Dict(cat) = catalog else {
            return Err(invalid.into());
        };
        if !self.info.is_empty() {
            let mut id = tr
                .iter()
                .find(|(k, _)| k.as_ref() == b"Info")
                .and_then(|(_, v)| v.reference());
            let mut dict = None;
            let mut seen = std::collections::BTreeSet::new();
            while let Some(r) = id.filter(|r| seen.insert(*r)) {
                match objects.object(r).map(|(v, _)| v) {
                    Some(Value::Dict(d)) => {
                        dict = Some(d);
                        break;
                    }
                    Some(Value::Ref(r)) => id = Some(r),
                    _ => break,
                }
            }
            let mut valid = dict.is_some();
            let mut d = dict.unwrap_or_default();
            for (key, value) in &self.info {
                if !valid {
                    let standard = matches!(
                        key.as_str(),
                        "Title" | "Author" | "Subject" | "Keywords" | "Creator" | "Producer"
                    );
                    if !standard && id.is_some() {
                        continue;
                    }
                    if !standard {
                        set(&mut d, b"Title", pdf_string::encode(""));
                    }
                    id = Some((next, 0));
                    next += 1;
                    valid = true;
                    set(tr, b"Info", Value::Ref(id.unwrap()));
                }
                if let Some((_, v)) = d
                    .iter_mut()
                    .find(|(k, _)| super::pdf_string::name(k) == *key)
                {
                    *v = pdf_string::encode(value);
                } else {
                    d.push((encode_name(key).into(), pdf_string::encode(value)));
                }
            }
            if valid {
                store(id.ok_or(invalid)?, &Value::Dict(d))?;
            }
        }
        if self.ids.iter().any(Option::is_some) {
            let old = tr
                .iter()
                .find(|(k, _)| k.as_ref() == b"ID")
                .and_then(|(_, v)| objects.resolve(v));
            let get = |i: usize| {
                if let Some(Value::Array(a)) = &old {
                    a.get(i).and_then(|v| match objects.resolve(v) {
                        Some(Value::String { bytes, .. }) => Some(bytes),
                        _ => None,
                    })
                } else {
                    None
                }
            };
            let mut get = get;
            let first = get(0).unwrap_or_else(|| vec![0; 16]);
            let last = get(1).unwrap_or_else(|| first.clone());
            let values = self
                .ids
                .iter()
                .zip([first, last])
                .map(|(v, old)| Value::String {
                    bytes: v.clone().unwrap_or(old),
                    hex: true,
                })
                .collect();
            set(tr, b"ID", Value::Array(values));
        }
        let word = |n: f64| Value::Word(n.to_string().into_bytes().into());
        if !self.labels.is_empty() {
            let mut nums = Vec::new();
            for (i, s, p, k) in &self.labels {
                let mut d: Dict = vec![(b"St".as_slice().into(), word(*s as f64))];
                if !p.is_empty() {
                    set(&mut d, b"P", pdf_string::encode(p));
                }
                if let Some(k) = match k.as_str() {
                    "DecimalArabicNumerals" => Some(b"/D"),
                    "UppercaseRomanNumerals" => Some(b"/R"),
                    "LowercaseRomanNumerals" => Some(b"/r"),
                    "UppercaseLetters" => Some(b"/A"),
                    "LowercaseLetters" => Some(b"/a"),
                    _ => None,
                } {
                    set(&mut d, b"S", Value::Word(k.as_slice().into()));
                }
                nums.extend([word(*i as f64), Value::Dict(d)]);
            }
            set(cat, b"PageLabels", Value::Ref((next, 0)));
            store(
                (next, 0),
                &Value::Dict(vec![(b"Nums".as_slice().into(), Value::Array(nums))]),
            )?;
            next += 1;
        }
        if !pages.is_empty() && !self.bookmarks.is_empty() {
            let outlines = self
                .bookmarks
                .iter()
                .map(|(l, t, p)| (*l, t.clone(), pages[(*p).min(pages.len()) - 1]))
                .collect();
            let mut bodies = vec![];
            pdf_render::write_outlines(next, &mut bodies, outlines).map_err(|_| invalid)?;
            set(cat, b"Outlines", Value::Ref((next, 0)));
            for body in bodies {
                remaining = remaining
                    .checked_sub(body.len())
                    .ok_or("PDF output byte limit exceeded")?;
                changed.insert((next, 0), body);
                next += 1;
            }
        }
        Ok(())
    }
}
fn encode_name(key: &str) -> Vec<u8> {
    let mut raw = Vec::new();
    for b in key.bytes() {
        if !(33..=126).contains(&b) || b"()<>[]{}/%#".contains(&b) {
            use std::io::Write;
            write!(raw, "#{b:02X}").unwrap();
        } else {
            raw.push(b);
        }
    }
    raw
}
