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
