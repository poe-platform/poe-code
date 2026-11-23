pub(super) fn layout_name(mask: u32) -> Option<&'static str> {
    match mask {
        0x4 => Some("mono"),
        0x3 => Some("stereo"),
        0x60000000 => Some("downmix"),
        0xb => Some("2.1"),
        0x7 => Some("3.0"),
        0x103 => Some("3.0(back)"),
        0x107 => Some("4.0"),
        0x33 => Some("quad"),
        0x603 => Some("quad(side)"),
        0xf => Some("3.1"),
        0x37 => Some("5.0"),
        0x607 => Some("5.0(side)"),
        0x10f => Some("4.1"),
        0x3f => Some("5.1"),
        0x60f => Some("5.1(side)"),
        0x707 => Some("6.0"),
        0x6c3 => Some("6.0(front)"),
        0x500f => Some("3.1.2"),
        0x137 => Some("hexagonal"),
        0x70f => Some("6.1"),
        0x13f => Some("6.1(back)"),
        0x6cb => Some("6.1(front)"),
        0x637 => Some("7.0"),
        0x6c7 => Some("7.0(front)"),
        0x63f => Some("7.1"),
        0xff => Some("7.1(wide)"),
        0x6cf => Some("7.1(wide-side)"),
        0x503f => Some("5.1.2"),
        0x737 => Some("octagonal"),
        0x2d033 => Some("cube"),
        0x2d03f => Some("5.1.4"),
        0x563f => Some("7.1.2"),
        0x2d63f => Some("7.1.4"),
        0x2d6ff => Some("9.1.4"),
        _ => None,
    }
}

const SPEAKERS: &[&str] = &["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR", "", "", "", "", "", "", "", "", "", "", "", "DL", "DR", "WL", "WR", "SDL", "SDR", "LFE2", "TSL", "TSR", "BFC", "BFL", "BFR", "SSL", "SSR", "TTL", "TTR"];

pub(super) fn order_mask(order: &[u16]) -> u32 {
    if order.windows(2).any(|pair| pair[0] >= pair[1]) { return 0; }
    order.iter().try_fold(0, |mask, &speaker| 1u32.checked_shl(u32::from(speaker)).map(|bit| mask | bit)).unwrap_or(0)
}

pub(super) fn describe_order(order: &[u16]) -> Option<String> {
    if order.is_empty() { return None; }
    if let Some(name) = layout_name(order_mask(order)) { return Some(name.into()); }
    let names = order.iter().map(|&speaker| match speaker {
        0x300 => "UNK".into(), u16::MAX => "UNSD".into(),
        0x400..=0x7ff => format!("AMBI{}", speaker - 0x400),
        _ => SPEAKERS.get(usize::from(speaker)).filter(|name| !name.is_empty()).map_or_else(|| format!("USR{speaker}"), |name| (*name).into()),
    }).collect::<Vec<String>>();
    Some(format!("{} channels ({})", order.len(), names.join("+")))
}

pub(super) fn describe_layout(mask: u32) -> Option<String> {
    if mask == 0 || mask >= 0x40000 { return None; }
    if let Some(name) = layout_name(mask) { return Some(name.into()); }
    let channels = SPEAKERS[..18].iter().enumerate().filter_map(|(i, name)| (mask & (1 << i) != 0).then_some(*name)).collect::<Vec<_>>();
    Some(format!("{} channels ({})", channels.len(), channels.join("+")))
}

// WAVE speaker bits, in interleaved sample order: FL FR FC LFE BL BR FLC FRC BC SL SR.
pub(super) fn default_mask(channels: usize) -> u32 {
    match channels {
        1 => 4,
        2 => 3,
        3 => 0xb,
        4 => 0x107,
        5 => 0x37,
        6 => 0x3f,
        7 => 0x70f,
        8 => 0x63f,
        _ => 0,
    }
}

