use super::super::{atoms, child, decoder_config, u16_at, u32_at};
use super::{Track, audio_specific_config, h264};

pub(super) fn write(
    tracks: &[Track<'_>],
    duration: f64,
    options: &super::Options,
) -> Result<Vec<u8>, &'static str> {
    let limit = options.limit;
    let video = tracks.iter().find(|t| t.kind == "video");
    let audio = tracks.iter().find(|t| t.kind == "audio");
    if limit < 13 {
        return Err("output byte limit exceeded");
    }
    let mut out = b"FLV\x01\x00\x00\x00\x00\x09\x00\x00\x00\x00".to_vec();
    out[4] = u8::from(video.is_some()) | (u8::from(audio.is_some()) << 2);
    let mut tag = |kind: u8, ms: u32, prefix: &[u8], payload: &[u8]| {
        let n = prefix.len().saturating_add(payload.len());
        if n.saturating_add(15) > limit - out.len() {
            return Err("output byte limit exceeded");
        }
        out.push(kind);
        out.extend_from_slice(&(n as u32).to_be_bytes()[1..]);
        out.extend_from_slice(&ms.to_be_bytes()[1..]);
        out.push((ms >> 24) as u8);
        out.extend_from_slice(&[0; 3]);
        out.extend_from_slice(prefix);
        out.extend_from_slice(payload);
        out.extend_from_slice(&(n as u32 + 11).to_be_bytes());
        Ok(())
    };
    let ms = |ticks: u64, scale: u32| {
        ((ticks as f64 / f64::from(scale.max(1)) * 1000.).round() as u64) as u32
    };
    if let Some(t) = video {
        let entry = atoms(t.stsd.get(8..).unwrap_or_default())
            .next()
            .map_or(&[][..], |(_, e)| e);
        let config = child(entry.get(78..).unwrap_or_default(), b"avcC");
        let generated;
        let config = if config.is_empty() {
            generated = h264::configuration(t.width as usize, t.height as usize, 30)?;
            &generated
        } else {
            config
        };
        tag(9, 0, &[0x17, 0, 0, 0, 0], config)?;
        let mut dts = t.first_dts;
        for s in &t.samples {
            let offset = (s.cts as f64 / f64::from(t.scale) * 1000. + 0.5).floor() as i64;
            let [_, a, b, c] = (offset as i32).to_be_bytes();
            tag(
                9,
                ms(dts, t.scale),
                &[if s.key { 0x17 } else { 0x27 }, 1, a, b, c],
                &s.data,
            )?;
            dts += u64::from(s.duration);
        }
        tag(
            9,
            (duration * 1000.).round() as u64 as u32,
            &[0x17, 2, 0, 0, 0],
            &[],
        )?;
    }
    if let Some(t) = audio {
        let entry = atoms(t.stsd.get(8..).unwrap_or_default())
            .next()
            .map_or(&[][..], |(_, e)| e);
        let offset = match u16_at(entry, 8) {
            1 => 44,
            2 => 64,
            _ => 28,
        };
        let channels = if entry.len() >= 18 {
            u32::from(u16_at(entry, 16))
        } else {
            2
        };
        let rate = if entry.len() >= 28 {
            u32_at(entry, 24) >> 16
        } else {
            44100
        };
        let channels = options.channels.unwrap_or(channels);
        let fallback = audio_specific_config(options.rate.unwrap_or(rate), channels, 2);
        let config = decoder_config(child(entry.get(offset..).unwrap_or_default(), b"esds"))
            .1
            .unwrap_or(&fallback);
        tag(8, 0, &[0xaf, 0], config)?;
        if options.clear_samples || t.samples.is_empty() {
            tag(
                8,
                0,
                &[0xaf, 1],
                super::super::super::adts::silent(channels),
            )?;
        } else {
            let mut dts = t.first_dts;
            for s in &t.samples {
                tag(8, ms(dts, t.scale), &[0xaf, 1], &s.data)?;
                dts += u64::from(s.duration);
            }
        }
    }
    Ok(out)
}
