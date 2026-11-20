use super::{JVal, PandocBlock, PandocInline, jval_obj_get};

#[derive(Debug, Clone)]
pub(super) struct Numbering {
    pub start: i64,
    pub style: String,
    pub delimiter: String,
}

impl Numbering {
    pub fn json(&self) -> JVal {
        JVal::Array(vec![
            JVal::Number(self.start as f64, None),
            tag(&self.style),
            tag(&self.delimiter),
        ])
    }
    pub fn from_json(values: &[JVal]) -> Option<Self> {
        let [
            JVal::Number(start, _),
            JVal::Object(style),
            JVal::Object(delim),
        ] = values
        else {
            return None;
        };
        let (Some(JVal::Str(style)), Some(JVal::Str(delimiter))) =
            (jval_obj_get(style, "t"), jval_obj_get(delim, "t"))
        else {
            return None;
        };
        Some(Self {
            start: *start as i64,
            style: style.clone(),
            delimiter: delimiter.clone(),
        })
    }
    pub fn html_type(&self) -> Option<char> {
        match self.style.as_str() {
            "Decimal" => Some('1'),
            "UpperAlpha" => Some('A'),
            "LowerAlpha" => Some('a'),
            "UpperRoman" => Some('I'),
            "LowerRoman" => Some('i'),
            _ => None,
        }
    }
    fn marker(&self, i: usize, markdown: bool) -> String {
        let n = self.start.saturating_add(i as i64);
        let mut numeral = n.to_string();
        if !markdown {
            match self.style.as_str() {
                "UpperAlpha" | "LowerAlpha" => {
                    let base = if self.style == "UpperAlpha" {
                        b'A'
                    } else {
                        b'a'
                    };
                    numeral = char::from(
                        base + ((self.start.max(1) - 1).saturating_add(i as i64) % 26) as u8,
                    )
                    .to_string();
                }
                "UpperRoman" | "LowerRoman" if (0..4000).contains(&n) => {
                    numeral.clear();
                    let mut remaining = n;
                    for (value, digits) in [
                        (1000, "M"),
                        (900, "CM"),
                        (500, "D"),
                        (400, "CD"),
                        (100, "C"),
                        (90, "XC"),
                        (50, "L"),
                        (40, "XL"),
                        (10, "X"),
                        (9, "IX"),
                        (5, "V"),
                        (4, "IV"),
                        (1, "I"),
                    ] {
                        while remaining >= value {
                            numeral.push_str(digits);
                            remaining -= value;
                        }
                    }
                    if self.style == "LowerRoman" {
                        numeral.make_ascii_lowercase();
                    }
                }
                "UpperRoman" | "LowerRoman" => numeral = "?".into(),
                _ => {}
            }
        }
        let marker = match self.delimiter.as_str() {
            "TwoParens" if !markdown => format!("({numeral})"),
            "OneParen" | "TwoParens" => format!("{numeral})"),
            _ => format!("{numeral}."),
        };
        let width = (marker.len() + 1).max(4);
        format!("{marker:<width$}")
    }
}

fn tag(name: &str) -> JVal {
    JVal::Object(vec![("t".into(), JVal::Str(name.into()))])
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Tasks {
    Disabled,
    Markdown,
    CommonMark,
}

pub(super) fn label(
    item: &[PandocBlock],
    allow_bare: bool,
) -> Option<(bool, bool, &[PandocInline])> {
    let first = item.first()?;
    let (PandocBlock::Plain(content) | PandocBlock::Para(content)) = first else {
        return None;
    };
    let (mark, rest) = match content.as_slice() {
        [PandocInline::Text(mark), PandocInline::Space, rest @ ..] => (mark, rest),
        [PandocInline::Text(mark)] if allow_bare => (mark, &[][..]),
        _ => return None,
    };
    let checked = match mark.as_str() {
        "☒" => true,
        "☐" => false,
        _ => return None,
    };
    Some((matches!(first, PandocBlock::Para(_)), checked, rest))
}

pub(super) fn text(
    numbering: Option<&Numbering>,
    items: &[Vec<PandocBlock>],
    markdown: bool,
    mut limit: usize,
    mut render: impl FnMut(&[PandocBlock], usize) -> Option<String>,
) -> Option<String> {
    let loose = items.iter().any(|item| {
        !matches!(
            item.as_slice(),
            [] | [PandocBlock::Plain(_), ..] | [PandocBlock::List(..)]
        )
    });
    let mut out = String::new();
    for (i, blocks) in items.iter().enumerate() {
        let marker = numbering.map_or_else(|| "- ".to_string(), |n| n.marker(i, markdown));
        if i > 0 {
            let sep = if loose { "\n\n" } else { "\n" };
            limit = limit.checked_sub(sep.len())?;
            out.push_str(sep);
        }
        let value = render(blocks, limit)?;
        let value = if markdown {
            value.strip_suffix('\n').unwrap_or(&value)
        } else {
            &value
        };
        for (line_no, line) in value.split('\n').enumerate() {
            if line_no == 0 {
                limit = limit.checked_sub(marker.len())?;
                out.push_str(&marker);
            } else {
                limit = limit.checked_sub(1)?;
                out.push('\n');
                if !line.is_empty() {
                    limit = limit.checked_sub(marker.len())?;
                    out.extend(std::iter::repeat_n(' ', marker.len()));
                }
            }
            limit = limit.checked_sub(line.len())?;
            out.push_str(line);
        }
    }
    Some(out)
}
