// ADTS frame lengths include their seven- or nine-byte transport header.
const RATES: [u32; 13] = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

pub(super) struct Frames<'a> {
    input: &'a [u8],
    pub rate: u32,
    pub channels: u8,
}

impl<'a> Frames<'a> {
    pub fn new(input: &'a [u8]) -> Self {
        Self {
            input,
            rate: 44100,
            channels: 2,
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

pub(super) fn remux(
    input: &[u8],
    start: f64,
    end: Option<f64>,
    rate: Option<u32>,
    channels: Option<u32>,
    clear_samples: bool,
    strip_audio: bool,
) -> Vec<u8> {
    let mut frames = Frames::new(input);
    frames.by_ref().for_each(drop);
    let orig_rate = frames.rate;
    let rate = if strip_audio {
        44100
    } else {
        rate.unwrap_or(orig_rate)
    };
    let channels = if strip_audio {
        2
    } else {
        channels.unwrap_or(frames.channels.into())
    };
    let frequency = RATES.iter().position(|&r| r == rate).unwrap_or(4) as u8;
    let mut output = Vec::new();
    let mut append = |data: &[u8]| {
        if data.len() < 7 || data[0] != 255 || data[1] & 0xf0 != 0xf0 {
            let len = data.len() + 7;
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
    };
    let mut written = false;
    if !clear_samples && !strip_audio {
        let start = (start * f64::from(orig_rate)).round() as u64;
        let end = end.map_or(u64::MAX, |s| (s * f64::from(orig_rate)).round() as u64);
        if end > start {
            for (index, data) in Frames::new(input).enumerate() {
                let pts = index as u64 * 1024;
                if pts >= end {
                    break;
                }
                if pts + 1024 > start {
                    append(data);
                    written = true;
                }
            }
        }
    }
    if !written {
        append(if channels == 1 {
            &[1, 64, 32, 7, 246, 0, 0]
        } else {
            &[33, 16, 4, 96, 140, 28]
        });
    }
    output
}
