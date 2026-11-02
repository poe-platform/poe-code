// ISO 32000-2 algorithms 2.A/2.B: validate the password, then unwrap the file key.
use super::Value;
use crate::commands::archive::{
    aes_decrypt_block, aes_encrypt_block, aes_expand_key, sha256_bytes, sha384_bytes, sha512_bytes,
};

fn decrypt_blocks(key: &[u8], mut iv: [u8; 16], bytes: &mut [u8]) {
    let (rounds, n) = aes_expand_key(key);
    for chunk in bytes.chunks_exact_mut(16) {
        let block: [u8; 16] = chunk[..].try_into().unwrap();
        let plain = aes_decrypt_block(&block, &rounds, n);
        for ((out, x), y) in chunk.iter_mut().zip(plain).zip(iv) {
            *out = x ^ y;
        }
        iv = block;
    }
}
pub(super) fn decrypt(key: &[u8], data: &mut Vec<u8>) {
    if data.len() < 16 {
        data.clear();
        return;
    }
    let iv = data[..16].try_into().unwrap();
    let end = data.len() / 16 * 16;
    data.copy_within(16..end, 0);
    data.truncate(end - 16);
    decrypt_blocks(key, iv, data);
    if let Some(&n) = data.last()
        && n <= 16
        && data[data.len() - usize::from(n)..].iter().all(|b| *b == n)
    {
        data.truncate(data.len() - usize::from(n));
    }
}
fn hash(pw: &[u8], salt: &[u8], user: &[u8], r: usize) -> [u8; 32] {
    let initial = sha256_bytes(&[pw, salt, user].concat());
    if r == 5 {
        return initial;
    }
    let mut k = initial.to_vec();
    for i in 1..=288 {
        let combined = [pw, &k, user].concat();
        let mut blocks = combined.repeat(64);
        let (rounds, n) = aes_expand_key(&k[..16]);
        let mut iv: [u8; 16] = k[16..32].try_into().unwrap();
        for chunk in blocks.chunks_exact_mut(16) {
            for (v, b) in iv.iter_mut().zip(chunk.iter()) {
                *v ^= *b;
            }
            iv = aes_encrypt_block(&iv, &rounds, n);
            chunk.copy_from_slice(&iv);
        }
        k = match blocks[..16].iter().map(|&b| usize::from(b)).sum::<usize>() % 3 {
            0 => sha256_bytes(&blocks).to_vec(),
            1 => sha384_bytes(&blocks).to_vec(),
            _ => sha512_bytes(&blocks).to_vec(),
        };
        if i >= 64 && usize::from(iv[15]) + 32 <= i {
            break;
        }
    }
    k[..32].try_into().unwrap()
}
pub(super) fn file_key(dict: &Value<'_>, password: &str, r: usize) -> Option<Vec<u8>> {
    let string = |name: &[u8]| match dict.get(name)? {
        Value::String { bytes, .. } => Some(bytes.as_slice()),
        _ => None,
    };
    let pw = &password.as_bytes()[..password.len().min(127)];
    let u = string(b"U")?.get(..48)?;
    let o = string(b"O")?.get(..48)?;
    for (stored, user, wrapped) in [(u, &[][..], b"UE"), (o, u, b"OE")] {
        if !user.is_empty() && pw.is_empty() {
            continue;
        }
        if hash(pw, &stored[32..40], user, r) != stored[..32] {
            continue;
        }
        let mut file = string(wrapped)?.get(..32)?.to_vec();
        decrypt_blocks(&hash(pw, &stored[40..48], user, r), [0; 16], &mut file);
        return Some(file);
    }
    None
}
