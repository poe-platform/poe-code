use super::super::pdf_string;
use super::{PageSource, Value};
use crate::commands::archive::encode_pdftk_text;
use std::collections::{BTreeMap, BTreeSet};

impl<'a> PageSource<'a> {
    pub(in crate::commands::archive) fn page_links(
        &mut self,
        page: usize,
        limit: usize,
    ) -> Option<Vec<([f64; 4], String)>> {
        let obj = &mut self.objects;
        let dict = obj.page_dict(*self.pages.get(page.checked_sub(1)?)?, &self.tree)?;
        let mut links = Vec::new();
        let Some(Value::Array(items)) = dict.get(b"Annots").and_then(|v| obj.resolve(v)) else {
            return Some(links);
        };
        let mut targets = None;
        let mut left = limit;
        for item in items {
            let Some((_, d)) = obj.lookup_value(&item) else {
                continue;
            };
            let Some(Value::Array(coords)) = d.get(b"Rect").and_then(|v| obj.resolve(v)) else {
                continue;
            };
            if coords.len() < 4 {
                continue;
            }
            let rect = std::array::from_fn(|i| {
                obj.resolve(&coords[i])
                    .and_then(|v| v.number())
                    .unwrap_or(0.)
            });
            let action = d
                .get(b"A")
                .and_then(|v| obj.lookup_value(v))
                .map(|(_, v)| v);
            let mut uri = action
                .as_ref()
                .and_then(|a| a.get(b"URI"))
                .and_then(|v| obj.resolve(v))
                .and_then(|v| match v {
                    Value::String { bytes, .. } => Some(pdf_string::decode(&bytes)),
                    _ => None,
                })
                .unwrap_or_default();
            if uri.is_empty() {
                let action_dest = action
                    .as_ref()
                    .filter(|a| {
                        a.get(b"S")
                            .and_then(|v| obj.resolve(v))
                            .is_none_or(|s| s.word() == Some(b"/GoTo"))
                    })
                    .and_then(|a| a.get(b"D"));
                let direct = d.get(b"Dest");
                if action_dest.is_none() && direct.is_none() {
                    continue;
                }
                if targets.is_none() {
                    targets = Some((
                        obj.named_destinations(&self.catalog)?,
                        self.pages
                            .iter()
                            .enumerate()
                            .rev()
                            .map(|(i, id)| (id.0, i))
                            .collect(),
                    ));
                }
                let (named, indices) = targets.as_ref()?;
                let Some(target) = [action_dest, direct]
                    .into_iter()
                    .find_map(|v| obj.destination_index(v, named, indices, self.pages.len()))
                else {
                    continue;
                };
                uri = format!("#page{}", target + 1);
            }
            left = left.checked_sub(uri.len() + std::mem::size_of::<([f64; 4], String)>())?;
            links.push((rect, uri));
        }
        Some(links)
    }

    pub(in crate::commands::archive) fn write_urls(
        &mut self,
        first: usize,
        last: usize,
        out: &mut String,
        limit: usize,
    ) -> Option<()> {
        use std::fmt::Write;
        let obj = &mut self.objects;
        for page in first..=last {
            let dict = obj.page_dict(*self.pages.get(page - 1)?, &self.tree)?;
            let Some(Value::Array(items)) = dict.get(b"Annots").and_then(|v| obj.resolve(v)) else {
                continue;
            };
            for item in items {
                let mut stack = Vec::new();
                if let Some((_, d)) = obj.lookup_value(&item) {
                    stack.extend(d.get(b"A").cloned());
                }
                let mut seen = BTreeSet::new();
                while let Some(node) = stack.pop() {
                    let Some((owner, action)) = obj.lookup_value(&node) else {
                        continue;
                    };
                    if owner.is_some_and(|id| !seen.insert(id)) {
                        continue;
                    };
                    if let Some(Value::String { bytes, .. }) =
                        action.get(b"URI").and_then(|v| obj.resolve(v))
                    {
                        let uri = pdf_string::decode(&bytes);
                        if uri.len() > limit.saturating_sub(out.len()) {
                            return None;
                        }
                        writeln!(out, "{page:4}  Annotation    {uri}").ok()?;
                        if out.len() > limit {
                            return None;
                        }
                    }
                    if let Some(next) = action.get(b"Next") {
                        if let Some(Value::Array(items)) = obj.resolve(next) {
                            stack.extend(items.into_iter().rev());
                        } else {
                            stack.push(next.clone());
                        }
                    }
                }
            }
        }
        Some(())
    }

