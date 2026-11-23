use super::super::{dates, number_format};

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Kind {
    Number,
    Logical,
    Date,
    Time,
    DateTime,
    Duration,
    Percent,
    Currency,
    Scientific,
    Fraction,
}

#[derive(Clone, Copy)]
pub(super) struct Format<'a> {
    pub(super) pattern: &'a str,
    pub(super) kind: Kind,
}

impl Kind {
    pub(super) fn standard(self) -> Option<Format<'static>> {
        Some(Format {
            pattern: match self {
                Self::Number => return None,
                Self::Logical => "BOOLEAN",
                Self::Date => "mm/dd/yy",
                Self::Time => r"hh:mm:ss\ AM/PM",
                Self::DateTime => r"mm/dd/yy\ hh:mm\ AM/PM",
                Self::Duration => "[hh]:mm:ss",
                Self::Percent => "0.00%",
                Self::Currency => r"[$$-409]#,##0.00;[RED]\-[$$-409]#,##0.00",
                Self::Scientific => "0.00E+00",
                Self::Fraction => "# ?/?",
            },
            kind: self,
        })
    }
}

impl<'a> Format<'a> {
    pub(super) fn import(pattern: &'a str, work: &mut usize) -> Option<Self> {
        use number_format::FormatKind;
        if pattern.eq_ignore_ascii_case("General") {
            return Some(Self {
                pattern,
                kind: Kind::Number,
            });
        }
        *work = work.checked_sub(pattern.len().checked_mul(32)?.checked_add(512)?)?;
        let kind = if number_format::logical(pattern) {
            Kind::Logical
        } else if let Ok(sections) = dates::sections(pattern, true)
            && let Some(section) = sections.first()
        {
            let tokens = dates::tokens(&section.pattern, work).ok()?;
            match number_format::format_kind(&tokens, section.currency) {
                FormatKind::Date => Kind::Date,
                FormatKind::DateTime => Kind::DateTime,
                // Imported elapsed-time patterns are TIME. Arithmetic can create
                // DURATION with the same spelling but a different result type.
                FormatKind::Time => Kind::Time,
                _ if tokens.iter().any(|t| !t.escaped && t.text == "%") => Kind::Percent,
                _ if section.currency || tokens.iter().any(|t| !t.escaped && t.text == "$") => {
                    Kind::Currency
                }
                _ if tokens.windows(2).any(|t| {
                    !t[0].escaped
                        && t[0].text.eq_ignore_ascii_case("E")
                        && !t[1].escaped
                        && matches!(t[1].text, "+" | "-")
                }) =>
                {
                    Kind::Scientific
                }
                _ if tokens.iter().any(|t| !t.escaped && t.text == "/") => Kind::Fraction,
                _ => Kind::Number,
            }
        } else {
            Kind::Number
        };
        Some(Self { pattern, kind })
    }

    pub(super) fn aggregate(self) -> Option<Self> {
        match self.kind {
            Kind::Date | Kind::Time | Kind::DateTime | Kind::Currency | Kind::Duration => {
                Some(self)
            }
            kind => kind.standard(),
        }
    }
}

pub(super) fn arithmetic<'a>(
    op: &str,
    a: Option<Format<'a>>,
    b: Option<Format<'a>>,
) -> Option<Format<'a>> {
    if matches!(op, "=" | "<>" | "<" | ">" | "<=" | ">=") {
        return Kind::Logical.standard();
    }
    if !matches!(op, "+" | "-" | "*" | "/") {
        return None;
    }
    let currency_a = a.filter(|f| f.kind == Kind::Currency);
    let currency_b = b.filter(|f| f.kind == Kind::Currency);
    if op == "/" {
        return currency_a.filter(|_| currency_b.is_none());
    }
    if let Some(currency) = currency_a.or(currency_b) {
        return Some(currency);
    }
    if op == "*" {
        return None;
    }
    let date = |f: Option<Format<'_>>| {
        f.map(|f| f.kind)
            .filter(|k| matches!(k, Kind::Date | Kind::Time | Kind::DateTime | Kind::Duration))
    };
    let result = match (date(a), date(b)) {
        (a, None) | (None, a) => a,
        (Some(a), Some(b)) if a == b && a != Kind::Date => Some(Kind::Duration),
        (Some(Kind::Time), Some(Kind::Date | Kind::DateTime))
        | (Some(Kind::Date | Kind::DateTime), Some(Kind::Time)) => Some(Kind::DateTime),
        _ => None,
    };
    if let Some(kind) = result
        && let Some(number) = a
            .or(b)
            .filter(|f| f.kind == Kind::Number)
            .or_else(|| b.filter(|f| f.kind == Kind::Number))
        && !number.pattern.eq_ignore_ascii_case("General")
    {
        // Calc reads operands as numbers before choosing the result type. A
        // numeric reference's format index survives a date/time result type.
        return Some(Format {
            pattern: number.pattern,
            kind,
        });
    }
    result
        .or_else(|| {
            (a.is_some_and(|f| f.kind == Kind::Percent)
                || b.is_some_and(|f| f.kind == Kind::Percent))
            .then_some(Kind::Percent)
        })
        .and_then(Kind::standard)
}
