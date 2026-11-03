use super::super::{atoms, audio_entry_format, child, esds, h264, u16_at, u32_at};
use super::{Options, Track};

type Result<T> = std::result::Result<T, &'static str>;
struct Riff {
    bytes: Vec<u8>,
    limit: usize,
}
impl Riff {
    fn put(&mut self, data: &[u8]) -> Result<()> {
        if data.len() > self.limit - self.bytes.len() {
            return Err("output byte limit exceeded");
        }
        self.bytes.extend_from_slice(data);
        Ok(())
    }
    fn words(&mut self, values: &[u32]) -> Result<()> {
        for v in values {
            self.put(&v.to_le_bytes())?;
        }
        Ok(())
    }
    fn chunk(&mut self, tag: &[u8; 4], write: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        self.put(tag)?;
        let at = self.bytes.len();
        self.words(&[0])?;
        write(self)?;
        let len =
            u32::try_from(self.bytes.len() - at - 4).map_err(|_| "output byte limit exceeded")?;
        self.bytes[at..at + 4].copy_from_slice(&len.to_le_bytes());
        if len & 1 != 0 {
            self.put(&[0])?;
        }
        Ok(())
    }
    fn list(&mut self, kind: &[u8; 4], write: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        self.chunk(b"LIST", |r| {
            r.put(kind)?;
            write(r)
        })
    }
}
fn parameter_sets(config: &[u8]) -> (Vec<&[u8]>, Vec<&[u8]>) {
    let mut bytes = config.get(6..).unwrap_or_default();
    fn take<'a>(bytes: &mut &'a [u8], n: usize) -> Vec<&'a [u8]> {
        (0..n)
            .map(|_| {
                let size = u16_at(bytes, 0) as usize;
                *bytes = bytes.get(2..).unwrap_or_default();
                let (nal, rest) = bytes.split_at(size.min(bytes.len()));
                *bytes = rest;
                nal
            })
            .collect()
    }
    let sps = take(
        &mut bytes,
        usize::from(config.get(5).copied().unwrap_or(0) & 31),
    );
    let (&n, mut rest) = bytes.split_first().unwrap_or((&0, &[]));
    (sps, take(&mut rest, usize::from(n)))
}
pub(super) fn write(tracks: &[Track<'_>], seconds: f64, audio: &Options) -> Result<Vec<u8>> {
    let video = tracks.iter().find(|t| t.kind == "video");
    let sound = tracks.iter().find(|t| t.kind == "audio");
    let (w, h) = video.map_or((320, 240), |t| (t.width, t.height));
    let pixels = w.wrapping_mul(h).wrapping_mul(3);
    let n = video.map_or(0, |t| t.samples.len() as u32);
    let fps = if n != 0 && seconds > 0. {
        (f64::from(n) / seconds).round().max(1.) as u32
    } else {
        30
    };
    let us = (1_000_000. / f64::from(fps)).round() as u32;
    let mut out = Riff {
        bytes: Vec::new(),
        limit: audio.limit,
    };
    out.chunk(b"RIFF", |r| {
        r.put(b"AVI ")?;
        r.list(b"hdrl", |r| {
            r.chunk(b"avih", |r| {
                r.words(&[
                    us,
                    100000,
                    0,
                    16,
                    n,
                    0,
                    u32::from(video.is_some()) + u32::from(sound.is_some()),
                    pixels,
                    w,
                    h,
                    0,
                    0,
                    0,
                    0,
                ])
            })?;
            if video.is_some() {
                r.list(b"strl", |r| {
                    r.chunk(b"strh", |r| {
                        r.put(b"vidsH264")?;
                        r.words(&[
                            0,
                            0,
                            0,
                            1,
                            fps,
                            0,
                            n,
                            pixels,
                            u32::MAX,
                            0,
                            0,
                            (h << 16) | (w & 65535),
                        ])
                    })?;
                    r.chunk(b"strf", |r| {
                        r.words(&[40, w, h, 0x00180001])?;
                        r.put(b"H264")?;
                        r.words(&[pixels, 0, 0, 0, 0])
                    })
                })?;
            }
            if let Some(t) = sound {
                let mut rate = 44100;
                let mut ch = 2;
                if let Some((tag, entry)) = atoms(t.stsd.get(8..).unwrap_or_default()).next()
                    && audio_entry_format(tag)
                    && entry.len() >= 28
                {
                    rate = ((u64::from(u32_at(entry, 24)) + 32768) >> 16) as u32;
                    ch = u32::from(u16_at(entry, 16));
                    let start = match u16_at(entry, 8) {
                        1 => 44,
                        2 => 64,
                        _ => 28,
                    };
                    for (tag, b) in atoms(entry.get(start..).unwrap_or_default()) {
                        match tag {
                            b"esds" | b"wave" => {
                                let payload = if tag == b"wave" {
                                    let Some((_, v)) = atoms(b).find(|(k, _)| *k == b"esds") else {
                                        continue;
                                    };
                                    v
                                } else {
                                    b
                                };
                                let cfg = esds(payload);
                                if cfg.rate != 0 {
                                    rate = cfg.rate;
                                }
                                if cfg.channels != 0 {
                                    ch = cfg.channels.into();
                                }
                            }
                            b"dOps" => {
                                rate = match u32_at(b, 4) {
                                    0 => 48000,
                                    n => n,
                                };
                                if let Some(&channels) = b.get(1).filter(|&&n| n != 0) {
                                    ch = channels.into();
                                }
                            }
                            _ => (),
                        }
                    }
                }
                let rate = audio.rate.unwrap_or(rate);
                let ch = audio.channels.unwrap_or(ch);
                let count = if audio.clear_samples {
                    1
                } else {
                    t.samples.len().max(1) as u32
                };
                r.list(b"strl", |r| {
                    r.chunk(b"strh", |r| {
                        r.put(b"auds")?;
                        r.words(&[0, 0, 0, 0, 1024, rate, 0, count, 4096, u32::MAX, 0, 0, 0])
                    })?;
                    r.chunk(b"strf", |r| {
                        r.words(&[(ch << 16) | 255, rate, 16000, 0x00100004])?;
                        r.put(&[0, 0])
                    })
                })?;
            }
            Ok(())
        })?;
        let movi_start = r.bytes.len() + 8;
        r.list(b"movi", |r| {
            if let Some(t) = video {
                let entry = atoms(t.stsd.get(8..).unwrap_or_default())
                    .next()
                    .map_or(&[][..], |(_, v)| v);
                let config = child(entry.get(78..).unwrap_or_default(), b"avcC");
                let length = usize::from(config.get(4).copied().unwrap_or(3) & 3) + 1;
                let (mut sps, mut pps) = parameter_sets(config);
                let fallback;
                if sps.is_empty() || pps.is_empty() {
                    fallback = h264::configuration(w as usize, h as usize, fps)?;
                    let (s, p) = parameter_sets(&fallback);
                    if sps.is_empty() {
                        sps = s;
                    }
                    if pps.is_empty() {
                        pps = p;
                    }
                }
                for (i, s) in t.samples.iter().enumerate() {
                    r.chunk(b"00dc", |r| {
                        if i == 0 || s.key {
                            for v in sps.iter().chain(&pps) {
                                r.put(&[0, 0, 0, 1])?;
                                r.put(v)?;
                            }
                        }
                        let mut data = s.data.as_ref();
                        while let Some(prefix) = data.get(..length) {
                            let n = prefix
                                .iter()
                                .fold(0usize, |n, &b| (n << 8) | usize::from(b));
                            data = &data[length..];
                            if n == 0 || n > data.len() {
                                break;
                            }
                            r.put(&[0, 0, 0, 1])?;
                            r.put(&data[..n])?;
                            data = &data[n..];
                        }
                        Ok(())
                    })?;
                }
            }
            if let Some(t) = sound {
                if audio.clear_samples || t.samples.is_empty() {
                    r.chunk(b"01wb", |r| r.put(super::super::super::adts::silent(2)))?;
                } else {
                    for s in &t.samples {
                        r.chunk(b"01wb", |r| r.put(&s.data))?;
                    }
                }
            }
            Ok(())
        })?;
        let movi_end = r.bytes.len();
        r.chunk(b"idx1", |r| {
            let mut pos = movi_start + 4;
            let mut i = 0;
            while pos < movi_end {
                let id: [u8; 4] = r.bytes[pos..pos + 4].try_into().unwrap();
                let size = u32::from_le_bytes(r.bytes[pos + 4..pos + 8].try_into().unwrap());
                let key = id == *b"01wb" || video.is_some_and(|t| t.samples[i].key);
                r.put(&id)?;
                r.words(&[u32::from(key) << 4, (pos - movi_start) as u32, size])?;
                pos += 8 + size as usize + (size & 1) as usize;
                i += 1;
            }
            Ok(())
        })
    })?;
    Ok(out.bytes)
}