    pub(in crate::commands::archive) fn annotation_report(
        &mut self,
        utf8: bool,
        limit: usize,
        out: &mut String,
    ) -> Result<(), &'static str> {
        const INVALID: &str = "invalid PDF annotations";
        let mut line = |key: &str, val: &str, escaped: bool| -> Result<(), &'static str> {
            let text;
            let val = if escaped && !utf8 {
                text = encode_pdftk_text(val, false);
                &text
            } else {
                val
            };
            if key.len() + val.len() + 1 > limit.saturating_sub(out.len()) {
                return Err("PDF output byte limit exceeded");
            }
            out.push_str(key);
            out.push_str(val);
            out.push('\n');
            Ok(())
        };
        let indices: BTreeMap<_, _> = self
            .pages
            .iter()
            .enumerate()
            .rev()
            .map(|(i, id)| (id.0, i))
            .collect();
        let mut named = None;
        for (i, id) in self.pages.iter().enumerate() {
            let obj = &mut self.objects;
            let page = obj.page_dict(*id, &self.tree).ok_or(INVALID)?;
            let Some(Value::Array(annots)) = page.get(b"Annots").and_then(|v| obj.resolve(v))
            else {
                continue;
            };
            for a in annots {
                let Some(d @ Value::Dict(_)) = obj.resolve(&a) else {
                    continue;
                };
                let mut get = |k: &[u8]| d.get(k).and_then(|v| obj.resolve(v));
                let subtype = get(b"Subtype")
                    .as_ref()
                    .and_then(Value::word)
                    .and_then(|w| w.strip_prefix(b"/"))
                    .map(pdf_string::name)
                    .unwrap_or_else(|| "Annot".into());
                line("---", "", false)?;
                line("AnnotSubtype: ", &subtype, false)?;
                let rect = get(b"Rect");
                let color = get(b"C");
                let mut nums = |a: &[Value<'a>], count| {
                    a.iter()
                        .take(count)
                        .map(|v| {
                            obj.resolve(v)
                                .and_then(|v| v.number())
                                .unwrap_or(0.)
                                .to_string()
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                let rect = if let Some(Value::Array(v)) = rect {
                    nums(&v, 4)
                } else {
                    "0 0 0 0".into()
                };
                line("AnnotRect: ", &rect, false)?;
                let color = if let Some(Value::Array(v)) = color
                    && v.len() >= 3
                {
                    Some(nums(&v, 3))
                } else {
                    None
                };
                for (key, label) in [
                    (b"NM".as_slice(), "AnnotName: "),
                    (b"T", "AnnotTitle: "),
                    (b"Subj", "AnnotSubj: "),
                    (b"Contents", "AnnotContents: "),
                ] {
                    if let Some(Value::String { bytes, .. }) =
                        d.get(key).and_then(|v| obj.resolve(v))
                    {
                        line(label, &pdf_string::decode(&bytes), true)?;
                    }
                }
                if let Some(s) = color {
                    line("AnnotColor: ", &s, false)?;
                }
                if let Some(v) = d.get(b"Open").and_then(|v| obj.resolve(v))
                    && matches!(v.word(), Some(b"true" | b"false"))
                {
                    line(
                        "AnnotOpen: ",
                        if v.word() == Some(b"true") {
                            "true"
                        } else {
                            "false"
                        },
                        false,
                    )?;
                }
                if let Some(Value::String { bytes, .. }) = d.get(b"M").and_then(|v| obj.resolve(v))
                {
                    line("AnnotModificationDate: ", &pdf_string::decode(&bytes), true)?;
                }
                let flags = d
                    .get(b"F")
                    .and_then(|v| obj.resolve(v))
                    .and_then(|v| v.number())
                    .unwrap_or(0.);
                line("AnnotFlags: ", &flags.to_string(), false)?;
                line("AnnotPageNumber: ", &(i + 1).to_string(), false)?;
                let direct = d.get(b"A").is_none();
                let Some(start) = d.get(b"A").or_else(|| d.get(b"Dest")) else {
                    continue;
                };
                let mut stack = vec![start.clone()];
                let mut seen = BTreeSet::new();
                while let Some(raw) = stack.pop() {
                    obj.tokens = obj.tokens.checked_sub(1).ok_or(INVALID)?;
                    if raw.reference().is_some_and(|r| !seen.insert(r)) {
                        continue;
                    }
                    let Some(action) = obj.resolve(&raw) else {
                        continue;
                    };
                    let dest = if direct {
                        line("AnnotActionType: ", "GoTo", false)?;
                        Some(&raw)
                    } else {
                        if let Value::Array(a) = action {
                            stack.extend(a.into_iter().rev());
                            continue;
                        }
                        if !matches!(action, Value::Dict(_)) {
                            continue;
                        }
                        if let Some(v) = action.get(b"S").and_then(|v| obj.resolve(v))
                            && let Some(t) = v
                                .word()
                                .and_then(|w| w.strip_prefix(b"/"))
                                .filter(|s| !s.is_empty())
                        {
                            line("AnnotActionType: ", &pdf_string::name(t), false)?;
                        }
                        if let Some(Value::String { bytes, .. }) =
                            action.get(b"URI").and_then(|v| obj.resolve(v))
                        {
                            line("AnnotActionURI: ", &pdf_string::decode(&bytes), true)?;
                        }
                        action.get(b"D")
                    };
                    if named.is_none() {
                        named = Some(obj.named_destinations(&self.catalog).ok_or(INVALID)?);
                    }
                    let index = obj.destination_index(
                        dest.or(Some(&action)),
                        named.as_ref().unwrap(),
                        &indices,
                        self.pages.len(),
                    );
                    let target = match dest.and_then(|v| obj.resolve(v)) {
                        Some(Value::String { bytes, .. }) => Some(pdf_string::decode(&bytes)),
                        Some(Value::Word(w)) => w.strip_prefix(b"/").map(pdf_string::name),
                        Some(Value::Array(a)) => a.first().and_then(|v| {
                            v.reference()
                                .and_then(|r| indices.get(&r.0).map(|n| format!("page {}", n + 1)))
                                .or_else(|| v.number().map(|n| format!("page {}", n + 1.)))
                        }),
                        Some(Value::Dict(_)) => index.map(|n| format!("page {}", n + 1)),
                        _ => None,
                    };
                    if let Some(t) = target.filter(|s| !s.is_empty()) {
                        line("AnnotActionDest: ", &t, true)?;
                    }
                    if let Some(n) = index {
                        line("AnnotActionPageNumber: ", &(n + 1).to_string(), false)?;
                    }
                    if !direct {
                        let file = match action.get(b"F").and_then(|v| obj.resolve(v)) {
                            Some(v @ Value::Dict(_)) => v
                                .get(b"UF")
                                .or_else(|| v.get(b"F"))
                                .and_then(|v| obj.resolve(v)),
                            v => v,
                        };
                        if let Some(Value::String { bytes, .. }) = file {
                            line("AnnotActionFile: ", &pdf_string::decode(&bytes), true)?;
                        }
                        stack.extend(action.get(b"Next").cloned());
                    }
                }
            }
        }
        Ok(())
    }
}
