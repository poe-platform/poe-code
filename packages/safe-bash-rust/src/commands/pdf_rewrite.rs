// Save a classic PDF with its object numbers intact and a flat page tree.
use super::{
    Value,
    attachments::{self, AddAttachment},
    index,
    pdf_copy::{encode_value, write_objects},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
};
const INVALID: &str = "invalid PDF object graph";
const TOO_LARGE: &str = "PDF output byte limit exceeded";
use super::Dict;
pub(super) fn set<'a>(dict: &mut Dict<'a>, key: &'static [u8], value: Value<'a>) {
    if let Some((_, old)) = dict.iter_mut().find(|(k, _)| *k == key) {
        *old = value;
    } else {
        dict.push((key.into(), value));
    }
}

pub(super) fn encode(v: &Value<'_>, out: &mut Vec<u8>) -> Result<(), String> {
    encode_value(v, out, 0, &mut |(n, g), out, _| {
        write!(out, "{n} {g} R").ok()
    })
    .ok_or_else(|| INVALID.into())
}

pub(super) fn write_stream(out:&mut Vec<u8>,mut dict:Value,bytes:&[u8],mode:Option<bool>,limit:usize)->Result<(),String>{
    let compressed;
    let mut data=bytes;
    if let Some(compress)=mode {
        let Value::Dict(ref mut fields)=dict else{return Err(INVALID.into())};
        fields.retain(|(k,_)|!matches!(k.as_ref(),b"Filter"|b"DecodeParms"));
        if compress {
            compressed=crate::commands::codecs::zlib_compress(bytes);
            data=&compressed;
            set(fields,b"Filter",Value::Word(b"/FlateDecode".as_slice().into()));
        }
    }
    dict.set_stream_length(data.len()).ok_or(INVALID)?;
    encode(&dict,out)?;
    if data.len().saturating_add(18)>limit.saturating_sub(out.len()){return Err(TOO_LARGE.into());}
    out.extend_from_slice(b"\nstream\n");
    out.extend_from_slice(data);
    out.extend_from_slice(b"\nendstream");
    Ok(())
}

pub(in super::super) fn empty_pdf(limit: usize) -> Option<Vec<u8>> {
    write_objects(
        &[
            b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
            b"<<\n/Type /Pages\n/Count 0\n/Kids [ ]\n>>".to_vec(),
            b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec(),
        ],
        limit,
    )
}

