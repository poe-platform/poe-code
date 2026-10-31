// Rebuild the reachable object graph so page extraction does not retain sibling pages.
use super::{ObjectId, Objects, Value, index};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;

pub(in super::super) struct PageSource<'a> {
    objects: Objects<'a>,
    pages: Vec<ObjectId>,
    tree: BTreeMap<ObjectId, Option<Value<'a>>>,
    info: Value<'a>,
}

impl<'a> PageSource<'a> {
    pub(in super::super) fn open(bytes: &'a [u8]) -> Option<Self> {
        let (mut objects, trailer) = index(bytes)?;
        let root = trailer.get(b"Root")?.reference()?;
        let catalog = objects.object(root)?.0;
        let mut pending = vec![catalog.get(b"Pages")?.reference()?];
        let mut tree = BTreeMap::from([(root, None)]);
        let mut pages = Vec::new();
        while let Some(id) = pending.pop() {
            if tree.insert(id, None).is_some() {
                return None;
            }
            let node = objects.object(id)?.0;
            match node.get(b"Type")?.word()? {
                b"/Page" => pages.push(id),
                b"/Pages" => {
                    let Value::Array(kids) = node.get(b"Kids")? else {
                        return None;
                    };
                    for kid in kids.iter().rev() {
                        pending.push(kid.reference()?);
                    }
                    // Keep inheritable attributes, but never rescan a parent's Kids array per page.
                    let Value::Dict(mut fields) = node else {
                        return None;
                    };
                    fields.retain(|(key, _)| {
                        matches!(
                            *key,
                            b"Parent" | b"MediaBox" | b"Resources" | b"Rotate" | b"CropBox"
                        )
                    });
                    tree.insert(id, Some(Value::Dict(fields)));
                }
                _ => return None,
            }
        }
        let meta = match trailer.get(b"Info").and_then(Value::reference) {
            Some(r) => objects.object(r)?.0,
            None => Value::Dict(Vec::new()),
        };
        let mut info = Vec::new();
        for key in [
            b"Producer".as_slice(),
            b"Title",
            b"Author",
            b"Subject",
            b"Keywords",
            b"Creator",
        ] {
            let field = match meta.get(key) {
                Some(Value::Ref(id)) => Some(objects.object(*id)?.0),
                Some(Value::String(s)) => Some(Value::String(s.clone())),
                _ => None,
            };
            if let Some(Value::String(s)) = field
                && !s.is_empty()
            {
                info.push((key, Value::String(s)));
            } else if key == b"Producer" {
                info.push((key, Value::String(b"@poe-code/pdf-ast".to_vec())));
            }
        }
        Some(Self {
            objects,
            tree,
            pages,
            info: Value::Dict(info),
        })
    }

    pub(in super::super) fn len(&self) -> usize {
        self.pages.len()
    }
}

pub(in super::super) struct PageOutput {
    pages: Vec<usize>,
    bodies: Vec<Vec<u8>>,
    limit: usize,
    remaining: usize,
}

impl PageOutput {
    pub(in super::super) fn new(limit: usize) -> Self {
        Self {
            pages: vec![],
            bodies: vec![
                b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
                vec![],
                vec![],
            ],
            limit,
            remaining: limit,
        }
    }

    pub(in super::super) fn append(
        &mut self,
        source: &mut PageSource<'_>,
        selection: std::ops::Range<usize>,
    ) -> Option<()> {
        let mut ids = BTreeMap::new();
        for i in selection.clone() {
            let n = self.bodies.len() + 1;
            ids.insert(*source.pages.get(i)?, n);
            self.pages.push(n);
            self.bodies.push(vec![]);
        }
        let mut copy = Copy {
            objects: &mut source.objects,
            tree: &source.tree,
            ids,
            output: self,
        };
        if copy.output.bodies[2].is_empty() {
            let mut body = Vec::new();
            copy.value(&source.info, &mut body, 0)?;
            copy.output.remaining = copy.output.remaining.checked_sub(body.len())?;
            copy.output.bodies[2] = body;
        }
        for i in selection {
            let id = source.pages[i];
            let page = copy.page(id)?;
            let mut body = Vec::new();
            copy.value(&page, &mut body, 0)?;
            copy.output.remaining = copy.output.remaining.checked_sub(body.len())?;
            copy.output.bodies[copy.ids[&id] - 1] = body;
        }
        Some(())
    }

