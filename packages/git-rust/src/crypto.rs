use crate::fs::MemoryFs;

const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const SHA512_K: [u64; 80] = [
    0x428a2f98d728ae22, 0x7137449123ef65cd, 0xb5c0fbcfec4d3b2f, 0xe9b5dba58189dbbc,
    0x3956c25bf348b538, 0x59f111f1b605d019, 0x923f82a4af194f9b, 0xab1c5ed5da6d8118,
    0xd807aa98a3030242, 0x12835b0145706fbe, 0x243185be4ee4b28c, 0x550c7dc3d5ffb4e2,
    0x72be5d74f27b896f, 0x80deb1fe3b1696b1, 0x9bdc06a725c71235, 0xc19bf174cf692694,
    0xe49b69c19ef14ad2, 0xefbe4786384f25e3, 0x0fc19dc68b8cd5b5, 0x240ca1cc77ac9c65,
    0x2de92c6f592b0275, 0x4a7484aa6ea6e483, 0x5cb0a9dcbd41fbd4, 0x76f988da831153b5,
    0x983e5152ee66dfab, 0xa831c66d2db43210, 0xb00327c898fb213f, 0xbf597fc7beef0ee4,
    0xc6e00bf33da88fc2, 0xd5a79147930aa725, 0x06ca6351e003826f, 0x142929670a0e6e70,
    0x27b70a8546d22ffc, 0x2e1b21385c26c926, 0x4d2c6dfc5ac42aed, 0x53380d139d95b3df,
    0x650a73548baf63de, 0x766a0abb3c77b2a8, 0x81c2c92e47edaee6, 0x92722c851482353b,
    0xa2bfe8a14cf10364, 0xa81a664bbc423001, 0xc24b8b70d0f89791, 0xc76c51a30654be30,
    0xd192e819d6ef5218, 0xd69906245565a910, 0xf40e35855771202a, 0x106aa07032bbd1b8,
    0x19a4c116b8d2d0c8, 0x1e376c085141ab53, 0x2748774cdf8eeb99, 0x34b0bcb5e19b48a8,
    0x391c0cb3c5c95a63, 0x4ed8aa4ae3418acb, 0x5b9cca4f7763e373, 0x682e6ff3d6b2b8a3,
    0x748f82ee5defb2fc, 0x78a5636f43172f60, 0x84c87814a1f0ab72, 0x8cc702081a6439ec,
    0x90befffa23631e28, 0xa4506cebde82bde9, 0xbef9a3f7b2c67915, 0xc67178f2e372532b,
    0xca273eceea26619c, 0xd186b8c721c0c207, 0xeada7dd6cde0eb1e, 0xf57d4f7fee6ed178,
    0x06f067aa72176fba, 0x0a637dc5a2c898a6, 0x113f9804bef90dae, 0x1b710b35131c471b,
    0x28db77f523047d84, 0x32caab7b40c72493, 0x3c9ebe0a15c9bebc, 0x431d67c49c100d4c,
    0x4cc5d4becb3e42b6, 0x597f299cfc657e2a, 0x5fcb6fab3ad6faec, 0x6c44198c4a475817,
];

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

