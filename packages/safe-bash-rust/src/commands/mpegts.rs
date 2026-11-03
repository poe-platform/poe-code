use super::super::super::adts;
use super::super::{Original, atoms, h264};
use super::{Options, Track};

type Result<T> = std::result::Result<T, &'static str>;
struct Writer {
    out: Vec<u8>,
    limit: usize,
}
impl Writer {
    fn packet(&mut self, pid: u16, flags: u8, control: u8) -> Result<&mut [u8]> {
        if self.limit - self.out.len() < 188 {
            return Err("output byte limit exceeded");
        }
        let start = self.out.len();
        self.out.resize(start + 188, 0xff);
        let pkt = &mut self.out[start..];
        pkt[..4].copy_from_slice(&[0x47, flags | (pid >> 8) as u8, pid as u8, control]);
        Ok(pkt)
    }
    fn section(&mut self, pid: u16, data: &[u8]) -> Result<()> {
        let pkt = self.packet(pid, 0x40, 0x10)?;
        pkt[4] = 0;
        pkt[5..5 + data.len()].copy_from_slice(data);
        let mut crc = u32::MAX;
        for &byte in data {
            crc ^= u32::from(byte) << 24;
            for _ in 0..8 {
                crc = (crc << 1) ^ if crc >> 31 != 0 { 0x04c11db7 } else { 0 };
            }
        }
        pkt[5 + data.len()..9 + data.len()].copy_from_slice(&crc.to_be_bytes());
        Ok(())
    }
    // Size the PES first so each transport packet can be filled directly from the
    // access unit, including its framing bytes, without copying the whole sample.
    fn pes<'a>(
        &mut self,
        cc: &mut u8,
        video: bool,
        pts: i64,
        dts: i64,
        pcr: bool,
        payload: impl Iterator<Item = &'a [u8]> + Clone,
    ) -> Result<()> {
        let timed = pts != dts;
        let mut header = [0u8; 19];
        let hlen = if timed { 19 } else { 14 };
        let total = payload
            .clone()
            .try_fold(hlen, |n: usize, p| n.checked_add(p.len()))
            .ok_or("output byte limit exceeded")?;
        let len = u16::try_from(total - 6).unwrap_or(0);
        header[..9].copy_from_slice(&[
            0,
            0,
            1,
            if video { 0xe0 } else { 0xc0 },
            (len >> 8) as u8,
            len as u8,
            0x80,
            if timed { 0xc0 } else { 0x80 },
            (hlen - 9) as u8,
        ]);
        let ts = |prefix: u8, n: i64| {
            let n = n.max(0) as u64;
            [
                prefix << 4 | ((n >> 30) as u8 & 7) << 1 | 1,
                (n >> 22) as u8,
                ((n >> 15) as u8) << 1 | 1,
                (n >> 7) as u8,
                (n as u8) << 1 | 1,
            ]
        };
        header[9..14].copy_from_slice(&ts(if timed { 3 } else { 2 }, pts));
        if timed {
            header[14..19].copy_from_slice(&ts(1, dts));
        }
        let mut parts = payload;
        let mut part = &header[..hlen];
        let mut left = total;
        while left > 0 {
            let first = left == total;
            let clock = first && pcr;
            let size = left.min(if clock { 176 } else { 184 });
            let pad = 184 - size;
            let pkt = self.packet(
                if video { 256 } else { 257 },
                if first { 0x40 } else { 0 },
                (if pad == 0 { 0x10 } else { 0x30 }) | *cc,
            )?;
            *cc = (*cc + 1) & 15;
            if pad > 0 {
                pkt[4] = (pad - 1) as u8;
            }
            if pad > 1 {
                pkt[5] = if clock {
                    0x50
                } else if first {
                    0x40
                } else {
                    0
                };
            }
            if clock {
                let base = dts.max(0) as u64;
                pkt[6..12].copy_from_slice(&[
                    (base >> 25) as u8,
                    (base >> 17) as u8,
                    (base >> 9) as u8,
                    (base >> 1) as u8,
                    (base as u8) << 7 | 0x7e,
                    0,
                ]);
            }
            let mut out = &mut pkt[4 + pad..];
            while !out.is_empty() {
                if part.is_empty() {
                    part = parts.next().expect("PES payload length");
                    continue;
                }
                let n = part.len().min(out.len());
                out[..n].copy_from_slice(&part[..n]);
                part = &part[n..];
                out = &mut out[n..];
            }
            left -= size;
        }
        Ok(())
    }
}
pub(super) fn write(
    tracks: &[Track<'_>],
    opts: &Options,
    originals: &[Original<'_>],
) -> Result<Vec<u8>> {
    let mut w = Writer {
        out: vec![],
        limit: opts.limit,
    };
    let find = |kind| tracks.iter().zip(originals).find(|(t, _)| t.kind == kind);
    let video = find("video");
    let audio = find("audio");
    w.section(0, &[0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0])?;
    let mut pmt = vec![
        2,
        0xb0,
        13,
        0,
        1,
        0xc1,
        0,
        0,
        0xe1,
        u8::from(video.is_none()),
        0xf0,
        0,
    ];
    if video.is_some() {
        pmt.extend_from_slice(&[0x1b, 0xe1, 0, 0xf0, 0]);
        pmt[2] += 5;
    }
    if audio.is_some() {
        pmt.extend_from_slice(&[0x0f, 0xe1, 1, 0xf0, 0]);
        pmt[2] += 5;
    }
    w.section(4096, &pmt)?;
    let time = |ticks: i128, scale: u32| {
        ((ticks as f64 / f64::from(scale.max(1))) * 90000. + 0.5).floor() as i64
    };
    if let Some((t, original)) = video {
        let entry = atoms(t.stsd.get(8..).unwrap_or_default())
            .next()
            .map_or(&[][..], |(_, e)| e);
        let width = original.avi().map_or(i64::from(t.width), |a| a.width);
        let defaults = h264::configuration(width, t.height, 30)?;
        let annex = h264::AnnexB::new(original.avcc(entry).unwrap_or_default(), &defaults);
        let mut dts = t.first_dts;
        let mut source = original.timestamps(true);
        let mut cc = 0;
        for (i, s) in t.samples.iter().enumerate() {
            let ticks = i128::from(source.next().unwrap_or(dts));
            let init = i == 0 || s.key;
            w.pes(
                &mut cc,
                true,
                time(ticks + i128::from(s.cts), t.scale),
                time(ticks, t.scale),
                init,
                std::iter::once([0, 0, 0, 1, 9, 0xf0].as_slice()).chain(annex.parts(&s.data, init)),
            )?;
            dts += u64::from(s.duration);
        }
    }
    if let Some((t, original)) = audio {
        let (rate, ch) = t.audio_format(t.scale);
        let (rate, ch) = (opts.rate.unwrap_or(rate), opts.channels.unwrap_or(ch));
        let mut cc = 0;
        let mut frame = |data: &[u8], pts: i64| {
            let header = adts::frame_header(data, rate, ch);
            w.pes(
                &mut cc,
                false,
                pts,
                pts,
                video.is_none(),
                header
                    .as_slice()
                    .iter()
                    .map(|b| b.as_slice())
                    .chain(std::iter::once(data)),
            )
        };
        if opts.clear_samples || t.samples.is_empty() {
            frame(adts::silent(ch), 0)?;
        } else {
            let mut source = original.timestamps(false);
            let mut dts = t.first_dts;
            for s in &t.samples {
                frame(
                    &s.data,
                    time(
                        i128::from(source.next().unwrap_or(dts)) + i128::from(s.cts),
                        t.scale,
                    ),
                )?;
                dts += u64::from(s.duration);
            }
        }
    }
    Ok(w.out)
}
