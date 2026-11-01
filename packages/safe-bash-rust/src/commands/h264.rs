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
    id: u32,
    frame_num: u32,
    poc: Option<u32>,
    frame_only: bool,
    mb_width: u64,
    mb_height: u64,
    crop_left: u32,
    crop_top: u32,
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
        let id = b.ue()?;
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
        let frame_num = b.ue()?.checked_add(4)?;
        let poc = match b.ue()? {
            0 => Some(b.ue()?.checked_add(4)?),
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
                None
            }
            2 => Some(0),
            _ => return None,
        };
        b.ue()?;
        b.read(1)?;
        let mbw = u64::from(b.ue()?) + 1;
        let mbh = u64::from(b.ue()?) + 1;
        let frame_only = b.read(1)?;
        if frame_only == 0 {
            b.read(1)?;
        }
        b.read(1)?;
        let (mut cropx, mut cropy, mut left, mut top) = (0, 0, 0, 0);
        if b.read(1)? != 0 {
            left = b.ue()?;
            cropx = u64::from(left) + u64::from(b.ue()?);
            top = b.ue()?;
            cropy = u64::from(top) + u64::from(b.ue()?);
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
            id,
            frame_num,
            poc,
            frame_only: frame_only != 0,
            mb_width: mbw,
            mb_height: mbh,
            crop_left: left,
            crop_top: top,
        })
    }
}

use super::super::png_pixels::Raster;

