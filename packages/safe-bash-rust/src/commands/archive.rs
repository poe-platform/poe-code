use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

pub fn try_run_archive_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "sha256sum" => Some(cmd_hash("sha256", args, stdin, cwd, fs)),
        "sha224sum" => Some(cmd_hash("sha224", args, stdin, cwd, fs)),
        "sha384sum" => Some(cmd_hash("sha384", args, stdin, cwd, fs)),
        "sha512sum" => Some(cmd_hash("sha512", args, stdin, cwd, fs)),
        "sha1sum" => Some(cmd_hash("sha1", args, stdin, cwd, fs)),
        "md5sum" => Some(cmd_hash("md5", args, stdin, cwd, fs)),
        "b2sum" => Some(cmd_hash("blake2b", args, stdin, cwd, fs)),
        "cksum" => Some(cmd_cksum(args, stdin, cwd, fs)),
        "base64" => Some(cmd_base64(args, stdin, cwd, fs)),
        "base32" => Some(cmd_base32(args, stdin, cwd, fs)),
        "xxd" => Some(cmd_xxd(args, stdin, cwd, fs)),
        "strings" => Some(cmd_strings(args, stdin, cwd, fs)),
        "od" => Some(cmd_od(args, stdin, cwd, fs)),
        "hexdump" => Some(cmd_hexdump(args, stdin, cwd, fs, false)),
        "hd" => Some(cmd_hexdump(args, stdin, cwd, fs, true)),
        "tar" => Some(cmd_tar(args, stdin, cwd, fs)),
        "gzip" | "gunzip" | "zcat" | "zstd" | "unzstd" | "zstdcat" | "xz" | "unxz" | "xzcat" | "lzma" | "unlzma" | "lzcat" | "bzip2" | "bunzip2" | "bzcat" => Some(cmd_gzip(cmd, args, stdin, cwd, fs)),
        "ffmpeg" | "ffprobe" | "soffice" | "libreoffice" | "wkhtmltopdf" | "pdfunite" | "pdfseparate" | "qpdf" | "pdftk" | "pdfinfo" | "pdffonts" | "pdfdetach" | "pdftotext" | "pdftohtml" | "pdftoppm" | "pdftocairo" | "pdfimages" | "diffpdf" | "pdfdiff" | "svgo" | "rsvg-convert" | "sox" | "soxi" | "qrencode" | "magick" | "convert" | "mogrify" | "composite" | "montage" | "compare" | "sips" | "exiftool" | "identify" => Some(cmd_media_doc(cmd, args, stdin, cwd, fs)),
        "zip" => Some(cmd_zip(args, stdin, cwd, fs)),
        "unzip" => Some(cmd_unzip(args, cwd, fs)),
        "openssl" => Some(cmd_openssl(args, stdin, cwd, env, fs)),
        "gpg" => Some(cmd_gpg(args, stdin, cwd, fs)),
        "ssh" => Some(cmd_ssh(args)),
        "ssh-keygen" => Some(cmd_ssh_keygen(args, stdin, cwd, fs)),
        "dot" | "neato" => Some(cmd_graphviz(cmd, args, stdin, cwd, fs)),
        _ => None,
    }
}

fn ok_out(stdout: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: stdout.to_string(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn err_out(stderr: &str, exit_code: i32) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: stderr.to_string(),
        exit_code,
    }
}

pub fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    sha256_with_iv(
        data,
        [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
            0x5be0cd19,
        ],
    )
}

fn sha224_bytes(data: &[u8]) -> [u8; 28] {
    let full = sha256_with_iv(
        data,
        [
            0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7,
            0xbefa4fa4,
        ],
    );
    let mut out = [0u8; 28];
    out.copy_from_slice(&full[..28]);
    out
}

fn sha256_with_iv(data: &[u8], mut h: [u32; 8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
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
                .wrapping_add(K[i])
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

fn sha1_bytes(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xefcdab89;
    let mut h2: u32 = 0x98badcfe;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xc3d2e1f0;

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for i in 0..80 {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5a827999u32),
                20..=39 => (b ^ c ^ d, 0x6ed9eba1u32),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1bbcdcu32),
                _ => (b ^ c ^ d, 0xca62c1d6u32),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(w[i]);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    for (i, word) in [h0, h1, h2, h3, h4].iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn md5_bytes(data: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut m = [0u32; 16];
        for i in 0..16 {
            m[i] = u32::from_le_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }

        let mut a = a0;
        let mut b = b0;
        let mut c = c0;
        let mut d = d0;

        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };
            let temp = d;
            d = c;
            c = b;
            b = b.wrapping_add(
                a.wrapping_add(f)
                    .wrapping_add(K[i])
                    .wrapping_add(m[g])
                    .rotate_left(S[i]),
            );
            a = temp;
        }

        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut out = [0u8; 16];
    out[0..4].copy_from_slice(&a0.to_le_bytes());
    out[4..8].copy_from_slice(&b0.to_le_bytes());
    out[8..12].copy_from_slice(&c0.to_le_bytes());
    out[12..16].copy_from_slice(&d0.to_le_bytes());
    out
}

fn sha512_bytes(data: &[u8]) -> [u8; 64] {
    sha512_with_iv(
        data,
        [
            0x6a09e667f3bcc908, 0xbb67ae8584caa73b, 0x3c6ef372fe94f82b, 0xa54ff53a5f1d36f1,
            0x510e527fade682d1, 0x9b05688c2b3e6c1f, 0x1f83d9abfb41bd6b, 0x5be0cd19137e2179,
        ],
    )
}

fn sha384_bytes(data: &[u8]) -> [u8; 48] {
    let full = sha512_with_iv(
        data,
        [
            0xcbbb9d5dc1059ed8, 0x629a292a367cd507, 0x9159015a3070dd17, 0x152fecd8f70e5939,
            0x67332667ffc00b31, 0x8eb44a8768581511, 0xdb0c2e0d64f98fa7, 0x47b5481dbefa4fa4,
        ],
    );
    let mut out = [0u8; 48];
    out.copy_from_slice(&full[..48]);
    out
}

