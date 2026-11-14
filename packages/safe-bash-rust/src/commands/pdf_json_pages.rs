use super::{J, PageSource, Value, cos, record, string};
use std::collections::BTreeSet;

impl PageSource<'_> {
    pub(super) fn json_page(&mut self, index: usize, version: u32) -> Option<J> {
        let id = self.pages[index];
        let page = self.objects.page_dict(id, &self.tree)?;
        let raw = page.get(b"Contents");
        let resolved = raw.and_then(|v| self.objects.resolve(v));
        let contents = match &resolved {
            Some(Value::Array(items)) => items
                .iter()
                .filter(|v| v.reference().is_some())
                .map(|v| cos(v, version))
                .collect(),
            _ => raw
                .filter(|v| v.reference().is_some())
                .map(|v| cos(v, version))
                .into_iter()
                .collect(),
        };
        let mut owner = page;
        let mut parents = BTreeSet::new();
        while owner.get(b"Resources").is_none() {
            let Some(parent) = owner.get(b"Parent") else {
                break;
            };
            if parent.reference().is_some_and(|id| !parents.insert(id)) {
                break;
            }
            let Some(value) = self.objects.resolve(parent) else {
                break;
            };
            owner = value;
        }
        let resource = owner
            .get(b"Resources")
            .and_then(|v| self.objects.resolve(v));
        let objects = resource
            .as_ref()
            .and_then(|v| v.get(b"XObject"))
            .and_then(|v| self.objects.resolve(v));
        let mut images = Vec::new();
        if let Some(Value::Dict(mut entries)) = objects {
            entries.sort_by_key(|(name, _)| {
                super::pdf_string::name(name)
                    .encode_utf16()
                    .collect::<Vec<_>>()
            });
            for (name, reference) in entries {
                let Some(image) = self.objects.resolve(&reference) else {
                    continue;
                };
                if image
                    .get(b"Subtype")
                    .and_then(|v| self.objects.resolve(v))
                    .is_none_or(|v| v.word() != Some(b"/Image"))
                {
                    continue;
                }
                if image
                    .get(b"ImageMask")
                    .and_then(|v| self.objects.resolve(v))
                    .is_some_and(|v| v.word() == Some(b"true"))
                {
                    continue;
                }
                let filter = image.get(b"Filter").and_then(|v| self.objects.resolve(v));
                let filters = match filter {
                    Some(Value::Array(items)) => items,
                    Some(v) => vec![v],
                    None => vec![Value::Word(b"null".as_slice().into())],
                };
                let parms = image
                    .get(b"DecodeParms")
                    .and_then(|v| self.objects.resolve(v));
                let parameters = match parms {
                    Some(Value::Array(items)) => items,
                    value => {
                        vec![value.unwrap_or(Value::Word(b"null".as_slice().into())); filters.len()]
                    }
                };
                let filterable = filters.iter().all(|v| {
                    matches!(
                        v.word(),
                        Some(
                            b"null"
                                | b"/FlateDecode"
                                | b"/Fl"
                                | b"/LZWDecode"
                                | b"/LZW"
                                | b"/ASCII85Decode"
                                | b"/A85"
                                | b"/ASCIIHexDecode"
                                | b"/AHx"
                                | b"/RunLengthDecode"
                                | b"/RL"
                        )
                    )
                });
                let mut value = |key: &[u8]| {
                    image
                        .get(key)
                        .and_then(|v| self.objects.resolve(v))
                        .map_or(J::Null, |v| cos(&v, version))
                };
                images.push(record([
                    ("bitspercomponent", value(b"BitsPerComponent")),
                    ("colorspace", value(b"ColorSpace")),
                    (
                        "decodeparms",
                        J::Array(parameters.iter().map(|v| cos(v, version)).collect()),
                    ),
                    (
                        "filter",
                        J::Array(filters.iter().map(|v| cos(v, version)).collect()),
                    ),
                    ("filterable", J::Bool(filterable)),
                    ("height", value(b"Height")),
                    (
                        "name",
                        string(&format!("/{}", super::pdf_string::name(&name))),
                    ),
                    ("object", cos(&reference, version)),
                    ("width", value(b"Width")),
                ]));
            }
        }
        let mut label = J::Null;
        let mut selected = -1.;
        for (at, raw) in self
            .objects
            .tree_pairs(self.catalog.get(b"PageLabels"), b"Nums")?
        {
            let Some(at) = self.objects.resolve(&at).and_then(|v| v.number()) else {
                continue;
            };
            if at > index as f64 || at < selected {
                continue;
            }
            let Some(mut value @ Value::Dict(_)) = self.objects.resolve(&raw) else {
                continue;
            };
            let start = value
                .get(b"St")
                .and_then(|v| self.objects.resolve(v))
                .and_then(|v| v.number())
                .unwrap_or(1.);
            if let Value::Dict(entries) = &mut value {
                super::super::set(
                    entries,
                    b"St",
                    Value::Word((start + index as f64 - at).to_string().into_bytes().into()),
                );
            }
            label = cos(&value, version);
            selected = at;
        }
        let mut outlines = Vec::new();
        let all = self.json_outlines(version)?;
        let mut pending: Vec<_> = match &all {
            J::Array(entries) => entries.iter().rev().collect(),
            _ => return None,
        };
        while let Some(entry) = pending.pop() {
            if entry.get("destpageposfrom1") == Some(&J::Number((index + 1) as f64)) {
                outlines.push(record([
                    ("dest", entry.get("dest")?.clone()),
                    ("object", entry.get("object")?.clone()),
                    ("title", entry.get("title")?.clone()),
                ]));
            }
            if let Some(J::Array(kids)) = entry.get("kids") {
                pending.extend(kids.iter().rev());
            }
        }
        Some(record([
            ("contents", J::Array(contents)),
            ("images", J::Array(images)),
            ("label", label),
            ("object", string(&format!("{} {} R", id.0, id.1))),
            ("outlines", J::Array(outlines)),
            ("pageposfrom1", J::Number((index + 1) as f64)),
        ]))
    }
}
