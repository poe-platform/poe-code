use super::super::js_number;
use super::{ffmpeg_pcm::Format, ffmpeg_wave::Wave};

pub(super) struct Document<'a> {
    pub wave: Wave<'a>,
    pub tags: Vec<(String, String)>,
}

impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        let offset = js_number(
            &String::from_utf8_lossy(bytes.get(8..16).unwrap_or_default()),
            0.,
        );
        if bytes.len() < 16
            || !offset.is_finite()
            || offset.fract() != 0.
            || offset < 1024.
            || offset > bytes.len() as f64
        {
            return Err("Invalid NIST SPHERE header length");
        }
        let offset = offset as usize;
        if offset > limit / 2 {
            return Err("NIST SPHERE header exceeds memory budget");
        }
        let mut fields: Vec<(String, String)> = Vec::new();
        let mut ended = false;
        for line in String::from_utf8_lossy(&bytes[16..offset]).split('\n') {
            if line.trim() == "end_head" {
                ended = true;
                break;
            }
            let (name, field) = line
                .split_once(' ')
                .filter(|(name, _)| !name.is_empty())
                .ok_or("Invalid NIST SPHERE header field")?;
            let (kind, value) = field
                .trim_start()
                .split_once(' ')
                .ok_or("Invalid NIST SPHERE header field")?;
            let value = value.trim_start();
            let value = if let Some(length) = kind.strip_prefix("-s") {
                let length = js_number(length, 0.);
                if !length.is_finite()
                    || length.fract() != 0.
                    || length < 0.
                    || length > value.encode_utf16().count() as f64
                {
                    return Err("Invalid NIST SPHERE string length");
                }
                String::from_utf16_lossy(
                    &value
                        .encode_utf16()
                        .take(length as usize)
                        .collect::<Vec<_>>(),
                )
            } else if matches!(kind, "-i" | "-r") {
                value.trim().to_string()
            } else {
                return Err("Invalid NIST SPHERE header field");
            };
            if let Some((_, previous)) = fields.iter_mut().find(|(key, _)| key == name) {
                *previous = value;
            } else {
                fields.push((name.into(), value));
            }
        }
        if !ended {
            return Err("Missing NIST SPHERE end_head");
        }
        let field = |name| {
            fields
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        };
        let number = |name| field(name).map_or(f64::NAN, |s| js_number(s, 0.));
        let order = field("sample_byte_format");
        if field("sample_coding").unwrap_or("pcm") != "pcm"
            || number("sample_n_bytes") != 2.
            || !matches!(order, Some("01" | "10"))
        {
            return Err("Unsupported NIST SPHERE audio encoding (requires PCM16)");
        }
        let count = number("sample_count");
        if !count.is_finite()
            || count.fract() != 0.
            || !(0. ..=9_007_199_254_740_991.).contains(&count)
        {
            return Err("Invalid NIST SPHERE sample count");
        }
        let rate = number("sample_rate");
        let channels = number("channel_count");
        if !rate.is_finite()
            || rate.fract() != 0.
            || !(1. ..=f64::from(u32::MAX)).contains(&rate)
            || !channels.is_finite()
            || channels.fract() != 0.
            || !(1. ..=65535.).contains(&channels)
        {
            return Err("Invalid raw audio sample rate or channel count");
        }
        let mut wave = Wave::raw(
            Format::Signed(16, order == Some("10")),
            &bytes[offset..],
            rate as u32,
            channels as u32,
        )?;
        wave.data_pos = offset;
        wave.fact = Some(count as u64);
        fields.retain(|(name, _)| {
            !matches!(
                name.as_str(),
                "channel_count"
                    | "sample_count"
                    | "sample_rate"
                    | "sample_n_bytes"
                    | "sample_sig_bits"
                    | "sample_byte_format"
                    | "sample_coding"
            )
        });
        Ok(Self { wave, tags: fields })
    }
}
