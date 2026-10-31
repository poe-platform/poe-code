use super::csvkit_decimal::Decimal;

#[derive(Default)]
pub(super) struct Inference<'a> {
    pub locale: Option<&'a str>,
    pub no_inference: bool,
    pub blanks: bool,
    pub nulls: Vec<&'a str>,
    pub no_leading_zeroes: bool,
}

pub(super) struct Cell {
    pub text: String,
    pub boolean: Option<bool>,
    pub number: Option<String>,
}

impl Inference<'_> {
    pub(super) fn text_cell(&self, s: String) -> Option<Cell> {
        let trimmed = s.trim();
        let lower = trimmed.to_lowercase();
        if (!self.blanks && matches!(lower.as_str(), "" | "na" | "n/a" | "none" | "null" | "."))
            || self.nulls.iter().any(|v| v.to_lowercase() == lower)
        {
            return None;
        }
        if self.no_inference {
            return Some(Cell {
                text: s,
                boolean: None,
                number: None,
            });
        }
        let boolean = match lower.replace(',', "").as_str() {
            "1" | "yes" | "y" | "true" | "t" => Some(true),
            "0" | "no" | "n" | "false" | "f" => Some(false),
            _ => None,
        };
        let neg = trimmed.trim_matches('%');
        let (minus, rest) = neg.strip_prefix('-').map_or(("", neg), |s| ("-", s));
        let rest = rest.trim_matches(|c| "؋$ƒ៛¥₡₱£₭₨€﷼₪₩฿₤₫".contains(c));
        let raw = if self.locale == Some("de_DE") {
            rest.replace('.', "").replace(',', ".")
        } else {
            rest.replace(',', "")
        };
        let num = if self.no_leading_zeroes
            && raw.starts_with('0')
            && raw.len() > 1
            && !raw.starts_with("0.")
        {
            None
        } else {
            match raw.to_ascii_lowercase().as_str() {
                "inf" | "infinity" => Some(format!("{minus}Infinity")),
                "nan" => Some("NaN".into()),
                _ => Decimal::parse(&format!("{minus}{}", raw.replace('_', "")), true)
                    .map(|v| v.spelling()),
            }
        };
        Some(Cell {
            text: s,
            boolean,
            number: num,
        })
    }
}
