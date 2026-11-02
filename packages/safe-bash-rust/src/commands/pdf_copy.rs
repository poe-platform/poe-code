// Rebuild the reachable object graph so page extraction does not retain sibling pages.
use super::{ObjectId, Objects, Value, index, pdf_rewrite::set, pdf_rotation::Rotation};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;

#[path = "pdf_fonts.rs"]
mod pdf_fonts;
#[path = "pdf_inspect.rs"]
mod pdf_inspect;
#[path = "pdf_text_layout.rs"]
mod pdf_text_layout;
pub(super) use pdf_text_layout::widths::WIDTHS;

#[path = "pdf_bitmap.rs"]
mod pdf_bitmap;
#[path = "pdf_raster.rs"]
mod pdf_raster;
pub(in crate::commands::archive) use pdf_raster::RasterOptions;

type Matrix = [f64; 6];
const ID: Matrix = [1., 0., 0., 1., 0., 0.];
fn concat([a, b, c, d, e, f]: Matrix, n: Matrix) -> Matrix {
    [
        a * n[0] + b * n[2],
        a * n[1] + b * n[3],
        c * n[0] + d * n[2],
        c * n[1] + d * n[3],
        e * n[0] + f * n[2] + n[4],
        e * n[1] + f * n[3] + n[5],
    ]
}

pub(in super::super) struct PageSource<'a> {
    objects: Objects<'a>,
    pages: Vec<ObjectId>,
    tree: BTreeMap<ObjectId, Option<Value<'a>>>,
    info: Value<'a>,
    catalog: Value<'a>,
}

struct Attachment {
    key: String,
    filename: Vec<u8>,
    stream: ObjectId,
}

type PageTree<'a> = BTreeMap<ObjectId, Option<Value<'a>>>;

impl<'a> Objects<'a> {
    pub(super) fn page_tree(
        &mut self,
        root: ObjectId,
        catalog: &Value<'a>,
    ) -> Option<(Vec<ObjectId>, PageTree<'a>)> {
        let mut pending = vec![catalog.get(b"Pages")?.reference()?];
        let mut tree = BTreeMap::from([(root, None)]);
        let mut pages = Vec::new();
        while let Some(id) = pending.pop() {
            if tree.insert(id, None).is_some() {
                return None;
            }
            let node = self.object(id)?.0;
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
                            b"Parent"
                                | b"MediaBox"
                                | b"Resources"
                                | b"Rotate"
                                | b"CropBox"
                                | b"BleedBox"
                                | b"TrimBox"
                                | b"ArtBox"
                        )
                    });
                    tree.insert(id, Some(Value::Dict(fields)));
                }
                _ => return None,
            }
        }
        Some((pages, tree))
    }
}

