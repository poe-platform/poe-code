// OpenPGP v4 EdDSALegacy (RFC 9580): a primary signing key, one user ID and its
// positive self-certification. Reject other certificate structures as a unit.
use super::{ed25519_sign, ed25519_verify, sha1_bytes, sha256_bytes, sha384_bytes, sha512_bytes};

const CURVE: &[u8] = &[22, 9, 0x2b, 6, 1, 4, 1, 0xda, 0x47, 0x0f, 1, 1, 7, 0x40];

fn packet(out: &mut Vec<u8>, tag: u8, body: &[u8]) {
    out.push(0xc0 | tag);
    if body.len() < 192 {
        out.push(body.len() as u8);
    } else {
        out.push(255);
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    }
    out.extend_from_slice(body);
}

fn take_packet<'a>(rest: &mut &'a [u8], tag: u8) -> Option<&'a [u8]> {
    let (&ctb, tail) = rest.split_first()?;
    let (len, tail) = if ctb == 0xc0 | tag {
        let (&first, tail) = tail.split_first()?;
        match first {
            0..=191 => (first as usize, tail),
            192..=223 => (
                ((first as usize - 192) << 8) + *tail.first()? as usize + 192,
                &tail[1..],
            ),
            255 => (
                u32::from_be_bytes(tail.get(..4)?.try_into().ok()?) as usize,
                &tail[4..],
            ),
            _ => return None,
        }
    } else if ctb & 0xfc == 0x80 | tag << 2 && ctb & 3 != 3 {
        let (len, tail) = tail.split_at_checked(1 << (ctb & 3))?;
        (len.iter().fold(0usize, |n, b| n << 8 | *b as usize), tail)
    } else {
        return None;
    };
    let (body, remaining) = tail.split_at_checked(len)?;
    *rest = remaining;
    Some(body)
}

fn key_body(public: &[u8; 32], time: u32) -> Vec<u8> {
    [&[4], &time.to_be_bytes()[..], CURVE, public].concat()
}

fn key_hash_input(body: &[u8]) -> Vec<u8> {
    [&[0x99], &(body.len() as u16).to_be_bytes()[..], body].concat()
}

fn certification_input(body: &[u8], uid: &[u8]) -> Vec<u8> {
    let mut out = key_hash_input(body);
    out.push(0xb4);
    out.extend_from_slice(&(uid.len() as u32).to_be_bytes());
    out.extend_from_slice(uid);
    out
}

fn header(class: u8, fp: &[u8; 20], time: u32) -> Vec<u8> {
    let mut hashed = vec![5, 2];
    hashed.extend_from_slice(&time.to_be_bytes());
    hashed.extend_from_slice(&[22, 33, 4]);
    hashed.extend_from_slice(fp);
    if class == 0x13 {
        hashed.extend_from_slice(&[2, 27, 3]); // certify and sign
    }
    [
        &[4, class, 22, 8],
        &(hashed.len() as u16).to_be_bytes()[..],
        &hashed,
    ]
    .concat()
}

fn digest(input: &[u8], head: &[u8]) -> Option<Vec<u8>> {
    let signed = [input, head, &[4, 255], &(head.len() as u32).to_be_bytes()].concat();
    Some(match head[3] {
        8 => sha256_bytes(&signed).to_vec(),
        9 => sha384_bytes(&signed).to_vec(),
        10 => sha512_bytes(&signed).to_vec(),
        _ => return None,
    })
}

fn put_mpi(out: &mut Vec<u8>, bytes: &[u8]) {
    let bytes = &bytes[bytes.iter().take_while(|&&b| b == 0).count()..];
    let bits = bytes.len() * 8 - bytes.first().map_or(0, |b| b.leading_zeros() as usize);
    out.extend_from_slice(&(bits as u16).to_be_bytes());
    out.extend_from_slice(bytes);
}

fn read_mpi(rest: &mut &[u8]) -> Option<[u8; 32]> {
    let (bits, tail) = rest.split_at_checked(2)?;
    let bits = u16::from_be_bytes(bits.try_into().ok()?) as usize;
    let (bytes, tail) = tail.split_at_checked(bits.div_ceil(8))?;
    if bytes.len() > 32
        || bytes.len() * 8 - bytes.first().map_or(0, |b| b.leading_zeros() as usize) != bits
    {
        return None;
    }
    let mut out = [0; 32];
    out[32 - bytes.len()..].copy_from_slice(bytes);
    *rest = tail;
    Some(out)
}

pub(super) fn sign(class: u8, fp: &[u8; 20], time: u32, seed: &[u8; 32], input: &[u8]) -> Vec<u8> {
    let mut body = header(class, fp, time);
    let hash = digest(input, &body).expect("signature header specifies SHA-256");
    let sig = ed25519_sign(&hash, seed);
    body.extend_from_slice(&[0, 10, 9, 16]);
    body.extend_from_slice(&fp[12..]);
    body.extend_from_slice(&hash[..2]);
    put_mpi(&mut body, &sig[..32]);
    put_mpi(&mut body, &sig[32..]);
    let mut packet_bytes = Vec::new();
    packet(&mut packet_bytes, 2, &body);
    packet_bytes
}

