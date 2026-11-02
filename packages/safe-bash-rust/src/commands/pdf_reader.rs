// Classic cross-reference tables and page content streams (PDF 32000-1, sections 7 and 9).
use super::{PdfDoc, PdfPage};
use std::collections::{BTreeMap, BTreeSet};

#[path = "pdf_attachments.rs"]
pub(super) mod attachments;
#[path = "pdf_rewrite.rs"]
mod pdf_rewrite;
#[path = "pdf_rotation.rs"]
mod pdf_rotation;
pub(super) use pdf_rotation::{Rotation, pdftk_selection, rotations};
pub(super) use pdf_rewrite::{Layer,PageEdits,rewrite,empty_pdf};
#[path = "pdf_copy.rs"]
mod pdf_copy;
pub(super) use pdf_copy::{PageOutput, PageSource, RasterOptions};

#[path = "pdf_office.rs"]
mod pdf_office;
pub(super) use pdf_office::render_office;

#[path = "pdf_svg.rs"]
mod pdf_svg;
pub(super) use pdf_svg::render_svg;

#[path = "pdf_form_data.rs"]
mod pdf_form_data;
#[path = "pdf_form_appearance.rs"]
mod pdf_form_appearance;
#[path = "pdf_fill.rs"]
mod pdf_fill;
#[path = "pdf_fields.rs"]
mod pdf_fields;
pub(super) use pdf_fields::report as field_report;

#[path = "pdf_update.rs"]
mod pdf_update;
pub(super) use pdf_update::Updates;

#[path = "pdf_render.rs"]
mod pdf_render;
pub(in crate::commands) use pdf_render::image_pdf;
pub(super) use pdf_render::render_paragraphs;

#[path = "pdf_filters.rs"]
mod pdf_filters;

#[path = "pdf_string.rs"]
mod pdf_string;

#[path = "pdf_encrypt.rs"]
mod pdf_encrypt;
pub(super) use pdf_encrypt::encrypt_document;

#[path = "pdf_security.rs"]
mod pdf_security;
pub(super) use pdf_security::{PASSWORD, UNSUPPORTED, accepts_password};
use std::borrow::Cow;
type Dict<'a> = Vec<(Cow<'a, [u8]>, Value<'a>)>;

type ObjectId = (usize, usize);