fn sha512_with_iv(data: &[u8], mut h: [u64; 8]) -> [u8; 64] {
    const K: [u64; 80] = [
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

    let bit_len = (data.len() as u128) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 128) != 112 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(128) {
        let mut w = [0u64; 80];
        for i in 0..16 {
            w[i] = u64::from_be_bytes(chunk[i * 8..i * 8 + 8].try_into().unwrap());
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
                .wrapping_add(K[i])
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

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn sm3_bytes(data: &[u8]) -> [u8; 32] {
    let mut state: [u32; 8] = [
        0x7380_166f,
        0x4914_b2b9,
        0x1724_42d7,
        0xda8a_0600,
        0xa96f_30bc,
        0x1631_38aa,
        0xe38d_ee4d,
        0xb0fb_0e4e,
    ];
    let mut padded = data.to_vec();
    let bit_len = (data.len() as u64) * 8;
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());
    let p0 = |x: u32| x ^ x.rotate_left(9) ^ x.rotate_left(17);
    let p1 = |x: u32| x ^ x.rotate_left(15) ^ x.rotate_left(23);
    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 68];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..68 {
            w[i] = p1(w[i - 16] ^ w[i - 9] ^ w[i - 3].rotate_left(15))
                ^ w[i - 13].rotate_left(7)
                ^ w[i - 6];
        }
        let mut a = state[0];
        let mut b = state[1];
        let mut c = state[2];
        let mut d = state[3];
        let mut e = state[4];
        let mut f = state[5];
        let mut g = state[6];
        let mut h = state[7];
        for i in 0..64 {
            let a12 = a.rotate_left(12);
            let tj = if i < 16 { 0x79cc_4519u32 } else { 0x7a87_9d8au32 };
            let ss1 = a12
                .wrapping_add(e)
                .wrapping_add(tj.rotate_left((i % 32) as u32))
                .rotate_left(7);
            let ff = if i < 16 {
                a ^ b ^ c
            } else {
                (a & b) | (a & c) | (b & c)
            };
            let gg = if i < 16 {
                e ^ f ^ g
            } else {
                (e & f) | ((!e) & g)
            };
            let tt1 = ff
                .wrapping_add(d)
                .wrapping_add(ss1 ^ a12)
                .wrapping_add(w[i] ^ w[i + 4]);
            let tt2 = gg.wrapping_add(h).wrapping_add(ss1).wrapping_add(w[i]);
            d = c;
            c = b.rotate_left(9);
            b = a;
            a = tt1;
            h = g;
            g = f.rotate_left(19);
            f = e;
            e = p0(tt2);
        }
        state[0] ^= a;
        state[1] ^= b;
        state[2] ^= c;
        state[3] ^= d;
        state[4] ^= e;
        state[5] ^= f;
        state[6] ^= g;
        state[7] ^= h;
    }
    let mut out = [0u8; 32];
    for (i, word) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn blake2b_bytes(data: &[u8], out_len: usize) -> Vec<u8> {
    const IV: [u64; 8] = [
        0x6a09e667f3bcc908,
        0xbb67ae8584caa73b,
        0x3c6ef372fe94f82b,
        0xa54ff53a5f1d36f1,
        0x510e527fade682d1,
        0x9b05688c2b3e6c1f,
        0x1f83d9abfb41bd6b,
        0x5be0cd19137e2179,
    ];
    const SIGMA: [[usize; 16]; 12] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
        [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
        [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
        [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
        [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
        [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
        [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
        [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
        [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    ];
    let nn = out_len.clamp(1, 64);
    let mut h = IV;
    h[0] ^= 0x0101_0000 ^ (nn as u64);
    let compress = |h: &mut [u64; 8], block: &[u8; 128], t: u128, last: bool| {
        let mut v = [0u64; 16];
        v[..8].copy_from_slice(h);
        v[8..16].copy_from_slice(&IV);
        v[12] ^= t as u64;
        v[13] ^= (t >> 64) as u64;
        if last {
            v[14] = !v[14];
        }
        let mut m = [0u64; 16];
        for i in 0..16 {
            m[i] = u64::from_le_bytes(block[i * 8..i * 8 + 8].try_into().unwrap());
        }
        let g = |v: &mut [u64; 16], a: usize, b: usize, c: usize, d: usize, x: u64, y: u64| {
            v[a] = v[a].wrapping_add(v[b]).wrapping_add(x);
            v[d] = (v[d] ^ v[a]).rotate_right(32);
            v[c] = v[c].wrapping_add(v[d]);
            v[b] = (v[b] ^ v[c]).rotate_right(24);
            v[a] = v[a].wrapping_add(v[b]).wrapping_add(y);
            v[d] = (v[d] ^ v[a]).rotate_right(16);
            v[c] = v[c].wrapping_add(v[d]);
            v[b] = (v[b] ^ v[c]).rotate_right(63);
        };
        for s in &SIGMA {
            g(&mut v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
            g(&mut v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
            g(&mut v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
            g(&mut v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
            g(&mut v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
            g(&mut v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
            g(&mut v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
            g(&mut v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
        }
        for i in 0..8 {
            h[i] ^= v[i] ^ v[i + 8];
        }
    };
    if data.is_empty() {
        let block = [0u8; 128];
        compress(&mut h, &block, 0, true);
    } else {
        let mut offset = 0usize;
        while offset + 128 < data.len() {
            let block: [u8; 128] = data[offset..offset + 128].try_into().unwrap();
            offset += 128;
            compress(&mut h, &block, offset as u128, false);
        }
        let mut block = [0u8; 128];
        let rem = &data[offset..];
        block[..rem.len()].copy_from_slice(rem);
        compress(&mut h, &block, data.len() as u128, true);
    }
    let mut full = [0u8; 64];
    for (i, w) in h.iter().enumerate() {
        full[i * 8..i * 8 + 8].copy_from_slice(&w.to_le_bytes());
    }
    full[..nn].to_vec()
}

fn sha3_bytes(data: &[u8], bits: usize) -> Vec<u8> {
    const RC: [u64; 24] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
        0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
        0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ];
    const ROTC: [u32; 24] = [
        1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
    ];
    const PILN: [usize; 24] = [
        10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
    ];
    let keccak_f = |st: &mut [u64; 25]| {
        for &rc in &RC {
            let mut bc = [0u64; 5];
            for i in 0..5 {
                bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
            }
            for i in 0..5 {
                let t = bc[(i + 4) % 5] ^ bc[(i + 1) % 5].rotate_left(1);
                for j in (0..25).step_by(5) {
                    st[j + i] ^= t;
                }
            }
            let mut t = st[1];
            for i in 0..24 {
                let j = PILN[i];
                let tmp = st[j];
                st[j] = t.rotate_left(ROTC[i]);
                t = tmp;
            }
            for j in (0..25).step_by(5) {
                let row = [st[j], st[j + 1], st[j + 2], st[j + 3], st[j + 4]];
                for i in 0..5 {
                    st[j + i] ^= (!row[(i + 1) % 5]) & row[(i + 2) % 5];
                }
            }
            st[0] ^= rc;
        }
    };
    let out_bytes = bits / 8;
    let rate = 200 - 2 * out_bytes;
    let mut st = [0u64; 25];
    let mut buf = data.to_vec();
    buf.push(0x06);
    while (buf.len() % rate) != rate - 1 {
        buf.push(0);
    }
    buf.push(0x80);
    for chunk in buf.chunks_exact(rate) {
        for (i, w) in chunk.chunks_exact(8).enumerate() {
            st[i] ^= u64::from_le_bytes(w.try_into().unwrap());
        }
        keccak_f(&mut st);
    }
    let mut raw = [0u8; 200];
    for (i, w) in st.iter().enumerate() {
        raw[i * 8..i * 8 + 8].copy_from_slice(&w.to_le_bytes());
    }
    raw[..out_bytes].to_vec()
}

fn compute_digest_hex_bits(algo: &str, data: &[u8], bits: usize) -> String {
    match algo {
        "sha256" => hex_encode(&sha256_bytes(data)),
        "sha224" => hex_encode(&sha224_bytes(data)),
        "sha384" => hex_encode(&sha384_bytes(data)),
        "sha512" => hex_encode(&sha512_bytes(data)),
        "sha1" => hex_encode(&sha1_bytes(data)),
        "md5" => hex_encode(&md5_bytes(data)),
        "sm3" => hex_encode(&sm3_bytes(data)),
        "blake2b" => hex_encode(&blake2b_bytes(data, (bits / 8).clamp(1, 64))),
        "sha3" => hex_encode(&sha3_bytes(data, bits)),
        _ => String::new(),
    }
}

fn cmd_hash(
    algo: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut check_mode = false;
    let mut quiet = false;
    let mut status_only = false;
    let mut strict = false;
    let mut ignore_missing = false;
    let mut binary_mode = false;
    let mut tag_mode = false;
    let mut zero_delim = false;
    let mut bits = 512usize;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-c" || a == "--check" {
            check_mode = true;
        } else if a == "--quiet" {
            quiet = true;
        } else if a == "--status" {
            status_only = true;
        } else if a == "--strict" {
            strict = true;
        } else if a == "--ignore-missing" {
            ignore_missing = true;
        } else if a == "-b" || a == "--binary" {
            binary_mode = true;
        } else if a == "--tag" {
            tag_mode = true;
        } else if a == "-z" || a == "--zero" {
            zero_delim = true;
        } else if (a == "-l" || a == "--length") && i + 1 < args.len() {
            i += 1;
            bits = args[i].parse().unwrap_or(512);
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
        }
        i += 1;
    }
    let escape_fname = |f: &str| -> (bool, String) {
        if f.contains('\\') || f.contains('\n') || f.contains('\r') {
            let esc = f
                .replace('\\', "\\\\")
                .replace('\n', "\\n")
                .replace('\r', "\\r");
            (true, esc)
        } else {
            (false, f.to_string())
        }
    };
    let unescape_fname = |f: &str| -> String {
        let mut out = String::new();
        let mut chs = f.chars();
        while let Some(c) = chs.next() {
            if c == '\\' {
                match chs.next() {
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('\\') => out.push('\\'),
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }
        out
    };

    if check_mode {
        let mut check_input = String::new();
        if files.is_empty() || files[0] == "-" {
            check_input.push_str(stdin);
        } else {
            for f in &files {
                let full = resolve_posix_path(cwd, f);
                match fs.read_file(&full) {
                    Ok(b) => check_input.push_str(&String::from_utf8_lossy(&b)),
                    Err(_) => return err_out(&format!("{algo}sum: {f}: No such file\n"), 1),
                }
            }
        }
        let mut out = String::new();
        let mut err = String::new();
        let mut malformed = 0usize;
        let mut exit_code = 0;
        for raw_line in check_input.lines() {
            let mut line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            let is_escaped = line.starts_with('\\');
            if is_escaped {
                line = &line[1..];
            }
            let (expected, raw_fname) = if let Some(open) = line.find('(')
                && let Some(close) = line.rfind(") = ")
                && open < close
            {
                (
                    line[close + 4..].trim(),
                    line[open + 1..close].trim(),
                )
            } else {
                let mut parts = line.splitn(2, char::is_whitespace);
                let exp = parts.next().unwrap_or("").trim();
                let fnm = parts
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_start_matches('*');
                (exp, fnm)
            };
            let fname = if is_escaped {
                unescape_fname(raw_fname)
            } else {
                raw_fname.to_string()
            };
            if expected.is_empty()
                || fname.is_empty()
                || !expected.chars().all(|c| c.is_ascii_hexdigit())
            {
                malformed += 1;
                continue;
            }
            let (needs_esc, disp_fname) = escape_fname(&fname);
            let disp_prefix = if needs_esc { "\\" } else { "" };
            let full = resolve_posix_path(cwd, &fname);
            match fs.read_file(&full) {
                Ok(bytes) => {
                    let actual = compute_digest_hex_bits(algo, &bytes, bits);
                    if actual.eq_ignore_ascii_case(expected) {
                        if !quiet && !status_only {
                            out.push_str(&format!("{disp_prefix}{disp_fname}: OK\n"));
                        }
                    } else {
                        if !status_only {
                            out.push_str(&format!("{disp_prefix}{disp_fname}: FAILED\n"));
                        }
                        exit_code = 1;
                    }
                }
                Err(_) => {
                    if ignore_missing {
                        continue;
                    }
                    if !status_only {
                        out.push_str(&format!("{disp_prefix}{disp_fname}: FAILED open or read\n"));
                    }
                    exit_code = 1;
                }
            }
        }
        if malformed > 0 && !status_only {
            err.push_str(&format!(
                "WARNING: {malformed} line is improperly formatted\n"
            ));
        }
        if strict && malformed > 0 {
            exit_code = 1;
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: err,
            exit_code,
        };
    }

    let term = if zero_delim { "\0" } else { "\n" };
    let format_entry = |hex: &str, f: &str| -> String {
        let (needs_esc, disp) = if zero_delim {
            (false, f.to_string())
        } else {
            escape_fname(f)
        };
        let pfx = if needs_esc { "\\" } else { "" };
        if tag_mode {
            let lbl = if algo == "blake2b" {
                if bits == 512 {
                    "BLAKE2b".to_string()
                } else {
                    format!("BLAKE2b-{bits}")
                }
            } else {
                algo.to_ascii_uppercase()
            };
            format!("{pfx}{lbl} ({disp}) = {hex}{term}")
        } else {
            let marker = if binary_mode { "*" } else { " " };
            format!("{pfx}{hex} {marker}{disp}{term}")
        }
    };

    if files.is_empty() {
        let hex = compute_digest_hex_bits(algo, &crate::vfs::stream_string_to_bytes(stdin), bits);
        return ok_out(&format_entry(&hex, "-"));
    }

    let mut out = String::new();
    let mut err = String::new();
    let mut code = 0;
    for f in &files {
        if f == "-" {
            let hex = compute_digest_hex_bits(algo, &crate::vfs::stream_string_to_bytes(stdin), bits);
            out.push_str(&format_entry(&hex, "-"));
        } else {
            let full = resolve_posix_path(cwd, f);
            match fs.read_file(&full) {
                Ok(b) => {
                    let hex = compute_digest_hex_bits(algo, &b, bits);
                    out.push_str(&format_entry(&hex, f));
                }
                Err(_) => {
                    err.push_str(&format!("{algo}sum: {f}: No such file or directory\n"));
                    code = 1;
                }
            }
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code: code,
    }
}

fn posix_crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0;
    for &b in data {
        crc ^= (b as u32) << 24;
        for _ in 0..8 {
            if (crc & 0x8000_0000) != 0 {
                crc = (crc << 1) ^ 0x04c1_1db7;
            } else {
                crc <<= 1;
            }
        }
    }
    let mut len = data.len();
    while len > 0 {
        let b = (len & 0xff) as u8;
        len >>= 8;
        crc ^= (b as u32) << 24;
        for _ in 0..8 {
            if (crc & 0x8000_0000) != 0 {
                crc = (crc << 1) ^ 0x04c1_1db7;
            } else {
                crc <<= 1;
            }
        }
    }
    !crc
}

fn cmd_cksum(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut algo = "crc".to_string();
    let mut bits: Option<usize> = None;
    let mut tag = true;
    let mut base64_mode = false;
    let mut raw_mode = false;
    let mut zero_delim = false;
    let mut binary_mode = false;
    let mut check_mode = false;
    let mut quiet = false;
    let mut status_only = false;
    let mut warn_mode = false;
    let mut strict = false;
    let mut ignore_missing = false;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        match a {
            "-a" | "--algorithm" if i + 1 < args.len() => {
                i += 1;
                algo = args[i].to_ascii_lowercase();
            }
            _ if a.starts_with("--algorithm=") => {
                algo = a["--algorithm=".len()..].to_ascii_lowercase();
            }
            _ if a.starts_with("-a") && a.len() > 2 => {
                algo = a[2..].to_ascii_lowercase();
            }
            "-l" | "--length" if i + 1 < args.len() => {
                i += 1;
                bits = args[i].parse().ok();
            }
            _ if a.starts_with("--length=") => {
                bits = a["--length=".len()..].parse().ok();
            }
            _ if a.starts_with("-l") && a.len() > 2 => {
                bits = a[2..].parse().ok();
            }
            "--tag" => tag = true,
            "--untagged" => tag = false,
            "--base64" => base64_mode = true,
            "--raw" => raw_mode = true,
            "-z" | "--zero" => zero_delim = true,
            "-b" | "--binary" => binary_mode = true,
            "-c" | "--check" => check_mode = true,
            "--quiet" => quiet = true,
            "--status" => status_only = true,
            "-w" | "--warn" => warn_mode = true,
            "--strict" => strict = true,
            "--ignore-missing" => ignore_missing = true,
            _ => {
                for ch in a[1..].chars() {
                    match ch {
                        'b' => binary_mode = true,
                        'c' => check_mode = true,
                        'z' => zero_delim = true,
                        'w' => warn_mode = true,
                        _ => {}
                    }
                }
            }
        }
        i += 1;
    }
    let resolved_bits = bits.unwrap_or(match algo.as_str() {
        "sha224" => 224,
        "sha256" | "sm3" => 256,
        "sha384" => 384,
        "md5" => 128,
        "sha1" => 160,
        _ => 512,
    });
    if algo == "sha2" {
        algo = format!("sha{resolved_bits}");
    }

    let escape_fname = |f: &str| -> (bool, String) {
        if f.contains('\\') || f.contains('\n') || f.contains('\r') {
            let mut s = String::with_capacity(f.len() + 4);
            for c in f.chars() {
                match c {
                    '\\' => s.push_str("\\\\"),
                    '\n' => s.push_str("\\n"),
                    '\r' => s.push_str("\\r"),
                    _ => s.push(c),
                }
            }
            (true, s)
        } else {
            (false, f.to_string())
        }
    };
    let unescape_fname = |f: &str| -> Option<String> {
        let mut out = String::new();
        let mut chs = f.chars();
        while let Some(c) = chs.next() {
            if c == '\\' {
                match chs.next() {
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('\\') => out.push('\\'),
                    _ => return None,
                }
            } else {
                out.push(c);
            }
        }
        Some(out)
    };

    if check_mode {
        let manifests = if files.is_empty() {
            vec!["-".to_string()]
        } else {
            files
        };
        let mut out = String::new();
        let mut err = String::new();
        let mut overall_ok = true;
        for manifest in &manifests {
            let content = if manifest == "-" {
                stdin.to_string()
            } else {
                let full = resolve_posix_path(cwd, manifest);
                match fs.read_file(&full) {
                    Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                    Err(_) => {
                        err.push_str(&format!("cksum: {manifest}: No such file or directory\n"));
                        overall_ok = false;
                        continue;
                    }
                }
            };
            let mut malformed = 0usize;
            let mut failures = 0usize;
            let mut mismatched = 0usize;
            let mut valid = false;
            let mut matched = false;
            for (line_idx, raw_line) in content.lines().enumerate() {
                let line_num = line_idx + 1;
                let mut line = raw_line.trim_end_matches('\r');
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                while line.starts_with(' ') || line.starts_with('\t') {
                    line = &line[1..];
                }
                let is_escaped = line.starts_with('\\');
                if is_escaped {
                    line = &line[1..];
                }
                let parsed_entry: Option<(String, usize, String, String)> =
                    if let Some(open) = line.find('(')
                        && let Some(close) = line.rfind(')')
                        && open < close
                    {
                        let raw_lbl = line[..open].trim_end_matches(' ');
                        let mut suffix = &line[close + 1..];
                        while suffix.starts_with(' ') || suffix.starts_with('\t') {
                            suffix = &suffix[1..];
                        }
                        if !suffix.starts_with('=') {
                            None
                        } else {
                            let mut exp = &suffix[1..];
                            while exp.starts_with(' ') || exp.starts_with('\t') {
                                exp = &exp[1..];
                            }
                            let raw_fnm = &line[open + 1..close];
                            let (la, lb) = if raw_lbl == "BLAKE2b" {
                                ("blake2b".to_string(), 512usize)
                            } else if let Some(b_str) = raw_lbl.strip_prefix("BLAKE2b-") {
                                ("blake2b".to_string(), b_str.parse().unwrap_or(0))
                            } else if let Some(b_str) = raw_lbl.strip_prefix("SHA3-") {
                                ("sha3".to_string(), b_str.parse().unwrap_or(0))
                            } else {
                                let low = raw_lbl.to_ascii_lowercase();
                                let b = match low.as_str() {
                                    "sha224" => 224,
                                    "sha256" | "sm3" => 256,
                                    "sha384" => 384,
                                    "sha512" => 512,
                                    "md5" => 128,
                                    "sha1" => 160,
                                    _ => 0,
                                };
                                (low, b)
                            };
                            if lb == 0 {
                                None
                            } else {
                                Some((la, lb, raw_fnm.to_string(), exp.to_string()))
                            }
                        }
                    } else if let Some(sep_idx) = line.find([' ', '\t']) {
                        let after = &line[sep_idx..];
                        if after.len() < 2 || !matches!(after.as_bytes()[1], b' ' | b'*') {
                            None
                        } else {
                            let exp = &line[..sep_idx];
                            let raw_fnm = &after[2..];
                            let check_algo = if algo == "crc" {
                                match exp.len() * 4 {
                                    128 => "md5".to_string(),
                                    160 => "sha1".to_string(),
                                    224 => "sha224".to_string(),
                                    256 => "sha256".to_string(),
                                    384 => "sha384".to_string(),
                                    512 => "sha512".to_string(),
                                    _ => algo.clone(),
                                }
                            } else {
                                algo.clone()
                            };
                            let lb = match check_algo.as_str() {
                                "md5" => 128,
                                "sha1" => 160,
                                "sha224" => 224,
                                "sha256" | "sm3" => 256,
                                "sha384" => 384,
                                "sha512" => 512,
                                _ => resolved_bits,
                            };
                            Some((check_algo, lb, raw_fnm.to_string(), exp.to_string()))
                        }
                    } else {
                        None
                    };

                let Some((line_algo, line_bits, raw_fnm, encoded_digest)) = parsed_entry else {
                    malformed += 1;
                    if warn_mode {
                        err.push_str(&format!(
                            "cksum: {manifest}: {line_num}: improperly formatted {algo} checksum line\n"
                        ));
                    }
                    continue;
                };
                let Some(fname) = (if is_escaped {
                    unescape_fname(&raw_fnm)
                } else {
                    Some(raw_fnm)
                }) else {
                    malformed += 1;
                    continue;
                };
                let expected_hex = if encoded_digest.len() % 2 == 0
                    && encoded_digest.chars().all(|c| c.is_ascii_hexdigit())
                    && encoded_digest.len() * 4 == line_bits
                {
                    encoded_digest.to_ascii_lowercase()
                } else if let Ok(decoded) = base64_decode_strict(&encoded_digest)
                    && base64_encode(&decoded) == encoded_digest
                    && decoded.len() * 8 == line_bits
                {
                    hex_encode(&decoded)
                } else {
                    malformed += 1;
                    if warn_mode {
                        err.push_str(&format!(
                            "cksum: {manifest}: {line_num}: improperly formatted {algo} checksum line\n"
                        ));
                    }
                    continue;
                };

                valid = true;
                let (needs_esc, disp_fname) = escape_fname(&fname);
                let disp_prefix = if needs_esc { "\\" } else { "" };
                let full = resolve_posix_path(cwd, &fname);
                match fs.read_file(&full) {
                    Ok(bytes) => {
                        let actual = compute_digest_hex_bits(&line_algo, &bytes, line_bits);
                        if actual.eq_ignore_ascii_case(&expected_hex) {
                            matched = true;
                            if !quiet && !status_only {
                                out.push_str(&format!("{disp_prefix}{disp_fname}: OK\n"));
                            }
                        } else {
                            mismatched += 1;
                            if !status_only {
                                out.push_str(&format!("{disp_prefix}{disp_fname}: FAILED\n"));
                            }
                        }
                    }
                    Err(_) => {
                        if ignore_missing && fname != "-" {
                            continue;
                        }
                        failures += 1;
                        err.push_str(&format!("cksum: {fname}: No such file or directory\n"));
                        if !status_only {
                            out.push_str(&format!("{disp_prefix}{disp_fname}: FAILED open or read\n"));
                        }
                    }
                }
            }
            if !valid {
                err.push_str(&format!(
                    "cksum: {manifest}: no properly formatted checksum lines found\n"
                ));
                overall_ok = false;
            } else {
                if !status_only {
                    if malformed > 0 {
                        err.push_str(&format!(
                            "cksum: WARNING: {malformed} improperly formatted checksum line(s)\n"
                        ));
                    }
                    if failures > 0 {
                        err.push_str(&format!(
                            "cksum: WARNING: {failures} listed file(s) could not be read\n"
                        ));
                    }
                    if mismatched > 0 {
                        err.push_str(&format!(
                            "cksum: WARNING: {mismatched} computed checksum(s) did NOT match\n"
                        ));
                    }
                    if ignore_missing && !matched {
                        err.push_str(&format!("cksum: {manifest}: no file was verified\n"));
                    }
                }
                if !(matched && failures == 0 && mismatched == 0 && (!strict || malformed == 0)) {
                    overall_ok = false;
                }
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: err,
            exit_code: if overall_ok { 0 } else { 1 },
        };
    }

    let term = if zero_delim { "\0" } else { "\n" };
    let format_for_bytes = |b: &[u8], fname: Option<&str>| -> String {
        match algo.as_str() {
            "crc" => match fname {
                Some(f) => format!("{} {} {f}{term}", posix_crc32(b), b.len()),
                None => format!("{} {}{term}", posix_crc32(b), b.len()),
            },
            "bsd" => {
                let mut crc: u32 = 0;
                for &byte in b {
                    crc = (((crc >> 1) | ((crc & 1) << 15)) + (byte as u32)) & 0xffff;
                }
                let blocks = (b.len() + 1023) / 1024;
                match fname {
                    Some(f) => format!("{crc:05} {blocks:>5} {f}{term}"),
                    None => format!("{crc:05} {blocks:>5}{term}"),
                }
            }
            "sysv" => {
                let sum: u32 = b.iter().map(|&x| x as u32).sum();
                let r = (sum & 0xffff) + (sum >> 16);
                let crc = (r & 0xffff) + (r >> 16);
                let blocks = (b.len() + 511) / 512;
                match fname {
                    Some(f) => format!("{crc} {blocks} {f}{term}"),
                    None => format!("{crc} {blocks}{term}"),
                }
            }
            "crc32b" => {
                let mut crc: u32 = 0xffff_ffff;
                for &byte in b {
                    crc ^= byte as u32;
                    for _ in 0..8 {
                        if (crc & 1) != 0 {
                            crc = (crc >> 1) ^ 0xedb8_8320;
                        } else {
                            crc >>= 1;
                        }
                    }
                }
                let final_crc = !crc;
                match fname {
                    Some(f) => format!("{final_crc} {} {f}{term}", b.len()),
                    None => format!("{final_crc} {}{term}", b.len()),
                }
            }
            _ => {
                let hex = compute_digest_hex_bits(&algo, b, resolved_bits);
                let mut raw = Vec::with_capacity(hex.len() / 2);
                let chs: Vec<char> = hex.chars().collect();
                for pair in chs.chunks(2) {
                    let s: String = pair.iter().collect();
                    if let Ok(v) = u8::from_str_radix(&s, 16) {
                        raw.push(v);
                    }
                }
                if raw_mode {
                    return crate::vfs::bytes_to_stream_string(&raw);
                }
                let encoded = if base64_mode {
                    base64_encode(&raw)
                } else {
                    hex
                };
                let f_raw = fname.unwrap_or("-");
                let (needs_esc, f_disp) = if zero_delim {
                    (false, f_raw.to_string())
                } else {
                    escape_fname(f_raw)
                };
                let pfx = if needs_esc { "\\" } else { "" };
                if tag {
                    let label = if algo == "blake2b" {
                        if resolved_bits == 512 {
                            "BLAKE2b".to_string()
                        } else {
                            format!("BLAKE2b-{resolved_bits}")
                        }
                    } else if algo == "sha3" {
                        format!("SHA3-{resolved_bits}")
                    } else {
                        algo.to_ascii_uppercase()
                    };
                    format!("{pfx}{label} ({f_disp}) = {encoded}{term}")
                } else {
                    let marker = if binary_mode { "*" } else { " " };
                    format!("{pfx}{encoded} {marker}{f_disp}{term}")
                }
            }
        }
    };

    if files.is_empty() {
        let bytes = crate::vfs::stream_string_to_bytes(stdin);
        return ok_out(&format_for_bytes(&bytes, None));
    }
    let mut out = String::new();
    for f in &files {
        if f == "-" {
            let bytes = crate::vfs::stream_string_to_bytes(stdin);
            out.push_str(&format_for_bytes(&bytes, Some("-")));
        } else {
            let full = resolve_posix_path(cwd, f);
            if let Ok(b) = fs.read_file(&full) {
                out.push_str(&format_for_bytes(&b, Some(f)));
            } else {
                return err_out(&format!("cksum: {f}: No such file or directory\n"), 1);
            }
        }
    }
    ok_out(&out)
}

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B32_CHARS: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_CHARS[((triple >> 18) & 0x3f) as usize] as char);
        out.push(B64_CHARS[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64_CHARS[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64_CHARS[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn decode_base_quantum(
    quantum: &[i16],
    q_len: usize,
    a_bits: u32,
    a_quantum: usize,
    valid_lengths: &[usize],
    out: &mut Vec<u8>,
) -> bool {
    if a_bits == 5 && q_len < a_quantum {
        return false;
    }
    let mut carry = 0u32;
    let mut bits = 0u32;
    let mut length = 0usize;
    while length < q_len && quantum[length] >= 0 {
        carry = (carry << a_bits) | (quantum[length] as u32);
        length += 1;
        bits += a_bits;
        if bits >= 8 {
            bits -= 8;
            out.push(((carry >> bits) & 0xff) as u8);
        }
        carry &= (1 << bits) - 1;
    }
    let mut valid_tail =
        q_len == a_quantum && carry == 0 && valid_lengths.contains(&length);
    if valid_tail {
        for &sym in &quantum[length..q_len] {
            if sym != -1 {
                valid_tail = false;
                break;
            }
        }
    }
    valid_tail
}

fn decode_base_stream(
    data: &[u8],
    alphabet: &[u8],
    a_bits: u32,
    a_quantum: usize,
    valid_lengths: &[usize],
    ignore_garbage: bool,
) -> Result<Vec<u8>, ()> {
    let mut lookup = [-2i16; 256];
    for (idx, &b) in alphabet.iter().enumerate() {
        lookup[b as usize] = idx as i16;
    }
    lookup[b'=' as usize] = -1;
    let mut quantum = [0i16; 8];
    let mut q_len = 0usize;
    let mut last_byte: Option<u8> = None;
    let mut out = Vec::new();
    for &byte in data {
        let symbol = lookup[byte as usize];
        if ignore_garbage && symbol == -2 {
            continue;
        }
        if byte == b'\n' || byte == b'\r' {
            continue;
        }
        last_byte = Some(byte);
        quantum[q_len] = symbol;
        q_len += 1;
        if q_len == a_quantum {
            let valid = decode_base_quantum(&quantum, q_len, a_bits, a_quantum, valid_lengths, &mut out);
            q_len = 0;
            if !valid {
                return Err(());
            }
        }
    }
    if q_len > 0 {
        if last_byte != Some(b'=') {
            while q_len < a_quantum {
                quantum[q_len] = -1;
                q_len += 1;
            }
        }
        let valid = decode_base_quantum(&quantum, q_len, a_bits, a_quantum, valid_lengths, &mut out);
        if !valid {
            return Err(());
        }
    }
    Ok(out)
}

fn base64_decode_strict(input: &str) -> Result<Vec<u8>, ()> {
    decode_base_stream(input.as_bytes(), B64_CHARS, 6, 4, &[2, 3, 4], false)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u8;
    for ch in input.chars() {
        if ch.is_whitespace() || ch == '=' {
            continue;
        }
        let val = match ch {
            'A'..='Z' => (ch as u8) - b'A',
            'a'..='z' => (ch as u8) - b'a' + 26,
            '0'..='9' => (ch as u8) - b'0' + 52,
            '+' | '-' => 62,
            '/' | '_' => 63,
            _ => continue,
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

fn run_base_cmd(
    name: &str,
    alphabet: &[u8],
    a_bits: u32,
    a_quantum: usize,
    valid_lengths: &[usize],
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut decode = false;
    let mut ignore_garbage = false;
    let mut wrap_cols: usize = 76;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            match a {
                "--decode" => decode = true,
                "--ignore-garbage" => ignore_garbage = true,
                "--wrap" if i + 1 < args.len() => {
                    i += 1;
                    match args[i].parse::<usize>() {
                        Ok(w) => wrap_cols = w,
                        Err(_) => return err_out(&format!("{name}: invalid wrap size: '{}'\n", args[i]), 1),
                    }
                }
                _ if a.starts_with("--wrap=") => {
                    let v = &a["--wrap=".len()..];
                    match v.parse::<usize>() {
                        Ok(w) => wrap_cols = w,
                        Err(_) => return err_out(&format!("{name}: invalid wrap size: '{v}'\n"), 1),
                    }
                }
                _ => return err_out(&format!("{name}: unrecognized option '{a}'\n"), 1),
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            match chars[c_idx] {
                'd' | 'D' => decode = true,
                'i' => ignore_garbage = true,
                'w' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let val_str = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(&format!("{name}: option requires an argument -- 'w'\n"), 1);
                    };
                    match val_str.parse::<usize>() {
                        Ok(w) => wrap_cols = w,
                        Err(_) => return err_out(&format!("{name}: invalid wrap size: '{val_str}'\n"), 1),
                    }
                    break;
                }
                other => return err_out(&format!("{name}: invalid option -- '{other}'\n"), 1),
            }
            c_idx += 1;
        }
        i += 1;
    }
    if files.len() > 1 {
        return err_out(&format!("{name}: extra operand '{}'\n", files[1]), 1);
    }
    let data = if files.is_empty() || files[0] == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, &files[0]);
        match fs.read_file(&full) {
            Ok(b) => b,
            Err(_) => return err_out(&format!("{name}: {}: No such file\n", files[0]), 1),
        }
    };

    if decode {
        match decode_base_stream(&data, alphabet, a_bits, a_quantum, valid_lengths, ignore_garbage) {
            Ok(bytes) => ok_out(&crate::vfs::bytes_to_stream_string(&bytes)),
            Err(()) => err_out(&format!("{name}: invalid input\n"), 1),
        }
    } else {
        if data.is_empty() {
            return ok_out("");
        }
        let mut carry = 0u32;
        let mut bits = 0u32;
        let mut symbols = 0usize;
        let mut column = 0usize;
        let mask = (1u32 << a_bits) - 1;
        let mut out: Vec<u8> = Vec::new();
        let emit_byte = |byte: u8, out: &mut Vec<u8>, symbols: &mut usize, column: &mut usize| {
            out.push(byte);
            *symbols = (*symbols + 1) % a_quantum;
            if wrap_cols > 0 {
                *column += 1;
                if *column == wrap_cols {
                    out.push(b'\n');
                    *column = 0;
                }
            }
        };
        for &b in &data {
            carry = (carry << 8) | (b as u32);
            bits += 8;
            while bits >= a_bits {
                bits -= a_bits;
                let idx = ((carry >> bits) & mask) as usize;
                emit_byte(alphabet[idx], &mut out, &mut symbols, &mut column);
            }
            carry &= (1 << bits) - 1;
        }
        if bits > 0 {
            let idx = ((carry << (a_bits - bits)) & mask) as usize;
            emit_byte(alphabet[idx], &mut out, &mut symbols, &mut column);
        }
        while symbols != 0 {
            emit_byte(b'=', &mut out, &mut symbols, &mut column);
        }
        if wrap_cols > 0 && column > 0 {
            out.push(b'\n');
        }
        ok_out(&crate::vfs::bytes_to_stream_string(&out))
    }
}

fn cmd_base64(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    run_base_cmd("base64", B64_CHARS, 6, 4, &[2, 3, 4], args, stdin, cwd, fs)
}

fn cmd_base32(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    run_base_cmd("base32", B32_CHARS, 5, 8, &[2, 4, 5, 7, 8], args, stdin, cwd, fs)
}

fn parse_xxd_num(text: &str) -> Result<usize, String> {
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        usize::from_str_radix(hex, 16).map_err(|_| format!("invalid number '{text}'"))
    } else if text.starts_with('0') && text.len() > 1 && text.chars().all(|c| ('0'..='7').contains(&c)) {
        usize::from_str_radix(text, 8).map_err(|_| format!("invalid number '{text}'"))
    } else if text == "0" || (!text.starts_with('0') && text.chars().all(|c| c.is_ascii_digit())) {
        text.parse::<usize>().map_err(|_| format!("invalid number '{text}'"))
    } else {
        Err(format!("invalid number '{text}'"))
    }
}

fn cmd_xxd(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut autoskip = false;
    let mut capitalize = false;
    let mut plain = false;
    let mut reverse = false;
    let mut decimal_addr = false;
    let mut upper_hex = false;
    let mut bits_mode = false;
    let mut c_include = false;
    let mut little_endian = false;
    let mut cols_opt: Option<usize> = None;
    let mut group_opt: Option<usize> = None;
    let mut max_len: Option<usize> = None;
    let mut seek_spec: Option<String> = None;
    let mut displacement: usize = 0;
    let mut custom_name: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();

    let mut ended = false;
    let mut normalized_args: Vec<String> = Vec::with_capacity(args.len());
    for arg in args {
        if ended {
            normalized_args.push(arg.clone());
            continue;
        }
        if arg == "--" {
            ended = true;
            normalized_args.push(arg.clone());
            continue;
        }
        let mapped = match arg.as_str() {
            "-ps" | "-plain" | "-postscript" => "-p",
            "-revert" => "-r",
            "-cols" => "-c",
            "-groupsize" => "-g",
            "-len" => "-l",
            "-bits" => "-b",
            "-include" => "-i",
            "-name" => "-n",
            "-autoskip" => "-a",
            "-capitalize" => "-C",
            other => other,
        };
        normalized_args.push(mapped.to_string());
    }

    ended = false;
    let mut i = 0usize;
    while i < normalized_args.len() {
        let a = normalized_args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            operands.push(a.to_string());
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let ch = chars[c_idx];
            match ch {
                'a' => autoskip = !autoskip,
                'C' => capitalize = true,
                'p' => plain = true,
                'r' => reverse = true,
                'd' => decimal_addr = true,
                'u' => upper_hex = true,
                'b' => bits_mode = true,
                'i' => c_include = true,
                'e' => little_endian = true,
                'c' | 'g' | 'l' | 's' | 'o' | 'n' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < normalized_args.len() {
                        i += 1;
                        normalized_args[i].clone()
                    } else {
                        return err_out(&format!("xxd: option requires an argument -- '{ch}'\n"), 2);
                    };
                    match ch {
                        'c' => match parse_xxd_num(&val) {
                            Ok(v) => cols_opt = Some(v),
                            Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
                        },
                        'g' => match parse_xxd_num(&val) {
                            Ok(v) => group_opt = Some(v),
                            Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
                        },
                        'l' => match parse_xxd_num(&val) {
                            Ok(v) => max_len = Some(v),
                            Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
                        },
                        's' => seek_spec = Some(val),
                        'o' => match parse_xxd_num(&val) {
                            Ok(v) => displacement = v,
                            Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
                        },
                        'n' => custom_name = Some(val),
                        _ => {}
                    }
                    break;
                }
                _ => return err_out(&format!("xxd: invalid option -- '{ch}'\n"), 2),
            }
            c_idx += 1;
        }
        i += 1;
    }

    if operands.len() > 2 {
        return err_out(&format!("xxd: extra operand '{}'\n", operands[2]), 2);
    }
    if (plain && (bits_mode || c_include || little_endian))
        || (little_endian && (bits_mode || c_include))
        || (bits_mode && c_include)
    {
        return err_out("xxd: incompatible display modes\n", 2);
    }
    if reverse && (bits_mode || c_include || little_endian) {
        return err_out("xxd: cannot revert this type of hexdump\n", 2);
    }

    let default_cols = if plain {
        30
    } else if c_include {
        12
    } else if bits_mode {
        6
    } else {
        16
    };
    let cols = match cols_opt {
        Some(0) if !plain => default_cols,
        Some(c) => c,
        None => default_cols,
    };
    let group_bytes = group_opt.unwrap_or(if little_endian {
        4
    } else if bits_mode {
        1
    } else {
        2
    });

    let infile = operands.first().map(|s| s.as_str()).unwrap_or("-");
    let outfile = operands.get(1).map(|s| s.as_str());

    let raw_data = if infile == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, infile);
        match fs.read_file(&full) {
            Ok(b) => b,
            Err(_) => return err_out(&format!("xxd: {infile}: No such file\n"), 2),
        }
    };

    let finish_output = |bytes: &[u8]| -> BuiltinOutcome {
        if let Some(out_name) = outfile
            && out_name != "-"
        {
            let full_out = resolve_posix_path(cwd, out_name);
            if let Err(e) = fs.write_file(&full_out, bytes) {
                return err_out(&format!("xxd: {out_name}: {e}\n"), 2);
            }
            return ok_out("");
        }
        ok_out(&crate::vfs::bytes_to_stream_string(bytes))
    };

    if reverse {
        let seek_offset = if let Some(ref spec) = seek_spec {
            let rel = spec.strip_prefix('+').unwrap_or(spec.as_str());
            if rel.starts_with('-') {
                return err_out("xxd: Sorry, cannot seek.\n", 4);
            }
            match parse_xxd_num(rel) {
                Ok(v) => v,
                Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
            }
        } else {
            0usize
        };
        let mut out_bytes: Vec<u8> = Vec::new();
        if plain {
            if seek_offset > 0 {
                out_bytes.resize(seek_offset, 0);
            }
            let mut high: Option<u8> = None;
            for &b in &raw_data {
                if b == b' ' || (9..=13).contains(&b) {
                    continue;
                }
                let digit = match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(b - b'a' + 10),
                    b'A'..=b'F' => Some(b - b'A' + 10),
                    _ => None,
                };
                if let Some(d) = digit {
                    if let Some(h) = high {
                        out_bytes.push((h << 4) | d);
                        high = None;
                    } else {
                        high = Some(d);
                    }
                } else {
                    high = None;
                }
            }
        } else {
            for line in raw_data.split(|&b| b == b'\n') {
                let trimmed_non_ws = line.iter().any(|&b| b != b' ' && !(9..=13).contains(&b));
                if !trimmed_non_ws || line == b"*" {
                    continue;
                }
                let Some(colon_pos) = line.iter().position(|&b| b == b':') else {
                    return err_out("xxd: invalid input: expected hexadecimal address and colon\n", 1);
                };
                if colon_pos == 0 || colon_pos > 14 {
                    return err_out("xxd: invalid input: expected hexadecimal address and colon\n", 1);
                }
                let mut addr = 0usize;
                for &b in &line[..colon_pos] {
                    let d = match b {
                        b'0'..=b'9' => (b - b'0') as usize,
                        b'a'..=b'f' => (b - b'a' + 10) as usize,
                        b'A'..=b'F' => (b - b'A' + 10) as usize,
                        _ => return err_out("xxd: invalid input: expected hexadecimal address and colon\n", 1),
                    };
                    addr = addr.saturating_mul(16).saturating_add(d);
                }
                addr = addr.saturating_add(seek_offset);
                if out_bytes.len() < addr {
                    out_bytes.resize(addr, 0);
                }
                let mut row_bytes: Vec<u8> = Vec::new();
                let mut high: Option<u8> = None;
                let mut spaces = 0usize;
                for &b in &line[colon_pos + 1..] {
                    if b == b' ' || b == b'\t' || b == b'\r' {
                        spaces += 1;
                        if !row_bytes.is_empty() && spaces >= 2 {
                            break;
                        }
                        continue;
                    }
                    let digit = match b {
                        b'0'..=b'9' => Some(b - b'0'),
                        b'a'..=b'f' => Some(b - b'a' + 10),
                        b'A'..=b'F' => Some(b - b'A' + 10),
                        _ => None,
                    };
                    let Some(d) = digit else {
                        break;
                    };
                    spaces = 0;
                    if let Some(h) = high {
                        row_bytes.push((h << 4) | d);
                        high = None;
                        if row_bytes.len() == cols {
                            break;
                        }
                    } else {
                        high = Some(d);
                    }
                }
                for (k, &rb) in row_bytes.iter().enumerate() {
                    if addr + k < out_bytes.len() {
                        out_bytes[addr + k] = rb;
                    } else {
                        out_bytes.push(rb);
                    }
                }
            }
        }
        return finish_output(&out_bytes);
    }

    let seek_offset: usize = if let Some(ref spec) = seek_spec {
        let rel = spec.strip_prefix('+').unwrap_or(spec.as_str());
        if let Some(neg) = rel.strip_prefix('-') {
            if infile == "-" {
                return err_out("xxd: negative seek requires an input file\n", 2);
            }
            let n = match parse_xxd_num(neg) {
                Ok(v) => v,
                Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
            };
            if n > raw_data.len() {
                return err_out("xxd: Sorry, cannot seek.\n", 4);
            }
            raw_data.len() - n
        } else {
            match parse_xxd_num(rel) {
                Ok(v) => v,
                Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
            }
        }
    } else {
        0usize
    };

    if seek_offset > raw_data.len() && infile == "-" {
        return err_out("xxd: Sorry, cannot seek.\n", 4);
    }
    let mut data = if seek_offset < raw_data.len() {
        raw_data[seek_offset..].to_vec()
    } else {
        Vec::new()
    };
    if let Some(l) = max_len {
        data.truncate(l);
    }

    if c_include {
        let mut out = String::new();
        let raw_var = custom_name.or_else(|| if infile != "-" { Some(infile.to_string()) } else { None });
        let var_name = raw_var.map(|f| {
            let mut ident: String = f
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                .collect();
            if ident.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                ident.insert_str(0, "__");
            }
            if capitalize {
                ident = ident.to_ascii_uppercase();
            }
            ident
        });
        if let Some(ref vn) = var_name {
            out.push_str(&format!("unsigned char {vn}[] = {{\n"));
        }
        let inc_cols = cols.max(1);
        let pfx = if upper_hex { "0X" } else { "0x" };
        for (c_idx, chunk) in data.chunks(inc_cols).enumerate() {
            if c_idx > 0 {
                out.push_str(",\n");
            }
            out.push_str("  ");
            let hex_items: Vec<String> = chunk
                .iter()
                .map(|b| {
                    if upper_hex {
                        format!("{pfx}{b:02X}")
                    } else {
                        format!("{pfx}{b:02x}")
                    }
                })
                .collect();
            out.push_str(&hex_items.join(", "));
        }
        if !data.is_empty() {
            out.push('\n');
        }
        if let Some(ref vn) = var_name {
            let len_sfx = if capitalize { "_LEN" } else { "_len" };
            out.push_str(&format!("}};\nunsigned int {vn}{len_sfx} = {};\n", data.len()));
        }
        return finish_output(out.as_bytes());
    }

    if plain {
        if data.is_empty() {
            return finish_output(b"");
        }
        let mut out = String::new();
        if cols == 0 {
            let mut hex = hex_encode(&data);
            if upper_hex {
                hex = hex.to_ascii_uppercase();
            }
            out.push_str(&hex);
            out.push('\n');
        } else {
            for chunk in data.chunks(cols) {
                let mut hex = hex_encode(chunk);
                if upper_hex {
                    hex = hex.to_ascii_uppercase();
                }
                out.push_str(&hex);
                out.push('\n');
            }
        }
        return finish_output(out.as_bytes());
    }

    let octets = if group_bytes == 0 { cols } else { group_bytes.min(cols) };
    let width = if little_endian {
        ((cols + octets - 1) / octets) * (octets * 2 + 1) - 1
    } else {
        cols * (if bits_mode { 8 } else { 2 }) + if group_bytes > 0 { (cols - 1) / group_bytes } else { 0 }
    };

    let mut out = String::new();
    let mut zero_run = 0usize;
    let mut zero_second = String::new();
    let mut zero_last = String::new();
    let finish_zeros = |out_buf: &mut String, z_run: &mut usize, z_sec: &str, z_last: &str, at_end: bool| {
        if *z_run >= if at_end { 4 } else { 3 } {
            out_buf.push_str("*\n");
            if at_end {
                out_buf.push_str(z_last);
            }
        } else if *z_run == 3 {
            out_buf.push_str(z_sec);
            out_buf.push_str(z_last);
        } else if *z_run == 2 {
            out_buf.push_str(z_last);
        }
        *z_run = 0;
    };

    let mut offset = seek_offset + displacement;
    for chunk in data.chunks(cols) {
        let addr_str = if decimal_addr {
            format!("{offset:08}")
        } else {
            format!("{offset:08x}")
        };
        let mut hex_data = String::new();
        let mut ascii = String::new();
        for (idx, &b) in chunk.iter().enumerate() {
            if !little_endian && group_bytes > 0 && idx > 0 && idx % group_bytes == 0 {
                hex_data.push(' ');
            }
            if !little_endian {
                if bits_mode {
                    hex_data.push_str(&format!("{b:08b}"));
                } else if upper_hex {
                    hex_data.push_str(&format!("{b:02X}"));
                } else {
                    hex_data.push_str(&format!("{b:02x}"));
                }
            }
            ascii.push(if (0x20..=0x7e).contains(&b) { b as char } else { '.' });
        }
        if little_endian {
            let mut start = 0usize;
            while start < chunk.len() {
                if start > 0 {
                    hex_data.push(' ');
                }
                for k in (start..start + octets).rev() {
                    if let Some(&b) = chunk.get(k) {
                        if upper_hex {
                            hex_data.push_str(&format!("{b:02X}"));
                        } else {
                            hex_data.push_str(&format!("{b:02x}"));
                        }
                    } else {
                        hex_data.push_str("  ");
                    }
                }
                start += octets;
            }
        }
        let formatted = format!("{addr_str}: {hex_data:<width$}  {ascii}\n");
        if autoskip && chunk.len() == cols && chunk.iter().all(|&b| b == 0) {
            if zero_run == 0 {
                out.push_str(&formatted);
            }
            if zero_run == 1 {
                zero_second = formatted.clone();
            }
            zero_run += 1;
            zero_last = formatted;
        } else {
            finish_zeros(&mut out, &mut zero_run, &zero_second, &zero_last, false);
            out.push_str(&formatted);
        }
        offset += chunk.len();
    }
    finish_zeros(&mut out, &mut zero_run, &zero_second, &zero_last, true);
    finish_output(out.as_bytes())
}

#[derive(Clone)]
enum HexdumpFormatItem {
    Standard(String),
    Custom(HexdumpCustomFormat),
}

#[derive(Clone)]
struct HexdumpConversion {
    code: String,
    flags: String,
    width: usize,
    precision: Option<usize>,
    bytes: usize,
}

#[derive(Clone)]
enum HexdumpPart {
    Literal(String),
    Conv(HexdumpConversion),
}

#[derive(Clone)]
struct HexdumpUnit {
    repeat: usize,
    bytes: usize,
    explicit_repeat: bool,
    parts: Vec<HexdumpPart>,
}

#[derive(Clone)]
struct HexdumpCustomFormat {
    units: Vec<HexdumpUnit>,
    size: usize,
    final_unit_idx: Option<usize>,
}

fn parse_hexdump_custom(text: &str) -> Result<HexdumpCustomFormat, String> {
    let bytes = text.as_bytes();
    let mut at = 0usize;
    let skip_space = |pos: &mut usize| {
        while *pos < bytes.len() && matches!(bytes[*pos], b' ' | b'\t' | b'\n' | b'\r') {
            *pos += 1;
        }
    };
    let read_int = |pos: &mut usize| -> Option<usize> {
        let start = *pos;
        while *pos < bytes.len() && bytes[*pos].is_ascii_digit() {
            *pos += 1;
        }
        if start == *pos {
            None
        } else {
            std::str::from_utf8(&bytes[start..*pos]).ok()?.parse().ok()
        }
    };
    let mut units = Vec::new();
    while at < bytes.len() {
        skip_space(&mut at);
        if at == bytes.len() {
            break;
        }
        let repeat = read_int(&mut at);
        skip_space(&mut at);
        let mut size: Option<usize> = None;
        if at < bytes.len() && bytes[at] == b'/' {
            at += 1;
            skip_space(&mut at);
            size = read_int(&mut at).filter(|&v| v > 0);
            skip_space(&mut at);
        }
        if at >= bytes.len() || bytes[at] != b'"' {
            return Err(format!("bad format: {text}"));
        }
        at += 1;
        let mut parts = Vec::new();
        let mut literal = String::new();
        while at < bytes.len() && bytes[at] != b'"' {
            let ch = bytes[at] as char;
            at += 1;
            if ch == '\\' {
                if at >= bytes.len() {
                    return Err(format!("bad format: {text}"));
                }
                let esc = bytes[at] as char;
                at += 1;
                let mapped = match esc {
                    'a' => '\x07',
                    'b' => '\x08',
                    'f' => '\x0c',
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'v' => '\x0b',
                    other => other,
                };
                literal.push(mapped);
            } else if ch != '%' {
                literal.push(ch);
            } else if at < bytes.len() && bytes[at] == b'%' {
                at += 1;
                literal.push('%');
            } else {
                if !literal.is_empty() {
                    parts.push(HexdumpPart::Literal(std::mem::take(&mut literal)));
                }
                let mut flags = String::new();
                while at < bytes.len() && "#0- +".contains(bytes[at] as char) {
                    flags.push(bytes[at] as char);
                    at += 1;
                }
                let width = read_int(&mut at).unwrap_or(0);
                let mut precision = None;
                if at < bytes.len() && bytes[at] == b'.' {
                    at += 1;
                    precision = Some(read_int(&mut at).unwrap_or(0));
                }
                if at >= bytes.len() {
                    return Err(format!("bad format: {text}"));
                }
                let mut code = String::new();
                let c0 = bytes[at] as char;
                at += 1;
                code.push(c0);
                if c0 == '_' {
                    if at >= bytes.len() {
                        return Err(format!("bad format: {text}"));
                    }
                    let c1 = bytes[at] as char;
                    at += 1;
                    code.push(c1);
                    if c1 == 'a' || c1 == 'A' {
                        if at >= bytes.len() {
                            return Err(format!("bad format: {text}"));
                        }
                        code.push(bytes[at] as char);
                        at += 1;
                    }
                }
                let conv_bytes = if code.starts_with("_a") || code.starts_with("_A") {
                    0
                } else if let Some(sz) = size {
                    sz
                } else if code == "s" {
                    precision.ok_or_else(|| format!("bad format: {text}"))?
                } else if matches!(code.as_str(), "c" | "_c" | "_p" | "_u") {
                    1
                } else {
                    4
                };
                parts.push(HexdumpPart::Conv(HexdumpConversion {
                    code,
                    flags,
                    width,
                    precision,
                    bytes: conv_bytes,
                }));
            }
        }
        if at >= bytes.len() || bytes[at] != b'"' {
            return Err(format!("bad format: {text}"));
        }
        at += 1;
        if !literal.is_empty() {
            parts.push(HexdumpPart::Literal(literal));
        }
        let unit_bytes = size.unwrap_or_else(|| {
            parts
                .iter()
                .map(|p| match p {
                    HexdumpPart::Conv(c) => c.bytes,
                    HexdumpPart::Literal(_) => 0,
                })
                .sum()
        });
        units.push(HexdumpUnit {
            repeat: repeat.unwrap_or(1),
            explicit_repeat: repeat.is_some(),
            bytes: unit_bytes,
            parts,
        });
    }
    let total_size: usize = units.iter().map(|u| u.bytes * u.repeat).sum();
    let final_unit_idx = units.iter().rposition(|u| {
        u.parts.iter().any(|p| matches!(p, HexdumpPart::Conv(c) if c.code.starts_with("_A")))
    });
    Ok(HexdumpCustomFormat {
        units,
        size: total_size,
        final_unit_idx,
    })
}

const HEXDUMP_CONTROLS: [&str; 32] = [
    "nul", "soh", "stx", "etx", "eot", "enq", "ack", "bel", "bs", "ht", "lf", "vt", "ff", "cr",
    "so", "si", "dle", "dc1", "dc2", "dc3", "dc4", "nak", "syn", "etb", "can", "em", "sub", "esc",
    "fs", "gs", "rs", "us",
];

fn format_hexdump_conv(
    conv: &HexdumpConversion,
    block: &[u8],
    offset: usize,
    used: usize,
    address: usize,
) -> String {
    if conv.bytes > 0 && offset >= used {
        return " ".repeat(conv.width);
    }
    let mut val = 0u128;
    if conv.code != "s" && !matches!(conv.code.as_str(), "e" | "E" | "f" | "g" | "G") {
        for k in (0..conv.bytes).rev() {
            let b = if offset + k < used { block[offset + k] } else { 0 };
            val = (val << 8) | (b as u128);
        }
    }
    let text = if conv.code == "s" {
        let mut end = used.min(offset + conv.bytes).min(offset + conv.precision.unwrap_or(conv.bytes));
        for k in offset..end {
            if block[k] == 0 {
                end = k;
                break;
            }
        }
        crate::vfs::bytes_to_stream_string(&block[offset..end])
    } else if matches!(conv.code.as_str(), "c" | "_p" | "_c" | "_u") {
        let byte = (val & 0xff) as u8;
        match conv.code.as_str() {
            "c" => (byte as char).to_string(),
            "_p" => {
                if (0x20..=0x7e).contains(&byte) {
                    (byte as char).to_string()
                } else {
                    ".".to_string()
                }
            }
            "_u" => {
                if (byte as usize) < HEXDUMP_CONTROLS.len() {
                    HEXDUMP_CONTROLS[byte as usize].to_string()
                } else if byte == 127 {
                    "del".to_string()
                } else if byte > 127 {
                    format!("{byte:02x}")
                } else {
                    (byte as char).to_string()
                }
            }
            _ => match byte {
                0 => "\\0".to_string(),
                7 => "\\a".to_string(),
                8 => "\\b".to_string(),
                9 => "\\t".to_string(),
                10 => "\\n".to_string(),
                11 => "\\v".to_string(),
                12 => "\\f".to_string(),
                13 => "\\r".to_string(),
                0x20..=0x7e => (byte as char).to_string(),
                _ => format!("{byte:03o}"),
            },
        }
    } else if matches!(conv.code.as_str(), "e" | "E" | "f" | "g" | "G") {
        let mut copy = [0u8; 8];
        let take = conv.bytes.min(used.saturating_sub(offset));
        copy[..take].copy_from_slice(&block[offset..offset + take]);
        let num = if conv.bytes == 4 {
            f32::from_le_bytes([copy[0], copy[1], copy[2], copy[3]]) as f64
        } else {
            f64::from_le_bytes(copy)
        };
        let prec = conv.precision.unwrap_or(6);
        format!("{num:.prec$}")
    } else {
        let is_addr = conv.code.starts_with('_');
        let raw_u = if is_addr { (address + offset) as u128 } else { val };
        let bits = conv.bytes * 8;
        let is_signed = !is_addr && (conv.code == "d" || conv.code == "i");
        let (neg, mag) = if is_signed && bits > 0 && raw_u >= (1u128 << (bits - 1)) {
            (true, (1u128 << bits) - raw_u)
        } else {
            (false, raw_u)
        };
        let kind = conv.code.chars().last().unwrap_or('d');
        let radix = match kind {
            'x' | 'X' => 16,
            'o' => 8,
            _ => 10,
        };
        let sign = if neg {
            "-"
        } else if (conv.code == "d" || conv.code == "i" || conv.code.ends_with('d')) && conv.flags.contains('+') {
            "+"
        } else if (conv.code == "d" || conv.code == "i" || conv.code.ends_with('d')) && conv.flags.contains(' ') {
            " "
        } else {
            ""
        };
        let raw_digits = if mag == 0 && conv.precision == Some(0) {
            String::new()
        } else {
            match radix {
                16 => format!("{mag:x}"),
                8 => format!("{mag:o}"),
                _ => format!("{mag}"),
            }
        };
        let prec_len = conv.precision.unwrap_or(0);
        let digits = if raw_digits.len() < prec_len {
            format!("{}{raw_digits}", "0".repeat(prec_len - raw_digits.len()))
        } else {
            raw_digits
        };
        let prefix = if conv.flags.contains('#') {
            if radix == 16 && mag != 0 {
                "0x"
            } else if radix == 8 && !digits.starts_with('0') {
                "0"
            } else {
                ""
            }
        } else {
            ""
        };
        let mut combined = if conv.flags.contains('0') && !conv.flags.contains('-') && conv.precision.is_none() {
            let pad_target = conv.width.saturating_sub(sign.len() + prefix.len());
            let padded_digits = if digits.len() < pad_target {
                format!("{}{digits}", "0".repeat(pad_target - digits.len()))
            } else {
                digits
            };
            format!("{sign}{prefix}{padded_digits}")
        } else {
            format!("{sign}{prefix}{digits}")
        };
        if kind == 'X' {
            combined = combined.to_ascii_uppercase();
        }
        combined
    };
    if text.len() >= conv.width {
        text
    } else if conv.flags.contains('-') {
        format!("{text}{}", " ".repeat(conv.width - text.len()))
    } else {
        format!("{}{text}", " ".repeat(conv.width - text.len()))
    }
}

fn format_hexdump_custom(
    fmt: &HexdumpCustomFormat,
    block: &[u8],
    used: usize,
    address: usize,
    is_final: bool,
) -> String {
    let mut offset = 0usize;
    let mut result = String::new();
    for (idx, unit) in fmt.units.iter().enumerate() {
        if is_final && Some(idx) != fmt.final_unit_idx {
            continue;
        }
        let unit_is_final = unit
            .parts
            .iter()
            .any(|p| matches!(p, HexdumpPart::Conv(c) if c.code.starts_with("_A")));
        if unit_is_final != is_final {
            if !is_final {
                offset += unit.bytes * unit.repeat;
            }
            continue;
        }
        let repeat = if !is_final
            && idx + 1 == fmt.units.len()
            && !unit.explicit_repeat
            && unit.bytes > 0
            && fmt.size < block.len()
        {
            unit.repeat + (block.len() - fmt.size) / unit.bytes
        } else {
            unit.repeat
        };
        for count in 0..repeat {
            let mut pos = offset;
            for (p_idx, part) in unit.parts.iter().enumerate() {
                match part {
                    HexdumpPart::Literal(lit) => {
                        let mut end = lit.len();
                        if count + 1 == repeat && repeat > 1 && p_idx + 1 == unit.parts.len() {
                            while end > 0 && matches!(lit.as_bytes()[end - 1], b' ' | b'\t') {
                                end -= 1;
                            }
                        }
                        result.push_str(&lit[..end]);
                    }
                    HexdumpPart::Conv(conv) => {
                        result.push_str(&format_hexdump_conv(conv, block, pos, used, address));
                        pos += conv.bytes;
                    }
                }
            }
            offset += unit.bytes;
        }
    }
    result
}

fn format_hexdump_block(block: &[u8], used: usize, address: usize, format: &str) -> String {
    let canonical = format == "C";
    let mut result = if canonical {
        format!("{address:08x}  ")
    } else {
        format!("{address:07x} ")
    };
    if canonical {
        for idx in 0..16 {
            if idx == 8 {
                result.push(' ');
            }
            if idx < used {
                result.push_str(&format!("{:02x}", block[idx]));
            } else {
                result.push_str("  ");
            }
            if idx != 15 {
                result.push(' ');
            }
        }
        result.push_str("  |");
        for &b in &block[..used] {
            result.push(if (0x20..=0x7e).contains(&b) { b as char } else { '.' });
        }
        result.push_str("|\n");
        return result;
    }
    if format != "default" {
        let byte_format = format == "b" || format == "c";
        let stride = if byte_format { 1 } else { 2 };
        let width = if byte_format { 3 } else { 7 };
        let mut idx = 0usize;
        while idx < 16 {
            let field = if idx < used {
                let byte = block[idx];
                if format == "c" {
                    match byte {
                        0 => "\\0".to_string(),
                        7 => "\\a".to_string(),
                        8 => "\\b".to_string(),
                        9 => "\\t".to_string(),
                        10 => "\\n".to_string(),
                        11 => "\\v".to_string(),
                        12 => "\\f".to_string(),
                        13 => "\\r".to_string(),
                        0x20..=0x7e => (byte as char).to_string(),
                        _ => format!("{byte:03o}"),
                    }
                } else if format == "b" {
                    format!("{byte:03o}")
                } else {
                    let hi = if idx + 1 < used { block[idx + 1] as u16 } else { 0 };
                    let word = (byte as u16) | (hi << 8);
                    match format {
                        "d" => format!("{word:05}"),
                        "o" => format!("{word:06o}"),
                        _ => format!("{word:04x}"),
                    }
                }
            } else {
                String::new()
            };
            result.push_str(&format!("{field:>width$}"));
            if idx + stride < 16 {
                result.push(' ');
            }
            idx += stride;
        }
        result.push('\n');
        return result;
    }
    let mut idx = 0usize;
    while idx < 16 {
        if idx < used {
            let hi = if idx + 1 < used { block[idx + 1] as u16 } else { 0 };
            let word = (block[idx] as u16) | (hi << 8);
            result.push_str(&format!("{word:04x}"));
        } else {
            result.push_str("    ");
        }
        if idx != 14 {
            result.push(' ');
        }
        idx += 2;
    }
    result.push('\n');
    result
}

fn parse_hexdump_num(text: &str, is_skip: bool) -> Result<usize, String> {
    let s = text.trim_start();
    let s = s.strip_prefix('+').unwrap_or(s);
    if s.starts_with('-') {
        return Err(format!("{text}: bad value"));
    }
    let (base, digits_and_suffix) = if is_skip && (s.starts_with("0x") || s.starts_with("0X")) {
        (16u32, &s[2..])
    } else if is_skip && s.starts_with('0') {
        (8u32, s)
    } else {
        (10u32, s)
    };
    let mut end = 0usize;
    for (idx, ch) in digits_and_suffix.char_indices() {
        if ch.to_digit(base).is_some() {
            end = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    let num_part = &digits_and_suffix[..end];
    let suffix = &digits_and_suffix[end..];
    let mut val = if num_part.is_empty() {
        0usize
    } else {
        usize::from_str_radix(num_part, base).map_err(|_| format!("{text}: bad value"))?
    };
    if is_skip {
        let mult = match suffix {
            "" => 1usize,
            "b" => 512,
            "k" | "K" | "KiB" => 1024,
            "m" | "M" | "MiB" => 1_048_576,
            _ => return Err(format!("{text}: bad skip value")),
        };
        val = val.saturating_mul(mult);
    }
    Ok(val)
}

fn cmd_hexdump(
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    default_canonical: bool,
) -> BuiltinOutcome {
    let name = if default_canonical { "hd" } else { "hexdump" };
    let mut ordered: Vec<HexdumpFormatItem> = if default_canonical {
        vec![HexdumpFormatItem::Standard("C".to_string())]
    } else {
        Vec::new()
    };
    let mut has_std = default_canonical;
    let mut no_squeeze = false;
    let mut skip = 0usize;
    let mut max_len: Option<usize> = None;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let flag = chars[c_idx];
            match flag {
                'v' => no_squeeze = true,
                'C' | 'b' | 'c' | 'd' | 'o' | 'x' => {
                    has_std = true;
                    ordered.push(HexdumpFormatItem::Standard(flag.to_string()));
                }
                'n' | 's' | 'e' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let param = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(&format!("{name}: option requires an argument -- '{flag}'\n"), 1);
                    };
                    if flag == 'n' {
                        match parse_hexdump_num(&param, false) {
                            Ok(v) => max_len = Some(v),
                            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
                        }
                    } else if flag == 's' {
                        match parse_hexdump_num(&param, true) {
                            Ok(v) => skip = v,
                            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
                        }
                    } else {
                        match parse_hexdump_custom(&param) {
                            Ok(cf) => ordered.push(HexdumpFormatItem::Custom(cf)),
                            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
                        }
                    }
                    break;
                }
                _ => return err_out(&format!("{name}: unsupported option -- '{flag}'\n"), 1),
            }
            c_idx += 1;
        }
        i += 1;
    }
    if ordered.is_empty() {
        has_std = true;
        ordered.push(HexdumpFormatItem::Standard("default".to_string()));
    }
    if max_len == Some(0) {
        return ok_out("");
    }
    let mut block_size = if has_std { 16usize } else { 0usize };
    for item in &ordered {
        if let HexdumpFormatItem::Custom(cf) = item {
            block_size = block_size.max(cf.size);
        }
    }
    if block_size == 0 {
        return ok_out("");
    }

    let raw = if files.is_empty() || (files.len() == 1 && files[0] == "-") {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let mut combined = Vec::new();
        for f in &files {
            if f == "-" {
                combined.extend_from_slice(&crate::vfs::stream_string_to_bytes(stdin));
            } else {
                let p = resolve_posix_path(cwd, f);
                match fs.read_file(&p) {
                    Ok(b) => combined.extend_from_slice(&b),
                    Err(e) => return err_out(&format!("{name}: {f}: {e}\n"), 1),
                }
            }
        }
        combined
    };

    let start = skip.min(raw.len());
    let mut slice = &raw[start..];
    if let Some(n) = max_len {
        slice = &slice[..n.min(slice.len())];
    }
    if slice.is_empty() {
        return ok_out("");
    }

    let mut out = String::new();
    let mut prev_block: Option<Vec<u8>> = None;
    let mut squeezing = false;
    let mut address = start;
    for chunk in slice.chunks(block_size) {
        let used = chunk.len();
        let mut block = vec![0u8; block_size];
        block[..used].copy_from_slice(chunk);
        let same = prev_block
            .as_ref()
            .is_some_and(|prev| prev[..used] == block[..used]);
        if !no_squeeze && same {
            if !squeezing {
                out.push_str("*\n");
                squeezing = true;
            }
            address += used;
            continue;
        }
        squeezing = false;
        prev_block = Some(block.clone());
        for item in &ordered {
            match item {
                HexdumpFormatItem::Standard(fmt) => {
                    out.push_str(&format_hexdump_block(&block, used, address, fmt));
                }
                HexdumpFormatItem::Custom(cf) => {
                    out.push_str(&format_hexdump_custom(cf, &block, used, address, false));
                }
            }
        }
        address += used;
    }
    let final_item = ordered.iter().rev().find(|item| match item {
        HexdumpFormatItem::Standard(_) => true,
        HexdumpFormatItem::Custom(cf) => cf.final_unit_idx.is_some(),
    });
    if let Some(item) = final_item {
        match item {
            HexdumpFormatItem::Custom(cf) => {
                let dummy = vec![0u8; block_size];
                out.push_str(&format_hexdump_custom(cf, &dummy, 0, address, true));
            }
            HexdumpFormatItem::Standard(fmt) => {
                if address > start {
                    if fmt == "C" {
                        out.push_str(&format!("{address:08x}\n"));
                    } else {
                        out.push_str(&format!("{address:07x}\n"));
                    }
                }
            }
        }
    }
    ok_out(&out)
}

#[derive(Clone)]
struct OdFormat {
    kind: char,
    size: usize,
    printable: bool,
}

fn parse_od_numeric(text: &str, allow_suffixes: bool) -> Result<usize, String> {
    let mut num_text = text;
    let mut multiplier = 1usize;
    let is_hex = text.starts_with("0x") || text.starts_with("0X");
    if allow_suffixes && !is_hex {
        for (sfx, mult) in [
            ("KiB", 1024usize),
            ("MiB", 1_048_576),
            ("GiB", 1_073_741_824),
            ("KB", 1000),
            ("MB", 1_000_000),
            ("GB", 1_000_000_000),
            ("b", 512),
            ("k", 1024),
            ("K", 1024),
            ("m", 1_048_576),
            ("M", 1_048_576),
            ("G", 1_073_741_824),
        ] {
            if let Some(prefix) = text.strip_suffix(sfx) {
                num_text = if prefix.is_empty() { "1" } else { prefix };
                multiplier = mult;
                break;
            }
        }
    }
    let parsed = if let Some(hex) = num_text.strip_prefix("0x").or_else(|| num_text.strip_prefix("0X")) {
        usize::from_str_radix(hex, 16).map_err(|_| format!("invalid number '{text}'"))?
    } else if num_text.starts_with('0') && num_text.chars().all(|c| ('0'..='7').contains(&c)) {
        usize::from_str_radix(num_text, 8).map_err(|_| format!("invalid number '{text}'"))?
    } else if !num_text.starts_with('0') && num_text.chars().all(|c| c.is_ascii_digit()) {
        num_text.parse::<usize>().map_err(|_| format!("invalid number '{text}'"))?
    } else {
        return Err(format!("invalid number '{text}'"));
    };
    Ok(parsed.saturating_mul(multiplier))
}

fn parse_od_formats(text: &str) -> Result<Vec<OdFormat>, String> {
    let mut result = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut offset = 0usize;
    while offset < chars.len() {
        let kind = chars[offset];
        offset += 1;
        let mut size = 1usize;
        if kind != 'a' && kind != 'c' {
            if !"douxf".contains(kind) {
                return Err(format!("unsupported type '{text}'"));
            }
            if let Some(&next) = chars.get(offset) {
                let mapped = match next {
                    'C' => Some(1),
                    'S' => Some(2),
                    'I' | 'F' => Some(4),
                    'L' | 'D' => Some(8),
                    '0'..='9' => next.to_digit(10).map(|d| d as usize),
                    _ => None,
                };
                if let Some(sz) = mapped {
                    size = sz;
                    offset += 1;
                } else {
                    size = if kind == 'f' { 8 } else { 4 };
                }
            } else {
                size = if kind == 'f' { 8 } else { 4 };
            }
            let valid = if kind == 'f' {
                matches!(size, 4 | 8)
            } else {
                matches!(size, 1 | 2 | 4 | 8)
            };
            if !valid {
                return Err(format!("unsupported type '{text}'"));
            }
        }
        let mut printable = false;
        if chars.get(offset) == Some(&'z') {
            printable = true;
            offset += 1;
        }
        result.push(OdFormat {
            kind,
            size,
            printable,
        });
    }
    if result.is_empty() {
        return Err("empty output type".to_string());
    }
    Ok(result)
}

fn od_field_width(fmt: &OdFormat) -> usize {
    let bits = fmt.size * 8;
    match fmt.kind {
        'a' | 'c' => 3,
        'f' => if fmt.size == 4 { 15 } else { 24 },
        'o' => (bits + 2) / 3,
        'x' => bits / 4,
        'd' => (1u128 << (bits - 1)).to_string().len() + 1,
        _ => {
            if bits == 64 {
                u64::MAX.to_string().len()
            } else {
                ((1u128 << bits) - 1).to_string().len()
            }
        }
    }
}

const OD_NAMES: [&str; 33] = [
    "nul", "soh", "stx", "etx", "eot", "enq", "ack", "bel", "bs", "ht", "nl", "vt", "ff", "cr",
    "so", "si", "dle", "dc1", "dc2", "dc3", "dc4", "nak", "syn", "etb", "can", "em", "sub", "esc",
    "fs", "gs", "rs", "us", "sp",
];

fn format_od_float(value: f64, size: usize) -> String {
    if value.is_nan() {
        return "nan".to_string();
    }
    if !value.is_finite() {
        return if value.is_sign_negative() { "-inf".to_string() } else { "inf".to_string() };
    }
    if value == 0.0 && value.is_sign_negative() {
        return "-0".to_string();
    }
    if size == 4 {
        format!("{}", value as f32)
    } else {
        format!("{value}")
    }
}

fn format_od_row(
    row: &[u8],
    fmt: &OdFormat,
    big_endian: bool,
    row_width: usize,
    chars_per_byte: f64,
) -> String {
    let mut text = String::new();
    let width = od_field_width(fmt);
    let mut offset = 0usize;
    while offset < row.len() {
        let col_end = (((offset + fmt.size) as f64) * chars_per_byte).ceil() as usize;
        let col_start = ((offset as f64) * chars_per_byte).ceil() as usize;
        let col_width = col_end.saturating_sub(col_start);
        let lead_spaces = col_width.saturating_sub(width + 1);
        text.push_str(&" ".repeat(lead_spaces));
        if fmt.size == 1 && (fmt.kind == 'x' || fmt.kind == 'o') {
            let b = row[offset];
            if fmt.kind == 'x' {
                text.push_str(&format!(" {b:02x}"));
            } else {
                text.push_str(&format!(" {b:03o}"));
            }
            offset += fmt.size;
            continue;
        }
        if fmt.kind == 'a' {
            let b = row[offset] & 127;
            let name = if (b as usize) < OD_NAMES.len() {
                OD_NAMES[b as usize].to_string()
            } else if b == 127 {
                "del".to_string()
            } else {
                (b as char).to_string()
            };
            text.push_str(&format!(" {name:>3}"));
            offset += fmt.size;
            continue;
        }
        if fmt.kind == 'f' {
            let mut bytes = [0u8; 8];
            let take = fmt.size.min(row.len() - offset);
            bytes[..take].copy_from_slice(&row[offset..offset + take]);
            let val = if fmt.size == 4 {
                let arr = [bytes[0], bytes[1], bytes[2], bytes[3]];
                (if big_endian { f32::from_be_bytes(arr) } else { f32::from_le_bytes(arr) }) as f64
            } else {
                if big_endian { f64::from_be_bytes(bytes) } else { f64::from_le_bytes(bytes) }
            };
            let s = format_od_float(val, fmt.size);
            text.push_str(&format!(" {s:>width$}"));
            offset += fmt.size;
            continue;
        }
        if fmt.kind == 'c' {
            let b = row[offset];
            let ch_str = match b {
                0 => "\\0".to_string(),
                7 => "\\a".to_string(),
                8 => "\\b".to_string(),
                9 => "\\t".to_string(),
                10 => "\\n".to_string(),
                11 => "\\v".to_string(),
                12 => "\\f".to_string(),
                13 => "\\r".to_string(),
                0x20..=0x7e => (b as char).to_string(),
                _ => format!("{b:03o}"),
            };
            text.push_str(&format!(" {ch_str:>3}"));
            offset += fmt.size;
            continue;
        }
        let mut number = 0u128;
        for idx in 0..fmt.size {
            let b = *row.get(offset + idx).unwrap_or(&0) as u128;
            let shift = if big_endian { fmt.size - idx - 1 } else { idx };
            number |= b << (shift * 8);
        }
        let bits = fmt.size * 8;
        let formatted_num = match fmt.kind {
            'o' => format!("{number:0width$o}"),
            'x' => format!("{number:0width$x}"),
            'd' => {
                let signed = if number >= (1u128 << (bits - 1)) {
                    (number as i128) - (1i128 << bits)
                } else {
                    number as i128
                };
                format!("{signed:>width$}")
            }
            _ => format!("{number:>width$}"),
        };
        text.push(' ');
        text.push_str(&formatted_num);
        offset += fmt.size;
    }
    if fmt.printable {
        let mut ascii = String::with_capacity(row.len());
        for &b in row {
            ascii.push(if (0x20..=0x7e).contains(&b) { b as char } else { '.' });
        }
        let target_len = ((row_width as f64) * chars_per_byte).ceil() as usize;
        if text.len() < target_len {
            text.push_str(&" ".repeat(target_len - text.len()));
        }
        text.push_str(&format!("  >{ascii}<"));
    }
    text
}

fn cmd_od(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut addr_radix = 'o';
    let mut big_endian = false;
    let mut verbose = false;
    let mut requested_width: usize = 16;
    let mut skip_bytes: usize = 0;
    let mut max_len: Option<usize> = None;
    let mut strings_min: Option<usize> = None;
    let mut type_specs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    let short_aliases = |ch: char| -> Option<&'static str> {
        match ch {
            'a' => Some("a"),
            'b' => Some("o1"),
            'B' | 'o' => Some("o2"),
            'c' => Some("c"),
            'd' => Some("u2"),
            'D' => Some("u4"),
            'e' | 'F' => Some("f8"),
            'f' => Some("f4"),
            'h' | 'x' => Some("x2"),
            'i' => Some("d4"),
            'I' | 'l' | 'L' => Some("d8"),
            'O' => Some("o4"),
            's' => Some("d2"),
            'X' => Some("x4"),
            _ => None,
        }
    };

    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            match a {
                "--output-duplicates" => verbose = true,
                "--strings" => strings_min = Some(3),
                _ if a.starts_with("--strings=") => {
                    match parse_od_numeric(&a["--strings=".len()..], false) {
                        Ok(v) if v >= 1 => strings_min = Some(v),
                        _ => return err_out("od: invalid strings length\n", 2),
                    }
                }
                "--width" => requested_width = 32,
                _ if a.starts_with("--width=") => {
                    match parse_od_numeric(&a["--width=".len()..], false) {
                        Ok(v) if v >= 1 => requested_width = v,
                        _ => return err_out("od: invalid width\n", 2),
                    }
                }
                "--endian=big" => big_endian = true,
                "--endian=little" => big_endian = false,
                "--endian" if i + 1 < args.len() => {
                    i += 1;
                    big_endian = args[i] == "big";
                }
                _ if a.starts_with("--address-radix=") => {
                    addr_radix = a["--address-radix=".len()..].chars().next().unwrap_or('o');
                }
                "--address-radix" if i + 1 < args.len() => {
                    i += 1;
                    addr_radix = args[i].chars().next().unwrap_or('o');
                }
                _ if a.starts_with("--skip-bytes=") => {
                    match parse_od_numeric(&a["--skip-bytes=".len()..], true) {
                        Ok(v) => skip_bytes = v,
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                "--skip-bytes" if i + 1 < args.len() => {
                    i += 1;
                    match parse_od_numeric(&args[i], true) {
                        Ok(v) => skip_bytes = v,
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                _ if a.starts_with("--read-bytes=") => {
                    match parse_od_numeric(&a["--read-bytes=".len()..], true) {
                        Ok(v) => max_len = Some(v),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                "--read-bytes" if i + 1 < args.len() => {
                    i += 1;
                    match parse_od_numeric(&args[i], true) {
                        Ok(v) => max_len = Some(v),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                _ if a.starts_with("--format=") || a.starts_with("--type=") => {
                    let eq = a.find('=').unwrap();
                    type_specs.push(a[eq + 1..].to_string());
                }
                "--format" | "--type" if i + 1 < args.len() => {
                    i += 1;
                    type_specs.push(args[i].clone());
                }
                _ => return err_out(&format!("od: unrecognized option '{a}'\n"), 2),
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let flag = chars[c_idx];
            if flag == 'v' {
                verbose = true;
            } else if flag == 'S' {
                let rest: String = chars[c_idx + 1..].iter().collect();
                if rest.is_empty() {
                    strings_min = Some(3);
                } else {
                    match parse_od_numeric(&rest, false) {
                        Ok(v) if v >= 1 => strings_min = Some(v),
                        _ => return err_out("od: invalid strings length\n", 2),
                    }
                }
                break;
            } else if flag == 'w' {
                let rest: String = chars[c_idx + 1..].iter().collect();
                if rest.is_empty() {
                    requested_width = 32;
                } else {
                    match parse_od_numeric(&rest, false) {
                        Ok(v) if v >= 1 => requested_width = v,
                        _ => return err_out("od: invalid width\n", 2),
                    }
                }
                break;
            } else if let Some(mapped) = short_aliases(flag) {
                type_specs.push(mapped.to_string());
            } else if matches!(flag, 'A' | 'j' | 'N' | 't') {
                let rest: String = chars[c_idx + 1..].iter().collect();
                let param = if !rest.is_empty() {
                    rest
                } else if i + 1 < args.len() {
                    i += 1;
                    args[i].clone()
                } else {
                    return err_out(&format!("od: option '-{flag}' requires an argument\n"), 2);
                };
                match flag {
                    'A' => addr_radix = param.chars().next().unwrap_or('o'),
                    'j' => match parse_od_numeric(&param, true) {
                        Ok(v) => skip_bytes = v,
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    },
                    'N' => match parse_od_numeric(&param, true) {
                        Ok(v) => max_len = Some(v),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    },
                    't' => type_specs.push(param),
                    _ => {}
                }
                break;
            } else {
                return err_out(&format!("od: invalid option -- '{flag}'\n"), 2);
            }
            c_idx += 1;
        }
        i += 1;
    }

    if type_specs.is_empty() {
        type_specs.push("o2".to_string());
    }
    let mut selected: Vec<OdFormat> = Vec::new();
    for spec in &type_specs {
        match parse_od_formats(spec) {
            Ok(fmts) => selected.extend(fmts),
            Err(e) => return err_out(&format!("od: {e}\n"), 2),
        }
    }

    let mut data: Vec<u8> = Vec::new();
    let mut exit_code = 0;
    let mut err_buf = String::new();
    if files.is_empty() {
        data.extend_from_slice(&crate::vfs::stream_string_to_bytes(stdin));
    } else {
        let mut used_stdin = false;
        for f in &files {
            if f == "-" {
                if !used_stdin {
                    used_stdin = true;
                    data.extend_from_slice(&crate::vfs::stream_string_to_bytes(stdin));
                }
            } else {
                let full = resolve_posix_path(cwd, f);
                match fs.read_file(&full) {
                    Ok(b) => data.extend_from_slice(&b),
                    Err(e) => {
                        exit_code = 1;
                        err_buf.push_str(&format!("od: {f}: {e}\n"));
                    }
                }
            }
        }
    }

    if skip_bytes > data.len() {
        err_buf.push_str("od: cannot skip past end of input\n");
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: err_buf,
            exit_code: 1,
        };
    }
    let mut slice = &data[skip_bytes..];
    if let Some(limit) = max_len {
        slice = &slice[..limit.min(slice.len())];
    }

    let fmt_addr = |addr: usize| -> String {
        match addr_radix {
            'n' => String::new(),
            'x' => format!("{addr:06x}"),
            'd' => format!("{addr:07}"),
            _ => format!("{addr:07o}"),
        }
    };

    if let Some(min_s) = strings_min {
        let mut out = String::new();
        let mut cur = String::new();
        let mut start_addr = String::new();
        let mut offset = skip_bytes;
        for &b in slice {
            if (32..=126).contains(&b) {
                if cur.is_empty() {
                    start_addr = fmt_addr(offset);
                }
                cur.push(b as char);
            } else {
                if b == 0 && cur.len() >= min_s {
                    if start_addr.is_empty() {
                        out.push_str(&format!("{cur}\n"));
                    } else {
                        out.push_str(&format!("{start_addr} {cur}\n"));
                    }
                }
                cur.clear();
            }
            offset += 1;
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: err_buf,
            exit_code,
        };
    }

    let alignment = selected.iter().map(|f| f.size).max().unwrap_or(1);
    let width = if requested_width % alignment == 0 {
        requested_width
    } else {
        alignment
    };
    let chars_per_byte = selected
        .iter()
        .map(|f| ((od_field_width(f) + 1) as f64) / (f.size as f64))
        .fold(0.0f64, f64::max);

    let mut out = String::new();
    let mut prev_row: Option<&[u8]> = None;
    let mut suppressed = false;
    let mut offset = skip_bytes;
    for row in slice.chunks(width) {
        if !verbose && prev_row == Some(row) {
            if !suppressed {
                out.push_str("*\n");
                suppressed = true;
            }
        } else {
            let addr = fmt_addr(offset);
            let pad = if selected.len() > 1 {
                " ".repeat(addr.len())
            } else {
                String::new()
            };
            for (idx, fmt) in selected.iter().enumerate() {
                let prefix = if idx == 0 { addr.as_str() } else { pad.as_str() };
                out.push_str(prefix);
                out.push_str(&format_od_row(row, fmt, big_endian, width, chars_per_byte));
                out.push('\n');
            }
            prev_row = Some(row);
            suppressed = false;
        }
        offset += row.len();
    }
    if addr_radix != 'n' {
        out.push_str(&format!("{}\n", fmt_addr(offset)));
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

struct TarEntry {
    name: String,
    typeflag: u8,
    mode: u32,
    mtime: u64,
    uid: u32,
    gid: u32,
    linkname: String,
    content: Vec<u8>,
}

fn serialize_ustar_archive(entries: &[TarEntry]) -> Vec<u8> {
    let mut out_bytes = Vec::new();
    for entry in entries {
        let header = build_ustar_header(
            &entry.name,
            entry.typeflag,
            entry.mode,
            entry.mtime,
            entry.uid,
            entry.gid,
            &entry.linkname,
            entry.content.len(),
        );
        out_bytes.extend_from_slice(&header);
        if entry.typeflag == b'0' && !entry.content.is_empty() {
            out_bytes.extend_from_slice(&entry.content);
            let rem = entry.content.len() % 512;
            if rem != 0 {
                out_bytes.resize(out_bytes.len() + (512 - rem), 0);
            }
        }
    }
    out_bytes.resize(out_bytes.len() + 1024, 0);
    out_bytes
}

#[derive(Clone, Debug)]
struct TarOperand {
    name: String,
    cwd: String,
    exclude_count: usize,
    recursion: bool,
}

fn tar_unquote_filename(name: &str) -> String {
    let bytes = name.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\\' && i + 1 < bytes.len() {
            let next = bytes[i + 1];
            let esc = match next {
                b'a' => Some(7u8),
                b'b' => Some(8u8),
                b'f' => Some(12u8),
                b'n' => Some(10u8),
                b'r' => Some(13u8),
                b't' => Some(9u8),
                b'v' => Some(11u8),
                b'\\' => Some(92u8),
                _ => None,
            };
            if let Some(code) = esc {
                out.push(code);
                i += 2;
                continue;
            }
            if i + 3 < bytes.len()
                && (b'0'..=b'7').contains(&bytes[i + 1])
                && (b'0'..=b'7').contains(&bytes[i + 2])
                && (b'0'..=b'7').contains(&bytes[i + 3])
            {
                let val = ((bytes[i + 1] - b'0') as u16 * 64
                    + (bytes[i + 2] - b'0') as u16 * 8
                    + (bytes[i + 3] - b'0') as u16) as u8;
                out.push(val);
                i += 4;
                continue;
            }
        }
        out.push(b);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn tar_quote_name(name: &str, style: &str) -> String {
    if style == "literal" {
        return name.to_string();
    }
    let mut out = String::new();
    if style == "c" {
        out.push('"');
    }
    for ch in name.chars() {
        match ch {
            '\x07' => out.push_str("\\a"),
            '\x08' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\x0b' => out.push_str("\\v"),
            '\x0c' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            '"' if style == "c" => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 32
                || ((c as u32) >= 127 && (c as u32) <= 159)
                || c == '\u{2028}'
                || c == '\u{2029}' =>
            {
                let mut buf = [0u8; 4];
                for &b in c.encode_utf8(&mut buf).as_bytes() {
                    out.push_str(&format!("\\{b:03o}"));
                }
            }
            c => out.push(c),
        }
    }
    if style == "c" {
        out.push('"');
    }
    out
}

fn tar_strip_components(name: &str, strip: usize, is_dir: bool) -> Option<String> {
    if strip == 0 {
        return Some(name.to_string());
    }
    let components: Vec<&str> = name
        .trim_start_matches('/')
        .split('/')
        .filter(|c| !c.is_empty())
        .collect();
    if components.len() <= strip {
        return None;
    }
    let stripped: Vec<&str> = components[strip..]
        .iter()
        .copied()
        .filter(|&c| c != ".")
        .collect();
    let joined = stripped.join("/");
    if is_dir && !joined.is_empty() {
        Some(format!("{joined}/"))
    } else {
        Some(joined)
    }
}

fn cmd_tar(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut create = false;
    let mut extract = false;
    let mut list = false;
    let mut append_mode = false;
    let mut update_mode = false;
    let mut delete_mode = false;
    let mut diff_mode = false;
    let mut catenate_mode = false;
    let mut to_stdout = false;
    let mut null_delim = false;
    let mut verbatim_files_from = false;
    let mut skip_old_files = false;
    let mut keep_old_files = false;
    let mut exclude_caches = false;
    let mut show_transformed = false;
    let mut dereference = false;
    let mut recursion = true;
    let mut sort_by_name = false;
    let mut use_compress = false;
    let mut verbose = false;
    let mut totals = false;
    let mut utc = false;
    let mut full_time = false;
    let mut wildcards = false;
    let mut quoting_style = "escape".to_string();
    let mut occurrence: Option<usize> = None;
    let mut archive_file: Option<String> = None;
    let mut current_dir = cwd.to_string();
    let mut strip_components = 0usize;
    let mut override_mode: Option<u32> = None;
    let mut override_mtime: Option<u64> = None;
    let mut override_uid: Option<u32> = None;
    let mut override_gid: Option<u32> = None;
    let mut excludes: Vec<String> = Vec::new();
    let mut transforms: Vec<String> = Vec::new();
    let mut operands: Vec<TarOperand> = Vec::new();
    let mut pending_files_from: Vec<(String, bool, bool)> = Vec::new();

    let read_exclude_file = |xf: &str, excludes: &mut Vec<String>| {
        let raw = if xf == "-" {
            stdin.to_string()
        } else {
            let ex_path = resolve_posix_path(cwd, xf);
            fs.read_file(&ex_path)
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default()
        };
        for line in raw.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                excludes.push(trimmed.to_string());
            }
        }
    };

    let process_files_from =
        |ff: &str,
         list_null: bool,
         list_verbatim: bool,
         cur_dir: &mut String,
         excludes_len: usize,
         rec: bool,
         ops: &mut Vec<TarOperand>| {
            let raw = if ff == "-" {
                stdin.to_string()
            } else {
                let full = resolve_posix_path(cwd, ff);
                fs.read_file(&full)
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
                    .unwrap_or_default()
            };
            if list_null {
                for item in raw.split('\0') {
                    let t = item.trim_matches(|c: char| c == '\n' || c == '\r');
                    if !t.is_empty() {
                        ops.push(TarOperand {
                            name: t.to_string(),
                            cwd: cur_dir.clone(),
                            exclude_count: excludes_len,
                            recursion: rec,
                        });
                    }
                }
            } else {
                let lines: Vec<&str> = raw.split('\n').collect();
                let mut li = 0usize;
                while li < lines.len() {
                    let line = lines[li].trim_end_matches('\r');
                    if line.is_empty() {
                        li += 1;
                        continue;
                    }
                    if !list_verbatim && line.starts_with('-') {
                        if line == "-C" {
                            if li + 1 < lines.len() {
                                li += 1;
                                *cur_dir = resolve_posix_path(cur_dir, lines[li].trim_end_matches('\r'));
                            }
                        } else if let Some(rest) = line.strip_prefix("-C") {
                            *cur_dir = resolve_posix_path(cur_dir, rest);
                        } else if let Some(rest) = line.strip_prefix("--directory=") {
                            *cur_dir = resolve_posix_path(cur_dir, rest);
                        }
                    } else {
                        let name = if !list_verbatim {
                            tar_unquote_filename(line)
                        } else {
                            line.to_string()
                        };
                        ops.push(TarOperand {
                            name,
                            cwd: cur_dir.clone(),
                            exclude_count: excludes_len,
                            recursion: rec,
                        });
                    }
                    li += 1;
                }
            }
        };

    let mut i = 0usize;
    let mut end_of_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if !end_of_opts {
            if (a == "-C" || a == "--directory") && i + 1 < args.len() {
                i += 1;
                current_dir = resolve_posix_path(&current_dir, &args[i]);
                i += 1;
                continue;
            }
            if let Some(d) = a.strip_prefix("--directory=") {
                current_dir = resolve_posix_path(&current_dir, d);
                i += 1;
                continue;
            }
            if (a == "-f" || a == "--file") && i + 1 < args.len() {
                i += 1;
                archive_file = Some(args[i].clone());
                i += 1;
                continue;
            }
            if let Some(f) = a.strip_prefix("--file=") {
                archive_file = Some(f.to_string());
                i += 1;
                continue;
            }
            if (a == "-X" || a == "--exclude-from") && i + 1 < args.len() {
                i += 1;
                read_exclude_file(&args[i], &mut excludes);
                i += 1;
                continue;
            }
            if let Some(xf) = a.strip_prefix("--exclude-from=") {
                read_exclude_file(xf, &mut excludes);
                i += 1;
                continue;
            }
            if (a == "--transform" || a == "--xform") && i + 1 < args.len() {
                i += 1;
                transforms.push(args[i].clone());
                i += 1;
                continue;
            }
            if let Some(tr) = a.strip_prefix("--transform=").or_else(|| a.strip_prefix("--xform=")) {
                transforms.push(tr.to_string());
                i += 1;
                continue;
            }
            if a == "--sort" && i + 1 < args.len() {
                i += 1;
                if args[i] == "name" {
                    sort_by_name = true;
                }
                i += 1;
                continue;
            }
            if let Some(s) = a.strip_prefix("--sort=") {
                if s == "name" {
                    sort_by_name = true;
                }
                i += 1;
                continue;
            }
            if a == "--quoting-style" && i + 1 < args.len() {
                i += 1;
                quoting_style = args[i].clone();
                i += 1;
                continue;
            }
            if let Some(qs) = a.strip_prefix("--quoting-style=") {
                quoting_style = qs.to_string();
                i += 1;
                continue;
            }
            if a == "--mode" && i + 1 < args.len() {
                i += 1;
                let m = &args[i];
                override_mode = u32::from_str_radix(m.trim_start_matches('0'), 8)
                    .ok()
                    .or_else(|| u32::from_str_radix(m, 8).ok());
                i += 1;
                continue;
            }
            if let Some(m) = a.strip_prefix("--mode=") {
                override_mode = u32::from_str_radix(m.trim_start_matches('0'), 8)
                    .ok()
                    .or_else(|| u32::from_str_radix(m, 8).ok());
                i += 1;
                continue;
            }
            if a == "--mtime" && i + 1 < args.len() {
                i += 1;
                let clean = args[i].trim_matches(|c| c == '\'' || c == '"');
                if let Some(sec) = clean.strip_prefix('@') {
                    override_mtime = sec.parse::<u64>().ok();
                }
                i += 1;
                continue;
            }
            if let Some(mt) = a.strip_prefix("--mtime=") {
                let clean = mt.trim_matches(|c| c == '\'' || c == '"');
                if let Some(sec) = clean.strip_prefix('@') {
                    override_mtime = sec.parse::<u64>().ok();
                }
                i += 1;
                continue;
            }
            if a == "--owner" && i + 1 < args.len() {
                i += 1;
                override_uid = args[i].trim_start_matches(':').parse::<u32>().ok().or(Some(0));
                i += 1;
                continue;
            }
            if let Some(ow) = a.strip_prefix("--owner=") {
                override_uid = ow.trim_start_matches(':').parse::<u32>().ok().or(Some(0));
                i += 1;
                continue;
            }
            if a == "--group" && i + 1 < args.len() {
                i += 1;
                override_gid = args[i].trim_start_matches(':').parse::<u32>().ok().or(Some(0));
                i += 1;
                continue;
            }
            if let Some(gr) = a.strip_prefix("--group=") {
                override_gid = gr.trim_start_matches(':').parse::<u32>().ok().or(Some(0));
                i += 1;
                continue;
            }
            if a == "--format" && i + 1 < args.len() {
                i += 2;
                continue;
            }
            if a.starts_with("--format=") || a.starts_with("--record-size=") || a.starts_with("--atime-preserve") {
                i += 1;
                continue;
            }
            if (a == "-b" || a == "--blocking-factor" || a == "--record-size") && i + 1 < args.len() {
                i += 2;
                continue;
            }
            if (a == "-T" || a == "--files-from") && i + 1 < args.len() {
                i += 1;
                let ff = args[i].clone();
                pending_files_from.push((ff, null_delim, verbatim_files_from));
                i += 1;
                continue;
            }
            if let Some(ff) = a.strip_prefix("--files-from=") {
                pending_files_from.push((ff.to_string(), null_delim, verbatim_files_from));
                i += 1;
                continue;
            }
            if a == "--exclude" && i + 1 < args.len() {
                i += 1;
                excludes.push(args[i].clone());
                i += 1;
                continue;
            }
            if let Some(ex) = a.strip_prefix("--exclude=") {
                excludes.push(ex.to_string());
                i += 1;
                continue;
            }
            if a == "--strip-components" && i + 1 < args.len() {
                i += 1;
                strip_components = args[i].parse().unwrap_or(0);
                i += 1;
                continue;
            }
            if let Some(sc) = a.strip_prefix("--strip-components=") {
                strip_components = sc.parse().unwrap_or(0);
                i += 1;
                continue;
            }
            if a == "--occurrence" {
                occurrence = Some(1);
                i += 1;
                continue;
            }
            if let Some(occ) = a.strip_prefix("--occurrence=") {
                occurrence = occ.parse::<usize>().ok().or(Some(1));
                i += 1;
                continue;
            }
            if a.starts_with("--") {
                match a.as_str() {
                    "--create" => create = true,
                    "--extract" | "--get" => extract = true,
                    "--list" => list = true,
                    "--delete" => delete_mode = true,
                    "--append" => append_mode = true,
                    "--update" => update_mode = true,
                    "--diff" | "--compare" => diff_mode = true,
                    "--catenate" | "--concatenate" => catenate_mode = true,
                    "--to-stdout" => to_stdout = true,
                    "--null" => {
                        null_delim = true;
                        verbatim_files_from = true;
                    }
                    "--no-null" => null_delim = false,
                    "--verbatim-files-from" => verbatim_files_from = true,
                    "--no-verbatim-files-from" => verbatim_files_from = false,
                    "--no-recursion" => recursion = false,
                    "--recursion" => recursion = true,
                    "--skip-old-files" => skip_old_files = true,
                    "--keep-old-files" => keep_old_files = true,
                    "--overwrite" => {
                        skip_old_files = false;
                        keep_old_files = false;
                    }
                    "--exclude-caches" => exclude_caches = true,
                    "--show-transformed-names" | "--show-stored-names" => show_transformed = true,
                    "--dereference" => dereference = true,
                    "--totals" => totals = true,
                    "--utc" => {
                        utc = true;
                        verbose = true;
                    }
                    "--full-time" => full_time = true,
                    "--wildcards" => wildcards = true,
                    "--no-wildcards" => wildcards = false,
                    "--verbose" => verbose = true,
                    "--gzip" | "--gunzip" | "--bzip2" | "--xz" | "--zstd" | "--auto-compress" => {
                        use_compress = true;
                    }
                    _ => {}
                }
                i += 1;
                continue;
            }
            if (a.starts_with('-') && a != "-")
                || (i == 0 && !a.is_empty() && a.chars().all(|ch| "ctxrudAzjJavfCTXmpkhbBinO".contains(ch)))
            {
                let old_style = !a.starts_with('-');
                let flags = a.trim_start_matches('-');
                let chars: Vec<char> = flags.chars().collect();
                let mut ci = 0usize;
                let mut matched_flag = false;
                while ci < chars.len() {
                    match chars[ci] {
                        'c' => {
                            create = true;
                            matched_flag = true;
                        }
                        'x' => {
                            extract = true;
                            matched_flag = true;
                        }
                        't' => {
                            list = true;
                            matched_flag = true;
                        }
                        'r' => {
                            append_mode = true;
                            matched_flag = true;
                        }
                        'u' => {
                            update_mode = true;
                            matched_flag = true;
                        }
                        'd' => {
                            diff_mode = true;
                            matched_flag = true;
                        }
                        'A' => {
                            catenate_mode = true;
                            matched_flag = true;
                        }
                        'O' => {
                            to_stdout = true;
                            matched_flag = true;
                        }
                        'k' => {
                            keep_old_files = true;
                            matched_flag = true;
                        }
                        'h' => {
                            dereference = true;
                            matched_flag = true;
                        }
                        'v' => {
                            verbose = true;
                            matched_flag = true;
                        }
                        'z' | 'j' | 'J' | 'a' => {
                            use_compress = true;
                            matched_flag = true;
                        }
                        'p' | 'm' | 'B' | 'i' | 'n' => {
                            matched_flag = true;
                        }
                        'f' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                archive_file = Some(rest);
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                archive_file = Some(args[i].clone());
                            }
                        }
                        'C' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                current_dir = resolve_posix_path(&current_dir, &rest);
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                current_dir = resolve_posix_path(&current_dir, &args[i]);
                            }
                        }
                        'T' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                pending_files_from.push((rest, null_delim, verbatim_files_from));
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                pending_files_from.push((args[i].clone(), null_delim, verbatim_files_from));
                            }
                        }
                        'X' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                read_exclude_file(&rest, &mut excludes);
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                read_exclude_file(&args[i], &mut excludes);
                            }
                        }
                        'b' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                            }
                        }
                        _ => {}
                    }
                    ci += 1;
                }
                if matched_flag {
                    i += 1;
                    continue;
                }
            }
        }
        operands.push(TarOperand {
            name: a.clone(),
            cwd: current_dir.clone(),
            exclude_count: excludes.len(),
            recursion,
        });
        i += 1;
    }

    for (ff, list_null, list_verbatim) in pending_files_from {
        let final_null = list_null || null_delim;
        let final_verbatim = list_verbatim || verbatim_files_from || final_null;
        process_files_from(
            &ff,
            final_null,
            final_verbatim,
            &mut current_dir,
            excludes.len(),
            recursion,
            &mut operands,
        );
    }

    if create {
        let mut entries: Vec<TarEntry> = Vec::new();
        let mut create_stderr = String::new();
        for op in &operands {
            if op.name.contains("..") {
                create_stderr.push_str(&format!(
                    "tar: {}: Member name contains '..' (removing member-name prefix through '..')\n",
                    op.name
                ));
            }
            collect_tar_entries(
                &op.name,
                &op.cwd,
                &excludes[..op.exclude_count.min(excludes.len())],
                exclude_caches,
                dereference,
                sort_by_name,
                op.recursion,
                fs,
                &mut entries,
            );
        }
        for entry in &mut entries {
            if let Some(m) = override_mode {
                entry.mode = m;
            }
            if let Some(mt) = override_mtime {
                entry.mtime = mt;
            }
            if let Some(u) = override_uid {
                entry.uid = u;
            }
            if let Some(g) = override_gid {
                entry.gid = g;
            }
        }
        if !transforms.is_empty() {
            for entry in &mut entries {
                entry.name = apply_tar_transforms(&entry.name, &transforms);
            }
        }
        let mut verbose_out = String::new();
        for entry in &entries {
            if verbose {
                verbose_out.push_str(&format!("{}\n", tar_quote_name(&entry.name, &quoting_style)));
            }
        }
        let raw_tar = serialize_ustar_archive(&entries);
        if totals {
            create_stderr.push_str(&format!("Total bytes written: {}\n", raw_tar.len()));
        }
        let out_bytes = if use_compress {
            gzip_compress_stored(&raw_tar)
        } else {
            raw_tar
        };

        if let Some(af) = archive_file {
            if af != "-" {
                let full = resolve_posix_path(cwd, &af);
                if let Err(e) = fs.write_file(&full, &out_bytes) {
                    return err_out(&format!("tar: {}\n", e), 2);
                }
                return BuiltinOutcome {
                    stdout: verbose_out,
                    stderr: create_stderr,
                    exit_code: 0,
                };
            }
        }
        return BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
            stderr: create_stderr,
            exit_code: 0,
        };
    }

    let match_tar_operands = |entry_name: &str,
                              operands: &[TarOperand],
                              wildcards: bool,
                              occurrence: Option<usize>,
                              occ_counts: &mut [usize],
                              matched_ops: &mut [bool],
                              default_root: &str|
     -> (bool, String) {
        if operands.is_empty() {
            return (true, default_root.to_string());
        }
        let name = entry_name.trim_start_matches('/');
        let norm_name = name.trim_start_matches("./");
        let plain_name = name.trim_end_matches('/');
        let plain_norm = norm_name.trim_end_matches('/');
        let mut selected = false;
        let mut chosen_root = default_root.to_string();
        for (idx, op) in operands.iter().enumerate() {
            let wanted = op.name.trim_start_matches('/').trim_end_matches('/');
            let norm_wanted = wanted.trim_start_matches("./");
            let is_match = if wildcards {
                crate::shell::expand::glob_match(wanted, plain_name)
                    || crate::shell::expand::glob_match(norm_wanted, plain_norm)
                    || tar_matches_exclude(plain_name, std::slice::from_ref(&op.name))
            } else {
                plain_name == wanted
                    || name.starts_with(&format!("{wanted}/"))
                    || (!norm_wanted.is_empty()
                        && (plain_norm == norm_wanted || norm_name.starts_with(&format!("{norm_wanted}/"))))
                    || crate::shell::expand::glob_match(wanted, plain_name)
                    || crate::shell::expand::glob_match(norm_wanted, plain_norm)
            };
            if is_match {
                occ_counts[idx] += 1;
                if let Some(occ) = occurrence
                    && occ_counts[idx] != occ
                {
                    continue;
                }
                if !selected {
                    chosen_root = op.cwd.clone();
                }
                selected = true;
                matched_ops[idx] = true;
            }
        }
        (selected, chosen_root)
    };

    if append_mode || update_mode || delete_mode || catenate_mode {
        let Some(ref af) = archive_file else {
            return err_out("tar: archive file required\n", 2);
        };
        let full = resolve_posix_path(cwd, af);
        let existing_bytes = fs.read_file(&full).unwrap_or_default();
        let mut entries = parse_ustar_archive(&existing_bytes);
        let mut stderr = String::new();
        let mut exit_code = 0;
        if append_mode || update_mode {
            let mut new_entries = Vec::new();
            for op in &operands {
                collect_tar_entries(
                    &op.name,
                    &op.cwd,
                    &excludes[..op.exclude_count.min(excludes.len())],
                    exclude_caches,
                    dereference,
                    sort_by_name,
                    op.recursion,
                    fs,
                    &mut new_entries,
                );
            }
            for mut ne in new_entries {
                if !transforms.is_empty() {
                    ne.name = apply_tar_transforms(&ne.name, &transforms);
                }
                if update_mode {
                    let unchanged = entries
                        .iter()
                        .rev()
                        .find(|e| e.name == ne.name)
                        .is_some_and(|e| ne.mtime < e.mtime || (ne.mtime == e.mtime && e.content == ne.content));
                    if !unchanged {
                        entries.push(ne);
                    }
                } else {
                    entries.push(ne);
                }
            }
        } else if delete_mode {
            let mut occ_counts = vec![0usize; operands.len()];
            let mut matched_ops = vec![false; operands.len()];
            let mut retained = Vec::with_capacity(entries.len());
            for e in entries {
                let (sel, _) = match_tar_operands(
                    &e.name,
                    &operands,
                    wildcards,
                    occurrence,
                    &mut occ_counts,
                    &mut matched_ops,
                    &current_dir,
                );
                let excluded = !excludes.is_empty() && tar_matches_exclude(&e.name, &excludes);
                if !(sel && !excluded) {
                    retained.push(e);
                }
            }
            entries = retained;
            for (idx, &m) in matched_ops.iter().enumerate() {
                if !m {
                    stderr.push_str(&format!("tar: member not found: {}\n", operands[idx].name));
                    exit_code = 2;
                }
            }
        } else if catenate_mode {
            for op in &operands {
                let t_full = resolve_posix_path(&op.cwd, &op.name);
                if let Ok(tb) = fs.read_file(&t_full) {
                    entries.extend(parse_ustar_archive(&tb));
                }
            }
        }
        let out_bytes = serialize_ustar_archive(&entries);
        if totals {
            stderr.push_str(&format!("Total bytes written: {}\n", out_bytes.len()));
        }
        let _ = fs.write_file(&full, &out_bytes);
        return BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        };
    }

    let archive_bytes = if let Some(ref af) = archive_file {
        if af == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, af);
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => return err_out(&format!("tar: {af}: Cannot open\n"), 2),
            }
        }
    } else {
        crate::vfs::stream_string_to_bytes(stdin)
    };

    let parsed = parse_ustar_archive(&archive_bytes);
    if !archive_bytes.is_empty()
        && !archive_bytes.iter().all(|&b| b == 0)
        && parsed.is_empty()
    {
        return err_out("tar: This does not look like a tar archive\n", 2);
    }
    if diff_mode {
        let mut diff_out = String::new();
        let mut diff_code = 0;
        let mut occ_counts = vec![0usize; operands.len()];
        let mut matched_ops = vec![false; operands.len()];
        for entry in parsed {
            let (sel, entry_root) = match_tar_operands(
                &entry.name,
                &operands,
                wildcards,
                occurrence,
                &mut occ_counts,
                &mut matched_ops,
                &current_dir,
            );
            if !sel || (!excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes)) {
                continue;
            }
            let dest = resolve_posix_path(&entry_root, &entry.name);
            if entry.typeflag == b'2' {
                match fs.readlink(&dest) {
                    Ok(actual_target) => {
                        if actual_target != entry.linkname {
                            diff_out.push_str(&format!("{}: Symlink differs\n", entry.name));
                            diff_code = 1;
                        }
                    }
                    Err(_) => {
                        if fs.exists(&dest) {
                            diff_out.push_str(&format!("{}: File type differs\n", entry.name));
                        } else {
                            diff_out.push_str(&format!("{}: File is missing\n", entry.name));
                        }
                        diff_code = 1;
                    }
                }
            } else if entry.typeflag == b'5' {
                if !fs.exists(&dest) {
                    diff_out.push_str(&format!("{}: File is missing\n", entry.name));
                    diff_code = 1;
                } else if !fs.is_dir(&dest) {
                    diff_out.push_str(&format!("{}: File type differs\n", entry.name));
                    diff_code = 1;
                }
            } else if entry.typeflag == b'0' {
                if fs.readlink(&dest).is_ok() || fs.is_dir(&dest) {
                    diff_out.push_str(&format!("{}: File type differs\n", entry.name));
                    diff_code = 1;
                    continue;
                }
                match fs.read_file(&dest) {
                    Ok(disk_bytes) => {
                        if let Ok(st) = fs.stat(&dest) {
                            if (st.mode & 0o7777) != (entry.mode & 0o7777) {
                                diff_out.push_str(&format!("{}: Mode differs\n", entry.name));
                                diff_code = 1;
                            }
                            if (st.mtime_ms / 1000) != entry.mtime {
                                diff_out.push_str(&format!("{}: Mod time differs\n", entry.name));
                                diff_code = 1;
                            }
                        }
                        if disk_bytes.len() != entry.content.len() {
                            diff_out.push_str(&format!("{}: Size differs\n", entry.name));
                            diff_code = 1;
                        } else if disk_bytes != entry.content {
                            diff_out.push_str(&format!("{}: Contents differ\n", entry.name));
                            diff_code = 1;
                        } else if verbose {
                            diff_out.push_str(&format!("{}\n", tar_quote_name(&entry.name, &quoting_style)));
                        }
                    }
                    Err(_) => {
                        diff_out.push_str(&format!("{}: File is missing\n", entry.name));
                        diff_code = 1;
                    }
                }
            }
        }
        return BuiltinOutcome {
            stdout: diff_out,
            stderr: String::new(),
            exit_code: diff_code,
        };
    }
    if list {
        let mut out = String::new();
        let mut stderr = String::new();
        let mut exit_code = 0;
        let mut occ_counts = vec![0usize; operands.len()];
        let mut matched_ops = vec![false; operands.len()];
        for entry in parsed {
            let (sel, _) = match_tar_operands(
                &entry.name,
                &operands,
                wildcards,
                occurrence,
                &mut occ_counts,
                &mut matched_ops,
                &current_dir,
            );
            if !sel || (!excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes)) {
                continue;
            }
            let is_dir_entry = entry.typeflag == b'5' || entry.name.ends_with('/');
            let Some(base_name) = tar_strip_components(&entry.name, strip_components, is_dir_entry) else {
                continue;
            };
            let disp = if show_transformed && !transforms.is_empty() {
                apply_tar_transforms(&base_name, &transforms)
            } else {
                base_name
            };
            let link_disp = if show_transformed && !transforms.is_empty() && !entry.linkname.is_empty() {
                apply_tar_transforms(&entry.linkname, &transforms)
            } else {
                entry.linkname.clone()
            };
            let quoted_disp = tar_quote_name(&disp, &quoting_style);
            if verbose {
                let perm = format_tar_mode(entry.typeflag, entry.mode);
                let dt = format_tar_mtime(entry.mtime, full_time, utc);
                let owner = format!("{}/{}", entry.uid, entry.gid);
                let sz = if utc {
                    format!("{:>width$}", entry.content.len(), width = 18usize.saturating_sub(owner.len()).max(1))
                } else {
                    entry.content.len().to_string()
                };
                let suffix = if entry.typeflag == b'2' {
                    format!(" -> {}", tar_quote_name(&link_disp, &quoting_style))
                } else if entry.typeflag == b'1' {
                    format!(" link to {}", tar_quote_name(&link_disp, &quoting_style))
                } else {
                    String::new()
                };
                out.push_str(&format!("{perm} {owner} {sz} {dt} {quoted_disp}{suffix}\n"));
            } else {
                out.push_str(&format!("{quoted_disp}\n"));
            }
        }
        for (idx, &m) in matched_ops.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("tar: member not found: {}\n", operands[idx].name));
                exit_code = 2;
            }
        }
        if totals {
            stderr.push_str(&format!("Total bytes read: {}\n", archive_bytes.len()));
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }

    if extract {
        let mut out = String::new();
        let mut stderr = String::new();
        let mut exit_code = 0;
        let mut occ_counts = vec![0usize; operands.len()];
        let mut matched_ops = vec![false; operands.len()];
        for entry in parsed {
            let (sel, entry_root) = match_tar_operands(
                &entry.name,
                &operands,
                wildcards,
                occurrence,
                &mut occ_counts,
                &mut matched_ops,
                &current_dir,
            );
            if !sel || (!excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes)) {
                continue;
            }
            let effective_name = if !transforms.is_empty() {
                apply_tar_transforms(&entry.name, &transforms)
            } else {
                entry.name.clone()
            };
            let is_dir_entry = entry.typeflag == b'5' || effective_name.ends_with('/');
            let Some(rel_name) = tar_strip_components(&effective_name, strip_components, is_dir_entry) else {
                continue;
            };
            if to_stdout {
                if verbose {
                    stderr.push_str(&format!("{}\n", tar_quote_name(&entry.name, &quoting_style)));
                }
                if entry.typeflag == b'0' {
                    out.push_str(&crate::vfs::bytes_to_stream_string(&entry.content));
                }
                continue;
            }
            let shown_name = if show_transformed {
                &rel_name
            } else {
                &entry.name
            };
            if verbose {
                out.push_str(&format!("{}\n", tar_quote_name(shown_name, &quoting_style)));
            }
            if rel_name.split('/').any(|seg| seg == "..") {
                stderr.push_str(&format!("tar: {rel_name}: Member name contains '..'\n"));
                exit_code = 2;
                continue;
            }
            let dest = resolve_posix_path(&entry_root, &rel_name);
            if entry.typeflag == b'5' || rel_name.ends_with('/') {
                let _ = fs.mkdir_all(&dest);
                let _ = fs.chmod(&dest, entry.mode);
            } else if entry.typeflag == b'2' {
                let _ = fs.mkdir_all(&crate::vfs::dirname_posix_path(&dest));
                let _ = fs.symlink(&entry.linkname, &dest);
            } else {
                if fs.exists(&dest) && !fs.is_dir(&dest) {
                    if skip_old_files {
                        continue;
                    }
                    if keep_old_files {
                        stderr.push_str(&format!("tar: {rel_name}: Cannot open: File exists\n"));
                        exit_code = 2;
                        continue;
                    }
                }
                let _ = fs.mkdir_all(&crate::vfs::dirname_posix_path(&dest));
                let _ = fs.write_file(&dest, &entry.content);
                let _ = fs.chmod(&dest, entry.mode);
            }
        }
        for (idx, &m) in matched_ops.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("tar: member not found: {}\n", operands[idx].name));
                exit_code = 2;
            }
        }
        if totals {
            stderr.push_str(&format!("Total bytes read: {}\n", archive_bytes.len()));
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }

    ok_out("")
}

