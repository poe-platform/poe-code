use super::{SortKey, sort_record::{PAGE, Record}};
use crate::vfs::SafeBashFs;
use std::{borrow::Cow, cmp::Ordering, collections::BTreeSet, ops::Range};

type Result<T> = std::result::Result<T, String>;

struct View<'a> {
    record: &'a Record,
    start: usize,
    len: usize,
    page: Cow<'a, [u8]>,
    page_start: usize,
}

fn blank(byte: u8) -> bool { matches!(byte, b' ' | b'\t') }
fn space(byte: u8) -> bool { matches!(byte, b' ' | 9..=13) }

impl<'a> View<'a> {
    fn new(record: &'a Record) -> Self {
        Self { record, start: 0, len: record.len(), page: Cow::Borrowed(&[]), page_start: 0 }
    }

    fn range(&self, start: usize, end: usize) -> Self {
        let start = start.min(self.len);
        Self { record: self.record, start: self.start + start, len: end.min(self.len).saturating_sub(start),
            page: Cow::Borrowed(&[]), page_start: 0 }
    }

    fn at(&mut self, index: usize) -> Result<Option<u8>> {
        if index >= self.len { return Ok(None); }
        if let Record::Bytes(b) = self.record { return Ok(Some(b[self.start + index])); }
        if index < self.page_start || index - self.page_start >= self.page.len() {
            self.page = self.record.read(self.start + index, PAGE.min(self.len - index))?;
            self.page_start = index;
        }
        Ok(Some(self.page[index - self.page_start]))
    }

    fn skip(&mut self, mut index: usize, predicate: impl Fn(u8) -> bool) -> Result<usize> {
        while self.at(index)?.is_some_and(&predicate) { index += 1; }
        Ok(index)
    }

    fn cmp_bytes(&self, other: &Self) -> Result<Ordering> {
        let len = self.len.min(other.len);
        for i in (0..len).step_by(PAGE) {
            let size = PAGE.min(len - i);
            let order = self.record.read(self.start + i, size)?.cmp(&other.record.read(other.start + i, size)?);
            if !order.is_eq() { return Ok(order); }
        }
        Ok(self.len.cmp(&other.len))
    }

    fn key(mut self, key: Option<&SortKey>, separator: Option<u8>, blanks: bool) -> Result<Self> {
        let Some(key) = key else {
            let start = if blanks { self.skip(0, blank)? } else { 0 };
            return Ok(self.range(start, self.len));
        };
        let mut first = self.len..self.len;
        let mut last = self.len..self.len;
        let mut field = 1;
        let mut i = 0;
        while i < self.len || separator.is_some() && i == self.len {
            let start = i;
            i = if let Some(sep) = separator { self.skip(i, |b| b != sep)? }
                else { let word = self.skip(i, blank)?; self.skip(word, |b| !blank(b))? };
            if field == key.start { first = start..i; }
            if Some(field) == key.end { last = start..i; }
            if i == self.len || field >= key.start.max(key.end.unwrap_or(0)) { break; }
            if separator.is_some() { i += 1; }
            field += 1;
        }
        let inherited = key.flags.is_empty() && blanks;
        let start = if key.start_blanks || inherited { self.skip(first.start, blank)?.min(first.end) } else { first.start };
        let end = if key.end.is_none() { self.len } else if let Some(count) = key.end_character {
            let pos = if key.end_blanks || inherited { self.skip(last.start, blank)?.min(last.end) } else { last.start };
            pos.saturating_add(count)
        } else { last.end };
        Ok(self.range(start.saturating_add(key.start_character - 1), end))
    }

    fn transform(&self, flags: &BTreeSet<char>, fs: &dyn SafeBashFs, dir: &str, inline: usize) -> Result<Option<Record>> {
        let (fold, dict, print) = (flags.contains(&'f'), flags.contains(&'d'), flags.contains(&'i'));
        if !(fold || dict || print) { return Ok(None); }
        let mut record = Record::default();
        for i in (0..self.len).step_by(PAGE) {
            let data = self.record.read(self.start + i, PAGE.min(self.len - i))?;
            let bytes: Vec<_> = data.iter().copied().filter(|&b| {
                if dict { blank(b) || b.is_ascii_alphanumeric() } else { !print || (32..=126).contains(&b) }
            }).map(|b| if fold { b.to_ascii_uppercase() } else { b }).collect();
            record.append(&bytes, inline, fs, dir)?;
        }
        Ok(Some(record))
    }

    fn numeric(&mut self, human: bool) -> Result<Numeric> {
        let mut i = self.skip(0, blank)?;
        let negative = self.at(i)? == Some(b'-');
        i += usize::from(negative);
        let start = self.skip(i, |b| b == b'0')?;
        i = self.skip(start, |b| b.is_ascii_digit())?;
        let whole = start..i;
        let mut fraction = i..i;
        if self.at(i)? == Some(b'.') {
            i += 1;
            fraction = i..i;
            while let Some(byte @ b'0'..=b'9') = self.at(i)? {
                i += 1;
                if byte != b'0' { fraction.end = i; }
            }
        }
        let nonzero = !whole.is_empty() || !fraction.is_empty();
        let rank = if human && nonzero {
            self.at(i)?.and_then(|b| b"KMGTPEZYRQ".iter().position(|&c| c == if b == b'k' { b'K' } else { b })).map_or(0, |r| r + 1)
        } else { 0 };
        Ok(Numeric { negative: negative && nonzero, rank, whole, fraction })
    }

