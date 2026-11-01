// ADTS frame lengths include their seven- or nine-byte transport header.
pub(super) const RATES: [u32; 13] = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

pub(super) struct Frames<'a> {
    input: &'a [u8],
    pub rate: u32,
    pub channels: u8,
    pub object: u8,
}

impl<'a> Frames<'a> {
    pub fn new(input: &'a [u8]) -> Self {
        Self {
            input,
            rate: 44100,
            channels: 2,
            object: 2,
        }
    }
}

impl<'a> Iterator for Frames<'a> {
    type Item = &'a [u8];
    fn next(&mut self) -> Option<Self::Item> {
        while self.input.len() >= 7 {
            let input = self.input;
            if input[0] != 255 || input[1] & 0xf0 != 0xf0 {
                self.input = &input[1..];
                continue;
            }
            self.object = (input[2] >> 6) + 1;
            if let Some(rate) = RATES.get(usize::from(input[2] >> 2 & 15)) {
                self.rate = *rate;
            }
            let channels = (input[2] & 1) << 2 | input[3] >> 6;
            self.channels = if channels == 0 { 2 } else { channels };
            let header = if input[1] & 1 == 0 { 9 } else { 7 };
            let length = usize::from(input[3] & 3) << 11
                | usize::from(input[4]) << 3
                | usize::from(input[5] >> 5);
            if length <= header || length > input.len() {
                self.input = &[];
                break;
            }
            self.input = &input[length..];
            return Some(&input[header..length]);
        }
        None
    }
}

pub(super) fn silent(channels: u32) -> &'static [u8] {
    if channels == 1 {
        &[1, 64, 32, 7, 246, 0, 0]
    } else {
        &[33, 16, 4, 96, 140, 28]
    }
}
pub(super) struct Options {
    pub start: f64,
    pub end: Option<f64>,
    pub rate: Option<u32>,
    pub channels: Option<u32>,
    pub clear_samples: bool,
    pub strip_audio: bool,
    pub limit: usize,
}
impl Options {
    pub(super) fn encode<'a>(
        &self,
        rate: u32,
        channels: u32,
        samples: impl Iterator<Item = &'a [u8]>,
    ) -> Result<Vec<u8>, &'static str> {
        let rate = if self.strip_audio {
            44100
        } else {
            self.rate.unwrap_or(rate)
        };
        let channels = if self.strip_audio {
            2
        } else {
            self.channels.unwrap_or(channels)
        };
        let frequency = RATES.iter().position(|&r| r == rate).unwrap_or(4) as u8;
        let mut output = Vec::new();
        let mut append = |data: &[u8]| {
            let header = data.len() < 7 || data[0] != 255 || data[1] & 0xf0 != 0xf0;
            let len = data.len() + if header { 7 } else { 0 };
            if len > self.limit - output.len() {
                return Err("output byte limit exceeded");
            }
            if header {
                output.extend_from_slice(&[
                    255,
                    241,
                    64 | frequency << 2 | ((channels >> 2) & 1) as u8,
                    ((channels & 3) as u8) << 6 | (len >> 11) as u8 & 3,
                    (len >> 3) as u8,
                    (len as u8) << 5 | 31,
                    252,
                ]);
            }
            output.extend_from_slice(data);
            Ok(())
        };
        let mut written = false;
        if !self.clear_samples && !self.strip_audio {
            for data in samples {
                append(data)?;
                written = true;
            }
        }
        if !written {
            append(silent(channels))?
        }
        Ok(output)
    }
}
pub(super) fn remux(input: &[u8], opts: Options) -> Result<Vec<u8>, &'static str> {
    let mut frames = Frames::new(input);
    frames.by_ref().for_each(drop);
    let rate = f64::from(frames.rate);
    let start = (opts.start * rate).round() as u64;
    let end = opts.end.map_or(u64::MAX, |s| (s * rate).round() as u64);
    let samples = Frames::new(input)
        .enumerate()
        .take_while(|(index, _)| *index as u64 * 1024 < end)
        .filter(|(index, _)| end > start && (*index as u64 + 1) * 1024 > start)
        .map(|(_, data)| data);
    opts.encode(frames.rate, frames.channels.into(), samples)
}