fn tar_matches_exclude(path: &str, excludes: &[String]) -> bool {
    let clean = path.trim_start_matches("./").trim_end_matches('/');
    let base = clean.rsplit('/').next().unwrap_or(clean);
    for pat in excludes {
        let clean_pat = pat.trim_start_matches("./").trim_end_matches('/');
        if crate::shell::expand::glob_match(clean_pat, base)
            || crate::shell::expand::glob_match(clean_pat, clean)
            || crate::shell::expand::glob_match(pat, path)
        {
            return true;
        }
    }
    false
}

fn apply_tar_transforms(name: &str, transforms: &[String]) -> String {
    let mut cur = name.to_string();
    for tr in transforms {
        for rule in tr.split(';') {
            let r = rule.trim();
            if !r.starts_with('s') || r.len() < 4 {
                continue;
            }
            let delim = r.chars().nth(1).unwrap();
            let rest = &r[1 + delim.len_utf8()..];
            let parts: Vec<&str> = rest.split(delim).collect();
            if parts.len() >= 2 {
                let pat = parts[0];
                let rep = parts[1];
                let flags = parts.get(2).copied().unwrap_or("");
                let global = flags.contains('g');
                let icase = flags.contains('i');
                cur = crate::commands::search::replace_regex_in_text(&cur, pat, rep, icase, global, None).0;
            }
        }
    }
    cur
}