    fn exponent(&mut self, mut i: usize) -> Result<i64> {
        let sign = self.at(i)?;
        if matches!(sign, Some(b'+' | b'-')) { i += 1; }
        let mut value = 0i64;
        while let Some(b @ b'0'..=b'9') = self.at(i)? {
            value = value.saturating_mul(10).saturating_add(i64::from(b - b'0'));
            i += 1;
        }
        Ok(if sign == Some(b'-') { -value } else { value })
    }

    fn general(&mut self) -> Result<(u8, f64)> {
        let start = self.skip(0, space)?;
        let sign = self.at(start)?;
        let mut i = start + usize::from(matches!(sign, Some(b'-' | b'+')));
        let negative = sign == Some(b'-');
        let mut prefix = [0; 3];
        for (n, b) in prefix.iter_mut().enumerate() { *b = self.at(i + n)?.unwrap_or(0).to_ascii_lowercase(); }
        if &prefix == b"nan" { return Ok((1, 0.0)); }
        if &prefix == b"inf" { return Ok((2, if negative { f64::NEG_INFINITY } else { f64::INFINITY })); }
        if prefix.starts_with(b"0x") {
            i += 2;
            let (mut value, mut scale, mut fraction, mut any) = (0.0, 1.0, false, false);
            while let Some(b) = self.at(i)? {
                if b == b'.' && !fraction { fraction = true; i += 1; continue; }
                let Some(digit) = char::from(b).to_digit(16) else { break };
                any = true;
                if fraction { scale /= 16.0; value += f64::from(digit) * scale; } else { value = value * 16.0 + f64::from(digit); }
                i += 1;
            }
            if any {
                if value != 0.0 && matches!(self.at(i)?, Some(b'p' | b'P')) {
                    let pos = self.skip(i + 1, |b| space(b) || b == 160)?;
                    value *= 2.0f64.powf(self.exponent(pos)? as f64);
                }
                return Ok((2, if negative { -value } else { value }));
            }
        }
        // parseFloat accepts Latin-1 nonbreaking space; the hexadecimal and NaN grammar above does not.
        i = self.skip(start, |b| space(b) || b == 160)?;
        let sign = self.at(i)?;
        if matches!(sign, Some(b'-' | b'+')) { i += 1; }
        let mut infinity = true;
        for (n, b) in b"Infinity".iter().enumerate() { if self.at(i + n)? != Some(*b) { infinity = false; break; } }
        if infinity { return Ok((2, if sign == Some(b'-') { f64::NEG_INFINITY } else { f64::INFINITY })); }
        let (mut digits, mut whole, mut first, mut dot, mut sticky) = (0i64, 0i64, None, false, false);
        let mut mantissa = String::new();
        while let Some(b) = self.at(i)? {
            if b == b'.' && !dot { dot = true; i += 1; continue; }
            if !b.is_ascii_digit() { break; }
            if !dot { whole += 1; }
            if b != b'0' && first.is_none() { first = Some(digits); }
            if first.is_some() {
                if mantissa.len() < 800 { mantissa.push(char::from(b)); } else if b != b'0' { sticky = true; }
            }
            digits += 1; i += 1;
        }
        if digits == 0 { return Ok((0, 0.0)); }
        let Some(first) = first else { return Ok((2, 0.0)); };
        let mut power = whole - first - 1;
        if matches!(self.at(i)?, Some(b'e' | b'E')) { power = power.saturating_add(self.exponent(i + 1)?); }
        // All binary64 midpoints have fewer than 800 significant decimal digits.
        if sticky { mantissa.push('1'); }
        mantissa.insert(1, '.');
        let value: f64 = format!("{mantissa}e{power}").parse().map_err(|_| "EIO: invalid numeric sort value")?;
        Ok((2, if sign == Some(b'-') { -value } else { value }))
    }

    fn month(&mut self) -> Result<usize> {
        let start = self.skip(0, blank)?;
        let mut letters = [0; 3];
        for (i, b) in letters.iter_mut().enumerate() { *b = self.at(start + i)?.unwrap_or(0).to_ascii_uppercase(); }
        Ok(b"JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC".chunks_exact(3).position(|m| m == letters).map_or(0, |n| n + 1))
    }

    fn version_prefix(&mut self) -> Result<Self> {
        let mut end = self.len;
        let mut want_letter = false;
        for i in usize::from(self.at(0)? == Some(b'.'))..self.len {
            let b = self.at(i)?.unwrap();
            let letter = b == b'~' || b.is_ascii_alphabetic();
            if want_letter { want_letter = false; if !letter { end = self.len; } }
            else if b == b'.' { want_letter = true; if end == self.len { end = i; } }
            else if !letter && !b.is_ascii_digit() { end = self.len; }
        }
        Ok(self.range(0, if want_letter { self.len } else { end }))
    }

