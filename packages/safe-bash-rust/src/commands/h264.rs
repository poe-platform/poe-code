// H.264 sequence parameters use MSB-first bits and unsigned/signed Exp-Golomb codes.
struct Bits<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Bits<'_> {
    fn read(&mut self, n: u32) -> Option<u32> {
        let mut v = 0;
        for _ in 0..n {
            v = v << 1 | u32::from((self.bytes.get(self.at / 8)? >> (7 - self.at % 8)) & 1);
            self.at += 1;
        }
        Some(v)
    }
    fn ue(&mut self) -> Option<u32> {
        let mut n = 0;
        while self.read(1)? == 0 {
            n += 1;
            if n > 31 {
                return None;
            }
        }
        Some((1u32 << n) - 1 + self.read(n)?)
    }
    fn se(&mut self) -> Option<i64> {
        let n = i64::from(self.ue()?);
        Some(if n & 1 == 0 { -n / 2 } else { (n + 1) / 2 })
    }
}
fn rbsp(input: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(input.len());
    let mut zeros = 0;
    for &b in input {
        if zeros >= 2 && b == 3 {
            zeros = 0;
            continue;
        }
        bytes.push(b);
        zeros = if b == 0 { zeros + 1 } else { 0 };
    }
    bytes
}
pub(super) struct Sequence {
    pub width: u32,
    pub height: u32,
    pub sar: (u32, u32),
    pub pix_fmt: &'static str,
    pub profile: String,
}
impl Sequence {
    pub(super) fn parse(nal: &[u8]) -> Option<Self> {
        let rbsp = rbsp(nal);
        let mut b = Bits {
            bytes: &rbsp,
            at: if rbsp.first()? & 31 == 7 { 8 } else { 0 },
        };
        let profile = b.read(8)?;
        let flags = b.read(8)?;
        b.read(8)?;
        b.ue()?;
        let (mut chroma, mut separate, mut depth) = (1, false, 0);
        if matches!(
            profile,
            100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128 | 138 | 139 | 134 | 135
        ) {
            chroma = b.ue()?;
            if chroma > 3 {
                return None;
            }
            if chroma == 3 {
                separate = b.read(1)? != 0
            }
            depth = b.ue()?;
            b.ue()?;
            b.read(1)?;
            if b.read(1)? != 0 {
                for i in 0..if chroma == 3 { 12 } else { 8 } {
                    if b.read(1)? == 0 {
                        continue;
                    }
                    let (mut last, mut next) = (8i64, 8i64);
                    for _ in 0..if i < 6 { 16 } else { 64 } {
                        if next != 0 {
                            next = (last + b.se()?).rem_euclid(256)
                        }
                        if next != 0 {
                            last = next
                        }
                    }
                }
            }
        }
        b.ue()?;
        match b.ue()? {
            0 => {
                b.ue()?;
            }
            1 => {
                b.read(1)?;
                b.se()?;
                b.se()?;
                let count = b.ue()?;
                if count > 255 {
                    return None;
                }
                for _ in 0..count {
                    b.se()?;
                }
            }
            2 => {}
            _ => return None,
        }
        b.ue()?;
        b.read(1)?;
        let mbw = u64::from(b.ue()?) + 1;
        let mbh = u64::from(b.ue()?) + 1;
        let frame_only = b.read(1)?;
        if frame_only == 0 {
            b.read(1)?;
        }
        b.read(1)?;
        let (mut cropx, mut cropy) = (0, 0);
        if b.read(1)? != 0 {
            cropx = u64::from(b.ue()?) + u64::from(b.ue()?);
            cropy = u64::from(b.ue()?) + u64::from(b.ue()?);
        }
        let array = if separate { 0 } else { chroma };
        let vertical = u64::from(2 - frame_only);
        let width = u32::try_from(
            (mbw * 16)
                .saturating_sub(cropx * if array == 0 || array == 3 { 1 } else { 2 })
                .max(1),
        )
        .ok()?;
        let height = u32::try_from(
            (mbh * 16 * vertical)
                .saturating_sub(cropy * vertical * if array == 1 { 2 } else { 1 })
                .max(1),
        )
        .ok()?;
        let sar = if b.read(1)? != 0 && b.read(1)? != 0 {
            match b.read(8)? {
                255 => (b.read(16)?.max(1), b.read(16)?.max(1)),
                i => [
                    (1, 1),
                    (1, 1),
                    (12, 11),
                    (10, 11),
                    (16, 11),
                    (40, 33),
                    (24, 11),
                    (20, 11),
                    (32, 11),
                    (80, 33),
                    (18, 11),
                    (15, 11),
                    (64, 33),
                    (160, 99),
                    (4, 3),
                    (3, 2),
                    (2, 1),
                ]
                .get(i as usize)
                .copied()
                .unwrap_or((1, 1)),
            }
        } else {
            (1, 1)
        };
        let pix_fmt = match (chroma, depth > 0) {
            (0, _) => "gray",
            (2, true) => "yuv422p10le",
            (2, false) => "yuv422p",
            (3, true) => "yuv444p10le",
            (3, false) => "yuv444p",
            (_, true) => "yuv420p10le",
            _ => "yuv420p",
        };
        let profile = match profile {
            66 if flags & 64 != 0 => "Constrained Baseline".into(),
            66 => "Baseline".into(),
            77 => "Main".into(),
            88 => "Extended".into(),
            100 => "High".into(),
            110 => "High 10".into(),
            122 => "High 4:2:2".into(),
            244 => "High 4:4:4 Predictive".into(),
            v => format!("Profile {v}"),
        };
        Some(Self {
            width,
            height,
            sar,
            pix_fmt,
            profile,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Sequence;

    #[test]
    fn sequence_parameters_use_chroma_crop_units_and_extended_aspect_ratio() {
        let nal = [
            0x67, 0x7a, 0, 0x28, 0xb6, 0xce, 0x8b, 0xd2, 0x4b, 0xff, 0, 12, 0, 11, 4,
        ];
        let s = Sequence::parse(&nal).unwrap();
        assert_eq!(
            (s.width, s.height, s.sar, s.pix_fmt, s.profile.as_str()),
            (28, 14, (12, 11), "yuv422p10le", "High 4:2:2")
        );
        assert!(Sequence::parse(&nal[..6]).is_none());
    }
}