#[derive(Clone)]
enum Value<'a> {
    Word(Cow<'a, [u8]>),
    String { bytes: Vec<u8>, hex: bool },
    Ref(ObjectId),
    Array(Vec<Value<'a>>),
    Dict(Dict<'a>),
}

impl<'a> Value<'a> {
    fn into_owned(self) -> Value<'static> {
        match self {
            Self::Word(w) => Value::Word(Cow::Owned(w.into_owned())),
            Self::String { bytes, hex } => Value::String { bytes, hex },
            Self::Ref(r) => Value::Ref(r),
            Self::Array(a) => Value::Array(a.into_iter().map(Value::into_owned).collect()),
            Self::Dict(d) => Value::Dict(
                d.into_iter()
                    .map(|(k, v)| (Cow::Owned(k.into_owned()), v.into_owned()))
                    .collect(),
            ),
        }
    }

    fn get(&self, key: &[u8]) -> Option<&Self> {
        match self {
            Self::Dict(d) => d.iter().rev().find(|(k, _)| *k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn set_stream_length(&mut self, length: usize) -> Option<()> {
        let Self::Dict(entries) = self else { return None };
        let mut found = false;
        for (_, value) in entries.iter_mut().filter(|(k, _)| k.as_ref() == b"Length") {
            *value = Self::Word(length.to_string().into_bytes().into());
            found = true;
        }
        if !found {
            entries.push((b"Length".into(), Self::Word(length.to_string().into_bytes().into())));
        }
        Some(())
    }

    fn word(&self) -> Option<&[u8]> {
        match self {
            Self::Word(w) => Some(w),
            _ => None,
        }
    }
    fn number(&self) -> Option<f64> {
        std::str::from_utf8(self.word()?).ok()?.parse().ok()
    }
    fn rectangle(&self) -> Option<[f64; 4]> {
        let Self::Array(items) = self else {
            return None;
        };
        let [x0, y0, x1, y1] = items.as_slice() else {
            return None;
        };
        let rect = [x0.number()?, y0.number()?, x1.number()?, y1.number()?];
        rect.iter().all(|v| v.is_finite()).then_some(rect)
    }
    fn reference(&self) -> Option<ObjectId> {
        match self {
            Self::Ref(r) => Some(*r),
            _ => None,
        }
    }
}

fn uint(s: &[u8]) -> Option<usize> {
    std::str::from_utf8(s).ok()?.parse().ok()
}

#[derive(Clone, Copy)]
struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn skip(&mut self) {
        loop {
            self.0 = self.0.trim_ascii_start();
            if !self.0.starts_with(b"%") {
                break;
            }
            self.0 = self
                .0
                .iter()
                .position(|&b| matches!(b, b'\r' | b'\n'))
                .map_or(&[], |end| &self.0[end..]);
        }
    }

    // A bad length can point anywhere in binary data. Probe only the fixed
    // keyword and charge skipped comments and whitespace against the scan budget.
    fn keyword(&mut self, word: &[u8], budget: &mut usize) -> Option<bool> {
        let whitespace = |b| matches!(b, 0 | 9 | 10 | 12 | 13 | 32);
        let mut comment = false;
        while let Some((&b, rest)) = self.0.split_first() {
            if !comment && b != b'%' && !whitespace(b) { break; }
            *budget = budget.checked_sub(1)?;
            comment = (comment || b == b'%') && !matches!(b, b'\n' | b'\r');
            self.0 = rest;
        }
        Some(self.eat(word) && self.0.first().is_none_or(|&b| whitespace(b) || b"()<>[]{}/%".contains(&b)))
    }

    fn eat(&mut self, token: &[u8]) -> bool {
        if let Some(rest) = self.0.strip_prefix(token) {
            self.0 = rest;
            return true;
        }
        false
    }

    fn word(&mut self) -> Option<&'a [u8]> {
        self.skip();
        let start = usize::from(self.0.starts_with(b"/"));
        let end = start
            + self.0[start..]
                .iter()
                .position(|&b| b.is_ascii_whitespace() || b"()<>[]{}/%".contains(&b))
                .unwrap_or(self.0.len() - start);
        if end == 0 {
            return None;
        }
        let (word, rest) = self.0.split_at(end);
        self.0 = rest;
        Some(word)
    }

    fn object_header(&mut self) -> Option<ObjectId> {
        let id = (uint(self.word()?)?, uint(self.word()?)?);
        (self.word()? == b"obj").then_some(id)
    }

    fn byte(&mut self) -> Option<u8> {
        let (&b, rest) = self.0.split_first()?;
        self.0 = rest;
        Some(b)
    }

    fn value(&mut self, depth: usize, tokens: &mut usize, preserve_hex: bool) -> Option<Value<'a>> {
        *tokens = tokens.checked_sub(1)?;
        if depth > 64 {
            return None;
        }
        self.skip();
        if self.eat(b"<<") {
            let mut dict = Vec::new();
            loop {
                self.skip();
                if self.eat(b">>") {
                    return Some(Value::Dict(dict));
                }
                let key = self.word()?.strip_prefix(b"/")?;
                dict.push((key.into(), self.value(depth + 1, tokens, preserve_hex)?));
            }
        }
        if self.eat(b"[") {
            let mut arr = Vec::new();
            loop {
                self.skip();
                if self.eat(b"]") {
                    return Some(Value::Array(arr));
                }
                arr.push(self.value(depth + 1, tokens, preserve_hex)?);
            }
        }
        if self.eat(b"(") {
            let mut bytes = Vec::new();
            let mut level = 1;
            loop {
                let mut b = self.byte()?;
                match b {
                    b'(' => level += 1,
                    b')' => {
                        level -= 1;
                        if level == 0 {
                            return Some(Value::String { bytes, hex: false });
                        }
                    }
                    b'\\' => {
                        b = match self.byte()? {
                            b'n' => b'\n',
                            b'r' => b'\r',
                            b'b' => 8,
                            b't' => b'\t',
                            b'f' => 12,
                            b'\r' => {
                                self.eat(b"\n");
                                continue;
                            }
                            b'\n' => continue,
                            digit @ b'0'..=b'7' => {
                                let mut n = digit - b'0';
                                for _ in 0..2 {
                                    if !matches!(self.0.first(), Some(b'0'..=b'7')) {
                                        break;
                                    }
                                    n = n.wrapping_mul(8) + (self.byte()? - b'0');
                                }
                                n
                            }
                            other => other,
                        };
                    }
                    b'\r' => {
                        self.eat(b"\n");
                        b = b'\n';
                    }
                    _ => {}
                }
                bytes.push(b);
            }
        }
        if self.eat(b"<") {
            let mut bytes = Vec::new();
            let mut high = None;
            loop {
                let b = self.byte()?;
                if b == b'>' {
                    break;
                }
                if b.is_ascii_whitespace() {
                    continue;
                }
                let digit = (b as char).to_digit(16)? as u8;
                if let Some(h) = high.take() {
                    bytes.push(h | digit)
                } else {
                    high = Some(digit << 4)
                }
            }
            if let Some(h) = high {
                bytes.push(h)
            }
            // Parsed files normalize to literal strings; generated graph edits retain their format.
            return Some(Value::String { bytes, hex: preserve_hex });
        }
        let word = self.word()?;
        if let Some(id) = uint(word) {
            let mut probe = *self;
            if let Some(generation) = probe.word().and_then(uint)
                && probe.word() == Some(b"R")
            {
                *self = probe;
                return Some(Value::Ref((id, generation)));
            }
        }
        Some(Value::Word(word.into()))
    }
}

const CP1252: &[char] = &[
    '€', '�', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '�', 'Ž', '�', '�', '‘', '’',
    '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '�', 'ž', 'Ÿ',
];

fn text(bytes: &[u8]) -> String {
    if let Some(utf16) = bytes.strip_prefix(&[0xfe, 0xff]) {
        return char::decode_utf16(
            utf16
                .chunks_exact(2)
                .map(|p| u16::from_be_bytes([p[0], p[1]])),
        )
        .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect();
    }
    bytes
        .iter()
        .map(|&b| {
            if (128..160).contains(&b) {
                CP1252[(b - 128) as usize]
            } else {
                char::from(b)
            }
        })
        .collect()
}

fn content_text(bytes: &[u8], tokens: &mut usize) -> Option<String> {
    let mut c = Cursor(bytes);
    let mut last: Option<Value<'_>> = None;
    let mut out = String::new();
    let mut in_text = false;
    let mut new_line = false;
    let mut baseline = 0.0;
    let mut previous_line = None;
    let mut font_size = 12.0;
    let mut leading = 0.0;
    loop {
        c.skip();
        if c.0.is_empty() {
            return Some(out);
        }
        let v = c.value(0, tokens, false)?;
        match v.word() {
            Some(b"BT") => {
                in_text = true;
                baseline = 0.0;
                new_line = true;
            }
            Some(b"ET") => in_text = false,
            Some(b"Tf") => font_size = last.as_ref()?.number()?.abs(),
            Some(b"TL") => leading = last.as_ref()?.number()?,
            Some(op @ (b"Tm" | b"Td" | b"TD")) => {
                let y = last.as_ref()?.number()?;
                if op == b"Tm" {
                    baseline = y;
                } else {
                    baseline += y;
                    if op == b"TD" {
                        leading = -y;
                    }
                }
                new_line = true;
            }
            Some(b"T*") => {
                baseline -= leading;
                new_line = true;
            }
            Some(op @ (b"Tj" | b"TJ" | b"'" | b"\"")) if in_text => {
                if matches!(op, b"'" | b"\"") {
                    baseline -= leading;
                    new_line = true;
                }
                if new_line && !out.is_empty() {
                    out.push('\n');
                    if previous_line.is_some_and(|(y, size)| y - baseline > size * 1.9) {
                        out.push('\n');
                    }
                }
                previous_line = Some((baseline, font_size));
                match last.take() {
                    Some(Value::String { bytes: b, .. }) => out.push_str(&text(&b)),
                    Some(Value::Array(a)) => {
                        for part in a {
                            if let Value::String { bytes: b, .. } = part {
                                out.push_str(&text(&b));
                            }
                        }
                    }
                    _ => {}
                }
                new_line = false;
            }
            _ => {}
        }
        last = Some(v);
    }
}

#[derive(Clone, Copy)]
enum Location {
    File(usize),
    Member { container: usize, ordinal: usize },
}

struct ObjectStream<'a> {
    bytes: Cow<'a, [u8]>,
    members: Vec<(usize, usize)>, // object number and decoded byte offset
}

