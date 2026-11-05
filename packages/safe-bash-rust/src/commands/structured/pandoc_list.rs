use super::{
    JVal, PandocBlock, PandocInline, PandocPipeTables, jval_obj_get, mdq_interrupts_paragraph,
    mdq_list_marker, parse_pandoc_markdown,
};

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

pub(super) fn label(item: &[PandocBlock], allow_bare: bool) -> Option<(bool, bool, &[PandocInline])> {
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

pub(super) fn read(
    lines: &[&str],
    i: &mut usize,
    (marker, start): (u8, Option<usize>),
    strip_comments: bool,
    tables: PandocPipeTables,
    depth: usize,
    tasks: Tasks,
) -> Option<PandocBlock> {
    let mut items = Vec::new();
    let mut loose = false;
    let mut blank_between = false;
    let mut task_group = None;
    while let Some(&line) = lines.get(*i) {
        let Some((m, _, content)) = mdq_list_marker(line) else {
            break;
        };
        if m != marker || super::mdq_thematic_break(line) {
            break;
        }
        let marker_end = line.len() - line.trim_start_matches(' ').len()
            + line
                .trim_start()
                .bytes()
                .take_while(u8::is_ascii_digit)
                .count()
            + 1;
        let padding = line.len() - content.len() - marker_end;
        let indent = marker_end
            + if (1..=4).contains(&padding) {
                padding
            } else {
                1
            };
        let first = line.get(indent..).unwrap_or("");
        let task = if tasks == Tasks::Disabled || tasks == Tasks::CommonMark && start.is_some() {
            None
        } else {
            first
                .get(..3)
                .and_then(|prefix| match prefix {
                    "[x]" | "[X]" => Some("☒"),
                    "[ ]" => Some("☐"),
                    _ => None,
                })
                .filter(|_| {
                    first[3..].starts_with(' ') || tasks == Tasks::CommonMark && first.len() == 3
                })
        };
        if tasks == Tasks::CommonMark
            && task_group
                .replace(task.is_some())
                .is_some_and(|was| was != task.is_some())
        {
            break;
        }
        loose |= blank_between;
        blank_between = false;
        let mut content_lines = vec![first];
        *i += 1;
        while let Some(&next) = lines.get(*i) {
            if next.trim().is_empty() {
                let blanks = *i;
                while lines.get(*i).is_some_and(|l| l.trim().is_empty()) {
                    *i += 1;
                }
                let Some(&after) = lines.get(*i) else { break };
                if after.len() - after.trim_start_matches(' ').len() < indent {
                    blank_between = true;
                    break;
                }
                loose |= after.as_bytes().get(indent) != Some(&b' ');
                content_lines.extend(std::iter::repeat_n("", *i - blanks));
            } else if next
                .as_bytes()
                .get(..indent)
                .is_some_and(|s| s.iter().all(|&b| b == b' '))
            {
                content_lines.push(&next[indent..]);
                *i += 1;
            } else if !first.is_empty()
                && !mdq_interrupts_paragraph(next)
                && mdq_list_marker(next).is_none()
            {
                content_lines.push(next);
                *i += 1;
            } else {
                break;
            }
        }
        let mut source = content_lines.join("\n");
        if let Some(mark) = task {
            let tail = source[3..].trim_start_matches(' ');
            let prefix_len = source.len() - tail.len();
            source.replace_range(..prefix_len, mark);
            if source.len() > mark.len() && !source[mark.len()..].starts_with('\n') {
                source.insert(mark.len(), ' ');
            }
        }
        items.push(parse_pandoc_markdown(
            &source,
            strip_comments,
            tables,
            depth + 1,
            tasks,
        )?);
    }
    if !loose {
        for block in items.iter_mut().flatten() {
            if let PandocBlock::Para(c) = block {
                *block = PandocBlock::Plain(std::mem::take(c));
            }
        }
    }
    let numbering = start.map(|n| Numbering {
        start: n as i64,
        style: "Decimal".into(),
        delimiter: if marker == b')' { "OneParen" } else { "Period" }.into(),
    });
    Some(PandocBlock::List(numbering, items))
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
