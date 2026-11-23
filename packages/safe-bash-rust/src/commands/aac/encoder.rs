use super::{Result, codebooks, common::GASubbandInfo};
use std::f64::consts::{PI, TAU};

struct Writer {
    bytes: Vec<u8>,
    bits: usize,
}
impl Writer {
    fn put(&mut self, value: u32, count: u8) {
        for shift in (0..count).rev() {
            if self.bits % 8 == 0 {
                self.bytes.push(0);
            }
            self.bytes[self.bits / 8] |= ((value >> shift & 1) as u8) << (7 - self.bits % 8);
            self.bits += 1;
        }
    }
    fn escape(&mut self, value: u32) {
        if value < 16 {
            return;
        }
        let width = (31 - value.leading_zeros()) as u8;
        self.put((1 << (width - 4)) - 1, width - 4);
        self.put(0, 1);
        self.put(value - (1 << width), width);
    }
}

// A modulated 2048-point FFT evaluates the half-bin frequencies of the
// forward MDCT. The sine window and one-hop history give 1024 samples of
// encoder delay; a final zero hop flushes the overlap, including partial input.
struct Analysis {
    window: Vec<f64>,
    rotation: Vec<(f64, f64)>,
    twiddle: Vec<(f64, f64)>,
    buffer: Vec<(f64, f64)>,
}
impl Analysis {
    fn new() -> Self {
        Self {
            window: (0..2048)
                .map(|n| (PI / 2048. * (n as f64 + 0.5)).sin())
                .collect(),
            rotation: (0..2048)
                .map(|n| {
                    let a = -PI / 2048. * n as f64;
                    (a.cos(), a.sin())
                })
                .collect(),
            twiddle: (0..1024)
                .map(|n| {
                    let a = -TAU / 2048. * n as f64;
                    (a.cos(), a.sin())
                })
                .collect(),
            buffer: vec![(0., 0.); 2048],
        }
    }
    fn transform(
        &mut self,
        history: &mut [f64; 1024],
        pcm: &[u8],
        channel: usize,
        channels: usize,
    ) -> [f64; 1024] {
        for n in 0..2048usize {
            let sample = if n < 1024 {
                history[n]
            } else {
                let at = ((n - 1024) * channels + channel) * 4;
                let x = pcm
                    .get(at..at + 4)
                    .map_or(0., |b| f64::from(f32::from_le_bytes(b.try_into().unwrap())));
                history[n - 1024] = x;
                x
            };
            let x = sample * self.window[n] * 65536.;
            let (re, im) = self.rotation[n];
            self.buffer[n.reverse_bits() >> (usize::BITS - 11)] = (x * re, x * im);
        }
        let mut width = 2;
        while width <= 2048 {
            for start in (0..2048).step_by(width) {
                for j in 0..width / 2 {
                    let (wr, wi) = self.twiddle[j * 2048 / width];
                    let (br, bi) = self.buffer[start + j + width / 2];
                    let (ar, ai) = self.buffer[start + j];
                    let (tr, ti) = (br * wr - bi * wi, br * wi + bi * wr);
                    self.buffer[start + j] = (ar + tr, ai + ti);
                    self.buffer[start + j + width / 2] = (ar - tr, ai - ti);
                }
            }
            width *= 2;
        }
        std::array::from_fn(|k| {
            let phase = -PI / 1024. * 512.5 * (k as f64 + 0.5);
            let (re, im) = self.buffer[k];
            re * phase.cos() - im * phase.sin()
        })
    }
}

fn pair_index(pair: &[i32], book: usize) -> usize {
    match book {
        5 | 6 => ((pair[0] + 4) * 9 + pair[1] + 4) as usize,
        7 | 8 => (pair[0].unsigned_abs() * 8 + pair[1].unsigned_abs()) as usize,
        9 | 10 => (pair[0].unsigned_abs() * 13 + pair[1].unsigned_abs()) as usize,
        _ => (pair[0].unsigned_abs().min(16) * 17 + pair[1].unsigned_abs().min(16)) as usize,
    }
}