pub(in super::super) struct Layer<'a> {
    pub path: &'a str,
    pub overlay: bool,
    pub from: &'a str,
    pub to: &'a str,
    pub repeat: &'a str,
    pub password: Option<&'a str>,
}
#[derive(Default)]
pub(in super::super) struct PageEdits<'a> {
    pub selections: Vec<(String, String, Option<&'a str>)>,
    pub password: &'a str,
    pub layers:Vec<Layer<'a>>,
    pub stamp: Option<(&'a [u8], bool, bool)>,
    pub trailer_id: Option<&'a [u8]>,
    pub append_files: Option<&'a [String]>,
    pub attachment_page: Option<usize>,
    pub update: Option<&'a super::Updates>,
    pub compress_streams: Option<bool>,
    pub decrypt: bool,
    pub linearize: bool,
    pub flatten_rotation: bool,
    pub rotations: Vec<&'a str>,
    pub page_rotations: &'a [Option<super::Rotation>],
    pub split_pages: Option<usize>,
    pub info: bool,
    pub metadata: bool,
    pub structure: bool,
    pub acroform: bool,
    pub drop_xfa: bool,
    pub need_appearances: bool,
    pub page_labels: bool,
    pub label_specs: Vec<&'a str>,
    pub generate_object_streams: bool,
    pub normalize_content: bool,
}

fn page_labels(specs: &[&str], limit: usize) -> Result<Vec<u8>, String> {
    let number = |n: f64| {
        if n.abs() >= 1e21 {
            format!("{n:e}").replace('e', "e+")
        } else {
            n.to_string()
        }
    };
    let name = |s: &str| {
        let mut out = Vec::new();
        for unit in s.encode_utf16() {
            if !(33..=126).contains(&unit) || b"()<>[]{}/%#".contains(&(unit as u8)) {
                write!(out, "#{unit:02X}").unwrap();
            } else {
                out.push(unit as u8);
            }
        }
        out
    };
    let mut body = b"<<\n/Nums [ ".to_vec();
    for spec in specs {
        let Some((page, label)) = spec.split_once(':').filter(|(p, _)| !p.is_empty()) else {
            continue;
        };
        let index = super::super::qpdf_decimal(page).unwrap_or(1.).max(1.) - 1.;
        if !index.is_finite() {
            return Err("invalid page label".into());
        }
        let mut parts = label.split('/');
        let style = parts.next().unwrap();
        let second = parts.next().unwrap_or("");
        let start = super::super::qpdf_decimal(second).filter(|n| n.is_finite());
        let prefix = parts.next().unwrap_or(if start.is_none() { second } else { "" });
        let mut fields = Vec::new();
        if style != "n" {
            // The retained writer serializes the label tree, then reads it back before saving.
            let mut token = vec![b'/'];
            if style.is_ascii() {
                token.extend(name(style));
            } else {
                token.extend(name(&super::pdf_string::name(&name(style))));
            }
            set(&mut fields, b"S", Value::Word(token.into()));
        }
        if let Some(n) = start.filter(|&n| n != 0. && n != 1.) {
            set(&mut fields, b"St", Value::Word(number(n).into_bytes().into()));
        }
        if !prefix.is_empty() {
            set(&mut fields, b"P", super::pdf_string::encode(prefix));
        }
        write!(body, "{} ", number(index)).unwrap();
        encode(&Value::Dict(fields), &mut body)?;
        body.push(b' ');
        if body.len() > limit {
            return Err(TOO_LARGE.into());
        }
    }
    body.extend_from_slice(b"]\n>>");
    Ok(body)
}

pub(in super::super) fn rewrite(
    bytes: &[u8],
    edits: &PageEdits,
    remove: &[String],
    add: &[AddAttachment],
    copies: &[attachments::CopyAttachments],
    mut read: impl FnMut(&str) -> Option<Vec<u8>>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let (mut objects, mut trailer) = index(bytes,edits.password)?;
    objects.preserve_hex = !edits.selections.is_empty();
    let root = trailer
        .get(b"Root")
        .and_then(Value::reference)
        .ok_or(INVALID)?;
    let mut catalog = objects.object(root).ok_or(INVALID)?.0;
    let mut first_new = objects.xref.keys().next_back().ok_or(INVALID)?.0.checked_add(1).ok_or(TOO_LARGE)?;
    let mut changed=BTreeMap::new();
    let mut edited_tree =
        if edits.flatten_rotation || !edits.layers.is_empty() || !edits.label_specs.is_empty() {
            let (pages, tree) = objects.page_tree(root, &catalog, 0).ok_or(INVALID)?;
            first_new = first_new.max(
                tree.keys()
                    .next_back()
                    .ok_or(INVALID)?
                    .0
                    .checked_add(1)
                    .ok_or(TOO_LARGE)?,
            );
            Some((pages, tree))
        } else {
            None
        };
    if let Some((pages, tree)) = &mut edited_tree
        && (edits.flatten_rotation || !edits.layers.is_empty())
    {
        let mut state = super::pdf_copy::pdf_stamp::LayerState::default();
        let mut edit_limit = limit;
        state.counts = objects.reference_counts(pages, tree);
        let rotations = super::rotations(&edits.rotations, pages.len()).ok_or("invalid page rotation")?;
        if !edits.layers.is_empty() {
            for (i, r) in rotations.iter().copied().enumerate() {
                if let Some(r) = r {
                    let id = pages[i];
                    let mut page = objects.page_dict(id, tree).ok_or(INVALID)?;
                    let (_, _, angle) = super::pdf_copy::geometry(&mut objects, tree, &page);
                    let Value::Dict(d) = &mut page else {
                        return Err(INVALID.into());
                    };
                    set(d, b"Rotate", r.word(angle));
                    tree.insert(id, Some(page));
                }
            }
        }
        for layer in &edits.layers {
            let bytes = read(layer.path).ok_or_else(|| format!("cannot open {}", layer.path))?;
            let mut source = super::PageSource::open(&bytes, layer.password.unwrap_or(edits.password))
                .map_err(|_| "invalid layer source")?;
            let mut available = limit / 8;
            let mut list = |s: &str, count| -> Result<Vec<usize>, String> {
                let mut indices = Vec::new();
                super::pdf_rotation::visit_range(s, count, |i| {
                    available = available.checked_sub(1)?;
                    indices.push(i);
                    Some(())
                })
                .ok_or("invalid layer page range")?;
                Ok(indices)
            };
            let from = list(layer.from, source.len())?;
            let to = list(layer.to, pages.len())?;
            let repeats = if layer.repeat.is_empty() {
                None
            } else {
                Some(list(layer.repeat, source.len())?)
            };
            if !from.is_empty() {
                let pairs = to.into_iter().zip(
                    from.iter()
                        .chain(repeats.as_ref().unwrap_or(&from).iter().cycle())
                        .copied(),
                );
                (first_new, edit_limit) = source
                    .stamp(
                        &mut objects,
                        pages,
                        tree,
                        pairs,
                        &mut state,
                        true,
                        layer.overlay,
                        first_new,
                        &mut changed,
                        None,
                        edit_limit,
                    )
                    .map_err(|e| {
                        if e == TOO_LARGE {
                            e
                        } else {
                            "invalid layer source".into()
                        }
                    })?;
            }
        }
        if edits.flatten_rotation {
            objects.flatten_rotations(
                pages,
                tree,
                if edits.layers.is_empty() { &rotations } else { &[] },
                &mut changed,
                &mut first_new,
                edit_limit,
                &mut state,
            )?;
        }
        state.finish(&mut changed, edit_limit)?;
    }
    let mut next_edit = first_new
        .checked_add(usize::from(edits.linearize))
        .ok_or(TOO_LARGE)?;
    if !edits.label_specs.is_empty() {
        let Value::Dict(cat) = &mut catalog else {
            return Err(INVALID.into());
        };
        set(cat, b"PageLabels", Value::Ref((next_edit, 0)));
        changed.insert((next_edit, 0), page_labels(&edits.label_specs, limit)?);
        next_edit = next_edit.checked_add(1).ok_or(TOO_LARGE)?;
    }
    if !(remove.is_empty() && add.is_empty() && copies.is_empty()) {
        changed.extend(attachments::edit(&mut objects, &mut catalog, remove, add, copies, &mut read, limit, next_edit)?);
    }
    let Value::Dict(entries) = &mut catalog else {
        return Err(INVALID.into());
    };
    entries.retain(|(key, _)| !match key.as_ref() {
        b"Metadata" => edits.info || edits.metadata,
        b"StructTreeRoot" | b"MarkInfo" => edits.structure,
        b"AcroForm" => edits.acroform,
        b"PageLabels" => edits.page_labels && edits.label_specs.is_empty(),
        _ => false,
    });
    let page_root = catalog
        .get(b"Pages")
        .and_then(Value::reference)
        .ok_or(INVALID)?;
    let (pages, mut tree) = if let Some(graph)=edited_tree {graph} else {objects
        .page_tree(
            root,
            &catalog,
            changed.keys().next_back().map_or(0, |id| id.0),
        )
        .ok_or(INVALID)?};
    if let Some((stamp, multi, overlay)) = edits.stamp {
        let next = tree
            .keys()
            .next_back()
            .ok_or(INVALID)?
            .0
            .checked_add(1)
            .ok_or(TOO_LARGE)?
            .max(first_new);
        let mut source = super::PageSource::open(stamp, "")?;
        let last = source.len().saturating_sub(1);
        let mut state = super::pdf_copy::pdf_stamp::LayerState::default();
        let (_, remaining) = source.stamp(
            &mut objects,
            &pages,
            &mut tree,
            (0..pages.len()).map(|i| (i, if multi { i.min(last) } else { 0 })),
            &mut state,
            false,
            overlay,
            next,
            &mut changed,
            edits.compress_streams,
            limit,
        )?;
        state.finish(&mut changed, remaining)?;
    }
    let pin_page=edits.attachment_page.and_then(|p| pages.get(p.min(pages.len().saturating_sub(1)))).copied();
    let mut pins=if let Some(paths)=edits.append_files {
        let next=tree.keys().next_back().ok_or(INVALID)?.0.checked_add(1).ok_or(TOO_LARGE)?.max(first_new);
        attachments::append(&mut objects,&mut catalog,paths,pin_page.is_some(),edits.compress_streams,read,&mut changed,next,limit)?
    } else {vec![]};
    if let Some(update)=edits.update {update.apply(&mut objects,&mut trailer,&mut catalog,&pages,&mut changed,limit)?;}
    let mut info=trailer.get(b"Info");
    if edits.linearize {
        changed.insert((first_new,0), format!("<<\n/Linearized 1\n/N {}\n>>", pages.len()).into_bytes());
    }
    let rotations=if edits.flatten_rotation || !edits.layers.is_empty() {vec![]} else {super::rotations(&edits.rotations,pages.len()).ok_or("invalid page rotation")?};
    let mut remaining = limit;
    let mut store = |id, value: &Value<'_>| -> Result<(), String> {
        let body = changed.entry(id).or_default();
        body.clear();
        encode(value, body)?;
        remaining = remaining.checked_sub(body.len()).ok_or(TOO_LARGE)?;
        Ok(())
    };
    if edits.info
        && let Some(id) = info.and_then(Value::reference)
        && let Some((Value::Dict(mut entries), mut cursor)) = objects.object(id)
    {
        cursor.skip();
        if !cursor.0.starts_with(b"stream") {
            entries.retain(|(key, _)| key.as_ref() == b"ModDate");
            if entries.is_empty() {
                info = None;
            }
            store(id, &Value::Dict(entries))?;
        }
    }
    if (edits.drop_xfa || edits.need_appearances)
        && let Some((owner,Value::Dict(mut form)))=catalog.get(b"AcroForm").and_then(|v|objects.lookup_value(v))
    {
        if edits.drop_xfa { form.retain(|(k,_)|k.as_ref()!=b"XFA"); }
        if edits.need_appearances { set(&mut form,b"NeedAppearances",Value::Word(b"true".as_slice().into())); }
        let form=Value::Dict(form);
        if let Some(id)=owner {store(id,&form)?;} else if let Value::Dict(root)=&mut catalog {set(root,b"AcroForm",form);}
    }
    for (i, &id) in pages.iter().enumerate() {
        let rotation = edits.page_rotations.get(i).or_else(||rotations.get(i)).copied().flatten();
        if edits.split_pages.is_some() && rotation.is_none() && !edits.flatten_rotation && edits.layers.is_empty() {
            continue;
        }
        let page = objects.page_dict(id, &tree).ok_or(INVALID)?;
        let inherited = |key: &[u8]| {
            let mut current = &page;
            let mut seen = BTreeSet::new();
            loop {
                if let Some(v) = current.get(key) {
                    return Some(v);
                }
                let parent = current.get(b"Parent")?.reference()?;
                if !seen.insert(parent) {
                    return None;
                }
                current = tree.get(&parent)?.as_ref()?;
            }
        };
        let Value::Dict(mut fields) = page.clone() else {
            return Err(INVALID.into());
        };
        if pin_page == Some(id) && !pins.is_empty() {
            let old=page.get(b"Annots");
            let (array_id,mut annots)=match old.and_then(|v|objects.lookup_value(v)) {
                Some((id,Value::Array(a)))=>(id,a),
                _=>(None,Vec::new()),
            };
            annots.append(&mut pins);
            let value=Value::Array(annots);
            if let Some(id)=array_id {store(id,&value)?;} else {set(&mut fields,b"Annots",value);}
        }
        if let Some(update)=edits.update {update.edit_page(i+1,&mut fields);}
        if let Some(rotation) = rotation {
            let original = inherited(b"Rotate")
                .and_then(|v| objects.resolve(v))
                .and_then(|v| v.number())
                .unwrap_or(0.);
            set(&mut fields, b"Rotate", rotation.word(original));
        }
        if edits.split_pages.is_none() {
            if !matches!(
                page.get(b"Resources").and_then(|v| objects.resolve(v)),
                Some(Value::Dict(_))
            ) {
                let mut res = match inherited(b"Resources").and_then(|v| objects.resolve(v)) {
                    Some(Value::Dict(entries)) => entries,
                    _ => vec![],
                };
                for (_, v) in &mut res {
                    if let Some(sub @ Value::Dict(_)) = objects.resolve(v) {
                        *v = sub;
                    }
                }
                set(&mut fields, b"Resources", Value::Dict(res));
            }
            for k in [b"MediaBox".as_slice(), b"CropBox", b"Rotate"] {
                if !fields.iter().any(|(key, _)| *key == k)
                    && let Some(v) = inherited(k).and_then(|v| objects.resolve(v))
                {
                    set(&mut fields, k, v);
                }
            }
            set(&mut fields, b"Parent", Value::Ref(page_root));
        }
        store(id, &Value::Dict(fields))?;
    }
    if edits.split_pages.is_none() {
        let Value::Dict(mut page_node) = objects.object(page_root).ok_or(INVALID)?.0 else {
            return Err(INVALID.into());
        };
        let count = pages.len().to_string();
        set(
            &mut page_node,
            b"Kids",
            Value::Array(pages.into_iter().map(Value::Ref).collect()),
        );
        set(
            &mut page_node,
            b"Count",
            Value::Word(count.as_bytes().into()),
        );
        store(page_root, &Value::Dict(page_node))?;
    }
    store(root, &catalog)?;
    let next = objects
        .xref
        .keys()
        .chain(changed.keys())
        .max()
        .ok_or(INVALID)?
        .0
        .checked_add(1)
        .ok_or(TOO_LARGE)?;
    let decrypt = edits.decrypt && objects.security.is_some();
    let generate = !decrypt && edits.generate_object_streams && edits.split_pages.is_none();
    let mut packed = (generate && !edits.normalize_content).then(Packed::default);
    let mut out = if decrypt { b"%PDF-1.7".to_vec() } else { bytes.get(..8).ok_or(INVALID)?.to_vec() };
    if generate && out.as_slice() < b"%PDF-1.5" {
        out.copy_from_slice(b"%PDF-1.5");
    }
    out.extend_from_slice(b"\n%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n");
    if next > limit / 20 {
        return Err(TOO_LARGE.into());
    }
    let mut rows = vec![(0u8, 0usize, 65535usize); next];
    for (n, row) in rows.iter_mut().enumerate().skip(1) {
        let original = objects
            .xref
            .range((n, 0)..=(n, usize::MAX))
            .next()
            .map(|(&id, _)| id);
        let id = original.unwrap_or((n, 0));
        if original.is_none() && !changed.contains_key(&id) {
            continue;
        }
        let start = out.len();
        *row = (1, start, id.1);
        writeln!(out, "{n} {} obj", id.1).unwrap();
        let body_start = out.len();
        if let Some(body) = changed.remove(&id) {
            if body.len() > limit.saturating_sub(out.len()) {
                return Err(TOO_LARGE.into());
            }
            out.extend_from_slice(&body);
        } else {
            let (mut dict, mut cursor) = objects.object(id).ok_or(INVALID)?;
            cursor.skip();
            if cursor.0.starts_with(b"stream") {
                let mut data=objects.raw_stream(id,&mut dict,cursor).ok_or(INVALID)?;
                if edits.compress_streams.is_some() {data=objects.decode(&dict,data).ok_or(INVALID)?;}
                write_stream(&mut out,dict,&data,edits.compress_streams,limit)?;
            } else if cursor.0.starts_with(b"endobj") {
                encode(&dict, &mut out)?;
            } else {
                return Err(INVALID.into());
            }
        }
        if let Some(p) = &mut packed
            && id.1 == 0
            && let Some(ordinal) = p.append(n, &out[body_start..], &mut objects.tokens, limit)?
        {
            *row = (2, next, ordinal);
            out.truncate(start);
            continue;
        }
        out.extend_from_slice(b"\nendobj\n\n");
        if out.len() > limit {
            return Err(TOO_LARGE.into());
        }
    }
    let mut trailer_entries = format!("/Root {} {} R\n", root.0, root.1).into_bytes();
    for (key, value) in [(b"Info".as_slice(), info), (b"ID", trailer.get(b"ID").filter(|_| !decrypt))] {
        if key==b"ID" && let Some(id)=edits.trailer_id {
            trailer_entries.extend_from_slice(b"/ID ");
            trailer_entries.extend_from_slice(id);
            trailer_entries.push(b'\n');
        } else if let Some(v) = value {
            trailer_entries.push(b'/');
            trailer_entries.extend_from_slice(key);
            trailer_entries.push(b' ');
            encode(v, &mut trailer_entries)?;
            trailer_entries.push(b'\n');
        }
    }
    if let Some(p) = packed
        && p.count != 0
    {
        return p.finish(out, rows, &trailer_entries, limit);
    }
    finish_classic(out, rows, &trailer_entries, root.0, limit)
}