    fn version_rank(&mut self) -> Result<u8> {
        Ok(if self.len == 0 { 0 } else if self.at(0)? != Some(b'.') { 4 } else if self.len == 1 { 1 }
            else if self.len == 2 && self.at(1)? == Some(b'.') { 2 } else { 3 })
    }
}

struct Numeric { negative: bool, rank: usize, whole: Range<usize>, fraction: Range<usize> }

fn numeric_cmp(a: &mut View, b: &mut View, human: bool) -> Result<Ordering> {
    let x = a.numeric(human)?;
    let y = b.numeric(human)?;
    if x.negative != y.negative { return Ok(y.negative.cmp(&x.negative)); }
    let mut order = x.rank.cmp(&y.rank).then_with(|| x.whole.len().max(1).cmp(&y.whole.len().max(1)));
    for (left, right) in [(x.whole, y.whole), (x.fraction, y.fraction)] {
        if !order.is_eq() { break; }
        for i in 0..left.len().max(right.len()) {
            let p = if i < left.len() { a.at(left.start + i)?.unwrap() } else { b'0' };
            let q = if i < right.len() { b.at(right.start + i)?.unwrap() } else { b'0' };
            order = p.cmp(&q);
            if !order.is_eq() { break; }
        }
    }
    Ok(if x.negative { order.reverse() } else { order })
}

fn version_parts(a: &mut View, b: &mut View) -> Result<Ordering> {
    let (mut i, mut j) = (0, 0);
    let order = |c| match c { Some(b'~') => -1, None | Some(b'0'..=b'9') => 0,
        Some(c) if c.is_ascii_alphabetic() => i32::from(c), Some(c) => i32::from(c) + 256 };
    while i < a.len || j < b.len {
        while a.at(i)?.is_some_and(|c| !c.is_ascii_digit()) || b.at(j)?.is_some_and(|c| !c.is_ascii_digit()) {
            let cmp = order(a.at(i)?).cmp(&order(b.at(j)?));
            if !cmp.is_eq() { return Ok(cmp); }
            i += usize::from(i < a.len); j += usize::from(j < b.len);
        }
        i = a.skip(i, |b| b == b'0')?;
        j = b.skip(j, |b| b == b'0')?;
        let mut cmp = Ordering::Equal;
        while let (Some(x @ b'0'..=b'9'), Some(y @ b'0'..=b'9')) = (a.at(i)?, b.at(j)?) {
            cmp = cmp.then_with(|| x.cmp(&y)); i += 1; j += 1;
        }
        if a.at(i)?.is_some_and(|c| c.is_ascii_digit()) { return Ok(Ordering::Greater); }
        if b.at(j)?.is_some_and(|c| c.is_ascii_digit()) { return Ok(Ordering::Less); }
        if !cmp.is_eq() { return Ok(cmp); }
    }
    Ok(Ordering::Equal)
}

pub(super) struct KeyOrder<'a> {
    pub keys: &'a [SortKey],
    pub flags: &'a BTreeSet<char>,
    pub separator: Option<u8>,
    pub fs: &'a dyn SafeBashFs,
    pub directory: &'a str,
    pub record_limit: usize,
}

impl KeyOrder<'_> {
    pub fn compare(&self, left: &Record, right: &Record) -> Result<Ordering> {
        for key in (0..self.keys.len().max(1)).map(|i| self.keys.get(i)) {
            let flags = key.filter(|k| !k.flags.is_empty()).map_or(self.flags, |k| &k.flags);
            let a = View::new(left).key(key, self.separator, flags.contains(&'b'))?;
            let b = View::new(right).key(key, self.separator, flags.contains(&'b'))?;
            let inline = if left.len().max(right.len()) <= self.record_limit { PAGE } else { PAGE - 8 };
            let x = a.transform(flags, self.fs, self.directory, inline)?;
            let y = b.transform(flags, self.fs, self.directory, inline)?;
            let mut a = x.as_ref().map(View::new).unwrap_or(a);
            let mut b = y.as_ref().map(View::new).unwrap_or(b);
            let ord = if flags.contains(&'g') {
                let x = a.general()?; let y = b.general()?;
                x.0.cmp(&y.0).then_with(|| x.1.partial_cmp(&y.1).unwrap_or(Ordering::Equal))
            } else if flags.contains(&'M') { a.month()?.cmp(&b.month()?) }
            else if flags.contains(&'V') {
                let mut cmp = a.version_rank()?.cmp(&b.version_rank()?);
                if cmp.is_eq() { cmp = version_parts(&mut a.version_prefix()?, &mut b.version_prefix()?)?; }
                if cmp.is_eq() { cmp = version_parts(&mut a, &mut b)?; }
                cmp
            } else if flags.contains(&'n') || flags.contains(&'h') { numeric_cmp(&mut a, &mut b, flags.contains(&'h'))? }
            else { a.cmp_bytes(&b)? };
            if !ord.is_eq() { return Ok(if flags.contains(&'r') { ord.reverse() } else { ord }); }
        }
        Ok(Ordering::Equal)
    }
}
