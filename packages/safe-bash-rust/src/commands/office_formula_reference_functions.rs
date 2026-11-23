use super::super::case_fold::sheet_key;
use super::super::sheet_name::{quote_gnumeric_sheet, quote_sheet};
use super::lookup::boolean;
use super::{Calculation, Coord, Expr, Parser, Value};
use crate::commands::structured::xlsx::StringRefSyntax;

fn indirect_reference(text: &str, calc: bool, gnumeric: bool) -> Option<String> {
    let mut output = String::new();
    let mut quoted = false;
    let mut escaped = false;
    let mut start = 0;
    let mut separator = None;
    for (i, c) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ':')))
    {
        if escaped {
            escaped = false;
            continue;
        }
        if gnumeric && quoted && c == '\\' {
            escaped = true;
            continue;
        }
        if c == '\'' {
            quoted = !quoted;
        }
        if quoted {
            continue;
        }
        if calc && c == '!' {
            return None;
        }
        if c == if calc { '.' } else { '!' } {
            separator.get_or_insert(i);
        }
        if c != ':' {
            continue;
        }
        if let Some(separator) = separator.take() {
            let raw = &text[start..separator];
            let sheet = if calc {
                raw.strip_prefix('$').unwrap_or(raw)
            } else {
                raw
            };
            if sheet.is_empty() {
                return None;
            }
            if sheet.starts_with('\'') && sheet.ends_with('\'') {
                output.push_str(sheet);
            } else {
                if gnumeric {
                    if !sheet.chars().all(|c| {
                        c.is_ascii_alphanumeric()
                            || "_.$".contains(c)
                            || !c.is_ascii() && !"¬∧∨".contains(c)
                    }) {
                        return None;
                    }
                } else if !calc {
                    let mut digits = true;
                    for (i, c) in sheet.chars().enumerate() {
                        if c.is_ascii_alphabetic() || c == '_' {
                            if digits && i > 0 && matches!(c, 'e' | 'E') {
                                return None;
                            }
                            digits = false;
                        } else if c == '.' {
                            if digits {
                                return None;
                            }
                        } else if c.is_ascii() && !c.is_ascii_digit() {
                            return None;
                        }
                    }
                }
                output.push('\'');
                if gnumeric {
                    output.push_str(&sheet.replace('\\', "\\\\").replace('\'', "\\'"));
                } else {
                    output.push_str(&sheet.replace('\'', "''"));
                }
                output.push('\'');
            }
            output.push('!');
            output.push_str(&text[separator + 1..i]);
        } else {
            output.push_str(&text[start..i]);
        }
        if i < text.len() {
            output.push(':');
        }
        start = i + 1;
    }
    (!quoted).then_some(output)
}