pub(super) fn matrix(
    input: u32,
    output: u32,
    normalize: bool,
) -> Result<[[f64; 32]; 8], &'static str> {
    if input == 0
        || input & 7 == 0
        || output & 7 == 0
        || [(0, 1), (4, 5), (6, 7), (9, 10), (12, 14)].iter()
            .any(|&(left, right)| ((input >> left) ^ (input >> right)) & 1 != 0)
        || output == 0
        || output & !0x7ff != 0
        || output.count_ones() > 8
    {
        return Err("PCM conversion between these channel layouts is not supported");
    }
    let q = std::f64::consts::FRAC_1_SQRT_2;
    // SWR exposes the center/surround mix levels as float options.
    let level = f64::from(std::f32::consts::FRAC_1_SQRT_2);
    let has = |mask, speaker| mask & (1u32 << speaker) != 0;
    let mut named = [[0.; 32]; 32];
    for source in 0..32 {
        if !has(input, source) {
            continue;
        }
        let mut send = |target: usize, weight: f64| {
            named[target][source] += weight;
        };
        if has(output, source) {
            send(source, 1.);
            continue;
        }
        match source {
            3 => {} // The default mix discards LFE when the destination has none.
            2 if output & 3 == 3 => {
                let weight = if input & 3 != 0 { level } else { q };
                send(0, weight);
                send(1, weight);
            }
            0 | 1 if has(output, 2) => send(2, q),
            6 | 7 if output & 3 == 3 => send(source - 6, 1.),
            6 | 7 if has(output, 2) => send(2, q),
            8 => {
                let pair = if has(output, 4) {
                    4
                } else if has(output, 9) {
                    9
                } else {
                    0
                };
                if has(output, pair) && has(output, pair + 1) {
                    let weight = if pair == 0 { level * q } else { q };
                    send(pair, weight);
                    send(pair + 1, weight);
                } else if has(output, 2) {
                    send(2, level * q);
                } else {
                    return Err("Unsupported back-center channel mix");
                }
            }
            4 | 5 | 9 | 10 => {
                let side = source >= 9;
                let pair = if side { 9 } else { 4 };
                let other = if side { 4 } else { 9 };
                let offset = source - pair;
                if !side && has(output, 8) {
                    send(8, q);
                } else if has(output, other) {
                    send(other + offset, if has(input, other) { q } else { 1. });
                } else if has(output, 8) {
                    send(8, q);
                } else if output & 3 == 3 {
                    send(offset, level);
                } else if has(output, 2) {
                    send(2, level * q);
                } else {
                    return Err("Unsupported surround channel mix");
                }
            }
            12 | 14 => {
                let side = usize::from(source == 14);
                if output & 3 == 3 { send(side, if input & 3 != 0 { q } else { 1. }); }
                else if has(output, 2) { send(2, q); }
                else { return Err("Unsupported height channel mix"); }
            }
            11 | 13 | 15..=31 => {},
            _ => return Err("PCM conversion between these channel layouts is not supported"),
        }
    }
    if input & 7 == 7 && output & 3 == 0 && has(output, 2) {
        named[2][2] = level * std::f64::consts::SQRT_2;
    }
    let mut weights = [[0.; 32]; 8];
    for (row, target) in (0..32).filter(|&i| has(output, i)).enumerate() {
        for (column, source) in (0..32).filter(|&i| has(input, i)).enumerate() {
            weights[row][column] = named[target][source];
        }
    }
    if normalize {
        let peak = weights
            .iter()
            .map(|row| row.iter().sum::<f64>())
            .fold(1., f64::max);
        for weight in weights.iter_mut().flatten() {
            *weight /= peak;
        }
    }
    Ok(weights)
}

