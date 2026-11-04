use super::{awk_decimal_len, format_awk_printf, parse_awk_f64};
use std::cmp::Ordering;

#[derive(Clone, Debug, Default)]
pub(super) enum Scalar {
    #[default]
    Unset,
    Number(f64),
    Text(String),
    NumericText(String, f64),
}

impl Scalar {
    pub(super) fn input(s: String) -> Self {
        let trimmed = s.trim_matches([' ', '\t', '\r', '\n']);
        let digits = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
        if !digits.is_empty() && awk_decimal_len(digits.as_bytes()) == digits.len()
            && let Ok(n) = trimmed.parse() { return Self::NumericText(s, n); }
        Self::Text(s)
    }

    pub(super) fn number(&self) -> f64 {
        match self {
            Self::Unset => 0.0, Self::Number(n) | Self::NumericText(_, n) => *n,
            Self::Text(s) => parse_awk_f64(s),
        }
    }

    pub(super) fn truth(&self) -> bool {
        match self { Self::Text(s) => !s.is_empty(), _ => self.number() != 0.0 }
    }

    pub(super) fn text(&self, fmt: Option<&str>) -> Result<String, (i32, &'static str)> {
        match self {
            Self::Unset => Ok(String::new()),
            Self::Text(s) | Self::NumericText(s, _) => Ok(s.clone()),
            Self::Number(n) if fmt.is_none() || n.fract() == 0.0 && n.abs() < 1e21 => {
                if *n == 0.0 { Ok("0".into()) } else if n.abs() < 1e15 && n.fract() == 0.0 {
                    Ok((*n as i64).to_string())
                } else { Ok(mcp_protocol_rust::numbers::format(*n)) }
            }
            Self::Number(_) => format_awk_printf(fmt.unwrap(), std::slice::from_ref(self), None),
        }
    }

    pub(super) fn compare(&self, other: &Self, fmt: &str) -> Result<Ordering, (i32, &'static str)> {
        if matches!(self, Self::Text(_)) || matches!(other, Self::Text(_)) {
            Ok(self.text(Some(fmt))?.cmp(&other.text(Some(fmt))?))
        } else { Ok(self.number().partial_cmp(&other.number()).unwrap_or(Ordering::Equal)) }
    }
}
