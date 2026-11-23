use super::super::case_fold::sheet_key;
use super::{Calculation, Expr, Value};

pub(in crate::commands) fn global_prefix(source: &str) -> Option<&str> {
    let source = source.strip_prefix('[')?.trim_start();
    let source = source
        .strip_prefix("\"\"")
        .or_else(|| source.strip_prefix("''"))
        .unwrap_or(source)
        .trim_start()
        .strip_prefix(']')?;
    Some(source.strip_prefix('!').unwrap_or(source))
}

pub(in crate::commands) fn global_name(source: &str) -> Option<(&str, &str)> {
    let source = global_prefix(source)?;
    let length = source
        .chars()
        .take_while(|c| c.is_alphanumeric() || "_$.".contains(*c))
        .map(char::len_utf8)
        .sum();
    let (name, tail) = source.split_at(length);
    if name.is_empty() || name.as_bytes()[0].is_ascii_digit() || tail.starts_with(['!', '(']) {
        return None;
    }
    Some((name, tail))
}

#[derive(Clone, PartialEq)]
pub(in crate::commands) struct Relocation {
    relative: bool,
    fixed_sheet: bool,
    pub(super) row: i64,
    pub(super) column: i64,
    pub(super) sheet: i64,
    mapping: Vec<(String, Option<String>)>,
}

#[derive(Clone, PartialEq)]
pub(in crate::commands) struct LiveName {
    pub(in crate::commands) name: String,
    pub(super) relocation: Relocation,
}

impl LiveName {
    pub(in crate::commands) fn parse(source: &str, gnumeric: bool) -> Option<(Self, &str)> {
        fn quoted(source: &mut &str, gnumeric: bool) -> Option<String> {
            *source = source.strip_prefix('"')?;
            let mut value = String::new();
            loop {
                let c = source.chars().next()?;
                *source = &source[c.len_utf8()..];
                if c == '"' {
                    if !gnumeric && source.starts_with('"') {
                        *source = &source[1..];
                    } else {
                        return (!value.is_empty()).then_some(value);
                    }
                } else if gnumeric && c == '\\' {
                    let escaped = source.chars().next()?;
                    *source = &source[escaped.len_utf8()..];
                    value.push(escaped);
                    continue;
                }
                value.push(c);
            }
        }
        fn displacement(source: &mut &str, separator: char) -> Option<i64> {
            let digits = source.strip_prefix('-').unwrap_or(source);
            let length = digits.bytes().take_while(u8::is_ascii_digit).count();
            if length == 0 {
                return None;
            }
            let length = length + usize::from(source.starts_with('-'));
            let value = source[..length].parse::<i64>().ok()?;
            if value.unsigned_abs() > 9_007_199_254_740_991 {
                return None;
            }
            *source = source[length..].strip_prefix(separator)?;
            Some(value)
        }
        let mut tail = source.strip_prefix("@name.")?;
        let relative = tail.starts_with("relative");
        tail = tail.strip_prefix(if relative { "relative" } else { "absolute" })?;
        let fixed_sheet = tail.starts_with(".fixed-sheet");
        if fixed_sheet {
            tail = &tail[12..];
        }
        tail = tail.strip_prefix('[')?;
        let row = displacement(&mut tail, ',')?;
        let column = displacement(&mut tail, ',')?;
        let sheet = displacement(&mut tail, ']')?;
        let mut mapping: Vec<(String, Option<String>)> = Vec::new();
        if let Some(rest) = tail.strip_prefix(".sheets[") {
            tail = rest;
            loop {
                let key = quoted(&mut tail, gnumeric)?;
                if mapping.iter().any(|(s, _)| sheet_key(s) == sheet_key(&key)) {
                    return None;
                }
                tail = tail.strip_prefix(',')?;
                let target = if let Some(rest) = tail.strip_prefix("null") {
                    tail = rest;
                    None
                } else {
                    Some(quoted(&mut tail, gnumeric)?)
                };
                mapping.push((key, target));
                if let Some(rest) = tail.strip_prefix(',') {
                    tail = rest;
                } else {
                    tail = tail.strip_prefix(']')?;
                    break;
                }
            }
        }
        if !relative && (row != 0 || column != 0) {
            return None;
        }
        tail = tail.strip_prefix(':')?;
        let name = quoted(&mut tail, gnumeric)?;
        Some((
            Self {
                name,
                relocation: Relocation {
                    relative,
                    fixed_sheet,
                    row,
                    column,
                    sheet,
                    mapping,
                },
            },
            tail,
        ))
    }

    pub(in crate::commands) fn translate(&mut self, offset: (i64, i64)) {
        if self.relocation.relative {
            self.relocation.row += offset.0;
            self.relocation.column += offset.1;
        }
    }

    pub(in crate::commands) fn render(&self, gnumeric: bool) -> String {
        let quote = |s: &str| {
            if gnumeric {
                format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
            } else {
                format!("\"{}\"", s.replace('"', "\"\""))
            }
        };
        let r = &self.relocation;
        let mut out = format!(
            "@name.{}{}[{},{},{}]",
            if r.relative { "relative" } else { "absolute" },
            if r.fixed_sheet { ".fixed-sheet" } else { "" },
            r.row,
            r.column,
            r.sheet
        );
        if !r.mapping.is_empty() {
            out.push_str(".sheets[");
            for (index, (key, value)) in r.mapping.iter().enumerate() {
                if index != 0 {
                    out.push(',');
                }
                out.push_str(&quote(key));
                out.push(',');
                out.push_str(&value.as_deref().map_or_else(|| "null".into(), quote));
            }
            out.push(']');
        }
        out.push(':');
        out.push_str(&quote(&self.name));
        out
    }
}

