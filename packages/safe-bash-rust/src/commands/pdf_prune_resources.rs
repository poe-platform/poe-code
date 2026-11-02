// qpdf counts names even in comments and strings. Only named forms and
// patterns extend the set; unreferenced resources must not keep each other.
use super::super::pdf_string;
use super::{
    ObjectId, Objects, PageTree, Value,
    pdf_stamp::{LayerState, edited_stream},
};
use std::collections::{BTreeMap, BTreeSet};

const BAD: &str = "invalid PDF resource stream";
fn names(bytes: &[u8], found: &mut BTreeSet<String>) {
    let mut at = 0;
    while let Some(i) = bytes[at..].iter().position(|&b| b == b'/') {
        at += i + 1;
        let mut name = String::new();
        while let Some(&b) = bytes.get(at) {
            if b" \t\r\n/<>[]()".contains(&b) {
                break;
            }
            at += 1;
            if b == b'#'
                && let Some(pair) = bytes.get(at..at + 2)
            {
                // Number.parseInt accepts a single leading hex digit.
                if let Some(hi) = char::from(pair[0]).to_digit(16) {
                    let n = char::from(pair[1])
                        .to_digit(16)
                        .map_or(hi, |lo| hi * 16 + lo);
                    name.push(char::from(n as u8));
                    at += 2;
                    continue;
                }
            }
            name.push(char::from(b));
        }
        if !name.is_empty() {
            found.insert(name);
        }
    }
}
impl<'a> LayerState<'a> {
    fn stream_names(
        &mut self,
        o: &mut Objects<'a>,
        node: &Value<'a>,
        bodies: &BTreeMap<ObjectId, Vec<u8>>,
        found: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if let Some(id) = node.reference()
            && let Some(body) = bodies.get(&id)
        {
            if let Some((_, data)) = edited_stream(o, body)? {
                names(&data, found);
                self.decoded.insert(id);
            }
        } else if let Some((Some(id), mut d, Some(c))) = o.lookup_object(node) {
            let raw = o.raw_stream(id, &mut d, c).ok_or(BAD)?;
            names(&o.decode(&d, raw).ok_or(BAD)?, found);
            self.decoded.insert(id);
        }
        Ok(())
    }
    pub(in super::super) fn prune_resources(
        &mut self,
        o: &mut Objects<'a>,
        pages: &[ObjectId],
        tree: &mut PageTree<'a>,
        bodies: &BTreeMap<ObjectId, Vec<u8>>,
    ) -> Result<(), String> {
        for &id in pages {
            let original = o.page_dict(id, tree).ok_or(BAD)?;
            let mut data = vec![];
            self.content(o, original.get(b"Contents"), bodies, &mut data)
                .ok_or(BAD)?;
            let mut found = BTreeSet::new();
            names(&data, &mut found);
            if let Some((_, Value::Array(a))) = original
                .get(b"Annots")
                .and_then(|v| self.lookup(o, bodies, v))
            {
                for item in a {
                    if let Some((_, v)) = self.lookup(o, bodies, &item)
                        && let Some((_, ap)) = v.get(b"AP").and_then(|v| self.lookup(o, bodies, v))
                        && let Some(n) = ap.get(b"N")
                    {
                        self.stream_names(o, n, bodies, &mut found)?
                    }
                }
            }
            let Value::Dict(mut page) = original else {
                return Err(BAD.into());
            };
            let (owner, mut root) = self.resources(o, tree, &page, bodies);
            let mut pending = BTreeMap::<String, Vec<Value>>::new();
            for key in [b"XObject".as_slice(), b"Pattern"] {
                if let Some((_, Value::Dict(cat))) = root
                    .iter()
                    .find(|(k, _)| k.as_ref() == key)
                    .and_then(|(_, v)| self.lookup(o, bodies, v))
                {
                    for (name, v) in cat {
                        pending.entry(pdf_string::name(&name)).or_default().push(v)
                    }
                }
            }
            // Each newly discovered name can reveal resources under either category.
            let mut queue = found.clone();
            while let Some(name) = queue.pop_first() {
                if let Some(nodes) = pending.remove(&name) {
                    let mut extra = BTreeSet::new();
                    for node in nodes {
                        self.stream_names(o, &node, bodies, &mut extra)?
                    }
                    for name in extra {
                        if found.insert(name.clone()) {
                            queue.insert(name);
                        }
                    }
                }
            }
            for key in [
                b"Font".as_slice(),
                b"XObject",
                b"ExtGState",
                b"ColorSpace",
                b"Pattern",
                b"Shading",
                b"Properties",
            ] {
                let Some((cat, Value::Dict(mut entries))) = root
                    .iter()
                    .find(|(k, _)| k.as_ref() == key)
                    .and_then(|(_, v)| self.lookup(o, bodies, v))
                else {
                    continue;
                };
                entries.retain(|(k, _)| found.contains(&pdf_string::name(k)));
                let empty = entries.is_empty();
                if cat.is_some() && cat == owner {
                    root = entries
                } else if cat == Some(id) {
                    page = entries
                } else {
                    self.save_dict(cat, entries, &mut root, key)
                }
                if empty {
                    root.retain(|(k, _)| k.as_ref() != key)
                }
            }
            if owner == Some(id) {
                page = root
            } else {
                self.save_dict(owner, root, &mut page, b"Resources")
            }
            tree.insert(id, Some(Value::Dict(page)));
        }
        Ok(())
    }
}