enum OffsetRepair {
    Strict,
    OnError,
    Scanned(BTreeMap<ObjectId, usize>),
}

struct Objects<'a> {
    bytes: &'a [u8],
    security: Option<pdf_security::Security>,
    offset_repair: OffsetRepair,
    xref: BTreeMap<ObjectId, (Location, usize)>, // location and newest-revision traversal order
    latest_members: BTreeMap<usize, usize>,
    streams: BTreeMap<usize, ObjectStream<'a>>,
    loading: BTreeSet<usize>,
    tokens: usize,
    remaining_bytes: usize,
    preserve_hex: bool,
}

impl<'a> Objects<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            security: None,
            offset_repair: OffsetRepair::Strict,
            xref: BTreeMap::new(),
            latest_members: BTreeMap::new(),
            streams: BTreeMap::new(),
            loading: BTreeSet::new(),
            tokens: 1_000_000,
            remaining_bytes: crate::budget::ShellLimits::default().max_input_bytes,
            preserve_hex: false,
        }
    }

    fn object_stream(&mut self, number: usize) -> Option<ObjectStream<'a>> {
        let (&id, _) = self.xref.range((number, 0)..=(number, usize::MAX)).next()?;
        let Location::File(_) = self.xref[&id].0 else {
            return None;
        };
        let (mut dict, c) = self.object(id)?;
        if dict.get(b"Type")?.word()? != b"/ObjStm" {
            return None;
        }
        let count = uint(dict.get(b"N")?.word()?)?;
        let first = uint(dict.get(b"First")?.word()?)?;
        self.tokens = self.tokens.checked_sub(count)?;
        self.remaining_bytes = self
            .remaining_bytes
            .checked_sub(count.checked_mul(std::mem::size_of::<(usize, usize)>())?)?;
        let encoded = self.raw_stream(id, &mut dict, c)?;
        let bytes = self.decode(&dict, encoded)?;
        let mut header = Cursor(bytes.get(..first)?);
        let mut members = Vec::with_capacity(count);
        for _ in 0..count {
            let number = uint(header.word()?)?;
            let offset = first.checked_add(uint(header.word()?)?)?;
            if number == 0
                || offset >= bytes.len()
                || members.last().is_some_and(|&(_, pos)| pos >= offset)
            {
                return None;
            }
            members.push((number, offset));
        }
        header.skip();
        if !header.0.is_empty() {
            return None;
        }
        Some(ObjectStream { bytes, members })
    }

    fn object(&mut self, id: ObjectId) -> Option<(Value<'a>, Cursor<'a>)> {
        let (mut v,c)=self.stored_object(id)?;
        // Compressed members have already been decrypted with their container's key.
        if let Some(security) = &self.security && matches!(self.xref.get(&id)?.0, Location::File(_)) {
            security.strings(id, &mut v);
        }
        Some((v,c))
    }

    fn stored_object(&mut self, id: ObjectId) -> Option<(Value<'a>, Cursor<'a>)> {
        let offset = match self.xref.get(&id)?.0 {
            Location::File(pos) => pos,
            Location::Member { container, ordinal } => {
                if !self.streams.contains_key(&container) {
                    if self.loading.len() >= 64 || !self.loading.insert(container) {
                        return None;
                    }
                    let stream = self.object_stream(container);
                    self.loading.remove(&container);
                    self.streams.insert(container, stream?);
                }
                let stream = self.streams.get(&container)?;
                let &(number, start) = stream.members.get(ordinal)?;
                if number != id.0 {
                    return None;
                }
                let end = stream
                    .members
                    .get(ordinal + 1)
                    .map_or(stream.bytes.len(), |r| r.1);
                let bytes = stream.bytes.get(start..end)?;
                self.remaining_bytes = self.remaining_bytes.checked_sub(bytes.len())?;
                let value = Cursor(bytes)
                    .value(0, &mut self.tokens, self.preserve_hex)?
                    .into_owned();
                return Some((value, Cursor(b"endobj")));
            }
        };
        let bytes = self.bytes;
        let preserve_hex = self.preserve_hex;
        let parse = |offset, tokens: &mut usize| {
            let mut c = Cursor(bytes.get(offset..)?);
            if c.object_header()? != id { return None; }
            Some((c.value(0, tokens, preserve_hex)?, c))
        };
        if let Some(object) = parse(offset, &mut self.tokens) { return Some(object); }
        if matches!(self.offset_repair, OffsetRepair::OnError) {
            // The xref is authoritative for membership and order. Repair only
            // the bad location, matching both object number and generation.
            let mut offsets = BTreeMap::new();
            let mut scanner = Objects::new(bytes);
            scanner.tokens = self.tokens;
            scanner.remaining_bytes = self.remaining_bytes;
            let scanned = pdf_repair::scan(&mut scanner, |key, at| {
                if self.xref.contains_key(&key) { offsets.insert(key, at); }
            });
            self.tokens = scanner.tokens;
            self.remaining_bytes = scanner.remaining_bytes;
            self.offset_repair = OffsetRepair::Strict;
            scanned?;
            self.offset_repair = OffsetRepair::Scanned(offsets);
        }
        let OffsetRepair::Scanned(offsets) = &self.offset_repair else { return None; };
        let fixed = *offsets.get(&id)?;
        self.xref.get_mut(&id)?.0 = Location::File(fixed);
        parse(fixed, &mut self.tokens)
    }

    // Return the terminal (non-stream) value and its owner while preserving
    // any intermediate indirect references in the parent dictionary.
    fn lookup_value(&mut self, node: &Value<'a>) -> Option<(Option<ObjectId>, Value<'a>)> {
        let (owner,value,stream)=self.lookup_object(node)?;
        stream.is_none().then_some((owner,value))
    }

    fn lookup_object(&mut self,node:&Value<'a>)->Option<(Option<ObjectId>, Value<'a>, Option<Cursor<'a>>)>{
        let mut value = node.clone();
        let mut owner = None;
        let mut seen = std::collections::BTreeSet::new();
        while let Value::Ref(id) = value {
            if !seen.insert(id) {return None;}
            let (v, mut cursor) = self.object(id)?;
            cursor.skip();
            if cursor.0.starts_with(b"stream") {return Some((Some(id),v,Some(cursor)));}
            owner = Some(id);
            value = v;
        }
        Some((owner, value, None))
    }

    fn resolve(&mut self, value: &Value<'a>) -> Option<Value<'a>> {
        match value.reference() {
            Some(id) => Some(self.object(id)?.0),
            None => Some(value.clone()),
        }
    }

    fn tree_pairs(
        &mut self,
        root: Option<&Value<'a>>,
        key: &[u8],
    ) -> Option<Vec<(Value<'a>, Value<'a>)>> {
        let mut entries = Vec::new();
        let mut seen = BTreeSet::new();
        let mut pending: Vec<_> = root.cloned().into_iter().collect();
        while let Some(node) = pending.pop() {
            if let Some(id) = node.reference()
                && !seen.insert(id)
            {
                continue;
            }
            let node = self.resolve(&node)?;
            if let Some(Value::Array(pairs)) = node.get(key).and_then(|v| self.resolve(v)) {
                let mut items = pairs.into_iter();
                while let (Some(k), Some(v)) = (items.next(), items.next()) {
                    entries.push((k, v));
                }
            }
            if let Some(Value::Array(kids)) = node.get(b"Kids").and_then(|v| self.resolve(v)) {
                pending.extend(kids.into_iter().rev());
            }
        }
        Some(entries)
    }

    fn labels(&mut self, root: Option<&Value<'a>>) -> Option<Vec<(usize, Value<'a>)>> {
        let mut labels = Vec::new();
        for (key, data) in self.tree_pairs(root, b"Nums")? {
            let Some(index) = self.resolve(&key).and_then(|v| uint(v.word()?)) else {
                continue;
            };
            let value = self.resolve(&data)?;
            let mut fields = Vec::new();
            for k in [b"S".as_slice(), b"St", b"P"] {
                if let Some(v) = value.get(k).and_then(|v| self.resolve(v))
                    && match (k, &v) {
                        (b"S", Value::Word(w)) => w.starts_with(b"/"),
                        (b"St", Value::Word(w)) => uint(w).is_some(),
                        (b"P", Value::String { .. }) => true,
                        _ => false,
                    }
                {
                    if let Value::String { bytes: prefix, .. } = &v {
                        self.remaining_bytes = self.remaining_bytes.checked_sub(prefix.len())?;
                    }
                    fields.push((k.into(), v));
                }
            }
            labels.push((index, Value::Dict(fields)));
        }
        Some(labels)
    }

    fn stream(&mut self, dict: &Value<'_>, mut c: Cursor<'a>) -> Option<&'a [u8]> {
        if !c.keyword(b"stream", &mut self.remaining_bytes)? { return None; }
        if !c.eat(b"\r\n") && !c.eat(b"\r") { c.eat(b"\n"); }
        let payload = c.0;
        let length = dict.get(b"Length").and_then(|v| match v.reference() {
            Some(r) => uint(self.object(r)?.0.word()?),
            None => uint(v.word()?),
        });
        if let Some(n) = length
            && let Some(tail) = payload.get(n..)
            && Cursor(tail).keyword(b"endstream", &mut self.remaining_bytes)?
        {
            return Some(&payload[..n]);
        }
        let mut first = None;
        for (offset, window) in payload.windows(9).enumerate() {
            self.remaining_bytes = self.remaining_bytes.checked_sub(1)?;
            if window != b"endstream" { continue; }
            first.get_or_insert(offset);
            if Cursor(&payload[offset + 9..]).keyword(b"endobj", &mut self.remaining_bytes)? {
                first = Some(offset);
                break;
            }
        }
        let data = &payload[..first?];
        Some(data.strip_suffix(b"\r\n").or_else(|| data.strip_suffix(b"\n"))
            .or_else(|| data.strip_suffix(b"\r")).unwrap_or(data))
    }

    fn decoded_stream(&mut self, id: ObjectId) -> Option<std::borrow::Cow<'a, [u8]>> {
        let (mut dict, c) = self.object(id)?;
        let stream = self.raw_stream(id, &mut dict, c)?;
        self.decode(&dict, stream)
    }

    fn xref_revision(
        &mut self,
        offset: usize,
        record: &mut impl FnMut(usize, Option<(usize, Location)>),
    ) -> Option<Value<'a>> {
        let mut c = Cursor(self.bytes.get(offset..)?);
        let head = c.word()?;
        if head == b"xref" {
            loop {
                let first = c.word()?;
                if first == b"trailer" {
                    break;
                }
                let first = uint(first)?;
                let count = uint(c.word()?)?;
                self.tokens = self.tokens.checked_sub(count)?;
                for id in first..first.checked_add(count)? {
                    let pos = uint(c.word()?)?;
                    let generation = uint(c.word()?)?;
                    let flag = c.word()?;
                    record(
                        id,
                        (flag == b"n").then_some((generation, Location::File(pos))),
                    );
                }
            }
            return c.value(0, &mut self.tokens, false);
        }
        uint(head)?;
        uint(c.word()?)?;
        if c.word()? != b"obj" {
            return None;
        }
        let dict = c.value(0, &mut self.tokens, false)?;
        let Value::Array(widths) = dict.get(b"W")? else {
            return None;
        };
        let [a, b, d] = widths.as_slice() else {
            return None;
        };
        let (a, b, d) = (uint(a.word()?)?, uint(b.word()?)?, uint(d.word()?)?);
        let width = a.checked_add(b)?.checked_add(d)?;
        if width == 0 {
            return None;
        }
        let size = uint(dict.get(b"Size")?.word()?)?;
        let ranges = match dict.get(b"Index") {
            None => vec![(0, size)],
            Some(Value::Array(v)) if v.len() % 2 == 0 => v
                .chunks_exact(2)
                .map(|p| Some((uint(p[0].word()?)?, uint(p[1].word()?)?)))
                .collect::<Option<Vec<_>>>()?,
            _ => return None,
        };
        let stream = self.stream(&dict, c)?;
        let data = self.decode(&dict, Cow::Borrowed(stream))?;
        let mut bytes = data.as_ref();
        let mut field = |n| {
            let (head, tail) = bytes.split_at_checked(n)?;
            bytes = tail;
            head.iter()
                .try_fold(0usize, |v, &b| v.checked_mul(256)?.checked_add(b.into()))
        };
        for (first, count) in ranges {
            self.tokens = self.tokens.checked_sub(count)?;
            for id in first..first.checked_add(count)? {
                let ty = if a == 0 { 1 } else { field(a)? };
                let pos = field(b)?;
                let generation = field(d)?;
                match ty {
                    0 => record(id, None),
                    1 => record(id, Some((generation, Location::File(pos)))),
                    2 => record(
                        id,
                        Some((
                            0,
                            Location::Member {
                                container: pos,
                                ordinal: generation,
                            },
                        )),
                    ),
                    _ => return None,
                }
            }
        }
        Some(dict)
    }

    fn stream_text(&mut self, id: ObjectId) -> Option<String> {
        content_text(&self.decoded_stream(id)?, &mut self.tokens)
    }
}

