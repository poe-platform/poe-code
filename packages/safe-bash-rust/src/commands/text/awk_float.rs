// AWK's JavaScript formatter rounds decimal ties away from zero. Retain the
// exact coefficient, including subnormals, until the requested digit is known.
struct Decimal {
    digits: String,
    point: i32,
}

impl Decimal {
    fn exact(n: f64) -> Self {
        if n == 0.0 { return Self { digits: "0".into(), point: 1 }; }
        let bits = n.to_bits();
        let biased = ((bits >> 52) & 2047) as i32;
        let mantissa = (bits & ((1 << 52) - 1)) | (u64::from(biased != 0) << 52);
        let power = biased.max(1) - 1075 + mantissa.trailing_zeros() as i32;
        let places = (-power).max(0) as usize;
        let fixed = format!("{n:.places$}");
        let point = fixed.find('.').unwrap_or(fixed.len()) as i32;
        let digits = fixed.replace('.', "");
        let significant = digits.trim_start_matches('0');
        Self { point: point - (digits.len() - significant.len()) as i32, digits: significant.trim_end_matches('0').into() }
    }

    fn round(&mut self, keep: i64) {
        if keep >= self.digits.len() as i64 { return; }
        if keep < 0 || keep == 0 && self.digits.as_bytes()[0] < b'5' {
            self.digits = "0".into(); self.point = 1; return;
        }
        let keep = keep as usize;
        let up = self.digits.as_bytes()[keep] >= b'5';
        self.digits.truncate(keep);
        if up {
            let end = self.digits.trim_end_matches('9').len();
            self.digits.truncate(end);
            if let Some(last) = self.digits.pop() {
                self.digits.push((last as u8 + 1) as char);
            } else {
                self.digits.push('1'); self.point += 1;
            }
        }
    }

    fn render(&self, point: i32, places: usize, pad: bool) -> String {
        let mut out = String::new();
        if point <= 0 { out.push('0'); } else {
            let n = (point as usize).min(self.digits.len());
            out.push_str(&self.digits[..n]);
            out.extend(std::iter::repeat_n('0', point as usize - n));
        }
        let digits = self.digits.get(point.max(0) as usize..).unwrap_or("");
        let fraction = if pad { digits } else { digits.trim_end_matches('0') };
        if !fraction.is_empty() || pad && places != 0 {
            out.push('.');
            let start = out.len();
            out.extend(std::iter::repeat_n('0', (-point).max(0) as usize));
            out.push_str(fraction);
            if pad { out.extend(std::iter::repeat_n('0', places.saturating_sub(out.len() - start))); }
        }
        out
    }
}

pub(super) fn format(n: f64, conv: char, precision: usize, alternate: bool) -> Result<String, (i32, &'static str)> {
    let kind = conv.to_ascii_lowercase();
    let general = kind == 'g';
    let mut places = if general { precision.max(1) - 1 } else { precision };
    let mut magnitude = n.abs();
    if !magnitude.is_finite() { return Err((2, "cannot format a non-finite number")); }
    let mut d = Decimal::exact(magnitude);
    if kind == 'f' { d.round(i64::from(d.point) + places as i64); }
    else { d.round(places as i64 + 1); }
    let mut exp = d.point - 1;
    if general && precision <= 100 && magnitude != 0.0 {
        // general() converts toPrecision's result back to a Number before
        // choosing notation and applying toFixed or toExponential.
        magnitude = format!("{}e{}", d.digits, d.point - d.digits.len() as i32).parse().unwrap();
        if !magnitude.is_finite() { return Ok(format!("{}{}", if n < 0.0 { "-" } else { "" }, if conv == 'G' { "INFINITY" } else { "Infinity" })); }
        exp = magnitude.log10().floor() as i32;
        d = Decimal::exact(magnitude);
    }
    let scientific = kind == 'e' || general && (exp < -4 || exp >= precision.max(1) as i32);
    if general {
        if scientific { d.round(places as i64 + 1); }
        else {
            places = (places as i64 - i64::from(exp)).max(0) as usize;
            if precision <= 100 && places > 100 { return Err((1, "internal error")); }
            d.round(i64::from(d.point) + places as i64);
        }
    }
    let mut result = if !scientific && precision <= 100 && magnitude >= 1e21 {
        mcp_protocol_rust::numbers::format(magnitude)
    } else {
        d.render(if scientific { 1 } else { d.point }, places, !general || alternate)
    };
    if alternate && !general && !result.contains('.') {
        result.insert(result.find('e').unwrap_or(result.len()), '.');
    }
    if scientific { result.push_str(&format!("e{:+03}", d.point - 1)); }
    if conv.is_ascii_uppercase() { result.make_ascii_uppercase(); }
    if n < 0.0 { result.insert(0, '-'); }
    Ok(result)
}