pub fn sha512(data: &[u8]) -> [u8; 64] {
    let mut h: [u64; 8] = [
        0x6a09e667f3bcc908, 0xbb67ae8584caa73b, 0x3c6ef372fe94f82b, 0xa54ff53a5f1d36f1,
        0x510e527fade682d1, 0x9b05688c2b3e6c1f, 0x1f83d9abfb41bd6b, 0x5be0cd19137e2179,
    ];
    let bit_len = (data.len() as u128).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 128) != 112 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.as_chunks::<128>().0 {
        let mut w = [0u64; 80];
        for i in 0..16 {
            let mut b = [0u8; 8];
            b.copy_from_slice(&chunk[i * 8..i * 8 + 8]);
            w[i] = u64::from_be_bytes(b);
        }
        for i in 16..80 {
            let s0 = w[i - 15].rotate_right(1) ^ w[i - 15].rotate_right(8) ^ (w[i - 15] >> 7);
            let s1 = w[i - 2].rotate_right(19) ^ w[i - 2].rotate_right(61) ^ (w[i - 2] >> 6);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..80 {
            let s1 = e.rotate_right(14) ^ e.rotate_right(18) ^ e.rotate_right(41);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA512_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(28) ^ a.rotate_right(34) ^ a.rotate_right(39);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 64];
    for (i, word) in h.iter().enumerate() {
        out[i * 8..i * 8 + 8].copy_from_slice(&word.to_be_bytes());
    }
    out
}

pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut k_block = [0u8; 64];
    if key.len() > 64 {
        let hashed = sha256(key);
        k_block[..32].copy_from_slice(&hashed);
    } else {
        k_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = vec![0x36u8; 64];
    let mut opad = vec![0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= k_block[i];
        opad[i] ^= k_block[i];
    }
    ipad.extend_from_slice(data);
    let inner = sha256(&ipad);
    opad.extend_from_slice(&inner);
    sha256(&opad)
}

pub fn hmac_sha512(key: &[u8], data: &[u8]) -> [u8; 64] {
    let mut k_block = [0u8; 128];
    if key.len() > 128 {
        let hashed = sha512(key);
        k_block[..64].copy_from_slice(&hashed);
    } else {
        k_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = vec![0x36u8; 128];
    let mut opad = vec![0x5cu8; 128];
    for i in 0..128 {
        ipad[i] ^= k_block[i];
        opad[i] ^= k_block[i];
    }
    ipad.extend_from_slice(data);
    let inner = sha512(&ipad);
    opad.extend_from_slice(&inner);
    sha512(&opad)
}

pub fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, out_len: usize) -> Vec<u8> {
    let blocks = out_len.div_ceil(32);
    let mut out = Vec::with_capacity(blocks * 32);
    for block_idx in 1..=(blocks as u32) {
        let mut salt_block = Vec::with_capacity(salt.len() + 4);
        salt_block.extend_from_slice(salt);
        salt_block.extend_from_slice(&block_idx.to_be_bytes());
        let mut u = hmac_sha256(password, &salt_block);
        let mut t = u;
        for _ in 1..iterations.max(1) {
            u = hmac_sha256(password, &u);
            for j in 0..32 {
                t[j] ^= u[j];
            }
        }
        out.extend_from_slice(&t);
    }
    out.truncate(out_len);
    out
}

// --- Pure-Rust RFC 8032 Ed25519 Implementation ---

type Fe = [i64; 16];

fn fe_zero() -> Fe {
    [0; 16]
}

fn fe_one() -> Fe {
    let mut r = [0; 16];
    r[0] = 1;
    r
}

fn fe_carry(o: &mut Fe) {
    for _ in 0..2 {
        for i in 0..16 {
            o[i] += 1 << 16;
            let c = o[i] >> 16;
            if i < 15 {
                o[i + 1] += c - 1;
            } else {
                o[0] += 38 * (c - 1);
            }
            o[i] -= c << 16;
        }
    }
}

fn fe_add(a: &Fe, b: &Fe) -> Fe {
    let mut o = [0i64; 16];
    for i in 0..16 {
        o[i] = a[i] + b[i];
    }
    o
}

fn fe_sub(a: &Fe, b: &Fe) -> Fe {
    let mut o = [0i64; 16];
    for i in 0..16 {
        o[i] = a[i] - b[i];
    }
    o
}

fn fe_mul(a: &Fe, b: &Fe) -> Fe {
    let mut t = [0i64; 31];
    for i in 0..16 {
        for j in 0..16 {
            t[i + j] += a[i] * b[j];
        }
    }
    for i in 0..15 {
        t[i] += 38 * t[i + 16];
    }
    let mut o = [0i64; 16];
    o.copy_from_slice(&t[..16]);
    fe_carry(&mut o);
    o
}

fn fe_sq(a: &Fe) -> Fe {
    fe_mul(a, a)
}

fn fe_inv(i: &Fe) -> Fe {
    let mut c = *i;
    for a in (0..=253).rev() {
        c = fe_sq(&c);
        if a != 2 && a != 4 {
            c = fe_mul(&c, i);
        }
    }
    c
}

fn fe_pack(n: &Fe) -> [u8; 32] {
    let mut t = *n;
    fe_carry(&mut t);
    fe_carry(&mut t);
    let mut m = [0i64; 16];
    for _ in 0..2 {
        m[0] = t[0] - 0xffed;
        for i in 1..15 {
            m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
            m[i - 1] &= 0xffff;
        }
        m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
        let b = (m[15] >> 16) & 1;
        m[14] &= 0xffff;
        for i in 0..16 {
            let diff = b * (t[i] ^ m[i]);
            t[i] = m[i] ^ diff;
        }
    }
    let mut out = [0u8; 32];
    for i in 0..16 {
        out[2 * i] = (t[i] & 0xff) as u8;
        out[2 * i + 1] = ((t[i] >> 8) & 0xff) as u8;
    }
    out
}

fn fe_unpack(s: &[u8; 32]) -> Fe {
    let mut o = [0i64; 16];
    for i in 0..16 {
        o[i] = (s[2 * i] as i64) | ((s[2 * i + 1] as i64) << 8);
    }
    o[15] &= 0x7fff;
    o
}

fn fe_par25519(a: &Fe) -> u8 {
    let d = fe_pack(a);
    d[0] & 1
}

fn fe_pow2523(i: &Fe) -> Fe {
    let mut c = *i;
    for a in (0..=250).rev() {
        c = fe_sq(&c);
        if a != 1 {
            c = fe_mul(&c, i);
        }
    }
    c
}

fn d_const() -> Fe {
    [
        0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
        0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203,
    ]
}

fn base_point() -> [Fe; 4] {
    let bx: Fe = [
        0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c,
        0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169,
    ];
    let by: Fe = [
        0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
        0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
    ];
    [bx, by, fe_one(), fe_mul(&bx, &by)]
}

fn ge_add(p: &mut [Fe; 4], q: &[Fe; 4]) {
    let d2 = fe_add(&d_const(), &d_const());
    let a = fe_mul(&fe_sub(&p[1], &p[0]), &fe_sub(&q[1], &q[0]));
    let b = fe_mul(&fe_add(&p[1], &p[0]), &fe_add(&q[1], &q[0]));
    let c = fe_mul(&fe_mul(&p[3], &q[3]), &d2);
    let d = fe_mul(&p[2], &q[2]);
    let d = fe_add(&d, &d);
    let e = fe_sub(&b, &a);
    let f = fe_sub(&d, &c);
    let g = fe_add(&d, &c);
    let h = fe_add(&b, &a);
    p[0] = fe_mul(&e, &f);
    p[1] = fe_mul(&h, &g);
    p[2] = fe_mul(&g, &f);
    p[3] = fe_mul(&e, &h);
}

fn ge_scalarmult(q: &[Fe; 4], s: &[u8; 32]) -> [Fe; 4] {
    let mut p = [fe_zero(), fe_one(), fe_one(), fe_zero()];
    for i in (0..=255).rev() {
        let b = (s[i >> 3] >> (i & 7)) & 1;
        let p_copy = p;
        ge_add(&mut p, &p_copy);
        if b == 1 {
            ge_add(&mut p, q);
        }
    }
    p
}

fn ge_pack(p: &[Fe; 4]) -> [u8; 32] {
    let zi = fe_inv(&p[2]);
    let tx = fe_mul(&p[0], &zi);
    let ty = fe_mul(&p[1], &zi);
    let mut r = fe_pack(&ty);
    r[31] ^= fe_par25519(&tx) << 7;
    r
}

fn ge_unpack_neg(s: &[u8; 32]) -> Option<[Fe; 4]> {
    let y = fe_unpack(s);
    let y2 = fe_sq(&y);
    let u = fe_sub(&y2, &fe_one());
    let v = fe_add(&fe_mul(&y2, &d_const()), &fe_one());
    let v3 = fe_mul(&v, &fe_sq(&v));
    let v7 = fe_mul(&v, &fe_sq(&v3));
    let mut x = fe_mul(&fe_mul(&u, &v3), &fe_pow2523(&fe_mul(&u, &v7)));
    let vxx = fe_mul(&v, &fe_sq(&x));
    if fe_pack(&vxx) != fe_pack(&u) {
        if fe_pack(&fe_add(&vxx, &u)) != [0u8; 32] {
            return None;
        }
        let sqrtm1: Fe = [
            0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
            0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83,
        ];
        x = fe_mul(&x, &sqrtm1);
    }
    if fe_par25519(&x) == (s[31] >> 7) {
        x = fe_sub(&fe_zero(), &x);
    }
    Some([x, y, fe_one(), fe_mul(&x, &y)])
}

const L_MOD: [i64; 32] = [
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58,
    0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
];

fn mod_l(x: &mut [i64; 64]) {
    for i in (32..=63).rev() {
        let mut carry = 0i64;
        for j in (i - 32)..(i - 12) {
            x[j] += carry - 16 * x[i] * L_MOD[j - (i - 32)];
            carry = (x[j] + 128) >> 8;
            x[j] -= carry << 8;
        }
        x[i - 12] += carry;
        x[i] = 0;
    }
    let mut carry = 0i64;
    for j in 0..32 {
        x[j] += carry - (x[31] >> 4) * L_MOD[j];
        carry = x[j] >> 8;
        x[j] &= 0xff;
    }
    for j in 0..32 {
        x[j] -= carry * L_MOD[j];
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        x[i + 1] += x[i] >> 8;
        out[i] = (x[i] & 0xff) as u8;
    }
    for i in 0..32 {
        x[i] = out[i] as i64;
    }
}

fn reduce_scalar(digest: &[u8; 64]) -> [u8; 32] {
    let mut x = [0i64; 64];
    for i in 0..64 {
        x[i] = digest[i] as i64;
    }
    mod_l(&mut x);
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = x[i] as u8;
    }
    out
}