#[path = "pdf_linearize.rs"]
mod pdf_linearize;
pub(super) use pdf_linearize::finish_classic;
fn write_xref(mut out: Vec<u8>, rows: Vec<(u8,usize,usize)>, trailer_entries: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let next = rows.len();
    if next > limit.saturating_sub(out.len()) / 20 { return Err(TOO_LARGE.into()); }
    let offset = out.len();
    writeln!(out, "xref\n0 {next}").unwrap();
    for (ty, pos, generation) in rows {
        writeln!(
            out,
            "{pos:010} {generation:05} {} ",
            if ty == 0 { 'f' } else { 'n' }
        )
        .unwrap();
    }
    writeln!(out, "trailer\n<<\n/Size {next}").unwrap();
    out.extend_from_slice(trailer_entries);
    write!(out, ">>\n\nstartxref\n{offset}\n%%EOF").unwrap();
    if out.len() > limit {
        return Err(TOO_LARGE.into());
    }
    Ok(out)
}

#[derive(Default)]
struct Packed {
    header: Vec<u8>,
    bodies: Vec<u8>,
    count: usize,
}

impl Packed {
    fn append(
        &mut self,
        number: usize,
        body: &[u8],
        tokens: &mut usize,
        limit: usize,
    ) -> Result<Option<usize>, String> {
        // Only ordinary generation-zero values are eligible. Object bodies
        // here have just been serialized by this writer.
        if body.ends_with(b"\nendstream")
            || super::Cursor(body)
                .value(0, tokens, false)
                .ok_or(INVALID)?
                .get(b"Linearized")
                .is_some()
        {
            return Ok(None);
        }
        if self.count != 0 {
            self.header.push(b' ');
        }
        write!(self.header, "{number} {}", self.bodies.len()).unwrap();
        if body.len()
            >= limit
                .saturating_sub(self.header.len())
                .saturating_sub(self.bodies.len())
        {
            return Err(TOO_LARGE.into());
        }
        self.bodies.extend_from_slice(body);
        self.bodies.push(b'\n');
        self.count += 1;
        Ok(Some(self.count - 1))
    }