fn channel(w: &mut Writer, spectrum: &[f64; 1024], bands: &[usize], offset: i32) -> Option<f64> {
    let mut error = 0.;
    let mut quant = [0i32; 1024];
    let mut scales = [0u8; 64];
    let mut books = [0usize; 64];
    let mut costs = [[usize::MAX / 4; 12]; 64];
    let frame_peak = spectrum.iter().fold(0f64, |a, x| a.max(x.abs()));
    let mut previous = None;
    for (b, edges) in bands.windows(2).enumerate() {
        costs[b][0] = 0;
        let peak = spectrum[edges[0]..edges[1]]
            .iter()
            .fold(0f64, |a, x| a.max(x.abs()));
        // Give louder bands more precision. A common offset reduces precision
        // across the frame until its spectral payload fits the bitrate budget.
        let target = if frame_peak == 0. {
            0.
        } else {
            128. * (peak / frame_peak).sqrt()
        };
        if target < 0.5 {
            error += spectrum[edges[0]..edges[1]]
                .iter()
                .map(|x| x * x)
                .sum::<f64>();
            continue;
        }
        let mut scale = ((100. + 4. * peak.log2() - 16. / 3. * target.log2()).round() as i32
            + offset)
            .clamp(0, 255);
        if let Some(last) = previous {
            scale = scale.clamp(last - 60, last + 60);
        }
        let gain = 2f64.powf((100 - scale) as f64 * 0.1875);
        for n in edges[0]..edges[1] {
            let q = (spectrum[n].abs().powf(0.75) * gain + 0.4054).floor();
            if q > 8191. {
                return None;
            }
            let reconstructed = q.powf(4. / 3.) * 2f64.powf((scale - 100) as f64 * 0.25);
            error += (spectrum[n].abs() - reconstructed).powi(2);
            quant[n] = if spectrum[n] < 0. {
                -(q as i32)
            } else {
                q as i32
            };
        }
        let q = &quant[edges[0]..edges[1]];
        let max = q.iter().map(|n| n.unsigned_abs()).max().unwrap_or(0);
        if max == 0 {
            continue;
        }
        books[b] = 11;
        costs[b][0] = usize::MAX / 4;
        for book in (5..=11).filter(|&book| {
            max <= match book {
                5 | 6 => 4,
                7 | 8 => 7,
                9 | 10 => 12,
                _ => 8191,
            }
        }) {
            let table = &codebooks::SPECTRUM_TABLES[book - 1];
            costs[b][book] = q
                .chunks_exact(2)
                .map(|pair| {
                    usize::from(table.lens[pair_index(pair, book)])
                        + if book < 7 {
                            0
                        } else {
                            pair.iter()
                                .map(|q| {
                                    let a = q.unsigned_abs();
                                    usize::from(a != 0)
                                        + if book == 11 && a >= 16 {
                                            (2 * (31 - a.leading_zeros()) - 3) as usize
                                        } else {
                                            0
                                        }
                                })
                                .sum::<usize>()
                        }
                })
                .sum::<usize>();
        }
        scales[b] = scale as u8;
        previous = Some(scale);
    }
    let max_sfb = books.iter().rposition(|&x| x != 0).map_or(0, |b| b + 1);
    // Include section headers in codebook selection; independently choosing the
    // shortest band codes can lose more bits to new sections than it saves.
    let mut best = [usize::MAX / 4; 65];
    let mut next = [(0, 0); 64];
    best[max_sfb] = 0;
    for start in (0..max_sfb).rev() {
        for book in [0, 5, 6, 7, 8, 9, 10, 11] {
            let mut bits = 0;
            for end in start..max_sfb {
                if costs[end][book] == usize::MAX / 4 {
                    break;
                }
                bits += costs[end][book];
                let total = bits + 9 + (end + 1 - start) / 31 * 5 + best[end + 1];
                if total < best[start] {
                    best[start] = total;
                    next[start] = (end + 1, book);
                }
            }
        }
    }
    let mut at = 0;
    while at < max_sfb {
        let (end, book) = next[at];
        books[at..end].fill(book);
        at = end;
    }
    let global = scales[..max_sfb]
        .iter()
        .zip(&books)
        .find(|(_, b)| **b != 0)
        .map_or(100, |(s, _)| *s);
    w.put(u32::from(global), 8);
    w.put(0, 4); // reserved, ONLY_LONG_SEQUENCE, sine window
    w.put(max_sfb as u32, 6);
    w.put(0, 1); // predictor_data_present
    let mut b = 0;
    while b < max_sfb {
        let end = (b + 1..max_sfb)
            .find(|&i| books[i] != books[b])
            .unwrap_or(max_sfb);
        w.put(books[b] as u32, 4);
        let mut length = end - b;
        while length >= 31 {
            w.put(31, 5);
            length -= 31;
        }
        w.put(length as u32, 5);
        b = end;
    }
    let mut previous = i32::from(global);
    for b in 0..max_sfb {
        if books[b] != 0 {
            let delta = (i32::from(scales[b]) - previous + 60) as usize;
            w.put(
                codebooks::SCF_CODEBOOK_CODES[delta],
                codebooks::SCF_CODEBOOK_LENS[delta],
            );
            previous = i32::from(scales[b]);
        }
    }
    w.put(0, 3); // pulse, TNS, gain control
    for b in 0..max_sfb {
        if books[b] == 0 {
            continue;
        }
        for pair in quant[bands[b]..bands[b + 1]].chunks_exact(2) {
            let a = pair[0].unsigned_abs();
            let book = books[b];
            let table = &codebooks::SPECTRUM_TABLES[book - 1];
            let index = pair_index(pair, book);
            w.put(table.codes[index], table.lens[index]);
            if book >= 7 {
                for &q in pair {
                    if q != 0 {
                        w.put(u32::from(q < 0), 1);
                    }
                }
            }
            if book == 11 {
                w.escape(a);
                w.escape(pair[1].unsigned_abs());
            }
        }
    }
    Some(error)
}

