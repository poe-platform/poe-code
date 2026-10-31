// Classic cross-reference tables and page content streams (PDF 32000-1, sections 7 and 9).
use super::{PdfDoc, PdfPage};
use std::collections::{BTreeMap, BTreeSet};

#[path = "pdf_copy.rs"]
mod pdf_copy;
pub(super) use pdf_copy::{PageOutput, PageSource};

type ObjectId = (usize, usize);

#[derive(Clone)]
enum Value<'a> {
    Word(&'a [u8]),
    String(Vec<u8>),
    Ref(ObjectId),
    Array(Vec<Value<'a>>),
    Dict(Vec<(&'a [u8], Value<'a>)>),
}

impl<'a> Value<'a> {
    fn get(&self, key: &[u8]) -> Option<&Self> {
        match self {
            Self::Dict(d) => d.iter().rev().find(|(k, _)| *k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn word(&self) -> Option<&'a [u8]> {
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

    fn byte(&mut self) -> Option<u8> {
        let (&b, rest) = self.0.split_first()?;
        self.0 = rest;
        Some(b)
    }

    fn value(&mut self, depth: usize, tokens: &mut usize) -> Option<Value<'a>> {
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
                dict.push((key, self.value(depth + 1, tokens)?));
            }
        }
        if self.eat(b"[") {
            let mut arr = Vec::new();
            loop {
                self.skip();
                if self.eat(b"]") {
                    return Some(Value::Array(arr));
                }
                arr.push(self.value(depth + 1, tokens)?);
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
                            return Some(Value::String(bytes));
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
            return Some(Value::String(bytes));
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
        Some(Value::Word(word))
    }
}

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
    const CP1252: &[char] = &[
        '€', '�', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '�', 'Ž', '�', '�', '‘',
        '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '�', 'ž', 'Ÿ',
    ];
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
        let v = c.value(0, tokens)?;
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
                    Some(Value::String(b)) => out.push_str(&text(&b)),
                    Some(Value::Array(a)) => {
                        for part in a {
                            if let Value::String(b) = part {
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

struct Objects<'a> {
    bytes: &'a [u8],
    xref: BTreeMap<ObjectId, usize>,
    tokens: usize,
    remaining_bytes: usize,
}

impl<'a> Objects<'a> {
    fn object(&mut self, id: ObjectId) -> Option<(Value<'a>, Cursor<'a>)> {
        let mut c = Cursor(self.bytes.get(*self.xref.get(&id)?..)?);
        if (uint(c.word()?)?, uint(c.word()?)?) != id || c.word()? != b"obj" {
            return None;
        }
        let value = c.value(0, &mut self.tokens)?;
        Some((value, c))
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
                        (b"P", Value::String(_)) => true,
                        _ => false,
                    }
                {
                    if let Value::String(prefix) = &v {
                        self.remaining_bytes = self.remaining_bytes.checked_sub(prefix.len())?;
                    }
                    fields.push((k, v));
                }
            }
            labels.push((index, Value::Dict(fields)));
        }
        Some(labels)
    }

    fn stream(&mut self, dict: &Value<'a>, mut c: Cursor<'a>) -> Option<&'a [u8]> {
        if c.word()? != b"stream" || !(c.eat(b"\r\n") || c.eat(b"\n") || c.eat(b"\r")) {
            return None;
        }
        let length = dict.get(b"Length")?;
        let length = match length.reference() {
            Some(r) => uint(self.object(r)?.0.word()?)?,
            None => uint(length.word()?)?,
        };
        let bytes = c.0.get(..length)?;
        c.0 = &c.0[length..];
        (c.word()? == b"endstream").then_some(bytes)
    }

    fn decoded_stream(&mut self, id: ObjectId) -> Option<std::borrow::Cow<'a, [u8]>> {
        let (dict, c) = self.object(id)?;
        let stream = self.stream(&dict, c)?;
        let bytes = match dict.get(b"Filter") {
            None => std::borrow::Cow::Borrowed(stream),
            Some(f) if f.word() == Some(b"/FlateDecode") => {
                let (&cmf, rest) = stream.split_first()?;
                let (&flags, payload) = rest.split_first()?;
                if cmf & 15 != 8 || flags & 32 != 0 || u16::from_be_bytes([cmf, flags]) % 31 != 0 {
                    return None;
                }
                std::borrow::Cow::Owned(
                    crate::commands::codecs::inflate_raw_bounded(payload, self.remaining_bytes)
                        .ok()?
                        .0,
                )
            }
            _ => return None,
        };
        self.remaining_bytes = self.remaining_bytes.checked_sub(bytes.len())?;
        Some(bytes)
    }

    fn stream_text(&mut self, id: ObjectId) -> Option<String> {
        content_text(&self.decoded_stream(id)?, &mut self.tokens)
    }
}