impl<'a> PageSource<'a> {
    pub(in super::super) fn open(bytes: &'a [u8]) -> Option<Self> {
        let (mut objects, trailer) = index(bytes)?;
        let root = trailer.get(b"Root")?.reference()?;
        let catalog = objects.object(root)?.0;
        let (pages, tree) = objects.page_tree(root, &catalog)?;
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
                Some(v @ Value::String { .. }) => Some(v.clone()),
                _ => None,
            };
            if let Some(Value::String { bytes: s, .. }) = field
                && !s.is_empty()
            {
                info.push((
                    key,
                    super::pdf_string::encode(&super::pdf_string::decode(&s)),
                ));
            } else if key == b"Producer" {
                info.push((
                    key,
                    Value::String {
                        bytes: b"@poe-code/pdf-ast".to_vec(),
                        hex: false,
                    },
                ));
            }
        }
        Some(Self {
            objects,
            tree,
            pages,
            info: Value::Dict(info),
            catalog,
        })
    }

    fn attachments(&mut self, qpdf: bool) -> Option<Vec<Attachment>> {
        let names = self
            .catalog
            .get(b"Names")
            .and_then(|v| self.objects.resolve(v));
        let pairs = self.objects.tree_pairs(
            names.as_ref().and_then(|v| v.get(b"EmbeddedFiles")),
            b"Names",
        )?;
        let mut specs = Vec::new();
        for (key, spec) in pairs {
            let name = match self.objects.resolve(&key) {
                Some(Value::String { bytes, .. }) => bytes,
                _ if qpdf => format!("att_{}", specs.len() * 2).into_bytes(),
                _ => format!("attachment_{}", specs.len() + 1).into_bytes(),
            };
            specs.push((name, spec));
        }
        let associated = |objects: &mut Objects<'a>,
                          dict: &Value<'a>,
                          prefix: String,
                          specs: &mut Vec<(Vec<u8>, Value<'a>)>| {
            match dict.get(b"AF").and_then(|v| objects.resolve(v)) {
                Some(Value::Array(items)) => {
                    for (i, spec) in items.into_iter().enumerate() {
                        specs.push((
                            if qpdf {
                                vec![]
                            } else {
                                format!("{prefix}_af_{}", i + 1).into_bytes()
                            },
                            spec,
                        ));
                    }
                }
                Some(spec) if !qpdf => specs.push((format!("{prefix}_af").into_bytes(), spec)),
                _ => {}
            }
        };
        associated(
            &mut self.objects,
            &self.catalog,
            "catalog".into(),
            &mut specs,
        );
        for (index, id) in self.pages.iter().enumerate() {
            let page = self.objects.object(*id)?.0;
            let prefix = format!("page{}", index + 1);
            if !qpdf {
                associated(&mut self.objects, &page, prefix.clone(), &mut specs);
            }
            if let Some(Value::Array(items)) =
                page.get(b"Annots").and_then(|v| self.objects.resolve(v))
            {
                for item in items {
                    let annot = self.objects.resolve(&item)?;
                    if annot.get(b"Subtype").and_then(Value::word) == Some(b"/FileAttachment")
                        && let Some(spec) = annot.get(b"FS")
                    {
                        specs.push((
                            if qpdf {
                                vec![]
                            } else {
                                format!("{prefix}_attachment").into_bytes()
                            },
                            spec.clone(),
                        ));
                    }
                }
            }
        }
        let mut files = Vec::new();
        for (fallback, spec) in specs {
            let Some((name, stream)) = self.objects.filespec(&spec, &fallback) else {
                continue;
            };
            self.objects.remaining_bytes = self.objects.remaining_bytes.checked_sub(name.len())?;
            let key = if qpdf {
                super::pdf_string::decode(if fallback.is_empty() {
                    &name
                } else {
                    &fallback
                })
            } else {
                String::new()
            };
            files.push(Attachment {
                key,
                filename: name,
                stream,
            });
        }
        Some(files)
    }

    pub(in super::super) fn qpdf_attachments(
        &mut self,
        show: Option<&str>,
    ) -> Option<Option<String>> {
        let mut seen = BTreeSet::new();
        let mut listing = String::new();
        for file in self.attachments(true)? {
            if !seen.insert(file.key.clone()) {
                continue;
            }
            let filename = super::pdf_string::decode(&file.filename);
            if let Some(key) = show {
                if key == file.key || key == filename {
                    return Some(Some(crate::vfs::bytes_to_stream_string(
                        &self.objects.decoded_stream(file.stream)?,
                    )));
                }
            } else {
                use std::fmt::Write;
                writeln!(listing, "{} -> {filename}", file.key).ok()?;
            }
        }
        Some(show.is_none().then_some(listing))
    }

    pub(in super::super) fn read_attachments(&mut self) -> Option<Vec<(String, Vec<u8>)>> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        for Attachment {
            filename: name,
            stream: id,
            ..
        } in self.attachments(false)?
        {
            let name = super::pdf_string::decode(&name);
            if seen.insert(name.clone()) {
                result.push((name, self.objects.decoded_stream(id)?.into_owned()));
            }
        }
        Some(result)
    }

    pub(in super::super) fn len(&self) -> usize {
        self.pages.len()
    }
}