pub fn ed25519_public_key(seed: &[u8; 32]) -> [u8; 32] {
    let mut d = sha512(seed);
    d[0] &= 248;
    d[31] &= 127;
    d[31] |= 64;
    let mut s = [0u8; 32];
    s.copy_from_slice(&d[..32]);
    let p = ge_scalarmult(&base_point(), &s);
    ge_pack(&p)
}

pub fn ed25519_sign(seed: &[u8; 32], message: &[u8]) -> [u8; 64] {
    let mut d = sha512(seed);
    d[0] &= 248;
    d[31] &= 127;
    d[31] |= 64;
    let mut a_scalar = [0u8; 32];
    a_scalar.copy_from_slice(&d[..32]);
    let pk = ge_pack(&ge_scalarmult(&base_point(), &a_scalar));

    let mut r_in = Vec::with_capacity(32 + message.len());
    r_in.extend_from_slice(&d[32..64]);
    r_in.extend_from_slice(message);
    let r_scalar = reduce_scalar(&sha512(&r_in));
    let r_point = ge_pack(&ge_scalarmult(&base_point(), &r_scalar));

    let mut h_in = Vec::with_capacity(64 + message.len());
    h_in.extend_from_slice(&r_point);
    h_in.extend_from_slice(&pk);
    h_in.extend_from_slice(message);
    let k_scalar = reduce_scalar(&sha512(&h_in));

    let mut x = [0i64; 64];
    for i in 0..32 {
        x[i] = r_scalar[i] as i64;
    }
    for i in 0..32 {
        for j in 0..32 {
            x[i + j] += (k_scalar[i] as i64) * (a_scalar[j] as i64);
        }
    }
    mod_l(&mut x);

    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(&r_point);
    for i in 0..32 {
        sig[32 + i] = x[i] as u8;
    }
    sig
}