pub(super) fn header_version(bytes: &[u8]) -> Option<&[u8]> {
    let head = &bytes[..bytes.len().min(1024)];
    let start = head.windows(5).position(|w| w == b"%PDF-")? + 5;
    Some(&head[start..head.len().min(start + 3)])
}

fn last_xref(bytes: &[u8]) -> Option<usize> {
    let tail = bytes.get(bytes.len().saturating_sub(4096)..)?;
    let offset_pos = tail.windows(9).rposition(|w| w == b"startxref")? + 9;
    uint(Cursor(&tail[offset_pos..]).word()?)
}

#[path = "pdf_repair.rs"]
mod pdf_repair;

pub(super) const NO_CATALOG: &str = "Unable to repair PDF: no /Type /Catalog object found";
fn index<'a>(bytes: &'a [u8], password: &str) -> Result<(Objects<'a>, Value<'a>), &'static str> {
    if let Some((mut objects, trailer)) = strict_index(bytes) {
        objects.authenticate(&trailer,password)?;
        objects.offset_repair = OffsetRepair::OnError;
        if let Some(catalog) = trailer.get(b"Root").and_then(Value::reference)
                .and_then(|id| objects.object(id)).map(|(value, _)| value)
            && matches!(catalog.get(b"Pages"), Some(Value::Ref(_) | Value::Dict(_)))
        {
            return Ok((objects, trailer));
        }
    }
    let (objects, trailer) = pdf_repair::recover(bytes,password)?;
    trailer.get(b"Root").and_then(Value::reference).ok_or(NO_CATALOG)?;
    Ok((objects, trailer))
}