struct Form {
    number: usize,
    fields: Vec<usize>,
    defaults: Vec<(&'static [u8], Vec<u8>)>,
}

pub(in super::super) struct PageOutput {
    form: Option<Form>,
    optional_content: bool,
    pages: Vec<usize>,
    labels: Vec<u8>,
    attachments: Vec<(Vec<u8>, Vec<u8>)>,
    attachment_names: BTreeSet<String>,
    bodies: Vec<Vec<u8>>,
    limit: usize,
    remaining: usize,
}

impl PageOutput {
    pub(in super::super) fn new(limit: usize) -> Self {
        Self {
            form: None,
            optional_content: false,
            pages: vec![],
            labels: Vec::new(),
            attachments: Vec::new(),
            attachment_names: BTreeSet::new(),
            bodies: vec![
                b"<<\n/Type /Catalog\n/Pages 2 0 R\n".to_vec(),
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
        single_page: Option<usize>,
    ) -> Option<()> {
        let selection = match single_page {
            Some(i) => i..i.checked_add(1)?,
            None => 0..source.len(),
        };
        self.copy_pages(source, selection, single_page.is_none(), &[])
    }

    // Office's PageRange creates a new document, with fresh metadata.
    pub(super) fn selected(
        source: &mut PageSource<'_>,
        pages: std::ops::Range<usize>,
        limit: usize,
    ) -> Option<Vec<u8>> {
        let mut doc = Self::new(limit);
        doc.bodies[2] = b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec();
        doc.copy_pages(source, pages, false, &[])?;
        doc.finish()
    }

    pub(in super::super) fn split(
        source: &mut PageSource<'_>,
        pages: std::ops::Range<usize>,
        rotations: &[Option<Rotation>],
        limit: usize,
    ) -> Option<Vec<u8>> {
        let mut output = Self::new(limit);
        let mut info = vec![(
            b"Producer".as_slice(),
            super::pdf_string::encode("@poe-code/pdf-ast"),
        )];
        for key in [b"Title".as_slice(), b"Author", b"Subject", b"Keywords"] {
            if let Some(value) = source.info.get(key) {
                info.push((key, value.clone()));
            }
        }
        super::pdf_rewrite::encode(&Value::Dict(info), &mut output.bodies[2]).ok()?;
        output.copy_pages(source, pages, false, rotations)?;
        output.finish()
    }

    fn copy_pages(
        &mut self,
        source: &mut PageSource<'_>,
        selection: std::ops::Range<usize>,
        whole_document: bool,
        rotations: &[Option<Rotation>],
    ) -> Option<()> {
        let page_offset = self.pages.len();
        let mut ids = BTreeMap::new();
        for i in selection.clone() {
            let n = self.bodies.len() + 1;
            ids.insert(*source.pages.get(i)?, n);
            self.pages.push(n);
            self.bodies.push(vec![]);
        }
        if whole_document {
            for Attachment {
                filename: name,
                stream: id,
                ..
            } in source.attachments(false)?
            {
                if !self
                    .attachment_names
                    .insert(super::pdf_string::decode(&name))
                {
                    continue;
                }
                let bytes = source.objects.decoded_stream(id)?;
                let encoded = crate::commands::codecs::zlib_compress(&bytes);
                self.remaining = self.remaining.checked_sub(encoded.len() + name.len())?;
                self.attachments.push((name, encoded));
            }
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
        if whole_document {
            for (index, label) in copy.objects.labels(source.catalog.get(b"PageLabels"))? {
                let mut pair = Vec::new();
                write!(pair, "{} ", page_offset.checked_add(index)?).ok()?;
                copy.value(&label, &mut pair, 0)?;
                pair.push(b' ');
                copy.output.remaining = copy.output.remaining.checked_sub(pair.len())?;
                copy.output.labels.extend_from_slice(&pair);
            }
        }
        for i in selection {
            let id = source.pages[i];
            let page = copy.page(id, rotations.get(i).copied().flatten())?;
            let mut body = Vec::new();
            copy.value(&page, &mut body, 0)?;
            copy.output.remaining = copy.output.remaining.checked_sub(body.len())?;
            copy.output.bodies[copy.ids[&id] - 1] = body;
        }
        copy.catalog_fields(&source.catalog)?;
        Some(())
    }

    pub(in super::super) fn finish(mut self) -> Option<Vec<u8>> {
        let mut catalog = std::mem::take(&mut self.bodies[0]);
        if let Some(form) = self.form {
            let mut body = b"<<\n/Fields [ ".to_vec();
            for field in form.fields {
                write!(body, "{field} 0 R ").ok()?;
            }
            body.extend_from_slice(b"]\n");
            for (key, value) in form.defaults {
                body.push(b'/');
                body.extend_from_slice(key);
                body.push(b' ');
                body.extend_from_slice(&value);
                body.push(b'\n');
            }
            body.extend_from_slice(b">>");
            self.bodies[form.number - 1] = body;
        }
        if !self.attachments.is_empty() {
            let mut names = b"<<\n/Names [ ".to_vec();
            for (name, bytes) in self.attachments {
                let stream = self.bodies.len() + 1;
                let mut body = format!(
                    "<<\n/Type /EmbeddedFile\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
                    bytes.len()
                )
                .into_bytes();
                body.extend_from_slice(&bytes);
                body.extend_from_slice(b"\nendstream");
                self.bodies.push(body);
                let mut spec = b"<<\n/Type /Filespec\n/F ".to_vec();
                literal(&name, &mut spec);
                spec.extend_from_slice(b"\n/UF ");
                literal(&name, &mut spec);
                write!(spec, "\n/EF <<\n/F {stream} 0 R\n/UF {stream} 0 R\n>>\n>>").ok()?;
                self.bodies.push(spec);
                literal(&name, &mut names);
                write!(names, " {} 0 R ", stream + 1).ok()?;
            }
            names.extend_from_slice(b"]\n>>");
            self.bodies.push(names);
            let tree = self.bodies.len();
            self.bodies
                .push(format!("<<\n/EmbeddedFiles {tree} 0 R\n>>").into_bytes());
            writeln!(catalog, "/Names {} 0 R", tree + 1).ok()?;
        }
        if !self.labels.is_empty() {
            let n = self.bodies.len() + 1;
            writeln!(catalog, "/PageLabels {n} 0 R").ok()?;
            let mut body = b"<<\n/Nums [ ".to_vec();
            body.append(&mut self.labels);
            body.extend_from_slice(b"]\n>>");
            self.bodies.push(body);
        }
        catalog.extend_from_slice(b">>");
        self.bodies[0] = catalog;
        let mut tree =
            format!("<<\n/Type /Pages\n/Count {}\n/Kids [ ", self.pages.len()).into_bytes();
        for r in self.pages {
            write!(tree, "{r} 0 R ").ok()?;
        }
        tree.extend_from_slice(b"]\n>>");
        self.bodies[1] = tree;
        write_objects(&self.bodies, self.limit)
    }
}

pub(super) fn write_objects(bodies: &[Vec<u8>], limit: usize) -> Option<Vec<u8>> {
    let mut out = b"%PDF-1.7\n%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n".to_vec();
    let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", bodies.len() + 1);
    for (i, body) in bodies.iter().enumerate() {
        use std::fmt::Write;
        writeln!(xref, "{:010} 00000 n ", out.len()).ok()?;
        writeln!(out, "{} 0 obj", i + 1).ok()?;
        if body.len() > limit.checked_sub(out.len() + xref.len())? {
            return None;
        }
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n\n");
    }
    let offset = out.len();
    write!(
        out,
        "{xref}trailer\n<<\n/Size {}\n/Root 1 0 R\n/Info 3 0 R\n>>\n\nstartxref\n{offset}\n%%EOF",
        bodies.len() + 1
    )
    .ok()?;
    (out.len() <= limit).then_some(out)
}

struct Copy<'c, 'a> {
    objects: &'c mut Objects<'a>,
    tree: &'c BTreeMap<ObjectId, Option<Value<'a>>>,
    ids: BTreeMap<ObjectId, usize>,
    output: &'c mut PageOutput,
}

impl<'a> Copy<'_, 'a> {
    // A root field can own a selected widget without itself being referenced by the page.
    fn has_copied_field(
        &mut self,
        node: &Value<'a>,
        seen: &mut BTreeSet<ObjectId>,
        depth: usize,
    ) -> Option<bool> {
        if depth > 128 {
            return None;
        }
        if let Some(id) = node.reference() {
            if self.ids.contains_key(&id) {
                return Some(true);
            }
            if !seen.insert(id) {
                return Some(false);
            }
        }
        if let Some(Value::Array(kids)) = self
            .objects
            .resolve(node)
            .and_then(|v| v.get(b"Kids").and_then(|v| self.objects.resolve(v)))
        {
            for kid in kids {
                if self.has_copied_field(&kid, seen, depth + 1)? {
                    return Some(true);
                }
            }
        }
        Some(false)
    }

    fn catalog_fields(&mut self, catalog: &Value<'a>) -> Option<()> {
        let form = catalog
            .get(b"AcroForm")
            .and_then(|v| self.objects.resolve(v));
        if let Some(form) = form
            && let Some(Value::Array(fields)) =
                form.get(b"Fields").and_then(|v| self.objects.resolve(v))
        {
            let mut roots = Vec::new();
            let mut seen = BTreeSet::new();
            for field in fields {
                if !self.has_copied_field(&field, &mut BTreeSet::new(), 0)? {
                    continue;
                }
                self.value(&field, &mut Vec::new(), 0)?;
                let Some((id, number)) = field
                    .reference()
                    .and_then(|id| self.ids.get(&id).map(|&n| (id, n)))
                else {
                    continue;
                };
                if !seen.insert(number) {
                    continue;
                }
                roots.push(number);
                let (dict, _) = self.objects.object(id)?;
                if let Some(Value::Array(kids)) =
                    dict.get(b"Kids").and_then(|v| self.objects.resolve(v))
                {
                    let mut kept = vec![];
                    for kid in kids {
                        if self.has_copied_field(&kid, &mut BTreeSet::new(), 0)? {
                            kept.push(kid);
                        }
                    }
                    if !kept.is_empty()
                        && let Value::Dict(mut entries) = dict
                    {
                        set(&mut entries, b"Kids", Value::Array(kept));
                        let mut body = vec![];
                        self.value(&Value::Dict(entries), &mut body, 0)?;
                        let old = std::mem::replace(&mut self.output.bodies[number - 1], body);
                        self.output.remaining = (self.output.remaining + old.len())
                            .checked_sub(self.output.bodies[number - 1].len())?;
                    }
                }
            }
            if !roots.is_empty() {
                let mut target = match self.output.form.take() {
                    Some(form) => form,
                    None => {
                        self.output.bodies.push(vec![]);
                        let number = self.output.bodies.len();
                        writeln!(self.output.bodies[0], "/AcroForm {number} 0 R").ok()?;
                        Form {
                            number,
                            fields: vec![],
                            defaults: vec![],
                        }
                    }
                };
                target.fields.extend(roots);
                for key in [b"DR".as_slice(), b"DA"] {
                    if let Some(v) = form.get(key)
                        && !target.defaults.iter().any(|(k, _)| *k == key)
                    {
                        let mut body = vec![];
                        self.value(v, &mut body, 0)?;
                        self.output.remaining = self.output.remaining.checked_sub(body.len())?;
                        target.defaults.push((key, body));
                    }
                }
                self.output.form = Some(target);
            }
        }
        if !self.output.optional_content
            && let Some(v) = catalog.get(b"OCProperties")
        {
            let mut body = b"/OCProperties ".to_vec();
            self.value(v, &mut body, 0)?;
            body.push(b'\n');
            self.output.remaining = self.output.remaining.checked_sub(body.len())?;
            self.output.bodies[0].extend(body);
            self.output.optional_content = true;
        }
        Some(())
    }

    fn page(&mut self, id: ObjectId, rotation: Option<Rotation>) -> Option<Value<'a>> {
        let page = self.objects.object(id)?.0;
        let mut parent = page.get(b"Parent").and_then(Value::reference);
        let Value::Dict(mut entries) = page else {
            return None;
        };
        entries.retain(|(k, _)| *k != b"Parent");
        let mut inherited = BTreeMap::new();
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
                inherited.entry(*k).or_insert(v);
            }
        }
        let angle = entries
            .iter()
            .find(|(k, _)| *k == b"Rotate")
            .map(|(_, v)| v)
            .or_else(|| inherited.get(b"Rotate".as_slice()).copied())
            .and_then(|v| self.objects.resolve(v))
            .and_then(|v| v.number())
            .unwrap_or(0.);
        if let Some(rotation) = rotation {
            set(&mut entries, b"Rotate", rotation.word(angle));
        }
        let mut rectangle = |v: Option<&Value<'a>>| {
            let Value::Array(items) = self.objects.resolve(v?)? else {
                return None;
            };
            if items.len() < 4 {
                return None;
            }
            let mut numbers = vec![];
            for item in &items[..4] {
                let n = self.objects.resolve(item)?;
                n.number().filter(|v| v.is_finite())?;
                numbers.push(n);
            }
            Some(Value::Array(numbers))
        };
        let media = rectangle(
            entries
                .iter()
                .find(|(k, _)| *k == b"MediaBox")
                .map(|(_, v)| v)
                .or_else(|| inherited.get(b"MediaBox".as_slice()).copied()),
        )
        .unwrap_or_else(|| {
            Value::Array(
                [b"0".as_slice(), b"0", b"612", b"792"]
                    .map(Value::Word)
                    .into(),
            )
        });
        let [x, y, right, top] = media.rectangle()?;
        if !entries.iter().any(|(k, _)| *k == b"MediaBox") {
            entries.push((b"MediaBox", media.clone()));
        }
        let mut boxes = vec![];
        for key in [b"CropBox".as_slice(), b"BleedBox", b"TrimBox", b"ArtBox"] {
            if entries.iter().any(|(k, _)| *k == key) {
                continue;
            }
            let rect = rectangle(inherited.get(key).copied()).unwrap_or_else(|| media.clone());
            if rect.rectangle()? != [0., 0., (right - x).abs(), (top - y).abs()] {
                boxes.push((key, rect));
            }
        }
        if !entries.iter().any(|(k, _)| *k == b"Resources") {
            let mut fields = match inherited
                .get(b"Resources".as_slice())
                .and_then(|v| self.objects.resolve(v))
            {
                Some(Value::Dict(fields)) => fields,
                _ => vec![],
            };
            for (_, value) in &mut fields {
                if let Some(dict @ Value::Dict(_)) = self.objects.resolve(value) {
                    *value = dict;
                }
            }
            entries.push((b"Resources", Value::Dict(fields)));
        }
        if !entries.iter().any(|(k, _)| *k == b"Rotate") {
            let angle = angle.rem_euclid(360.);
            if matches!(angle, 90. | 180. | 270.) {
                entries.push((
                    b"Rotate",
                    Value::Word(if angle == 90. {
                        b"90"
                    } else if angle == 180. {
                        b"180"
                    } else {
                        b"270"
                    }),
                ));
            }
        }
        entries.extend(boxes);
        entries.push((b"Parent", Value::Word(b"2 0 R")));
        Some(Value::Dict(entries))
    }

    fn value(&mut self, value: &Value<'_>, out: &mut Vec<u8>, depth: usize) -> Option<()> {
        encode_value(value, out, depth, &mut |id, out, depth| {
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
            Some(())
        })
    }
}