impl Calculation<'_> {
    pub(super) fn reference_special(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if matches!(name, "ROWS" | "COLUMNS" | "SHEETS") {
            if args.is_empty() {
                return Some(if name == "SHEETS" {
                    Value::Number(self.sheets.len() as f64)
                } else {
                    Value::Error("#N/A")
                });
            }
            if args.len() != 1 {
                return Some(Value::Error("#N/A"));
            }
            let value = self.eval(&args[0], pos, depth + 1, true)?;
            let count = match value {
                Value::Error(error) | Value::LiteralError(error) => {
                    return Some(Value::Error(error));
                }
                Value::InvalidReference | Value::InvalidRange(..) => {
                    return Some(Value::Error("#REF!"));
                }
                Value::Range(a, b) | Value::LabelRange(a, b, _) if name == "SHEETS" => {
                    a.0.abs_diff(b.0) + 1
                }
                _ if name == "SHEETS" => 1,
                _ => {
                    let (height, width) = super::lookup::dimensions(&value);
                    if name == "ROWS" { height } else { width }
                }
            };
            return Some(Value::Number(count as f64));
        }
        if name == "CHOOSE" {
            let public = self.csv || self.dialect == super::Dialect::Gnumeric;
            let Some(first) = args.first() else {
                return Some(Value::Error("#VALUE!"));
            };
            let value = self.eval(first, pos, depth + 1, false)?;
            let value = self.scalar(value, pos, depth + 1)?;
            if !public && let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            let Value::Number(index) = value else {
                return Some(Value::Error("#VALUE!"));
            };
            let index = index.trunc();
            return if index >= 1. && index < args.len() as f64 {
                self.eval(&args[index as usize], pos, depth + 1, !public)
            } else {
                Some(Value::Error(if public { "#VALUE!" } else { "Err:502" }))
            };
        }
        if name == "AREAS" {
            let gnumeric = self.dialect == super::Dialect::Gnumeric;
            if args.len() != 1 {
                return Some(Value::Error(if gnumeric {
                    "#VALUE!"
                } else if args.is_empty() {
                    "Err:511"
                } else {
                    "Err:504"
                }));
            }
            let mut source = &args[0];
            while let Expr::Group(child) = source {
                self.tick(depth)?;
                source = child;
            }
            if gnumeric {
                if matches!(source, Expr::Binary("~" | "~;" | "," | ";", ..)) {
                    let mut pending = vec![source];
                    let mut count = 0;
                    while let Some(node) = pending.pop() {
                        self.tick(depth)?;
                        if let Expr::Binary("~" | "~;" | "," | ";", left, right) = node {
                            pending.extend([left.as_ref(), right.as_ref()]);
                        } else if matches!(node, Expr::Value(value) if !matches!(value, Value::Error(_)))
                        {
                            return Some(Value::Error("#VALUE!"));
                        } else {
                            count += 1;
                        }
                    }
                    return Some(Value::Number(count as f64));
                }
                let value = self.eval(source, pos, depth + 1, true)?;
                return Some(match value {
                    Value::Single(_) | Value::Range(..) | Value::LabelRange(..) => {
                        Value::Number(1.)
                    }
                    Value::Error(error) | Value::LiteralError(error)
                        if matches!(source, Expr::Value(Value::LiteralError(_))) =>
                    {
                        Value::Error(error)
                    }
                    _ => Value::Error("#VALUE!"),
                });
            }
            let value = self.eval(source, pos, depth + 1, true)?;
            if let Value::Set(values) = value {
                let mut pending = values;
                let mut count = 0usize;
                while let Some(value) = pending.pop() {
                    self.tick(depth)?;
                    match value {
                        Value::Set(values) => pending.extend(values),
                        Value::Single(_) | Value::Range(..) | Value::LabelRange(..) => count += 1,
                        _ => return Some(Value::Error("Err:502")),
                    }
                }
                return Some(Value::Number(count as f64));
            }
            return Some(match value {
                Value::Single(_) | Value::Range(..) | Value::LabelRange(..) => Value::Number(1.),
                Value::LiteralError(_) => Value::Error("Err:504"),
                Value::Error(_) => value,
                _ => Value::Error("Err:504"),
            });
        }
        let mut values = Vec::new();
        for arg in args {
            self.aggregate = self.dialect == super::Dialect::Gnumeric;
            let value = self.eval(arg, pos, depth + 1, true)?;
            self.aggregate = false;
            self.collect_reference(value, depth + 1, &mut values)?;
        }
        Some(if values.is_empty() {
            Value::Error("#VALUE!")
        } else if values.len() == 1 {
            values.pop()?
        } else {
            Value::Matrix(values.into_iter().map(|v| vec![v]).collect())
        })
    }
    pub(super) fn collect_reference(
        &mut self,
        value: Value,
        depth: usize,
        output: &mut Vec<Value>,
    ) -> Option<()> {
        self.tick(depth)?;
        if let Value::Set(values) = value {
            for value in values {
                self.collect_reference(value, depth + 1, output)?;
            }
        } else {
            for row in self.matrix(value, depth + 1)? {
                for value in row {
                    self.tick(depth)?;
                    self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
                    output.push(value);
                }
            }
        }
        Some(())
    }
    pub(super) fn reference_function(
        &mut self,
        name: &str,
        args: &[Option<Value>],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let get = |i: usize| args.get(i).and_then(Option::as_ref);
        let public = self.csv || self.dialect == super::Dialect::Gnumeric;
        let number = |i, fallback| {
            get(i)
                .map_or(fallback, |v| v.numeric().unwrap_or(f64::NAN))
                .trunc()
        };
        if matches!(name, "ROW" | "COLUMN") {
            let vertical = name == "ROW";
            let (first, count) = match get(0) {
                None => (
                    (if vertical { pos.1 } else { pos.2 }) + 1,
                    if self.array {
                        self.array_sizes
                            .get(&pos)
                            .map_or(1, |&(h, w)| if vertical { h } else { w })
                    } else {
                        1
                    },
                ),
                Some(Value::Range(a, b) | Value::LabelRange(a, b, _)) => (
                    if vertical {
                        a.1.min(b.1) + 1
                    } else {
                        a.2.min(b.2) + 1
                    },
                    if vertical {
                        a.1.abs_diff(b.1) + 1
                    } else {
                        a.2.abs_diff(b.2) + 1
                    },
                ),
                _ => return Some(Value::Error(if public { "#VALUE!" } else { "Err:504" })),
            };
            if count == 1 {
                return Some(Value::Number(first as f64));
            }
            self.work =
                self.work.checked_sub(count.checked_mul(
                    std::mem::size_of::<Value>() + std::mem::size_of::<Vec<Value>>(),
                )?)?;
            let values = (first..first + count).map(|i| Value::Number(i as f64));
            return Some(Value::Matrix(if vertical {
                values.map(|v| vec![v]).collect()
            } else {
                vec![values.collect()]
            }));
        }
        if name == "SHEET" {
            return Some(match get(0) {
                None => Value::Number(pos.0 as f64 + 1.),
                Some(Value::Range(a, b) | Value::LabelRange(a, b, _)) if a.0 == b.0 => {
                    Value::Number(a.0 as f64 + 1.)
                }
                Some(Value::Text(name) | Value::UninternedText(name)) => self
                    .sheets
                    .iter()
                    .position(|s| sheet_key(s) == sheet_key(name))
                    .map_or(
                        Value::Error(if public { "#NUM!" } else { "Err:502" }),
                        |i| Value::Number(i as f64 + 1.),
                    ),
                Some(Value::Range(..) | Value::LabelRange(..)) => Value::Error("#NUM!"),
                _ => Value::Error(if public { "#VALUE!" } else { "Err:504" }),
            });
        }
        if name == "COLUMNNUMBER" {
            let text = get(0)?.text().to_uppercase();
            let mut column = 0usize;
            for c in text.strip_prefix('$').unwrap_or(&text).bytes() {
                self.tick(depth)?;
                if !c.is_ascii_uppercase() {
                    return Some(Value::Error("#VALUE!"));
                }
                column = column
                    .saturating_mul(26)
                    .saturating_add(usize::from(c - b'A' + 1));
            }
            return Some(if column > 0 && column <= self.sizes[pos.0].1 {
                Value::Number(column as f64)
            } else {
                Value::Error("#VALUE!")
            });
        }
        if name == "HYPERLINK" {
            let value = get(1).or_else(|| get(0))?;
            self.charge_value(value)?;
            if self.dialect == super::Dialect::Gnumeric {
                return Some(value.clone());
            }
            let url = get(0)?;
            let value = if let Value::LiteralError(error) = value {
                Value::Error(error)
            } else if let Value::LiteralError(error) = url {
                Value::Error(error)
            } else if matches!(value, Value::Error(_)) {
                value.clone()
            } else if matches!(url, Value::Error(_)) {
                url.clone()
            } else if args.len() == 1 {
                let text = url.text();
                self.work = self.work.checked_sub(text.len())?;
                Value::Text(text)
            } else if matches!(
                value,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ) {
                Value::Number(0.)
            } else {
                value.clone()
            };
            return Some(if self.array {
                self.charge_value(url)?;
                self.work = self.work.checked_sub(2 * std::mem::size_of::<Value>())?;
                let url = if matches!(url, Value::LiteralError(_)) {
                    String::new()
                } else {
                    url.text()
                };
                Value::Matrix(vec![vec![value], vec![Value::Text(url)]])
            } else {
                value
            });
        }
        if name == "ADDRESS" {
            let (row, column, mode) = (number(0, 0.), number(1, 0.), number(2, 1.));
            if !(1. ..=8.).contains(&mode) {
                return Some(Value::Error("#VALUE!"));
            }
            let relative_row = matches!(mode as u8, 3 | 4 | 7 | 8);
            let relative_column = matches!(mode as u8, 2 | 4 | 6 | 8);
            let a1 = get(3).is_none_or(|v| boolean(v) == Some(true));
            let sheet = get(4)
                .map(|value| match value {
                    Value::Bool(b) if self.dialect == super::Dialect::Gnumeric => {
                        if *b { "TRUE" } else { "FALSE" }.into()
                    }
                    Value::Number(n) if self.dialect == super::Dialect::Gnumeric => {
                        super::super::dates::display_number(*n)
                    }
                    _ => value.text(),
                })
                .filter(|s| self.dialect == super::Dialect::Gnumeric || !s.is_empty());
            let target = sheet
                .as_ref()
                .and_then(|name| {
                    self.sheets
                        .iter()
                        .position(|s| sheet_key(s) == sheet_key(name))
                })
                .unwrap_or(pos.0);
            let (h, w) = self.sizes[target];
            let r = if !a1 && relative_row {
                pos.1 as f64 + row
            } else {
                row - 1.
            };
            let c = if !a1 && relative_column {
                pos.2 as f64 + column
            } else {
                column - 1.
            };
            if r < 0. || c < 0. || r >= h as f64 || c >= w as f64 {
                return Some(Value::Error("Err:502"));
            }
            let address = if a1 {
                let mut name = String::new();
                let mut col = column as usize;
                while col > 0 {
                    name.insert(0, (b'A' + ((col - 1) % 26) as u8) as char);
                    col = (col - 1) / 26;
                }
                format!(
                    "{}{}{}{}",
                    if relative_column { "" } else { "$" },
                    name,
                    if relative_row { "" } else { "$" },
                    row
                )
            } else {
                let axis = |label, value, relative| {
                    if relative {
                        if value == 0. {
                            format!("{label}")
                        } else {
                            format!("{label}[{value}]")
                        }
                    } else {
                        format!("{label}{value}")
                    }
                };
                format!(
                    "{}{}",
                    axis('R', row, relative_row),
                    axis('C', column, relative_column)
                )
            };
            let text = sheet.map_or_else(
                || address.clone(),
                |name| {
                    let calc = self.dialect == super::Dialect::LibreOffice
                        && a1
                        && matches!(
                            self.book.string_ref_syntax,
                            StringRefSyntax::CalcA1 | StringRefSyntax::CalcExcelA1
                        );
                    let (doc, sheet) = if calc && name.starts_with('\'') {
                        name.find("'#").map_or(("", name.as_str()), |i| {
                            let end = i + 2 + usize::from(name[i + 2..].starts_with('$'));
                            name.split_at(end)
                        })
                    } else {
                        ("", name.as_str())
                    };
                    format!(
                        "{doc}{}{}{address}",
                        if self.dialect == super::Dialect::Gnumeric {
                            quote_gnumeric_sheet(sheet)
                        } else if sheet.starts_with('\'') && sheet.ends_with('\'') {
                            format!("'{}'", sheet.replace('\'', "''"))
                        } else {
                            quote_sheet(sheet)
                        },
                        if calc { '.' } else { '!' }
                    )
                },
            );
            self.work = self.work.checked_sub(text.len())?;
            return Some(Value::Text(text));
        }
        if name == "OFFSET" {
            let (a, b) = match get(0) {
                Some(Value::Single(a)) => (a, a),
                Some(Value::Range(a, b) | Value::LabelRange(a, b, _)) => (a, b),
                _ => return Some(Value::Error(if public { "#VALUE!" } else { "Err:504" })),
            };
            let row = a.1.min(b.1) as f64 + number(1, 0.);
            let column = a.2.min(b.2) as f64 + number(2, 0.);
            let height = number(3, (a.1.abs_diff(b.1) + 1) as f64);
            let width = number(4, (a.2.abs_diff(b.2) + 1) as f64);
            let (h, w) = self.sizes[pos.0];
            if row < 0. || column < 0. || row >= h as f64 || column >= w as f64 {
                return Some(Value::Error("#REF!"));
            }
            if height < 1. || width < 1. {
                return Some(Value::Error("#VALUE!"));
            }
            if row + height - 1. >= h as f64 || column + width - 1. >= w as f64 {
                return Some(Value::Error("#REF!"));
            }
            if matches!(get(0), Some(Value::Single(_))) && get(3).is_none() && get(4).is_none() {
                return Some(Value::Single((a.0, row as usize, column as usize)));
            }
            return Some(Value::Range(
                (a.0, row as usize, column as usize),
                (
                    b.0,
                    (row + height - 1.) as usize,
                    (column + width - 1.) as usize,
                ),
            ));
        }
        if name == "INDIRECT" {
            let gnumeric = self.dialect == super::Dialect::Gnumeric;
            let text = get(0)?.text();
            self.work = self.work.checked_sub(text.len())?;
            if text.is_empty() || !gnumeric && (text.trim() != text || text.starts_with(['=', '(']))
            {
                return Some(Value::Error("#REF!"));
            }
            let r1c1 = args
                .get(1)
                .is_some_and(|v| v.as_ref().map_or(!gnumeric, |v| boolean(v) != Some(true)))
                || self.dialect == super::Dialect::LibreOffice
                    && matches!(self.book.string_ref_syntax, StringRefSyntax::ExcelR1C1);
            let allow_calc = self.dialect == super::Dialect::LibreOffice
                && !r1c1
                && matches!(
                    self.book.string_ref_syntax,
                    StringRefSyntax::CalcA1 | StringRefSyntax::CalcExcelA1
                );
            let allow_excel = self.dialect == super::Dialect::Gnumeric
                || r1c1
                || !matches!(self.book.string_ref_syntax, StringRefSyntax::CalcA1);
            for calc in [false, true] {
                if calc && !allow_calc {
                    continue;
                }
                self.work = self.work.checked_sub(text.len().checked_mul(2)?)?;
                let source = if gnumeric {
                    let mut source = text.strip_prefix('=').unwrap_or(&text).trim();
                    while let Some(inner) = source.strip_prefix('(') {
                        self.tick(depth)?;
                        let Some(inner) = inner.trim().strip_suffix(')') else {
                            return Some(Value::Error("#REF!"));
                        };
                        source = inner.trim();
                    }
                    // After outer groups, INDIRECT accepts a reference or a name.
                    // Parentheses inside quoted sheet names are still ordinary text.
                    let mut quoted = false;
                    let mut escaped = false;
                    for c in source.chars() {
                        if escaped {
                            escaped = false;
                        } else if quoted && c == '\\' {
                            escaped = true;
                        } else if c == '\'' {
                            quoted = !quoted;
                        } else if !quoted && matches!(c, '(' | ')') {
                            return Some(Value::Error("#REF!"));
                        }
                    }
                    if source.starts_with("@name.")
                        || super::live_names::global_name(source).is_some()
                    {
                        Some(source.to_owned())
                    } else {
                        let source = super::live_names::global_prefix(source)
                            .filter(|tail| tail.contains('!'))
                            .unwrap_or(source);
                        indirect_reference(source, false, true)
                    }
                } else {
                    indirect_reference(&text, calc, false)
                };
                let Some(source) = source else {
                    continue;
                };
                let mut parser = Parser {
                    source: &source,
                    nodes: (self.work / std::mem::size_of::<Expr>()).min(8192),
                    limited: false,
                    error: None,
                    raw_tail: false,
                    arrays: 0,
                    uninterned_arrays: false,
                    sheets: self.sheets.iter().map(String::as_str),
                    names: &self.book.names,
                    bindings: None,
                    operators: Vec::new(),
                    name_stack: Vec::new(),
                    export_names: None,
                    position: (pos.0, pos.1 as i64, pos.2 as i64),
                    scope: Some(pos.0),
                    odf: false,
                    xlsx: false,
                    csv: self.dialect == super::Dialect::Gnumeric,
                    dialect: self.dialect,
                    r1c1,
                    sizes: &self.sizes,
                };
                let mut expression = parser.expression(0, 0, false);
                if gnumeric {
                    let scalar = !text.trim().starts_with('(');
                    match &mut expression {
                        Some(Expr::Radical(label)) => label.scalar = scalar,
                        Some(Expr::Label(_, _, selected, _)) => *selected = scalar,
                        _ => {}
                    }
                }
                parser.space();
                if parser.limited {
                    return None;
                }
                if parser.source.is_empty()
                    && let Some(expression) = expression
                    && (calc
                        || allow_excel
                        || matches!(expression, Expr::Name(_)) && !text.contains('!'))
                    && (gnumeric || !matches!(expression, Expr::Group(_)))
                {
                    let value = self.indirect_range(&expression, pos, depth + 1)?;
                    if calc && matches!(value, Value::InvalidReference) {
                        continue;
                    }
                    if !matches!(value, Value::Error("#REF!")) {
                        return Some(value);
                    }
                }
            }
            return Some(Value::Error("#REF!"));
        }
        let value = get(0)?;
        if name == "UNIQUE"
            && self.dialect != super::Dialect::Gnumeric
            && !matches!(
                value,
                Value::Range(..) | Value::LabelRange(..) | Value::Matrix(..)
            )
        {
            return Some(Value::Error("Err:504"));
        }
        self.charge_value(value)?;
        if name == "SORT" {
            let mut values = Vec::new();
            self.collect_reference(value.clone(), depth + 1, &mut values)?;
            if let Some(Value::Error(error) | Value::LiteralError(error)) = values
                .iter()
                .find(|v| matches!(v, Value::Error(_) | Value::LiteralError(_)))
            {
                return Some(Value::Error(error));
            }
            let order = number(1, 0.);
            if order != 0. && order != 1. {
                return Some(Value::Error("#VALUE!"));
            }
            values.retain(|v| matches!(v, Value::Number(_)));
            self.work = self.work.checked_sub(
                values
                    .len()
                    .checked_mul((values.len().max(1).ilog2() as usize + 1) * 2)?,
            )?;
            values.sort_by(|a, b| {
                let compared = a
                    .numeric()
                    .unwrap()
                    .partial_cmp(&b.numeric().unwrap())
                    .unwrap();
                if order == 1. {
                    compared
                } else {
                    compared.reverse()
                }
            });
            return Some(Value::Matrix(values.into_iter().map(|v| vec![v]).collect()));
        }
        if name == "TRANSPOSE" && matches!(value, Value::Set(_)) {
            return Some(Value::Error("Err:502"));
        }
        let mut rows = self.matrix(value.clone(), depth + 1)?;
        let vertical = get(1).is_none_or(|v| boolean(v) == Some(true));
        if name == "FLIP" {
            if rows.len() == 1 && rows[0].len() == 1 {
                return rows.pop()?.pop();
            }
            if vertical {
                rows.reverse();
            } else {
                for row in &mut rows {
                    row.reverse();
                }
            }
        } else if name == "TRANSPOSE" {
            rows = self.transpose(rows, depth + 1)?;
        } else if name == "UNIQUE" {
            let columns = get(1).is_some_and(|v| boolean(v) == Some(true));
            if columns {
                rows = self.transpose(rows, depth + 1)?;
            }
            let mut kept: Vec<Vec<Value>> = Vec::new();
            let mut counts = Vec::new();
            for row in rows {
                let mut found = None;
                for (i, previous) in kept.iter().enumerate() {
                    let mut same = true;
                    for (a, b) in row.iter().zip(previous) {
                        self.tick(depth)?;
                        let equal = match (a, b) {
                            (
                                Value::Blank
                                | Value::Empty
                                | Value::FunctionEmpty
                                | Value::MatrixEmpty,
                                Value::Blank
                                | Value::Empty
                                | Value::FunctionEmpty
                                | Value::MatrixEmpty,
                            ) => true,
                            (
                                Value::Text(a) | Value::UninternedText(a),
                                Value::Text(b) | Value::UninternedText(b),
                            ) => {
                                self.work = self
                                    .work
                                    .checked_sub(a.len().checked_add(b.len())?.checked_mul(3)?)?;
                                super::super::case_fold::fold(a) == super::super::case_fold::fold(b)
                            }
                            (
                                Value::Error(a) | Value::LiteralError(a),
                                Value::Error(b) | Value::LiteralError(b),
                            ) => a == b,
                            _ if std::mem::discriminant(a) == std::mem::discriminant(b) => {
                                self.lookup_compare(a, b, depth + 1)?.is_eq()
                            }
                            _ => false,
                        };
                        if !equal {
                            same = false;
                            break;
                        }
                    }
                    if same {
                        found = Some(i);
                        break;
                    }
                }
                if let Some(i) = found {
                    counts[i] += 1;
                } else {
                    kept.push(row);
                    counts.push(1usize);
                }
            }
            let once = get(2).is_some_and(|v| boolean(v) == Some(true));
            rows = kept
                .into_iter()
                .zip(counts)
                .filter_map(|(row, n)| (!once || n == 1).then_some(row))
                .collect();
            if rows.is_empty() {
                return Some(Value::Error("#VALUE!"));
            }
            if columns {
                rows = self.transpose(rows, depth + 1)?;
            }
        }
        Some(Value::Matrix(rows))
    }
    fn transpose(&mut self, rows: Vec<Vec<Value>>, depth: usize) -> Option<Vec<Vec<Value>>> {
        self.tick(depth)?;
        let width = rows.first().map_or(0, Vec::len);
        self.work = self.work.checked_sub(
            rows.len()
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut columns: Vec<Vec<Value>> = (0..width).map(|_| Vec::new()).collect();
        for row in rows {
            for (column, value) in columns.iter_mut().zip(row) {
                self.tick(depth)?;
                column.push(value);
            }
        }
        Some(columns)
    }
    fn indirect_range(&mut self, expression: &Expr, pos: Coord, depth: usize) -> Option<Value> {
        self.tick(depth)?;
        match expression {
            Expr::Label(..) | Expr::Radical(_) => self.eval(expression, pos, depth + 1, true),
            Expr::Ref(a) => Some(match self.range(a, a, pos, None) {
                Value::Range(coord, _) => Value::Single(coord),
                Value::Error("#REF!") | Value::InvalidRange(..) => Value::InvalidReference,
                value => value,
            }),
            Expr::Range(a, b) => Some(self.range(a, b, pos, None)),
            Expr::Binary(":", a, b)
                if self.dialect == super::Dialect::LibreOffice
                    && matches!(a.as_ref(), Expr::Ref(_) | Expr::Range(..))
                    && matches!(b.as_ref(), Expr::Ref(_) | Expr::Range(..)) =>
            {
                let left = self.indirect_range(a, pos, depth + 1)?;
                let right = self.indirect_range(b, pos, depth + 1)?;
                Some(match (left.into_range(), right.into_range()) {
                    (Value::Range(a, b), Value::Range(c, d)) => Value::Range(
                        (a.0.min(c.0), a.1.min(c.1), a.2.min(c.2)),
                        (b.0.max(d.0), b.1.max(d.1), b.2.max(d.2)),
                    ),
                    _ => Value::Error("#REF!"),
                })
            }
            Expr::Group(child) => self.indirect_range(child, pos, depth + 1),
            Expr::LiveName(i, relocation) => {
                if !self.visiting_names.insert(*i) {
                    return Some(Value::Error("#REF!"));
                }
                let mut work = self.work;
                let expression = self.relocated_name(*i, relocation, &mut work)?;
                self.work = work;
                let value = self.indirect_range(&expression, pos, depth + 1);
                self.visiting_names.remove(i);
                expression.discard();
                value
            }
            Expr::Name(i) => {
                if !self.visiting_names.insert(*i) {
                    return Some(Value::Error("#REF!"));
                }
                let expression = self.names.get(*i)?.clone();
                let name = &self.book.names[*i];
                let position = if name
                    .openformula
                    .as_deref()
                    .is_some_and(|s| s.starts_with("msoxl:="))
                {
                    (name.sheet.unwrap_or(pos.0), pos.1, pos.2)
                } else {
                    pos
                };
                let value = self.indirect_range(&expression, position, depth + 1);
                self.visiting_names.remove(i);
                value
            }
            _ => Some(Value::Error("#REF!")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::calculate;
    use std::collections::BTreeSet;

    #[test]
    fn dynamic_ranges_and_array_transformations_obey_the_work_budget() {
        for formula in [
            "=TRANSPOSE(INDIRECT(\"A1:A65536\"))",
            "=TRANSPOSE(OFFSET(A1,0,0,65536,1))",
            "=TRANSPOSE(A1:A65536)",
        ] {
            let rows = vec![vec!["1".into(), formula.into()]];
            assert!(
                calculate(&rows, &BTreeSet::new(), 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::new(), 16_000_000).is_some(),
                "{formula}"
            );
        }
    }

    #[test]
    fn unique_charges_comparisons_and_indirect_resolves_nested_references() {
        let values = (0..600)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(";");
        let rows = vec![vec![format!("=UNIQUE({{{values}}})")]];
        assert!(calculate(&rows, &BTreeSet::new(), 100_000).is_none());
        assert!(calculate(&rows, &BTreeSet::new(), 8_000_000).is_some());
        let rows = vec![vec![
            "7".into(),
            format!("=INDIRECT(\"{}A1{}\")", "(".repeat(200), ")".repeat(200)),
        ]];
        assert!(matches!(
            calculate(&rows, &BTreeSet::from([(0, 0)]), 8_000_000)
                .unwrap()
                .get(&(0, 1)),
            Some(super::Value::Number(7.))
        ));
    }
}