pub(in super::super) fn encode(
    pcm: &[u8],
    rate: u32,
    channels: u32,
    bitrate: Option<&str>,
    limit: usize,
) -> Result<Vec<Vec<u8>>> {
    if !super::super::adts::RATES.contains(&rate) || !(1..=2).contains(&channels) {
        return Err("AAC encoding requires a supported sample rate and mono or stereo PCM");
    }
    if pcm.len() % (channels as usize * 4) != 0
        || pcm
            .chunks_exact(4)
            .any(|b| !f32::from_le_bytes(b.try_into().unwrap()).is_finite())
    {
        return Err("Invalid AAC PCM samples");
    }
    let bitrate = if let Some(value) = bitrate {
        let (value, multiplier) =
            if let Some(s) = value.strip_suffix('k').or_else(|| value.strip_suffix('K')) {
                (s, 1000.)
            } else if let Some(s) = value.strip_suffix('M') {
                (s, 1_000_000.)
            } else {
                (value, 1.)
            };
        let rate = value.parse::<f64>().map_err(|_| "Invalid AAC bitrate")? * multiplier;
        if !rate.is_finite() || rate <= 0. || rate > u32::MAX as f64 {
            return Err("Invalid AAC bitrate");
        }
        rate as u32
    } else {
        channels * 64000
    };
    let budget = ((u64::from(bitrate) * 1024 / u64::from(rate) / 8) as usize)
        .clamp(16 * channels as usize, 768 * channels as usize);
    let channels = channels as usize;
    let count = pcm.len().div_ceil(channels * 4096) + usize::from(!pcm.is_empty());
    // FFT state, histories, spectra, quantizer and two bounded frame buffers.
    let mut remaining = limit
        .checked_sub(160 * 1024 + count * size_of::<Vec<u8>>())
        .ok_or("AAC encoder exceeds memory budget")?;
    let mut packets = Vec::new();
    packets
        .try_reserve_exact(count)
        .map_err(|_| "AAC encoder exceeds memory budget")?;
    let mut analysis = Analysis::new();
    let mut history = vec![[0.; 1024]; channels];
    let bands = GASubbandInfo::find(rate).long_bands;
    for frame in 0..count {
        let start = (frame * 4096 * channels).min(pcm.len());
        let input = &pcm[start..(start + 4096 * channels).min(pcm.len())];
        let spectra: Vec<_> = (0..channels)
            .map(|c| analysis.transform(&mut history[c], input, c, channels))
            .collect();
        let mut selected = None;
        let mut best_error = f64::INFINITY;
        let mut first_fit = None;
        for offset in 0..=160 {
            let mut w = Writer {
                bytes: Vec::new(),
                bits: 0,
            };
            w.put(if channels == 2 { 1 } else { 0 }, 3);
            w.put(0, 4); // element instance tag
            if channels == 2 {
                w.put(0, 1);
            } // separate channel windows
            let error = spectra.iter().try_fold(0., |sum, s| {
                channel(&mut w, s, bands, offset).map(|e| sum + e)
            });
            w.put(7, 3); // ID_END; last byte is already zero-padded
            if let Some(error) = error
                && w.bytes.len() <= budget
            {
                first_fit.get_or_insert(offset);
                if error < best_error {
                    best_error = error;
                    selected = Some(w.bytes);
                }
            }
            if first_fit.is_some_and(|first| offset >= first + 4) {
                break;
            }
        }
        let bytes = selected.ok_or("AAC frame cannot fit bitrate")?;
        remaining = remaining
            .checked_sub(bytes.capacity())
            .ok_or("AAC packets exceed memory budget")?;
        packets.push(bytes);
    }
    Ok(packets)
}