pub(super) fn mix(
    input: &[Vec<f32>],
    weights: &[[f64; 32]; 8],
    channels: usize,
    integer: bool,
    surround_stereo: bool,
    limit: usize,
) -> Result<Vec<Vec<f32>>, &'static str> {
    let frames = input[0].len();
    let retained = input.iter().map(|ch| ch.capacity()).sum::<usize>();
    frames
        .checked_mul(channels)
        .and_then(|n| n.checked_add(retained))
        .filter(|&n| n <= limit / 4)
        .ok_or("audio mixing exceeds memory budget")?;
    let mut output = vec![vec![0.; frames]; channels];
    let mut center = [0; 2];
    for (ordinal, (row, out)) in weights.iter().zip(&mut output).enumerate() {
        let contributors = row.iter().filter(|&&v| v != 0.).count();
        let mut fixed = [0i64; 32];
        let mut error = 0.;
        for (i, &weight) in row.iter().enumerate().take(input.len()) {
            let target = weight * 32768.
                + if contributors <= 2 || surround_stereo {
                    error
                } else {
                    0.
                };
            fixed[i] = (target as f32).round_ties_even() as i64;
            error += target - fixed[i] as f64;
        }
        if surround_stereo {
            if ordinal == 0 {
                center.copy_from_slice(&fixed[2..4]);
            } else {
                fixed[2..4].copy_from_slice(&center);
            }
        }
        for (frame, value) in out.iter_mut().enumerate() {
            if integer {
                let sum = input
                    .iter()
                    .enumerate()
                    .filter(|&(i, _)| {
                        if surround_stereo {
                            i == 2 || i == 3 || i % 2 == ordinal
                        } else {
                            row[i] != 0.
                        }
                    })
                    .map(|(i, ch)| (ch[frame] * 32768.) as i64 * fixed[i])
                    .sum::<i64>();
                let rounded = (sum + 16384) >> 15;
                // SWR's generic S16 mixer narrows after rounding; its optimized
                // one/two-source and surround mixers saturate instead.
                let sample = if contributors > 2 && !surround_stereo {
                    rounded as i16
                } else {
                    rounded.clamp(-32768, 32767) as i16
                };
                *value = f32::from(sample) / 32768.;
            } else if surround_stereo {
                let side = usize::from(row[1] != 0.);
                let mut sum = input[2][frame] * row[2] as f32;
                sum += input[3][frame] * row[3] as f32;
                for i in (side..input.len()).step_by(2).filter(|&i| i != 2 && i != 3) {
                    sum += input[i][frame] * row[i] as f32;
                }
                *value = sum;
            } else {
                *value = input
                    .iter()
                    .enumerate()
                    .filter(|&(i, _)| row[i] != 0.)
                    .fold(0f32, |sum, (i, ch)| sum + ch[frame] * row[i] as f32);
            }
        }
    }
    Ok(output)
}

pub(super) fn mix_f64(
    input: &[Vec<f64>],
    weights: &[[f64; 32]; 8],
    channels: usize,
    surround_stereo: bool,
    limit: usize,
) -> Result<Vec<Vec<f64>>, &'static str> {
    let frames = input[0].len();
    let retained = input.iter().map(|c| c.capacity()).sum::<usize>();
    frames.checked_mul(channels).and_then(|n| n.checked_add(retained))
        .and_then(|n| n.checked_mul(8))
        .and_then(|n| n.checked_add((input.len() + channels) * size_of::<Vec<f64>>()))
        .filter(|&n| n <= limit).ok_or("audio mixing exceeds memory budget")?;
    let mut output = vec![vec![0.; frames]; channels];
    for (c, out) in output.iter_mut().enumerate() {
        let row = &weights[c];
        for (f, value) in out.iter_mut().enumerate() {
            *value = if surround_stereo {
                let mut sum = input[2][f] * row[2] + input[3][f] * row[3];
                for i in (c..input.len()).step_by(2).filter(|&i| i != 2 && i != 3) { sum += input[i][f] * row[i]; }
                sum
            } else {
                row[..input.len()].iter().enumerate().filter(|(_, w)| **w != 0.)
                    .fold(0., |sum, (i, &w)| sum + input[i][f] * w)
            };
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixing_bounds_retained_samples_and_rejects_unknown_speakers() {
        assert!(matrix(0, 3, true).is_err());
        assert!(matrix(0x8000, 3, true).is_err());
        assert!(matrix(3, 0x8000, true).is_err());
        let weights = matrix(0x3f, 3, true).unwrap();
        let input = vec![vec![0.; 32]; 6];
        assert_eq!(
            mix(&input, &weights, 2, true, true, 1023).unwrap_err(),
            "audio mixing exceeds memory budget"
        );
        assert_eq!(
            mix(&input, &weights, 2, true, true, 1024).unwrap(),
            vec![vec![0.; 32]; 2]
        );
    }
}