fn strict_index(bytes: &[u8]) -> Option<(Objects<'_>, Value<'_>)> {
    let mut offset = last_xref(bytes)?;
    let mut objects = Objects::new(bytes);
    let mut latest_members = BTreeMap::new();
    // Keep the first traversal position for inspection, but the last row
    // in that revision determines the object's generation, offset or deletion.
    let mut rows = BTreeMap::new();
    let mut revisions = BTreeSet::new();
    let mut latest = Vec::new();
    while revisions.insert(offset) {
        objects.tokens = objects.tokens.checked_sub(1)?;
        let mut record = |id, location| {
            let order = rows.len();
            let row = rows.entry(id).or_insert((offset, order, location));
            if row.0 == offset {
                row.2 = location;
            }
        };
        let trailer = objects.xref_revision(offset, &mut |id, location| {
            if revisions.len() == 1 {
                if let Some((_, Location::Member { container, .. })) = location {
                    latest_members.insert(id, container);
                } else {
                    latest_members.remove(&id);
                }
            }
            record(id, location)
        })?;
        let hybrid = trailer.get(b"XRefStm").map(|v| uint(v.word()?));
        let supplement = match hybrid {
            Some(Some(p)) if p != offset => Some(objects.xref_revision(p, &mut record)?),
            Some(None) => return None,
            _ => None,
        };
        let prev = trailer.get(b"Prev").map(|v| uint(v.word()?));
        for trailer in std::iter::once(trailer).chain(supplement) {
            let Value::Dict(entries) = trailer else {
                return None;
            };
            for (key, value) in entries {
                if matches!(key.as_ref(), b"Root" | b"Info" | b"ID" | b"Size" | b"Encrypt")
                    && !latest.iter().any(|(k, _)| *k == key)
                {
                    latest.push((key, value));
                }
            }
        }
        match prev {
            Some(Some(p)) => offset = p,
            None => break,
            _ => return None,
        }
    }
    objects.latest_members = latest_members;
    objects.xref = rows
        .into_iter()
        .filter_map(|(id, (_, order, location))| {
            location.map(|(generation, pos)| ((id, generation), (pos, order)))
        })
        .collect();
    Some((objects, Value::Dict(latest)))
}

