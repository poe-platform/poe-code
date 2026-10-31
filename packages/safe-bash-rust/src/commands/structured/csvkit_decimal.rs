/// Decimal spelling without converting through binary floating point. CSV string
/// inference applies the decimal context's 28-digit half-even rounding; native
/// JSON numbers preserve every digit.
pub(super) struct Decimal {
    digits: String,
    scale: i128,
    negative: bool,
}

impl Decimal {
    pub(super) fn parse(token: &str, round: bool) -> Option<Self> {
        let negative = token.starts_with('-');
        let unsigned = token.strip_prefix(['-', '+']).unwrap_or(token);
        let (mant, exp) = match unsigned.split_once(['e', 'E']) {
            Some((m, e)) => (m, e.parse::<i128>().ok()?),
            None => (unsigned, 0),
        };
        let (whole, frac) = mant.split_once('.').unwrap_or((mant, ""));
        if (whole.is_empty() && frac.is_empty())
            || !whole
                .bytes()
                .chain(frac.bytes())
                .all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let mut scale = exp.checked_sub(frac.len() as i128)?;
        let all = format!("{whole}{frac}");
        let significant = all.trim_start_matches('0');
        let mut digits = if significant.is_empty() {
            "0"
        } else {
            significant
        }
        .as_bytes()
        .to_vec();
        if round && digits.len() > 28 {
            let up = digits[28] > b'5'
                || (digits[28] == b'5'
                    && (digits[27] % 2 == 1 || digits[29..].iter().any(|&c| c != b'0')));
            scale = scale.checked_add((digits.len() - 28) as i128)?;
            digits.truncate(28);
            if up {
                if let Some(i) = digits.iter().rposition(|&c| c != b'9') {
                    digits[i] += 1;
                    digits[i + 1..].fill(b'0');
                } else {
                    digits.fill(b'0');
                    digits[0] = b'1';
                    scale = scale.checked_add(1)?;
                }
            }
        }
        let digits = String::from_utf8(digits).ok()?;
        scale.checked_add(digits.len() as i128 - 1)?;
        Some(Self {
            digits,
            scale,
            negative,
        })
    }

    pub(super) fn normalized_places(&self) -> (i128, i128) {
        if self.digits == "0" {
            return (1, 0);
        }
        let trailing = self.digits.len() - self.digits.trim_end_matches('0').len();
        (
            self.scale.saturating_add(self.digits.len() as i128),
            self.scale.saturating_add(trailing as i128).saturating_neg(),
        )
    }

    pub(super) fn spelling(&self) -> String {
        let Self {
            digits,
            scale,
            negative,
        } = self;
        let scale = *scale;
        let adjusted = scale + (digits.len() as i128 - 1);
        let sign = if *negative { "-" } else { "" };
        if scale > 0 || adjusted < -6 {
            let point = if digits.len() > 1 { "." } else { "" };
            return format!("{sign}{}{point}{}E{adjusted:+}", &digits[..1], &digits[1..]);
        }
        if scale == 0 {
            return format!("{sign}{digits}");
        }
        let point = adjusted + 1;
        if point > 0 {
            let p = point as usize;
            format!("{sign}{}.{}", &digits[..p], &digits[p..])
        } else {
            format!("{sign}0.{}{digits}", "0".repeat((-point) as usize))
        }
    }
}

/// The portable CSV locale groups in threes. Printf formats first convert
/// the Decimal to binary64, whereas the decimal pattern rounds it directly.
pub(super) fn format_number(
    value: &str,
    fmt: &str,
    group: bool,
    limit: usize,
) -> Result<String, &'static str> {
    const UNSUPPORTED: &str =
        "portable locale supports %.Nf decimal formatting; bind locale for other formats";
    let num = value.parse::<f64>().map_err(|_| UNSUPPORTED)?;
    if matches!(value, "Infinity" | "-Infinity" | "NaN") {
        return Ok(value.into());
    }
    let mut fixed = if fmt == "#,##0.###" {
        let d = Decimal::parse(value, false).ok_or(UNSUPPORTED)?;
        let mut coeff = d.digits.into_bytes();
        let shift = d.scale.saturating_add(3);
        if shift >= 0 {
            let zeros = usize::try_from(shift).map_err(|_| "CSV output budget exceeded")?;
            let len = coeff
                .len()
                .checked_add(zeros)
                .filter(|&l| l <= limit)
                .ok_or("CSV output budget exceeded")?;
            coeff.resize(len, b'0');
        } else {
            let discard = shift.unsigned_abs();
            if discard > coeff.len() as u128 {
                coeff.clear();
            } else {
                let n = coeff.len() - discard as usize;
                let up = coeff[n] > b'5'
                    || (coeff[n] == b'5'
                        && (coeff[n + 1..].iter().any(|&b| b != b'0')
                            || (n > 0 && coeff[n - 1] % 2 == 1)));
                coeff.truncate(n);
                if up {
                    if let Some(i) = coeff.iter().rposition(|&b| b != b'9') {
                        coeff[i] += 1;
                        coeff[i + 1..].fill(b'0');
                    } else {
                        coeff.fill(b'0');
                        coeff.insert(0, b'1');
                    }
                }
            }
        }
        let digits = format!("{:0>4}", std::str::from_utf8(&coeff).unwrap());
        let point = digits.len() - 3;
        format!(
            "{}{}.{}",
            if d.negative { "-" } else { "" },
            &digits[..point],
            &digits[point..]
        )
    } else if fmt == "%s" {
        value.to_owned()
    } else {
        let spec = fmt
            .strip_prefix("%,")
            .or_else(|| fmt.strip_prefix('%'))
            .ok_or(UNSUPPORTED)?;
        if matches!(spec, "i" | "d") {
            if !num.is_finite() {
                return Err("non-finite integer formatting");
            }
            if num.trunc() == 0.0 {
                "0".into()
            } else {
                format!("{:.0}", num.trunc())
            }
        } else {
            let precision = if spec == "f" {
                6
            } else {
                let p = spec
                    .strip_prefix('.')
                    .and_then(|s| s.strip_suffix('f'))
                    .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
                    .ok_or(UNSUPPORTED)?;
                let precision = p.parse::<u64>().map_err(|_| UNSUPPORTED)?;
                if precision > 9_007_199_254_740_991 {
                    return Err(UNSUPPORTED);
                }
                // Every binary64 terminates within 1074 fractional places.
                precision.min(1074) as usize
            };
            format!("{num:.precision$}")
        }
    };
    if fixed.contains('.') {
        fixed.truncate(fixed.trim_end_matches('0').trim_end_matches('.').len());
    }
    if !group || fmt == "%s" || !num.is_finite() && fmt != "#,##0.###" {
        return Ok(fixed);
    }
    let end = fixed.find('.').unwrap_or(fixed.len());
    let start = usize::from(fixed.starts_with('-'));
    let mut out = String::with_capacity(fixed.len() + end / 3);
    out.push_str(&fixed[..start]);
    for (i, c) in fixed[start..end].char_indices() {
        if i > 0 && (end - start - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out.push_str(&fixed[end..]);
    Ok(out)
}
