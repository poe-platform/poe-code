// FFmpeg's default SWR filter: 32-tap Kaiser window (beta 9), 0.97 cutoff,
// up to 1024 phases, and linear interpolation between adjacent phases.
macro_rules! resampler {
($name:ident, $sample:ty, $lanes:expr, $accumulate:expr) => {
pub(super) fn $name(
    input: &[Vec<$sample>],
    input_rate: u32,
    output_rate: u32,
    limit: usize,
    work: &mut usize,
) -> Result<Vec<Vec<$sample>>, &'static str> {
    let length = input.first().map_or(0, Vec::len);
    let ratio = f64::from(input_rate) / f64::from(output_rate);
    let cutoff = (f64::from(output_rate) * 0.97 / f64::from(input_rate)).min(1.);
    let taps = (2. * (16. / cutoff).ceil()) as usize;
    let center = (taps - 1) / 2;
    let mut count = (length as f64 / ratio).ceil() as usize;
    if length <= taps {
        let flushed = length + length.div_ceil(2);
        count = if flushed <= taps {
            0
        } else {
            ((flushed - taps / 2) as f64 / ratio).ceil() as usize
        };
    } else {
        let support = taps - center - 1;
        let emitted = ((length - support) as f64 / ratio).ceil();
        let remaining = length
            .saturating_add(center)
            .saturating_sub((emitted * ratio).floor() as usize);
        let reflection = remaining.min(taps).div_ceil(2);
        count = count.min(((length + reflection - support) as f64 / ratio).ceil() as usize);
    }
    let mut a = input_rate;
    let mut b = output_rate;
    while b != 0 {
        (a, b) = (b, a % b);
    }
    let exact = output_rate / a;
    let phases = if exact <= 1024 { exact as usize } else { 1024 };
    if count == 0 {
        return Ok(input.iter().map(|_| Vec::new()).collect());
    }
    let coefficients_len = phases
        .checked_mul(taps)
        .ok_or("audio resampling exceeds memory budget")?;
    let retained = input.iter().try_fold(0usize, |n, channel| n.checked_add(channel.capacity()))
        .ok_or("audio resampling exceeds memory budget")?;
    count.checked_mul(input.len())
        .and_then(|n| n.checked_add(retained))
        .and_then(|n| n.checked_add(coefficients_len))
        .and_then(|n| n.checked_mul(size_of::<$sample>()))
        .and_then(|n| input.len().checked_mul(2 * size_of::<Vec<$sample>>()).and_then(|m| n.checked_add(m)))
        .filter(|&n| n <= limit)
        .ok_or("audio resampling exceeds memory budget")?;
    let interpolate = u64::from(input_rate) * phases as u64 % u64::from(output_rate) != 0;
    // Each coefficient (including normalization) evaluates at most 63 I0
    // terms. Charge construction and filtering before allocating the bank.
    let operations = coefficients_len.checked_add(taps)
        .and_then(|n| n.checked_mul(64))
        .and_then(|n| count.checked_mul(input.len())
            .and_then(|m| m.checked_mul(taps))
            .and_then(|m| m.checked_mul(if interpolate { 2 } else { 1 }))
            .and_then(|m| n.checked_add(m)))
        .ok_or("audio resampling work limit exceeded")?;
    *work = work.checked_sub(operations).ok_or("audio resampling work limit exceeded")?;
    let weight = |distance: f64, sine: f64| {
        let phase = std::f64::consts::PI * distance * cutoff;
        let w = 2. * phase / (cutoff * taps as f64 * std::f64::consts::PI);
        // I0(x) = sum((x*x/4)^k / (k!)^2); beta is bounded at 9.
        let x = 9. * (1. - w * w).max(0.).sqrt();
        let x = x * x / 4.;
        let (mut window, mut term, mut error) = (1., 1., 0.);
        for k in 1..64 {
            term *= x / f64::from(k * k);
            let corrected = term - error;
            let next = window + corrected;
            error = (next - window) - corrected;
            if next == window {
                break;
            }
            window = next;
        }
        let sine = if cutoff == 1. { sine } else { phase.sin() };
        (if phase == 0. { 1. } else { sine / phase }) * window
    };
    let normalization = (0..taps)
        .map(|j| weight(j as f64 - center as f64, 0.))
        .sum::<f64>();
    let mut coefficients = vec![0.; coefficients_len];
    for phase in 0..if phases % 2 == 0 { phases / 2 + 1 } else { phases } {
        // Reuse the phase sine across taps; recovering its fraction from
        // each tap's distance loses precision at large offsets.
        let mut sine = (std::f64::consts::PI * phase as f64 / phases as f64).sin()
            * if center % 2 == 0 { -1. } else { 1. };
        for j in 0..taps {
            coefficients[phase * taps + j] =
                (weight(j as f64 - center as f64 - phase as f64 / phases as f64, sine) / normalization) as $sample;
            sine = -sine;
        }
        if phases % 2 == 0 && phase > 0 {
            for j in 0..taps {
                coefficients[(phases - phase) * taps + taps - 1 - j] = coefficients[phase * taps + j];
            }
        }
    }
    let period = length * 2 - 1;
    let mut output = vec![vec![0.; count]; input.len()];
    for i in 0..count {
        let position = i as u128 * u128::from(input_rate) * phases as u128;
        let whole = (position / u128::from(output_rate)) as usize;
        let phase = whole % phases;
        let base = (whole / phases) as i64 - center as i64;
        let fraction = (position % u128::from(output_rate)) as $sample * (1. / output_rate as $sample);
        for (channel, out) in input.iter().zip(output.iter_mut()) {
            // Match SWR's FMA accumulation and interpolate before the final
            // horizontal sum; changing this order loses low PCM bits.
            let mut lanes = [[0. as $sample; $lanes]; 2];
            for side in 0..if interpolate { 2 } else { 1 } {
                for j in 0..taps {
                    let wrapped = (base + ((phase + side) / phases) as i64 + j as i64)
                        .rem_euclid(period as i64) as usize;
                    let index = if wrapped < length {
                        wrapped
                    } else {
                        period - wrapped
                    };
                    let coefficient = coefficients[(phase + side) % phases * taps + j];
                    lanes[side][j % $lanes] = ($accumulate)(lanes[side][j % $lanes], channel[index], coefficient);
                }
            }
            for side in &mut lanes {
                for lane in 0..$lanes/2 {
                    side[lane] += side[lane + $lanes/2];
                }
            }
            if interpolate {
                for lane in 0..$lanes/2 {
                    lanes[0][lane] = ($accumulate)(lanes[0][lane], lanes[1][lane] - lanes[0][lane], fraction);
                }
            }
            out[i] = if $lanes == 8 { (lanes[0][0] + lanes[0][2]) + (lanes[0][1] + lanes[0][3]) } else { lanes[0][0] + lanes[0][1] };
        }
    }
    Ok(output)
}

};
}
resampler!(resample, f32, 8, |a: f32, b: f32, c: f32| (f64::from(a) + f64::from(b) * f64::from(c)) as f32);
resampler!(resample_f64, f64, 4, |a: f64, b: f64, c: f64| b.mul_add(c, a));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retained_input_capacity_counts_toward_the_memory_limit() {
        let mut work = usize::MAX;
        let mut input = vec![0.; 4096];
        input.truncate(64);
        assert_eq!(resample(&[input], 8000, 16000, 8192, &mut work), Err("audio resampling exceeds memory budget"));
        let mut input = vec![0.; 4096];
        input.truncate(64);
        assert_eq!(resample_f64(&[input], 8000, 16000, 16384, &mut work), Err("audio resampling exceeds memory budget"));
    }

    #[test]
    fn coefficient_work_uses_the_shared_budget_for_both_sample_formats() {
        let input = [vec![0.; 64]];
        let mut work = 100000;
        resample(&input, 8000, 16000, 8192, &mut work).unwrap();
        assert!(work < 100000);
        let spent = 100000 - work;
        assert_eq!(resample(&input, 8000, 16000, 8192, &mut (spent - 1)), Err("audio resampling work limit exceeded"));
        assert_eq!(resample_f64(&[vec![0.; 64]], 8000, 16000, 16384, &mut (spent - 1)), Err("audio resampling work limit exceeded"));
        assert_eq!(resample_f64(&[vec![0.; 64]], 47999, 48000, 1048576, &mut 100000), Err("audio resampling work limit exceeded"));
    }
}