#[path = "pdf_metadata.rs"]
mod pdf_metadata;
pub(super) use pdf_metadata::{INFO_TAGS, edit_info};

pub(super) fn read(bytes: &[u8], password: &str) -> Result<(PdfDoc, Option<pdf_security::Security>), &'static str> {
    let (mut objects, trailer) = index(bytes,password)?;
    let doc = read_pages(bytes, &mut objects, trailer).ok_or("Invalid PDF object graph")?;
    Ok((doc,objects.security))
}

fn read_pages<'a>(bytes: &[u8], objects: &mut Objects<'a>, trailer: Value<'a>) -> Option<PdfDoc> {
    let catalog = objects.object(trailer.get(b"Root")?.reference()?)?.0;
    let mut doc = PdfDoc::new();
    doc.version = std::str::from_utf8(bytes.strip_prefix(b"%PDF-")?.get(..3)?)
        .ok()?
        .to_string();
    if let Some(id_array @ Value::Array(ids)) = trailer.get(b"ID") {
        let mut encoded=Vec::new();
        pdf_rewrite::encode(id_array,&mut encoded).ok()?;
        doc.trailer_id=Some(encoded);
        for (id, target) in ids.iter().zip([&mut doc.pdf_id0, &mut doc.pdf_id1]) {
            if let Value::String { bytes, .. } = id {
                *target = super::hex_enc(bytes);
            }
        }
    }
    if let Some(r) = trailer.get(b"Info").and_then(Value::reference)
        && let Value::Dict(info) = objects.object(r)?.0
    {
        for (k, v) in info {
            if let Value::String { bytes: b, .. } = v {
                let value = pdf_string::decode(&b);
                match k.as_ref() {
                    b"Title" => doc.title.clone_from(&value),
                    b"Author" => doc.author.clone_from(&value),
                    _ => {}
                }
                doc.info
                    .push((pdf_string::name(&k), value));
            }
        }
    }
    for (index, label) in objects.labels(catalog.get(b"PageLabels"))? {
        let start = label
            .get(b"St")
            .and_then(Value::word)
            .and_then(uint)
            .unwrap_or(1);
        let prefix = match label.get(b"P") {
            Some(Value::String { bytes: s, .. }) => pdf_string::decode(s),
            _ => String::new(),
        };
        let style = match label.get(b"S").and_then(Value::word) {
            Some(b"/D") => "DecimalArabicNumerals",
            Some(b"/R") => "UppercaseRomanNumerals",
            Some(b"/r") => "LowercaseRomanNumerals",
            Some(b"/A") => "UppercaseLetters",
            Some(b"/a") => "LowercaseLetters",
            _ => "NoNumber",
        };
        doc.page_labels.push((
            index.checked_add(1)?.to_string(),
            start.to_string(),
            prefix,
            style.into(),
        ));
    }
    let mut page_ids=Vec::new();
    let mut pending = vec![(
        catalog.get(b"Pages")?.clone(),
        [0.0, 0.0, 612.0, 792.0],
        None,
        0,
    )];
    let mut seen = BTreeSet::new();
    while let Some((kid, mut media, mut crop, mut rotation)) = pending.pop() {
        let id=kid.reference();
        let node = match id {
            Some(id) if !seen.insert(id) => continue,
            Some(id) => objects.object(id)?.0,
            None => kid,
        };
        for key in [b"MediaBox".as_slice(), b"CropBox", b"Rotate"] {
            let Some(mut value) = node.get(key) else {
                continue;
            };
            let resolved;
            if let Some(id) = value.reference() {
                resolved = objects.object(id)?.0;
                value = &resolved;
            }
            match key {
                b"MediaBox" => media = value.rectangle()?,
                b"CropBox" => crop = Some(value.rectangle()?),
                _ => {
                    rotation = std::str::from_utf8(value.word()?)
                        .ok()?
                        .parse::<i32>()
                        .ok()?
                        .rem_euclid(360)
                }
            }
        }
        match node.get(b"Type")?.word()? {
            b"/Pages" => {
                let Value::Array(kids) = objects.resolve(node.get(b"Kids")?)? else {
                    return None;
                };
                for kid in kids.into_iter().rev() {
                    pending.push((kid, media, crop, rotation));
                }
            }
            b"/Page" => {
                page_ids.push(id.unwrap_or_default());
                let mut page = PdfPage {
                    rot: rotation,
                    ..Default::default()
                };
                match node.get(b"Contents") {
                    Some(Value::Ref(r)) => page.text = objects.stream_text(*r)?,
                    Some(Value::Array(streams)) => {
                        for s in streams {
                            if !page.text.is_empty() {
                                page.text.push('\n');
                            }
                            page.text.push_str(&objects.stream_text(s.reference()?)?);
                        }
                    }
                    None => {}
                    _ => return None,
                }
                let (w, h) = (media[2] - media[0], media[3] - media[1]);
                if doc.pages.is_empty() {
                    doc.page_w = w;
                    doc.page_h = h;
                }
                doc.pages.push(page);
                if node.get(b"MediaBox").is_some() && media != [0.,0.,w.abs(),h.abs()] {doc.direct_media.insert(doc.pages.len(),media);}
                doc.page_media.insert(doc.pages.len(), (w, h, crop));
            }
            _ => return None,
        }
    }
    doc.linearized = objects.xref.keys().copied().collect::<Vec<_>>().into_iter().any(|id| {
        objects.object(id).is_some_and(|(v,mut cursor)| {
            cursor.skip();
            !cursor.0.starts_with(b"stream") && v.get(b"Linearized").is_some()
        })
    });
    doc.bookmarks = objects.outlines(&catalog,&page_ids)?.into_iter().map(|(title,level,index)|(title,level.to_string(),(index+1).to_string())).collect();
    Some(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_recovery_must_finish_looking_for_an_endobj_within_budget() {
        let bytes = b"stream\nx\rendstream junk endstream % comment\r\n endobj";
        let dict = Value::Dict(vec![]);
        let mut objects = Objects {
            tokens: 100,
            remaining_bytes: 15,
            ..Objects::new(bytes)
        };
        assert!(objects.stream(&dict, Cursor(bytes)).is_none());
        objects.remaining_bytes = bytes.len();
        assert_eq!(objects.stream(&dict, Cursor(bytes)), Some(b"x\rendstream junk ".as_slice()));
        assert_eq!(objects.stream(&dict, Cursor(b"stream\r\nx\rendstream junk")), Some(b"x".as_slice()));
    }

    #[test]
    fn compressed_object_must_match_its_header_row_and_stay_within_its_span() {
        for (header, payload, number, ordinal) in [
            ("1 0 2 2 ", "42/Yes", 2, 0),
            ("1 0 2 2 ", "42/Yes", 2, 2),
            ("1 0 2 0 ", "42/Yes", 1, 0),
            ("1 0 2 2 extra ", "42/Yes", 1, 0),
            ("1 0 2 2 ", "[1] true", 1, 0),
        ] {
            let body = format!(
                "7 0 obj << /Type /ObjStm /N 2 /First {} /Length {} >> stream\n{header}{payload}\nendstream",
                header.len(),
                header.len() + payload.len()
            );
            let mut objects = Objects::new(body.as_bytes());
            objects.xref.insert((7, 0), (Location::File(0), 0));
            objects.xref.insert(
                (number, 0),
                (
                    Location::Member {
                        container: 7,
                        ordinal,
                    },
                    1,
                ),
            );
            assert!(objects.object((number, 0)).is_none());
        }
    }

    #[test]
    fn binary_xref_rejects_truncated_or_oversized_rows() {
        for (w, size, data) in [
            ("1 1 0", 2, &[1, 7, 1][..]),
            ("0 0 0", 2, &[]),
            ("0 1 0", 2_000_000, &[1]),
            ("1 0 0", 1, &[3]),
        ] {
            let head = format!(
                "1 0 obj << /Size {size} /W [{w}] /Length {} >> stream\n",
                data.len()
            );
            let bytes = [head.as_bytes(), data, b"\nendstream endobj"].concat();
            let mut objects = Objects {
                tokens: 1000,
                remaining_bytes: 2048,
                ..Objects::new(&bytes)
            };
            assert!(objects.xref_revision(0, &mut |_, _| {}).is_none());
        }
    }

    #[test]
    fn positioned_text_distinguishes_paragraphs_from_adjacent_lines() {
        let stream = b"BT /F1 10 Tf 1 0 0 1 50 120 Tm (one) Tj ET
            BT 1 0 0 1 50 108 Tm (two) Tj ET
            BT 1 0 0 1 50 84 Tm (three) Tj 0 -12 Td (four) Tj ET";
        assert_eq!(
            content_text(stream, &mut 1000).unwrap(),
            "one\ntwo\n\nthree\nfour"
        );
    }
}