pub fn ed25519_verify(public_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool {
    let mut r_bytes = [0u8; 32];
    r_bytes.copy_from_slice(&signature[..32]);
    let mut s_bytes = [0u8; 32];
    s_bytes.copy_from_slice(&signature[32..64]);
    if (s_bytes[31] & 224) != 0 {
        return false;
    }
    let Some(neg_a) = ge_unpack_neg(public_key) else {
        return false;
    };
    let mut h_in = Vec::with_capacity(64 + message.len());
    h_in.extend_from_slice(&r_bytes);
    h_in.extend_from_slice(public_key);
    h_in.extend_from_slice(message);
    let k_scalar = reduce_scalar(&sha512(&h_in));

    let mut sb = ge_scalarmult(&base_point(), &s_bytes);
    let ka = ge_scalarmult(&neg_a, &k_scalar);
    ge_add(&mut sb, &ka);
    let check = ge_pack(&sb);
    check == r_bytes
}

// --- Base64 helpers ---

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_CHARS[((n >> 18) & 63) as usize] as char);
        out.push(B64_CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64_CHARS[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64_CHARS[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut vals = Vec::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_whitespace() {
            continue;
        }
        if b == b'=' {
            break;
        }
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        vals.push(v);
    }
    let mut out = Vec::with_capacity(vals.len() * 3 / 4);
    for chunk in vals.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        out.push((chunk[0] << 2) | (chunk[1] >> 4));
        if chunk.len() > 2 {
            out.push((chunk[1] << 4) | (chunk[2] >> 2));
        }
        if chunk.len() > 3 {
            out.push((chunk[2] << 6) | chunk[3]);
        }
    }
    Some(out)
}

fn wrap_b64(b64: &str, width: usize) -> String {
    let mut lines = Vec::new();
    let mut idx = 0;
    while idx < b64.len() {
        let end = (idx + width).min(b64.len());
        lines.push(&b64[idx..end]);
        idx = end;
    }
    lines.join("\n")
}

