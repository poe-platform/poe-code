use super::{LIMIT, attr, children};
use crate::commands::structured::{
    xlsx::{Filter, FilterField, Sheet},
    xml::{Element, Node},
};
use std::collections::BTreeMap;

pub(super) fn read(
    spreadsheet: &Element,
    sheets: &mut [Sheet<String>],
    remaining: &mut usize,
) -> Result<(), String> {
    for container in children(spreadsheet, "table:database-ranges") {
        for range in children(container, "table:database-range") {
            let Some(source) = attr(range, "table:target-range-address") else {
                continue;
            };
            *remaining = remaining.checked_sub(source.len()).ok_or(LIMIT)?;
            for sheet in sheets.iter_mut() {
                let Some(area) = address(source, &sheet.name) else {
                    continue;
                };
                let mut fields = BTreeMap::new();
                let mut conditions = 0;
                let mut pending = vec![(range, 0)];
                while let Some((node, depth)) = pending.pop() {
                    *remaining = remaining.checked_sub(1).ok_or(LIMIT)?;
                    for child in node.children.iter().rev() {
                        let Node::Element(child) = child else {
                            continue;
                        };
                        if match depth {
                            0 => child.tag == "table:filter",
                            1 => matches!(
                                child.tag.as_str(),
                                "table:filter-and" | "table:filter-condition"
                            ),
                            2 => child.tag == "table:filter-condition",
                            _ => false,
                        } && spreadsheet.tag != "office:body"
                        {
                            pending.push((child, depth + 1));
                        }
                    }
                    if node.tag != "table:filter-condition" {
                        continue;
                    }
                    let operator = match attr(node, "table:operator").unwrap_or("=") {
                        "=" => "equal",
                        "!=" => "notEqual",
                        "<" => "lessThan",
                        ">" => "greaterThan",
                        "<=" => "lessThanOrEqual",
                        ">=" => "greaterThanOrEqual",
                        _ => continue,
                    };
                    conditions += 1;
                    let Some(index) = super::js_number(
                        attr(node, "table:field-number")
                            .unwrap_or("0")
                            .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'),
                    )
                    .filter(|n| {
                        *n >= 0. && n.fract() == 0. && *n < (area[1].abs_diff(area[3]) + 1) as f64
                    }) else {
                        continue;
                    };
                    let value = attr(node, "table:value").unwrap_or("");
                    *remaining = remaining.checked_sub(value.len() + 128).ok_or(LIMIT)?;
                    let value = if attr(node, "table:data-type") == Some("number") {
                        if value.trim().is_empty() {
                            None
                        } else {
                            super::js_number(
                                value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'),
                            )
                            .map(crate::commands::structured::xlsx::number)
                        }
                    } else {
                        Some(value.to_owned())
                    };
                    fields.insert(
                        index as usize,
                        FilterField {
                            conditions: value
                                .map(|value| vec![(operator, value)])
                                .unwrap_or_default(),
                            conjunction: true,
                        },
                    );
                }
                if conditions == 0 && attr(range, "table:display-filter-buttons") != Some("true") {
                    continue;
                }
                if area[0] >= 16777216
                    || area[2] >= 16777216
                    || area[1] >= 16384
                    || area[3] >= 16384
                {
                    return Err("Invalid cell address".into());
                }
                // The public writer retains the first filter for each sheet.
                if sheet.filter.is_none() {
                    sheet.filter = Some(Filter {
                        area: area.map(|n| n as usize),
                        fields: Some(fields),
                        show_buttons: true,
                    });
                }
            }
        }
    }
    Ok(())
}

struct Endpoint {
    cell: [u64; 2],
    sheet: Option<String>,
}

fn quoted(source: &mut &str) -> Option<String> {
    *source = source.strip_prefix('\'')?;
    let mut value = String::new();
    loop {
        let end = source.find('\'')?;
        value.push_str(&source[..end]);
        *source = &source[end + 1..];
        if !source.starts_with('\'') {
            return Some(value);
        }
        value.push('\'');
        *source = &source[1..];
    }
}

fn endpoint(part: &str) -> Option<Endpoint> {
    let (qualifier, cell) = part
        .rsplit_once('.')
        .map_or((None, part), |(s, c)| (Some(s), c));
    let mut sheet = None;
    if let Some(qualifier) = qualifier {
        let qualifier = qualifier.strip_prefix("''#").unwrap_or(qualifier);
        let mut source = qualifier.strip_prefix('$').unwrap_or(qualifier);
        let name = if source.starts_with('\'') {
            let name = quoted(&mut source)?;
            if !source.is_empty() {
                return None;
            }
            name
        } else {
            if source.contains(['.', ' ', '[', ']', ':', '\'', '\t', '\r', '\n']) {
                return None;
            }
            source.to_owned()
        };
        let name = name.strip_prefix("[]").unwrap_or(&name);
        if name.starts_with('[') {
            return None;
        }
        if !name.is_empty() {
            sheet = Some(name.to_owned());
        }
    }
    let cell = cell.strip_prefix('$').unwrap_or(cell);
    let letters = cell.bytes().take_while(u8::is_ascii_alphabetic).count();
    let column = cell[..letters].bytes().try_fold(0u64, |n, c| {
        n.checked_mul(26)?
            .checked_add(u64::from(c.to_ascii_uppercase() - b'A' + 1))
            .filter(|v| *v <= 9007199254740991)
    })?;
    let row = cell[letters..]
        .strip_prefix('$')
        .unwrap_or(&cell[letters..]);
    if cell.is_empty() || !row.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let row = if row.is_empty() {
        u64::MAX
    } else {
        row.parse::<u64>()
            .ok()
            .filter(|v| *v > 0 && *v <= 9007199254740991)?
            - 1
    };
    Some(Endpoint {
        cell: [row, if letters == 0 { u64::MAX } else { column - 1 }],
        sheet,
    })
}

fn address(source: &str, sheet: &str) -> Option<[u64; 4]> {
    let mut quoted = false;
    let split = source.char_indices().find_map(|(i, c)| {
        if c == '\'' {
            quoted = !quoted;
        }
        (c == ':' && !quoted).then_some(i)
    });
    let (first, last) = split.map_or((source, None), |i| (&source[..i], Some(&source[i + 1..])));
    let first = endpoint(first)?;
    let last = match last {
        Some(s) => Some(endpoint(s)?),
        None => None,
    };
    let first_name = first.sheet.as_deref().unwrap_or(sheet);
    let (first_sheet, span) = first_name
        .split_once(':')
        .map_or((first_name, None), |(a, b)| (a, Some(b)));
    let last_sheet = last
        .as_ref()
        .and_then(|e| e.sheet.as_deref())
        .unwrap_or(span.unwrap_or(first_sheet));
    if first_sheet != sheet
        || last_sheet != sheet
        || first.cell.contains(&u64::MAX)
        || last
            .as_ref()
            .is_some_and(|part| part.cell.contains(&u64::MAX))
    {
        return None;
    }
    let last = last.as_ref().map_or(first.cell, |e| e.cell);
    Some([
        if first.cell[0] == u64::MAX {
            0
        } else {
            first.cell[0]
        },
        if first.cell[1] == u64::MAX {
            0
        } else {
            first.cell[1]
        },
        if last[0] == u64::MAX {
            1048575
        } else {
            last[0]
        },
        if last[1] == u64::MAX { 16383 } else { last[1] },
    ])
}
