// Standard security handler (ISO 32000-1, 7.6.3, algorithms 1–5).
use super::{Cursor, ObjectId, Objects, Value, strict_index, uint};
use crate::commands::archive::md5_bytes;
use std::{borrow::Cow, collections::BTreeSet};

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
    fn object_key(&self, id: ObjectId) -> Vec<u8> {
        let mut k = self.key.clone();
        k.extend_from_slice(&id.0.to_le_bytes()[..3]);
        k.extend_from_slice(&id.1.to_le_bytes()[..2]);
        md5_bytes(&k)[..k.len().min(16)].to_vec()
    }
    pub(super) fn strings(&self, id: ObjectId, v: &mut Value<'_>) {
        if self.plaintext.contains(&id) || v.get(b"Type").and_then(Value::word) == Some(b"/XRef") {
            return;
        }
        fn visit(v: &mut Value<'_>, key: &[u8]) {
            let signature = [b"Type".as_slice(), b"FT"]
                .iter()
                .any(|k| v.get(k).and_then(Value::word) == Some(b"/Sig"))
                || matches!(v.get(b"ByteRange"), Some(Value::Array(_)))
                    && v.get(b"Filter")
                        .and_then(Value::word)
                        .is_some_and(|w| w.starts_with(b"/"));
            match v {
                Value::String { bytes, hex } => {
                    rc4(key, bytes, 0);
                    *hex = true;
                }
                Value::Array(a) => {
                    for x in a {
                        visit(x, key)
                    }
                }
                Value::Dict(d) => {
                    for (k, x) in d {
                        if !signature || k.as_ref() != b"Contents" {
                            visit(x, key)
                        }
                    }
                }
                _ => {}
            }
        }
        visit(v, &self.object_key(id));
    }
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
            || !matches!((v, r), (1 | 2, 2 | 3))
        {
            return Err(UNSUPPORTED);
        }
        let bits = num(b"Length").unwrap_or(40);
        if !(40..=128).contains(&bits) || bits % 8 != 0 {
            return Err(UNSUPPORTED);
        }
        let n = bits / 8;
        let p = std::str::from_utf8(dict.get(b"P").and_then(Value::word).ok_or(UNSUPPORTED)?)
            .ok()
            .and_then(|s| s.parse::<i32>().ok())
            .ok_or(UNSUPPORTED)?;
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
            let mut hash = md5_bytes(&[password, owner, &p.to_le_bytes(), id].concat());
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
        let key = derive(&padded)
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
            .ok_or(PASSWORD)?;
        self.security = Some(Security {
            key,
            revision: r,
            version: v,
            permissions: p,
            plaintext: plain,
        });
        Ok(())
    }

    pub(super) fn raw_stream(
        &mut self,
        id: ObjectId,
        dict: &Value<'_>,
        cursor: Cursor<'a>,
    ) -> Option<Cow<'a, [u8]>> {
        let bytes = self.stream(dict, cursor)?;
        if let Some(s) = &self.security
            && !s.plaintext.contains(&id)
            && dict.get(b"Type").and_then(Value::word) != Some(b"/XRef")
        {
            self.remaining_bytes = self.remaining_bytes.checked_sub(bytes.len())?;
            let mut data = bytes.to_vec();
            rc4(&s.object_key(id), &mut data, 0);
            Some(Cow::Owned(data))
        } else {
            Some(Cow::Borrowed(bytes))
        }
    }
}
pub(in crate::commands::archive) fn accepts_password(bytes: &[u8], pw: &str) -> Option<()> {
    super::header_version(bytes)?;
    let (mut objects, trailer) = strict_index(bytes)?;
    trailer.get(b"Root")?.reference()?;
    objects.authenticate(&trailer, pw).ok()?;
    for id in objects.xref.keys().copied().collect::<Vec<_>>() {
        let (v, mut c) = objects.object(id)?;
        c.skip();
        if c.0.starts_with(b"stream") {
            objects.raw_stream(id, &v, c)?;
        }
    }
    Some(())
}