// --- SSH Wire & OpenSSH Key / SSHSIG v1 ---

fn ssh_write_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
}

fn ssh_read_bytes<'a>(buf: &'a [u8], pos: &mut usize) -> Option<&'a [u8]> {
    if *pos + 4 > buf.len() {
        return None;
    }
    let len = u32::from_be_bytes([buf[*pos], buf[*pos + 1], buf[*pos + 2], buf[*pos + 3]]) as usize;
    *pos += 4;
    if *pos + len > buf.len() {
        return None;
    }
    let slice = &buf[*pos..*pos + len];
    *pos += len;
    Some(slice)
}

fn ssh_read_u32(buf: &[u8], pos: &mut usize) -> Option<u32> {
    if *pos + 4 > buf.len() {
        return None;
    }
    let v = u32::from_be_bytes([buf[*pos], buf[*pos + 1], buf[*pos + 2], buf[*pos + 3]]);
    *pos += 4;
    Some(v)
}

pub fn ssh_ed25519_pubkey_blob(pk: &[u8; 32]) -> Vec<u8> {
    let mut blob = Vec::new();
    ssh_write_bytes(&mut blob, b"ssh-ed25519");
    ssh_write_bytes(&mut blob, pk);
    blob
}

pub fn format_openssh_ed25519_public_key(pk: &[u8; 32], comment: &str) -> String {
    let b64 = base64_encode(&ssh_ed25519_pubkey_blob(pk));
    if comment.trim().is_empty() {
        format!("ssh-ed25519 {b64}")
    } else {
        format!("ssh-ed25519 {b64} {}", comment.trim())
    }
}

pub fn ssh_key_fingerprint_sha256(pk: &[u8; 32]) -> String {
    let digest = sha256(&ssh_ed25519_pubkey_blob(pk));
    let b64 = base64_encode(&digest);
    format!("SHA256:{}", b64.trim_end_matches('='))
}

pub fn format_openssh_ed25519_private_key(seed: &[u8; 32], comment: &str) -> String {
    let pk = ed25519_public_key(seed);
    let pub_blob = ssh_ed25519_pubkey_blob(&pk);
    let mut priv_section = Vec::new();
    let check_int: u32 = 0x7172_7374;
    priv_section.extend_from_slice(&check_int.to_be_bytes());
    priv_section.extend_from_slice(&check_int.to_be_bytes());
    ssh_write_bytes(&mut priv_section, b"ssh-ed25519");
    ssh_write_bytes(&mut priv_section, &pk);
    let mut sk64 = [0u8; 64];
    sk64[..32].copy_from_slice(seed);
    sk64[32..].copy_from_slice(&pk);
    ssh_write_bytes(&mut priv_section, &sk64);
    ssh_write_bytes(&mut priv_section, comment.as_bytes());
    let mut pad = 1u8;
    while priv_section.len() % 8 != 0 {
        priv_section.push(pad);
        pad += 1;
    }

    let mut outer = Vec::new();
    outer.extend_from_slice(b"openssh-key-v1\0");
    ssh_write_bytes(&mut outer, b"none");
    ssh_write_bytes(&mut outer, b"none");
    ssh_write_bytes(&mut outer, b"");
    outer.extend_from_slice(&1u32.to_be_bytes());
    ssh_write_bytes(&mut outer, &pub_blob);
    ssh_write_bytes(&mut outer, &priv_section);

    format!(
        "-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n",
        wrap_b64(&base64_encode(&outer), 70)
    )
}