fn index(bytes: &[u8]) -> Option<(Objects<'_>, Value<'_>)> {
    let tail = bytes.get(bytes.len().saturating_sub(4096)..)?;
    let offset_pos = tail.windows(9).rposition(|w| w == b"startxref")? + 9;
    let offset = uint(Cursor(&tail[offset_pos..]).word()?)?;
    let mut c = Cursor(bytes.get(offset..)?);
    if c.word()? != b"xref" {
        return None;
    }
    let mut objects = Objects {
        bytes,
        xref: BTreeMap::new(),
        tokens: 1_000_000,
        remaining_bytes: crate::budget::ShellLimits::default().max_input_bytes,
    };
    loop {
        let first = c.word()?;
        if first == b"trailer" {
            break;
        }
        let first = uint(first)?;
        let count = uint(c.word()?)?;
        objects.tokens = objects.tokens.checked_sub(count)?;
        for id in first..first.checked_add(count)? {
            let pos = uint(c.word()?)?;
            let generation = uint(c.word()?)?;
            match c.word()? {
                b"n" => {
                    objects.xref.insert((id, generation), pos);
                }
                b"f" => {}
                _ => return None,
            }
        }
    }
    let trailer = c.value(0, &mut objects.tokens)?;
    if trailer.get(b"Encrypt").is_some() || trailer.get(b"Prev").is_some() {
        return None;
    }
    Some((objects, trailer))
}

pub(super) fn read(bytes: &[u8]) -> Option<PdfDoc> {
    let (mut objects, trailer) = index(bytes)?;
    let catalog = objects.object(trailer.get(b"Root")?.reference()?)?.0;
    let mut doc = PdfDoc::new();
    doc.version = std::str::from_utf8(bytes.strip_prefix(b"%PDF-")?.get(..3)?)
        .ok()?
        .to_string();
    if let Some(Value::Array(ids)) = trailer.get(b"ID") {
        for (id, target) in ids.iter().zip([&mut doc.pdf_id0, &mut doc.pdf_id1]) {
            if let Value::String(bytes) = id {
                *target = super::hex_enc(bytes);
            }
        }
    }
    if let Some(r) = trailer.get(b"Info").and_then(Value::reference)
        && let Value::Dict(info) = objects.object(r)?.0
    {
        for (k, v) in info {
            if let Value::String(b) = v {
                let value = text(&b);
                match k {
                    b"Title" => doc.title.clone_from(&value),
                    b"Author" => doc.author.clone_from(&value),
                    _ => {}
                }
                doc.info
                    .push((std::str::from_utf8(k).ok()?.to_string(), value));
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
            Some(Value::String(s)) => text(s),
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
    let mut pending = vec![(
        catalog.get(b"Pages")?.reference()?,
        [0.0, 0.0, 612.0, 792.0],
        None,
        0,
    )];
    let mut seen = BTreeSet::new();
    while let Some((id, mut media, mut crop, mut rotation)) = pending.pop() {
        if !seen.insert(id) {
            return None;
        }
        let node = objects.object(id)?.0;
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
                let Value::Array(kids) = node.get(b"Kids")? else {
                    return None;
                };
                for kid in kids.iter().rev() {
                    pending.push((kid.reference()?, media, crop, rotation));
                }
            }
            b"/Page" => {
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
                doc.page_media.insert(doc.pages.len(), (w, h, crop));
            }
            _ => return None,
        }
    }
    Some(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

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