// Baseline, frame-coded 4:2:0 access units containing I_PCM blocks or P skips.
// Keep one reference picture; other macroblock and slice syntax requires a full decoder.
pub(super) struct Pcm<'a> {
    seq: &'a Sequence,
    length: usize,
    pps_id: u32,
    deblock: bool,
    blocks: Vec<[u8; 384]>,
    pub next: usize,
}
impl<'a> Pcm<'a> {
    pub(super) fn new(
        seq: &'a Sequence,
        config: &[u8],
        limit: usize,
    ) -> Result<Self, &'static str> {
        let unsupported = "unsupported H.264 picture parameters";
        if !seq.frame_only
            || seq.pix_fmt != "yuv420p"
            || seq.frame_num > 16
            || seq.poc.is_none_or(|n| n > 16)
            || config.get(5).is_none_or(|v| v & 31 != 1)
        {
            return Err(unsupported);
        }
        let length = usize::from(config[4] & 3) + 1;
        let pps = 8 + usize::from(super::u16_at(config, 6));
        if config.get(pps) != Some(&1) {
            return Err(unsupported);
        }
        let size = usize::from(super::u16_at(config, pps + 1));
        let n = config.get(pps + 3..pps + 3 + size).ok_or(unsupported)?;
        let params = (|| {
            if n.first()? & 31 != 8 {
                return None;
            }
            let raw = rbsp(&n[1..]);
            let mut b = Bits { bytes: &raw, at: 0 };
            let id = b.ue()?;
            if b.ue()? != seq.id || b.read(1)? != 0 || b.read(1)? != 0 || b.ue()? != 0 {
                return None;
            }
            b.ue()?;
            b.ue()?;
            if b.read(1)? != 0 {
                return None;
            }
            b.read(2)?;
            b.se()?;
            b.se()?;
            b.se()?;
            let deblock = b.read(1)? != 0;
            b.read(1)?;
            if b.read(1)? != 0 {
                return None;
            }
            Some((id, deblock))
        })()
        .ok_or(unsupported)?;
        let count = usize::try_from(seq.mb_width.saturating_mul(seq.mb_height))
            .map_err(|_| "image exceeds memory budget")?;
        if count > limit / 384
            || u64::from(seq.crop_left) * 2 + u64::from(seq.width) > seq.mb_width * 16
            || u64::from(seq.crop_top) * 2 + u64::from(seq.height) > seq.mb_height * 16
        {
            return Err("image exceeds memory budget");
        }
        Ok(Self {
            seq,
            length,
            pps_id: params.0,
            deblock: params.1,
            blocks: vec![[0; 384]; count],
            next: 0,
        })
    }
    pub(super) fn decode(&mut self, mut data: &[u8]) -> Result<(), &'static str> {
        let invalid = "unsupported or truncated H.264 slice";
        let mut decoded = false;
        while !data.is_empty() {
            let (prefix, rest) = data.split_at_checked(self.length).ok_or(invalid)?;
            let len = prefix.iter().fold(0usize, |n, &v| n << 8 | usize::from(v));
            let (nal, rest) = rest.split_at_checked(len).ok_or(invalid)?;
            data = rest;
            let head = *nal.first().ok_or(invalid)?;
            let kind = head & 31;
            if matches!(kind, 6..=12) {
                continue;
            }
            if decoded || !matches!(kind, 1 | 5) {
                return Err(invalid);
            }
            let raw = rbsp(&nal[1..]);
            let mut b = Bits { bytes: &raw, at: 0 };
            let complete = (|| {
                if b.ue()? != 0 {
                    return None;
                }
                let ty = b.ue()?;
                let p = matches!(ty, 0 | 5);
                if (!p && !matches!(ty, 2 | 7))
                    || p && (kind == 5 || self.next == 0)
                    || b.ue()? != self.pps_id
                {
                    return None;
                }
                b.read(self.seq.frame_num)?;
                if kind == 5 {
                    b.ue()?;
                }
                b.read(self.seq.poc?)?;
                if p && (b.read(1)? != 0 || b.read(1)? != 0) {
                    return None;
                }
                if kind == 5 {
                    b.read(2)?;
                } else if head & 0x60 != 0 && b.read(1)? != 0 {
                    return None;
                }
                b.se()?;
                if !self.deblock || b.ue()? != 1 {
                    return None;
                }
                let mut i = 0;
                while i < self.blocks.len() {
                    if p {
                        let skip = b.ue()? as usize;
                        if skip > self.blocks.len() - i {
                            return None;
                        }
                        i += skip;
                        if i == self.blocks.len() {
                            break;
                        }
                    }
                    if b.ue()? != if p { 30 } else { 25 } {
                        return None;
                    }
                    while b.at % 8 != 0 {
                        if b.read(1)? != 0 {
                            return None;
                        }
                    }
                    let at = b.at / 8;
                    self.blocks[i].copy_from_slice(raw.get(at..at + 384)?);
                    b.at += 384 * 8;
                    i += 1;
                }
                Some(())
            })();
            complete.ok_or(invalid)?;
            decoded = true;
        }
        if !decoded {
            return Err(invalid);
        }
        self.next += 1;
        Ok(())
    }
    // sliceMp4 promotes a predictive first sample to an IDR. Subsequent skips
    // must see the promoted pixels, including the RGBA -> YUV rounding.
    pub(super) fn promote(&mut self, w: usize, h: usize, limit: usize) -> Result<(), &'static str> {
        let (dw, dh) = (
            self.seq.mb_width as usize * 16,
            self.seq.mb_height as usize * 16,
        );
        if w == 0
            || h == 0
            || w.div_ceil(16) != dw / 16
            || h.div_ceil(16) != dh / 16
            || dw.saturating_mul(dh) > limit / 4
        {
            return Err("unsupported H.264 slice promotion dimensions");
        }
        let mut im = self.image((w, h), false, limit)?;
        if w != dw || h != dh {
            im.remap(dw, dh, |r, x, y| r.pixels[y.min(h - 1) * w + x.min(w - 1)])
        }
        let mut planes = Vec::new();
        super::super::y4m::append_planes(&mut planes, &im, limit)?;
        let y_len = dw * dh;
        for (i, mb) in self.blocks.iter_mut().enumerate() {
            let (x, y) = (i % (dw / 16), i / (dw / 16));
            for row in 0..16 {
                let j = (y * 16 + row) * dw + x * 16;
                mb[row * 16..row * 16 + 16].copy_from_slice(&planes[j..j + 16]);
            }
            for row in 0..8 {
                let j = (y * 8 + row) * (dw / 2) + x * 8;
                for (plane, base) in [(y_len, 256), (y_len + y_len / 4, 320)] {
                    mb[base + row * 8..base + row * 8 + 8]
                        .copy_from_slice(&planes[plane + j..plane + j + 8]);
                }
            }
        }
        Ok(())
    }
    pub(super) fn idr(&self, limit: usize) -> Result<Vec<u8>, &'static str> {
        // The slice promoted at a cut is frame zero of the new stream. All
        // blocks use I_PCM and start their samples on a byte boundary.
        let mut raw = Vec::new();
        let mut at = 0;
        let put = |raw: &mut Vec<u8>, at: &mut u32, value: u32, count: u32| {
            for n in (0..count).rev() {
                if *at == 0 {
                    raw.push(0)
                }
                *raw.last_mut().unwrap() |= (((value >> n) & 1) as u8) << (7 - *at);
                *at = (*at + 1) % 8;
            }
        };
        let ue = |raw: &mut Vec<u8>, at: &mut u32, value: u32| {
            let code = value + 1;
            put(raw, at, code, 2 * (31 - code.leading_zeros()) + 1);
        };
        ue(&mut raw, &mut at, 0);
        ue(&mut raw, &mut at, 7);
        ue(&mut raw, &mut at, 0);
        put(&mut raw, &mut at, 0, 4);
        ue(&mut raw, &mut at, 0);
        put(&mut raw, &mut at, 0, 6);
        ue(&mut raw, &mut at, 0);
        ue(&mut raw, &mut at, 1);
        for block in &self.blocks {
            ue(&mut raw, &mut at, 25);
            at = 0;
            if raw.len().saturating_add(block.len()) > limit {
                return Err("output byte limit exceeded");
            }
            raw.extend_from_slice(block);
        }
        raw.push(0x80);
        let mut sample = vec![0, 0, 0, 0, 0x65];
        let mut zeros = 0;
        for byte in raw {
            if zeros == 2 && byte <= 3 {
                sample.push(3);
                zeros = 0
            }
            sample.push(byte);
            zeros = if byte == 0 { zeros + 1 } else { 0 };
            if sample.len() > limit {
                return Err("output byte limit exceeded");
            }
        }
        let size = (sample.len() - 4) as u32;
        sample[..4].copy_from_slice(&size.to_be_bytes());
        Ok(sample)
    }
    pub(super) fn image(
        &self,
        track: (usize, usize),
        filtered: bool,
        limit: usize,
    ) -> Result<Raster, &'static str> {
        let sw = self.seq.width as usize;
        let sh = self.seq.height as usize;
        let (w, h) = if filtered { (sw, sh) } else { track };
        let count = w
            .checked_mul(h)
            .filter(|&n| n <= limit / 4)
            .ok_or("image exceeds memory budget")?;
        let mut pixels = Vec::with_capacity(count);
        for i in 0..count {
            let (x, y) = (
                i % sw + self.seq.crop_left as usize * 2,
                i / sw + self.seq.crop_top as usize * 2,
            );
            if i / sw >= sh {
                pixels.push([0, 0, 0, 255]);
                continue;
            }
            let mb = &self.blocks[y / 16 * self.seq.mb_width as usize + x / 16];
            let uv = (y % 16 / 2) * 8 + x % 16 / 2;
            pixels.push(super::super::y4m::bt601(
                i32::from(mb[(y % 16) * 16 + x % 16]) - 16,
                i32::from(mb[256 + uv]) - 128,
                i32::from(mb[320 + uv]) - 128,
            ));
        }
        Ok(Raster {
            width: w,
            height: h,
            pixels,
            alpha: false,
            gray: false,
            density: 72,
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