pub fn parse_openssh_ed25519_private_key(pem: &str) -> Option<([u8; 32], [u8; 32], String)> {
    let start = pem.find("-----BEGIN OPENSSH PRIVATE KEY-----")?;
    let end = pem.find("-----END OPENSSH PRIVATE KEY-----")?;
    let body = &pem[start + "-----BEGIN OPENSSH PRIVATE KEY-----".len()..end];
    let raw = base64_decode(body)?;
    if !raw.starts_with(b"openssh-key-v1\0") {
        return None;
    }
    let mut pos = b"openssh-key-v1\0".len();
    let _cipher = ssh_read_bytes(&raw, &mut pos)?;
    let _kdf = ssh_read_bytes(&raw, &mut pos)?;
    let _kdf_opts = ssh_read_bytes(&raw, &mut pos)?;
    let nkeys = ssh_read_u32(&raw, &mut pos)?;
    if nkeys != 1 {
        return None;
    }
    let _pub_blob = ssh_read_bytes(&raw, &mut pos)?;
    let priv_blob = ssh_read_bytes(&raw, &mut pos)?;
    let mut ppos = 0;
    let c1 = ssh_read_u32(priv_blob, &mut ppos)?;
    let c2 = ssh_read_u32(priv_blob, &mut ppos)?;
    if c1 != c2 {
        return None;
    }
    let ktype = ssh_read_bytes(priv_blob, &mut ppos)?;
    if ktype != b"ssh-ed25519" {
        return None;
    }
    let pk_slice = ssh_read_bytes(priv_blob, &mut ppos)?;
    let sk_slice = ssh_read_bytes(priv_blob, &mut ppos)?;
    let comment_bytes = ssh_read_bytes(priv_blob, &mut ppos)?;
    if pk_slice.len() != 32 || sk_slice.len() != 64 {
        return None;
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&sk_slice[..32]);
    let mut pk = [0u8; 32];
    pk.copy_from_slice(pk_slice);
    let comment = String::from_utf8_lossy(comment_bytes).to_string();
    Some((seed, pk, comment))
}