    fn finish(
        mut self,
        mut out: Vec<u8>,
        mut rows: Vec<(u8, usize, usize)>,
        trailer: &[u8],
        limit: usize,
    ) -> Result<Vec<u8>, String> {
        use crate::commands::codecs::zlib_compress;
        let container = rows.len();
        self.header.push(b'\n');
        let first = self.header.len();
        self.header.append(&mut self.bodies);
        let payload = zlib_compress(&self.header);
        rows.push((1, out.len(), 0));
        write!(out,"{container} 0 obj\n<<\n/Type /ObjStm\n/N {}\n/First {first}\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",self.count,payload.len()).unwrap();
        if payload.len() > limit.saturating_sub(out.len()) {
            return Err(TOO_LARGE.into());
        }
        out.extend_from_slice(&payload);
        out.extend_from_slice(b"\nendstream\nendobj\n\n");
        let offset = out.len();
        let index = rows.len();
        rows.push((1, offset, 0));
        let size = rows.len();
        let mut binary = Vec::with_capacity(size * 7);
        for (ty, pos, generation) in rows {
            binary.push(ty);
            binary.extend_from_slice(&(pos as u32).to_be_bytes());
            binary.extend_from_slice(&(generation as u16).to_be_bytes());
        }
        let payload = zlib_compress(&binary);
        write!(
            out,
            "{index} 0 obj\n<<\n/Type /XRef\n/Size {size}\n/W [ 1 4 2 ]\n"
        )
        .unwrap();
        out.extend_from_slice(trailer);
        write!(
            out,
            "/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            payload.len()
        )
        .unwrap();
        if payload.len() > limit.saturating_sub(out.len()) {
            return Err(TOO_LARGE.into());
        }
        out.extend_from_slice(&payload);
        write!(out, "\nendstream\nendobj\n\nstartxref\n{offset}\n%%EOF").unwrap();
        if out.len() > limit {
            return Err(TOO_LARGE.into());
        }
        Ok(out)
    }
}