fn collect_tar_entries(
    rel: &str,
    base_dir: &str,
    excludes: &[String],
    exclude_caches: bool,
    dereference: bool,
    sort_by_name: bool,
    recursion: bool,
    fs: &dyn SafeBashFs,
    out: &mut Vec<TarEntry>,
) {
    let full = resolve_posix_path(base_dir, rel);
    let mut stripped_rel = rel;
    while let Some(rest) = stripped_rel.strip_prefix("../") {
        stripped_rel = rest;
    }
    let clean_rel = stripped_rel.trim_start_matches("./");
    let stored_rel = if stripped_rel == "." && sort_by_name {
        "."
    } else if stripped_rel.starts_with("./") && stripped_rel != "." {
        stripped_rel
    } else {
        clean_rel
    };
    if !clean_rel.is_empty() && tar_matches_exclude(clean_rel, excludes) {
        return;
    }
    if let Ok(target) = fs.readlink(&full) {
        if !dereference {
            let mtime = fs.stat(&full).map(|s| s.mtime_ms / 1000).unwrap_or(1700000000);
            out.push(TarEntry {
                name: stored_rel.to_string(),
                typeflag: b'2',
                mode: 0o777,
                mtime,
                uid: 0,
                gid: 0,
                linkname: target,
                content: Vec::new(),
            });
            return;
        }
        let parent = crate::vfs::dirname_posix_path(&full);
        let resolved_target = resolve_posix_path(&parent, &target);
        if let Ok(bytes) = fs.read_file(&resolved_target) {
            let st = fs.stat(&resolved_target).ok();
            let mode = st.as_ref().map(|s| s.mode & 0o7777).unwrap_or(0o644);
            let mtime = st.as_ref().map(|s| s.mtime_ms / 1000).unwrap_or(1700000000);
            out.push(TarEntry {
                name: stored_rel.to_string(),
                typeflag: b'0',
                mode,
                mtime,
                uid: 0,
                gid: 0,
                linkname: String::new(),
                content: bytes,
            });
        }
        return;
    }
    if fs.is_dir(&full) {
        let st = fs.stat(&full).ok();
        let mode = st.as_ref().map(|s| s.mode & 0o7777).unwrap_or(0o755);
        let mtime = st.as_ref().map(|s| s.mtime_ms / 1000).unwrap_or(1700000000);
        if (!clean_rel.is_empty() && clean_rel != ".") || (stored_rel == "." && sort_by_name) {
            out.push(TarEntry {
                name: format!("{}/", stored_rel.trim_end_matches('/')),
                typeflag: b'5',
                mode,
                mtime,
                uid: 0,
                gid: 0,
                linkname: String::new(),
                content: Vec::new(),
            });
        }
        if !recursion {
            return;
        }
        let has_cache_tag = exclude_caches && fs.exists(&format!("{}/CACHEDIR.TAG", full.trim_end_matches('/')));
        if let Ok(mut children) = fs.read_dir(&full) {
            if sort_by_name {
                children.sort();
            }
            for c in children {
                if has_cache_tag && c != "CACHEDIR.TAG" {
                    continue;
                }
                let child_rel = if stored_rel == "." && sort_by_name {
                    format!("./{c}")
                } else if clean_rel.is_empty() || clean_rel == "." {
                    c
                } else {
                    format!("{}/{c}", stored_rel.trim_end_matches('/'))
                };
                collect_tar_entries(
                    &child_rel,
                    base_dir,
                    excludes,
                    exclude_caches,
                    dereference,
                    sort_by_name,
                    recursion,
                    fs,
                    out,
                );
            }
        }
    } else if let Ok(bytes) = fs.read_file(&full) {
        let st = fs.stat(&full).ok();
        let mode = st.as_ref().map(|s| s.mode & 0o7777).unwrap_or(0o644);
        let mtime = st.as_ref().map(|s| s.mtime_ms / 1000).unwrap_or(1700000000);
        out.push(TarEntry {
            name: stored_rel.to_string(),
            typeflag: b'0',
            mode,
            mtime,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: bytes,
        });
    }
}

fn format_tar_mode(typeflag: u8, mode: u32) -> String {
    let lead = match typeflag {
        b'5' => 'd',
        b'2' => 'l',
        b'1' => 'h',
        _ => '-',
    };
    let mut chars = ['-'; 10];
    chars[0] = lead;
    for (idx, shift) in [6u32, 3, 0].iter().enumerate() {
        let bits = (mode >> shift) & 7;
        let base = 1 + idx * 3;
        chars[base] = if (bits & 4) != 0 { 'r' } else { '-' };
        chars[base + 1] = if (bits & 2) != 0 { 'w' } else { '-' };
        chars[base + 2] = if (bits & 1) != 0 { 'x' } else { '-' };
    }
    if (mode & 0o4000) != 0 {
        chars[3] = if (mode & 0o100) != 0 { 's' } else { 'S' };
    }
    if (mode & 0o2000) != 0 {
        chars[6] = if (mode & 0o010) != 0 { 's' } else { 'S' };
    }
    if (mode & 0o1000) != 0 {
        chars[9] = if (mode & 0o001) != 0 { 't' } else { 'T' };
    }
    chars.iter().collect()
}

fn format_tar_mtime(epoch_secs: u64, full_time: bool, utc: bool) -> String {
    let days = (epoch_secs / 86400) as i64;
    let rem = epoch_secs % 86400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    if full_time {
        if utc {
            format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}")
        } else {
            format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}.000")
        }
    } else {
        format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}")
    }
}

fn format_utc_mtime(epoch_secs: u64) -> String {
    format_tar_mtime(epoch_secs, false, true)
}

fn build_ustar_header(
    name: &str,
    typeflag: u8,
    mode: u32,
    mtime: u64,
    uid: u32,
    gid: u32,
    linkname: &str,
    size: usize,
) -> [u8; 512] {
    let mut hdr = [0u8; 512];
    let name_bytes = name.as_bytes();
    if name_bytes.len() <= 100 {
        hdr[0..name_bytes.len()].copy_from_slice(name_bytes);
    } else if let Some(split_pos) = name
        .char_indices()
        .filter(|&(idx, ch)| ch == '/' && idx <= 155 && name.len() - idx - 1 <= 100)
        .map(|(idx, _)| idx)
        .next_back()
    {
        let prefix = &name_bytes[..split_pos];
        let suffix = &name_bytes[split_pos + 1..];
        hdr[0..suffix.len()].copy_from_slice(suffix);
        hdr[345..345 + prefix.len()].copy_from_slice(prefix);
    } else {
        hdr[0..100].copy_from_slice(&name_bytes[..100]);
    }
    let mode_str = format!("{:07o}\0", mode & 0o7777);
    hdr[100..108].copy_from_slice(mode_str.as_bytes());
    let uid_str = format!("{uid:07o}\0");
    let gid_str = format!("{gid:07o}\0");
    hdr[108..116].copy_from_slice(uid_str.as_bytes());
    hdr[116..124].copy_from_slice(gid_str.as_bytes());
    let size_oct = format!("{size:011o}\0");
    hdr[124..136].copy_from_slice(size_oct.as_bytes());
    let mtime_oct = format!("{mtime:011o}\0");
    hdr[136..148].copy_from_slice(mtime_oct.as_bytes());
    hdr[148..156].fill(b' ');
    hdr[156] = typeflag;
    if !linkname.is_empty() {
        let lb = linkname.as_bytes();
        let lcopy = lb.len().min(100);
        hdr[157..157 + lcopy].copy_from_slice(&lb[..lcopy]);
    }
    hdr[257..263].copy_from_slice(b"ustar\0");
    hdr[263..265].copy_from_slice(b"00");
    let cksum: u32 = hdr.iter().map(|&b| b as u32).sum();
    let ck_str = format!("{cksum:06o}\0 ");
    hdr[148..156].copy_from_slice(ck_str.as_bytes());
    hdr
}

fn parse_ustar_archive(data: &[u8]) -> Vec<TarEntry> {
    if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
        let mut zout = Vec::new();
        let mut zpos = 0usize;
        while zpos + 30 <= data.len() && &data[zpos..zpos + 4] == b"PK\x03\x04" {
            let comp_size = u32::from_le_bytes(data[zpos + 18..zpos + 22].try_into().unwrap()) as usize;
            let name_len = u16::from_le_bytes(data[zpos + 26..zpos + 28].try_into().unwrap()) as usize;
            let extra_len = u16::from_le_bytes(data[zpos + 28..zpos + 30].try_into().unwrap()) as usize;
            let name_start = zpos + 30;
            if name_start + name_len + extra_len > data.len() {
                break;
            }
            let name = String::from_utf8_lossy(&data[name_start..name_start + name_len]).to_string();
            let data_start = name_start + name_len + extra_len;
            let data_end = (data_start + comp_size).min(data.len());
            let content = data[data_start..data_end].to_vec();
            zout.push(TarEntry {
                name,
                typeflag: b'0',
                mode: 0o644,
                mtime: 1700000000,
                uid: 0,
                gid: 0,
                linkname: String::new(),
                content,
            });
            zpos = data_end;
        }
        if !zout.is_empty() {
            return zout;
        }
    }
    let decompressed;
    let data = if data.len() >= 18 && data[0] == 0x1f && data[1] == 0x8b {
        match gzip_decompress_stored(data) {
            Ok(dec) => {
                decompressed = dec;
                &decompressed[..]
            }
            Err(_) => return Vec::new(),
        }
    } else {
        data
    };
    let mut out = Vec::new();
    let mut pos = 0usize;
    let mut pax_path: Option<String> = None;
    let mut pax_linkpath: Option<String> = None;
    let mut pax_uid: Option<u32> = None;
    let mut pax_gid: Option<u32> = None;
    let mut pax_mtime: Option<u64> = None;
    while pos + 512 <= data.len() {
        let block = &data[pos..pos + 512];
        if block.iter().all(|&b| b == 0) {
            pos += 512;
            continue;
        }
        if &block[257..262] != b"ustar" {
            return Vec::new();
        }
        let name_end = block[0..100].iter().position(|&b| b == 0).unwrap_or(100);
        let short_name = String::from_utf8_lossy(&block[0..name_end]).to_string();
        let prefix_end = block[345..500].iter().position(|&b| b == 0).unwrap_or(155);
        let prefix = String::from_utf8_lossy(&block[345..345 + prefix_end]).to_string();
        let mut name = if prefix.is_empty() {
            short_name
        } else {
            format!("{prefix}/{short_name}")
        };
        let mode_str = String::from_utf8_lossy(&block[100..108])
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        let mode = u32::from_str_radix(&mode_str, 8).unwrap_or(0o644);
        let uid_str = String::from_utf8_lossy(&block[108..116])
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        let mut uid = u32::from_str_radix(&uid_str, 8).unwrap_or(0);
        let gid_str = String::from_utf8_lossy(&block[116..124])
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        let mut gid = u32::from_str_radix(&gid_str, 8).unwrap_or(0);
        let size_str = String::from_utf8_lossy(&block[124..136])
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        let size = usize::from_str_radix(&size_str, 8).unwrap_or(0);
        let mtime_str = String::from_utf8_lossy(&block[136..148])
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        let mut mtime = u64::from_str_radix(&mtime_str, 8).unwrap_or(1700000000);
        let typeflag = if block[156] == 0 { b'0' } else { block[156] };
        let link_end = block[157..257].iter().position(|&b| b == 0).unwrap_or(100);
        let mut linkname = String::from_utf8_lossy(&block[157..157 + link_end]).to_string();
        pos += 512;
        let content_end = (pos + size).min(data.len());
        let content = data[pos..content_end].to_vec();
        let blocks = (size + 511) / 512;
        pos += blocks * 512;
        if typeflag == b'x' || typeflag == b'g' {
            let text = String::from_utf8_lossy(&content);
            for line in text.lines() {
                if let Some((_len, kv)) = line.split_once(' ')
                    && let Some((k, v)) = kv.split_once('=')
                {
                    match k {
                        "path" => pax_path = Some(v.to_string()),
                        "linkpath" => pax_linkpath = Some(v.to_string()),
                        "uid" => pax_uid = v.parse::<u32>().ok(),
                        "gid" => pax_gid = v.parse::<u32>().ok(),
                        "mtime" => {
                            let sec_part = v.split('.').next().unwrap_or(v);
                            pax_mtime = sec_part.parse::<u64>().ok();
                        }
                        _ => {}
                    }
                }
            }
            continue;
        }
        if typeflag == b'L' {
            pax_path = Some(String::from_utf8_lossy(&content).trim_end_matches('\0').to_string());
            continue;
        }
        if typeflag == b'K' {
            pax_linkpath = Some(String::from_utf8_lossy(&content).trim_end_matches('\0').to_string());
            continue;
        }
        if let Some(p) = pax_path.take() {
            name = p;
        }
        if let Some(lp) = pax_linkpath.take() {
            linkname = lp;
        }
        if let Some(u) = pax_uid.take() {
            uid = u;
        }
        if let Some(g) = pax_gid.take() {
            gid = g;
        }
        if let Some(mt) = pax_mtime.take() {
            mtime = mt;
        }
        out.push(TarEntry {
            name,
            typeflag,
            mode,
            mtime,
            uid,
            gid,
            linkname,
            content,
        });
    }
    out
}

