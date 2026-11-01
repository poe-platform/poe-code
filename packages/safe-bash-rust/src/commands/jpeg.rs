// Baseline 4:4:4 JFIF, with the same quantization tables as image-ast.
use super::png_pixels::Raster;
pub(super) const ZIGZAG: [usize; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const LUMA_QUANT: [u8; 64] = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_QUANT: [u8; 64] = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
const DC_LUMA_NRCODES: [u8; 17] = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_NRCODES: [u8; 17] = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const AC_LUMA_NRCODES: [u8; 17] = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const AC_LUMA_VALUES: [u8; 162] = [
    1, 2, 3, 0, 4, 17, 5, 18, 33, 49, 65, 6, 19, 81, 97, 7, 34, 113, 20, 50, 129, 145, 161, 8, 35,
    66, 177, 193, 21, 82, 209, 240, 36, 51, 98, 114, 130, 9, 10, 22, 23, 24, 25, 26, 37, 38, 39,
    40, 41, 42, 52, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86, 87, 88,
    89, 90, 99, 100, 101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122, 131,
    132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153, 154, 162, 163, 164,
    165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196, 197,
    198, 199, 200, 201, 202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 225, 226, 227, 228, 229,
    230, 231, 232, 233, 234, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250,
];
const AC_CHROMA_NRCODES: [u8; 17] = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
const AC_CHROMA_VALUES: [u8; 162] = [
    0, 1, 2, 3, 17, 4, 5, 33, 49, 6, 18, 65, 81, 7, 97, 113, 19, 34, 50, 129, 8, 20, 66, 145, 161,
    177, 193, 9, 35, 51, 82, 240, 21, 98, 114, 209, 10, 22, 36, 52, 225, 37, 241, 23, 24, 25, 26,
    38, 39, 40, 41, 42, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86, 87,
    88, 89, 90, 99, 100, 101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122, 130,
    131, 132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153, 154, 162, 163,
    164, 165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196,
    197, 198, 199, 200, 201, 202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 226, 227, 228, 229,
    230, 231, 232, 233, 234, 242, 243, 244, 245, 246, 247, 248, 249, 250,
];

type Table = [(u16, u8); 256];
struct Entropy {
    out: Vec<u8>,
    bits: u32,
    left: u8,
}
impl Entropy {
    fn write(&mut self, (code, len): (u16, u8)) {
        self.bits = (self.bits << len) | u32::from(code);
        self.left += len;
        while self.left >= 8 {
            self.left -= 8;
            let b = (self.bits >> self.left) as u8;
            self.out.push(b);
            if b == 255 {
                self.out.push(0);
            }
        }
    }
    fn value(&mut self, table: &Table, zeros: usize, v: i32) {
        let len = (32 - v.unsigned_abs().leading_zeros()) as u8;
        self.write(table[(zeros << 4) + len as usize]);
        let bits = if v < 0 { (1 << len) - 1 + v } else { v };
        self.write((bits as u16, len));
    }
    fn block(&mut self, values: [i32; 64], prev: &mut i32, dc: &Table, ac: &Table) {
        self.value(dc, 0, values[0] - *prev);
        *prev = values[0];
        let mut zeros = 0;
        for v in &values[1..] {
            if *v == 0 {
                zeros += 1;
                continue;
            }
            while zeros >= 16 {
                self.write(ac[0xf0]);
                zeros -= 16;
            }
            self.value(ac, zeros, *v);
            zeros = 0;
        }
        if zeros != 0 {
            self.write(ac[0]);
        }
    }
}

fn segment(out: &mut Vec<u8>, marker: u8, body: &[u8]) {
    out.extend_from_slice(&[255, marker]);
    out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(body);
}

fn coefficients(block: &[f64; 64], cos: &[[f64; 8]; 8], quant: &[u8; 64]) -> [i32; 64] {
    let mut temp = [[0.; 8]; 8];
    for (row, src) in temp.iter_mut().zip(block.chunks_exact(8)) {
        for (v, c) in row.iter_mut().zip(cos) {
            *v = src.iter().zip(c).map(|(s, t)| s * t).sum::<f64>() * 0.5;
        }
    }
    std::array::from_fn(|i| {
        let p = ZIGZAG[i];
        let sum: f64 = temp
            .iter()
            .zip(cos[p / 8])
            .map(|(row, c)| row[p % 8] * c)
            .sum();
        let value = sum * 0.5 / f64::from(quant[i]);
        // Math.round rounds negative half-integers towards zero.
        (value.floor() + f64::from(value - value.floor() >= 0.5)) as i32
    })
}

pub(super) fn cosines() -> [[f64; 8]; 8] {
    std::array::from_fn(|u| {
        std::array::from_fn(|x| {
            if u == 0 {
                std::f64::consts::FRAC_1_SQRT_2
            } else {
                (((2 * x + 1) * u) as f64 * std::f64::consts::PI / 16.).cos()
            }
        })
    })
}

pub(super) fn encode(
    im: &Raster,
    quality: u8,
    density: u32,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (im.width, im.height);
    if w == 0 || h == 0 || w > 65535 || h > 65535 {
        return Err("JPEG dimensions exceed 16-bit frame fields");
    }
    let mut out = vec![255, 216];
    let mut jfif = *b"JFIF\0\x01\x01\x01\x00\x48\x00\x48\x00\x00";
    let dpi = (density.max(1) as u16).to_be_bytes();
    jfif[8..10].copy_from_slice(&dpi);
    jfif[10..12].copy_from_slice(&dpi);
    segment(&mut out, 0xe0, &jfif);
    let q = u32::from(quality).clamp(1, 100);
    let scale = if q < 50 { 5000 / q } else { 200 - 2 * q };
    let quant = [LUMA_QUANT, CHROMA_QUANT]
        .map(|base| ZIGZAG.map(|p| ((u32::from(base[p]) * scale + 50) / 100).clamp(1, 255) as u8));
    let mut dqt = Vec::new();
    for (i, q) in quant.iter().enumerate() {
        dqt.push(i as u8);
        dqt.extend_from_slice(q);
    }
    segment(&mut out, 0xdb, &dqt);
    segment(
        &mut out,
        0xc0,
        &[
            8,
            (h >> 8) as u8,
            h as u8,
            (w >> 8) as u8,
            w as u8,
            3,
            1,
            17,
            0,
            2,
            17,
            1,
            3,
            17,
            1,
        ],
    );
    let mut dht = Vec::new();
    let tables = [
        (0, &DC_LUMA_NRCODES, &DC_VALUES[..]),
        (16, &AC_LUMA_NRCODES, &AC_LUMA_VALUES[..]),
        (1, &DC_CHROMA_NRCODES, &DC_VALUES[..]),
        (17, &AC_CHROMA_NRCODES, &AC_CHROMA_VALUES[..]),
    ]
    .map(|(id, counts, values)| {
        dht.push(id);
        dht.extend_from_slice(&counts[1..]);
        dht.extend_from_slice(values);
        let mut table = [(0, 0); 256];
        let mut code = 0u16;
        let mut symbols = values.iter();
        for (len, &count) in counts.iter().enumerate().skip(1) {
            for sym in symbols.by_ref().take(count as usize) {
                table[*sym as usize] = (code, len as u8);
                code += 1;
            }
            code <<= 1;
        }
        table
    });
    segment(&mut out, 0xc4, &dht);
    segment(&mut out, 0xda, &[3, 1, 0, 2, 17, 3, 17, 0, 63, 0]);
    let mut writer = Entropy {
        out,
        bits: 0,
        left: 0,
    };
    let cos = cosines();
    let mut prev = [0; 3];
    for by in (0..h).step_by(8) {
        for bx in (0..w).step_by(8) {
            let mut channels = [[0.; 64]; 3];
            for i in 0..64 {
                let [r, g, b, a] = im.pixels[(by + i / 8).min(h - 1) * w + (bx + i % 8).min(w - 1)];
                let a = f64::from(a) / 255.;
                let [r, g, b] = [r, g, b].map(|c| f64::from(c) * a + 255. * (1. - a));
                channels[0][i] = 0.299 * r + 0.587 * g + 0.114 * b - 128.;
                channels[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
                channels[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
            }
            for (i, channel) in channels.iter().enumerate() {
                let chroma = usize::from(i != 0);
                writer.block(
                    coefficients(channel, &cos, &quant[chroma]),
                    &mut prev[i],
                    &tables[chroma * 2],
                    &tables[chroma * 2 + 1],
                );
            }
            if writer.out.len() > limit {
                return Err("output byte limit exceeded");
            }
        }
    }
    if writer.left != 0 {
        let pad = 8 - writer.left;
        writer.write(((1 << pad) - 1, pad));
    }
    writer.out.extend_from_slice(&[255, 217]);
    Ok(writer.out)
}