    pub(in super::super) fn finish(mut self) -> Option<Vec<u8>> {
        let mut tree =
            format!("<<\n/Type /Pages\n/Count {}\n/Kids [ ", self.pages.len()).into_bytes();
        for r in self.pages {
            write!(tree, "{r} 0 R ").ok()?;
        }
        tree.extend_from_slice(b"]\n>>");
        self.bodies[1] = tree;
        let mut out = b"%PDF-1.7\n%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n".to_vec();
        let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", self.bodies.len() + 1);
        for (i, body) in self.bodies.iter().enumerate() {
            use std::fmt::Write;
            writeln!(xref, "{:010} 00000 n ", out.len()).ok()?;
            writeln!(out, "{} 0 obj", i + 1).ok()?;
            if body.len() > self.limit.checked_sub(out.len() + xref.len())? {
                return None;
            }
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n\n");
        }
        let offset = out.len();
        write!(out,"{xref}trailer\n<<\n/Size {}\n/Root 1 0 R\n/Info 3 0 R\n>>\n\nstartxref\n{offset}\n%%EOF",self.bodies.len()+1).ok()?;
        (out.len() <= self.limit).then_some(out)
    }
}

struct Copy<'c, 'a> {
    objects: &'c mut Objects<'a>,
    tree: &'c BTreeMap<ObjectId, Option<Value<'a>>>,
    ids: BTreeMap<ObjectId, usize>,
    output: &'c mut PageOutput,
}

impl<'a> Copy<'_, 'a> {
    fn page(&mut self, id: ObjectId) -> Option<Value<'a>> {
        let page = self.objects.object(id)?.0;
        let mut parent = page.get(b"Parent").and_then(Value::reference);
        let Value::Dict(mut entries) = page else {
            return None;
        };
        entries.retain(|(k, _)| *k != b"Parent");
        let mut seen = BTreeSet::new();
        while let Some(id) = parent {
            if !seen.insert(id) || seen.len() > 128 {
                return None;
            }
            let ancestor = self.tree.get(&id)?.as_ref()?;
            parent = ancestor.get(b"Parent").and_then(Value::reference);
            let Value::Dict(fields) = ancestor else {
                return None;
            };
            for (k, v) in fields {
                if *k != b"Parent" && !entries.iter().any(|(key, _)| key == k) {
                    entries.push((*k, v.clone()));
                }
            }
        }
        if !entries.iter().any(|(k, _)| *k == b"MediaBox") {
            entries.push((
                b"MediaBox",
                Value::Array(
                    [b"0".as_slice(), b"0", b"612", b"792"]
                        .map(Value::Word)
                        .into(),
                ),
            ));
        }
        if !entries.iter().any(|(k, _)| *k == b"Resources") {
            entries.push((b"Resources", Value::Dict(vec![])));
        }

        entries.push((b"Parent", Value::Word(b"2 0 R")));
        Some(Value::Dict(entries))
    }

    fn value(&mut self, value: &Value<'_>, out: &mut Vec<u8>, depth: usize) -> Option<()> {
        if depth > 128 {
            return None;
        }
        match value {
            Value::Word(w) => out.extend_from_slice(w),
            Value::String(s) => {
                out.push(b'(');
                for &b in s {
                    match b {
                        b'(' | b')' | b'\\' => {
                            out.push(b'\\');
                            out.push(b);
                        }
                        b'\r' => out.extend_from_slice(b"\\r"),
                        b'\n' => out.extend_from_slice(b"\\n"),
                        _ => out.push(b),
                    }
                }
                out.push(b')');
            }
            Value::Array(items) => {
                out.extend_from_slice(b"[ ");
                for item in items {
                    self.value(item, out, depth + 1)?;
                    out.push(b' ');
                }
                out.push(b']');
            }
            Value::Dict(entries) => {
                out.extend_from_slice(b"<<\n");
                for (k, v) in entries {
                    out.push(b'/');
                    out.extend_from_slice(k);
                    out.push(b' ');
                    self.value(v, out, depth + 1)?;
                    out.push(b'\n');
                }
                out.extend_from_slice(b">>");
            }
            Value::Ref(id) => {
                if let Some(n) = self.ids.get(id) {
                    write!(out, "{n} 0 R").ok()?;
                } else if self.tree.contains_key(id) {
                    out.extend_from_slice(b"null");
                } else {
                    let n = self.output.bodies.len() + 1;
                    self.ids.insert(*id, n);
                    self.output.bodies.push(vec![]);
                    let (v, mut cursor) = self.objects.object(*id)?;
                    let mut body = Vec::new();
                    self.value(&v, &mut body, depth + 1)?;
                    cursor.skip();
                    if cursor.0.starts_with(b"stream") {
                        let stream = self.objects.stream(&v, cursor)?;
                        if stream.len() > self.output.remaining.checked_sub(body.len())? {
                            return None;
                        }
                        body.extend_from_slice(b"\nstream\n");
                        body.extend_from_slice(stream);
                        body.extend_from_slice(b"\nendstream");
                    } else if !cursor.0.starts_with(b"endobj") {
                        return None;
                    }
                    self.output.remaining = self.output.remaining.checked_sub(body.len())?;
                    self.output.bodies[n - 1] = body;
                    write!(out, "{n} 0 R").ok()?;
                }
            }
        }
        Some(())
    }
}