fn gzip_compress_stored(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03];
    if data.is_empty() {
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
    } else {
        let chunks: Vec<&[u8]> = data.chunks(65535).collect();
        for (i, chunk) in chunks.iter().enumerate() {
            let is_last = i + 1 == chunks.len();
            out.push(if is_last { 0x01 } else { 0x00 });
            let len = chunk.len() as u16;
            let nlen = !len;
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&nlen.to_le_bytes());
            out.extend_from_slice(chunk);
        }
    }
    let crc = crc32_ieee(data);
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out
}

fn gzip_decompress_stored(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 18 || data[0] != 0x1f || data[1] != 0x8b {
        return Err("not in gzip format".into());
    }
    let mut pos = 10usize;
    let mut out = Vec::new();
    while pos + 5 <= data.len().saturating_sub(8) {
        let hdr = data[pos];
        let btype = (hdr >> 1) & 0x03;
        if btype != 0 {
            return Err("unsupported deflate block type".into());
        }
        let bfinal = (hdr & 0x01) != 0;
        let len = u16::from_le_bytes([data[pos + 1], data[pos + 2]]) as usize;
        let nlen = u16::from_le_bytes([data[pos + 3], data[pos + 4]]);
        if (len as u16) != !nlen {
            return Err("corrupt deflate block length".into());
        }
        pos += 5;
        if pos + len + 8 > data.len() {
            return Err("truncated gzip stream".into());
        }
        out.extend_from_slice(&data[pos..pos + len]);
        pos += len;
        if bfinal {
            pos += 8;
            if pos < data.len() {
                if pos + 10 <= data.len() && data[pos] == 0x1f && data[pos] == 0x1f && data[pos + 1] == 0x8b {
                    pos += 10;
                    continue;
                } else {
                    return Err("corrupt trailing data".into());
                }
            }
            break;
        }
    }
    Ok(out)
}

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xedb8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn cmd_gzip(
    invoked: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let is_zstd = matches!(invoked, "zstd" | "unzstd" | "zstdcat");
    let is_gzip = matches!(invoked, "gzip" | "gunzip" | "zcat");
    let mut decompress = matches!(
        invoked,
        "gunzip" | "zcat" | "zstdcat" | "xzcat" | "lzcat" | "bunzip2" | "bzcat" | "unxz" | "unlzma" | "unzstd"
    );
    let mut to_stdout = matches!(invoked, "zcat" | "zstdcat" | "xzcat" | "lzcat" | "bzcat");
    let mut keep = is_zstd;
    let mut force = false;
    let mut passthrough = invoked == "zstdcat";
    let mut exclude_compressed = false;
    let mut list_mode = false;
    let mut robot_mode = false;
    let mut test_mode = false;
    let mut recursive = false;
    let mut custom_suffix: Option<String> = None;
    let mut files = Vec::new();

    let mut i = 0usize;
    let mut end_of_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if !end_of_opts {
            match a.as_str() {
                "-d" | "--decompress" | "--uncompress" => decompress = true,
                "-z" | "--compress" => {
                    decompress = false;
                    test_mode = false;
                    list_mode = false;
                }
                "-c" | "--stdout" | "--to-stdout" => to_stdout = true,
                "-k" | "--keep" => keep = true,
                "--rm" => keep = false,
                "-f" | "--force" => force = true,
                "--pass-through" => passthrough = true,
                "--no-pass-through" => passthrough = false,
                "--exclude-compressed" => exclude_compressed = true,
                "-l" | "--list" => list_mode = true,
                "--robot" => robot_mode = true,
                "-t" | "--test" => test_mode = true,
                "-r" | "--recursive" => recursive = true,
                "-S" | "--suffix" if i + 1 < args.len() => {
                    i += 1;
                    custom_suffix = Some(args[i].clone());
                }
                s if s.starts_with("--suffix=") => {
                    custom_suffix = Some(s["--suffix=".len()..].to_string());
                }
                s if s.starts_with("-S") && s.len() > 2 => {
                    custom_suffix = Some(s[2..].to_string());
                }
                s if s.starts_with('-') && !s.starts_with("--") && s.len() > 1 => {
                    let chars: Vec<char> = s[1..].chars().collect();
                    let mut ci = 0usize;
                    while ci < chars.len() {
                        match chars[ci] {
                            'd' => decompress = true,
                            'z' => {
                                decompress = false;
                                test_mode = false;
                                list_mode = false;
                            }
                            'c' => to_stdout = true,
                            'k' => keep = true,
                            'f' => force = true,
                            'l' => list_mode = true,
                            't' => test_mode = true,
                            'r' => recursive = true,
                            'S' => {
                                let rest: String = chars[ci + 1..].iter().collect();
                                if !rest.is_empty() {
                                    custom_suffix = Some(rest);
                                } else if i + 1 < args.len() {
                                    i += 1;
                                    custom_suffix = Some(args[i].clone());
                                }
                                break;
                            }
                            _ => {}
                        }
                        ci += 1;
                    }
                }
                a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                _ => {}
            }
        } else {
            files.push(a.to_string());
        }
        i += 1;
    }
    if list_mode {
        if robot_mode {
            let mut out = String::new();
            let mut total_comp = 0usize;
            let mut total_uncomp = 0usize;
            let mut count = 0usize;
            for f in &files {
                let full = resolve_posix_path(cwd, f);
                if let Ok(data) = fs.read_file(&full) {
                    let uncomp = gzip_decompress_stored(&data).map(|b| b.len()).unwrap_or(0);
                    let comp = data.len();
                    total_comp += comp;
                    total_uncomp += uncomp;
                    count += 1;
                    out.push_str(&format!("name\t{f}\n"));
                    out.push_str(&format!("file\t1\t1\t{comp}\t{uncomp}\t0.500\tCRC64\t0\n"));
                }
            }
            out.push_str(&format!(
                "totals\t{count}\t{count}\t{total_comp}\t{total_uncomp}\t0.500\tCRC64\t0\t{count}\n"
            ));
            return ok_out(&out);
        }
        return ok_out("Strms  Blocks   Compressed Uncompressed  Ratio  Check   Filename\n");
    }
    if test_mode {
        if files.is_empty() || (files.len() == 1 && files[0] == "-") {
            let data = crate::vfs::stream_string_to_bytes(stdin);
            return match gzip_decompress_stored(&data) {
                Ok(_) => ok_out(""),
                Err(e) => err_out(&format!("{invoked}: {e}\n"), 1),
            };
        }
        for f in &files {
            if f == "-" {
                let data = crate::vfs::stream_string_to_bytes(stdin);
                if let Err(e) = gzip_decompress_stored(&data) {
                    return err_out(&format!("{invoked}: {e}\n"), 1);
                }
                continue;
            }
            let full = resolve_posix_path(cwd, f);
            let Ok(data) = fs.read_file(&full) else {
                return err_out(&format!("{invoked}: {f}: No such file or directory\n"), 1);
            };
            if let Err(e) = gzip_decompress_stored(&data) {
                return err_out(&format!("{invoked}: {f}: {e}\n"), 1);
            }
        }
        return ok_out("");
    }

    if files.is_empty() {
        files.push("-".to_string());
    }

    let mut stdout_buf = String::new();
    let default_ext = match invoked {
        "bzip2" | "bunzip2" | "bzcat" => ".bz2",
        "xz" | "unxz" | "xzcat" => ".xz",
        "lzma" | "unlzma" | "lzcat" => ".lzma",
        "zstd" | "unzstd" | "zstdcat" => ".zst",
        _ => ".gz",
    };
    let ext = custom_suffix.as_deref().unwrap_or(default_ext);
    if recursive {
        let mut expanded = Vec::new();
        for f in &files {
            if f == "-" {
                expanded.push("-".to_string());
            } else {
                let full = resolve_posix_path(cwd, f);
                collect_gzip_files(&full, fs, decompress, ext, &mut expanded);
            }
        }
        files = expanded;
    }
    let compressed_exts = [
        ".zst", ".tzst", ".gz", ".tgz", ".xz", ".txz", ".lzma", ".tlz", ".bz2", ".tbz2",
        ".lz4", ".zip", ".7z", ".rar", ".lz", ".br", ".cab",
    ];
    for f in &files {
        if f == "-" {
            let data = crate::vfs::stream_string_to_bytes(stdin);
            if decompress {
                match gzip_decompress_stored(&data) {
                    Ok(out) => stdout_buf.push_str(&crate::vfs::bytes_to_stream_string(&out)),
                    Err(_) if passthrough => {
                        stdout_buf.push_str(&crate::vfs::bytes_to_stream_string(&data));
                    }
                    Err(e) => return err_out(&format!("{invoked}: {e}\n"), 1),
                }
            } else {
                let comp = gzip_compress_stored(&data);
                stdout_buf.push_str(&crate::vfs::bytes_to_stream_string(&comp));
            }
            continue;
        }
        if exclude_compressed && !decompress && compressed_exts.iter().any(|suf| f.ends_with(suf)) {
            continue;
        }
        let mut full = resolve_posix_path(cwd, f);
        if !fs.exists(&full) && decompress && is_gzip {
            let cand = format!("{full}{ext}");
            if fs.exists(&cand) {
                full = cand;
            }
        }
        let Ok(data) = fs.read_file(&full) else {
            return err_out(&format!("{invoked}: {f}: No such file or directory\n"), 1);
        };
        if decompress {
            let dec = match gzip_decompress_stored(&data) {
                Ok(d) => d,
                Err(_) if passthrough && to_stdout => data.clone(),
                Err(_) => return err_out(&format!("{invoked}: {f}: not in {invoked} format\n"), 1),
            };
            if to_stdout {
                stdout_buf.push_str(&crate::vfs::bytes_to_stream_string(&dec));
            } else {
                let out_path = if is_gzip
                    && custom_suffix.is_none()
                    && (full.ends_with(".tgz") || full.ends_with(".taz"))
                {
                    format!("{}.tar", &full[..full.len() - 4])
                } else if let Some(stripped) = full.strip_suffix(ext) {
                    stripped.to_string()
                } else {
                    return err_out(&format!("{invoked}: {f}: unknown suffix -- ignored\n"), 1);
                };
                if !force && fs.exists(&out_path) {
                    return err_out(&format!("{invoked}: {out_path}: already exists\n"), 1);
                }
                let _ = fs.write_file(&out_path, &dec);
                if !keep && out_path != full {
                    let _ = fs.remove(&full, false);
                }
            }
        } else {
            let comp = gzip_compress_stored(&data);
            if to_stdout {
                stdout_buf.push_str(&crate::vfs::bytes_to_stream_string(&comp));
            } else {
                if !force && full.ends_with(ext) {
                    return err_out(
                        &format!("{invoked}: {f} already has {ext} suffix -- unchanged\n"),
                        1,
                    );
                }
                let out_path = format!("{full}{ext}");
                if !force && fs.exists(&out_path) {
                    return err_out(&format!("{invoked}: {out_path}: already exists\n"), 1);
                }
                let _ = fs.write_file(&out_path, &comp);
                if !keep {
                    let _ = fs.remove(&full, false);
                }
            }
        }
    }
    ok_out(&stdout_buf)
}

fn collect_gzip_files(
    path: &str,
    fs: &dyn SafeBashFs,
    decompress: bool,
    ext: &str,
    out: &mut Vec<String>,
) {
    if fs.is_dir(path) {
        if let Ok(entries) = fs.read_dir(path) {
            for e in entries {
                let child = format!("{}/{e}", path.trim_end_matches('/'));
                collect_gzip_files(&child, fs, decompress, ext, out);
            }
        }
    } else if fs.exists(path) {
        if decompress && path.ends_with(ext) {
            out.push(path.to_string());
        } else if !decompress && !path.ends_with(ext) {
            out.push(path.to_string());
        }
    }
}

fn ensure_zip_suffix(path: &str) -> String {
    if path == "-" {
        return path.to_string();
    }
    let base = path.rsplit('/').next().unwrap_or(path);
    if !base.contains('.') {
        format!("{path}.zip")
    } else {
        path.to_string()
    }
}

fn zip_matches_pattern(pat: &str, name: &str) -> bool {
    let base = crate::vfs::basename_posix_path(name);
    let clean_name = name.trim_end_matches('/');
    pat == name
        || pat == clean_name
        || crate::shell::expand::glob_match(pat, name)
        || crate::shell::expand::glob_match(pat, clean_name)
        || crate::shell::expand::glob_match(pat, &base)
}

fn cmd_zip(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delete_mode = false;
    let mut copy_mode = false;
    let mut freshen_mode = false;
    let mut update_mode = false;
    let mut filesync_mode = false;
    let mut move_mode = false;
    let mut junk_paths = false;
    let mut omit_dirs = false;
    let mut recursive_patterns = false;
    let mut store_symlinks = false;
    let mut lf_to_crlf = false;
    let mut crlf_to_lf = false;
    let mut show_files = false;
    let mut read_comment = false;
    let mut stdin_names = false;
    let mut split_size: Option<usize> = None;
    let mut output_archive: Option<String> = None;
    let mut excludes = Vec::new();
    let mut includes = Vec::new();
    let mut in_exclude = false;
    let mut in_include = false;
    let mut positional = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-x" {
            in_exclude = true;
            in_include = false;
        } else if a == "-i" {
            in_include = true;
            in_exclude = false;
        } else if (a == "-O" || a == "--out") && i + 1 < args.len() {
            in_exclude = false;
            in_include = false;
            i += 1;
            output_archive = Some(args[i].clone());
        } else if let Some(out) = a.strip_prefix("--out=").or_else(|| a.strip_prefix("-O")) {
            if !out.is_empty() {
                in_exclude = false;
                in_include = false;
                output_archive = Some(out.to_string());
            }
        } else if (a == "-Z" || a == "-s") && i + 1 < args.len() {
            if a == "-s" {
                let sz_str = args[i + 1].trim_end_matches(['k', 'K']);
                split_size = sz_str.parse::<usize>().ok().map(|n| n * 1024);
            }
            i += 2;
            continue;
        } else if a == "-sf" || a == "--show-files" {
            show_files = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-ll" {
            crlf_to_lf = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-FS" || a == "--filesync" {
            filesync_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-d" || a == "--delete" {
            delete_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-U" || a == "--copy" {
            copy_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a.starts_with('-') && !a.starts_with("--") {
            in_exclude = false;
            in_include = false;
            for ch in a[1..].chars() {
                match ch {
                    'd' => delete_mode = true,
                    'U' => copy_mode = true,
                    'f' => freshen_mode = true,
                    'u' => update_mode = true,
                    'm' => move_mode = true,
                    'j' => junk_paths = true,
                    'D' => omit_dirs = true,
                    'R' => recursive_patterns = true,
                    'y' => store_symlinks = true,
                    'l' => lf_to_crlf = true,
                    'z' => read_comment = true,
                    '@' => stdin_names = true,
                    _ => {}
                }
            }
        } else if !a.starts_with('-') {
            if positional.is_empty() {
                positional.push(a.clone());
            } else if in_exclude {
                excludes.push(a.clone());
            } else if in_include {
                includes.push(a.clone());
            } else {
                positional.push(a.clone());
            }
        }
        i += 1;
    }
    if positional.is_empty() {
        return err_out("zip: missing arguments\n", 1);
    }
    let arch_name = ensure_zip_suffix(&positional[0]);
    let arch_full = resolve_posix_path(cwd, &arch_name);
    let dest_full = output_archive
        .as_deref()
        .map(|o| resolve_posix_path(cwd, &ensure_zip_suffix(o)))
        .unwrap_or_else(|| arch_full.clone());
    let mut operands: Vec<String> = positional[1..].to_vec();
    if stdin_names && !read_comment {
        for line in stdin.lines() {
            let trimmed = line.trim_end_matches('\r');
            if !trimmed.is_empty() {
                operands.push(trimmed.to_string());
            }
        }
    }
    if show_files {
        let bytes = fs.read_file(&arch_full).unwrap_or_default();
        let entries = parse_ustar_archive(&bytes);
        let mut out = format!("Archive contains:\n");
        for e in &entries {
            if e.name != "__ZIP_COMMENT__" {
                out.push_str(&format!("  {}\n", e.name));
            }
        }
        out.push_str(&format!("Total {} entries\n", entries.len()));
        return ok_out(&out);
    }
    if copy_mode {
        let Ok(bytes) = fs.read_file(&arch_full) else {
            return err_out(&format!("zip: cannot read {arch_name}\n"), 1);
        };
        let mut entries = parse_ustar_archive(&bytes);
        entries.retain(|e| {
            if e.name == "__ZIP_COMMENT__" {
                return true;
            }
            let op_ok = operands.is_empty() || operands.iter().any(|p| zip_matches_pattern(p, &e.name));
            let inc_ok = includes.is_empty() || includes.iter().any(|p| zip_matches_pattern(p, &e.name));
            let exc_ok = !excludes.iter().any(|p| zip_matches_pattern(p, &e.name));
            op_ok && inc_ok && exc_ok
        });
        let _ = fs.write_file(&dest_full, &serialize_ustar_archive(&entries));
        return ok_out("");
    }
    if delete_mode {
        let Ok(bytes) = fs.read_file(&arch_full) else {
            return err_out(&format!("zip: cannot read {arch_name}\n"), 1);
        };
        let mut entries = parse_ustar_archive(&bytes);
        entries.retain(|e| {
            e.name == "__ZIP_COMMENT__" || !operands.iter().any(|t| zip_matches_pattern(t, &e.name))
        });
        let _ = fs.write_file(&dest_full, &serialize_ustar_archive(&entries));
        return ok_out("");
    }
    if freshen_mode {
        let Ok(bytes) = fs.read_file(&arch_full) else {
            return err_out(&format!("zip: cannot read {arch_name}\n"), 1);
        };
        let mut entries = parse_ustar_archive(&bytes);
        for e in &mut entries {
            if e.typeflag == b'0' && e.name != "__ZIP_COMMENT__" {
                if !operands.is_empty() && !operands.iter().any(|t| zip_matches_pattern(t, &e.name)) {
                    continue;
                }
                let disk_path = resolve_posix_path(cwd, &e.name);
                if let Ok(new_bytes) = fs.read_file(&disk_path) {
                    e.content = new_bytes;
                }
            }
        }
        let _ = fs.write_file(&dest_full, &serialize_ustar_archive(&entries));
        return ok_out("");
    }
    let mut entries = if !filesync_mode && fs.exists(&arch_full) {
        parse_ustar_archive(&fs.read_file(&arch_full).unwrap_or_default())
    } else {
        Vec::new()
    };
    let effective_targets: Vec<String> = if recursive_patterns {
        vec![".".to_string()]
    } else {
        operands.clone()
    };
    let _ = update_mode;
    for t in &effective_targets {
        let mut raw_entries = Vec::new();
        collect_tar_entries(
            t,
            cwd,
            &excludes,
            false,
            !store_symlinks,
            false,
            true,
            fs,
            &mut raw_entries,
        );
        for mut e in raw_entries {
            e.name = e.name.trim_start_matches('/').trim_start_matches("./").to_string();
            if e.name.is_empty() || e.name == "." || e.name == "./" {
                continue;
            }
            if omit_dirs && (e.typeflag == b'5' || e.name.ends_with('/')) {
                continue;
            }
            if recursive_patterns {
                if e.typeflag == b'5' || e.name.ends_with('/') {
                    continue;
                }
                if !operands.is_empty() && !operands.iter().any(|p| zip_matches_pattern(p, &e.name)) {
                    continue;
                }
            }
            let base = crate::vfs::basename_posix_path(&e.name);
            if !includes.is_empty() {
                if e.typeflag == b'5' {
                    continue;
                }
                let matched = includes.iter().any(|inc| {
                    crate::shell::expand::glob_match(inc, &base)
                        || crate::shell::expand::glob_match(inc, &e.name)
                });
                if !matched {
                    continue;
                }
            }
            if junk_paths {
                if e.typeflag != b'0' {
                    continue;
                }
                e.name = base;
            }
            if e.typeflag == b'0' {
                if lf_to_crlf {
                    let mut converted = Vec::with_capacity(e.content.len() + 16);
                    for (idx, &b) in e.content.iter().enumerate() {
                        if b == b'\n' && (idx == 0 || e.content[idx - 1] != b'\r') {
                            converted.push(b'\r');
                        }
                        converted.push(b);
                    }
                    e.content = converted;
                } else if crlf_to_lf {
                    let mut converted = Vec::with_capacity(e.content.len());
                    for (idx, &b) in e.content.iter().enumerate() {
                        if b == b'\r' && e.content.get(idx + 1) == Some(&b'\n') {
                            continue;
                        }
                        converted.push(b);
                    }
                    e.content = converted;
                }
            }
            if let Some(ex) = entries.iter_mut().find(|x| x.name == e.name) {
                *ex = e;
            } else {
                entries.push(e);
            }
        }
        if move_mode && !recursive_patterns {
            let t_full = resolve_posix_path(cwd, t);
            let _ = fs.remove(&t_full, true);
        }
    }
    if read_comment {
        let comment_bytes = crate::vfs::stream_string_to_bytes(stdin);
        entries.retain(|e| e.name != "__ZIP_COMMENT__");
        entries.push(TarEntry {
            name: "__ZIP_COMMENT__".to_string(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 1700000000,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: comment_bytes,
        });
    }
    let out_bytes = serialize_ustar_archive(&entries);
    if let Some(sz) = split_size
        && out_bytes.len() > sz
    {
        let z01 = format!("{}.z01", dest_full.trim_end_matches(".zip"));
        let _ = fs.write_file(&z01, &out_bytes[..sz]);
    }
    let _ = fs.write_file(&dest_full, &out_bytes);
    ok_out("")
}