pub(super) fn encode_value(
    value: &Value<'_>,
    out: &mut Vec<u8>,
    depth: usize,
    reference: &mut impl FnMut(&ObjectId, &mut Vec<u8>, usize) -> Option<()>,
) -> Option<()> {
    if depth > 128 {
        return None;
    }
    match value {
        Value::Word(w) => out.extend_from_slice(w),
        Value::String { bytes, hex: false } => literal(bytes, out),
        Value::String { bytes, hex: true } => {
            const HEX: &[u8; 16] = b"0123456789ABCDEF";
            out.push(b'<');
            for b in bytes {
                out.extend_from_slice(&[HEX[(b >> 4) as usize], HEX[(b & 15) as usize]]);
            }
            out.push(b'>');
        }
        Value::Array(items) => {
            out.extend_from_slice(b"[ ");
            for item in items {
                encode_value(item, out, depth + 1, reference)?;
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
                encode_value(v, out, depth + 1, reference)?;
                out.push(b'\n');
            }
            out.extend_from_slice(b">>");
        }
        Value::Ref(id) => reference(id, out, depth)?,
    }
    Some(())
}

pub(super) fn literal(s: &[u8], out: &mut Vec<u8>) {
    out.push(b'(');
    for &b in s {
        match b {
            b'(' | b')' | b'\\' => {
                out.push(b'\\');
                out.push(b);
            }
            b'\t' => out.extend_from_slice(b"\\t"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\n' => out.extend_from_slice(b"\\n"),
            _ => out.push(b),
        }
    }
    out.push(b')');
}
