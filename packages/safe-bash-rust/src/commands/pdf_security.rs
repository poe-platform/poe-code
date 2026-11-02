// Standard security handler (ISO 32000-1, 7.6.3, algorithms 1–5).
use super::{Cursor, ObjectId, Objects, Value, strict_index, uint};
use crate::commands::archive::md5_bytes;
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
};
#[path = "pdf_aes.rs"]
pub(super) mod pdf_aes;

#[derive(Clone, Copy, PartialEq)]
enum Cipher {
    Identity,
    Rc4,
    Aes128,
    Aes256,
}

const PAD: [u8; 32] = [
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
];
pub(in crate::commands::archive) const PASSWORD: &str = "Invalid PDF password";
pub(in crate::commands::archive) const UNSUPPORTED: &str = "unsupported PDF encryption";

pub(super) struct Security {
    key: Vec<u8>,
    revision: usize,
    version: usize,
    permissions: i32,
    plaintext: BTreeSet<ObjectId>,
    strings: Cipher,
    streams: Cipher,
    embedded: Cipher,
    metadata: bool,
    filters: BTreeMap<Vec<u8>, Cipher>,
}
fn rc4(key: &[u8], data: &mut [u8], round: u8) {
    let mut state: [u8; 256] = std::array::from_fn(|i| i as u8);
    let mut j = 0u8;
    for i in 0..256 {
        j = j
            .wrapping_add(state[i])
            .wrapping_add(key[i % key.len()] ^ round);
        state.swap(i, j as usize);
    }
    let (mut x, mut y) = (0u8, 0u8);
    for b in data {
        x = x.wrapping_add(1);
        y = y.wrapping_add(state[x as usize]);
        state.swap(x as usize, y as usize);
        *b ^= state[state[x as usize].wrapping_add(state[y as usize]) as usize];
    }
}
impl Cipher {
    fn decrypt(self, key: &[u8], bytes: &mut Vec<u8>) {
        match self {
            Self::Identity => (),
            Self::Rc4 => rc4(key, bytes, 0),
            Self::Aes128 | Self::Aes256 => pdf_aes::decrypt(key, bytes),
        }
    }
}
impl Security {
    pub(super) fn description(&self) -> String {
        let allowed = |bit| {
            if self.permissions & bit != 0 {
                "allowed"
            } else {
                "not allowed"
            }
        };
        format!(
            "R = {}\nV = {}\nLength = {}\nprint: {}\nmodify: {}\nextract for accessibility: {}\n",
            self.revision,
            self.version,
            self.key.len() * 8,
            allowed(4),
            allowed(8),
            allowed(16)
        )
    }
    fn object_key(&self, id: ObjectId, method: Cipher) -> Vec<u8> {
        if method == Cipher::Aes256 {
            return self.key.clone();
        }
        let mut k = self.key.clone();
        k.extend_from_slice(&id.0.to_le_bytes()[..3]);
        k.extend_from_slice(&id.1.to_le_bytes()[..2]);
        if method == Cipher::Aes128 {
            k.extend_from_slice(b"sAlT");
        }
        md5_bytes(&k)[..(self.key.len() + 5).min(16)].to_vec()
    }
    fn excluded(&self, id: ObjectId, v: &Value<'_>) -> bool {
        self.plaintext.contains(&id)
            || match v.get(b"Type").and_then(Value::word) {
                Some(b"/XRef") => true,
                Some(b"/Metadata") => !self.metadata,
                _ => false,
            }
    }
    pub(super) fn strings(&self, id: ObjectId, v: &mut Value<'_>) {
        if self.excluded(id, v) {
            return;
        }
        let key = self.object_key(id, self.strings);
        let Ok(()) = transform_strings(v, &mut |bytes| {
            self.strings.decrypt(&key, bytes);
            Ok::<_, std::convert::Infallible>(())
        });
    }
}
pub(super) fn transform_strings<E>(
    v: &mut Value<'_>,
    transform: &mut impl FnMut(&mut Vec<u8>) -> Result<(), E>,
) -> Result<(), E> {
    let signature = [b"Type".as_slice(), b"FT"]
        .iter()
        .any(|k| v.get(k).and_then(Value::word) == Some(b"/Sig"))
        || matches!(v.get(b"ByteRange"), Some(Value::Array(_)))
            && v.get(b"Filter")
                .and_then(Value::word)
                .is_some_and(|w| w.starts_with(b"/"));
    match v {
        Value::String { bytes, hex } => {
            transform(bytes)?;
            *hex = true;
        }
        Value::Array(a) => {
            for x in a {
                transform_strings(x, transform)?
            }
        }
        Value::Dict(d) => {
            for (k, x) in d {
                if !signature || k.as_ref() != b"Contents" {
                    transform_strings(x, transform)?
                }
            }
        }
        _ => {}
    }
    Ok(())
}
impl<'a> Objects<'a> {
    fn resolve_encryption(
        &mut self,
        v: Value<'a>,
        plain: &mut BTreeSet<ObjectId>,
        depth: usize,
    ) -> Option<Value<'a>> {
        if depth > 64 {
            return None;
        }
        self.tokens = self.tokens.checked_sub(1)?;
        match v {
            Value::Ref(id) => {
                plain.insert(id);
                let (v, _) = self.object(id)?;
                self.resolve_encryption(v, plain, depth + 1)
            }
            Value::Dict(mut d) => {
                for (_, v) in &mut d {
                    *v = self.resolve_encryption(
                        std::mem::replace(v, Value::Word(b"null".into())),
                        plain,
                        depth + 1,
                    )?;
                }
                Some(Value::Dict(d))
            }
            Value::Array(a) => Some(Value::Array(
                a.into_iter()
                    .map(|v| self.resolve_encryption(v, plain, depth + 1))
                    .collect::<Option<_>>()?,
            )),
            v @ Value::String { .. } => {
                if let Value::String { bytes, .. } = &v {
                    self.remaining_bytes = self.remaining_bytes.checked_sub(bytes.len())?;
                }
                Some(v)
            }
            v => Some(v),
        }
    }
    pub(super) fn authenticate(
        &mut self,
        trailer: &Value<'a>,
        pw: &str,
    ) -> Result<(), &'static str> {
        let Some(enc) = trailer.get(b"Encrypt") else {
            return Ok(());
        };
        let mut plain = BTreeSet::new();
        let dict = self
            .resolve_encryption(enc.clone(), &mut plain, 0)
            .ok_or(UNSUPPORTED)?;
        let num = |k: &[u8]| uint(dict.get(k)?.word()?);
        let v = num(b"V").ok_or(UNSUPPORTED)?;
        let r = num(b"R").ok_or(UNSUPPORTED)?;
        if dict.get(b"Filter").and_then(Value::word) != Some(b"/Standard")
            || !matches!((v, r), (1 | 2, 2 | 3) | (4, 4) | (5, 5 | 6))
        {
            return Err(UNSUPPORTED);
        }
        let mut filters = BTreeMap::new();
        if let Some(Value::Dict(entries)) = dict.get(b"CF") {
            for (name, params) in entries {
                let method = match params.get(b"CFM").and_then(Value::word) {
                    None | Some(b"/None") => Cipher::Identity,
                    Some(b"/AESV3") if v == 5 => Cipher::Aes256,
                    Some(b"/AESV2") if v == 4 => Cipher::Aes128,
                    Some(b"/V2") if v == 4 => Cipher::Rc4,
                    _ => return Err(UNSUPPORTED),
                };
                filters.insert(name.to_vec(), method);
            }
        }
        let named = |name: &[u8]| {
            dict.get(name)
                .and_then(Value::word)
                .and_then(|w| w.strip_prefix(b"/"))
        };
        let select = |name: Option<&[u8]>| {
            if v < 4 {
                Cipher::Rc4
            } else {
                name.and_then(|k| filters.get(k))
                    .copied()
                    .unwrap_or(Cipher::Identity)
            }
        };
        let strings = select(named(b"StrF"));
        let streams = select(named(b"StmF"));
        let embedded = select(named(b"EFF").or(named(b"StmF")));
        let metadata =
            v < 4 || dict.get(b"EncryptMetadata").and_then(Value::word) != Some(b"false");
        let p = std::str::from_utf8(dict.get(b"P").and_then(Value::word).ok_or(UNSUPPORTED)?)
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .map(|bits| bits as i32)
            .ok_or(UNSUPPORTED)?;
        let mut key = if v == 5 {
            pdf_aes::file_key(&dict, pw, r).ok_or(PASSWORD)?
        } else {
            let bits = num(b"Length")
                .or_else(|| {
                    let n = uint(
                        dict.get(b"CF")?
                            .get(named(b"StmF")?)?
                            .get(b"Length")?
                            .word()?,
                    )?;
                    Some(if n < 40 { n * 8 } else { n })
                })
                .unwrap_or(if v == 4 { 128 } else { 40 });
            if !(40..=128).contains(&bits) || bits % 8 != 0 {
                return Err(UNSUPPORTED);
            }
            let n = bits / 8;
            let string = |k: &[u8]| match dict.get(k)? {
                Value::String { bytes, .. } => bytes.get(..32),
                _ => None,
            };
            let owner = string(b"O").ok_or(UNSUPPORTED)?;
            let user = string(b"U").ok_or(UNSUPPORTED)?;
            let id = match trailer.get(b"ID") {
                Some(Value::Array(a)) => match a.first() {
                    Some(Value::String { bytes, .. }) => bytes.as_slice(),
                    _ => &[0; 16],
                },
                _ => &[0; 16],
            };
            let mut padded: Vec<_> = pw.encode_utf16().take(32).map(|c| c as u8).collect();
            padded.extend_from_slice(&PAD[..32 - padded.len()]);
            let derive = |password: &[u8]| {
                let tail = if r == 4 && !metadata {
                    &[255; 4][..]
                } else {
                    &[]
                };
                let mut hash = md5_bytes(&[password, owner, &p.to_le_bytes(), id, tail].concat());
                if r >= 3 {
                    for _ in 0..50 {
                        hash = md5_bytes(&hash[..n]);
                    }
                }
                let key = &hash[..n];
                let mut check = if r == 2 {
                    PAD.to_vec()
                } else {
                    md5_bytes(&[PAD.as_slice(), id].concat()).to_vec()
                };
                for round in 0..if r == 2 { 1 } else { 20 } {
                    rc4(key, &mut check, round);
                }
                user.starts_with(&check).then(|| key.to_vec())
            };
            derive(&padded)
                .or_else(|| {
                    if pw.is_empty() {
                        return None;
                    }
                    let mut hash = md5_bytes(&padded);
                    if r >= 3 {
                        for _ in 0..50 {
                            hash = md5_bytes(&hash);
                        }
                    }
                    let mut recovered = owner.to_vec();
                    for round in (0..if r == 2 { 1 } else { 20 }).rev() {
                        rc4(&hash[..n], &mut recovered, round);
                    }
                    derive(&recovered)
                })
                .ok_or(PASSWORD)?
        };
        // PDF.js authenticates with the declared length, then zero-pads V4
        // file keys to 128 bits before deriving object keys (issue 19484).
        if v == 4 {
            key.resize(16, 0);
        }
        self.security = Some(Security {
            key,
            revision: r,
            version: v,
            permissions: p,
            plaintext: plain,
            strings,
            streams,
            embedded,
            metadata,
            filters,
        });
        Ok(())
    }

    pub(super) fn raw_stream(
        &mut self,
        id: ObjectId,
        dict: &mut Value<'a>,
        cursor: Cursor<'a>,
    ) -> Option<Cow<'a, [u8]>> {
        let mut bytes = Cow::Borrowed(self.stream(dict, cursor)?);
        let Some(security) = &self.security else {
            return Some(bytes);
        };
        if security.plaintext.contains(&id) {
            return Some(bytes);
        }
        let ty = match dict.get(b"Type") {
            Some(v) => Some(self.filter_value(v.clone())?),
            None => None,
        };
        let security = self.security.as_ref()?;
        let ty = ty.as_ref().and_then(Value::word);
        if ty == Some(b"/XRef") || ty == Some(b"/Metadata") && !security.metadata {
            return Some(bytes);
        }
        let default = if ty == Some(b"/EmbeddedFile") {
            security.embedded
        } else {
            security.streams
        };
        let decrypt =
            |method: Cipher, data: &mut Cow<'a, [u8]>, objects: &mut Self| -> Option<()> {
                if method != Cipher::Identity {
                    objects.remaining_bytes = objects.remaining_bytes.checked_sub(data.len())?;
                    method.decrypt(
                        &objects.security.as_ref()?.object_key(id, method),
                        data.to_mut(),
                    );
                }
                Some(())
            };
        let mut filters = match dict.get(b"Filter").or_else(|| dict.get(b"F")) {
            Some(v) => match self.filter_value(v.clone())? {
                Value::Array(a) => a
                    .into_iter()
                    .map(|v| self.filter_value(v))
                    .collect::<Option<Vec<_>>>()?,
                v => vec![v],
            },
            None => Vec::new(),
        };
        if let Some(last) = filters.iter().rposition(|v| v.word() == Some(b"/Crypt")) {
            let params = match dict.get(b"DecodeParms").or_else(|| dict.get(b"DP")) {
                Some(v) => Some(self.filter_value(v.clone())?),
                None => None,
            };
            for (index, filter) in filters.drain(..=last).enumerate() {
                let name = filter.word()?.strip_prefix(b"/")?;
                let param = match &params {
                    Some(Value::Array(a)) => a.get(index),
                    other => other.as_ref(),
                };
                if name == b"Crypt" {
                    let param = match param {
                        Some(v) => Some(self.filter_value(v.clone())?),
                        None => None,
                    };
                    let key = match param.as_ref().and_then(|v| v.get(b"Name")) {
                        Some(v) => Some(self.filter_value(v.clone())?),
                        None => None,
                    };
                    let method = key
                        .as_ref()
                        .and_then(Value::word)
                        .and_then(|w| w.strip_prefix(b"/"))
                        .and_then(|n| self.security.as_ref()?.filters.get(n))
                        .copied()
                        .unwrap_or(Cipher::Identity);
                    decrypt(method, &mut bytes, self)?;
                } else {
                    let mut single = vec![(b"Filter".as_slice().into(), filter)];
                    if let Some(v) = param {
                        single.push((b"DecodeParms".into(), v.clone()));
                    }
                    bytes = self.decode(&Value::Dict(single), bytes)?;
                }
            }
            let Value::Dict(entries) = dict else {
                return None;
            };
            entries
                .retain(|(k, _)| !matches!(k.as_ref(), b"F" | b"Filter" | b"DP" | b"DecodeParms"));
            if !filters.is_empty() {
                if !filters
                    .iter()
                    .all(|v| v.word().is_some_and(|w| w.starts_with(b"/")))
                {
                    return None;
                }
                entries.push((b"Filter".into(), Value::Array(filters)));
                match params {
                    Some(Value::Array(a)) => entries.push((
                        b"DecodeParms".into(),
                        Value::Array(a.into_iter().skip(last + 1).collect()),
                    )),
                    Some(v @ Value::Dict(_)) => entries.push((b"DecodeParms".into(), v)),
                    _ => (),
                }
            }
        } else {
            decrypt(default, &mut bytes, self)?;
        }
        if dict.get(b"Length").is_some() {
            dict.set_stream_length(bytes.len())?;
        }
        Some(bytes)
    }
}
pub(in crate::commands::archive) fn accepts_password(bytes: &[u8], pw: &str) -> Option<()> {
    super::header_version(bytes)?;
    let (mut objects, trailer) = strict_index(bytes)?;
    trailer.get(b"Root")?.reference()?;
    objects.authenticate(&trailer, pw).ok()?;
    for id in objects.xref.keys().copied().collect::<Vec<_>>() {
        let (mut v, mut c) = objects.object(id)?;
        c.skip();
        if c.0.starts_with(b"stream") {
            objects.raw_stream(id, &mut v, c)?;
        }
    }
    Some(())
}