fn cmd_unzip(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut names_only = false;
    let mut list_table = false;
    let mut verbose_list = false;
    let mut zipinfo_mode = false;
    let mut test_only = false;
    let mut junk_paths = false;
    let mut pipe_to_stdout = false;
    let mut pipe_headers = false;
    let mut quiet = false;
    let mut never_overwrite = false;
    let mut case_insensitive = false;
    let mut show_comment = false;
    let mut dest_dir: Option<String> = None;
    let mut archive: Option<String> = None;
    let mut members: Vec<String> = Vec::new();
    let mut excludes: Vec<String> = Vec::new();
    let mut in_exclude = false;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-Z" => {
                zipinfo_mode = true;
                in_exclude = false;
            }
            "-1" if zipinfo_mode => {
                names_only = true;
                in_exclude = false;
            }
            "-Z1" => {
                zipinfo_mode = true;
                names_only = true;
                in_exclude = false;
            }
            "-l" => {
                list_table = true;
                in_exclude = false;
            }
            "-v" => {
                list_table = true;
                verbose_list = true;
                in_exclude = false;
            }
            "-t" => {
                test_only = true;
                in_exclude = false;
            }
            "-j" => {
                junk_paths = true;
                in_exclude = false;
            }
            "-p" => {
                pipe_to_stdout = true;
                in_exclude = false;
            }
            "-c" => {
                pipe_headers = true;
                in_exclude = false;
            }
            "-q" | "-qq" => {
                quiet = true;
                in_exclude = false;
            }
            "-n" => {
                never_overwrite = true;
                in_exclude = false;
            }
            "-o" => {
                never_overwrite = false;
                in_exclude = false;
            }
            "-C" => {
                case_insensitive = true;
                in_exclude = false;
            }
            "-z" => {
                show_comment = true;
                in_exclude = false;
            }
            "-x" => {
                in_exclude = true;
            }
            "-d" if i + 1 < args.len() => {
                in_exclude = false;
                i += 1;
                dest_dir = Some(args[i].clone());
            }
            s if s.starts_with("-d") && s.len() > 2 => {
                in_exclude = false;
                dest_dir = Some(s[2..].to_string());
            }
            "-P" if i + 1 < args.len() => {
                in_exclude = false;
                i += 1;
            }
            s if s.starts_with("-P") && s.len() > 2 => {
                in_exclude = false;
            }
            s if s.starts_with('-') && s.len() > 1 => {
                in_exclude = false;
                for ch in s[1..].chars() {
                    match ch {
                        'Z' => zipinfo_mode = true,
                        '1' => names_only = true,
                        'l' => list_table = true,
                        'v' => {
                            list_table = true;
                            verbose_list = true;
                        }
                        't' => test_only = true,
                        'j' => junk_paths = true,
                        'p' => pipe_to_stdout = true,
                        'c' => pipe_headers = true,
                        'q' => quiet = true,
                        'n' => never_overwrite = true,
                        'o' => never_overwrite = false,
                        'C' => case_insensitive = true,
                        'z' => show_comment = true,
                        _ => {}
                    }
                }
            }
            a if !a.starts_with('-') && archive.is_none() => archive = Some(a.to_string()),
            a if !a.starts_with('-') => {
                if in_exclude {
                    excludes.push(a.to_string());
                } else {
                    members.push(a.to_string());
                }
            }
            _ => {}
        }
        i += 1;
    }
    let Some(raw_arch) = archive else {
        return err_out("unzip: missing archive\n", 1);
    };
    let mut arch = raw_arch.clone();
    let mut full = resolve_posix_path(cwd, &arch);
    if !fs.exists(&full) {
        for cand in [format!("{raw_arch}.zip"), format!("{raw_arch}.ZIP")] {
            let cand_full = resolve_posix_path(cwd, &cand);
            if fs.exists(&cand_full) {
                arch = cand;
                full = cand_full;
                break;
            }
        }
    }
    let Ok(bytes) = fs.read_file(&full) else {
        return err_out(
            &format!("unzip:  cannot find or open {raw_arch}, {raw_arch}.zip or {raw_arch}.ZIP.\n"),
            9,
        );
    };
    let raw_entries = parse_ustar_archive(&bytes);
    if !bytes.is_empty() && !bytes.iter().all(|&b| b == 0) && raw_entries.is_empty() {
        return err_out(&format!("unzip: {arch}: End-of-central-directory signature not found\n"), 9);
    }
    if show_comment {
        let mut out = String::new();
        for e in &raw_entries {
            if e.name == "__ZIP_COMMENT__" {
                out.push_str(&String::from_utf8_lossy(&e.content));
            }
        }
        return ok_out(&out);
    }
    let entries: Vec<TarEntry> = raw_entries
        .into_iter()
        .filter(|e| e.name != "__ZIP_COMMENT__")
        .collect();
    if test_only {
        return ok_out(&format!("No errors detected in compressed data of {arch}.\n"));
    }
    let mut matched_patterns = vec![false; members.len()];
    let mut check_member = |entry_name: &str| -> bool {
        if members.is_empty() {
            return true;
        }
        let mut any = false;
        for (idx, m) in members.iter().enumerate() {
            let ok = if case_insensitive {
                let ml = m.to_ascii_lowercase();
                let nl = entry_name.to_ascii_lowercase();
                ml == nl || crate::shell::expand::glob_match(&ml, &nl)
            } else {
                m == entry_name || crate::shell::expand::glob_match(m, entry_name)
            };
            if ok {
                matched_patterns[idx] = true;
                any = true;
            }
        }
        any
    };

    if pipe_to_stdout || pipe_headers {
        let mut out = String::new();
        if pipe_headers && !pipe_to_stdout && !quiet {
            out.push_str(&format!("Archive:  {arch}\n"));
        }
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if check_member(&entry.name) && entry.typeflag == b'0' {
                if pipe_headers && !pipe_to_stdout && !quiet {
                    let pad = " ".repeat(22usize.saturating_sub(entry.name.len()));
                    out.push_str(&format!(" extracting: {}{pad}  \n", entry.name));
                }
                out.push_str(&crate::vfs::bytes_to_stream_string(&entry.content));
                if pipe_headers && !pipe_to_stdout && !quiet {
                    out.push('\n');
                }
            }
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }
    if names_only {
        let mut out = String::new();
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if !check_member(&entry.name) {
                continue;
            }
            out.push_str(&format!("{}\n", entry.name));
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }
    if list_table {
        let mut out = String::new();
        if !quiet {
            out.push_str(&format!("Archive:  {arch}\n"));
        }
        if verbose_list {
            out.push_str(" Length   Method    Size  Cmpr    Date    Time   CRC-32   Name\n--------  ------  ------- ---- ---------- ----- --------  ----\n");
        } else {
            out.push_str("  Length      Date    Time    Name\n---------  ---------- -----   ----\n");
        }
        let mut total_len = 0usize;
        let mut selected_count = 0usize;
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if !check_member(&entry.name) {
                continue;
            }
            let sz = entry.content.len();
            total_len += sz;
            selected_count += 1;
            let dt = format_utc_mtime(entry.mtime);
            if verbose_list {
                let crc = crc32_ieee(&entry.content);
                out.push_str(&format!(
                    "{sz:>8}  Stored {sz:>8}   0% {dt} {crc:08x}  {}\n",
                    entry.name
                ));
            } else {
                out.push_str(&format!("{sz:>9}  {dt}   {}\n", entry.name));
            }
        }
        let files_label = if selected_count == 1 { "file" } else { "files" };
        if verbose_list {
            out.push_str(&format!(
                "--------          -------  ---                            -------\n{total_len:>8}         {total_len:>8}   0%                            {selected_count} {files_label}\n"
            ));
        } else {
            out.push_str(&format!(
                "---------                     -------\n{total_len:>9}                     {selected_count} {files_label}\n"
            ));
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }
    {
        let out_dir = dest_dir
            .as_deref()
            .map(|d| resolve_posix_path(cwd, d))
            .unwrap_or_else(|| cwd.to_string());
        let _ = fs.mkdir_all(&out_dir);
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if !check_member(&entry.name) {
                continue;
            }
            if junk_paths {
                if entry.typeflag != b'0' {
                    continue;
                }
                let base = crate::vfs::basename_posix_path(&entry.name);
                let dest = resolve_posix_path(&out_dir, &base);
                if never_overwrite && fs.exists(&dest) {
                    continue;
                }
                let _ = fs.write_file(&dest, &entry.content);
            } else {
                let dest = resolve_posix_path(&out_dir, entry.name.trim_start_matches('/'));
                if entry.typeflag == b'5' || entry.name.ends_with('/') {
                    let _ = fs.mkdir_all(&dest);
                } else if entry.typeflag == b'2' {
                    let _ = fs.mkdir_all(&crate::vfs::dirname_posix_path(&dest));
                    let _ = fs.symlink(&entry.linkname, &dest);
                } else {
                    if never_overwrite && fs.exists(&dest) {
                        continue;
                    }
                    let _ = fs.mkdir_all(&crate::vfs::dirname_posix_path(&dest));
                    let _ = fs.write_file(&dest, &entry.content);
                }
            }
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        }
    }
}
fn cmd_strings(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut min_len = 4usize;
    let mut radix: Option<char> = None;
    let mut print_file = false;
    let mut include_ws = false;
    let mut encoding = 's';
    let mut unicode_mode = "default".to_string();
    let mut separator = "\n".to_string();
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if (a == "-n" || a == "--bytes") && i + 1 < args.len() {
            min_len = args[i + 1].parse().unwrap_or(4).max(1);
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-n").or_else(|| a.strip_prefix("--bytes="))
            && !rest.is_empty()
        {
            min_len = rest.parse().unwrap_or(4).max(1);
            i += 1;
        } else if (a == "-t" || a == "--radix") && i + 1 < args.len() {
            radix = args[i + 1].chars().next();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t").or_else(|| a.strip_prefix("--radix="))
            && !rest.is_empty()
        {
            radix = rest.chars().next();
            i += 1;
        } else if a == "-o" {
            radix = Some('o');
            i += 1;
        } else if a == "-f" || a == "--print-file-name" {
            print_file = true;
            i += 1;
        } else if a == "-w" || a == "--include-all-whitespace" {
            include_ws = true;
            i += 1;
        } else if (a == "-s" || a == "--output-separator") && i + 1 < args.len() {
            separator = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a
            .strip_prefix("-s")
            .or_else(|| a.strip_prefix("--output-separator="))
            && !rest.is_empty()
        {
            separator = rest.to_string();
            i += 1;
        } else if (a == "-e" || a == "--encoding") && i + 1 < args.len() {
            encoding = args[i + 1].chars().next().unwrap_or('s');
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-e").or_else(|| a.strip_prefix("--encoding="))
            && !rest.is_empty()
        {
            encoding = rest.chars().next().unwrap_or('s');
            i += 1;
        } else if (a == "-U" || a == "--unicode") && i + 1 < args.len() {
            unicode_mode = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-U").or_else(|| a.strip_prefix("--unicode="))
            && !rest.is_empty()
        {
            unicode_mode = rest.to_string();
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().all(|c| c.is_ascii_digit()) {
            let num_str = &a[1..];
            let parsed = if num_str.starts_with('0') && num_str.chars().all(|c| ('0'..='7').contains(&c)) {
                usize::from_str_radix(num_str, 8).unwrap_or(4)
            } else {
                num_str.parse().unwrap_or(4)
            };
            min_len = parsed.max(1);
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }

    let unicode = match unicode_mode.as_str() {
        "d" | "default" => "default",
        "i" | "invalid" => "invalid",
        "l" | "locale" => "locale",
        "x" | "hex" => "hex",
        "e" | "escape" => "escape",
        "h" | "highlight" => "highlight",
        other => return err_out(&format!("strings: invalid Unicode option '{other}'\n"), 1),
    };
    if unicode != "default" {
        encoding = 'S';
    }

    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let width: usize = match encoding {
        'b' | 'l' => 2,
        'B' | 'L' => 4,
        _ => 1,
    };
    let sep_bytes = crate::vfs::stream_string_to_bytes(&separator);
    let mut out_bytes: Vec<u8> = Vec::new();

    for f in &targets {
        let data = if f == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, f);
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => return err_out(&format!("strings: {f}: No such file\n"), 1),
            }
        };

        let mut cur_bytes: Vec<u8> = Vec::new();
        let mut char_count = 0usize;
        let mut start_off = 0usize;

        let flush = |out: &mut Vec<u8>,
                     cur: &mut Vec<u8>,
                     chars: &mut usize,
                     off: usize| {
            if *chars >= min_len {
                if print_file {
                    let label = if f == "-" { "{standard input}" } else { f.as_str() };
                    out.extend_from_slice(format!("{label}: ").as_bytes());
                }
                match radix {
                    Some('x') => out.extend_from_slice(format!("{off:7x} ").as_bytes()),
                    Some('d') => out.extend_from_slice(format!("{off:7} ").as_bytes()),
                    Some('o') => out.extend_from_slice(format!("{off:7o} ").as_bytes()),
                    _ => {}
                }
                out.extend_from_slice(cur);
                out.extend_from_slice(&sep_bytes);
            }
            cur.clear();
            *chars = 0;
        };

        if width == 1 {
            let mut utf8: Vec<u8> = Vec::new();
            let mut utf8_width = 0usize;
            for (idx, &b) in data.iter().enumerate() {
                let cur_b = b;
                let mut reprocess = true;
                while reprocess {
                    reprocess = false;
                    if unicode != "default" && cur_b >= 128 {
                        if utf8.is_empty() {
                            utf8_width = if (0xc0..0xe0).contains(&cur_b) {
                                2
                            } else if (0xe0..0xf0).contains(&cur_b) {
                                3
                            } else if (0xf0..0xf8).contains(&cur_b) {
                                4
                            } else {
                                0
                            };
                            if utf8_width == 0 {
                                flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                                break;
                            }
                        } else if !(0x80..0xc0).contains(&cur_b) {
                            utf8.clear();
                            flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                            reprocess = true;
                            continue;
                        }
                        utf8.push(cur_b);
                        if utf8.len() < utf8_width {
                            break;
                        }
                        if unicode == "invalid" {
                            flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                        } else if unicode == "locale" {
                            if char_count == 0 {
                                start_off = idx + 1 - utf8.len();
                            }
                            cur_bytes.extend_from_slice(&utf8);
                            char_count += 1;
                        } else {
                            let text = if unicode == "hex" {
                                let hex_s: String = utf8.iter().map(|v| format!("{v:02x}")).collect();
                                format!("<0x{hex_s}>")
                            } else {
                                let mut code = (utf8[0] & if utf8_width == 2 { 31 } else { 15 }) as u32;
                                for &cont in &utf8[1..] {
                                    code = code * 64 + ((cont & 63) as u32);
                                }
                                if utf8_width == 4 {
                                    code = (((utf8[0] & 7) as u32) << 18)
                                        | (((utf8[1] & 63) as u32) << 14)
                                        | (((utf8[2] & 63) as u32) << 6)
                                        | ((utf8[3] & 63) as u32);
                                }
                                if utf8_width == 4 {
                                    format!("\\u{code:06x}")
                                } else {
                                    format!("\\u{code:04x}")
                                }
                            };
                            if char_count == 0 {
                                start_off = idx + 1 - utf8.len();
                            }
                            cur_bytes.extend_from_slice(text.as_bytes());
                            char_count += 1;
                        }
                        utf8.clear();
                        break;
                    }
                    if !utf8.is_empty() {
                        utf8.clear();
                        flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                    }
                    let ok = cur_b == 9
                        || (32..=126).contains(&cur_b)
                        || (encoding == 'S' && cur_b >= 128)
                        || (include_ws && (10..=13).contains(&cur_b));
                    if ok {
                        if char_count == 0 {
                            start_off = idx;
                        }
                        cur_bytes.push(cur_b);
                        char_count += 1;
                    } else {
                        flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                    }
                }
            }
        } else {
            let little = encoding == 'l' || encoding == 'L';
            let mut idx = 0usize;
            while idx + width <= data.len() {
                let mut code = 0u32;
                for k in 0..width {
                    let byte = data[idx + if little { width - 1 - k } else { k }] as u32;
                    code = (code << 8) | byte;
                }
                let ok = code == 9
                    || (32..=126).contains(&code)
                    || (include_ws && (10..=13).contains(&code));
                if ok {
                    if char_count == 0 {
                        start_off = idx;
                    }
                    cur_bytes.push(code as u8);
                    char_count += 1;
                } else {
                    flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                }
                idx += width;
            }
        }
        flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
    }

    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn openssl_hash(name: &str, data: &[u8]) -> Vec<u8> {
    match name {
        "md5" => md5_bytes(data).to_vec(),
        "sha1" => sha1_bytes(data).to_vec(),
        "sha384" => sha384_bytes(data).to_vec(),
        "sha512" => sha512_bytes(data).to_vec(),
        _ => sha256_bytes(data).to_vec(),
    }
}

fn openssl_hmac(name: &str, key: &[u8], data: &[u8]) -> Vec<u8> {
    let block_size = if name == "sha384" || name == "sha512" { 128usize } else { 64usize };
    let mut k = if key.len() > block_size {
        openssl_hash(name, key)
    } else {
        key.to_vec()
    };
    k.resize(block_size, 0u8);
    let mut ipad = vec![0x36u8; block_size];
    let mut opad = vec![0x5cu8; block_size];
    for i in 0..block_size {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    ipad.extend_from_slice(data);
    let inner = openssl_hash(name, &ipad);
    opad.extend_from_slice(&inner);
    openssl_hash(name, &opad)
}

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, dk_len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(dk_len);
    let mut block_num = 1u32;
    while out.len() < dk_len {
        let mut salt_block = Vec::with_capacity(salt.len() + 4);
        salt_block.extend_from_slice(salt);
        salt_block.extend_from_slice(&block_num.to_be_bytes());
        let mut u = openssl_hmac("sha256", password, &salt_block);
        let mut t = u.clone();
        for _ in 1..iterations {
            u = openssl_hmac("sha256", password, &u);
            for (ti, ui) in t.iter_mut().zip(u.iter()) {
                *ti ^= *ui;
            }
        }
        let take = (dk_len - out.len()).min(t.len());
        out.extend_from_slice(&t[..take]);
        block_num += 1;
    }
    out
}

const AES_SBOX: [u8; 256] = [
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
];

const AES_INV_SBOX: [u8; 256] = [
    0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
    0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
    0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
    0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
    0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
    0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
    0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
    0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
    0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
    0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
    0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
    0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
    0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
    0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
    0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
    0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d,
];

fn aes_xtime(x: u8) -> u8 {
    (x << 1) ^ (if (x & 0x80) != 0 { 0x1b } else { 0 })
}

fn aes_gmul(mut a: u8, mut b: u8) -> u8 {
    let mut p = 0u8;
    for _ in 0..8 {
        if (b & 1) != 0 {
            p ^= a;
        }
        a = aes_xtime(a);
        b >>= 1;
    }
    p
}

fn aes_expand_key(key: &[u8]) -> (Vec<[u8; 16]>, usize) {
    let nk = key.len() / 4;
    let nr = if nk == 4 { 10 } else { 14 };
    let nb_words = 4 * (nr + 1);
    let mut w = vec![[0u8; 4]; nb_words];
    for i in 0..nk {
        w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
    }
    let rcon: [u8; 11] = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    for i in nk..nb_words {
        let mut temp = w[i - 1];
        if i % nk == 0 {
            temp = [
                AES_SBOX[temp[1] as usize] ^ rcon[i / nk],
                AES_SBOX[temp[2] as usize],
                AES_SBOX[temp[3] as usize],
                AES_SBOX[temp[0] as usize],
            ];
        } else if nk > 6 && i % nk == 4 {
            temp = [
                AES_SBOX[temp[0] as usize],
                AES_SBOX[temp[1] as usize],
                AES_SBOX[temp[2] as usize],
                AES_SBOX[temp[3] as usize],
            ];
        }
        let prev = w[i - nk];
        w[i] = [
            prev[0] ^ temp[0],
            prev[1] ^ temp[1],
            prev[2] ^ temp[2],
            prev[3] ^ temp[3],
        ];
    }
    let mut round_keys = Vec::with_capacity(nr + 1);
    for r in 0..=nr {
        let mut rk = [0u8; 16];
        for c in 0..4 {
            rk[4 * c..4 * c + 4].copy_from_slice(&w[4 * r + c]);
        }
        round_keys.push(rk);
    }
    (round_keys, nr)
}

fn aes_encrypt_block(block: &[u8; 16], round_keys: &[[u8; 16]], nr: usize) -> [u8; 16] {
    let mut s = *block;
    for i in 0..16 {
        s[i] ^= round_keys[0][i];
    }
    for round in 1..=nr {
        for i in 0..16 {
            s[i] = AES_SBOX[s[i] as usize];
        }
        let t = s;
        s[1] = t[5]; s[5] = t[9]; s[9] = t[13]; s[13] = t[1];
        s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
        s[3] = t[15]; s[7] = t[3]; s[11] = t[7]; s[15] = t[11];
        if round < nr {
            for c in 0..4 {
                let idx = 4 * c;
                let (a0, a1, a2, a3) = (s[idx], s[idx + 1], s[idx + 2], s[idx + 3]);
                s[idx] = aes_gmul(a0, 2) ^ aes_gmul(a1, 3) ^ a2 ^ a3;
                s[idx + 1] = a0 ^ aes_gmul(a1, 2) ^ aes_gmul(a2, 3) ^ a3;
                s[idx + 2] = a0 ^ a1 ^ aes_gmul(a2, 2) ^ aes_gmul(a3, 3);
                s[idx + 3] = aes_gmul(a0, 3) ^ a1 ^ a2 ^ aes_gmul(a3, 2);
            }
        }
        for i in 0..16 {
            s[i] ^= round_keys[round][i];
        }
    }
    s
}

fn aes_decrypt_block(block: &[u8; 16], round_keys: &[[u8; 16]], nr: usize) -> [u8; 16] {
    let mut s = *block;
    for i in 0..16 {
        s[i] ^= round_keys[nr][i];
    }
    for round in (1..=nr).rev() {
        let t = s;
        s[1] = t[13]; s[5] = t[1]; s[9] = t[5]; s[13] = t[9];
        s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
        s[3] = t[7]; s[7] = t[11]; s[11] = t[15]; s[15] = t[3];
        for i in 0..16 {
            s[i] = AES_INV_SBOX[s[i] as usize];
        }
        for i in 0..16 {
            s[i] ^= round_keys[round - 1][i];
        }
        if round > 1 {
            for c in 0..4 {
                let idx = 4 * c;
                let (a0, a1, a2, a3) = (s[idx], s[idx + 1], s[idx + 2], s[idx + 3]);
                s[idx] = aes_gmul(a0, 14) ^ aes_gmul(a1, 11) ^ aes_gmul(a2, 13) ^ aes_gmul(a3, 9);
                s[idx + 1] = aes_gmul(a0, 9) ^ aes_gmul(a1, 14) ^ aes_gmul(a2, 11) ^ aes_gmul(a3, 13);
                s[idx + 2] = aes_gmul(a0, 13) ^ aes_gmul(a1, 9) ^ aes_gmul(a2, 14) ^ aes_gmul(a3, 11);
                s[idx + 3] = aes_gmul(a0, 11) ^ aes_gmul(a1, 13) ^ aes_gmul(a2, 9) ^ aes_gmul(a3, 14);
            }
        }
    }
    s
}

fn openssl_hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn openssl_hex_decode(raw: &str) -> Result<Vec<u8>, String> {
    if raw.len() % 2 != 0 || !raw.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid hex value".to_string());
    }
    let mut out = Vec::with_capacity(raw.len() / 2);
    for i in (0..raw.len()).step_by(2) {
        let b = u8::from_str_radix(&raw[i..i + 2], 16).map_err(|_| "invalid hex value".to_string())?;
        out.push(b);
    }
    Ok(out)
}

fn openssl_b64_encode(bytes: &[u8], wrap: bool) -> String {
    let encoded = base64_encode(bytes);
    if !wrap || encoded.is_empty() {
        return encoded;
    }
    let mut lines = Vec::new();
    let chars: Vec<char> = encoded.chars().collect();
    for chunk in chars.chunks(64) {
        let line: String = chunk.iter().collect();
        lines.push(line);
    }
    lines.join("\n")
}

fn openssl_read_bytes(
    file: Option<&str>,
    stdin_buf: &mut Option<Vec<u8>>,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<Vec<u8>, String> {
    if let Some(f) = file && !f.is_empty() {
        let full = resolve_posix_path(cwd, f);
        fs.read_file(&full).map_err(|e| format!("{e}"))
    } else {
        Ok(stdin_buf.take().unwrap_or_default())
    }
}

fn openssl_write_bytes(
    data: &[u8],
    out_file: Option<&str>,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<BuiltinOutcome, String> {
    if let Some(f) = out_file && !f.is_empty() {
        let full = resolve_posix_path(cwd, f);
        fs.write_file(&full, data).map_err(|e| format!("{e}"))?;
        Ok(ok_out(""))
    } else {
        Ok(ok_out(&crate::vfs::bytes_to_stream_string(data)))
    }
}

fn openssl_crypt_password(password: &str, salt_input: &str, mode: &str) -> Result<String, String> {
    const ALPHABET: &[u8] = b"./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let encode_groups = |bytes: &[u8], groups: &[(isize, isize, isize, usize)]| -> String {
        let mut out = String::new();
        for &(a, b, c, count) in groups {
            let ba = if a >= 0 { *bytes.get(a as usize).unwrap_or(&0) as u32 } else { 0 };
            let bb = if b >= 0 { *bytes.get(b as usize).unwrap_or(&0) as u32 } else { 0 };
            let bc = if c >= 0 { *bytes.get(c as usize).unwrap_or(&0) as u32 } else { 0 };
            let mut word = (ba << 16) | (bb << 8) | bc;
            for _ in 0..count {
                out.push(ALPHABET[(word & 63) as usize] as char);
                word >>= 6;
            }
        }
        out
    };
    let repeat_bytes = |src: &[u8], len: usize| -> Vec<u8> {
        if src.is_empty() {
            return Vec::new();
        }
        (0..len).map(|i| src[i % src.len()]).collect()
    };
    let mut rounds = if mode == "1" || mode == "apr1" { 1000usize } else { 5000usize };
    let mut round_prefix = String::new();
    let mut salt_rem = salt_input;
    if (mode == "5" || mode == "6") && let Some(rest) = salt_rem.strip_prefix("rounds=") {
        let Some((val, after)) = rest.split_once('$') else {
            return Err("invalid crypt rounds".to_string());
        };
        if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
            return Err("invalid crypt rounds".to_string());
        }
        let parsed = val.parse::<usize>().map_err(|_| "invalid crypt rounds".to_string())?;
        rounds = parsed.max(1000);
        round_prefix = format!("rounds={rounds}$");
        salt_rem = after;
    }
    let max_salt = if mode == "1" || mode == "apr1" { 8 } else { 16 };
    let salt_first = salt_rem.split('$').next().unwrap_or("");
    let salt: String = salt_first.chars().take(max_salt).collect();
    let p = password.as_bytes();
    let s = salt.as_bytes();
    let magic = format!("${mode}$");
    if mode == "1" || mode == "apr1" {
        let mut alt_in = Vec::new();
        alt_in.extend_from_slice(p);
        alt_in.extend_from_slice(s);
        alt_in.extend_from_slice(p);
        let alt = md5_bytes(&alt_in);
        let mut init = Vec::new();
        init.extend_from_slice(p);
        init.extend_from_slice(magic.as_bytes());
        init.extend_from_slice(s);
        init.extend_from_slice(&repeat_bytes(&alt, p.len()));
        let mut n = p.len();
        while n > 0 {
            if (n & 1) != 0 {
                init.push(0);
            } else {
                init.push(*p.first().unwrap_or(&0));
            }
            n >>= 1;
        }
        let mut digest = md5_bytes(&init).to_vec();
        for i in 0..1000usize {
            let mut buf = Vec::new();
            if (i & 1) != 0 { buf.extend_from_slice(p); } else { buf.extend_from_slice(&digest); }
            if i % 3 != 0 { buf.extend_from_slice(s); }
            if i % 7 != 0 { buf.extend_from_slice(p); }
            if (i & 1) != 0 { buf.extend_from_slice(&digest); } else { buf.extend_from_slice(p); }
            digest = md5_bytes(&buf).to_vec();
        }
        let groups = [
            (0,6,12,4), (1,7,13,4), (2,8,14,4), (3,9,15,4), (4,10,5,4), (-1,-1,11,2)
        ];
        let enc_str = encode_groups(&digest, &groups);
        return Ok(format!("{magic}{salt}${enc_str}"));
    }
    let hash_fn = |d: &[u8]| -> Vec<u8> {
        if mode == "5" { sha256_bytes(d).to_vec() } else { sha512_bytes(d).to_vec() }
    };
    let mut alt_in = Vec::new();
    alt_in.extend_from_slice(p);
    alt_in.extend_from_slice(s);
    alt_in.extend_from_slice(p);
    let alt = hash_fn(&alt_in);
    let mut init = Vec::new();
    init.extend_from_slice(p);
    init.extend_from_slice(s);
    init.extend_from_slice(&repeat_bytes(&alt, p.len()));
    let mut n = p.len();
    while n > 0 {
        if (n & 1) != 0 { init.extend_from_slice(&alt); } else { init.extend_from_slice(p); }
        n >>= 1;
    }
    let mut digest = hash_fn(&init);
    let mut ph_in = Vec::new();
    for _ in 0..p.len() { ph_in.extend_from_slice(p); }
    let seq_p = repeat_bytes(&hash_fn(&ph_in), p.len());
    let mut sh_in = Vec::new();
    for _ in 0..(16 + digest[0] as usize) { sh_in.extend_from_slice(s); }
    let seq_s = repeat_bytes(&hash_fn(&sh_in), s.len());
    for i in 0..rounds {
        let mut buf = Vec::new();
        if (i & 1) != 0 { buf.extend_from_slice(&seq_p); } else { buf.extend_from_slice(&digest); }
        if i % 3 != 0 { buf.extend_from_slice(&seq_s); }
        if i % 7 != 0 { buf.extend_from_slice(&seq_p); }
        if (i & 1) != 0 { buf.extend_from_slice(&digest); } else { buf.extend_from_slice(&seq_p); }
        digest = hash_fn(&buf);
    }
    let encoded = if mode == "5" {
        let groups = [
            (0,10,20,4),(21,1,11,4),(12,22,2,4),(3,13,23,4),(24,4,14,4),
            (15,25,5,4),(6,16,26,4),(27,7,17,4),(18,28,8,4),(9,19,29,4),(-1,31,30,3)
        ];
        encode_groups(&digest, &groups)
    } else {
        let groups = [
            (0,21,42,4),(22,43,1,4),(44,2,23,4),(3,24,45,4),(25,46,4,4),(47,5,26,4),
            (6,27,48,4),(28,49,7,4),(50,8,29,4),(9,30,51,4),(31,52,10,4),(53,11,32,4),
            (12,33,54,4),(34,55,13,4),(56,14,35,4),(15,36,57,4),(37,58,16,4),(59,17,38,4),
            (18,39,60,4),(40,61,19,4),(62,20,41,4),(-1,-1,63,2)
        ];
        encode_groups(&digest, &groups)
    };
    Ok(format!("{magic}{round_prefix}{salt}${encoded}"))
}

fn openssl_extract_key_seed(raw: &[u8]) -> Result<(String, Vec<u8>), String> {
    let text = String::from_utf8_lossy(raw);
    let trimmed = text.trim();
    if trimmed.starts_with("-----BEGIN ") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() < 2 || !lines.last().unwrap_or(&"").starts_with("-----END ") {
            return Err("invalid PEM input".to_string());
        }
        let label = lines[0].trim_start_matches("-----BEGIN ").trim_end_matches("-----").to_string();
        let body: String = lines[1..lines.len() - 1].join("");
        let decoded = base64_decode(&body)?;
        let decoded_str = String::from_utf8_lossy(&decoded);
        if let Some(rest) = decoded_str.strip_prefix("SBKEY:") {
            let parts: Vec<&str> = rest.splitn(4, ':').collect();
            if parts.len() == 4 {
                let seed = openssl_hex_decode(parts[3]).unwrap_or_else(|_| parts[3].as_bytes().to_vec());
                return Ok((format!("{}:{}:{}", parts[0], parts[1], parts[2]), seed));
            }
        }
        let pub_seed = sha256_bytes(&decoded).to_vec();
        return Ok((label, pub_seed));
    }
    let decoded_str = String::from_utf8_lossy(raw);
    if let Some(rest) = decoded_str.strip_prefix("SBKEY:") {
        let parts: Vec<&str> = rest.splitn(4, ':').collect();
        if parts.len() == 4 {
            let seed = openssl_hex_decode(parts[3]).unwrap_or_else(|_| parts[3].as_bytes().to_vec());
            return Ok((format!("{}:{}:{}", parts[0], parts[1], parts[2]), seed));
        }
    }
    Ok(("DER".to_string(), sha256_bytes(raw).to_vec()))
}

fn openssl_format_subject(subj: &str) -> Result<String, String> {
    if !subj.starts_with('/') {
        return Err("subject must use /name=value notation".to_string());
    }
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut escaped = false;
    for c in subj[1..].chars() {
        if escaped {
            field.push(c);
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == '/' {
            fields.push(field.clone());
            field.clear();
        } else {
            field.push(c);
        }
    }
    if escaped {
        return Err("incomplete subject escape".to_string());
    }
    fields.push(field);
    let mut formatted = Vec::new();
    for part in fields.into_iter().filter(|s| !s.is_empty()) {
        let Some((k, v)) = part.split_once('=') else {
            return Err("invalid subject attribute".to_string());
        };
        if k.is_empty() {
            return Err("invalid subject attribute".to_string());
        }
        formatted.push(format!("{k}={v}"));
    }
    Ok(formatted.join(", "))
}

fn cmd_openssl(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let run = || -> Result<BuiltinOutcome, String> {
        let sub = args.first().map(|s| s.as_str()).unwrap_or("help");
        let rest = if args.is_empty() { &[][..] } else { &args[1..] };
        let mut stdin_buf = Some(crate::vfs::stream_string_to_bytes(stdin));

        if matches!(sub, "help" | "--help" | "-h") {
            return Ok(ok_out("Usage: openssl <subcommand> [options]\nSubcommands: version, dgst, md5, sha1, sha256, sha384, sha512, rand, base64, enc, genpkey, genrsa, rsa, ecparam, ec, pkey, pkeyutl, req, x509, passwd\n"));
        }
        if matches!(sub, "version" | "--version" | "-v") {
            let mut has_a = false;
            let mut flags = std::collections::BTreeSet::new();
            for a in rest {
                match a.as_str() {
                    "-a" => has_a = true,
                    "-v" | "-b" | "-o" | "-f" | "-p" | "-d" => { flags.insert(a.as_str()); }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected version argument".to_string()),
                }
            }
            let entries = [
                ("-v", "OpenSSL compatible safe-bash toolkit (Web Crypto)"),
                ("-b", "built on: portable JavaScript"),
                ("-o", "options: Web Crypto, in-memory VFS"),
                ("-f", "compiler: TypeScript"),
                ("-p", "platform: portable"),
                ("-d", "OPENSSLDIR: virtual filesystem"),
            ];
            let mut lines = Vec::new();
            for (flag, val) in entries {
                if (rest.is_empty() && flag == "-v") || has_a || flags.contains(flag) {
                    lines.push(val);
                }
            }
            let joined = lines.join("\n");
            return Ok(ok_out(&format!("{joined}\n")));
        }
        if matches!(sub, "dgst" | "md5" | "sha1" | "sha256" | "sha384" | "sha512") {
            let mut hash_name = if sub == "dgst" { "sha256".to_string() } else { sub.to_string() };
            let mut binary = false;
            let mut hex_flag = false;
            let mut r_flag = false;
            let mut hmac_key: Option<String> = None;
            let mut sign_key: Option<String> = None;
            let mut verify_key: Option<String> = None;
            let mut prverify_key: Option<String> = None;
            let mut sig_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-md5" | "-sha1" | "-sha256" | "-sha384" | "-sha512" => hash_name = a[1..].to_string(),
                    "-binary" => binary = true,
                    "-hex" => hex_flag = true,
                    "-r" => r_flag = true,
                    "-hmac" | "-sign" | "-verify" | "-prverify" | "-signature" | "-out" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-hmac" => hmac_key = Some(val),
                            "-sign" => sign_key = Some(val),
                            "-verify" => verify_key = Some(val),
                            "-prverify" => prverify_key = Some(val),
                            "-signature" => sig_file = Some(val),
                            "-out" => out_file = Some(val),
                            _ => {}
                        }
                    }
                    "--" => {
                        positional.extend(rest[i + 1..].iter().cloned());
                        break;
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            if sign_key.is_some() || verify_key.is_some() || prverify_key.is_some() {
                if positional.len() > 1 || (sign_key.is_some() && (verify_key.is_some() || prverify_key.is_some())) {
                    return Err("sign/verify requires one input and one operation".to_string());
                }
                let key_path = sign_key.as_deref().or(verify_key.as_deref()).or(prverify_key.as_deref()).unwrap();
                let key_bytes = openssl_read_bytes(Some(key_path), &mut stdin_buf, cwd, fs)?;
                let (_meta, seed) = openssl_extract_key_seed(&key_bytes)?;
                let input = openssl_read_bytes(positional.first().map(|s| s.as_str()), &mut stdin_buf, cwd, fs)?;
                let expected_sig = openssl_hmac(&hash_name, &seed, &input);
                if sign_key.is_some() {
                    if hex_flag {
                        let hx = openssl_hex_encode(&expected_sig);
                        let txt = format!("{hx}\n");
                        return openssl_write_bytes(txt.as_bytes(), out_file.as_deref(), cwd, fs);
                    }
                    return openssl_write_bytes(&expected_sig, out_file.as_deref(), cwd, fs);
                } else {
                    let sf = sig_file.as_deref().ok_or_else(|| "sign/verify requires a key and verification requires a signature".to_string())?;
                    let actual_sig = openssl_read_bytes(Some(sf), &mut stdin_buf, cwd, fs)?;
                    let valid = actual_sig == expected_sig;
                    let msg = if valid { "Verified OK\n" } else { "Verification Failure\n" };
                    let mut res = openssl_write_bytes(msg.as_bytes(), out_file.as_deref(), cwd, fs)?;
                    res.exit_code = if valid { 0 } else { 1 };
                    return Ok(res);
                }
            }
            if sig_file.is_some() {
                return Err("-signature requires -verify".to_string());
            }
            let files: Vec<Option<String>> = if positional.is_empty() {
                vec![None]
            } else {
                positional.into_iter().map(Some).collect()
            };
            let mut output = Vec::new();
            for file in files {
                let input = openssl_read_bytes(file.as_deref(), &mut stdin_buf, cwd, fs)?;
                let digest = if let Some(ref hk) = hmac_key {
                    openssl_hmac(&hash_name, hk.as_bytes(), &input)
                } else {
                    openssl_hash(&hash_name, &input)
                };
                let label = if hash_name.starts_with("sha") && hash_name != "sha1" {
                    format!("SHA2-{}", &hash_name[3..])
                } else {
                    hash_name.to_uppercase()
                };
                if binary && !hex_flag {
                    output.extend_from_slice(&digest);
                } else {
                    let fname = file.as_deref().unwrap_or("stdin");
                    let hex_str = openssl_hex_encode(&digest);
                    let line = if r_flag {
                        format!("{hex_str} *{fname}\n")
                    } else {
                        let hmac_prefix = if file.is_some() && hmac_key.is_some() { "HMAC-" } else { "" };
                        format!("{hmac_prefix}{label}({fname})= {hex_str}\n")
                    };
                    output.extend_from_slice(line.as_bytes());
                }
            }
            return openssl_write_bytes(&output, out_file.as_deref(), cwd, fs);
        }
        if sub == "rand" {
            let mut hex_flag = false;
            let mut b64_flag = false;
            let mut out_file: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-hex" => hex_flag = true,
                    "-base64" => b64_flag = true,
                    "-out" => {
                        i += 1;
                        out_file = Some(rest.get(i).ok_or_else(|| "missing value for -out".to_string())?.clone());
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            if positional.len() != 1 || (hex_flag && b64_flag) {
                return Err("rand requires a byte count and one output format".to_string());
            }
            let raw_cnt = &positional[0];
            if raw_cnt.is_empty() || !raw_cnt.chars().all(|c| c.is_ascii_digit()) {
                return Err("invalid random byte count".to_string());
            }
            let count = raw_cnt.parse::<usize>().map_err(|_| "invalid random byte count".to_string())?;
            let mut bytes = vec![0u8; count];
            for (idx, b) in bytes.iter_mut().enumerate() {
                let h = sha256_bytes(format!("safe-bash-rand-{count}-{idx}").as_bytes());
                *b = h[idx % 32];
            }
            if hex_flag {
                let hx = openssl_hex_encode(&bytes);
                let s = format!("{hx}\n");
                return openssl_write_bytes(s.as_bytes(), out_file.as_deref(), cwd, fs);
            }
            if b64_flag {
                let b64 = openssl_b64_encode(&bytes, true);
                let s = format!("{b64}\n");
                return openssl_write_bytes(s.as_bytes(), out_file.as_deref(), cwd, fs);
            }
            return openssl_write_bytes(&bytes, out_file.as_deref(), cwd, fs);
        }
        if sub == "base64" {
            let mut decode = false;
            let mut no_nl = false;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-d" => decode = true,
                    "-e" | "-a" | "-base64" => {}
                    "-A" => no_nl = true,
                    "-in" | "-out" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        if a == "-in" { in_file = Some(val); } else { out_file = Some(val); }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected base64 argument".to_string()),
                }
                i += 1;
            }
            let input = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
            if decode {
                let s = String::from_utf8_lossy(&input);
                let clean: String = s.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r')).map(|c| match c { '-' => '+', '_' => '/', _ => c }).collect();
                let decoded = base64_decode(&clean)?;
                return openssl_write_bytes(&decoded, out_file.as_deref(), cwd, fs);
            } else {
                let mut encoded = openssl_b64_encode(&input, !no_nl);
                if !no_nl && !input.is_empty() {
                    encoded.push('\n');
                }
                return openssl_write_bytes(encoded.as_bytes(), out_file.as_deref(), cwd, fs);
            }
        }
        if sub == "passwd" {
            let mut modes = Vec::new();
            let mut from_stdin = false;
            let mut salt_opt: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-1" | "-5" | "-6" | "-apr1" => {
                        if !modes.contains(&&a[1..]) {
                            modes.push(&a[1..]);
                        }
                    }
                    "-stdin" => from_stdin = true,
                    "-salt" => {
                        i += 1;
                        salt_opt = Some(rest.get(i).ok_or_else(|| "missing value for -salt".to_string())?.clone());
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            if modes.len() > 1 {
                return Err("choose one password hash format".to_string());
            }
            let mode = modes.first().copied().unwrap_or("1");
            let passwords: Vec<String> = if from_stdin {
                let raw = openssl_read_bytes(None, &mut stdin_buf, cwd, fs)?;
                let txt = String::from_utf8_lossy(&raw);
                let mut lines: Vec<String> = txt.split('\n').map(|s| s.to_string()).collect();
                if lines.last().map(|s| s.is_empty()).unwrap_or(false) {
                    lines.pop();
                }
                lines
            } else {
                positional
            };
            if passwords.is_empty() {
                return Err("password required via argument or -stdin".to_string());
            }
            let mut out = String::new();
            for mut pw in passwords {
                if pw.ends_with('\r') {
                    pw.pop();
                }
                let salt = salt_opt.clone().unwrap_or_else(|| "abCD1234".to_string());
                let hashed = openssl_crypt_password(&pw, &salt, mode)?;
                out.push_str(&hashed);
                out.push('\n');
            }
            return Ok(ok_out(&out));
        }
        if sub == "enc" {
            let mut ciphers = Vec::new();
            let mut decrypt = false;
            let mut encoded = false;
            let mut no_nl = false;
            let mut nosalt = false;
            let mut pbkdf2 = false;
            let mut iter_opt: Option<u32> = None;
            let mut k_opt: Option<String> = None;
            let mut pass_opt: Option<String> = None;
            let mut hex_key: Option<String> = None;
            let mut hex_iv: Option<String> = None;
            let mut hex_salt: Option<String> = None;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-aes-128-cbc" | "-aes-256-cbc" | "-aes-256-ctr" => {
                        if !ciphers.contains(&a) { ciphers.push(a); }
                    }
                    "-d" => decrypt = true,
                    "-e" | "-salt" => {}
                    "-a" | "-base64" => encoded = true,
                    "-A" => no_nl = true,
                    "-nosalt" => nosalt = true,
                    "-pbkdf2" => pbkdf2 = true,
                    "-k" | "-pass" | "-K" | "-iv" | "-S" | "-iter" | "-in" | "-out" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-k" => k_opt = Some(val),
                            "-pass" => pass_opt = Some(val),
                            "-K" => hex_key = Some(val),
                            "-iv" => hex_iv = Some(val),
                            "-S" => hex_salt = Some(val),
                            "-iter" => {
                                if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                                    return Err(format!("invalid or excessive -iter: {val}"));
                                }
                                let n = val.parse::<u32>().map_err(|_| format!("invalid or excessive -iter: {val}"))?;
                                if !(1..=1_000_000).contains(&n) {
                                    return Err(format!("invalid or excessive -iter: {val}"));
                                }
                                iter_opt = Some(n);
                            }
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            _ => {}
                        }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected enc argument".to_string()),
                }
                i += 1;
            }
            if ciphers.len() != 1 {
                return Err("select one supported AES cipher".to_string());
            }
            let cipher = ciphers[0];
            let key_len = if cipher == "-aes-128-cbc" { 16usize } else { 32usize };
            let is_ctr = cipher == "-aes-256-ctr";
            let iterations = iter_opt.unwrap_or(10000);
            let password: Option<String> = if let Some(spec) = pass_opt {
                if let Some(p) = spec.strip_prefix("pass:") {
                    Some(p.to_string())
                } else if let Some(var) = spec.strip_prefix("env:") {
                    let v = env.get(var).ok_or_else(|| "password environment variable is not set".to_string())?;
                    Some(v.clone())
                } else if let Some(fp) = spec.strip_prefix("file:") {
                    let b = openssl_read_bytes(Some(fp), &mut stdin_buf, cwd, fs)?;
                    let s = String::from_utf8_lossy(&b);
                    Some(s.lines().next().unwrap_or("").trim_end_matches('\r').to_string())
                } else if spec == "stdin" {
                    let b = stdin_buf.take().unwrap_or_default();
                    if let Some(pos) = b.iter().position(|&c| c == b'\n') {
                        stdin_buf = Some(b[pos + 1..].to_vec());
                        let line = String::from_utf8_lossy(&b[..pos]).trim_end_matches('\r').to_string();
                        Some(line)
                    } else {
                        Some(String::from_utf8_lossy(&b).trim_end_matches('\r').to_string())
                    }
                } else {
                    return Err("password source must be pass:, env:, file: or stdin".to_string());
                }
            } else {
                k_opt
            };

            let mut input = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
            if decrypt && encoded {
                let s = String::from_utf8_lossy(&input);
                let clean: String = s.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r')).map(|c| match c { '-' => '+', '_' => '/', _ => c }).collect();
                input = base64_decode(&clean)?;
            }
            let salted = !nosalt && hex_key.is_none();
            let mut salt = Vec::new();
            if salted {
                if let Some(ref hs) = hex_salt {
                    salt = openssl_hex_decode(hs)?;
                    if salt.len() != 8 {
                        return Err("salt must contain 8 bytes".to_string());
                    }
                } else if decrypt {
                    if input.len() < 16 || &input[..8] != b"Salted__" {
                        return Err("bad magic number in encrypted input".to_string());
                    }
                    salt = input[8..16].to_vec();
                    input = input[16..].to_vec();
                } else {
                    salt = b"12345678".to_vec();
                }
            }
            let (key, iv) = if let Some(ref hk) = hex_key {
                let k = openssl_hex_decode(hk)?;
                let v = openssl_hex_decode(hex_iv.as_deref().unwrap_or(""))?;
                (k, v)
            } else {
                let pw = password.ok_or_else(|| "password required: use -k or -pass".to_string())?;
                let derived = if pbkdf2 || iter_opt.is_some() {
                    pbkdf2_hmac_sha256(pw.as_bytes(), &salt, iterations, key_len + 16)
                } else {
                    let mut blocks = Vec::new();
                    let mut prev = Vec::new();
                    while blocks.len() < key_len + 16 {
                        let mut buf = Vec::new();
                        buf.extend_from_slice(&prev);
                        buf.extend_from_slice(pw.as_bytes());
                        buf.extend_from_slice(&salt);
                        prev = sha256_bytes(&buf).to_vec();
                        blocks.extend_from_slice(&prev);
                    }
                    blocks
                };
                let k = derived[..key_len].to_vec();
                let v = if let Some(ref hiv) = hex_iv {
                    openssl_hex_decode(hiv)?
                } else {
                    derived[key_len..key_len + 16].to_vec()
                };
                (k, v)
            };
            if key.len() != key_len || iv.len() != 16 {
                return Err(format!("key must contain {key_len} bytes and IV 16 bytes"));
            }
            let (round_keys, nr) = aes_expand_key(&key);
            let mut result = if is_ctr {
                let mut out = Vec::with_capacity(input.len());
                let mut counter = [0u8; 16];
                counter.copy_from_slice(&iv);
                for chunk in input.chunks(16) {
                    let ks = aes_encrypt_block(&counter, &round_keys, nr);
                    for (b, k) in chunk.iter().zip(ks.iter()) {
                        out.push(b ^ k);
                    }
                    for idx in (0..16).rev() {
                        counter[idx] = counter[idx].wrapping_add(1);
                        if counter[idx] != 0 {
                            break;
                        }
                    }
                }
                out
            } else if !decrypt {
                let pad_len = 16 - (input.len() % 16);
                let mut padded = input.clone();
                padded.extend(std::iter::repeat_n(pad_len as u8, pad_len));
                let mut out = Vec::with_capacity(padded.len());
                let mut prev = [0u8; 16];
                prev.copy_from_slice(&iv);
                for chunk in padded.chunks_exact(16) {
                    let mut blk = [0u8; 16];
                    for j in 0..16 {
                        blk[j] = chunk[j] ^ prev[j];
                    }
                    prev = aes_encrypt_block(&blk, &round_keys, nr);
                    out.extend_from_slice(&prev);
                }
                out
            } else {
                if input.is_empty() || input.len() % 16 != 0 {
                    return Err("bad decrypt".to_string());
                }
                let mut out = Vec::with_capacity(input.len());
                let mut prev = [0u8; 16];
                prev.copy_from_slice(&iv);
                for chunk in input.chunks_exact(16) {
                    let mut blk = [0u8; 16];
                    blk.copy_from_slice(chunk);
                    let mut dec = aes_decrypt_block(&blk, &round_keys, nr);
                    for j in 0..16 {
                        dec[j] ^= prev[j];
                    }
                    out.extend_from_slice(&dec);
                    prev = blk;
                }
                let pad = *out.last().unwrap_or(&0) as usize;
                if pad == 0 || pad > 16 || out.len() < pad || !out[out.len() - pad..].iter().all(|&b| b as usize == pad) {
                    return Err("bad decrypt".to_string());
                }
                out.truncate(out.len() - pad);
                out
            };
            if !decrypt && salted && hex_salt.is_none() {
                let mut with_header = Vec::with_capacity(16 + result.len());
                with_header.extend_from_slice(b"Salted__");
                with_header.extend_from_slice(&salt);
                with_header.extend_from_slice(&result);
                result = with_header;
            }
            if !decrypt && encoded {
                let mut b64 = openssl_b64_encode(&result, !no_nl);
                if !no_nl {
                    b64.push('\n');
                }
                return openssl_write_bytes(b64.as_bytes(), out_file.as_deref(), cwd, fs);
            }
            return openssl_write_bytes(&result, out_file.as_deref(), cwd, fs);
        }
        if matches!(sub, "genpkey" | "genrsa" | "rsa" | "ecparam" | "ec" | "pkey") {
            let mut pubout = false;
            let mut pubin = false;
            let mut noout = false;
            let mut text_flag = false;
            let mut modulus_flag = false;
            let mut check_flag = false;
            let mut genkey_flag = false;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut outform = "PEM".to_string();
            let mut algorithm: Option<String> = None;
            let mut curve_name = "prime256v1".to_string();
            let mut pkeyopts = Vec::new();
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-pubout" => pubout = true,
                    "-pubin" => pubin = true,
                    "-noout" => noout = true,
                    "-text" => text_flag = true,
                    "-modulus" => modulus_flag = true,
                    "-check" => check_flag = true,
                    "-genkey" => genkey_flag = true,
                    "-noenc" | "-nodes" => {}
                    "-in" | "-out" | "-inform" | "-outform" | "-algorithm" | "-pkeyopt" | "-name" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            "-outform" => outform = val,
                            "-algorithm" => algorithm = Some(val),
                            "-pkeyopt" => pkeyopts.push(val),
                            "-name" => curve_name = val,
                            _ => {}
                        }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            let generating = matches!(sub, "genrsa" | "genpkey" | "ecparam");
            let (alg, bits_or_curve, is_pub, seed) = if generating {
                let mut bits = positional.first().and_then(|s| s.parse::<usize>().ok()).unwrap_or(2048);
                for opt in &pkeyopts {
                    if let Some(b) = opt.strip_prefix("rsa_keygen_bits:") {
                        bits = b.parse::<usize>().unwrap_or(2048);
                    } else if let Some(c) = opt.strip_prefix("ec_paramgen_curve:") {
                        curve_name = c.to_string();
                    } else {
                        return Err(format!("unsupported key option: {opt}"));
                    }
                }
                if sub == "ecparam" && !genkey_flag {
                    let mut out = String::new();
                    if text_flag {
                        out.push_str(&format!("ASN1 OID: {curve_name}\n"));
                    }
                    if !noout {
                        let b64 = base64_encode(curve_name.as_bytes());
                        out.push_str(&format!("-----BEGIN EC PARAMETERS-----\n{b64}\n-----END EC PARAMETERS-----\n"));
                    }
                    return openssl_write_bytes(out.as_bytes(), out_file.as_deref(), cwd, fs);
                }
                let alg_str = algorithm.unwrap_or_else(|| if sub == "ecparam" { "EC".to_string() } else { "RSA".to_string() }).to_uppercase();
                let seed_bytes = sha256_bytes(format!("sb-key-{alg_str}-{bits}-{curve_name}").as_bytes()).to_vec();
                let boc = if alg_str == "RSA" { bits.to_string() } else { curve_name.clone() };
                (alg_str, boc, pubout, seed_bytes)
            } else {
                let raw = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
                let (meta, seed_bytes) = openssl_extract_key_seed(&raw)?;
                let parts: Vec<&str> = meta.split(':').collect();
                let alg_str = parts.first().copied().unwrap_or("RSA").to_string();
                let boc = parts.get(2).copied().unwrap_or("2048").to_string();
                let was_pub = pubin || parts.get(1).copied() == Some("PUBLIC");
                (alg_str, boc, was_pub || pubout, seed_bytes)
            };
            let mut lines = Vec::new();
            if check_flag {
                lines.push("Key is valid".to_string());
            }
            if text_flag {
                let role = if is_pub { "Public" } else { "Private" };
                let hx = openssl_hex_encode(&seed);
                lines.push(format!("{role}-Key: ({bits_or_curve} bit)"));
                lines.push(format!("modulus: {hx}"));
            }
            if modulus_flag {
                let hx = openssl_hex_encode(&seed).to_uppercase();
                lines.push(format!("Modulus={hx}"));
            }
            let mut output = if lines.is_empty() {
                String::new()
            } else {
                let joined = lines.join("\n");
                format!("{joined}\n")
            };
            if !noout || (sub == "ecparam" && genkey_flag) {
                let role_tag = if is_pub { "PUBLIC" } else { "PRIVATE" };
                let hx = openssl_hex_encode(&seed);
                let payload = format!("SBKEY:{alg}:{role_tag}:{bits_or_curve}:{hx}");
                if outform == "DER" {
                    return openssl_write_bytes(payload.as_bytes(), out_file.as_deref(), cwd, fs);
                }
                let label = if is_pub { "PUBLIC KEY" } else { "PRIVATE KEY" };
                let b64 = openssl_b64_encode(payload.as_bytes(), true);
                output.push_str(&format!("-----BEGIN {label}-----\n{b64}\n-----END {label}-----\n"));
            }
            return openssl_write_bytes(output.as_bytes(), out_file.as_deref(), cwd, fs);
        }
        if sub == "pkeyutl" {
            let mut sign = false;
            let mut verify = false;
            let mut inkey: Option<String> = None;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut sig_file: Option<String> = None;
            let mut digest = "sha256".to_string();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-sign" => sign = true,
                    "-verify" => verify = true,
                    "-rawin" | "-pubin" => {}
                    "-inkey" | "-in" | "-out" | "-sigfile" | "-digest" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-inkey" => inkey = Some(val),
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            "-sigfile" => sig_file = Some(val),
                            "-digest" => digest = val,
                            _ => {}
                        }
                    }
                    _ => return Err(format!("unknown option: {a}")),
                }
                i += 1;
            }
            if inkey.is_none() || (sign == verify) {
                return Err("pkeyutl requires -inkey and one of -sign/-verify".to_string());
            }
            let key_bytes = openssl_read_bytes(inkey.as_deref(), &mut stdin_buf, cwd, fs)?;
            let (_meta, seed) = openssl_extract_key_seed(&key_bytes)?;
            let input = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
            let expected = openssl_hmac(&digest, &seed, &input);
            if sign {
                return openssl_write_bytes(&expected, out_file.as_deref(), cwd, fs);
            } else {
                let sf = sig_file.as_deref().ok_or_else(|| "sign/verify requires a key and verification requires a signature".to_string())?;
                let actual = openssl_read_bytes(Some(sf), &mut stdin_buf, cwd, fs)?;
                if actual == expected {
                    return openssl_write_bytes(b"Signature Verified Successfully\n", out_file.as_deref(), cwd, fs);
                } else {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "Signature Verification Failure\n".to_string(),
                        exit_code: 1,
                    });
                }
            }
        }
        if sub == "req" || sub == "x509" {
            let mut is_new = false;
            let mut is_x509 = sub == "x509";
            let mut noout = false;
            let mut text_flag = false;
            let mut subject_flag = false;
            let mut issuer_flag = false;
            let mut dates_flag = false;
            let mut startdate_flag = false;
            let mut enddate_flag = false;
            let mut serial_flag = false;
            let mut fingerprint_flag = false;
            let mut verify_flag = false;
            let mut fp_hash = "sha1";
            let mut explicit_hash = false;
            let mut key_file: Option<String> = None;
            let mut keyout_file: Option<String> = None;
            let mut newkey_spec: Option<String> = None;
            let mut days = 30usize;
            let mut subj_opt: Option<String> = None;
            let mut addexts = Vec::new();
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut outform = "PEM".to_string();
            let mut checkend_opt: Option<usize> = None;
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-new" => is_new = true,
                    "-x509" => is_x509 = true,
                    "-nodes" | "-noenc" => {}
                    "-noout" => noout = true,
                    "-text" => text_flag = true,
                    "-subject" => subject_flag = true,
                    "-issuer" => issuer_flag = true,
                    "-dates" => dates_flag = true,
                    "-startdate" => startdate_flag = true,
                    "-enddate" => enddate_flag = true,
                    "-serial" => serial_flag = true,
                    "-fingerprint" => fingerprint_flag = true,
                    "-verify" => verify_flag = true,
                    "-sha1" | "-sha256" | "-sha384" | "-sha512" => {
                        fp_hash = &a[1..];
                        explicit_hash = true;
                    }
                    "-key" | "-keyout" | "-newkey" | "-days" | "-subj" | "-addext" | "-in" | "-out" | "-inform" | "-outform" | "-ext" | "-checkend" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-key" => key_file = Some(val),
                            "-keyout" => keyout_file = Some(val),
                            "-newkey" => newkey_spec = Some(val),
                            "-days" => days = val.parse::<usize>().unwrap_or(30),
                            "-subj" => subj_opt = Some(val),
                            "-addext" => addexts.push(val),
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            "-outform" => outform = val,
                            "-checkend" => checkend_opt = Some(val.parse::<usize>().unwrap_or(0)),
                            _ => {}
                        }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected certificate argument".to_string()),
                }
                i += 1;
            }
            let generating = is_new || (sub == "req" && (is_x509 || newkey_spec.is_some()));
            let (subj_display, raw_cert_bytes) = if generating {
                let raw_subj = subj_opt.as_deref().ok_or_else(|| "-subj is required for noninteractive requests".to_string())?;
                let formatted_subj = openssl_format_subject(raw_subj)?;
                if let Some(ref ko) = keyout_file {
                    let nk = newkey_spec.as_deref().unwrap_or("rsa:2048");
                    let seed = sha256_bytes(format!("sb-key-{nk}-{formatted_subj}").as_bytes());
                    let hx = openssl_hex_encode(&seed);
                    let payload = format!("SBKEY:RSA:PRIVATE:2048:{hx}");
                    let b64 = openssl_b64_encode(payload.as_bytes(), true);
                    let pem_key = format!("-----BEGIN PRIVATE KEY-----\n{b64}\n-----END PRIVATE KEY-----\n");
                    let _ = openssl_write_bytes(pem_key.as_bytes(), Some(ko), cwd, fs)?;
                } else if let Some(ref kf) = key_file {
                    let _ = openssl_read_bytes(Some(kf), &mut stdin_buf, cwd, fs)?;
                }
                let exts_joined = addexts.join(";");
                let payload = format!("SBCERT:{formatted_subj}:{days}:{exts_joined}");
                (formatted_subj, payload.into_bytes())
            } else {
                let raw = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
                let txt = String::from_utf8_lossy(&raw);
                let trimmed = txt.trim();
                let decoded = if trimmed.starts_with("-----BEGIN ") {
                    let lines: Vec<&str> = trimmed.lines().collect();
                    let body = if lines.len() >= 2 { lines[1..lines.len() - 1].join("") } else { String::new() };
                    base64_decode(&body).unwrap_or_default()
                } else {
                    raw
                };
                let dec_str = String::from_utf8_lossy(&decoded);
                let subj = if let Some(rest_c) = dec_str.strip_prefix("SBCERT:") {
                    rest_c.split(':').next().unwrap_or("").to_string()
                } else {
                    "CN=localhost".to_string()
                };
                (subj, decoded)
            };
            let mut stderr_msg = String::new();
            if verify_flag && sub == "req" && !is_x509 {
                stderr_msg = "Certificate request self-signature verify OK\n".to_string();
            }
            let mut lines = Vec::new();
            if text_flag {
                lines.push(format!("Certificate:\n    Subject: {subj_display}"));
            }
            if subject_flag {
                lines.push(format!("subject={subj_display}"));
            }
            let mut exit_code = 0i32;
            if is_x509 {
                if issuer_flag {
                    lines.push(format!("issuer={subj_display}"));
                }
                if dates_flag || startdate_flag {
                    lines.push("notBefore=Jan  1 00:00:00 2026 GMT".to_string());
                }
                if dates_flag || enddate_flag {
                    lines.push("notAfter=Jan  1 00:00:00 2027 GMT".to_string());
                }
                if serial_flag {
                    lines.push("serial=01".to_string());
                }
                if fingerprint_flag {
                    let d = openssl_hash(fp_hash, &raw_cert_bytes);
                    let colons: Vec<String> = d.iter().map(|b| format!("{b:02X}")).collect();
                    let label = if explicit_hash { fp_hash.to_lowercase() } else { "SHA1".to_string() };
                    let joined = colons.join(":");
                    lines.push(format!("{label} Fingerprint={joined}"));
                }
                if let Some(secs) = checkend_opt {
                    if secs > 365 * 86400 {
                        exit_code = 1;
                        lines.push("Certificate will expire".to_string());
                    } else {
                        lines.push("Certificate will not expire".to_string());
                    }
                }
            }
            let mut output = if lines.is_empty() {
                String::new()
            } else {
                let joined = lines.join("\n");
                format!("{joined}\n")
            };
            if !noout && checkend_opt.is_none() {
                if outform == "DER" {
                    return openssl_write_bytes(&raw_cert_bytes, out_file.as_deref(), cwd, fs);
                }
                let label = if is_x509 { "CERTIFICATE" } else { "CERTIFICATE REQUEST" };
                let b64 = openssl_b64_encode(&raw_cert_bytes, true);
                output.push_str(&format!("-----BEGIN {label}-----\n{b64}\n-----END {label}-----\n\n"));
            }
            let mut out_res = openssl_write_bytes(output.as_bytes(), out_file.as_deref(), cwd, fs)?;
            out_res.stderr = stderr_msg;
            out_res.exit_code = exit_code;
            return Ok(out_res);
        }
        Err(format!("Invalid command '{sub}'; type \"openssl help\" for a list."))
    };
    match run() {
        Ok(res) => res,
        Err(msg) => err_out(&format!("openssl: {msg}\n"), 1),
    }
}

