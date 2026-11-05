// OpenPGP v4 EdDSALegacy (RFC 9580): a primary signing key, one user ID and its
// positive self-certification. Reject other certificate structures as a unit.
use super::{ed25519_sign, ed25519_verify, sha1_bytes, sha256_bytes};

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

fn digest(input: &[u8], head: &[u8]) -> [u8; 32] {
    sha256_bytes(&[input, head, &[4, 255], &(head.len() as u32).to_be_bytes()].concat())
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
    let hash = digest(input, &body);
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

fn verify(body: &[u8], class: u8, fp: &[u8; 20], public: &[u8; 32], input: &[u8]) -> bool {
    let Some(time) = body.get(8..12).and_then(|b| b.try_into().ok()) else {
        return false;
    };
    let head = header(class, fp, u32::from_be_bytes(time));
    let Some(tail) = body
        .strip_prefix(head.as_slice())
        .and_then(|tail| tail.strip_prefix(&[0, 10, 9, 16]))
        .and_then(|tail| tail.strip_prefix(&fp[12..]))
    else {
        return false;
    };
    let hash = digest(input, &head);
    let Some(mut mpis) = tail.strip_prefix(&hash[..2]) else {
        return false;
    };
    let (Some(r), Some(s)) = (read_mpi(&mut mpis), read_mpi(&mut mpis)) else {
        return false;
    };
    let mut sig = [0; 64];
    sig[..32].copy_from_slice(&r);
    sig[32..].copy_from_slice(&s);
    mpis.is_empty() && ed25519_verify(&sig, &hash, public)
}

pub(super) struct Certificate<'a> {
    pub uid: &'a str,
    pub public: &'a [u8; 32],
    pub fingerprint: [u8; 20],
    pub bytes: &'a [u8],
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
    verify(
        signature,
        0x13,
        &fingerprint,
        public,
        &certification_input(body, uid.as_bytes()),
    )
    .then_some(Certificate {
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
) -> Option<u32> {
    let body = take_packet(&mut signature, 2)?;
    if !signature.is_empty() || !verify(body, 0, &cert.fingerprint, cert.public, input) {
        return None;
    }
    Some(u32::from_be_bytes(body.get(8..12)?.try_into().ok()?))
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