pub fn parse_openssh_ed25519_public_key(line: &str) -> Option<([u8; 32], String)> {
    let mut parts = line.split_whitespace();
    let first = parts.next()?;
    let b64 = if first == "ssh-ed25519" {
        parts.next()?
    } else {
        // Might be an allowed_signers line: <principal> [options] ssh-ed25519 <b64>
        let mut found_b64 = None;
        while let Some(tok) = parts.next() {
            if tok == "ssh-ed25519" {
                found_b64 = parts.next();
                break;
            }
        }
        found_b64?
    };
    let comment = parts.collect::<Vec<_>>().join(" ");
    let blob = base64_decode(b64)?;
    let mut pos = 0;
    let ktype = ssh_read_bytes(&blob, &mut pos)?;
    if ktype != b"ssh-ed25519" {
        return None;
    }
    let pk_slice = ssh_read_bytes(&blob, &mut pos)?;
    if pk_slice.len() != 32 {
        return None;
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(pk_slice);
    Some((pk, comment))
}

fn sshsig_signed_data(namespace: &str, message: &[u8]) -> Vec<u8> {
    let msg_hash = sha512(message);
    let mut signed = Vec::new();
    signed.extend_from_slice(b"SSHSIG");
    ssh_write_bytes(&mut signed, namespace.as_bytes());
    ssh_write_bytes(&mut signed, b"");
    ssh_write_bytes(&mut signed, b"sha512");
    ssh_write_bytes(&mut signed, &msg_hash);
    signed
}

pub fn sshsig_sign(seed: &[u8; 32], namespace: &str, message: &[u8]) -> String {
    let pk = ed25519_public_key(seed);
    let signed_data = sshsig_signed_data(namespace, message);
    let raw_sig = ed25519_sign(seed, &signed_data);

    let pub_blob = ssh_ed25519_pubkey_blob(&pk);
    let mut sig_blob = Vec::new();
    ssh_write_bytes(&mut sig_blob, b"ssh-ed25519");
    ssh_write_bytes(&mut sig_blob, &raw_sig);

    let mut env = Vec::new();
    env.extend_from_slice(b"SSHSIG");
    env.extend_from_slice(&1u32.to_be_bytes());
    ssh_write_bytes(&mut env, &pub_blob);
    ssh_write_bytes(&mut env, namespace.as_bytes());
    ssh_write_bytes(&mut env, b"");
    ssh_write_bytes(&mut env, b"sha512");
    ssh_write_bytes(&mut env, &sig_blob);

    format!(
        "-----BEGIN SSH SIGNATURE-----\n{}\n-----END SSH SIGNATURE-----",
        wrap_b64(&base64_encode(&env), 70)
    )
}

#[derive(Debug, Clone)]
pub struct SshSigVerified {
    pub public_key: [u8; 32],
    pub namespace: String,
    pub fingerprint: String,
    pub principal: Option<String>,
}

pub fn sshsig_verify(
    armored_sig: &str,
    expected_namespace: &str,
    message: &[u8],
    allowed_signers: Option<&str>,
) -> Option<SshSigVerified> {
    let start = armored_sig.find("-----BEGIN SSH SIGNATURE-----")?;
    let end = armored_sig.find("-----END SSH SIGNATURE-----")?;
    let b64 = &armored_sig[start + "-----BEGIN SSH SIGNATURE-----".len()..end];
    let env = base64_decode(b64)?;
    if !env.starts_with(b"SSHSIG") {
        return None;
    }
    let mut pos = 6;
    let version = ssh_read_u32(&env, &mut pos)?;
    if version != 1 {
        return None;
    }
    let pub_blob = ssh_read_bytes(&env, &mut pos)?;
    let ns_bytes = ssh_read_bytes(&env, &mut pos)?;
    let _reserved = ssh_read_bytes(&env, &mut pos)?;
    let hash_alg = ssh_read_bytes(&env, &mut pos)?;
    let sig_blob = ssh_read_bytes(&env, &mut pos)?;

    let ns = std::str::from_utf8(ns_bytes).ok()?;
    if !expected_namespace.is_empty() && ns != expected_namespace {
        return None;
    }
    if hash_alg != b"sha512" {
        return None;
    }

    let mut pk_pos = 0;
    let pk_type = ssh_read_bytes(pub_blob, &mut pk_pos)?;
    let pk_raw = ssh_read_bytes(pub_blob, &mut pk_pos)?;
    if pk_type != b"ssh-ed25519" || pk_raw.len() != 32 {
        return None;
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(pk_raw);

    let mut sig_pos = 0;
    let sig_type = ssh_read_bytes(sig_blob, &mut sig_pos)?;
    let sig_raw = ssh_read_bytes(sig_blob, &mut sig_pos)?;
    if sig_type != b"ssh-ed25519" || sig_raw.len() != 64 {
        return None;
    }
    let mut sig64 = [0u8; 64];
    sig64.copy_from_slice(sig_raw);

    let signed_data = sshsig_signed_data(ns, message);
    if !ed25519_verify(&pk, &signed_data, &sig64) {
        return None;
    }

    let mut matched_principal = None;
    if let Some(allowed) = allowed_signers {
        let mut found = false;
        for line in allowed.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((allowed_pk, _)) = parse_openssh_ed25519_public_key(trimmed)
                && allowed_pk == pk
            {
                found = true;
                matched_principal = trimmed.split_whitespace().next().map(|s| s.to_string());
                break;
            }
        }
        if !found {
            return None;
        }
    }

    Some(SshSigVerified {
        public_key: pk,
        namespace: ns.to_string(),
        fingerprint: ssh_key_fingerprint_sha256(&pk),
        principal: matched_principal,
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub use crate::openpgp::{
    PgpSigVerified, pgp_fingerprint_from_pubkey, pgp_key_id_from_pubkey, pgp_public_key,
    pgp_sign_detached, pgp_sign_with_secret_key, pgp_verify_detached, pgp_verify_detached_with_key,
};

pub fn derive_seed_for_signing_key(
    fs: &MemoryFs,
    root: &str,
    signing_key: &str,
) -> Result<[u8; 32], String> {
    let trimmed = signing_key.trim();
    if trimmed.contains("-----BEGIN OPENSSH PRIVATE KEY-----")
        && let Some((seed, _, _)) = parse_openssh_ed25519_private_key(trimmed)
    {
        return Ok(seed);
    }
    if !trimmed.is_empty() {
        let candidates = if trimmed.starts_with('/') {
            vec![trimmed.to_string()]
        } else if let Some(rest) = trimmed.strip_prefix("~/") {
            vec![
                format!("/home/user/{rest}"),
                format!("/root/{rest}"),
                format!("{root}/{rest}"),
            ]
        } else {
            vec![format!("{root}/{trimmed}"), trimmed.to_string()]
        };
        for path in candidates {
            if let Ok(bytes) = fs.read_file(&path)
                && let Ok(text) = std::str::from_utf8(&bytes)
                && let Some((seed, _, _)) = parse_openssh_ed25519_private_key(text)
            {
                return Ok(seed);
            }
        }
    }
    for default_ssh in [
        format!("{root}/.ssh/id_ed25519"),
        "/home/user/.ssh/id_ed25519".to_string(),
        "/root/.ssh/id_ed25519".to_string(),
    ] {
        if let Ok(bytes) = fs.read_file(&default_ssh)
            && let Ok(text) = std::str::from_utf8(&bytes)
            && let Some((seed, _, _)) = parse_openssh_ed25519_private_key(text)
        {
            return Ok(seed);
        }
    }
    Err("No usable signing private key was provided".to_string())
}

pub fn sign_git_payload(
    fs: &MemoryFs,
    root: &str,
    gpg_format: &str,
    signing_key: &str,
    signer_uid: &str,
    timestamp: u32,
    payload: &str,
) -> Result<String, String> {
    if gpg_format.eq_ignore_ascii_case("ssh") {
        let seed = derive_seed_for_signing_key(fs, root, signing_key)?;
        Ok(sshsig_sign(&seed, "git", payload.as_bytes()))
    } else {
        #[cfg(not(target_arch = "wasm32"))]
        {
            if signing_key.contains("-----BEGIN PGP PRIVATE KEY BLOCK-----") {
                return pgp_sign_with_secret_key(
                    signing_key.as_bytes(),
                    timestamp,
                    payload.as_bytes(),
                );
            }
            let key_path = if signing_key.starts_with('/') {
                signing_key.to_string()
            } else {
                format!("{root}/{signing_key}")
            };
            if let Ok(key) = fs.read_file(&key_path)
                && !key.starts_with(b"-----BEGIN OPENSSH PRIVATE KEY-----")
            {
                return pgp_sign_with_secret_key(&key, timestamp, payload.as_bytes());
            }
            let seed = derive_seed_for_signing_key(fs, root, signing_key)?;
            Ok(pgp_sign_detached(
                &seed,
                signer_uid,
                timestamp,
                payload.as_bytes(),
            ))
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = (signer_uid, timestamp);
            Err("OpenPGP signing requires the native git-rust runtime".to_string())
        }
    }
}

pub fn verify_git_signature(
    fs: &MemoryFs,
    root: &str,
    signature: &str,
    payload: &str,
    allowed_signers_file: Option<&str>,
) -> Result<String, String> {
    if signature.contains("-----BEGIN SSH SIGNATURE-----") {
        let allowed_content = allowed_signers_file.and_then(|p| {
            let resolved = if p.starts_with('/') {
                p.to_string()
            } else {
                format!("{root}/{p}")
            };
            fs.read_file(&resolved)
                .ok()
                .and_then(|b| String::from_utf8(b).ok())
        });
        if let Some(verified) = sshsig_verify(
            signature,
            "git",
            payload.as_bytes(),
            allowed_content.as_deref(),
        ) {
            let who = verified.principal.unwrap_or_else(|| "git".to_string());
            Ok(format!(
                "Good \"git\" signature for {who} with ED25519 key {}",
                verified.fingerprint
            ))
        } else {
            Err("BAD SSH signature".to_string())
        }
    } else if signature.contains("-----BEGIN PGP SIGNATURE-----") {
        #[cfg(target_arch = "wasm32")]
        {
            Err("OpenPGP verification requires the native git-rust runtime".to_string())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let key_path = crate::commands::plumbing::get_config(
                fs,
                &crate::fs::discover_gitdir(fs, &format!("{root}/.git")),
                "gpg.openpgp.publicKeyFile",
            )
            .map(|v| v.as_str().to_string());
            let public_key = key_path
                .map(|p| {
                    let path = if p.starts_with('/') {
                        p
                    } else {
                        format!("{root}/{p}")
                    };
                    fs.read_file(&path)
                        .map_err(|_| format!("gpg: Cannot read public key: {path}"))
                })
                .transpose()?;
            let verified =
                pgp_verify_detached_with_key(signature, payload.as_bytes(), public_key.as_deref())?;
            Ok(format!(
                "gpg: Good signature from \"{}\" [unknown]\ngpg: Primary key fingerprint: {}",
                verified.signer_uid, verified.fingerprint
            ))
        }
    } else {
        Err("Unknown signature format".to_string())
    }
}

pub fn sha1_bytes(data: &[u8]) -> [u8; 20] {
    let hex = crate::utils::shasum(data);
    let mut out = [0u8; 20];
    for i in 0..20 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0);
    }
    out
}

pub fn sha1_hmac(key: &[u8], data: &[u8]) -> [u8; 20] {
    let mut k_block = [0u8; 64];
    if key.len() > 64 {
        let h = sha1_bytes(key);
        k_block[..20].copy_from_slice(&h);
    } else {
        k_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= k_block[i];
        opad[i] ^= k_block[i];
    }
    let mut inner = Vec::with_capacity(64 + data.len());
    inner.extend_from_slice(&ipad);
    inner.extend_from_slice(data);
    let inner_hash = sha1_bytes(&inner);

    let mut outer = Vec::with_capacity(64 + 20);
    outer.extend_from_slice(&opad);
    outer.extend_from_slice(&inner_hash);
    sha1_bytes(&outer)
}