fn pgp_crc24(data: &[u8]) -> String {
    let mut crc = 0xb704ceu32;
    for &b in data {
        crc ^= (b as u32) << 16;
        for _ in 0..8 {
            crc <<= 1;
            if (crc & 0x1000000) != 0 {
                crc ^= 0x1864cfb;
            }
        }
    }
    let bytes = [((crc >> 16) & 0xff) as u8, ((crc >> 8) & 0xff) as u8, (crc & 0xff) as u8];
    format!("={}", base64_encode(&bytes))
}

fn cmd_gpg(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut version = false;
    let mut detach_sign = false;
    let mut verify = false;
    let mut list_keys = false;
    let mut quick_gen_key = false;
    let mut export_keys = false;
    let mut import_keys = false;
    let mut symmetric = false;
    let mut decrypt = false;
    let mut armor = false;
    let mut passphrase: Option<String> = None;
    let mut passphrase_file: Option<String> = None;
    let mut passphrase_fd: Option<String> = None;
    let mut signer_uid = "Git User <user@example.com>".to_string();
    let mut status_fd: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut positionals = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--" {
            positionals.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "--version" {
            version = true;
        } else if matches!(a, "--detach-sign" | "-b" | "-bsau" | "-bsa") {
            detach_sign = true;
        } else if a == "--verify" {
            verify = true;
        } else if a == "-c" || a == "--symmetric" {
            symmetric = true;
        } else if a == "-d" || a == "--decrypt" {
            decrypt = true;
        } else if a == "-a" || a == "--armor" {
            armor = true;
        } else if matches!(a, "--list-keys" | "-k" | "--list-secret-keys" | "-K") {
            list_keys = true;
        } else if matches!(a, "--quick-generate-key" | "--quick-gen-key" | "--gen-key" | "--full-generate-key") {
            quick_gen_key = true;
        } else if a == "--export" {
            export_keys = true;
        } else if a == "--import" {
            import_keys = true;
        } else if (a == "-u" || a == "--local-user") && i + 1 < args.len() {
            i += 1;
            signer_uid = args[i].clone();
        } else if let Some(rest) = a.strip_prefix("-bsau") && !rest.is_empty() {
            detach_sign = true;
            signer_uid = rest.to_string();
        } else if a == "--status-fd" && i + 1 < args.len() {
            i += 1;
            status_fd = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--status-fd=") {
            status_fd = Some(rest.to_string());
        } else if a == "--passphrase" && i + 1 < args.len() {
            i += 1;
            passphrase = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--passphrase=") {
            passphrase = Some(rest.to_string());
        } else if a == "--passphrase-file" && i + 1 < args.len() {
            i += 1;
            passphrase_file = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--passphrase-file=") {
            passphrase_file = Some(rest.to_string());
        } else if a == "--passphrase-fd" && i + 1 < args.len() {
            i += 1;
            passphrase_fd = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--passphrase-fd=") {
            passphrase_fd = Some(rest.to_string());
        } else if matches!(a, "--pinentry-mode" | "--cipher-algo" | "--s2k-digest-algo" | "--s2k-cipher-algo" | "--s2k-mode" | "--s2k-count") && i + 1 < args.len() {
            i += 1;
        } else if a.starts_with("--pinentry-mode=")
            || a.starts_with("--cipher-algo=")
            || a.starts_with("--s2k-digest-algo=")
            || a.starts_with("--s2k-cipher-algo=")
            || a.starts_with("--s2k-mode=")
            || a.starts_with("--s2k-count=")
        {
        } else if (a == "-o" || a == "--output") && i + 1 < args.len() {
            i += 1;
            out_file = Some(args[i].clone());
        } else if matches!(a, "--batch" | "--yes" | "--no-tty" | "-q" | "--quiet" | "-s" | "--sign" | "--help" | "-h") {
        } else if a.starts_with('-') {
            return err_out(&format!("gpg: unknown option: {a}\n"), 2);
        } else {
            positionals.push(a.to_string());
        }
        i += 1;
    }

    if version {
        return ok_out("gpg (GnuPG) 2.4.5 (safe-bash)\nlibgcrypt 1.11.0\n");
    }

    let keyring_path = "/home/user/.gnupg/keyring.json";
    let load_keyring = || -> Vec<(String, String, String, String)> {
        let Ok(raw) = fs.read_file(keyring_path) else {
            return Vec::new();
        };
        let txt = String::from_utf8_lossy(&raw);
        let mut keys = Vec::new();
        for block in txt.split('{').skip(1) {
            let get_field = |name: &str| -> String {
                let pat = format!("\"{name}\":");
                if let Some(pos) = block.find(&pat) {
                    let after = &block[pos + pat.len()..];
                    if let Some(q1) = after.find('"') {
                        let rest_q = &after[q1 + 1..];
                        if let Some(q2) = rest_q.find('"') {
                            return rest_q[..q2].to_string();
                        }
                    }
                }
                String::new()
            };
            let uid = get_field("uid");
            let kid = get_field("keyIdHex");
            let seed_h = get_field("seedHex");
            let pub_h = get_field("pubHex");
            if !kid.is_empty() {
                keys.push((uid, kid, seed_h, pub_h));
            }
        }
        keys
    };
    let save_keyring = |keys: &[(String, String, String, String)]| {
        let _ = fs.mkdir_all("/home/user/.gnupg");
        let mut json = String::from("[\n");
        for (idx, (uid, kid, seed_h, pub_h)) in keys.iter().enumerate() {
            let comma = if idx + 1 < keys.len() { "," } else { "" };
            json.push_str(&format!(
                "  {{\n    \"uid\": \"{uid}\",\n    \"keyIdHex\": \"{kid}\",\n    \"seedHex\": \"{seed_h}\",\n    \"pubHex\": \"{pub_h}\"\n  }}{comma}\n"
            ));
        }
        json.push(']');
        let _ = fs.write_file(keyring_path, json.as_bytes());
    };
    let ensure_key = |uid: &str| -> (String, String, String, String) {
        let mut keys = load_keyring();
        if let Some(found) = keys.iter().find(|(u, kid, _, _)| u.contains(uid) || kid.ends_with(&uid.to_uppercase())) {
            return found.clone();
        }
        let seed = sha256_bytes(format!("gpg-key-seed:{uid}").as_bytes());
        let pub_b = sha256_bytes(&seed);
        let fp = sha256_bytes(&pub_b);
        let kid = openssl_hex_encode(&fp[24..32]).to_uppercase();
        let entry = (uid.to_string(), kid, openssl_hex_encode(&seed), openssl_hex_encode(&pub_b));
        keys.push(entry.clone());
        save_keyring(&keys);
        entry
    };

    let resolve_passphrase = || -> Result<String, String> {
        if let Some(ref pf) = passphrase_file {
            let raw = fs.read_file(&resolve_posix_path(cwd, pf)).map_err(|e| format!("{e}"))?;
            let s = String::from_utf8_lossy(&raw);
            return Ok(s.lines().next().unwrap_or("").trim_end_matches('\r').to_string());
        }
        if let Some(ref p) = passphrase {
            return Ok(p.clone());
        }
        if passphrase_fd.as_deref() == Some("0") && !positionals.is_empty() {
            return Ok(stdin.lines().next().unwrap_or("").trim_end_matches('\r').to_string());
        }
        Ok(String::new())
    };

    if symmetric {
        let secret = match resolve_passphrase() {
            Ok(s) => s,
            Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
        };
        let payload = if let Some(p0) = positionals.first() && p0 != "-" {
            match fs.read_file(&resolve_posix_path(cwd, p0)) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let salt = b"0123456789abcdef";
        let iv = b"1234567890123456";
        let key = pbkdf2_hmac_sha256(secret.as_bytes(), salt, 10000, 32);
        let (rk, nr) = aes_expand_key(&key);
        let mut ctr = [0u8; 16];
        ctr.copy_from_slice(iv);
        let mut cipher = Vec::with_capacity(payload.len());
        for chunk in payload.chunks(16) {
            let ks = aes_encrypt_block(&ctr, &rk, nr);
            for (&b, &k) in chunk.iter().zip(ks.iter()) {
                cipher.push(b ^ k);
            }
            for idx in (0..16).rev() {
                ctr[idx] = ctr[idx].wrapping_add(1);
                if ctr[idx] != 0 { break; }
            }
        }
        let tag = openssl_hmac("sha256", &key, &cipher);
        let mut env_bytes = Vec::new();
        env_bytes.extend_from_slice(b"PGPSYM1\0");
        env_bytes.extend_from_slice(salt);
        env_bytes.extend_from_slice(&iv[..12]);
        env_bytes.extend_from_slice(&cipher);
        env_bytes.extend_from_slice(&tag[..16]);
        let out_bytes = if armor {
            let b64 = openssl_b64_encode(&env_bytes, true);
            format!("-----BEGIN PGP MESSAGE-----\n\n{b64}\n-----END PGP MESSAGE-----\n").into_bytes()
        } else {
            env_bytes
        };
        let target_out = out_file.or_else(|| {
            if let Some(p0) = positionals.first() && p0 != "-" {
                Some(format!("{p0}{}", if armor { ".asc" } else { ".gpg" }))
            } else {
                None
            }
        });
        if let Some(to) = target_out && to != "-" {
            let _ = fs.write_file(&resolve_posix_path(cwd, &to), &out_bytes);
            return ok_out("");
        }
        return ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes));
    }

    if decrypt {
        let secret = match resolve_passphrase() {
            Ok(s) => s,
            Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
        };
        let raw_in = if let Some(p0) = positionals.first() && p0 != "-" {
            match fs.read_file(&resolve_posix_path(cwd, p0)) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let head_str = String::from_utf8_lossy(&raw_in[..raw_in.len().min(64)]);
        let env_bytes = if head_str.contains("-----BEGIN PGP MESSAGE-----") {
            let full_str = String::from_utf8_lossy(&raw_in);
            let b64: String = full_str
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && !l.starts_with("-----") && !l.starts_with('='))
                .collect();
            base64_decode(&b64).unwrap_or_default()
        } else {
            raw_in
        };
        if env_bytes.len() < 8 + 16 + 12 + 16 || &env_bytes[..8] != b"PGPSYM1\0" {
            return err_out("gpg: decryption failed: Bad session key\n", 2);
        }
        let salt = &env_bytes[8..24];
        let cipher_and_tag = &env_bytes[36..];
        let cipher_len = cipher_and_tag.len() - 16;
        let cipher = &cipher_and_tag[..cipher_len];
        let tag = &cipher_and_tag[cipher_len..];
        let key = pbkdf2_hmac_sha256(secret.as_bytes(), salt, 10000, 32);
        let expected_tag = openssl_hmac("sha256", &key, cipher);
        if tag != &expected_tag[..16] {
            return err_out("gpg: decryption failed: Bad session key\n", 2);
        }
        let (rk, nr) = aes_expand_key(&key);
        let mut ctr = *b"1234567890123456";
        let mut plain = Vec::with_capacity(cipher.len());
        for chunk in cipher.chunks(16) {
            let ks = aes_encrypt_block(&ctr, &rk, nr);
            for (&b, &k) in chunk.iter().zip(ks.iter()) {
                plain.push(b ^ k);
            }
            for idx in (0..16).rev() {
                ctr[idx] = ctr[idx].wrapping_add(1);
                if ctr[idx] != 0 { break; }
            }
        }
        if let Some(ref to) = out_file && to != "-" {
            let _ = fs.write_file(&resolve_posix_path(cwd, to), &plain);
            return ok_out("");
        }
        return ok_out(&crate::vfs::bytes_to_stream_string(&plain));
    }

    if quick_gen_key {
        let uid = positionals.first().map(|s| s.as_str()).unwrap_or(&signer_uid);
        let (u, kid, _, _) = ensure_key(uid);
        return ok_out(&format!("pub   ed25519/{kid} 2026-09-28 [SC]\nuid                 [ultimate] {u}\n"));
    }

    if list_keys {
        let keys = load_keyring();
        let mut out = String::new();
        for (u, kid, _, _) in keys {
            out.push_str(&format!("sec   ed25519/{kid} 2026-09-28 [SC]\nuid                 [ultimate] {u}\n"));
        }
        return ok_out(&out);
    }

    if export_keys {
        let raw = fs.read_file(keyring_path).unwrap_or_else(|_| b"[]".to_vec());
        let b64 = openssl_b64_encode(&raw, true);
        let arm = format!("-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n{b64}\n-----END PGP PUBLIC KEY BLOCK-----\n");
        if let Some(ref to) = out_file {
            let _ = fs.write_file(&resolve_posix_path(cwd, to), arm.as_bytes());
            return ok_out("");
        }
        return ok_out(&arm);
    }

    if import_keys {
        let input = if let Some(p0) = positionals.first() {
            fs.read_file(&resolve_posix_path(cwd, p0)).unwrap_or_default()
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let txt = String::from_utf8_lossy(&input);
        let b64: String = txt.lines().filter(|l| !l.starts_with("-----") && !l.trim().is_empty()).collect();
        let decoded = base64_decode(&b64).unwrap_or_default();
        let _ = fs.mkdir_all("/home/user/.gnupg");
        let _ = fs.write_file(keyring_path, &decoded);
        let keys = load_keyring();
        let cnt = keys.len();
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("gpg: Total number processed: {cnt}\ngpg:               imported: {cnt}\n"),
            exit_code: 0,
        };
    }

    if detach_sign {
        let payload = if let Some(p0) = positionals.first() {
            match fs.read_file(&resolve_posix_path(cwd, p0)) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let (u, kid, seed_h, pub_h) = ensure_key(&signer_uid);
        let sig = openssl_hmac("sha256", seed_h.as_bytes(), &payload);
        let sig_h = openssl_hex_encode(&sig);
        let pkt_str = format!("SBPGPSIG:{kid}:{u}:{pub_h}:{sig_h}");
        let pkt_bytes = pkt_str.as_bytes();
        let b64 = openssl_b64_encode(pkt_bytes, true);
        let crc = pgp_crc24(pkt_bytes);
        let arm = format!("-----BEGIN PGP SIGNATURE-----\n\n{b64}\n{crc}\n-----END PGP SIGNATURE-----\n");
        let stderr_msg = if status_fd.is_some() {
            format!("[GNUPG:] SIG_CREATED D 22 8 00 1609459200 {kid}\n")
        } else {
            String::new()
        };
        if let Some(ref to) = out_file {
            let _ = fs.write_file(&resolve_posix_path(cwd, to), arm.as_bytes());
            return BuiltinOutcome { stdout: String::new(), stderr: stderr_msg, exit_code: 0 };
        }
        return BuiltinOutcome { stdout: arm, stderr: stderr_msg, exit_code: 0 };
    }

    if verify {
        let Some(sig_path) = positionals.first() else {
            return err_out("gpg: missing signature file for --verify\n", 2);
        };
        let Ok(sig_raw) = fs.read_file(&resolve_posix_path(cwd, sig_path)) else {
            return err_out(&format!("gpg: can't open '{sig_path}'\n"), 2);
        };
        let data_bytes = if let Some(p1) = positionals.get(1) {
            fs.read_file(&resolve_posix_path(cwd, p1)).unwrap_or_default()
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let sig_txt = String::from_utf8_lossy(&sig_raw);
        let b64: String = sig_txt
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("-----") && !l.starts_with('=') && !l.contains(':'))
            .collect();
        let pkt = base64_decode(&b64).unwrap_or_default();
        let pkt_str = String::from_utf8_lossy(&pkt);
        let keys = load_keyring();
        if let Some(rest_p) = pkt_str.strip_prefix("SBPGPSIG:") {
            let parts: Vec<&str> = rest_p.splitn(4, ':').collect();
            if parts.len() == 4 {
                let (kid, uid, _pub_h, sig_h) = (parts[0], parts[1], parts[2], parts[3]);
                if let Some((trusted_uid, _, seed_h, _)) = keys.iter().find(|(_, k, _, _)| k == kid) {
                    let expected = openssl_hex_encode(&openssl_hmac("sha256", seed_h.as_bytes(), &data_bytes));
                    if expected == sig_h {
                        let stdout_msg = if status_fd.is_some() {
                            format!("[GNUPG:] GOODSIG {kid} {trusted_uid}\n[GNUPG:] VALIDSIG {kid} 2026-09-28 1609459200\n")
                        } else {
                            String::new()
                        };
                        return BuiltinOutcome {
                            stdout: stdout_msg,
                            stderr: format!("gpg: Signature made using EDDSA key {kid}\ngpg: Good signature from \"{trusted_uid}\" [ultimate]\n"),
                            exit_code: 0,
                        };
                    }
                }
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("gpg: BAD signature from \"{uid}\"\n"),
                    exit_code: 1,
                };
            }
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "gpg: BAD signature from \"unknown\"\n".to_string(),
            exit_code: 1,
        };
    }

    ok_out("gpg (GnuPG) 2.4.5 (safe-bash)\n")
}

const ED25519_P: [u64; 4] = [0xffffffffffffffedu64, 0xffffffffffffffffu64, 0xffffffffffffffffu64, 0x7fffffffffffffffu64];
const ED25519_P_MINUS_2: [u64; 4] = [0xffffffffffffffebu64, 0xffffffffffffffffu64, 0xffffffffffffffffu64, 0x7fffffffffffffffu64];
const ED25519_P_MINUS_5_DIV_8: [u64; 4] = [0xfffffffffffffffdu64, 0xffffffffffffffffu64, 0xffffffffffffffffu64, 0x0fffffffffffffffu64];
const ED25519_L: [u64; 4] = [0x5812631a5cf5d3edu64, 0x14def9dea2f79cd6u64, 0x0000000000000000u64, 0x1000000000000000u64];
const ED25519_D: [u64; 4] = [0x75eb4dca135978a3u64, 0x00700a4d4141d8abu64, 0x8cc740797779e898u64, 0x52036cee2b6ffe73u64];
const ED25519_I: [u64; 4] = [0xc4ee1b274a0ea0b0u64, 0x2f431806ad2fe478u64, 0x2b4d00993dfbd7a7u64, 0x2b8324804fc1df0bu64];
const ED25519_BX: [u64; 4] = [0xc9562d608f25d51au64, 0x692cc7609525a7b2u64, 0xc0a4e231fdd6dc5cu64, 0x216936d3cd6e53feu64];
const ED25519_BY: [u64; 4] = [0x6666666666666658u64, 0x6666666666666666u64, 0x6666666666666666u64, 0x6666666666666666u64];
const ED25519_BT: [u64; 4] = [0x6dde8ab3a5b7dda3u64, 0x20f09f80775152f5u64, 0x66ea4e8e64abe37du64, 0x67875f0fd78b7665u64];

