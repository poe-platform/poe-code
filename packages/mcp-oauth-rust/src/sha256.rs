//! SHA-256 compression and padding as specified in FIPS 180-4.
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
fn compress(state: &mut [u32; 8], bytes: &[u8; 64]) {
    let mut words = [0u32; 64];
    for (index, word) in bytes.as_chunks::<4>().0.iter().enumerate() {
        words[index] = u32::from_be_bytes(*word);
    }
    for index in 16..64 {
        let x = words[index - 15];
        let y = words[index - 2];
        let small0 = x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3);
        let small1 = y.rotate_right(17) ^ y.rotate_right(19) ^ (y >> 10);
        words[index] = words[index - 16]
            .wrapping_add(small0)
            .wrapping_add(words[index - 7])
            .wrapping_add(small1);
    }
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for index in 0..64 {
        let big1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choice = (e & f) ^ (!e & g);
        let first = h
            .wrapping_add(big1)
            .wrapping_add(choice)
            .wrapping_add(K[index])
            .wrapping_add(words[index]);
        let big0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let majority = (a & b) ^ (a & c) ^ (b & c);
        let second = big0.wrapping_add(majority);
        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(first);
        d = c;
        c = b;
        b = a;
        a = first.wrapping_add(second);
    }
    for (word, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
        *word = word.wrapping_add(value);
    }
}
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut state = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let (chunks, remaining) = bytes.as_chunks::<64>();
    for chunk in chunks {
        compress(&mut state, chunk);
    }
    let mut tail = [0u8; 128];
    tail[..remaining.len()].copy_from_slice(remaining);
    tail[remaining.len()] = 0x80;
    let length = if remaining.len() < 56 { 64 } else { 128 };
    tail[length - 8..length].copy_from_slice(&(bytes.len() as u64).wrapping_mul(8).to_be_bytes());
    for block in tail[..length].as_chunks::<64>().0 {
        compress(&mut state, block);
    }
    let mut result = [0u8; 32];
    for (output, word) in result.as_chunks_mut::<4>().0.iter_mut().zip(state) {
        output.copy_from_slice(&word.to_be_bytes());
    }
    result
}