impl Relocation {
    pub(super) fn target(&self, source: usize, sheets: &[String]) -> Option<usize> {
        let name = sheets.get(source)?;
        let mapped = self
            .mapping
            .iter()
            .find(|(key, _)| sheet_key(key) == sheet_key(name));
        let target = if let Some((_, target)) = mapped {
            let target = target.as_ref()?;
            sheets
                .iter()
                .position(|s| sheet_key(s) == sheet_key(target))?
        } else {
            source
        };
        let target = usize::try_from(target as i64 + self.sheet).ok()?;
        (target < sheets.len()).then_some(target)
    }

    fn compose(&self, inner: &Self, sheets: &[String]) -> Self {
        let mut result = self.clone();
        result.row += inner.row;
        result.column += inner.column;
        result.sheet += inner.sheet;
        if !self.mapping.is_empty() || !inner.mapping.is_empty() {
            result.sheet = 0;
            result.mapping = sheets
                .iter()
                .enumerate()
                .map(|(index, name)| {
                    let target = inner
                        .target(index, sheets)
                        .and_then(|i| self.target(i, sheets));
                    (name.clone(), target.map(|i| sheets[i].clone()))
                })
                .collect();
        }
        result
    }
}

impl Calculation<'_> {
    pub(super) fn relocated_name(
        &self,
        index: usize,
        relocation: &Relocation,
        work: &mut usize,
    ) -> Option<Expr> {
        let name = self.book.names.get(index)?;
        if name.expression.is_empty() || name.expression == "=" {
            return Some(Expr::Value(Value::Blank));
        }
        let mut expression = self.names.get(index)?.as_ref().clone();
        let mut pending = vec![&mut expression];
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(std::mem::size_of::<Expr>())?;
            match node {
                Expr::Ref(first) | Expr::Range(first, _) => {
                    let mut valid = first.relocate(name.position, relocation, self.sheets);
                    if let Expr::Range(_, last) = node {
                        valid &= last.relocate(name.position, relocation, self.sheets);
                    }
                    if !valid {
                        *node = Expr::Value(Value::Error("#REF!"));
                    }
                }
                Expr::Label(anchor, ..) => {
                    if !anchor.relocate(name.position, relocation, self.sheets) {
                        *node = Expr::Value(Value::Error("#REF!"));
                    }
                }
                Expr::Radical(label) => {
                    let mut valid = true;
                    for anchor in &mut label.anchors {
                        valid &= anchor.relocate(name.position, relocation, self.sheets);
                    }
                    if let Some((first, last)) = &mut label.data {
                        valid &= first.relocate(name.position, relocation, self.sheets);
                        valid &= last.relocate(name.position, relocation, self.sheets);
                    }
                    if !valid {
                        *node = Expr::Value(Value::Error("#REF!"));
                    }
                }
                Expr::Name(index) => *node = Expr::LiveName(*index, Box::new(relocation.clone())),
                Expr::LiveName(_, inner) => **inner = relocation.compose(inner, self.sheets),
                Expr::Group(child) | Expr::Unary(_, child) => pending.push(child),
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                Expr::Call(_, args) => pending.extend(args),
                _ => {}
            }
        }
        Some(expression)
    }
}

pub(in crate::commands) fn reject_cycles(
    book: &mut super::Workbook,
    sheets: &[String],
    work: &mut usize,
    diagnostics: &mut String,
) -> Option<()> {
    use std::collections::{BTreeMap, BTreeSet};
    use std::fmt::Write;
    let mut accepted = BTreeMap::<usize, Vec<usize>>::new();
    for index in (0..book.names.len()).rev() {
        let name = &book.names[index];
        *work = work.checked_sub(name.expression.len() + 128)?;
        let Some(expression) = super::parse(
            super::Dialect::Gnumeric,
            &name.expression,
            sheets,
            book,
            name.position,
            name.sheet,
            false,
            Some(index),
            *work,
        )
        .ok()?
        else {
            continue;
        };
        let mut nodes = vec![&expression];
        let mut dependencies = Vec::new();
        while let Some(node) = nodes.pop() {
            *work = work.checked_sub(64)?;
            match node {
                Expr::Name(i) | Expr::LiveName(i, _) => dependencies.push(*i),
                Expr::Group(child) | Expr::Unary(_, child) => nodes.push(child),
                Expr::Binary(_, left, right) => nodes.extend([left.as_ref(), right.as_ref()]),
                Expr::Call(_, args) => nodes.extend(args),
                _ => {}
            }
        }
        expression.discard();
        let mut pending = dependencies.clone();
        let mut seen = BTreeSet::new();
        let mut cyclic = false;
        while let Some(i) = pending.pop() {
            *work = work.checked_sub(64)?;
            if book.names[i].name == name.name {
                cyclic = true;
                break;
            }
            if seen.insert(i) {
                pending.extend(accepted.get(&i).into_iter().flatten());
            }
        }
        if cyclic {
            writeln!(
                diagnostics,
                "Ignoring would-be circular definition of {}",
                name.name
            )
            .ok()?;
            let name = &mut book.names[index];
            name.expression.clear();
            name.position.1 = 0;
            name.position.2 = 0;
        } else {
            accepted.insert(index, dependencies);
        }
    }
    Some(())
}