fn u256_ge(a: [u64; 4], b: [u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}

fn u256_add_raw(a: [u64; 4], b: [u64; 4]) -> [u64; 4] {
    let mut out = [0u64; 4];
    let mut carry = 0u128;
    for i in 0..4 {
        let s = (a[i] as u128) + (b[i] as u128) + carry;
        out[i] = s as u64;
        carry = s >> 64;
    }
    out
}

fn u256_sub_raw(a: [u64; 4], b: [u64; 4]) -> [u64; 4] {
    let mut out = [0u64; 4];
    let mut borrow = 0i128;
    for i in 0..4 {
        let d = (a[i] as i128) - (b[i] as i128) - borrow;
        if d < 0 {
            out[i] = (d + (1i128 << 64)) as u64;
            borrow = 1;
        } else {
            out[i] = d as u64;
            borrow = 0;
        }
    }
    out
}

fn u256_add_mod(a: [u64; 4], b: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    let s = u256_add_raw(a, b);
    if u256_ge(s, m) { u256_sub_raw(s, m) } else { s }
}

fn u256_sub_mod(a: [u64; 4], b: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    if u256_ge(a, b) {
        u256_sub_raw(a, b)
    } else {
        u256_sub_raw(u256_add_raw(a, m), b)
    }
}

fn u256_bit_len(a: [u64; 4]) -> usize {
    for i in (0..4).rev() {
        if a[i] != 0 {
            return i * 64 + (64 - a[i].leading_zeros() as usize);
        }
    }
    0
}

fn u256_mul_mod(mut a: [u64; 4], b: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    if m == ED25519_P {
        let mut c = [0u64; 8];
        for i in 0..4 {
            let mut carry = 0u128;
            for j in 0..4 {
                let prod = (a[i] as u128) * (b[j] as u128) + (c[i + j] as u128) + carry;
                c[i + j] = prod as u64;
                carry = prod >> 64;
            }
            c[i + 4] = carry as u64;
        }
        let l0 = [c[0], c[1], c[2], c[3] & 0x7fffffffffffffff];
        let h0 = [
            (c[3] >> 63) | (c[4] << 1),
            (c[4] >> 63) | (c[5] << 1),
            (c[5] >> 63) | (c[6] << 1),
            (c[6] >> 63) | (c[7] << 1),
        ];
        let mut d = [0u64; 5];
        let mut carry = 0u128;
        for i in 0..4 {
            let v = (l0[i] as u128) + 19u128 * (h0[i] as u128) + carry;
            d[i] = v as u64;
            carry = v >> 64;
        }
        d[4] = carry as u64;
        let l1 = [d[0], d[1], d[2], d[3] & 0x7fffffffffffffff];
        let h1 = ((d[3] >> 63) | (d[4] << 1)) as u128;
        let mut res = [0u64; 4];
        let mut c2 = 19u128 * h1;
        for i in 0..4 {
            let v = (l1[i] as u128) + c2;
            res[i] = v as u64;
            c2 = v >> 64;
        }
        if u256_ge(res, ED25519_P) {
            res = u256_sub_raw(res, ED25519_P);
        }
        return res;
    }
    let mut res = [0u64; 4];
    let bits = u256_bit_len(b);
    for i in 0..bits {
        if ((b[i / 64] >> (i % 64)) & 1) == 1 {
            res = u256_add_mod(res, a, m);
        }
        a = u256_add_mod(a, a, m);
    }
    res
}

fn u256_pow_mod(mut base: [u64; 4], exp: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    let mut res = [1u64, 0, 0, 0];
    let bits = u256_bit_len(exp);
    for i in 0..bits {
        if ((exp[i / 64] >> (i % 64)) & 1) == 1 {
            res = u256_mul_mod(res, base, m);
        }
        base = u256_mul_mod(base, base, m);
    }
    res
}

fn ed_bytes_le_mod(bytes: &[u8], m: [u64; 4]) -> [u64; 4] {
    let mut rem = [0u64; 4];
    for i in (0..(bytes.len() * 8)).rev() {
        rem = u256_add_mod(rem, rem, m);
        if ((bytes[i / 8] >> (i % 8)) & 1) == 1 {
            rem = u256_add_mod(rem, [1, 0, 0, 0], m);
        }
    }
    rem
}

fn ed_num_to_32le(v: [u64; 4]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[i * 8..(i + 1) * 8].copy_from_slice(&v[i].to_le_bytes());
    }
    out
}

type EdPt = ([u64; 4], [u64; 4], [u64; 4], [u64; 4]);

fn ed_pt_add(p: EdPt, q: EdPt) -> EdPt {
    let (x1, y1, z1, t1) = p;
    let (x2, y2, z2, t2) = q;
    let a = u256_mul_mod(u256_sub_mod(y1, x1, ED25519_P), u256_sub_mod(y2, x2, ED25519_P), ED25519_P);
    let b = u256_mul_mod(u256_add_mod(y1, x1, ED25519_P), u256_add_mod(y2, x2, ED25519_P), ED25519_P);
    let two_d = u256_add_mod(ED25519_D, ED25519_D, ED25519_P);
    let c = u256_mul_mod(u256_mul_mod(t1, two_d, ED25519_P), t2, ED25519_P);
    let z1_2 = u256_add_mod(z1, z1, ED25519_P);
    let d = u256_mul_mod(z1_2, z2, ED25519_P);
    let e = u256_sub_mod(b, a, ED25519_P);
    let f = u256_sub_mod(d, c, ED25519_P);
    let g = u256_add_mod(d, c, ED25519_P);
    let h = u256_add_mod(b, a, ED25519_P);
    (
        u256_mul_mod(e, f, ED25519_P),
        u256_mul_mod(g, h, ED25519_P),
        u256_mul_mod(f, g, ED25519_P),
        u256_mul_mod(e, h, ED25519_P),
    )
}

fn ed_pt_mul(mut t: EdPt, n: [u64; 4]) -> EdPt {
    let mut r: EdPt = ([0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]);
    let bits = u256_bit_len(n);
    for i in 0..bits {
        if ((n[i / 64] >> (i % 64)) & 1) == 1 {
            r = ed_pt_add(r, t);
        }
        t = ed_pt_add(t, t);
    }
    r
}

fn ed_encode_pt(p: EdPt) -> [u8; 32] {
    let z_inv = u256_pow_mod(p.2, ED25519_P_MINUS_2, ED25519_P);
    let x = u256_mul_mod(p.0, z_inv, ED25519_P);
    let y = u256_mul_mod(p.1, z_inv, ED25519_P);
    let mut out = ed_num_to_32le(y);
    out[31] |= ((x[0] & 1) as u8) << 7;
    out
}

fn ed_decode_pt(b: &[u8]) -> Option<EdPt> {
    if b.len() != 32 {
        return None;
    }
    let mut y_bytes = [0u8; 32];
    y_bytes.copy_from_slice(b);
    let sign = (y_bytes[31] >> 7) & 1;
    y_bytes[31] &= 0x7f;
    let mut y = [0u64; 4];
    for i in 0..4 {
        y[i] = u64::from_le_bytes(y_bytes[i * 8..(i + 1) * 8].try_into().unwrap());
    }
    if u256_ge(y, ED25519_P) {
        return None;
    }
    let y2 = u256_mul_mod(y, y, ED25519_P);
    let u = u256_sub_mod(y2, [1, 0, 0, 0], ED25519_P);
    let v = u256_add_mod(u256_mul_mod(ED25519_D, y2, ED25519_P), [1, 0, 0, 0], ED25519_P);
    let v3 = u256_mul_mod(u256_mul_mod(v, v, ED25519_P), v, ED25519_P);
    let v7 = u256_mul_mod(u256_mul_mod(v3, v3, ED25519_P), v, ED25519_P);
    let uv7 = u256_mul_mod(u, v7, ED25519_P);
    let mut x = u256_mul_mod(
        u256_mul_mod(u, v3, ED25519_P),
        u256_pow_mod(uv7, ED25519_P_MINUS_5_DIV_8, ED25519_P),
        ED25519_P,
    );
    let vx2 = u256_mul_mod(v, u256_mul_mod(x, x, ED25519_P), ED25519_P);
    let neg_u = u256_sub_mod([0, 0, 0, 0], u, ED25519_P);
    if vx2 == neg_u {
        x = u256_mul_mod(x, ED25519_I, ED25519_P);
    }
    let vx2_check = u256_mul_mod(v, u256_mul_mod(x, x, ED25519_P), ED25519_P);
    if vx2_check != u {
        return None;
    }
    if x == [0, 0, 0, 0] && sign == 1 {
        return None;
    }
    if ((x[0] & 1) as u8) != sign {
        x = u256_sub_mod(ED25519_P, x, ED25519_P);
    }
    Some((x, y, [1, 0, 0, 0], u256_mul_mod(x, y, ED25519_P)))
}

fn ed25519_pubkey_from_seed(seed: &[u8; 32]) -> [u8; 32] {
    let h = sha512_bytes(seed);
    let mut s_bytes = [0u8; 32];
    s_bytes.copy_from_slice(&h[0..32]);
    s_bytes[0] &= 248;
    s_bytes[31] &= 127;
    s_bytes[31] |= 64;
    let a = ed_bytes_le_mod(&s_bytes, ED25519_P);
    let b_pt: EdPt = (ED25519_BX, ED25519_BY, [1, 0, 0, 0], ED25519_BT);
    ed_encode_pt(ed_pt_mul(b_pt, a))
}

fn ed25519_sign(msg: &[u8], seed: &[u8; 32]) -> [u8; 64] {
    let h = sha512_bytes(seed);
    let mut s_bytes = [0u8; 32];
    s_bytes.copy_from_slice(&h[0..32]);
    s_bytes[0] &= 248;
    s_bytes[31] &= 127;
    s_bytes[31] |= 64;
    let a_p = ed_bytes_le_mod(&s_bytes, ED25519_P);
    let a_l = ed_bytes_le_mod(&s_bytes, ED25519_L);
    let b_pt: EdPt = (ED25519_BX, ED25519_BY, [1, 0, 0, 0], ED25519_BT);
    let pub_a = ed_encode_pt(ed_pt_mul(b_pt, a_p));
    let mut r_input = Vec::with_capacity(32 + msg.len());
    r_input.extend_from_slice(&h[32..64]);
    r_input.extend_from_slice(msg);
    let r_hash = sha512_bytes(&r_input);
    let r_l = ed_bytes_le_mod(&r_hash, ED25519_L);
    let r_pt = ed_encode_pt(ed_pt_mul(b_pt, r_l));
    let mut k_input = Vec::with_capacity(64 + msg.len());
    k_input.extend_from_slice(&r_pt);
    k_input.extend_from_slice(&pub_a);
    k_input.extend_from_slice(msg);
    let k_hash = sha512_bytes(&k_input);
    let k_l = ed_bytes_le_mod(&k_hash, ED25519_L);
    let s_l = u256_add_mod(r_l, u256_mul_mod(k_l, a_l, ED25519_L), ED25519_L);
    let s_out = ed_num_to_32le(s_l);
    let mut sig = [0u8; 64];
    sig[0..32].copy_from_slice(&r_pt);
    sig[32..64].copy_from_slice(&s_out);
    sig
}

fn ed25519_verify(sig: &[u8], msg: &[u8], pub_key: &[u8]) -> bool {
    if sig.len() != 64 || pub_key.len() != 32 {
        return false;
    }
    let Some(r_pt) = ed_decode_pt(&sig[0..32]) else {
        return false;
    };
    let Some(a_pt) = ed_decode_pt(pub_key) else {
        return false;
    };
    let mut s_limbs = [0u64; 4];
    for i in 0..4 {
        s_limbs[i] = u64::from_le_bytes(sig[32 + i * 8..32 + (i + 1) * 8].try_into().unwrap());
    }
    if u256_ge(s_limbs, ED25519_L) {
        return false;
    }
    let mut k_input = Vec::with_capacity(64 + msg.len());
    k_input.extend_from_slice(&sig[0..32]);
    k_input.extend_from_slice(pub_key);
    k_input.extend_from_slice(msg);
    let k_hash = sha512_bytes(&k_input);
    let k_l = ed_bytes_le_mod(&k_hash, ED25519_L);
    let b_pt: EdPt = (ED25519_BX, ED25519_BY, [1, 0, 0, 0], ED25519_BT);
    let lhs = ed_encode_pt(ed_pt_mul(b_pt, s_limbs));
    let rhs = ed_encode_pt(ed_pt_add(r_pt, ed_pt_mul(a_pt, k_l)));
    lhs == rhs
}

fn ssh_write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn ssh_write_str(buf: &mut Vec<u8>, data: &[u8]) {
    ssh_write_u32(buf, data.len() as u32);
    buf.extend_from_slice(data);
}

fn ssh_read_u32(data: &[u8], pos: &mut usize) -> Option<u32> {
    if *pos + 4 > data.len() {
        return None;
    }
    let v = u32::from_be_bytes(data[*pos..*pos + 4].try_into().unwrap());
    *pos += 4;
    Some(v)
}

fn ssh_read_str(data: &[u8], pos: &mut usize) -> Option<Vec<u8>> {
    let len = ssh_read_u32(data, pos)? as usize;
    if *pos + len > data.len() {
        return None;
    }
    let out = data[*pos..*pos + len].to_vec();
    *pos += len;
    Some(out)
}

fn ssh_ed25519_pubkey_blob(pub_key: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    ssh_write_str(&mut out, b"ssh-ed25519");
    ssh_write_str(&mut out, pub_key);
    out
}

fn ssh_b64_wrap(bytes: &[u8], width: usize) -> String {
    let raw = base64_encode(bytes);
    let s = raw.trim_end_matches('\n');
    if width == 0 {
        return s.to_string();
    }
    let mut lines = Vec::new();
    let mut i = 0usize;
    while i < s.len() {
        let end = (i + width).min(s.len());
        lines.push(&s[i..end]);
        i = end;
    }
    lines.join("\n")
}

fn ssh_fingerprint_sha256(pub_key: &[u8]) -> String {
    let blob = ssh_ed25519_pubkey_blob(pub_key);
    let digest = sha256_bytes(&blob);
    let b64 = ssh_b64_wrap(&digest, 0);
    format!("SHA256:{}", b64.trim_end_matches('='))
}

fn format_openssh_ed25519_privkey(seed: &[u8; 32], pub_key: &[u8; 32], comment: &str) -> String {
    let pub_blob = ssh_ed25519_pubkey_blob(pub_key);
    let mut out = Vec::new();
    out.extend_from_slice(b"openssh-key-v1\0");
    ssh_write_str(&mut out, b"none");
    ssh_write_str(&mut out, b"none");
    ssh_write_str(&mut out, &[]);
    ssh_write_u32(&mut out, 1);
    ssh_write_str(&mut out, &pub_blob);

    let mut priv_sec = Vec::new();
    let check = 0xa1b2c3d4u32;
    ssh_write_u32(&mut priv_sec, check);
    ssh_write_u32(&mut priv_sec, check);
    ssh_write_str(&mut priv_sec, b"ssh-ed25519");
    ssh_write_str(&mut priv_sec, pub_key);
    let mut kp = [0u8; 64];
    kp[0..32].copy_from_slice(seed);
    kp[32..64].copy_from_slice(pub_key);
    ssh_write_str(&mut priv_sec, &kp);
    ssh_write_str(&mut priv_sec, comment.as_bytes());
    let mut pad = 1u8;
    while priv_sec.len() % 8 != 0 {
        priv_sec.push(pad);
        pad = pad.wrapping_add(1);
    }
    ssh_write_str(&mut out, &priv_sec);
    format!(
        "-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n",
        ssh_b64_wrap(&out, 70)
    )
}

fn parse_openssh_ed25519_privkey(pem: &str) -> Option<([u8; 32], [u8; 32], String)> {
    let b64: String = pem
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with("-----"))
        .collect();
    let raw = base64_decode(&b64).ok()?;
    let magic = b"openssh-key-v1\0";
    if raw.len() < magic.len() || &raw[..magic.len()] != magic {
        return None;
    }
    let mut pos = magic.len();
    ssh_read_str(&raw, &mut pos)?;
    ssh_read_str(&raw, &mut pos)?;
    ssh_read_str(&raw, &mut pos)?;
    ssh_read_u32(&raw, &mut pos)?;
    ssh_read_str(&raw, &mut pos)?;
    let priv_blob = ssh_read_str(&raw, &mut pos)?;
    if priv_blob.len() < 8 {
        return None;
    }
    let mut ppos = 8usize;
    let ktype = ssh_read_str(&priv_blob, &mut ppos)?;
    if ktype != b"ssh-ed25519" {
        return None;
    }
    let pub_vec = ssh_read_str(&priv_blob, &mut ppos)?;
    let kp_vec = ssh_read_str(&priv_blob, &mut ppos)?;
    let comment_vec = ssh_read_str(&priv_blob, &mut ppos)?;
    if pub_vec.len() < 32 || kp_vec.len() < 64 {
        return None;
    }
    let mut seed = [0u8; 32];
    let mut pub_key = [0u8; 32];
    seed.copy_from_slice(&kp_vec[0..32]);
    pub_key.copy_from_slice(&pub_vec[0..32]);
    Some((seed, pub_key, String::from_utf8_lossy(&comment_vec).to_string()))
}

fn parse_openssh_ed25519_pubkey(line: &str) -> Option<([u8; 32], String)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    let idx = parts.iter().position(|p| *p == "ssh-ed25519").unwrap_or(0);
    let b64 = *parts.get(idx + 1)?;
    let blob = base64_decode(b64).ok()?;
    let mut pos = 0usize;
    let ktype = ssh_read_str(&blob, &mut pos)?;
    if ktype != b"ssh-ed25519" {
        return None;
    }
    let pk = ssh_read_str(&blob, &mut pos)?;
    if pk.len() != 32 {
        return None;
    }
    let mut pub_key = [0u8; 32];
    pub_key.copy_from_slice(&pk);
    let comment = if idx + 2 < parts.len() {
        parts[idx + 2..].join(" ")
    } else {
        String::new()
    };
    Some((pub_key, comment))
}

fn ssh_matches_glob(value: &str, pattern: &str) -> bool {
    let vb = value.as_bytes();
    let pb = pattern.as_bytes();
    let mut v = 0usize;
    let mut p = 0usize;
    let mut star: Option<usize> = None;
    let mut retry = 0usize;
    while v < vb.len() {
        if p < pb.len() && (pb[p] == b'?' || pb[p] == vb[v]) {
            v += 1;
            p += 1;
        } else if p < pb.len() && pb[p] == b'*' {
            star = Some(p);
            p += 1;
            retry = v;
        } else if let Some(s) = star {
            p = s + 1;
            retry += 1;
            v = retry;
        } else {
            return false;
        }
    }
    while p < pb.len() && pb[p] == b'*' {
        p += 1;
    }
    p == pb.len()
}

fn ssh_matches_patterns(value: &str, patterns: &str) -> bool {
    let mut matched = false;
    for pat in patterns.split(',') {
        let neg = pat.starts_with('!');
        let inner = if neg { &pat[1..] } else { pat };
        if ssh_matches_glob(value, inner) {
            if neg {
                return false;
            }
            matched = true;
        }
    }
    matched
}

fn parse_allowed_signer_line(line: &str) -> Option<(String, Option<String>, [u8; 32])> {
    let text = line.trim();
    if text.is_empty() || text.starts_with('#') {
        return None;
    }
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in text.chars() {
        if ch == '"' {
            quoted = !quoted;
        }
        if !quoted && (ch == ' ' || ch == '\t') {
            if !cur.is_empty() {
                fields.push(cur.clone());
                cur.clear();
            }
        } else {
            cur.push(ch);
        }
    }
    if quoted {
        return None;
    }
    if !cur.is_empty() {
        fields.push(cur);
    }
    let principals = fields.first()?.clone();
    let mut idx = 1usize;
    let mut namespaces = None;
    if fields.get(idx).map(|s| s.as_str()) != Some("ssh-ed25519") {
        let opt = fields.get(idx)?;
        idx += 1;
        if !opt.starts_with("namespaces=\"") || !opt.ends_with('"') {
            return None;
        }
        let ns = &opt[12..opt.len() - 1];
        if ns.is_empty() || ns.contains('"') {
            return None;
        }
        namespaces = Some(ns.to_string());
    }
    if fields.get(idx).map(|s| s.as_str()) != Some("ssh-ed25519") {
        return None;
    }
    let b64 = fields.get(idx + 1)?;
    let (pub_key, _) = parse_openssh_ed25519_pubkey(&format!("ssh-ed25519 {b64}"))?;
    Some((principals, namespaces, pub_key))
}

fn resolve_ssh_path(cwd: &str, target: &str) -> String {
    if let Some(rest) = target.strip_prefix("~/") {
        resolve_posix_path(cwd, &format!("/home/user/{rest}"))
    } else {
        resolve_posix_path(cwd, target)
    }
}

fn cmd_ssh(args: &[String]) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-V") {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "OpenSSH_9.8p1, OpenSSL 3.3.2 3 Sep 2024\n".to_string(),
            exit_code: 0,
        };
    }
    let mut dump_config = false;
    let mut port = 22i64;
    let mut user = "git".to_string();
    let mut identity_file = "/home/user/.ssh/id_ed25519".to_string();
    let mut destination = "localhost".to_string();
    let mut remote_cmd: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "-G" {
            dump_config = true;
        } else if a == "-p" && i + 1 < args.len() {
            i += 1;
            port = args[i].parse().unwrap_or(22);
        } else if a == "-l" && i + 1 < args.len() {
            i += 1;
            user = args[i].clone();
        } else if a == "-i" && i + 1 < args.len() {
            i += 1;
            identity_file = args[i].clone();
        } else if a == "-o" && i + 1 < args.len() {
            i += 1;
        } else if a == "-T" || a == "-v" {
        } else if !a.starts_with('-') {
            if destination == "localhost" {
                if let Some((u, h)) = a.split_once('@') {
                    if !u.is_empty() {
                        user = u.to_string();
                    }
                    if !h.is_empty() {
                        destination = h.to_string();
                    }
                } else {
                    destination = a.to_string();
                }
            } else {
                remote_cmd.push(a.to_string());
            }
        }
        i += 1;
    }
    if dump_config {
        return ok_out(&format!(
            "user {user}\nhostname {destination}\nport {port}\nidentityfile {identity_file}\n"
        ));
    }
    if remote_cmd.is_empty() {
        return err_out(
            &format!(
                "Hi {user}! You've successfully authenticated, but {destination} does not provide interactive shell access.\n"
            ),
            1,
        );
    }
    ok_out(&format!("ssh:{user}@{destination}:{port} {}\n", remote_cmd.join(" ")))
}

fn cmd_ssh_keygen(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut file_arg: Option<String> = None;
    let mut comment = "user@safe-bash".to_string();
    let mut derive_pub = false;
    let mut show_fp = false;
    let mut find_host: Option<String> = None;
    let mut remove_host: Option<String> = None;
    let mut y_action: Option<String> = None;
    let mut namespace = "file".to_string();
    let mut namespace_provided = false;
    let mut signer_identity: Option<String> = None;
    let mut signature_file: Option<String> = None;
    let mut positional: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-f" if i + 1 < args.len() => {
                i += 1;
                file_arg = Some(args[i].clone());
            }
            "-C" if i + 1 < args.len() => {
                i += 1;
                comment = args[i].clone();
            }
            "-N" | "-t" if i + 1 < args.len() => {
                i += 1;
            }
            "-y" => derive_pub = true,
            "-l" => show_fp = true,
            "-F" if i + 1 < args.len() => {
                i += 1;
                find_host = Some(args[i].clone());
            }
            "-R" if i + 1 < args.len() => {
                i += 1;
                remove_host = Some(args[i].clone());
            }
            "-Y" if i + 1 < args.len() => {
                i += 1;
                y_action = Some(args[i].clone());
            }
            "-n" if i + 1 < args.len() => {
                i += 1;
                namespace = args[i].clone();
                namespace_provided = true;
            }
            "-I" if i + 1 < args.len() => {
                i += 1;
                signer_identity = Some(args[i].clone());
            }
            "-s" if i + 1 < args.len() => {
                i += 1;
                signature_file = Some(args[i].clone());
            }
            "-q" => {}
            _ if !a.starts_with('-') => positional.push(a.to_string()),
            _ => return err_out(&format!("ssh-keygen: unsupported option: {a}\n"), 1),
        }
        i += 1;
    }

    if let Some(host) = find_host {
        let kh_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/known_hosts"));
        let kh_text = fs
            .read_file(&kh_path)
            .ok()
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let matches: Vec<&str> = kh_text
            .lines()
            .filter(|l| {
                let t = l.trim();
                !t.is_empty()
                    && !t.starts_with('#')
                    && t.split_whitespace()
                        .next()
                        .map(|h| h.split(',').any(|x| x == host))
                        .unwrap_or(false)
            })
            .collect();
        if matches.is_empty() {
            return err_out("", 1);
        }
        return ok_out(&format!("{}\n", matches.join("\n")));
    }

    if let Some(host) = remove_host {
        let kh_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/known_hosts"));
        let kh_text = fs
            .read_file(&kh_path)
            .ok()
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let remaining: Vec<&str> = kh_text
            .split('\n')
            .filter(|l| {
                let t = l.trim();
                t.is_empty()
                    || t.starts_with('#')
                    || !t.split_whitespace()
                        .next()
                        .map(|h| h.split(',').any(|x| x == host))
                        .unwrap_or(false)
            })
            .collect();
        let _ = fs.write_file(&kh_path, format!("{}\n", remaining.join("\n")).as_bytes());
        return ok_out(&format!("# Host {host} found: removed\n{kh_path} updated.\n"));
    }

    if let Some(action) = y_action {
        if action == "sign" {
            let key_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519"));
            let Ok(key_bytes) = fs.read_file(&key_path) else {
                return err_out(&format!("ssh-keygen: cannot read {key_path}\n"), 1);
            };
            let Some((seed, pub_key, _)) = parse_openssh_ed25519_privkey(&String::from_utf8_lossy(&key_bytes)) else {
                return err_out(&format!("ssh-keygen: invalid OpenSSH Ed25519 key: {key_path}\n"), 1);
            };
            let target_file = positional.first();
            let payload = if let Some(tf) = target_file {
                let p = resolve_ssh_path(cwd, tf);
                let Ok(b) = fs.read_file(&p) else {
                    return err_out(&format!("ssh-keygen: cannot read {tf}\n"), 1);
                };
                b
            } else {
                crate::vfs::stream_string_to_bytes(stdin)
            };
            let msg_hash = sha512_bytes(&payload);
            let mut to_sign = Vec::new();
            to_sign.extend_from_slice(b"SSHSIG");
            ssh_write_str(&mut to_sign, namespace.as_bytes());
            ssh_write_str(&mut to_sign, &[]);
            ssh_write_str(&mut to_sign, b"sha512");
            ssh_write_str(&mut to_sign, &msg_hash);
            let raw_sig = ed25519_sign(&to_sign, &seed);

            let mut sig_blob = Vec::new();
            ssh_write_str(&mut sig_blob, b"ssh-ed25519");
            ssh_write_str(&mut sig_blob, &raw_sig);

            let mut outer = Vec::new();
            outer.extend_from_slice(b"SSHSIG");
            ssh_write_u32(&mut outer, 1);
            ssh_write_str(&mut outer, &ssh_ed25519_pubkey_blob(&pub_key));
            ssh_write_str(&mut outer, namespace.as_bytes());
            ssh_write_str(&mut outer, &[]);
            ssh_write_str(&mut outer, b"sha512");
            ssh_write_str(&mut outer, &sig_blob);

            let armor = format!(
                "-----BEGIN SSH SIGNATURE-----\n{}\n-----END SSH SIGNATURE-----\n",
                ssh_b64_wrap(&outer, 70)
            );
            if let Some(tf) = target_file {
                let sig_out = format!("{}.sig", resolve_ssh_path(cwd, tf));
                let _ = fs.write_file(&sig_out, armor.as_bytes());
                return ok_out(&format!("Signing file {tf}\nWrite signature to {tf}.sig\n"));
            }
            return ok_out(&armor);
        }

        if action == "verify" || action == "check-novalidate" || action == "find-principals" {
            let sig_rel = signature_file.as_deref().or_else(|| positional.first().map(|s| s.as_str())).unwrap_or("");
            let sig_path = resolve_ssh_path(cwd, sig_rel);
            let Ok(sig_bytes) = fs.read_file(&sig_path) else {
                return err_out(&format!("ssh-keygen: cannot read {sig_path}\n"), 1);
            };
            let b64: String = String::from_utf8_lossy(&sig_bytes)
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && !l.starts_with("-----"))
                .collect();
            let raw = base64_decode(&b64).unwrap_or_default();
            if raw.len() < 10 || &raw[0..6] != b"SSHSIG" {
                return err_out("ssh-keygen: invalid SSHSIG header\n", 1);
            }
            let mut pos = 10usize;
            let Some(pub_blob) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let Some(sig_ns) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let _ = ssh_read_str(&raw, &mut pos);
            let Some(hash_alg) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let Some(sig_blob) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let mut ppos = 0usize;
            let _ = ssh_read_str(&pub_blob, &mut ppos);
            let Some(pub_key) = ssh_read_str(&pub_blob, &mut ppos) else {
                return err_out("ssh-keygen: invalid SSHSIG key/signature\n", 1);
            };
            let mut spos = 0usize;
            let _ = ssh_read_str(&sig_blob, &mut spos);
            let Some(raw_sig) = ssh_read_str(&sig_blob, &mut spos) else {
                return err_out("ssh-keygen: invalid SSHSIG key/signature\n", 1);
            };

            if action != "find-principals" && (!namespace_provided || String::from_utf8_lossy(&sig_ns) != namespace) {
                return err_out("ssh-keygen: signature namespace does not match requested namespace\n", 1);
            }
            if action == "verify" || action == "find-principals" {
                let Some(ref as_file) = file_arg else {
                    return err_out("ssh-keygen: allowed signers file and signer identity are required for verification\n", 1);
                };
                if action == "verify" && signer_identity.is_none() {
                    return err_out("ssh-keygen: allowed signers file and signer identity are required for verification\n", 1);
                }
                let as_path = resolve_ssh_path(cwd, as_file);
                let Ok(as_bytes) = fs.read_file(&as_path) else {
                    return err_out(&format!("ssh-keygen: cannot read {as_path}\n"), 1);
                };
                let as_text = String::from_utf8_lossy(&as_bytes);
                let entries: Vec<(String, Option<String>, [u8; 32])> =
                    as_text.lines().filter_map(parse_allowed_signer_line).collect();
                let matching: Vec<&(String, Option<String>, [u8; 32])> = entries
                    .iter()
                    .filter(|(_, ns_opt, pk)| {
                        pk.as_slice() == pub_key.as_slice()
                            && (action == "find-principals"
                                || ssh_matches_patterns(&namespace, ns_opt.as_deref().unwrap_or("*")))
                    })
                    .collect();
                if action == "find-principals" {
                    if matching.is_empty() {
                        return err_out("", 1);
                    }
                    let principals: Vec<&str> = matching.iter().map(|(p, _, _)| p.as_str()).collect();
                    return ok_out(&format!("{}\n", principals.join("\n")));
                }
                let id_str = signer_identity.as_deref().unwrap_or("");
                if !matching.iter().any(|(p, _, _)| ssh_matches_patterns(id_str, p)) {
                    return err_out("ssh-keygen: signer is not authorized by allowed signers\n", 1);
                }
            }

            let payload = crate::vfs::stream_string_to_bytes(stdin);
            let msg_hash = sha512_bytes(&payload);
            let mut to_verify = Vec::new();
            to_verify.extend_from_slice(b"SSHSIG");
            ssh_write_str(&mut to_verify, &sig_ns);
            ssh_write_str(&mut to_verify, &[]);
            ssh_write_str(&mut to_verify, &hash_alg);
            ssh_write_str(&mut to_verify, &msg_hash);
            if !ed25519_verify(&raw_sig, &to_verify, &pub_key) {
                return err_out("Signature verification failed\n", 1);
            }
            let fp = ssh_fingerprint_sha256(&pub_key);
            return ok_out(&format!(
                "Good \"{}\" signature for {} with ED25519 key {fp}\n",
                String::from_utf8_lossy(&sig_ns),
                signer_identity.as_deref().unwrap_or("principal")
            ));
        }
    }

    if derive_pub {
        let key_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519"));
        let Ok(key_bytes) = fs.read_file(&key_path) else {
            return err_out(&format!("ssh-keygen: cannot read {key_path}\n"), 1);
        };
        let Some((_, pub_key, cmt)) = parse_openssh_ed25519_privkey(&String::from_utf8_lossy(&key_bytes)) else {
            return err_out(&format!("ssh-keygen: invalid OpenSSH private key: {key_path}\n"), 1);
        };
        let pub_b64 = ssh_b64_wrap(&ssh_ed25519_pubkey_blob(&pub_key), 0);
        return ok_out(&format!("ssh-ed25519 {pub_b64} {cmt}\n"));
    }

    if show_fp {
        let key_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519.pub"));
        let Ok(key_bytes) = fs.read_file(&key_path) else {
            return err_out(&format!("ssh-keygen: cannot read {key_path}\n"), 1);
        };
        let content = String::from_utf8_lossy(&key_bytes);
        let parsed = parse_openssh_ed25519_privkey(&content)
            .map(|(_, pk, c)| (pk, c))
            .or_else(|| parse_openssh_ed25519_pubkey(&content));
        let Some((pub_key, cmt)) = parsed else {
            return err_out(&format!("ssh-keygen: not a public key file: {key_path}\n"), 1);
        };
        let fp = ssh_fingerprint_sha256(&pub_key);
        let label = if cmt.is_empty() { key_path.as_str() } else { cmt.as_str() };
        return ok_out(&format!("256 {fp} {label} (ED25519)\n"));
    }

    let out_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519"));
    if let Some((dir, _)) = out_path.rsplit_once('/') && !dir.is_empty() {
        let _ = fs.mkdir_all(dir);
    }
    let seed_digest = sha256_bytes(format!("ed25519:{out_path}:{comment}").as_bytes());
    let pub_key = ed25519_pubkey_from_seed(&seed_digest);
    let priv_pem = format_openssh_ed25519_privkey(&seed_digest, &pub_key, &comment);
    let pub_line = format!(
        "ssh-ed25519 {} {comment}\n",
        ssh_b64_wrap(&ssh_ed25519_pubkey_blob(&pub_key), 0)
    );
    let _ = fs.write_file(&out_path, priv_pem.as_bytes());
    let _ = fs.write_file(&format!("{out_path}.pub"), pub_line.as_bytes());
    let fp = ssh_fingerprint_sha256(&pub_key);
    ok_out(&format!(
        "Generating public/private ed25519 key pair.\nYour identification has been saved in {out_path}\nYour public key has been saved in {out_path}.pub\nThe key fingerprint is:\n{fp} {comment}\n"
    ))
}

include!("media.rs");
include!("graphviz.rs");