pub(super) fn certify(
    uid: &str,
    public: &[u8; 32],
    seed: &[u8; 32],
    time: u32,
) -> ([u8; 20], Vec<u8>) {
    let body = key_body(public, time);
    let fp = sha1_bytes(&key_hash_input(&body));
    let mut out = Vec::new();
    packet(&mut out, 6, &body);
    packet(&mut out, 13, uid.as_bytes());
    out.extend(sign(
        0x13,
        &fp,
        time,
        seed,
        &certification_input(&body, uid.as_bytes()),
    ));
    (fp, out)
}

pub(super) struct Verified {
    pub time: u32,
    pub hash: u8,
    key_lifetime: u32,
}

fn verify(
    body: &[u8],
    class: u8,
    fp: &[u8; 20],
    public: &[u8; 32],
    input: &[u8],
) -> Option<Verified> {
    if body.get(..3)? != [4, class, 22] {
        return None;
    }
    let len = u16::from_be_bytes(body.get(4..6)?.try_into().ok()?) as usize;
    let (head, tail) = body.split_at_checked(6 + len)?;
    let mut subs = &head[6..];
    let (mut time, mut lifetime, mut issuer, mut flags) = (None, None, false, false);
    while let Some((&first, after)) = subs.split_first() {
        let (len, after) = match first {
            0..=191 => (first as usize, after),
            192..=254 => (
                ((first as usize - 192) << 8) + *after.first()? as usize + 192,
                &after[1..],
            ),
            255 => (
                u32::from_be_bytes(after.get(..4)?.try_into().ok()?) as usize,
                &after[4..],
            ),
        };
        let (sub, rest) = after.split_at_checked(len)?;
        let (&tag, data) = sub.split_first()?;
        match tag & 127 {
            2 if time.is_none() => time = Some(u32::from_be_bytes(data.try_into().ok()?)),
            33 if !issuer && data.strip_prefix(&[4])? == fp => issuer = true,
            27 if class == 0x13 && !flags && data.first()? & 2 != 0 => flags = true,
            9 if class == 0x13 && lifetime.is_none() => {
                lifetime = Some(u32::from_be_bytes(data.try_into().ok()?))
            }
            // Algorithm preferences, keyserver preferences and advertised features
            // affect encryption/transport, not this primary key's signing authority.
            11 | 21 | 22 | 23 | 30 | 34 if class == 0x13 && tag < 128 => (),
            28 if class == 0 && tag < 128 => (), // signer hint; identity comes from the certificate
            _ => return None,
        }
        subs = rest;
    }
    if !issuer || (class == 0x13 && !flags) {
        return None;
    }
    let tail = tail
        .strip_prefix(&[0, 10, 9, 16])?
        .strip_prefix(&fp[12..])?;
    let hash = digest(input, head)?;
    let mut mpis = tail.strip_prefix(&hash[..2])?;
    let mut sig = [0; 64];
    sig[..32].copy_from_slice(&read_mpi(&mut mpis)?);
    sig[32..].copy_from_slice(&read_mpi(&mut mpis)?);
    (mpis.is_empty() && ed25519_verify(&sig, &hash, public)).then_some(Verified {
        time: time?,
        hash: head[3],
        key_lifetime: lifetime.unwrap_or(0),
    })
}

pub(super) struct Certificate<'a> {
    pub uid: &'a str,
    pub public: &'a [u8; 32],
    pub fingerprint: [u8; 20],
    pub bytes: &'a [u8],
    pub created: u32,
    pub expires: Option<u64>,
}

pub(super) fn read_certificate<'a>(rest: &mut &'a [u8]) -> Option<Certificate<'a>> {
    let start = *rest;
    let body = take_packet(rest, 6)?;
    if body.first() != Some(&4) {
        return None;
    }
    let public = body.get(5..)?.strip_prefix(CURVE)?.try_into().ok()?;
    let uid = std::str::from_utf8(take_packet(rest, 13)?).ok()?;
    let signature = take_packet(rest, 2)?;
    let fingerprint = sha1_bytes(&key_hash_input(body));
    let binding = verify(
        signature,
        0x13,
        &fingerprint,
        public,
        &certification_input(body, uid.as_bytes()),
    )?;
    let created = u32::from_be_bytes(body.get(1..5)?.try_into().ok()?);
    if binding.time < created {
        return None;
    }
    Some(Certificate {
        created,
        expires: (binding.key_lifetime != 0)
            .then_some(u64::from(created) + u64::from(binding.key_lifetime)),
        uid,
        public,
        fingerprint,
        bytes: &start[..start.len() - rest.len()],
    })
}

pub(super) fn verify_message(
    mut signature: &[u8],
    cert: &Certificate<'_>,
    input: &[u8],
) -> Option<Verified> {
    let body = take_packet(&mut signature, 2)?;
    if !signature.is_empty() {
        return None;
    }
    let signed = verify(body, 0, &cert.fingerprint, cert.public, input)?;
    (signed.time >= cert.created).then_some(signed)
}

#[cfg(test)]
mod tests {
    #[test]
    fn identity_is_not_an_ed25519_signer() {
        let mut public = [0; 32];
        public[0] = 1;
        let mut signature = [0; 64];
        signature[0] = 1;
        assert!(!super::ed25519_verify(&signature, b"unsigned", &public));
    }
}
