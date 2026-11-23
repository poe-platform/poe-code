use super::{ffmpeg_pcm::Format, ffmpeg_wave::Wave};

pub(super) fn read(bytes: &[u8]) -> Result<Wave<'_>, &'static str> {
    let big = match bytes.get(..4) {
        Some(b"\x64\xa3\x01\0") => false,
        Some(b"\0\x01\xa3\x64") => true,
        _ => return Err("Invalid IRCAM header"),
    };
    if bytes.len() < 1024 {
        return Err("Invalid IRCAM header");
    }
    let word = |i| {
        let value = bytes[i..i + 4].try_into().unwrap();
        if big {
            u32::from_be_bytes(value)
        } else {
            u32::from_le_bytes(value)
        }
    };
    let rate = f32::from_bits(word(4));
    let format = match word(12) {
        2 => Format::Signed(16, big),
        4 => Format::Float(32, big),
        0x10001 => Format::Alaw,
        0x20001 => Format::Mulaw,
        _ => return Err("Unsupported IRCAM audio encoding"),
    };
    if !rate.is_finite() || rate < 1. || rate.fract() != 0. || f64::from(rate) > f64::from(u32::MAX)
    {
        return Err("Invalid raw audio sample rate or channel count");
    }
    let mut wave = Wave::raw(format, &bytes[1024..], rate as u32, word(8))?;
    wave.data_pos = 1024;
    wave.packet_frames = Some((wave.rate as usize / 25).clamp(1, 1024));
    Ok(wave)
}

pub(super) fn encoding(format: Format) -> Result<u32, String> {
    match format {
        Format::Signed(16, false) => Ok(2),
        Format::Alaw => Ok(0x10001),
        Format::Mulaw => Ok(0x20001),
        _ => Err(format!(
            "Unsupported IRCAM audio codec 'pcm_{}'",
            format.name()
        )),
    }
}

pub(super) fn write(
    format: Format,
    rate: u32,
    channels: usize,
    data: &[u8],
    limit: usize,
) -> Result<Vec<u8>, String> {
    let encoding = encoding(format)?;
    let size = data
        .len()
        .checked_add(1024)
        .filter(|&size| size <= limit)
        .ok_or("audio output exceeds memory budget")?;
    let mut out = vec![0; size];
    for (i, word) in [
        0x0001a364,
        (rate as f32).to_bits(),
        channels as u32,
        encoding,
    ]
    .into_iter()
    .enumerate()
    {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out[1024..].copy_from_slice(data);
    Ok(out)
}
