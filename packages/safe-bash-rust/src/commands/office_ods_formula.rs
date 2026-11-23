// Calculation and SpreadsheetML have different reference and operator syntax.
// Parse expressions before rendering so quoting and grouping survive conversion.
use super::super::office::{
    collation,
    formulas::live_names::LiveName,
    formulas::{Value, array_string_value},
    function_names, number_format,
};
#[derive(Clone, Copy, PartialEq)]
enum Syntax<'a> {
    Excel,
    Xlsx(&'a [String], &'a std::collections::BTreeMap<String, String>),
    GnumericXlsx(&'a [String]),
    GnumericOdfExport,
    Gnumeric,
    GnumericXml(bool),
    Sylk(usize, usize),
    GnumericOdf,
    Calculation,
    CompiledCalculation,
    Calc,
}
#[derive(Clone)]
enum Expr {
    Omitted,
    // A required empty argument retained after Microsoft optional-argument trimming.
    OmittedZero,
    Literal(String),
    Name(String),
    GlobalName(String),
    LiveName(Box<LiveName>),
    LabelText(String),
    Label(String, String), // native label prefix and anchor
    Radical(Box<RadicalLabel>),
    Bad(String),
    Number(f64, bool),
    Array(Vec<Vec<Expr>>),
    Reference {
        excel: String,
        odf: String,
        foreign: bool,
        unbracketed_name: bool,
    },
    // Keep the legacy ISOWEEKNUM method in lexical tokens, but omit it on export.
    Call(String, Vec<Expr>, bool),
    Group(Box<Expr>),
    Spaced(String, Box<Expr>, String),
    Unary(char, Box<Expr>),
    Binary(String, Box<Expr>, Box<Expr>),
}
#[derive(Clone)]
struct RadicalLabel {
    prefix: String,
    anchors: Vec<String>,
    data: Option<String>,
}
#[derive(Clone, Copy, PartialEq)]
enum SeparatorToken {
    Reference,
    RangeResult,
    UnionSeparator,
    Value,
}
struct SeparatorCompiler<'a> {
    names: &'a [crate::commands::structured::xlsx::NamedExpression],
    sheets: &'a [String],
    visiting: Vec<usize>,
    tokens: Vec<SeparatorToken>,
    failed: bool,
    stopped: bool,
    error: Option<&'static str>,
    work: &'a mut usize,
}
impl SeparatorCompiler<'_> {
    fn compile(
        &mut self,
        expression: &mut Expr,
        sheet: usize,
        bindings: Option<&std::collections::BTreeMap<String, Option<usize>>>,
        nested: bool,
        depth: usize,
    ) -> Result<(), &'static str> {
        if self.stopped {
            return Ok(());
        }
        if depth > 128 {
            return Err(super::LIMIT);
        }
        *self.work = self
            .work
            .checked_sub(std::mem::size_of::<Expr>())
            .ok_or(super::LIMIT)?;
        let token = match expression {
            Expr::Reference { .. }
            | Expr::Label(..)
            | Expr::Radical(..)
            | Expr::LabelText(_)
            | Expr::GlobalName(_)
            | Expr::LiveName(_) => SeparatorToken::Reference,
            Expr::Name(raw) => {
                let selected = if let Some(index) = bindings.and_then(|b| b.get(raw)) {
                    *index
                } else {
                    *self.work = self
                        .work
                        .checked_sub(self.names.iter().map(|n| n.name.len() * 4 + 32).sum())
                        .ok_or(super::LIMIT)?;
                    lookup_name(raw, true, sheet, self.sheets, self.work, |key| {
                        let key_name = super::super::office::case_fold::fold(&key.1);
                        self.names.iter().position(|n| {
                            n.sheet == key.0
                                && super::super::office::case_fold::fold(&n.name) == key_name
                        })
                    })?
                    .map(|(_, i)| i)
                };
                if selected.is_some_and(|i| self.visiting.contains(&i)) {
                    self.failed = true;
                }
                if let Some(index) = selected.filter(|i| !self.visiting.contains(i)) {
                    let name = &self.names[index];
                    let source = name
                        .compiled
                        .as_ref()
                        .map(|c| c.expression.as_str())
                        .or(name.openformula.as_deref())
                        .unwrap_or(&name.expression);
                    *self.work = self
                        .work
                        .checked_sub(source.len() * 4 + 128)
                        .ok_or(super::LIMIT)?;
                    if let Some(error) = source.strip_prefix("of:=").and_then(|source| {
                        [
                            "Err:501", "Err:502", "Err:504", "Err:508", "Err:509", "Err:510",
                            "Err:511", "Err:520", "Err:539",
                        ]
                        .into_iter()
                        .find(|error| *error == source)
                    }) {
                        self.error = Some(if error == "Err:520" && nested {
                            "Err:511"
                        } else {
                            error
                        });
                        self.stopped = true;
                        return Ok(());
                    }
                    let source = if source.starts_with("of:=") {
                        source.to_owned()
                    } else {
                        format!(
                            "{{http://schemas.microsoft.com/office/excel/formula}}={}",
                            source.strip_prefix("msoxl:=").unwrap_or(source)
                        )
                    };
                    let mut parsed = convert(false, &source, false, *self.work, true)?.unwrap();
                    if let Some(error) = parsed.error {
                        self.error = Some(if error == "Err:520" && nested {
                            "Err:511"
                        } else {
                            error
                        });
                        self.stopped = true;
                        return Ok(());
                    }
                    if let Some(expression) = parsed.expression.as_mut() {
                        self.visiting.push(index);
                        self.compile(
                            expression,
                            name.position.0,
                            name.compiled.as_ref().map(|c| &c.bindings),
                            nested,
                            depth + 1,
                        )?;
                        self.visiting.pop();
                        return Ok(());
                    }
                }
                SeparatorToken::Value
            }
            Expr::Spaced(_, child, _) => {
                return self.compile(child, sheet, bindings, nested, depth + 1);
            }
            Expr::Group(child) | Expr::Unary('+', child) => {
                return self.compile(child, sheet, bindings, true, depth + 1);
            }
            Expr::Unary(_, child) => {
                self.compile(child, sheet, bindings, true, depth + 1)?;
                SeparatorToken::Value
            }
            Expr::Call(name, args, _) => {
                if function_names::name(name, false).is_none()
                    && super::super::office::coordinate(name).is_some()
                {
                    self.error = Some("Err:509");
                    self.stopped = true;
                    return Ok(());
                }
                for arg in args {
                    self.compile(arg, sheet, bindings, true, depth + 1)?;
                }
                if matches!(name.as_str(), "INDIRECT" | "OFFSET") {
                    SeparatorToken::RangeResult
                } else {
                    SeparatorToken::Value
                }
            }
            Expr::Binary(..) => {
                let mut pending = Vec::new();
                let mut base = expression;
                while let Expr::Binary(op, left, right) = base {
                    *self.work = self
                        .work
                        .checked_sub(std::mem::size_of::<(&mut String, &mut Expr)>())
                        .ok_or(super::LIMIT)?;
                    pending.push((op, right.as_mut()));
                    base = left;
                }
                self.compile(base, sheet, bindings, true, depth + 1)?;
                for (op, right) in pending.into_iter().rev() {
                    if self.stopped {
                        return Ok(());
                    }
                    if matches!(op.as_str(), "~?" | ";" | "") || op == "," && !nested {
                        // A pending separator can use the reference emitted
                        // before the external grammar reaches an invalid operator.
                        self.stopped = true;
                        return Ok(());
                    }
                    let left_end = self.tokens.len();
                    self.compile(right, sheet, bindings, true, depth + 1)?;
                    let pair = self.tokens.len().checked_sub(2).map(|i| &self.tokens[i..]);
                    if op == ":"
                        && self.tokens.len() == left_end + 1
                        && pair == Some([SeparatorToken::Reference; 2].as_slice())
                    {
                        // Adjacent range endpoints collapse into one RPN reference.
                        self.tokens.pop();
                        continue;
                    }
                    let token = if op == "," {
                        if self.failed
                            || !pair.is_some_and(|p| {
                                p[0] != SeparatorToken::Value
                                    && matches!(
                                        p[1],
                                        SeparatorToken::Reference | SeparatorToken::RangeResult
                                    )
                            })
                        {
                            continue;
                        }
                        *op = "~;".into();
                        // A converted separator keeps its token type: it may
                        // precede another separator, but cannot be its right operand.
                        SeparatorToken::UnionSeparator
                    } else if matches!(op.as_str(), ":" | "!" | "~") {
                        SeparatorToken::RangeResult
                    } else {
                        SeparatorToken::Value
                    };
                    self.tokens.push(token);
                }
                return Ok(());
            }
            _ => SeparatorToken::Value,
        };
        if !self.stopped {
            self.tokens.push(token);
        }
        Ok(())
    }
}
impl Expr {
    fn public_union(
        self,
        right: Expr,
        work: &mut usize,
        depth: usize,
    ) -> Result<Expr, &'static str> {
        *work = work
            .checked_sub(std::mem::size_of::<Expr>())
            .ok_or(super::LIMIT)?;
        if depth > 64 {
            return Err(super::LIMIT);
        }
        let left = match self {
            Self::Unary(op @ ('+' | '-'), child) => {
                return Ok(Self::Unary(
                    op,
                    Box::new(child.public_union(right, work, depth + 1)?),
                ));
            }
            Self::Binary(op, a, b) if precedence(&op) < 8 && op != "," => {
                return Ok(Self::Binary(
                    op,
                    a,
                    Box::new(b.public_union(right, work, depth + 1)?),
                ));
            }
            other => other,
        };
        match right {
            Self::Binary(op, a, b) if precedence(&op) < 8 && op != "," => Ok(Self::Binary(
                op,
                Box::new(left.public_union(*a, work, depth + 1)?),
                b,
            )),
            Self::Unary('%', child) => Ok(Self::Unary(
                '%',
                Box::new(left.public_union(*child, work, depth + 1)?),
            )),
            other => Ok(Self::Binary("~".into(), Box::new(left), Box::new(other))),
        }
    }

    fn adjacency_error(&self, work: &mut usize) -> Result<Option<&'static str>, &'static str> {
        let mut pending = vec![(self, false, false)];
        while let Some((value, nested, visit)) = pending.pop() {
            *work = work.checked_sub(32).ok_or(super::LIMIT)?;
            if visit {
                if let Expr::Binary(op, left, right) = value
                    && op.is_empty()
                {
                    let mut first = right.as_ref();
                    let mut previous = left.as_ref();
                    loop {
                        *work = work.checked_sub(16).ok_or(super::LIMIT)?;
                        match first {
                            Expr::Spaced(_, child, _) | Expr::Binary(_, child, _) => first = child,
                            _ => break,
                        }
                    }
                    while let Expr::Spaced(_, child, _) = previous {
                        previous = child;
                    }
                    return Ok(Some(
                        if nested
                            && (matches!(first, Expr::Bad(_))
                                || matches!(first, Expr::Name(_) | Expr::Group(_))
                                    && !matches!(
                                        previous,
                                        Expr::Number(..)
                                            | Expr::Reference { .. }
                                            | Expr::Literal(_)
                                    ))
                        {
                            "Err:508"
                        } else {
                            "Err:509"
                        },
                    ));
                }
                continue;
            }
            match value {
                Expr::Call(_, args, _) => {
                    pending.extend(args.iter().rev().map(|arg| (arg, true, false)))
                }
                Expr::Group(child) => pending.push((child, true, false)),
                Expr::Spaced(_, child, _) | Expr::Unary(_, child) => {
                    pending.push((child, nested, false))
                }
                Expr::Binary(_, a, b) => pending.extend([
                    (b.as_ref(), nested, false),
                    (value, nested, true),
                    (a.as_ref(), nested, false),
                ]),
                _ => {}
            }
        }
        Ok(None)
    }
    fn precedence(&self) -> u8 {
        match self {
            Self::Binary(op, ..) => precedence(op),
            Self::Unary('%', _) => 7,
            Self::Unary(..) => 6,
            Self::Spaced(_, e, _) => e.precedence(),
            _ => 11,
        }
    }
    fn odf_rounding(name: &str, args: &[Self], public: bool) -> Self {
        if !(1..=3).contains(&args.len()) {
            return Self::Call(format!("ODF.{name}"), args.to_vec(), false);
        }
        if name == "CEILING" && args.len() == 1 {
            return Self::Call(
                if public { "CEIL" } else { "_xlfngnumeric.CEIL" }.into(),
                args.to_vec(),
                false,
            );
        }
        let x = &args[0];
        let significance = args
            .get(1)
            .cloned()
            .unwrap_or_else(|| Self::Call("SIGN".into(), vec![x.clone()], false));
        let mode_one = Self::Call(
            if public {
                name.to_owned()
            } else {
                format!("{name}.XCL")
            },
            vec![x.clone(), significance.clone()],
            false,
        );
        let mode_zero = Self::Call(
            "IF".into(),
            vec![
                Self::Binary(
                    "<".into(),
                    Box::new(x.clone()),
                    Box::new(Self::Number(0., false)),
                ),
                Self::Call(
                    match (name == "FLOOR", public) {
                        (true, true) => "CEILING",
                        (true, false) => "CEILING.XCL",
                        (false, true) => "FLOOR",
                        (false, false) => "FLOOR.XCL",
                    }
                    .into(),
                    vec![x.clone(), significance],
                    false,
                ),
                mode_one.clone(),
            ],
            false,
        );
        match args.get(2) {
            Some(Self::Number(n, false)) if *n != 0. => mode_one,
            None | Some(Self::Number(_, false)) => mode_zero,
            Some(mode) => Self::Call(
                "IF".into(),
                vec![
                    Self::Binary(
                        "=".into(),
                        Box::new(Self::Number(0., false)),
                        Box::new(mode.clone()),
                    ),
                    mode_zero,
                    mode_one,
                ],
                false,
            ),
        }
    }

    fn foreign(&self, gnumeric: bool) -> bool {
        match self {
            Self::Reference { foreign, .. } => *foreign,
            Self::Call(..)
            | Self::Bad(_)
            | Self::Label(..)
            | Self::Radical(..)
            | Self::LabelText(_) => true,
            Self::Name(s) => s.contains(['.', '!', '\'', '$']),
            Self::Number(n, _) => {
                number_format::number(*n, true).parse::<f64>() != Ok(*n)
                    || gnumeric
                        && n.is_finite()
                        && number_format::exact(*n) != Value::Number(*n).cached()
            }
            Self::Array(rows) => {
                gnumeric || rows.iter().flatten().any(|value| value.foreign(gnumeric))
            }
            Self::Literal(s) => {
                gnumeric && matches!(s.as_str(), "TRUE" | "FALSE")
                    || s.contains(',') && s.as_bytes().first().is_some_and(u8::is_ascii_digit)
            }
            Self::Unary('+' | '-', e) if gnumeric && e.precedence() == 6 => true,
            Self::Unary('%', e) if gnumeric && e.precedence() == 7 => true,
            Self::Spaced(..) if gnumeric => true,
            Self::Unary(_, e) | Self::Group(e) | Self::Spaced(_, e, _) => e.foreign(gnumeric),
            Self::Binary(..) => {
                let mut base = self;
                while let Self::Binary(op, a, b) = base {
                    if matches!(op.as_str(), "~" | "~;" | "~?" | "!") || b.foreign(gnumeric) {
                        return true;
                    }
                    base = a;
                }
                base.foreign(gnumeric)
            }
            _ => false,
        }
    }
    fn render(&self, syntax: Syntax, remaining: &mut usize) -> Result<String, &'static str> {
        let odf = matches!(
            syntax,
            Syntax::Calculation
                | Syntax::CompiledCalculation
                | Syntax::GnumericOdf
                | Syntax::GnumericOdfExport
        );
        let out = match self {
            Self::GlobalName(name) => {
                if syntax == Syntax::GnumericOdfExport {
                    return Err(
                        "Unsupported ssconvert feature: global formula name in target grammar\n",
                    );
                }
                format!("[]{name}")
            }
            Self::LiveName(name) => {
                if matches!(syntax, Syntax::GnumericXml(_)) {
                    return Err(
                        "Unsupported ssconvert feature: live name relocation in Gnumeric output\n",
                    );
                }
                if matches!(
                    syntax,
                    Syntax::Xlsx(..)
                        | Syntax::GnumericXlsx(..)
                        | Syntax::Sylk(..)
                        | Syntax::GnumericOdfExport
                ) {
                    return Err(
                        "Unsupported ssconvert feature: live name relocation in target grammar\n",
                    );
                }
                name.render(!odf)
            }
            Self::LabelText(text) => format!("'{}'", text.replace('\'', "''")),
            Self::Label(..) | Self::Radical(..) => {
                if matches!(syntax, Syntax::GnumericXml(_)) {
                    return Err(
                        "Unsupported ssconvert feature: live label reference in Gnumeric output\n",
                    );
                }
                if matches!(
                    syntax,
                    Syntax::Xlsx(..) | Syntax::GnumericXlsx(..) | Syntax::Sylk(..)
                ) {
                    return Err(
                        "Unsupported ssconvert feature: live label reference in target grammar\n",
                    );
                }
                match self {
                    Self::Label(prefix, anchor) => {
                        let reference = reference(anchor, '.', &[], true).ok_or(super::LIMIT)?;
                        format!("{prefix}:{}", reference.render(syntax, remaining)?)
                    }
                    Self::Radical(label) => {
                        let mut rendered = Vec::new();
                        for anchor in &label.anchors {
                            rendered.push(
                                reference(anchor, '.', &[], true)
                                    .ok_or(super::LIMIT)?
                                    .render(syntax, remaining)?,
                            );
                        }
                        let anchors = if label.prefix.contains(".multi") {
                            format!("{{{}}}", rendered.join(";"))
                        } else {
                            rendered.join("")
                        };
                        let data = if let Some(data) = &label.data {
                            reference(data, '.', &[], true)
                                .ok_or(super::LIMIT)?
                                .render(syntax, remaining)?
                        } else {
                            "#REF!".into()
                        };
                        format!("{}:{anchors}->{data}", label.prefix)
                    }
                    _ => unreachable!(),
                }
            }
            Self::Omitted => String::new(),
            Self::OmittedZero => {
                if odf {
                    "0".into()
                } else {
                    String::new()
                }
            }
            Self::Literal(s) => {
                if matches!(syntax, Syntax::Sylk(..)) && s.starts_with('"') && s.ends_with('"') {
                    format!("\"{}\"", s[1..s.len() - 1].replace("\"\"", "\""))
                } else if matches!(syntax, Syntax::Gnumeric | Syntax::GnumericXml(_))
                    && s.starts_with('"')
                    && s.ends_with('"')
                {
                    format!(
                        "\"{}\"",
                        s[1..s.len() - 1]
                            .replace("\"\"", "\"")
                            .replace('\\', "\\\\")
                            .replace('"', "\\\"")
                    )
                } else if syntax == Syntax::GnumericOdfExport
                    && matches!(s.as_str(), "TRUE" | "FALSE")
                {
                    format!("{s}()")
                } else {
                    s.clone()
                }
            }
            Self::Name(s) => {
                if let Syntax::Xlsx(_, changes) = syntax {
                    rename(s, changes, remaining)?
                } else if matches!(syntax, Syntax::GnumericXlsx(..))
                    && let Some((sheet, name)) = qualified(s, '!')
                {
                    let sheet = sheet
                        .strip_prefix('\'')
                        .and_then(|s| s.strip_suffix('\''))
                        .map_or_else(|| sheet.to_owned(), |s| s.replace("''", "'"));
                    format!("'{}'!{name}", sheet.replace('\'', "''"))
                } else if syntax == Syntax::Calc {
                    qualified(s, '!').map_or_else(
                        || s.clone(),
                        |(sheet, name)| {
                            let unquoted = sheet
                                .strip_prefix('\'')
                                .and_then(|s| s.strip_suffix('\''))
                                .map(|s| s.replace("''", "'"));
                            let sheet = unquoted.map_or_else(
                                || sheet.to_owned(),
                                |sheet| super::super::office::sheet_name::quote_sheet(&sheet),
                            );
                            format!("{sheet}.{name}")
                        },
                    )
                } else {
                    s.clone()
                }
            }
            Self::Bad(s) => {
                if odf {
                    // A quoted, invalid reference stays an error even when a
                    // declared name has the same spelling. CSV retains its token.
                    format!("['{}']", s.replace('\'', "''"))
                } else {
                    s.clone()
                }
            }
            Self::Number(n, percent) => {
                let mut value = if matches!(
                    syntax,
                    Syntax::Gnumeric
                        | Syntax::GnumericXml(_)
                        | Syntax::Sylk(..)
                        | Syntax::GnumericXlsx(..)
                ) && n.is_finite()
                {
                    Value::Number(*n).cached()
                } else if matches!(
                    syntax,
                    Syntax::Calculation | Syntax::GnumericOdf | Syntax::GnumericOdfExport
                ) && n.is_finite()
                {
                    Value::Number(*n).cached()
                } else if *n == 0. && n.is_sign_negative() {
                    "-0".into()
                } else {
                    number_format::exact(*n)
                };
                if *percent {
                    value.push('%');
                }
                value
            }
            Self::Array(rows) => format!(
                "{{{}}}",
                rows.iter()
                    .map(|row| row
                        .iter()
                        .map(|v| {
                            if !matches!(
                                syntax,
                                Syntax::GnumericXlsx(..)
                                    | Syntax::Gnumeric
                                    | Syntax::GnumericXml(_)
                                    | Syntax::Sylk(..)
                                    | Syntax::GnumericOdf
                                    | Syntax::GnumericOdfExport
                            ) {
                                if matches!(v, Self::Omitted) {
                                    return Ok("\"\"".into());
                                }
                                if let Self::Unary('+', child) = v
                                    && matches!(child.as_ref(), Self::Number(_, false))
                                {
                                    return child.render(syntax, remaining);
                                }
                            }
                            v.render(syntax, remaining)
                        })
                        .collect::<Result<Vec<_>, _>>()
                        .map(|v| v.join(if odf { ";" } else { "," })))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(if odf { "|" } else { ";" })
            ),
            Self::Group(e) => format!("({})", e.render(syntax, remaining)?),
            Self::Spaced(before, e, after) => {
                if matches!(
                    syntax,
                    Syntax::Gnumeric
                        | Syntax::GnumericXml(_)
                        | Syntax::Sylk(..)
                        | Syntax::GnumericXlsx(..)
                ) {
                    e.render(syntax, remaining)?
                } else {
                    format!("{before}{}{after}", e.render(syntax, remaining)?)
                }
            }
            Self::Reference {
                excel,
                odf: source,
                unbracketed_name,
                ..
            } => {
                let source = if syntax == Syntax::GnumericOdfExport
                    && range_split(source).is_none()
                    && endpoint(source, '.', true)
                        .is_some_and(|part| part.sheet.is_some() && part.position.is_none())
                {
                    source.strip_prefix('$').unwrap_or(source)
                } else {
                    source.as_str()
                };
                if let Syntax::Sylk(row, column) = syntax {
                    sylk::write_reference(source, (row, column))
                } else if syntax == Syntax::GnumericOdfExport && *unbracketed_name {
                    source.to_owned()
                } else if odf {
                    format!("[{source}]")
                } else if matches!(syntax, Syntax::Gnumeric | Syntax::GnumericXml(_)) {
                    let (first, last) = range_split(source)
                        .map_or((source, None), |i| (&source[..i], Some(&source[i + 1..])));
                    let parts: Vec<_> = std::iter::once(first)
                        .chain(last)
                        .filter_map(|part| endpoint(part, '.', true))
                        .collect();
                    let mut text = String::new();
                    for (index, part) in parts.iter().enumerate() {
                        let sheet = part.sheet.as_ref().or(parts[0].sheet.as_ref());
                        if index > 0 {
                            if part.position.is_some()
                                && part.cell == parts[0].cell
                                && sheet == parts[0].sheet.as_ref()
                            {
                                break;
                            }
                            text.push(':');
                        }
                        if let Some(book) = &part.workbook
                            && (index == 0
                                || part.workbook != parts[0].workbook
                                || sheet != parts[0].sheet.as_ref())
                        {
                            text.push_str(&format!(
                                "[\"{}\"]",
                                book.replace('\\', "\\\\").replace('"', "\\\"")
                            ));
                        }
                        if let Some(sheet) = sheet
                            && (index == 0 || Some(sheet) != parts[0].sheet.as_ref())
                        {
                            if matches!(syntax, Syntax::GnumericXml(names)
                                if !part.relative && (!names || part.position.is_some() || last.is_some()))
                            {
                                text.push_str(
                                    &super::super::office::sheet_name::quote_gnumeric_sheet(sheet),
                                );
                                text.push('!');
                            } else {
                                text.push('\'');
                                text.push_str(&sheet.replace('\\', "\\\\").replace('\'', "\\'"));
                                text.push_str("'!");
                            }
                        }
                        text.push_str(&part.cell);
                    }
                    text
                } else if let Syntax::Xlsx(sheets, changes) = syntax {
                    super::super::office::xlsx_references::export(
                        &rename(excel, changes, remaining)?,
                        sheets,
                        remaining,
                    )?
                } else if matches!(syntax, Syntax::GnumericXlsx(..)) {
                    // Excel quotes sheet names. Retain a singleton range when
                    // its relative sheet identity survives in OpenFormula.
                    let mut text = excel.clone();
                    if range_split(source).is_none()
                        && let Some(part) = endpoint(source, '.', true)
                        && part.position.is_none()
                        && part.workbook.is_none()
                        && let Some(sheet) = part.sheet
                        && !sheet.starts_with('[')
                    {
                        text = format!("'{}'!{}", sheet.replace('\'', "''"), part.cell);
                    }
                    if let Some(i) = range_split(source)
                        && !text.contains(':')
                        && let Some(first) = endpoint(&source[..i], '.', true)
                        && first.sheet.is_some()
                        && first.relative
                        && let Some(last) = endpoint(&source[i + 1..], '.', true)
                    {
                        text.push(':');
                        text.push_str(&last.cell);
                    }
                    if let Some(i) = range_split(source)
                        && let Some(first) = endpoint(&source[..i], '.', true)
                        && let Some(last) = endpoint(&source[i + 1..], '.', true)
                        && first.position.is_some()
                        && first.cell == last.cell
                        && first.workbook.is_none()
                        && last.workbook.is_none()
                        && first.sheet != last.sheet
                        && let (Some(first_sheet), Some(last_sheet)) = (first.sheet, last.sheet)
                    {
                        text = format!(
                            "'{}':'{}'!{}",
                            first_sheet.replace('\'', "''"),
                            last_sheet.replace('\'', "''"),
                            first.cell
                        );
                    }
                    text
                } else if syntax == Syntax::Calc {
                    let split = range_split(source);
                    let (first, last) =
                        split.map_or((source, None), |i| (&source[..i], Some(&source[i + 1..])));
                    let mut parts = Vec::new();
                    for raw in std::iter::once(first).chain(last) {
                        let Some(part) = endpoint(raw, '.', false) else {
                            parts.push(raw.into());
                            continue;
                        };
                        let mut text = String::new();
                        if let Some(sheet) = &part.sheet {
                            if !part.relative {
                                text.push('$');
                            }
                            text.push_str(&super::super::office::sheet_name::quote_sheet(sheet));
                            text.push('.');
                        }
                        text.push_str(&part.cell);
                        parts.push(text);
                    }
                    parts.join(":")
                } else {
                    excel.clone()
                }
            }
            Self::Call(name, args, omit_method) => {
                if matches!(syntax, Syntax::Excel | Syntax::Xlsx(..))
                    && matches!(name.as_str(), "FLOOR" | "CEILING")
                {
                    return Self::odf_rounding(name, args, false).render(syntax, remaining);
                }
                let mut rendered = Vec::new();
                for a in args.iter().take(args.len() - usize::from(*omit_method)) {
                    let mut pending = vec![a];
                    while let Some(argument) = pending.pop() {
                        if syntax != Syntax::CompiledCalculation
                            && let Self::Binary(op, left, right) = argument
                            && op == "~"
                        {
                            pending.extend([right.as_ref(), left.as_ref()]);
                        } else {
                            rendered.push(argument.render(syntax, remaining)?);
                        }
                    }
                }
                if matches!(syntax, Syntax::GnumericXlsx(..)) && name == "FLOOR" && args.len() == 1
                {
                    return Self::Call(
                        "ROUNDDOWN".into(),
                        vec![args[0].clone(), Self::Number(0., false)],
                        false,
                    )
                    .render(syntax, remaining);
                }
                if matches!(syntax, Syntax::GnumericXlsx(..))
                    && matches!(name.as_str(), "R.QNORM" | "R.QLNORM" | "R.QCHISQ")
                    && if name == "R.QCHISQ" {
                        (2..=4).contains(&args.len())
                    } else {
                        (3..=5).contains(&args.len())
                    }
                {
                    let parameters = if name == "R.QCHISQ" { 1 } else { 2 };
                    let constant = |argument: Option<&Self>, fallback| {
                        let Some(mut argument) = argument else {
                            return Some(fallback);
                        };
                        while let Self::Spaced(_, child, _) = argument {
                            argument = child;
                        }
                        match argument {
                            Self::Number(n, _) => Some(*n != 0.),
                            Self::Literal(s) if s == "TRUE" || s == "FALSE" => Some(s == "TRUE"),
                            _ => None,
                        }
                    };
                    let lower = constant(args.get(parameters + 1), true);
                    let logarithmic = constant(args.get(parameters + 2), false);
                    let call = |lower, logarithmic| {
                        let probability = if logarithmic {
                            format!("exp({})", rendered[0])
                        } else {
                            rendered[0].clone()
                        };
                        if name == "R.QCHISQ" {
                            return format!(
                                "_xlfn.CHISQ.INV{}({},{})",
                                if lower { "" } else { ".RT" },
                                probability,
                                rendered[1]
                            );
                        }
                        format!(
                            "{}({}{},{},{})",
                            if name == "R.QNORM" {
                                "_xlfn.NORM.INV"
                            } else {
                                "_xlfn.LOGNORM.INV"
                            },
                            if lower { "" } else { "1-" },
                            probability,
                            rendered[1],
                            rendered[2]
                        )
                    };
                    let logarithmic = |lower| match logarithmic {
                        Some(value) => call(lower, value),
                        None => format!(
                            "if({},{},{})",
                            rendered[parameters + 2],
                            call(lower, true),
                            call(lower, false)
                        ),
                    };
                    let value = match lower {
                        Some(value) => logarithmic(value),
                        None => format!(
                            "if({},{},{})",
                            rendered[parameters + 1],
                            logarithmic(true),
                            logarithmic(false)
                        ),
                    };
                    *remaining = remaining.checked_sub(value.len()).ok_or(super::LIMIT)?;
                    return Ok(value);
                }
                if let Syntax::GnumericXlsx(sheets) = syntax
                    && name == "INDEX"
                    && (1..=4).contains(&args.len())
                {
                    let mut source = &args[0];
                    while let Self::Group(child) | Self::Spaced(_, child, _) = source {
                        source = child;
                    }
                    if let Self::Reference { odf, .. } = source
                        && let Some(split) = range_split(odf)
                        && let Some(first) = endpoint(&odf[..split], '.', true)
                        && first.workbook.is_none()
                        && let Some(last) = endpoint(&odf[split + 1..], '.', true)
                        && let Some(a) = sheets.iter().position(|s| {
                            first
                                .sheet
                                .as_deref()
                                .is_some_and(|n| super::super::office::case_fold::same_name(s, n))
                        })
                        && let Some(b) = sheets.iter().position(|s| {
                            last.sheet
                                .as_deref()
                                .is_some_and(|n| super::super::office::case_fold::same_name(s, n))
                        })
                        && a != b
                    {
                        let mut areas = Vec::new();
                        for sheet in &sheets[a.min(b)..=a.max(b)] {
                            let area = format!(
                                "'{}'!{}:{}",
                                sheet.replace('\'', "''"),
                                first.cell,
                                last.cell
                            );
                            *remaining = remaining.checked_sub(area.len()).ok_or(super::LIMIT)?;
                            areas.push(area);
                        }
                        rendered[0] = format!("({})", areas.join(","));
                    }
                }
                if syntax == Syntax::CompiledCalculation {
                    // ODF serialization fills optional arguments before Calc
                    // compares the previous cell's spelling with the new source.
                    match (name.as_str(), args.len()) {
                        ("NORMDIST" | "GAMMADIST", 3)
                        | ("LOGINV" | "LOGNORMDIST" | "POISSON", 2) => {
                            rendered.push("1".into());
                        }
                        ("LOGINV" | "LOGNORMDIST", 1) => {
                            rendered.extend(["0".into(), "1".into()]);
                        }
                        _ => {}
                    }
                }
                let qualified;
                let name = match syntax {
                    Syntax::Sylk(..)
                        if matches!(
                            name.as_str(),
                            "IF" | "SUM"
                                | "PRODUCT"
                                | "RAND"
                                | "INDIRECT"
                                | "TABLE"
                                | "GNUMERIC_VERSION"
                                | "TRUE"
                                | "FALSE"
                        ) =>
                    {
                        qualified = name.to_ascii_lowercase();
                        &qualified
                    }
                    Syntax::Gnumeric | Syntax::GnumericXml(_) | Syntax::Sylk(..) => {
                        qualified = function_names::public_native(name);
                        &qualified
                    }
                    Syntax::GnumericXlsx(..) if name == "ERF" && args.len() != 1 => name,
                    Syntax::GnumericXlsx(..) => {
                        if name == "HYPGEOMDIST" && args.len() != 5 {
                            rendered.push("FALSE".into());
                        }
                        function_names::production_xlsx(name)
                    }
                    Syntax::Calculation | Syntax::CompiledCalculation => {
                        function_names::openformula(name)
                    }
                    Syntax::GnumericOdf | Syntax::GnumericOdfExport
                        if matches!(name.as_str(), "XMATCH" | "XLOOKUP" | "FLOOR" | "CEILING")
                            || syntax == Syntax::GnumericOdfExport
                                && matches!(
                                    name.as_str(),
                                    "R.DNORM"
                                        | "R.DLNORM"
                                        | "R.PNORM"
                                        | "R.PLNORM"
                                        | "R.QNORM"
                                        | "R.QLNORM"
                                )
                            || function_names::public_odf(name) != *name =>
                    {
                        // A canonical name must survive another ODF parse
                        // without applying an alias or stripping a prefix again.
                        qualified = format!("ORG.GNUMERIC.{name}");
                        &qualified
                    }
                    Syntax::GnumericOdf | Syntax::GnumericOdfExport => name,
                    // The optional-argument rewriter distinguishes the old
                    // hypergeometric call before exporting its modern spelling.
                    Syntax::Excel | Syntax::Xlsx(..) if name == "HYPGEOMDIST" => name,
                    Syntax::Excel | Syntax::Xlsx(..) => {
                        function_names::name(name, true).unwrap_or(name)
                    }
                    Syntax::Calc => name,
                };
                format!("{name}({})", rendered.join(if odf { ";" } else { "," }))
            }
            Self::Unary('%', e) => {
                let child = e.render(syntax, remaining)?;
                if matches!(syntax, Syntax::Xlsx(..) | Syntax::GnumericXlsx(..))
                    && e.precedence() == 7
                {
                    format!("({child})%")
                } else {
                    format!("{child}%")
                }
            }
            Self::Unary(op, e) => {
                let s = e.render(syntax, remaining)?;
                format!(
                    "{op}{}",
                    if syntax != Syntax::CompiledCalculation && e.precedence() < 6
                        || matches!(
                            syntax,
                            Syntax::Gnumeric
                                | Syntax::GnumericXml(_)
                                | Syntax::Sylk(..)
                                | Syntax::GnumericXlsx(..)
                        ) && e.precedence() == 6
                    {
                        format!("({s})")
                    } else {
                        s
                    }
                )
            }
            Self::Binary(..) => {
                let mut pending = Vec::new();
                let mut base = self;
                while let Self::Binary(op, a, b) = base {
                    if op == "!!" {
                        if matches!(syntax, Syntax::GnumericXml(_)) {
                            return Err(
                                "Unsupported ssconvert feature: automatic label intersection in Gnumeric output\n",
                            );
                        }
                        if matches!(syntax, Syntax::GnumericXlsx(..) | Syntax::Sylk(..)) {
                            return Err(
                                "Unsupported ssconvert feature: automatic label intersection in target grammar\n",
                            );
                        }
                    }
                    *remaining = remaining
                        .checked_sub(std::mem::size_of::<(&str, &Expr, &Expr)>())
                        .ok_or(super::LIMIT)?;
                    pending.push((op.as_str(), a.as_ref(), b.as_ref()));
                    base = a;
                }
                let mut out = base.render(syntax, remaining)?;
                for (op, a, b) in pending.into_iter().rev() {
                    if syntax != Syntax::CompiledCalculation
                        && (a.precedence() < precedence(op)
                            && !matches!(a, Self::Binary(sep, ..) if sep == ",")
                            && !matches!(a, Self::Unary('+' | '%', _))
                            || op == "^"
                                && (matches!(a, Expr::Unary('+' | '-', _))
                                    || matches!(
                                        syntax,
                                        Syntax::GnumericXlsx(..) | Syntax::Sylk(..)
                                    ) && a.precedence() == 6)
                            || syntax == Syntax::Calculation
                                && op == "!"
                                && matches!(a, Expr::Name(_)))
                    {
                        *remaining = remaining.checked_sub(2).ok_or(super::LIMIT)?;
                        out.insert(0, '(');
                        out.push(')');
                    }
                    let mut right = b.render(syntax, remaining)?;
                    if matches!(syntax, Syntax::GnumericXlsx(..))
                        && op == ":"
                        && matches!(a, Self::Reference { odf, .. } if endpoint(odf, '.', true).is_some_and(|p| p.position.is_some()))
                        && matches!(b, Self::Name(name) if name.bytes().all(|b| b.is_ascii_alphabetic()))
                    {
                        right.make_ascii_uppercase();
                    }
                    let wrap = syntax != Syntax::CompiledCalculation
                        && (b.precedence() < precedence(op)
                            && !matches!(b, Self::Unary('+' | '-', _))
                            || b.precedence() == precedence(op) && matches!(op, "-" | "/" | "^"));
                    let op = match (syntax, op) {
                        (
                            Syntax::Excel
                            | Syntax::Xlsx(..)
                            | Syntax::GnumericXlsx(..)
                            | Syntax::Gnumeric
                            | Syntax::GnumericXml(_)
                            | Syntax::Sylk(..),
                            "~" | "~;",
                        ) => ",",
                        (_, "~;") => "~",
                        (_, "~?") => "~",
                        (
                            Syntax::Excel
                            | Syntax::Xlsx(..)
                            | Syntax::GnumericXlsx(..)
                            | Syntax::Gnumeric
                            | Syntax::GnumericXml(_)
                            | Syntax::Sylk(..),
                            "!",
                        ) => " ",
                        (
                            Syntax::Calculation
                            | Syntax::CompiledCalculation
                            | Syntax::GnumericOdf
                            | Syntax::GnumericOdfExport,
                            ",",
                        ) => ";",
                        _ => op,
                    };
                    *remaining = remaining
                        .checked_sub(op.len() + if wrap { 2 } else { 0 })
                        .ok_or(super::LIMIT)?;
                    out.push_str(if matches!(op, "()" | "[]") { "" } else { op });
                    if op == "()" && odf {
                        out.push('(');
                    }
                    if wrap {
                        out.push('(');
                    }
                    out.push_str(&right);
                    if wrap {
                        out.push(')');
                    }
                    if op == "()" && odf {
                        out.push(')');
                    }
                    if op == ":"
                        && matches!((a, b), (Self::Reference { .. }, Self::Reference { .. }))
                        && let Syntax::Xlsx(sheets, _) = syntax
                    {
                        out =
                            super::super::office::xlsx_references::export(&out, sheets, remaining)?;
                    }
                }
                out
            }
        };
        *remaining = remaining.checked_sub(out.len()).ok_or(super::LIMIT)?;
        Ok(out)
    }
}
fn precedence(op: &str) -> u8 {
    match op {
        "=" | "<>" | "<" | ">" | "<=" | ">=" => 1,
        "&" => 2,
        "+" | "-" => 3,
        "*" | "/" => 4,
        "^" => 5,
        "," | "~;" => 0,
        "~" | "~?" | ";" => 8,
        "" | "()" | "[]" => 10,
        "!" => 9,
        ":" => 10,
        "!!" => 11,
        _ => 0,
    }
}
#[path = "office_ods_formula_sylk.rs"]
mod sylk;
pub(in crate::commands) use sylk::{read as sylk, write as write_sylk};

struct Parser<'a> {
    sylk: Option<(usize, usize)>,
    discovered_names: Option<&'a mut Vec<(Option<usize>, String)>>,
    invalid_public_syntax: bool,
    native: bool,
    native_diagnostic: Option<(usize, usize)>,
    gnumeric: bool,
    source: &'a str,
    pos: usize,
    nodes: usize,
    limited: bool,
    work: usize,
    sheet_separator: char,
    legacy: bool,
    excel: bool,
    normalized: bool,
    arrays: usize,
    in_array: bool,
    has_bindings: bool,
    separators: bool,
    error: Option<&'static str>,
}
impl<'a> Parser<'a> {
    fn space(&mut self) {
        while self
            .source
            .as_bytes()
            .get(self.pos)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.pos += 1;
        }
    }
    fn take(&mut self, c: u8) -> bool {
        self.space();
        if self.source.as_bytes().get(self.pos) == Some(&c) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    fn expression(&mut self, min: u8, depth: usize, stop_separator: bool) -> Option<Expr> {
        if depth > 64 {
            return None;
        }
        if self.nodes == 0 {
            self.limited = true;
            return None;
        }
        self.nodes -= 1;
        self.space();
        let mut left = if self.take(b'+') {
            Expr::Unary(
                '+',
                Box::new(self.expression(
                    if self.gnumeric { 8 } else { 6 },
                    depth + 1,
                    stop_separator,
                )?),
            )
        } else if self.take(b'-') {
            Expr::Unary(
                '-',
                Box::new(self.expression(
                    if self.gnumeric { 8 } else { 6 },
                    depth + 1,
                    stop_separator,
                )?),
            )
        } else {
            self.atom(depth + 1)?
        };
        let mut postfix = 0;
        loop {
            self.space();
            if min <= 7 && self.take(b'%') {
                postfix += 1;
                if self.nodes == 0 || depth + postfix > 64 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                left = Expr::Unary('%', Box::new(left));
                continue;
            }
            let rest = &self.source[self.pos..];
            if stop_separator
                && (rest.starts_with(',')
                    || (!self.excel || self.arrays > 0) && rest.starts_with(';'))
            {
                break;
            }
            let op = [
                "<=", ">=", "<>", "+", "-", "*", "/", "^", "&", "=", "<", ">", "~", "!!", "!", ":",
                ",", ";",
            ]
            .into_iter()
            .find(|op| (*op != "!!" || self.gnumeric && !self.legacy) && rest.starts_with(op));
            let adjacent = rest.as_bytes().first().is_some_and(|b| {
                b.is_ascii_alphanumeric()
                    || *b == b'.'
                    || self.excel && matches!(b, b'[' | b']' | b'\'' | b'(' | b'_' | b'$')
            });
            let Some(op) = op.or_else(|| adjacent.then_some("")) else {
                break;
            };
            if op == "," && !self.excel {
                return None;
            }
            let token = op;
            if self.excel && token == "~" {
                self.error
                    .get_or_insert(if stop_separator { "Err:508" } else { "Err:509" });
            }
            let op = if op == "~" && self.excel {
                "~?"
            } else if op == ";" && !self.excel {
                ","
            } else {
                op
            };
            if op.is_empty() && self.excel {
                self.has_bindings = true;
            }
            if op.is_empty() && !self.excel || self.excel && op == "," && !stop_separator {
                self.error.get_or_insert(
                    if !self.excel
                        && stop_separator
                        && matches!(&left, Expr::Literal(raw) if raw.ends_with(','))
                    {
                        "Err:508"
                    } else {
                        "Err:509"
                    },
                );
            }
            self.separators |= op == ",";
            if op == ";" {
                self.error
                    .get_or_insert(if stop_separator { "Err:508" } else { "Err:509" });
            }
            let prec = if self.gnumeric && self.excel && op.is_empty() {
                precedence("!")
            } else {
                precedence(op)
            };
            if prec < min {
                break;
            }
            let before = &self.source[..self.pos];
            let before = &before[before
                .trim_end_matches(|c: char| c.is_ascii_whitespace())
                .len()..];
            self.pos += token.len();
            let start = self.pos;
            self.space();
            let after = &self.source[start..self.pos];
            if !self.excel && matches!(op, "~" | "!" | ":") {
                if matches!(left, Expr::Unary('%', _)) {
                    self.error.get_or_insert("Err:508");
                } else if self.source[self.pos..].starts_with('-') {
                    self.error.get_or_insert("Err:520");
                }
            }
            let mut right = if self.pos == self.source.len()
                || op == ":" && self.source[self.pos..].starts_with(['=', ':'])
                || stop_separator && self.source[self.pos..].starts_with([';', ',', ')'])
            {
                self.error = Some(if self.pos == self.source.len() {
                    "Err:520"
                } else if stop_separator && self.source[self.pos..].starts_with([';', ',', ')']) {
                    "Err:511"
                } else {
                    "Err:510"
                });
                Expr::Omitted
            } else {
                self.expression(
                    prec + u8::from(!(self.gnumeric && self.excel && op == "^")),
                    depth + 1,
                    stop_separator,
                )?
            };
            for (value, leading, trailing) in [(&mut left, "", before), (&mut right, after, "")] {
                if !leading.is_empty() || !trailing.is_empty() {
                    if self.nodes == 0 {
                        self.limited = true;
                        return None;
                    }
                    self.nodes -= 1;
                    *value = Expr::Spaced(
                        leading.into(),
                        Box::new(std::mem::replace(value, Expr::Omitted)),
                        trailing.into(),
                    );
                }
            }
            // Calc compiles adjacent reference tokens around ':' into one
            // range token before hashing; parentheses/whitespace prevent it.
            if !self.gnumeric
                && !self.excel
                && op == ":"
                && let (Expr::Reference { odf: a, .. }, Expr::Reference { odf: b, .. }) =
                    (&left, &right)
                && base(a).is_some()
                && base(b).is_some()
            {
                let Some(work) = self.work.checked_sub((a.len() + b.len()) * 4 + 256) else {
                    self.limited = true;
                    return None;
                };
                self.work = work;
                if let Some(merged) = reference(&format!("{a}:{b}"), '.', &[], false) {
                    left = merged;
                    continue;
                }
            }
            left = Expr::Binary(op.into(), Box::new(left), Box::new(right));
        }
        Some(left)
    }
    fn atom(&mut self, depth: usize) -> Option<Expr> {
        self.space();
        if self.gnumeric && (self.native || self.normalized) {
            let source = &self.source[self.pos..];
            if let Some((name, tail)) =
                super::super::office::formulas::live_names::global_name(source)
            {
                self.pos += source.len() - tail.len();
                return Some(Expr::GlobalName(name.into()));
            }
            if let Some(tail) = super::super::office::formulas::live_names::global_prefix(source)
                && qualified(tail, '!').is_some()
            {
                self.pos += source.len() - tail.len();
            }
        }
        if self.source[self.pos..].starts_with("@name.") {
            if !self.gnumeric || !(self.excel || self.normalized) {
                return None;
            }
            let source = &self.source[self.pos..];
            let (name, rest) = LiveName::parse(source, self.excel)?;
            self.pos += source.len() - rest.len();
            return Some(Expr::LiveName(Box::new(name)));
        }
        if let Some((prefix, _)) =
            super::super::office::formulas::label_prefix(&self.source[self.pos..])
        {
            if !self.excel && !self.normalized {
                return None;
            }
            let prefix = prefix.to_owned();
            self.pos += prefix.len() + 1;
            let radical = prefix.starts_with("@range");
            let multiple = radical && prefix.contains(".multi");
            if multiple && (prefix.contains(".quoted") || !self.take(b'{')) {
                return None;
            }
            let mut anchors = Vec::new();
            loop {
                let source = self.source;
                let mut quoted = false;
                let boundary = source[self.pos..]
                    .char_indices()
                    .find_map(|(index, c)| {
                        if c == '\'' {
                            quoted = !quoted;
                        }
                        (!quoted
                            && (matches!(c, ':' | ';' | '}')
                                || c.is_ascii_whitespace()
                                || source[self.pos + index..].starts_with("!!")
                                || source[self.pos + index..].starts_with("->")))
                        .then_some(self.pos + index)
                    })
                    .unwrap_or(source.len());
                self.source = &source[..boundary];
                let anchor = self.atom(depth + 1);
                self.source = source;
                let Expr::Reference { odf, .. } = anchor? else {
                    return None;
                };
                if !radical {
                    return Some(Expr::Label(prefix, odf));
                }
                if label_base(&odf).is_none() {
                    return None;
                }
                anchors.push(odf);
                if !multiple || !self.take(b';') {
                    break;
                }
            }
            if multiple && !self.take(b'}') || !self.source[self.pos..].starts_with("->") {
                return None;
            }
            self.pos += 2;
            let data = if self.source[self.pos..].starts_with("#REF!") {
                self.pos += 5;
                None
            } else {
                let Expr::Reference { odf, .. } = self.atom(depth + 1)? else {
                    return None;
                };
                let (first, last) = range_split(&odf)
                    .map_or((odf.as_str(), None), |i| (&odf[..i], Some(&odf[i + 1..])));
                if label_base(first).is_none() || last.is_some_and(|s| label_base(s).is_none()) {
                    return None;
                }
                Some(odf)
            };
            return Some(Expr::Radical(Box::new(RadicalLabel {
                prefix,
                anchors,
                data,
            })));
        }
        if self.sylk.is_some()
            && let Some(value) = self.sylk_reference()
        {
            return Some(value);
        }
        if self.take(b'{') {
            if self.arrays > 0 {
                if self.error == Some("Err:539") {
                    self.error = None;
                }
                self.error
                    .get_or_insert(if self.excel { "Err:520" } else { "Err:533" });
            }
            let invalid = if self.excel { "Err:520" } else { "Err:539" };
            self.arrays += 1;
            self.in_array = true;
            let column = if self.excel { b',' } else { b';' };
            let row_separator = if self.excel { b';' } else { b'|' };
            let mut rows: Vec<Vec<Expr>> = Vec::new();
            loop {
                let mut row = Vec::new();
                loop {
                    let leading = self.pos;
                    self.space();
                    let before = &self.source[leading..self.pos];
                    let start = self.pos;
                    let mut value = if self
                        .source
                        .as_bytes()
                        .get(self.pos)
                        .is_some_and(|b| [column, row_separator, b'}'].contains(b))
                    {
                        Expr::Literal(String::new())
                    } else {
                        self.expression(1, depth, true)?
                    };
                    if !self.excel
                        && let Expr::Call(name, args, _) = &value
                        && matches!(name.as_str(), "TRUE" | "FALSE")
                        && args.is_empty()
                    {
                        value = Expr::Literal(name.clone());
                    }
                    match &value {
                        Expr::Number(_, false) => {}
                        Expr::Unary('+' | '-', e)
                            if matches!(e.as_ref(), Expr::Number(_, false)) => {}
                        Expr::Literal(s)
                            if s.is_empty()
                                || s.starts_with(['#', '"'])
                                || matches!(s.as_str(), "TRUE" | "FALSE")
                                || s.parse::<f64>().is_ok() => {}
                        Expr::Unary('+' | '-', e) if matches!(e.as_ref(), Expr::Literal(s) if s.parse::<f64>().is_ok()) =>
                            {}
                        _ => {
                            // Invalid matrix tokens are diagnosed before the
                            // function grammar's missing operators/separators.
                            if matches!(self.error, Some("Err:508" | "Err:509")) {
                                self.error = None;
                            }
                            self.error.get_or_insert(invalid);
                        }
                    }
                    if self.excel
                        && matches!(&value, Expr::Literal(v) if matches!(v.as_str(), "TRUE" | "FALSE"))
                        && self.source[start..self.pos].contains('(')
                    {
                        self.error.get_or_insert(invalid);
                        if let Expr::Literal(name) = value {
                            value = Expr::Call(name, Vec::new(), false);
                        }
                    }
                    let raw = &self.source[start..self.pos];
                    let after = &raw[raw.trim_ascii_end().len()..];
                    if !before.is_empty() || !after.is_empty() {
                        if self.nodes == 0 {
                            self.limited = true;
                            return None;
                        }
                        self.nodes -= 1;
                        value = Expr::Spaced(before.into(), Box::new(value), after.into());
                    }
                    row.push(value);
                    if !self.take(column) {
                        if !self.excel && self.take(b',') {
                            self.invalid_public_syntax = true;
                            self.error.get_or_insert(invalid);
                        } else {
                            break;
                        }
                    }
                }
                if rows.first().is_some_and(|first| first.len() != row.len()) {
                    self.error.get_or_insert(invalid);
                }
                rows.push(row);
                if self.take(row_separator) {
                    continue;
                }
                let closed = self.take(b'}');
                self.invalid_public_syntax |= !closed;
                let closed = closed || self.pos == self.source.len();
                if !closed && self.excel && self.source[self.pos..].starts_with('|') {
                    self.error.get_or_insert("Err:520");
                }
                self.arrays -= 1;
                self.in_array = false;
                let constant = rows.iter().all(|row| row.len() == rows[0].len())
                    && rows.iter().flatten().all(|mut value| {
                        while let Expr::Spaced(_, inner, _) = value {
                            value = inner;
                        }
                        match value {
                            Expr::Number(_, false) => true,
                            Expr::Unary('+' | '-', inner) => {
                                matches!(inner.as_ref(), Expr::Number(_, false))
                            }
                            Expr::Literal(s) => {
                                s.is_empty()
                                    || s.starts_with('"')
                                    || matches!(s.as_str(), "TRUE" | "FALSE")
                            }
                            _ => false,
                        }
                    });
                if constant {
                    for slot in rows.iter_mut().flatten() {
                        let mut value = std::mem::replace(slot, Expr::Omitted);
                        while let Expr::Spaced(_, inner, _) = value {
                            value = *inner;
                        }
                        if let Expr::Unary(op, inner) = &value
                            && let Expr::Number(n, false) = inner.as_ref()
                            && (*op == '-' || !self.gnumeric)
                        {
                            value = Expr::Number(if *op == '-' { -*n } else { *n }, false);
                        }
                        if matches!(value, Expr::Number(n, false) if !n.is_finite()) {
                            value = Expr::Literal("#NUM!".into());
                        } else if self.excel && matches!(&value, Expr::Literal(s) if s.is_empty()) {
                            value = Expr::Omitted;
                        }
                        *slot = value;
                    }
                }
                return closed.then_some(Expr::Array(rows));
            }
        }
        if self.take(b'(') {
            let separator = if self.excel { b',' } else { b';' };
            let start = self.pos;
            self.space();
            let before = &self.source[start..self.pos];
            let start = self.pos;
            let mut value = if self.source.as_bytes().get(self.pos) == Some(&separator) {
                Expr::Omitted
            } else {
                self.expression(1, depth, true)?
            };
            while self.take(separator) {
                if self.nodes == 0 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                self.separators = true;
                let preceding = &self.source[..self.pos - 1];
                let trailing = &preceding[preceding
                    .trim_end_matches(|c: char| c.is_ascii_whitespace())
                    .len()..];
                let start = self.pos;
                self.space();
                let leading = &self.source[start..self.pos];
                let mut right = if self
                    .source
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(|c| *c == separator || *c == b')')
                {
                    Expr::Omitted
                } else {
                    self.expression(1, depth, true)?
                };
                for (child, before, after) in
                    [(&mut value, "", trailing), (&mut right, leading, "")]
                {
                    if !before.is_empty() || !after.is_empty() {
                        if self.nodes == 0 {
                            self.limited = true;
                            return None;
                        }
                        self.nodes -= 1;
                        *child = Expr::Spaced(
                            before.into(),
                            Box::new(std::mem::replace(child, Expr::Omitted)),
                            after.into(),
                        );
                    }
                }
                value = Expr::Binary(",".into(), Box::new(value), Box::new(right));
            }
            let raw = &self.source[start..self.pos];
            let after = &raw[raw
                .trim_end_matches(|c: char| c.is_ascii_whitespace())
                .len()..];
            if !before.is_empty() || !after.is_empty() {
                if self.nodes == 0 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                value = Expr::Spaced(before.into(), Box::new(value), after.into());
            }
            let closed = self.take(b')');
            self.invalid_public_syntax |= !closed;
            let closed = closed || self.pos == self.source.len();
            if !closed && !matches!(self.error, Some("Err:502" | "Err:533" | "Err:539")) {
                self.error = Some("Err:508");
            }
            return closed.then(|| Expr::Group(Box::new(value)));
        }
        let first = *self.source.as_bytes().get(self.pos)?;
        if first == b'\'' && self.gnumeric && self.excel {
            let mut end = self.pos + 1;
            let mut text = String::new();
            loop {
                let mut c = self.source[end..].chars().next()?;
                end += c.len_utf8();
                if c == '\'' {
                    break;
                }
                if c == '\\' {
                    c = self.source[end..].chars().next()?;
                    end += c.len_utf8();
                }
                text.push(c);
            }
            if self.source[end..].starts_with('!') && self.source[self.pos..end].contains('\\') {
                let start = end + 1;
                end = start
                    + self.source[start..]
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                        .map(char::len_utf8)
                        .sum::<usize>();
                let raw = format!(
                    "$'{}'!{}",
                    text.replace('\'', "''"),
                    &self.source[start..end]
                );
                self.pos = end;
                self.has_bindings = true;
                return Some(reference(&raw, '!', &[], true).unwrap_or(Expr::Name(raw)));
            }
            if !self.source[end..].starts_with([':', '!']) {
                self.pos = end;
                return Some(Expr::Literal(format!("\"{}\"", text.replace('"', "\"\""))));
            }
        }
        if first == b'#' {
            let value = [
                "#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!",
            ]
            .into_iter()
            .find(|v| {
                self.source[self.pos..]
                    .get(..v.len())
                    .is_some_and(|source| {
                        if self.excel {
                            source.eq_ignore_ascii_case(v)
                        } else {
                            source == *v
                        }
                    })
            })?;
            self.pos += value.len();
            return Some(if self.excel && !self.gnumeric {
                Expr::Bad(function_names::unknown(value))
            } else {
                Expr::Literal(value.into())
            });
        }
        if first == b'"' {
            let start = self.pos;
            self.pos += 1;
            if self.gnumeric && self.excel {
                let mut text = String::new();
                loop {
                    let mut c = self.source[self.pos..].chars().next()?;
                    self.pos += c.len_utf8();
                    if c == '"' {
                        break;
                    }
                    if c == '\\' {
                        c = self.source[self.pos..].chars().next()?;
                        self.pos += c.len_utf8();
                    }
                    text.push(c);
                }
                return Some(Expr::Literal(format!("\"{}\"", text.replace('"', "\"\""))));
            }
            loop {
                let next = self.source[self.pos..].find('"')? + self.pos;
                self.pos = next + 1;
                if self.source.as_bytes().get(self.pos) == Some(&b'"') {
                    self.pos += 1;
                } else {
                    break;
                }
            }
            return Some(Expr::Literal(self.source[start..self.pos].into()));
        }
        if first == b'[' && self.gnumeric && self.excel {
            let start = self.pos;
            let word = |c: char| {
                c.is_ascii_alphanumeric()
                    || matches!(c, '_' | '.' | '$')
                    || !c.is_ascii() && !matches!(c, '¬' | '∧' | '∨')
            };
            let quoted = |pos: &mut usize| -> Option<String> {
                let quote = self.source[*pos..].chars().next()?;
                *pos += 1;
                let mut value = String::new();
                loop {
                    let mut c = self.source[*pos..].chars().next()?;
                    *pos += c.len_utf8();
                    if c == quote {
                        return Some(value);
                    }
                    if c == '\\' {
                        c = self.source[*pos..].chars().next()?;
                        *pos += c.len_utf8();
                    }
                    value.push(c);
                }
            };
            let read_sheet = |pos: &mut usize| -> Option<String> {
                if self.source[*pos..].starts_with('\'') {
                    quoted(pos)
                } else {
                    let start = *pos;
                    *pos += self.source[start..]
                        .chars()
                        .take_while(|c| word(*c))
                        .map(char::len_utf8)
                        .sum::<usize>();
                    Some(self.source[start..*pos].into())
                }
            };
            let qualifier = |pos: &mut usize| -> Option<(Option<String>, String, Option<String>)> {
                let start = *pos;
                let mut book = None;
                let mut book_end = start;
                if self.source[*pos..].starts_with('[') {
                    *pos += 1;
                    *pos += self.source[*pos..].len()
                        - self.source[*pos..]
                            .trim_start_matches([' ', '\t', '\r', '\n'])
                            .len();
                    book = Some(if self.source[*pos..].starts_with(['\'', '"']) {
                        quoted(pos)?
                    } else {
                        let begin = *pos;
                        *pos += self.source[*pos..]
                            .find([']', ' ', '\t', '\r', '\n'])
                            .unwrap_or(self.source.len() - *pos);
                        self.source[begin..*pos].to_owned()
                    });
                    *pos += self.source[*pos..].len()
                        - self.source[*pos..]
                            .trim_start_matches([' ', '\t', '\r', '\n'])
                            .len();
                    if !self.source[*pos..].starts_with(']') {
                        return None;
                    }
                    *pos += 1;
                    book_end = *pos;
                }
                let mut sheet = read_sheet(pos)?;
                let mut end_sheet = if self.source[*pos..].starts_with(':') {
                    *pos += 1;
                    Some(read_sheet(pos)?)
                } else {
                    None
                };
                if sheet.is_empty()
                    || !self.source[*pos..].starts_with('!')
                    || self.source[*pos..].starts_with("!!")
                {
                    *pos = book_end;
                    if book.is_some() && self.source[*pos..].starts_with('!') {
                        *pos += 1;
                    }
                    return Some((book, String::new(), None));
                }
                *pos += 1;
                if let Some((prefix, tail)) =
                    sheet.strip_prefix('[').and_then(|s| s.split_once(']'))
                {
                    book = Some(prefix.into());
                    sheet = tail.into();
                }
                if end_sheet.is_none()
                    && let Some((first, last)) = sheet.split_once(':')
                {
                    end_sheet = Some(last.into());
                    sheet = first.into();
                }
                Some((book, sheet, end_sheet.filter(|s| !s.is_empty())))
            };
            let mut pos = start;
            let (book, sheet, end_sheet) = qualifier(&mut pos)?;
            let book = book?;
            let qualified = !sheet.is_empty();
            let begin = pos;
            pos += self.source[pos..]
                .chars()
                .take_while(|c| word(*c))
                .map(char::len_utf8)
                .sum::<usize>();
            let cell = &self.source[begin..pos];
            if cell.is_empty() || self.source[pos..].starts_with('(') {
                return None;
            }
            let scope = format!(
                "'{}'#{}",
                book.replace('\'', "''"),
                if sheet.is_empty() {
                    String::new()
                } else {
                    format!("$'{}'", sheet.replace('\'', "''"))
                }
            );
            let mut raw = format!("{scope}.{cell}");
            let mut colon = pos;
            colon += self.source[colon..].len()
                - self.source[colon..]
                    .trim_start_matches([' ', '\t', '\r', '\n'])
                    .len();
            let mut ranged = false;
            if qualified && self.source[colon..].starts_with(':') {
                let mut end = colon + 1;
                end += self.source[end..].len()
                    - self.source[end..]
                        .trim_start_matches([' ', '\t', '\r', '\n'])
                        .len();
                let (last_book, last_sheet, _) = qualifier(&mut end)?;
                let last_book = last_book.as_deref().unwrap_or(&book);
                let last_sheet = if last_sheet.is_empty() {
                    end_sheet.as_deref().unwrap_or(&sheet)
                } else {
                    &last_sheet
                };
                let begin = end;
                end += self.source[end..]
                    .chars()
                    .take_while(|c| word(*c))
                    .map(char::len_utf8)
                    .sum::<usize>();
                let range = format!(
                    "{raw}:'{}'#$'{}'.{}",
                    last_book.replace('\'', "''"),
                    last_sheet.replace('\'', "''"),
                    &self.source[begin..end]
                );
                if end > begin
                    && !self.source[end..]
                        .trim_start_matches([' ', '\t', '\r', '\n'])
                        .starts_with('(')
                    && reference(&range, '.', &[], true).is_some()
                {
                    raw = range;
                    pos = end;
                    ranged = true;
                }
            }
            if qualified
                && !ranged
                && let Some(end_sheet) = end_sheet
            {
                raw = format!(
                    "{raw}:'{}'#$'{}'.{cell}",
                    book.replace('\'', "''"),
                    end_sheet.replace('\'', "''")
                );
            }
            if cell.as_bytes()[0].is_ascii_digit() && range_split(&raw).is_none() {
                return None;
            }
            self.work = self.work.checked_sub((pos - start) * 8 + 256).or_else(|| {
                self.limited = true;
                None
            })?;
            self.pos = pos;
            self.has_bindings = true;
            return reference(&raw, '.', &[], true);
        }
        if first == b'[' {
            if self.excel {
                let start = self.pos;
                if let Some(close) = self.source[start..].find(']') {
                    let end = start + close + 1;
                    let header = &self.source[start + 1..end - 1];
                    let tail = &self.source[end..];
                    let count = tail
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '$' | '.' | '!'))
                        .map(char::len_utf8)
                        .sum::<usize>();
                    self.invalid_public_syntax |= count == 0;
                    let (sheet, cell) = qualified(&tail[..count], '!')
                        .map_or((None, &tail[..count]), |(sheet, cell)| (Some(sheet), cell));
                    let header_token = if header.starts_with('\'') {
                        header.len() >= 2
                            && header.ends_with('\'')
                            && header[1..header.len() - 1]
                                .split("''")
                                .all(|s| !s.contains('\''))
                    } else {
                        header
                            .chars()
                            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '$' | '.' | ':'))
                            && header.bytes().filter(|b| *b == b':').count() <= 1
                    };
                    if header_token
                        && !tail.starts_with('!')
                        && super::super::office::coordinate(cell).is_some()
                    {
                        if header.is_empty() {
                            // An empty document token consumes the remaining
                            // source as one bad operand, including delimiters.
                            self.pos = self.source.len();
                            self.has_bindings = true;
                            return Some(Expr::Bad(tail.to_owned()));
                        }
                        // The external parser retains an unresolved document
                        // prefix and the following reference as adjacent tokens.
                        self.work = (header.len() + count)
                            .checked_mul(4)
                            .and_then(|n| n.checked_add(256))
                            .and_then(|n| self.work.checked_sub(n))
                            .or_else(|| {
                                self.limited = true;
                                None
                            })?;
                        self.nodes = self.nodes.checked_sub(5).or_else(|| {
                            self.limited = true;
                            None
                        })?;
                        self.pos = end + count;
                        self.has_bindings = true;
                        let mut prefix = Expr::Bad(header.to_owned());
                        let suffix = reference(cell, '.', &[], false)?;
                        if let Some(sheet) = sheet {
                            prefix = Expr::Binary(
                                "[]".into(),
                                Box::new(prefix),
                                Box::new(Expr::Bad(function_names::unknown(sheet))),
                            );
                        }
                        return Some(Expr::Binary(
                            if sheet.is_some() {
                                "!".into()
                            } else {
                                "[]".into()
                            },
                            Box::new(prefix),
                            Box::new(suffix),
                        ));
                    }
                    if header.contains('\'')
                        || !header.is_ascii()
                        || tail.starts_with('!')
                        || header.bytes().filter(|b| *b == b':').count() > 1
                    {
                        self.pos = start
                            + super::super::office::formula_arguments::external_reference_end(
                                &self.source[start..],
                            )?;
                        let token = &self.source[start..self.pos];
                        let upper = if header.is_ascii() {
                            collation::uppercase(token, &mut self.work).or_else(|| {
                                self.limited = true;
                                None
                            })?
                        } else {
                            token.to_owned()
                        };
                        return Some(Expr::Bad(
                            if (header.contains('\'') || !header.is_ascii())
                                && self.pos == end
                                && tail.trim().is_empty()
                                || tail.strip_prefix('!').is_some_and(|s| {
                                    super::super::office::coordinate(&s[..count.saturating_sub(1)])
                                        .is_some()
                                })
                            {
                                token.to_owned()
                            } else {
                                function_names::unknown(&upper)
                            },
                        ));
                    }
                }
                // An opening bracket starts an identifier; closing brackets
                // continue it. Operators, spaces and another '[' end the token.
                self.pos += 1;
                self.pos += self.source[self.pos..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$' | ']' | '!'))
                    .map(char::len_utf8)
                    .sum::<usize>();
                self.has_bindings = true;
                let upper = collation::uppercase(&self.source[start..self.pos], &mut self.work)
                    .or_else(|| {
                        self.limited = true;
                        None
                    })?;
                return Some(Expr::Bad(function_names::unknown(&upper)));
            }
            self.pos += 1;
            let start = self.pos;
            let mut quoted = false;
            while let Some(&b) = self.source.as_bytes().get(self.pos) {
                if b == b'\'' {
                    quoted = !quoted;
                }
                if b == b']' && (!quoted || self.excel) {
                    break;
                }
                self.pos += 1;
            }
            if self.source.as_bytes().get(self.pos) != Some(&b']') {
                return None;
            }
            let raw = &self.source[start..self.pos];
            self.pos += 1;
            if self.legacy {
                return reference(raw, '!', &[], self.gnumeric);
            }
            let Some(work) = raw
                .len()
                .checked_mul(4)
                .and_then(|n| n.checked_add(64))
                .and_then(|n| self.work.checked_sub(n))
            else {
                self.limited = true;
                return None;
            };
            self.work = work;
            // Retained standalone quotes encode a compiler error token, not
            // a new public OpenFormula reference.
            let value = if self.gnumeric
                && self.normalized
                && qualified(raw, '.').is_none()
                && let Some(token) = raw.strip_prefix('\'').and_then(|s| s.strip_suffix('\''))
            {
                Expr::Bad(token.replace("''", "'"))
            } else {
                odf_reference(raw, self.gnumeric)
            };
            self.invalid_public_syntax |= !self.normalized && matches!(value, Expr::Bad(_));
            self.has_bindings |= matches!(&value, Expr::Bad(_))
                || matches!(&value, Expr::Reference { excel, .. } if excel.contains('!'));
            return Some(value);
        }
        if self.excel && first == b']' {
            self.pos += 1;
            self.has_bindings = true;
            return Some(Expr::Bad("]".into()));
        }
        if !self.excel && !self.legacy && !self.normalized {
            // The public ODF parser tries sheet-qualified names before numeric
            // operands. Its unquoted sheet token can cross argument separators
            // and an opening string quote; the remaining quote then makes the
            // formula invalid. Function calls and string operands take priority.
            let source = &self.source[self.pos..];
            let word = |c: char| {
                c.is_ascii_alphanumeric()
                    || matches!(c, '_' | '.' | '$')
                    || !c.is_ascii() && !matches!(c, '¬' | '∧' | '∨')
            };
            let name_end = source.find(|c| !word(c)).unwrap_or(source.len());
            if !source[name_end..]
                .trim_start_matches([' ', '\t', '\r', '\n'])
                .starts_with('(')
                && let Some(end) = source.find(['.', ' ', '[', ']', ':', '\'', '\t', '\r', '\n'])
                && source.as_bytes()[end] == b'.'
                && source[..end].bytes().filter(|b| *b == b'"').count() % 2 == 1
            {
                let tail = &source[end + 1..];
                let end = tail.find(|c| !word(c)).unwrap_or(tail.len());
                if end > 0 && !tail.as_bytes()[0].is_ascii_digit() && !tail[end..].starts_with('(')
                {
                    return None;
                }
            }
        }
        if first == b'.' && self.source[self.pos + 1..].starts_with("$$") {
            self.pos += 1;
            self.error = Some(if self.excel { "Err:509" } else { "Err:501" });
            return Some(Expr::Binary(
                String::new(),
                Box::new(Expr::Literal(".".into())),
                Box::new(self.atom(depth + 1)?),
            ));
        }
        if self.legacy || self.gnumeric && !self.excel && !self.normalized {
            let source = &self.source[self.pos..];
            let word = |c: char| {
                c.is_ascii_alphanumeric()
                    || matches!(c, '_' | '.' | '$')
                    || !c.is_ascii() && !matches!(c, '¬' | '∧' | '∨')
            };
            let name_end = source.find(|c| !word(c)).unwrap_or(source.len());
            // ODF qualifiers admit operators and argument separators inside
            // unquoted sheet names. Function calls still take priority; ordinary
            // Calc references retain their range-endpoint parsing below.
            if !source[name_end..]
                .trim_start_matches([' ', '\t', '\r', '\n'])
                .starts_with('(')
                && let Some(end) = source.find([
                    self.sheet_separator,
                    ' ',
                    '[',
                    ']',
                    ':',
                    '\'',
                    '\t',
                    '\r',
                    '\n',
                ])
                && source.as_bytes()[end] == self.sheet_separator as u8
                && !source[end..].starts_with("!!")
                && source[..end].chars().any(|c| !word(c))
            {
                let tail = &source[end + 1..];
                let length = tail.find(|c| !word(c)).unwrap_or(tail.len());
                if length > 0
                    && !tail.as_bytes()[0].is_ascii_digit()
                    && !tail[length..].starts_with('(')
                {
                    let sheet = &source[..end];
                    let raw = format!(
                        "{}'{}'{}{}",
                        if sheet.starts_with('$') { "$" } else { "" },
                        sheet.strip_prefix('$').unwrap_or(sheet).replace('\'', "''"),
                        self.sheet_separator,
                        &tail[..length]
                    );
                    self.work = self.work.checked_sub(raw.len() * 8 + 256).or_else(|| {
                        self.limited = true;
                        None
                    })?;
                    if let Some(value) = reference(&raw, self.sheet_separator, &[], true) {
                        self.pos += end + 1 + length;
                        self.has_bindings = true;
                        return Some(value);
                    }
                }
            }
        }
        if self.gnumeric && self.sylk.is_none() {
            // ODF sheet qualifiers can begin with numbers and cross separators.
            if !self.normalized && first.is_ascii_digit() && self.sheet_separator == '.' {
                let source = &self.source[self.pos..];
                if let Some(end) = source.find(['.', ' ', '[', ']', ':', '\'', '\t', '\r', '\n'])
                    && source.as_bytes()[end] == b'.'
                {
                    let tail = &source[end + 1..];
                    let length = tail
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                        .map(char::len_utf8)
                        .sum::<usize>();
                    if length > 0
                        && !tail.as_bytes()[0].is_ascii_digit()
                        && !tail[length..].starts_with('(')
                    {
                        self.work =
                            self.work
                                .checked_sub((end + length) * 8 + 256)
                                .or_else(|| {
                                    self.limited = true;
                                    None
                                })?;
                        if let Some(value) = reference(
                            &format!("'{}'.{}", &source[..end], &tail[..length]),
                            '.',
                            &[],
                            true,
                        ) {
                            self.pos += end + 1 + length;
                            self.has_bindings = true;
                            return Some(value);
                        }
                    }
                }
            }
            // These grammars read a contiguous range as one reference token.
            // A colon between bracketed OpenFormula operands remains an operator.
            let token_end = |source: &str| {
                let mut quoted = false;
                let mut end = 0;
                for c in source.chars() {
                    if c == '\'' {
                        quoted = !quoted;
                    } else if !quoted
                        && !c.is_alphanumeric()
                        && !"_.$".contains(c)
                        && !(c == '!' && self.sheet_separator == '!')
                    {
                        break;
                    }
                    end += c.len_utf8();
                }
                end
            };
            let source = &self.source[self.pos..];
            let first_end = token_end(source);
            if first_end > 0 && !source[first_end..].trim_start().starts_with('(') {
                let mut end = first_end;
                if source[end..].starts_with(':') {
                    let length = token_end(&source[end + 1..]);
                    if length > 0 && !source[end + 1 + length..].trim_start().starts_with('(') {
                        end += length + 1;
                    }
                }
                let raw = &source[..end];
                let mut canonical = raw.to_owned();
                if self.excel {
                    self.invalid_public_syntax |= raw.contains("''");
                    if end > first_end
                        && qualified(&raw[..first_end], '!').is_none()
                        && let Some((sheet, cell)) = qualified(&raw[first_end + 1..], '!')
                    {
                        // Excel tries a sheet span before a pair of cell endpoints.
                        canonical = format!(
                            "$'{}'!{cell}:$'{}'!{cell}",
                            raw[..first_end].trim_matches('\'').replace('\'', "''"),
                            sheet.trim_matches('\'').replace('\'', "''")
                        );
                    } else {
                        let fixed = |raw: &str| {
                            qualified(raw, '!').map_or_else(
                                || raw.to_owned(),
                                |(sheet, cell)| {
                                    let sheet = sheet
                                        .strip_prefix('\'')
                                        .and_then(|s| s.strip_suffix('\''))
                                        .unwrap_or(sheet);
                                    format!("$'{}'!{cell}", sheet.replace('\'', "''"))
                                },
                            )
                        };
                        canonical = fixed(&raw[..first_end]);
                        if end > first_end {
                            canonical.push(':');
                            canonical.push_str(&fixed(&raw[first_end + 1..]));
                        }
                    }
                }
                self.work = self.work.checked_sub(raw.len() * 8 + 256).or_else(|| {
                    self.limited = true;
                    None
                })?;
                if (end > first_end
                    || endpoint(&canonical, self.sheet_separator, true)
                        .is_some_and(|part| part.position.is_some()))
                    && let Some(value) = reference(&canonical, self.sheet_separator, &[], true)
                {
                    self.pos += end;
                    self.has_bindings = true;
                    return Some(value);
                }
            }
        }
        if first.is_ascii_digit() || first == b'.' {
            if !self.excel && !self.normalized {
                // Unbracketed row ranges are reference tokens in ODF imports.
                // Try them before numeric scanning, including a numeric sheet
                // qualifier such as 1.5:2 (sheet "1", rows 5 through 2).
                let source = &self.source[self.pos..];
                let end = source
                    .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '$' | ':')))
                    .unwrap_or(source.len());
                let token = &source[..end];
                if token.contains(':')
                    && let Some(value) = reference(token, self.sheet_separator, &[], self.gnumeric)
                {
                    self.pos += end;
                    return Some(value);
                }
            }
            let start = self.pos;
            let mut point = false;
            while let Some(&b) = self.source.as_bytes().get(self.pos) {
                if b == b'.' {
                    if point && first != b'.' {
                        break;
                    }
                    point = true;
                } else if !b.is_ascii_digit() && (self.excel || b != b',') {
                    break;
                }
                self.pos += 1;
            }
            if matches!(self.source.as_bytes().get(self.pos), Some(b'e' | b'E')) {
                self.pos += 1;
                if matches!(self.source.as_bytes().get(self.pos), Some(b'+' | b'-'))
                    && self
                        .source
                        .as_bytes()
                        .get(self.pos + 1)
                        .is_some_and(u8::is_ascii_digit)
                {
                    self.pos += 1;
                }
                while self
                    .source
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(u8::is_ascii_digit)
                {
                    self.pos += 1;
                }
            }
            if !self.excel && self.source[start..self.pos].contains(',') {
                // A following name makes Calc retry numeric scanning. Commas
                // are accepted by the first scan, but end the fallback token.
                let (token, illegal) =
                    super::super::office::number_token(&self.source[start..], true);
                self.pos = start + token.len();
                if illegal {
                    self.error.get_or_insert("Err:501");
                }
            }
            let source = &self.source[start..self.pos];
            let number = if source.contains(',') {
                self.invalid_public_syntax = true;
                let mantissa = source.split(['e', 'E']).next().unwrap_or(source);
                let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
                let mut groups = whole.split(',');
                let grouped = self.sheet_separator == '!'
                    && !self.excel
                    && groups.next().is_some_and(|s| !s.is_empty() && s.len() <= 3)
                    && groups.all(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_digit()))
                    && fraction.bytes().all(|b| b.is_ascii_digit());
                if !grouped {
                    return Some(Expr::Literal(source.into()));
                }
                source.replace(',', "").parse::<f64>()
            } else {
                source.parse::<f64>()
            };
            let Ok(mut number) = number else {
                self.invalid_public_syntax = true;
                if source.ends_with(['e', 'E'])
                    && self.source[self.pos..].starts_with([';', ',', ')'])
                {
                    self.error.get_or_insert("Err:508");
                }
                return Some(if self.excel && source == "." {
                    Expr::Bad(source.into())
                } else {
                    Expr::Literal(source.into())
                });
            };
            if !number.is_finite() {
                self.invalid_public_syntax = true;
                if !self.excel
                    && matches!(self.error, None | Some("Err:508" | "Err:509" | "Err:539"))
                {
                    self.error = Some("Err:502");
                }
                if self.sheet_separator == '!' {
                    number = if number.is_infinite() { f64::MAX } else { 0. };
                }
            }
            let percent = !self.gnumeric && self.take(b'%');
            return Some(Expr::Number(number, percent));
        }
        let start = self.pos;
        if !self.excel && self.source[self.pos..].starts_with(',') {
            self.invalid_public_syntax = true;
            // Legacy Calc can retain a leading comma in an unknown token.
            self.pos += 1;
        }
        let mut quoted = false;
        while let Some(c) = self.source[self.pos..].chars().next() {
            if c == '\'' {
                quoted = !quoted;
            } else if !quoted
                && !c.is_alphanumeric()
                && !matches!(c, '_' | '.' | '$')
                && !(self.gnumeric && !c.is_ascii() && !"¬∧∨".contains(c))
                && !(self.excel && matches!(c, '!' | ']'))
            {
                break;
            }
            self.pos += c.len_utf8();
            if c == '\'' && !quoted && self.excel && self.source[self.pos..].starts_with('.') {
                let left = self.source[start..self.pos].to_owned();
                self.pos += 1;
                self.error = Some("Err:509");
                self.has_bindings = true;
                return Some(Expr::Binary(
                    ".".into(),
                    Box::new(Expr::Name(left)),
                    Box::new(self.atom(depth + 1)?),
                ));
            }
        }
        if self.pos == start {
            return None;
        }
        let name = &self.source[start..self.pos];
        if self.excel && name.contains(']') {
            self.has_bindings = true;
            let upper = collation::uppercase(name, &mut self.work).or_else(|| {
                self.limited = true;
                None
            })?;
            return Some(Expr::Bad(function_names::unknown(&upper)));
        }
        if let Some(tail) = name.strip_prefix(',') {
            if tail.as_bytes().first().is_some_and(u8::is_ascii_digit) {
                self.error.get_or_insert("Err:509");
            }
            return Some(Expr::Bad(function_names::unknown(name)));
        }
        let name_end = self.pos;
        if !self.take(b'(') {
            let mut parsed_reference = if self.sylk.is_some() {
                None
            } else if self.excel && qualified(name, '!').is_some() {
                if name.starts_with('$') {
                    None
                } else {
                    reference(&format!("${name}"), '!', &[], self.gnumeric)
                }
            } else {
                reference(
                    name,
                    if self.gnumeric {
                        self.sheet_separator
                    } else if self.excel {
                        '!'
                    } else {
                        '.'
                    },
                    &[],
                    self.gnumeric,
                )
            };
            if self.excel
                && qualified(name, '!').is_some()
                && let Some(Expr::Reference { excel, foreign, .. }) = &mut parsed_reference
            {
                *excel = name.to_owned();
                *foreign = true;
            }
            if self.normalized
                && self.gnumeric
                && endpoint(name, '.', true).is_some_and(|part| part.position.is_none())
                && let Some(Expr::Reference {
                    unbracketed_name, ..
                }) = &mut parsed_reference
            {
                *unbracketed_name = true;
            }
            if let Some(reference) = parsed_reference {
                self.has_bindings |=
                    matches!(&reference, Expr::Reference { excel, .. } if excel.contains('!'));
                return Some(reference);
            }
            if self.native
                && !super::super::office::formulas::valid_native_name(name)
                && !name.eq_ignore_ascii_case("true")
                && !name.eq_ignore_ascii_case("false")
            {
                let start = self.source[..start].encode_utf16().count() + 1;
                self.native_diagnostic = Some((start, start + name.encode_utf16().count()));
                return None;
            }
            let name = if self.excel || self.gnumeric {
                name
            } else {
                name.strip_prefix("$$").unwrap_or(name)
            };
            let boolean = name.eq_ignore_ascii_case("true") || name.eq_ignore_ascii_case("false");
            let name = if boolean {
                name.to_ascii_uppercase()
            } else {
                name.into()
            };
            return Some(
                if self.gnumeric
                    && !self.excel
                    && !quoted
                    && !(self.sheet_separator == '!'
                        && self.source[self.pos..]
                            .strip_prefix('!')
                            .is_some_and(|tail| {
                                tail.chars()
                                    .next()
                                    .is_some_and(|c| c.is_alphanumeric() || matches!(c, '_' | '$'))
                            }))
                    && name.len() >= 2
                    && name.starts_with('\'')
                    && name.ends_with('\'')
                {
                    Expr::LabelText(name[1..name.len() - 1].replace("''", "'"))
                } else if boolean && self.arrays == 0 {
                    if self.gnumeric {
                        Expr::Literal(name)
                    } else if self.sheet_separator == '.' {
                        Expr::Call(name, Vec::new(), false)
                    } else {
                        Expr::Literal(if name == "TRUE" { "1" } else { "0" }.into())
                    }
                } else if boolean {
                    Expr::Literal(name)
                } else {
                    self.has_bindings = true;
                    self.record_sylk_name(&name);
                    Expr::Name(name)
                },
            );
        }
        let call_space = &self.source[name_end..self.pos - 1];
        let mut args = Vec::new();
        let in_array = self.in_array;
        let start = self.pos;
        self.space();
        let empty = self.source.as_bytes().get(self.pos) == Some(&b')');
        if empty && (self.pos == start || self.gnumeric) {
            self.pos += 1;
        } else {
            self.pos = start;
            loop {
                let start = self.pos;
                self.space();
                let before = &self.source[start..self.pos];
                let start = self.pos;
                let mut arg = if self
                    .source
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(|b| *b == b')' || *b == if self.excel { b',' } else { b';' })
                {
                    Expr::Omitted
                } else {
                    self.expression(1, depth, true)?
                };
                let raw = &self.source[start..self.pos];
                let after = &raw[raw
                    .trim_end_matches(|c: char| c.is_ascii_whitespace())
                    .len()..];
                if !before.is_empty() || !after.is_empty() {
                    if self.nodes == 0 {
                        self.limited = true;
                        return None;
                    }
                    self.nodes -= 1;
                    arg = Expr::Spaced(before.into(), Box::new(arg), after.into());
                }
                args.push(arg);
                let closed = self.take(b')');
                self.invalid_public_syntax |= !closed && self.pos == self.source.len();
                if closed || self.pos == self.source.len() {
                    break;
                }
                if !self.take(if self.excel { b',' } else { b';' }) {
                    if !self.excel && self.take(b',') {
                        self.invalid_public_syntax = true;
                        // An invalid matrix element keeps its error; an
                        // incomplete argument list replaces missing operators.
                        if !matches!(self.error, Some("Err:502" | "Err:533" | "Err:539")) {
                            self.error = Some("Err:508");
                        }
                    } else {
                        return None;
                    }
                }
            }
        }
        if !self.gnumeric && name.eq_ignore_ascii_case("NA") && !empty {
            self.error = Some("Err:508");
        }
        if self.normalized && self.gnumeric {
            return Some(Expr::Call(name.into(), args, false));
        }
        if self.normalized {
            return Some(Expr::Call(
                function_names::imported_ods(name, false, false)
                    .unwrap_or(name)
                    .into(),
                args,
                false,
            ));
        }
        let Some(upper) = collation::uppercase(name, &mut self.work) else {
            self.limited = true;
            return None;
        };
        let ascii = name.to_ascii_uppercase();
        if self.gnumeric
            && !self.excel
            && (ascii == "COM.MICROSOFT.NORM.S.DIST" && args.len() == 2
                || ascii == "COM.MICROSOFT.LOGNORM.DIST" && args.len() == 4)
        {
            let cumulative = args.pop().unwrap();
            let normal = ascii == "COM.MICROSOFT.NORM.S.DIST";
            let mut density_args = args.clone();
            if normal {
                density_args.extend([Expr::Number(0., false), Expr::Number(1., false)]);
            }
            let density = Expr::Call(
                if normal { "R.DNORM" } else { "R.DLNORM" }.into(),
                density_args,
                false,
            );
            let probability = Expr::Call(
                if normal { "NORMSDIST" } else { "LOGNORMDIST" }.into(),
                args,
                false,
            );
            let (yes, no) = if normal {
                (density, probability)
            } else {
                (probability, density)
            };
            let mut value = &cumulative;
            while let Expr::Spaced(_, child, _) = value {
                value = child;
            }
            let selected = match value {
                Expr::Number(n, _) => Some(*n != 0.),
                Expr::Literal(s) if s == "TRUE" || s == "FALSE" => Some(s == "TRUE"),
                _ => None,
            };
            return Some(match selected {
                Some(true) => yes,
                Some(false) => no,
                None => Expr::Call("IF".into(), vec![cumulative, yes, no], false),
            });
        }
        let mut recognized = function_names::imported_ods(
            if self.sheet_separator == '.' {
                &ascii
            } else {
                &upper
            },
            self.sheet_separator == '!' && !self.excel,
            self.excel,
        );
        if recognized.is_none() && super::super::office::coordinate(&upper).is_some() {
            if !self.gnumeric {
                self.error = Some("Err:509");
            }
            return Some(Expr::Call(upper, args, false));
        }
        if self.excel
            && !self.gnumeric
            && matches!(
                recognized,
                Some(
                    "ROUND"
                        | "ROUNDUP"
                        | "ROUNDDOWN"
                        | "TRUNC"
                        | "LOGNORMDIST"
                        | "EUROCONVERT"
                        | "FACT"
                        | "COMBIN"
                        | "COMBINA"
                        | "PERMUT"
                        | "PERMUTATIONA"
                        | "HYPGEOMDIST"
                        | "HYPGEOM.DIST"
                        | "DCOUNT"
                        | "DCOUNTA"
                        | "DSUM"
                        | "DAVERAGE"
                        | "DMIN"
                        | "DMAX"
                        | "DPRODUCT"
                        | "DGET"
                        | "DSTDEV"
                        | "DSTDEVP"
                        | "DVAR"
                        | "DVARP"
                )
            )
        {
            let minimum = match recognized {
                Some("TRUNC" | "FACT") => 1,
                Some("LOGNORMDIST" | "EUROCONVERT") => 3,
                Some("HYPGEOMDIST") => 4,
                Some("HYPGEOM.DIST") => 5,
                Some(
                    "DCOUNT" | "DCOUNTA" | "DSUM" | "DAVERAGE" | "DMIN" | "DMAX" | "DPRODUCT"
                    | "DGET" | "DSTDEV" | "DSTDEVP" | "DVAR" | "DVARP",
                ) => 3,
                _ => 2,
            };
            while args.len() > minimum {
                let mut last = args.last().unwrap();
                while let Expr::Spaced(_, inner, _) = last {
                    last = inner;
                }
                if !matches!(last, Expr::Omitted) {
                    break;
                }
                args.pop();
                if args.len() == 1 {
                    let mut first = &mut args[0];
                    while let Expr::Spaced(_, inner, _) = first {
                        first = inner;
                    }
                    if matches!(first, Expr::Omitted) {
                        *first = Expr::OmittedZero;
                    }
                }
            }
        }
        let mut omit_method = false;
        if !self.gnumeric && recognized == Some("ISOWEEKNUM") {
            if self.sheet_separator == '.' && args.len() == 2 {
                let mut method = &args[1];
                while let Expr::Spaced(_, inner, _) = method {
                    method = inner;
                }
                if matches!(method, Expr::Number(2., false)) {
                    omit_method = true;
                } else {
                    recognized = Some("WEEKNUM_OOO");
                }
            } else if self.sheet_separator != '.' && args.len() > 1 {
                self.error = Some("Err:508");
            }
        }
        if self.excel && !self.gnumeric && recognized == Some("WEEKNUM_EXCEL2003") {
            let Some(count) = super::super::office::formula_arguments::argument_count(
                &self.source[start - 1..self.pos],
                in_array,
                &mut self.work,
            ) else {
                self.limited = true;
                return None;
            };
            if count == 1 {
                args.push(Expr::Literal("1".into()));
            }
        }
        let name = if self.gnumeric {
            if self.excel {
                name.to_uppercase()
            } else {
                function_names::public_odf(name)
            }
        } else {
            recognized
                .map(str::to_owned)
                .unwrap_or_else(|| format!("{}{call_space}", function_names::unknown(&upper)))
        };
        if self.gnumeric && !self.excel && matches!(upper.as_str(), "FLOOR" | "CEILING") {
            return Some(Expr::odf_rounding(&name, &args, true));
        }
        if self.gnumeric && self.legacy && name == "ADDRESS" && args.len() == 4 {
            args.insert(3, Expr::Number(1., false));
        }
        Some(
            if self.gnumeric
                && !self.excel
                && args.is_empty()
                && matches!(name.as_str(), "TRUE" | "FALSE")
            {
                Expr::Literal(name)
            } else {
                Expr::Call(name, args, omit_method)
            },
        )
    }
}
fn qualified(raw: &str, separator: char) -> Option<(&str, &str)> {
    let mut quoted = false;
    raw.char_indices().find_map(|(i, c)| {
        if c == '\'' {
            quoted = !quoted;
        }
        (c == separator && !quoted).then(|| (&raw[..i], &raw[i + c.len_utf8()..]))
    })
}

pub(super) fn lookup_name<T>(
    name: &str,
    excel: bool,
    sheet: usize,
    sheets: &[String],
    work: &mut usize,
    mut lookup: impl FnMut(&(Option<usize>, String)) -> Option<T>,
) -> Result<Option<(Option<usize>, T)>, &'static str> {
    let upper = collation::uppercase(name, work).ok_or(super::LIMIT)?;
    for scope in [Some(sheet), None] {
        if let Some(value) = lookup(&(scope, upper.clone())) {
            return Ok(Some((scope, value)));
        }
    }
    let Some((raw, name)) = qualified(&upper, if excel { '!' } else { '.' }) else {
        return Ok(None);
    };
    let raw = if excel {
        raw
    } else {
        raw.strip_prefix('$').unwrap_or(raw)
    };
    let quoted = raw.starts_with('\'');
    let raw = if quoted {
        raw.strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .map(|s| s.replace("''", "'"))
    } else {
        Some(raw.to_owned())
    };
    let Some(raw) = raw else {
        return Ok(None);
    };
    let raw = if quoted { raw.to_lowercase() } else { raw };
    for (index, sheet) in sheets.iter().enumerate() {
        *work = work
            .checked_sub(sheet.len() + name.len() + 32)
            .ok_or(super::LIMIT)?;
        // Quoted sheet lookup uses the compiler's simple case comparison;
        // unquoted lookup also expands compatibility characters such as ﬃ.
        let key = if quoted {
            sheet.to_lowercase()
        } else {
            collation::uppercase(sheet, work).ok_or(super::LIMIT)?
        };
        if key == raw {
            return Ok(lookup(&(Some(index), name.to_owned())).map(|v| (Some(index), v)));
        }
    }
    Ok(None)
}

// ODF markers quote token contents, not sheet names. Keep the original
// unquoted range separators: a colon inside a marked name is not a range.
fn odf_reference(raw: &str, public: bool) -> Expr {
    if public {
        return reference(raw, '.', &[], true).unwrap_or_else(|| Expr::Bad(raw.into()));
    }
    let mut text = String::new();
    let mut chars = raw.chars().peekable();
    let (mut name, mut quoted, mut marked, mut past_dot, mut mark_ahead) =
        (false, false, false, false, false);
    let mut references = 1;
    while let Some(c) = chars.next() {
        if c == ':' && !quoted {
            references += 1;
            (name, quoted, marked, past_dot, mark_ahead) = (false, false, false, false, false);
        } else if c == '.' && !name && !marked && !past_dot {
            past_dot = true;
            mark_ahead = chars.clone().take(2).eq(['$', '$']);
            continue;
        } else if !past_dot || marked || mark_ahead {
            if c == '$' && !quoted && chars.peek() == Some(&'$') {
                chars.next();
                mark_ahead = false;
                if marked {
                    text.push_str("$$");
                } else {
                    marked = true;
                    name = false;
                }
                continue;
            }
            if c == '\'' {
                let boundary = !name || quoted;
                if !name {
                    name = true;
                    quoted = true;
                } else if quoted {
                    if chars.peek() == Some(&'\'') {
                        chars.next();
                        if !marked {
                            text.push('\'');
                        }
                        text.push('\'');
                        continue;
                    }
                    quoted = false;
                }
                if marked && boundary {
                    continue;
                }
            } else if c == '.' && !quoted {
                past_dot = true;
                mark_ahead = chars.clone().take(2).eq(['$', '$']);
            } else if c != '$' || name || marked || past_dot {
                name = true;
            }
        }
        text.push(c);
    }
    let valid = |part: &str| {
        endpoint(part, '.', false).is_some_and(|p| p.position.is_some() || p.sheet.is_some())
    };
    let parsed = match (references, range_split(&text)) {
        (1, None) if valid(&text) => reference(&text, '.', &[], public),
        (2, Some(_)) => reference(&text, '.', &[], public),
        _ => None,
    };
    parsed.unwrap_or(Expr::Bad(text))
}

pub(super) struct Base {
    pub sheet: Option<String>,
    pub row: u64,
    pub column: u64,
}
#[derive(Clone)]
struct Endpoint {
    workbook: Option<String>,
    sheet: Option<String>,
    relative: bool,
    cell: String,
    position: Option<(u64, u64)>,
}
fn endpoint(raw: &str, separator: char, public: bool) -> Option<Endpoint> {
    let (workbook, raw) = if public
        && raw.starts_with('\'')
        && let Some((book, tail)) = qualified(raw, '#')
    {
        (
            Some(
                book.strip_prefix('\'')?
                    .strip_suffix('\'')?
                    .replace("''", "'"),
            ),
            tail,
        )
    } else {
        (None, raw)
    };
    let (sheet, cell) = if workbook.is_some() && raw.starts_with(separator) {
        Some(("", &raw[separator.len_utf8()..]))
    } else if raw.trim_start_matches('$').starts_with('\'') {
        qualified(raw, separator)
    } else if public {
        raw.split_once(separator)
    } else {
        raw.rsplit_once(separator)
    }
    .unwrap_or(("", raw));
    let relative = workbook.is_none() && !sheet.starts_with('$');
    let sheet = sheet.strip_prefix('$').unwrap_or(sheet);
    let sheet = if sheet.is_empty() {
        None
    } else if let Some(s) = sheet.strip_prefix('\'') {
        let s = s.strip_suffix('\'')?;
        let mut chars = s.chars();
        let mut name = String::new();
        while let Some(c) = chars.next() {
            if c == '\'' && chars.next() != Some('\'') {
                return None;
            }
            name.push(c);
        }
        Some(name)
    } else {
        if !sheet
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | ' '))
        {
            return None;
        }
        Some(sheet.to_owned())
    };
    let c = cell.strip_prefix('$').unwrap_or(cell);
    let letters = c.bytes().take_while(u8::is_ascii_alphabetic).count();
    let row = c[letters..].strip_prefix('$').unwrap_or(&c[letters..]);
    let workbook_name = workbook.is_some() && sheet.is_none()
        || public
            && sheet
                .as_deref()
                .is_some_and(|sheet| sheet.starts_with('[') && sheet.ends_with(']'));
    let position = if !workbook_name
        && letters > 0
        && !row.is_empty()
        && row.bytes().all(|b| b.is_ascii_digit())
    {
        let column = c[..letters].bytes().try_fold(0u64, |n, b| {
            n.checked_mul(26)?
                .checked_add(u64::from(b.to_ascii_uppercase() - b'A' + 1))
                .filter(|v| *v <= 9007199254740991)
        });
        row.parse::<u64>()
            .ok()
            .filter(|n| *n > 0 && *n <= 9007199254740991)
            .zip(column)
            .map(|(r, c)| (r - 1, c - 1))
    } else {
        None
    };
    if position.is_none()
        && (c.is_empty()
            || !c.chars().all(|c| {
                c.is_alphanumeric()
                    || c == '_'
                    || (sheet.is_some() || workbook.is_some()) && (c == '.' || public && c == '$')
            }))
    {
        return None;
    }
    Some(Endpoint {
        workbook,
        sheet,
        relative,
        cell: if let Some((r, _)) = position {
            format!(
                "{}{next}",
                cell[..cell.len() - row.len()].to_uppercase(),
                next = r + 1
            )
        } else {
            cell.into()
        },
        position,
    })
}
pub(super) fn range_split(raw: &str) -> Option<usize> {
    let mut quoted = false;
    raw.char_indices().find_map(|(i, c)| {
        if c == '\'' {
            quoted = !quoted;
        }
        (c == ':' && !quoted).then_some(i)
    })
}
pub(super) fn base(raw: &str) -> Option<Base> {
    if range_split(raw).is_some() {
        return None;
    }
    let endpoint = endpoint(raw, '.', false)?;
    let (row, column) = endpoint.position?;
    Some(Base {
        sheet: endpoint.sheet,
        row,
        column,
    })
}
pub(super) fn label_base(raw: &str) -> Option<Base> {
    let Some((sheet, cell)) = qualified(raw, '.') else {
        return base(raw);
    };
    let mut result = base(cell)?;
    if cell.contains('.') || result.sheet.is_some() {
        return None;
    }
    let sheet = sheet.strip_prefix('$').unwrap_or(sheet);
    result.sheet = if sheet.starts_with('\'') {
        let endpoint = endpoint(raw, '.', true)?;
        if endpoint.workbook.is_some() {
            return None;
        }
        endpoint.sheet.filter(|s| !s.is_empty())
    } else {
        if sheet.contains([' ', '[', ']', ':', '\'', '\t', '\r', '\n']) {
            return None;
        }
        (!sheet.is_empty()).then(|| sheet.to_owned())
    };
    if result
        .sheet
        .as_ref()
        .is_some_and(|s| s.contains(':') || s.starts_with('['))
    {
        return None;
    }
    Some(result)
}
fn reference(raw: &str, separator: char, sheets: &[String], public: bool) -> Option<Expr> {
    let split = range_split(raw);
    let (first, last) = split.map_or((raw, None), |i| (&raw[..i], Some(&raw[i + 1..])));
    let mut first = endpoint(first, separator, public)?;
    let mut last = match last {
        Some(raw) => Some(endpoint(raw, separator, public)?),
        None => None,
    };
    let axis = |part: &Endpoint| {
        let cell = part.cell.strip_prefix('$').unwrap_or(&part.cell);
        if !cell.is_empty() && cell.bytes().all(|c| c.is_ascii_alphabetic()) {
            Some(false)
        } else if cell
            .parse::<u64>()
            .is_ok_and(|n| (1..=9_007_199_254_740_991).contains(&n))
        {
            Some(true)
        } else {
            None
        }
    };
    let whole_axis = last
        .as_ref()
        .is_some_and(|last| axis(&first).zip(axis(last)).is_some_and(|(a, b)| a == b));
    let partial_range = public
        && first.position.is_some()
        && last.as_ref().is_some_and(|last| axis(last).is_some());
    if !whole_axis
        && !partial_range
        && (first.position.is_none()
            && (first.sheet.is_none() && first.workbook.is_none() || last.is_some())
            || last.as_ref().is_some_and(|p| p.position.is_none()))
    {
        return None;
    }
    if std::iter::once(&first).chain(last.iter()).any(|part| {
        part.sheet
            .as_deref()
            .is_some_and(|name| !super::valid_sheet_name(name))
    }) {
        return Some(Expr::Literal("#REF!".into()));
    }
    let local_name = first.workbook.as_deref() == Some("")
        && first.sheet.is_some()
        && first.position.is_none()
        && last.is_none();
    if local_name {
        first.workbook = None;
    }
    let inherited_sheet = last.as_ref().is_some_and(|part| part.sheet.is_none());
    if let Some(last) = &mut last {
        if last.sheet.is_none() {
            last.sheet.clone_from(&first.sheet);
            last.workbook.clone_from(&first.workbook);
            last.relative = first.relative;
        }
    }
    if let Some(last) = &mut last {
        let sheet_index = |name: &str| {
            sheets
                .iter()
                .position(|sheet| super::super::office::case_fold::same_name(sheet, name))
        };
        if !public
            && !whole_axis
            && !sheets.is_empty()
            && [&first, &*last].iter().any(|part| {
                part.sheet.as_deref().is_some_and(|name| {
                    sheet_index(name).is_none()
                        && !name.split_once(':').is_some_and(|(first, last)| {
                            sheet_index(first).is_some() && sheet_index(last).is_some()
                        })
                })
            })
        {
            return Some(Expr::Bad(raw.to_owned()));
        }
    }
    let singleton_range = !whole_axis
        && last.as_ref().is_some_and(|last| {
            last.workbook == first.workbook
                && last.sheet == first.sheet
                && last.relative == first.relative
                && last.cell == first.cell
        });
    if singleton_range {
        last = None;
    }
    let mut excel = String::new();
    let mut odf = Vec::new();
    let mut foreign = singleton_range || first.workbook.is_some();
    for (i, part) in std::iter::once(&first).chain(last.iter()).enumerate() {
        if i > 0 {
            excel.push(':');
        }
        let sheet = part
            .sheet
            .as_ref()
            .map(|s| format!("'{}'", s.replace('\'', "''")));
        if let Some(book) = &part.workbook {
            if i == 0 || part.sheet != first.sheet || part.workbook != first.workbook {
                excel.push_str(&format!(
                    "[\"{}\"]{}!",
                    book.replace('\\', "\\\\").replace('"', "\\\""),
                    sheet.as_deref().unwrap_or("")
                ));
            }
        } else if let Some(sheet) = &sheet {
            if i == 0 || part.sheet != first.sheet {
                excel.push_str(&format!("{sheet}!"));
            }
            foreign |= public && part.position.is_none()
                || part.relative && (part.position.is_some() || whole_axis)
                || part
                    .sheet
                    .as_ref()
                    .is_some_and(|s| s.starts_with('[') || s.contains(':'));
        }
        let cell = if (partial_range || public && whole_axis) && part.position.is_none() {
            part.cell.to_ascii_uppercase()
        } else {
            part.cell.clone()
        };
        excel.push_str(&cell);
        let sheet = sheet.filter(|_| i == 0 || !inherited_sheet);
        odf.push(format!(
            "{}{}{}.{}",
            part.workbook
                .as_ref()
                .map_or_else(String::new, |book| format!(
                    "'{}'#",
                    book.replace('\'', "''")
                )),
            if sheet.is_some() && !part.relative {
                "$"
            } else {
                ""
            },
            sheet.unwrap_or_default(),
            cell
        ));
    }
    if let Some(last) = &last
        && first.sheet != last.sheet
    {
        excel = format!(
            "'{}':'{}'!{}:{}",
            first.sheet.as_deref().unwrap_or("").replace('\'', "''"),
            last.sheet.as_deref().unwrap_or("").replace('\'', "''"),
            first.cell,
            last.cell
        );
    }
    Some(Expr::Reference {
        excel,
        odf: if sheets.is_empty()
            && separator == '.'
            && !local_name
            && (first.workbook.is_some()
                || first.sheet.is_some()
                || last.as_ref().is_some_and(|p| p.sheet.is_some()))
        {
            raw.to_owned()
        } else if singleton_range {
            format!("{0}:{0}", odf[0])
        } else {
            odf.join(":")
        },
        foreign,
        unbracketed_name: false,
    })
}
// Excel's unresolved document prefix is reparsed using Calc reference syntax.
fn external_prefix(raw: &str, sheets: &[String]) -> Expr {
    let bad = || Expr::Bad(raw.to_owned());
    let split = range_split(raw);
    let (sheet, cell) = raw
        .rsplit_once('.')
        .map_or((None, raw), |(s, c)| (Some(s), c));
    let known_sheet = sheet.filter(|s| !s.is_empty()).is_some_and(|s| {
        sheets
            .iter()
            .any(|name| super::super::office::case_fold::same_name(name, s.trim_start_matches('$')))
    });
    let row = |s: &str| {
        let digits = s.strip_prefix('$').unwrap_or(s);
        digits
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| digits.parse::<u64>().ok())
            .flatten()
            .filter(|n| (1..=1_048_576).contains(n))
    };
    if split.is_none()
        && let Some(n) = row(cell)
    {
        if known_sheet {
            return bad();
        }
        return Expr::Reference {
            excel: "#REF!".into(),
            odf: format!(
                "{}#REF!{}{n}",
                if sheet.is_some_and(|s| !s.is_empty()) {
                    "#REF!."
                } else {
                    ""
                },
                if cell.starts_with('$') { "$" } else { "" }
            ),
            foreign: true,
            unbracketed_name: false,
        };
    }
    if let Some(i) = split {
        let (a, b) = (&raw[..i], &raw[i + 1..]);
        let column = |s: &str| {
            let letters = s.strip_prefix('$').unwrap_or(s);
            if letters.is_empty() || !letters.bytes().all(|b| b.is_ascii_alphabetic()) {
                return None;
            }
            letters
                .bytes()
                .try_fold(0u64, |n, b| {
                    n.checked_mul(26)?
                        .checked_add(u64::from(b.to_ascii_uppercase() - b'A' + 1))
                })
                .filter(|n| *n <= 16384)
        };
        if let Some((x, y)) = row(a).zip(row(b)).or_else(|| column(a).zip(column(b))) {
            let (a, b) = if x > y { (b, a) } else { (a, b) };
            let axis = |s: &str| {
                row(s).map_or_else(
                    || s.to_ascii_uppercase(),
                    |n| format!("{}{n}", if s.starts_with('$') { "$" } else { "" }),
                )
            };
            let text = format!("{}:{}", axis(a), axis(b));
            return Expr::Reference {
                excel: text.clone(),
                odf: text,
                foreign: true,
                unbracketed_name: false,
            };
        }
    }
    let valid = |s: &str| {
        endpoint(s, '.', false)
            .is_some_and(|p| p.position.is_some_and(|(r, c)| r < 1_048_576 && c < 16384))
    };
    let valid = split.map_or_else(|| valid(raw), |i| valid(&raw[..i]) && valid(&raw[i + 1..]));
    if valid {
        if split.is_none() && sheet.is_some_and(|s| !s.is_empty()) && !known_sheet {
            return Expr::Reference {
                excel: "#REF!".into(),
                odf: format!("#REF!.{cell}"),
                foreign: true,
                unbracketed_name: false,
            };
        }
        return reference(raw, '.', sheets, false).unwrap_or_else(bad);
    }
    bad()
}
// Converted ODS references always quote sheet names. Parse quoted tokens so
// string arguments (notably INDIRECT and SHEET) retain their original spelling.
pub(in crate::commands) fn rename(
    mut source: &str,
    changes: &std::collections::BTreeMap<String, String>,
    remaining: &mut usize,
) -> Result<String, &'static str> {
    let mut output = String::new();
    while !source.is_empty() {
        let end = source.find(['\'', '"']).unwrap_or(source.len());
        *remaining = remaining.checked_sub(end).ok_or(super::LIMIT)?;
        output.push_str(&source[..end]);
        source = &source[end..];
        let Some(quote) = source.chars().next() else {
            break;
        };
        // Bad ODF tokens can contain unquoted apostrophes or quotes.
        // They are literal text, not the start of a sheet/string token.
        if output
            .chars()
            .last()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
        {
            *remaining = remaining.checked_sub(1).ok_or(super::LIMIT)?;
            output.push(quote);
            source = &source[1..];
            continue;
        }
        let mut end = 1;
        loop {
            let Some(next) = source[end..].find(quote) else {
                end = source.len();
                break;
            };
            end += next + 1;
            if source[end..].starts_with(quote) {
                end += 1;
            } else {
                break;
            }
        }
        let token = &source[..end];
        let tail = &source[end..];
        let cell = tail.strip_prefix('.').map(|tail| {
            let n = tail
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == b'$')
                .count();
            &tail[..n]
        });
        let reference = tail.starts_with(['!', ':'])
            || cell.is_some_and(|c| base(c).is_some())
            || tail.starts_with(".#REF!");
        let replacement = if quote == '\'' && reference {
            let name = token[1..end - 1].replace("''", "'");
            changes.get(&super::super::office::case_fold::sheet_key(&name))
        } else {
            None
        };
        if let Some(name) = replacement {
            *remaining = remaining
                .checked_sub(
                    name.len()
                        .checked_mul(2)
                        .and_then(|n| n.checked_add(2))
                        .ok_or(super::LIMIT)?,
                )
                .ok_or(super::LIMIT)?;
            let named = tail.strip_prefix('!').is_some_and(|tail| {
                let n = tail
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                    .map(char::len_utf8)
                    .sum::<usize>();
                n > 0 && base(&tail[..n]).is_none()
            });
            if named {
                output.push_str(&super::super::office::sheet_name::quote_sheet(name));
            } else {
                output.push('\'');
                output.push_str(&name.replace('\'', "''"));
                output.push('\'');
            }
        } else {
            *remaining = remaining.checked_sub(token.len()).ok_or(super::LIMIT)?;
            output.push_str(token);
        }
        source = &source[end..];
    }
    Ok(output)
}

pub(in crate::commands) struct Formula {
    invalid_public_syntax: bool,
    pub native_diagnostic: Option<(usize, usize)>,
    legacy: bool,
    calculation: Syntax<'static>,
    pub display: Option<String>,
    pub excel: String,
    pub openformula: Option<String>,
    pub error: Option<&'static str>,
    token_error: Option<&'static str>,
    expression: Option<Expr>,
    pub(super) external: bool,
    has_bindings: bool,
    pub(super) separators: bool,
}

pub(super) struct Group {
    row: usize,
    pub(super) first: usize,
    expression: Expr,
    numeric_hash: Option<u64>,
    rewritten: bool,
    pub(super) retained: usize,
}

impl Formula {
    pub(in crate::commands) fn has_live_references(
        &self,
        work: &mut usize,
    ) -> Result<bool, &'static str> {
        let mut pending: Vec<_> = self.expression.iter().collect();
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
            match node {
                Expr::LabelText(_) | Expr::Label(..) | Expr::Radical(..) | Expr::LiveName(_) => {
                    return Ok(true);
                }
                Expr::Call(_, args, _) => pending.extend(args),
                Expr::Array(rows) => pending.extend(rows.iter().flatten()),
                Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                Expr::Binary(_, left, right) => pending.extend([left.as_ref(), right.as_ref()]),
                _ => {}
            }
        }
        Ok(false)
    }
    pub(super) fn bind_labels(
        &mut self,
        sheets: &[&crate::commands::structured::xlsx::Sheet<String>],
        book: &crate::commands::structured::xlsx::Workbook,
        position: (usize, usize, usize),
        work: &mut usize,
    ) -> Result<bool, &'static str> {
        let mut pending: Vec<_> = self.expression.iter_mut().collect();
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
            while matches!(node, Expr::Spaced(..)) {
                let Expr::Spaced(_, child, _) = std::mem::replace(node, Expr::Omitted) else {
                    unreachable!()
                };
                *node = *child;
            }
            match node {
                Expr::Call(_, args, _) => pending.extend(args),
                Expr::Array(rows) => pending.extend(rows.iter_mut().flatten()),
                Expr::Unary(_, child) | Expr::Group(child) => pending.push(child),
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                _ => {}
            }
        }
        let Some(expression) = self.expression.as_mut() else {
            return Ok(false);
        };
        let mut pending = vec![expression];
        let mut changed = false;
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
            match node {
                Expr::LabelText(text) => {
                    *node = match super::labels::select(
                        text,
                        sheets,
                        book,
                        position,
                        self.legacy,
                        work,
                    )? {
                        Some((column, (sheet, row, col))) => {
                            let name = if sheet == position.0 {
                                String::new()
                            } else {
                                format!("$'{}'", sheets[sheet].name.replace('\'', "''"))
                            };
                            Expr::Label(
                                format!(
                                    "@{}{}.quoted",
                                    if column { "column" } else { "row" },
                                    if self.legacy { "" } else { ".odf" }
                                ),
                                format!(
                                    "{name}.{}{}{}{}",
                                    if column { "" } else { "$" },
                                    crate::commands::structured::xlsx_idx_to_col_ref(col),
                                    if column { "$" } else { "" },
                                    row + 1
                                ),
                            )
                        }
                        None => {
                            self.expression = None;
                            self.excel.clear();
                            self.openformula = None;
                            return Ok(true);
                        }
                    };
                    changed = true;
                }
                Expr::Binary(op, left, right)
                    if op == "!!"
                        && (!matches!(left.as_ref(), Expr::LabelText(_) | Expr::Label(..))
                            || !matches!(right.as_ref(), Expr::LabelText(_) | Expr::Label(..))) =>
                {
                    self.expression = None;
                    self.excel.clear();
                    self.openformula = None;
                    return Ok(true);
                }
                Expr::Call(_, args, _) => pending.extend(args),
                Expr::Array(rows) => pending.extend(rows.iter_mut().flatten()),
                Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                _ => {}
            }
        }
        if changed {
            let expression = self.expression.as_ref().unwrap();
            self.excel = expression.render(Syntax::Excel, work)?;
            self.openformula = Some(format!(
                "of:={}",
                expression.render(self.calculation, work)?
            ));
        }
        Ok(changed)
    }

    pub(in crate::commands) fn output_labels(
        &mut self,
        sheets: &[&crate::commands::structured::xlsx::Sheet<String>],
        book: &crate::commands::structured::xlsx::Workbook,
        position: (usize, usize, usize),
        work: &mut usize,
    ) -> Result<(), &'static str> {
        let invalid = "Unsupported ssconvert feature: live label identity in OpenDocument output\n";
        let Some(expression) = self.expression.as_mut() else {
            return Ok(());
        };
        let mut pending = vec![expression];
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
            match node {
                Expr::GlobalName(_) => {
                    return Err(
                        "Unsupported ssconvert feature: global formula name in target grammar\n",
                    );
                }
                Expr::LiveName(_) => {
                    return Err(
                        "Unsupported ssconvert feature: live name relocation in target grammar\n",
                    );
                }
                Expr::Radical(..) => return Err(invalid),
                Expr::Label(prefix, source) => {
                    if !matches!(prefix.as_str(), "@column.odf.quoted" | "@row.odf.quoted") {
                        return Err(invalid);
                    }
                    let column = prefix.starts_with("@column");
                    let part = endpoint(source, '.', true).ok_or(invalid)?;
                    let cell = part.cell.strip_prefix('$').unwrap_or(&part.cell);
                    let letters = cell.bytes().take_while(u8::is_ascii_alphabetic).count();
                    if part.workbook.is_some()
                        || part.sheet.is_some() && part.relative
                        || part.cell.starts_with('$') == column
                        || cell[letters..].starts_with('$') != column
                    {
                        return Err(invalid);
                    }
                    let anchor = base(source).ok_or(invalid)?;
                    let index = if let Some(name) = anchor.sheet {
                        sheets
                            .iter()
                            .position(|s| {
                                super::super::office::case_fold::fold(&s.name)
                                    == super::super::office::case_fold::fold(&name)
                            })
                            .ok_or(invalid)?
                    } else {
                        position.0
                    };
                    let coord = (index, anchor.row as usize, anchor.column as usize);
                    let Some(crate::commands::structured::xlsx::Value::Text(text)) = sheets
                        .get(index)
                        .and_then(|s| s.cells.get(&(coord.1, coord.2)))
                        .and_then(|c| c.value.as_ref())
                    else {
                        return Err(invalid);
                    };
                    if text.is_empty()
                        || super::labels::select(text, sheets, book, position, false, work)?
                            != Some((column, coord))
                    {
                        return Err(invalid);
                    }
                    *node = Expr::LabelText(text.clone());
                }
                Expr::Call(_, args, _) => pending.extend(args),
                Expr::Array(rows) => pending.extend(rows.iter_mut().flatten()),
                Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                _ => {}
            }
        }
        Ok(())
    }

    pub(in crate::commands) fn named_range(&self) -> Option<&str> {
        match self.expression.as_ref()? {
            Expr::Reference {
                odf,
                unbracketed_name: false,
                ..
            } => Some(odf),
            _ => None,
        }
    }
    pub(in crate::commands) fn public_expression(
        &mut self,
        work: &mut usize,
    ) -> Result<bool, &'static str> {
        if self.invalid_public_syntax
            || self.calculation == Syntax::GnumericOdf && self.token_error == Some("Err:520")
        {
            return Ok(false);
        }
        let reference_like = |mut node: &Expr, comma_edge: Option<bool>| {
            loop {
                node = match node {
                    Expr::Spaced(_, child, _) => child,
                    // Microsoft unions bind more tightly than arithmetic and
                    // trailing percentages. Check the adjacent reference token.
                    Expr::Binary(op, left, right)
                        if comma_edge.is_some() && precedence(op) < 8 && op != "," =>
                    {
                        if comma_edge == Some(true) {
                            right
                        } else {
                            left
                        }
                    }
                    Expr::Unary('%', child) if comma_edge == Some(false) => child,
                    Expr::Unary('+' | '-', child) if comma_edge == Some(true) => child,
                    _ => break,
                };
            }
            matches!(
                node,
                Expr::Reference { .. }
                    | Expr::Label(..)
                    | Expr::Radical(..)
                    | Expr::LabelText(_)
                    | Expr::Name(_)
                    | Expr::GlobalName(_)
                    | Expr::LiveName(_)
                    | Expr::Call(..)
                    | Expr::Group(_)
            ) || matches!(node, Expr::Binary(op, ..) if matches!(op.as_str(), ":" | "!" | "~" | "~;" | "~?" | "," | ""))
        };
        let Some(expression) = self.expression.as_mut() else {
            return Ok(false);
        };
        let mut changed = false;
        let mut native_names = false;
        let mut relative_sheets = false;
        let mut unions = false;
        let mut pending = vec![expression];
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
            if self.external
                && let Expr::Name(raw) = node
                && let Some((sheet, name)) = qualified(raw, '!')
            {
                *work = work.checked_sub(raw.len() * 8 + 256).ok_or(super::LIMIT)?;
                let sheet = sheet
                    .strip_prefix('\'')
                    .and_then(|s| s.strip_suffix('\''))
                    .map_or_else(|| sheet.to_owned(), |s| s.replace("''", "'"));
                if let Some(qualified) = reference(
                    &format!("$'{}'.{name}", sheet.replace('\'', "''")),
                    '.',
                    &[],
                    true,
                ) {
                    *node = qualified;
                    changed = true;
                }
            }
            if self.legacy
                && let Expr::Binary(op, left, right) = node
                && op == ","
                && let Expr::Name(first) = left.as_ref()
                && let Expr::Binary(op, sheet, name) = right.as_ref()
                && op == "!"
                && let (Expr::Name(sheet), Expr::Name(name)) = (sheet.as_ref(), name.as_ref())
            {
                // Legacy sheet qualifiers may contain an argument separator.
                *work = work
                    .checked_sub((first.len() + sheet.len() + name.len()) * 8 + 256)
                    .ok_or(super::LIMIT)?;
                if let Some(qualified) = reference(
                    &format!(
                        "'{};{}'.{name}",
                        first.replace('\'', "''"),
                        sheet.replace('\'', "''")
                    ),
                    '.',
                    &[],
                    true,
                ) {
                    *node = qualified;
                    changed = true;
                }
            }
            if let Expr::Binary(op, left, right) = node {
                if op == ":"
                    && let (Expr::Name(first), Expr::Name(last)) = (left.as_ref(), right.as_ref())
                    && first.bytes().all(|b| b.is_ascii_alphabetic())
                    && last.bytes().all(|b| b.is_ascii_alphabetic())
                {
                    *work = work
                        .checked_sub((first.len() + last.len()) * 8 + 256)
                        .ok_or(super::LIMIT)?;
                    if let Some(range) = reference(
                        &format!(
                            "{}:{}",
                            first.to_ascii_uppercase(),
                            last.to_ascii_uppercase()
                        ),
                        '.',
                        &[],
                        true,
                    ) {
                        *node = range;
                        changed = true;
                    }
                } else if self.legacy
                    && op == "!"
                    && let (Expr::Name(sheet), Expr::Name(name)) = (left.as_ref(), right.as_ref())
                {
                    *work = work
                        .checked_sub((sheet.len() + name.len()) * 8 + 256)
                        .ok_or(super::LIMIT)?;
                    if let Some(qualified) = reference(&format!("{sheet}!{name}"), '!', &[], true) {
                        *node = qualified;
                        changed = true;
                    }
                } else if self.external
                    && op.is_empty()
                    && reference_like(left, None)
                    && reference_like(right, None)
                {
                    *op = "!".into();
                    changed = true;
                }
            }
            if let Expr::Binary(op, left, right) = node
                && self.external
                && op == ","
            {
                if !reference_like(left, Some(true)) || !reference_like(right, Some(false)) {
                    return Ok(false);
                }
                let Expr::Binary(_, left, right) = std::mem::replace(node, Expr::Omitted) else {
                    unreachable!()
                };
                *node = left.public_union(*right, work, 0)?;
                changed = true;
                unions = true;
            }
            match node {
                Expr::Name(name) if !self.external && name.starts_with('\'') => {
                    return Ok(false);
                }
                Expr::Name(name)
                    if self.external
                        && !super::super::office::formulas::valid_native_name(name) =>
                {
                    return Ok(false);
                }
                Expr::Name(name) => {
                    native_names |= !super::super::office::formulas::valid_native_name(name);
                }
                Expr::Reference { odf, .. } => {
                    let split = range_split(odf);
                    let (first, last) =
                        split.map_or((odf.as_str(), None), |i| (&odf[..i], Some(&odf[i + 1..])));
                    relative_sheets |= std::iter::once(first)
                        .chain(last)
                        .filter_map(|s| endpoint(s, '.', true))
                        .any(|p| {
                            p.workbook.is_none()
                                && p.sheet.is_some()
                                && p.relative
                                && (p.position.is_some() || split.is_some())
                        });
                }
                Expr::Binary(op, left, right) => {
                    if matches!(op.as_str(), "~?" | ";" | "") || !self.external && op == "," {
                        return Ok(false);
                    }
                    if matches!(op.as_str(), ":" | "!" | "~" | ",")
                        && (!reference_like(left, (op == ",").then_some(true))
                            || !reference_like(right, (op == ",").then_some(false)))
                    {
                        return Ok(false);
                    }
                    pending.extend([left.as_mut(), right.as_mut()]);
                }
                Expr::Call(_, args, _) => pending.extend(args),
                Expr::Array(rows) => {
                    let width = rows.first().map_or(0, Vec::len);
                    for row in rows {
                        if row.len() != width {
                            return Ok(false);
                        }
                        for mut value in row {
                            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
                            while let Expr::Spaced(_, child, _) = value {
                                value = child;
                            }
                            let constant = match value {
                                Expr::Number(_, false) | Expr::Omitted => true,
                                Expr::Unary('+' | '-', child) => {
                                    matches!(child.as_ref(), Expr::Number(_, false))
                                }
                                Expr::Literal(s) => {
                                    s.is_empty()
                                        || s.starts_with(['"', '#'])
                                        || matches!(s.as_str(), "TRUE" | "FALSE")
                                }
                                _ => false,
                            };
                            if !constant {
                                return Ok(false);
                            }
                        }
                    }
                }
                Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                _ => {}
            }
        }
        if unions {
            self.separators = false;
            if matches!(self.token_error, Some("Err:508" | "Err:509")) {
                self.token_error = None;
            }
        }
        if changed {
            let expression = self.expression.as_ref().unwrap();
            self.excel = expression.render(Syntax::Excel, work)?;
            self.openformula = Some(format!(
                "of:={}",
                expression.render(self.calculation, work)?
            ));
            if self.external {
                self.error = self.token_error.or(expression.adjacency_error(work)?);
            }
        }
        if self.calculation == Syntax::GnumericOdf && native_names && !relative_sheets {
            // Preserve the native source that the public importer hands to its
            // calculation/export parsers, including names those parsers reject.
            self.openformula = Some(format!(
                "={}",
                self.expression
                    .as_ref()
                    .unwrap()
                    .render(Syntax::Gnumeric, work)?
            ));
        }
        Ok(true)
    }

    // Cell entry rejects references outside this workbook instead of storing a
    // broken reference, and creates placeholders for previously unknown names.
    pub(in crate::commands) fn entry_names(
        &self,
        sheets: &[String],
        sizes: &[(usize, usize)],
        work: &mut usize,
    ) -> Result<Option<Vec<(Option<usize>, String, bool)>>, &'static str> {
        let Some(expression) = self.expression.as_ref() else {
            return Ok(None);
        };
        let mut names = Vec::new();
        let mut pending = vec![expression];
        while let Some(node) = pending.pop() {
            *work = work.checked_sub(1).ok_or(super::LIMIT)?;
            match node {
                Expr::Radical(label) => {
                    let Some(anchor) = label.anchors.last().and_then(|a| label_base(a)) else {
                        return Ok(None);
                    };
                    let scope = if let Some(sheet) = anchor.sheet {
                        let Some(index) = sheets
                            .iter()
                            .position(|s| super::super::office::case_fold::same_name(s, &sheet))
                        else {
                            return Ok(None);
                        };
                        index
                    } else {
                        0
                    };
                    if anchor.row >= sizes[scope].0 as u64 || anchor.column >= sizes[scope].1 as u64
                    {
                        return Ok(None);
                    }
                }
                Expr::Reference { odf, .. } => {
                    let split = range_split(odf);
                    let (first, last) = split.map_or((odf.as_str(), None), |at| {
                        (&odf[..at], Some(&odf[at + 1..]))
                    });
                    let mut scope = 0;
                    for raw in std::iter::once(first).chain(last) {
                        let Some(part) = endpoint(raw, '.', true) else {
                            return Ok(None);
                        };
                        if part.workbook.is_some() {
                            return Ok(None);
                        }
                        if let Some(sheet) = part.sheet {
                            let Some(index) = sheets.iter().position(|s| {
                                super::super::office::case_fold::same_name(s, &sheet)
                            }) else {
                                return Ok(None);
                            };
                            scope = index;
                        }
                        if let Some((row, column)) = part.position {
                            if row >= sizes[scope].0 as u64 || column >= sizes[scope].1 as u64 {
                                return Ok(None);
                            }
                        } else if split.is_none() {
                            names.push((Some(scope), part.cell, false));
                        }
                    }
                }
                Expr::Name(name) => {
                    let (scope, name) = if let Some((sheet, name)) = qualified(name, '!') {
                        let sheet = sheet
                            .strip_prefix('\'')
                            .and_then(|s| s.strip_suffix('\''))
                            .map_or_else(|| sheet.to_owned(), |s| s.replace("''", "'"));
                        let Some(index) = sheets
                            .iter()
                            .position(|s| super::super::office::case_fold::same_name(s, &sheet))
                        else {
                            return Ok(None);
                        };
                        (Some(index), name.to_owned())
                    } else {
                        (None, name.clone())
                    };
                    names.push((scope, name, false));
                }
                Expr::GlobalName(name) => names.push((None, name.clone(), true)),
                Expr::Binary(_, left, right) => pending.extend([right.as_ref(), left.as_ref()]),
                Expr::Call(_, args, _) => pending.extend(args.iter().rev()),
                Expr::Array(rows) => {
                    pending.extend(rows.iter().rev().flat_map(|row| row.iter().rev()))
                }
                Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                _ => {}
            }
        }
        Ok(Some(names))
    }

    pub(in crate::commands) fn open_document(
        &self,
        work: &mut usize,
    ) -> Result<Option<String>, &'static str> {
        let Some(expression) = self.expression.as_ref() else {
            return Ok(None);
        };
        Ok(Some(format!(
            "of:={}",
            expression.render(Syntax::GnumericOdfExport, work)?
        )))
    }

    pub(in crate::commands) fn native_xlsx(
        &self,
        sheets: &[String],
        work: &mut usize,
    ) -> Result<String, &'static str> {
        if self.native_diagnostic.is_some() {
            return Err("Unsupported ssconvert feature: unparsed XLSX formula");
        }
        match &self.expression {
            Some(expression) => expression.render(Syntax::GnumericXlsx(sheets), work),
            None => Ok(self.excel.clone()),
        }
    }

    pub(super) fn export(
        &mut self,
        group: Option<&Group>,
        sheets: &[String],
        changes: &std::collections::BTreeMap<String, String>,
        work: &mut usize,
    ) -> Result<(), &'static str> {
        let Some(expression) = self
            .expression
            .as_ref()
            .or_else(|| group.map(|g| &g.expression))
        else {
            return Ok(());
        };
        let text = expression.render(Syntax::Xlsx(sheets, changes), work)?;
        if text != self.excel && self.openformula.is_none() {
            self.openformula = Some(format!(
                "of:={}",
                expression.render(self.calculation, work)?
            ));
        }
        self.excel = text;
        Ok(())
    }

    pub(in crate::commands) fn compile_separators(
        &mut self,
        names: &[crate::commands::structured::xlsx::NamedExpression],
        sheets: &[String],
        sheet: usize,
        bindings: Option<&std::collections::BTreeMap<String, Option<usize>>>,
        work: &mut usize,
    ) -> Result<(), &'static str> {
        if self.calculation == Syntax::GnumericOdf
            || !(self.separators || self.external && self.has_bindings)
            || self.error.is_some()
                && !(self.external && matches!(self.error, Some("Err:508" | "Err:509" | "Err:520")))
        {
            return Ok(());
        }
        let Some(expression) = self.expression.as_mut() else {
            return Ok(());
        };
        let mut compiler = SeparatorCompiler {
            names,
            sheets,
            visiting: Vec::new(),
            tokens: Vec::new(),
            failed: false,
            stopped: false,
            error: None,
            work,
        };
        compiler.compile(expression, sheet, bindings, false, 0)?;
        self.error = compiler.error.or(self.token_error).or(self.error);
        if !self.separators {
            return Ok(());
        }
        self.excel = expression.render(Syntax::Excel, work)?;
        self.display = Some(expression.render(Syntax::Calc, work)?);
        self.openformula = Some(format!(
            "of:={}",
            expression.render(self.calculation, work)?
        ));
        Ok(())
    }

    pub(super) fn bind_names(
        &mut self,
        case_sensitive: bool,
        names: &std::collections::BTreeMap<(Option<usize>, String), &str>,
        sheet: usize,
        sheets: &[String],
        work: &mut usize,
    ) -> Result<(), &'static str> {
        if !self.has_bindings {
            return Ok(());
        }
        let excel = self.external;
        self.resolve_names(sheets, work, true, |name, work| {
            let selected = lookup_name(name, excel, sheet, sheets, work, |key| {
                names.get(key).copied()
            })?;
            selected
                .filter(|(_, declared)| !case_sensitive || name == *declared)
                .map(|(scope, name)| {
                    *work = work
                        .checked_sub(name.len() + scope.map_or(0, |s| sheets[s].len() * 2 + 3))
                        .ok_or(super::LIMIT)?;
                    Ok(if let Some(scope) = scope.filter(|s| *s != sheet) {
                        format!(
                            "{}!{name}",
                            if sheets[scope].encode_utf16().count() > 31 {
                                format!("'{}'", sheets[scope].replace('\'', "''"))
                            } else {
                                super::super::office::sheet_name::quote_sheet(&sheets[scope])
                            }
                        )
                    } else {
                        name.to_owned()
                    })
                })
                .transpose()
        })?;
        Ok(())
    }

    // Return whether an unknown function requires Calc's final name compilation.
    pub(super) fn resolve_names(
        &mut self,
        sheets: &[String],
        work: &mut usize,
        finalize: bool,
        mut resolve: impl FnMut(&str, &mut usize) -> Result<Option<String>, &'static str>,
    ) -> Result<bool, &'static str> {
        let Some(expression) = self.expression.as_mut() else {
            return Ok(false);
        };
        let mut unknown = false;
        let mut pending = vec![expression];
        let mut changed = false;
        let mut sheet_names = None;
        while let Some(value) = pending.pop() {
            *work = work
                .checked_sub(std::mem::size_of::<Expr>())
                .ok_or(super::LIMIT)?;
            match value {
                Expr::Reference {
                    excel,
                    odf,
                    foreign,
                    ..
                } => {
                    *work = work
                        .checked_sub(
                            odf.len() * 4 + sheets.iter().map(|s| s.len() * 4 + 32).sum::<usize>(),
                        )
                        .ok_or(super::LIMIT)?;
                    if self.external
                        && self.calculation != Syntax::GnumericOdf
                        && endpoint(odf, '.', self.calculation == Syntax::GnumericOdf)
                            .filter(|p| {
                                self.calculation != Syntax::GnumericOdf || p.position.is_some()
                            })
                            .and_then(|p| p.sheet)
                            .is_some_and(|sheet| {
                                !sheets
                                    .iter()
                                    .any(|s| super::super::office::case_fold::same_name(s, &sheet))
                            })
                    {
                        let upper = collation::uppercase(excel, work).ok_or(super::LIMIT)?;
                        *value = Expr::Bad(function_names::unknown(&upper));
                        changed = true;
                        continue;
                    }
                    match reference(odf, '.', sheets, self.calculation == Syntax::GnumericOdf) {
                        Some(Expr::Reference {
                            excel: normalized,
                            odf: source,
                            foreign: normalized_foreign,
                            ..
                        }) => {
                            changed |= *excel != normalized
                                || *odf != source
                                || !*foreign && normalized_foreign;
                            *excel = normalized;
                            *odf = source;
                            *foreign |= normalized_foreign;
                        }
                        Some(Expr::Bad(raw)) => {
                            *value = Expr::Bad(raw);
                            changed = true;
                            continue;
                        }
                        _ => {}
                    }
                    if self.calculation == Syntax::GnumericOdf
                        && endpoint(&odf[..range_split(odf).unwrap_or(odf.len())], '.', true)
                            .is_some_and(|part| part.workbook.is_some())
                    {
                        // External sheet names do not belong to the importing workbook.
                        continue;
                    }
                    if sheet_names.is_none() {
                        let mut names = std::collections::BTreeMap::new();
                        for name in sheets {
                            *work = work.checked_sub(name.len() * 4 + 128).ok_or(super::LIMIT)?;
                            names.insert(
                                super::super::office::case_fold::sheet_key(name),
                                name.clone(),
                            );
                        }
                        sheet_names = Some(names);
                    }
                    let names = sheet_names.as_ref().unwrap();
                    for source in [excel, odf] {
                        let canonical = rename(source, names, work)?;
                        changed |= canonical != *source;
                        *source = canonical;
                    }
                }
                Expr::Name(name) => {
                    if let Some(declared) = resolve(name, work)? {
                        *name = declared;
                        changed = true;
                    }
                }
                Expr::Bad(_) => changed |= finalize,
                Expr::Array(rows) => pending.extend(rows.iter_mut().flatten()),
                Expr::Call(name, args, _) => {
                    unknown |= function_names::name(name, false).is_none();
                    pending.extend(args);
                }
                Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                    pending.push(child);
                }
                Expr::Binary(op, a, b) => {
                    if op == "[]" {
                        if let Expr::Bad(header) = a.as_ref() {
                            *work = work
                                .checked_sub(
                                    header.len() * 8
                                        + sheets.iter().map(|s| s.len() * 4 + 32).sum::<usize>()
                                        + 256,
                                )
                                .ok_or(super::LIMIT)?;
                            **a = external_prefix(header, sheets);
                        }
                        op.clear();
                        changed = true;
                        pending.push(b.as_mut());
                    } else {
                        pending.extend([a.as_mut(), b.as_mut()]);
                    }
                }
                _ => {}
            }
        }
        if self.external {
            let mut pending = vec![self.expression.as_mut().unwrap()];
            while let Some(value) = pending.pop() {
                *work = work
                    .checked_sub(std::mem::size_of::<Expr>())
                    .ok_or(super::LIMIT)?;
                match value {
                    Expr::Binary(op, left, right) => {
                        let mut first = left.as_ref();
                        let mut last = right.as_ref();
                        while let Expr::Spaced(_, child, _) = first {
                            first = child;
                        }
                        while let Expr::Spaced(_, child, _) = last {
                            last = child;
                        }
                        if op.is_empty()
                            && matches!(first, Expr::Bad(_))
                            && matches!(last, Expr::Name(_))
                        {
                            // Name expansion inserts parentheses, so the preceding
                            // bad token becomes an unknown function call.
                            *op = "()".into();
                            changed = true;
                        }
                        pending.extend([left.as_mut(), right.as_mut()]);
                    }
                    Expr::Call(_, args, _) => pending.extend(args),
                    Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                        pending.push(child)
                    }
                    _ => {}
                }
            }
            self.error =
                self.token_error
                    .or(self.expression.as_ref().unwrap().adjacency_error(work)?);
        }
        if changed {
            let expression = self.expression.as_ref().unwrap();
            self.excel = expression.render(Syntax::Excel, work)?;
            self.display = Some(expression.render(Syntax::Calc, work)?);
            if !self
                .openformula
                .as_deref()
                .is_some_and(|s| s.starts_with('='))
            {
                self.openformula = if expression.foreign(self.calculation == Syntax::GnumericOdf) {
                    Some(format!(
                        "of:={}",
                        expression.render(self.calculation, work)?
                    ))
                } else {
                    None
                };
            }
        }
        Ok(unknown)
    }

    pub(super) fn group(
        &mut self,
        source: &str,
        row: usize,
        array: bool,
        previous: Option<&Group>,
        work: &mut usize,
    ) -> Result<Option<Group>, &'static str> {
        let Some(expression) = self.expression.as_mut().filter(|_| self.error.is_none()) else {
            return Ok(None);
        };
        let mut retained = std::mem::size_of::<(usize, Group)>();
        let mut rewritten = self.separators;
        let mut pending = vec![&*expression];
        while let Some(value) = pending.pop() {
            *work = work
                .checked_sub(std::mem::size_of::<Expr>() + 32)
                .ok_or(super::LIMIT)?;
            let bytes = match value {
                Expr::Array(_) => return Ok(None),
                Expr::Number(n, _) => {
                    rewritten |= number_format::number(*n, true).parse::<f64>() != Ok(*n);
                    0
                }
                Expr::Literal(s)
                | Expr::Name(s)
                | Expr::GlobalName(s)
                | Expr::Bad(s)
                | Expr::LabelText(s) => s.len(),
                Expr::LiveName(name) => std::mem::size_of::<LiveName>() + name.render(false).len(),
                Expr::Label(prefix, anchor) => prefix.len() + anchor.len(),
                Expr::Radical(label) => {
                    std::mem::size_of::<RadicalLabel>()
                        + label.prefix.len()
                        + label
                            .anchors
                            .iter()
                            .map(|a| a.len() + std::mem::size_of::<String>())
                            .sum::<usize>()
                        + label.data.as_ref().map_or(0, String::len)
                }
                Expr::Reference { excel, odf, .. } => excel.len() + odf.len(),
                Expr::Call(name, args, _) => {
                    rewritten |= matches!(
                        (name.as_str(), args.len()),
                        ("NORMDIST" | "GAMMADIST", 3)
                            | ("LOGINV" | "LOGNORMDIST", 1 | 2)
                            | ("POISSON", 2)
                    );
                    pending.extend(args);
                    name.len()
                }
                Expr::Group(child) | Expr::Unary(_, child) => {
                    pending.push(child);
                    0
                }
                Expr::Spaced(before, child, after) => {
                    pending.push(child);
                    before.len() + after.len()
                }
                Expr::Binary(op, a, b) => {
                    pending.extend([a.as_ref(), b.as_ref()]);
                    op.len()
                }
                _ => 0,
            };
            *work = work.checked_sub(bytes).ok_or(super::LIMIT)?;
            retained += std::mem::size_of::<Expr>() + bytes;
        }
        let mut first = row;
        let mut changed = false;
        if !self.external
            && let Some(previous) = previous.filter(|p| p.row + 1 == row && p.rewritten)
            && let Some(source) = source
                .strip_prefix("{urn:oasis:names:tc:opendocument:xmlns:of:1.2}")
                .or_else(|| source.strip_prefix("{http://openoffice.org/2004/calc}"))
        {
            // Calc first compares the original text with the previous cell's
            // compiled spelling, including rewritten separators and optional
            // arguments. Reversing these rows does not qualify for this reuse.
            *work = work.checked_sub(previous.retained).ok_or(super::LIMIT)?;
            let mut candidate = previous.expression.clone();
            let mut candidate_size = previous.retained;
            let mut pending = vec![&mut candidate];
            while let Some(value) = pending.pop() {
                *work = work.checked_sub(32).ok_or(super::LIMIT)?;
                match value {
                    Expr::Reference { excel, odf, .. } => {
                        for text in [excel, odf] {
                            let split = range_split(text);
                            let (first, last) = split.map_or((text.as_str(), None), |i| {
                                (&text[..i], Some(&text[i + 1..]))
                            });
                            let mut parts = Vec::new();
                            for raw in std::iter::once(first).chain(last) {
                                let digits = raw.trim_end_matches(|c: char| c.is_ascii_digit());
                                let shifted = if !digits.ends_with('$')
                                    && let Ok(row) = raw[digits.len()..].parse::<u64>()
                                {
                                    format!("{digits}{}", row + 1)
                                } else {
                                    raw.to_owned()
                                };
                                *work = work.checked_sub(shifted.len() + 32).ok_or(super::LIMIT)?;
                                parts.push(shifted);
                            }
                            candidate_size -= text.len();
                            *text = parts.join(":");
                            candidate_size += text.len();
                        }
                    }
                    Expr::Call(_, args, _) => pending.extend(args),
                    Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                        pending.push(child)
                    }
                    Expr::Binary(_, a, b) => pending.extend([a.as_mut(), b.as_mut()]),
                    _ => {}
                }
            }
            let syntax = if self.calculation == Syntax::GnumericOdf {
                self.calculation
            } else {
                Syntax::CompiledCalculation
            };
            if candidate.render(syntax, work)? == source.strip_prefix('=').unwrap_or(source) {
                *expression = candidate;
                retained = candidate_size;
                first = previous.first;
                rewritten = previous.rewritten;
                changed = true;
            }
        }
        let numeric_hash = if self.external {
            None
        } else {
            Some(expression.numeric_hash(work)?)
        };
        if !changed
            && !array
            && let Some(previous) =
                previous.filter(|p| p.row + 1 == row && p.numeric_hash == numeric_hash)
            && expression.same_group(&previous.expression, work)?
        {
            first = previous.first;
            // Share equivalent scalar token arrays; matrices are never shareable.
            let mut pending = vec![(expression, &previous.expression)];
            while let Some((current, prior)) = pending.pop() {
                *work = work.checked_sub(32).ok_or(super::LIMIT)?;
                match (current, prior) {
                    (Expr::Call(_, a, _), Expr::Call(_, b, _)) => {
                        pending.extend(a.iter_mut().zip(b))
                    }
                    (Expr::Group(a), Expr::Group(b)) | (Expr::Unary(_, a), Expr::Unary(_, b)) => {
                        pending.push((a, b));
                    }
                    (Expr::Spaced(a, child, b), Expr::Spaced(c, prior, d)) => {
                        *work = work.checked_sub(c.len() + d.len()).ok_or(super::LIMIT)?;
                        changed |= a != c || b != d;
                        a.clone_from(c);
                        b.clone_from(d);
                        pending.push((child, prior));
                    }
                    (Expr::Binary(_, a, b), Expr::Binary(_, c, d)) => {
                        pending.extend([(a.as_mut(), c.as_ref()), (b.as_mut(), d.as_ref())]);
                    }
                    _ => {}
                }
            }
        }
        if changed {
            let expression = self.expression.as_ref().unwrap();
            self.excel = expression.render(Syntax::Excel, work)?;
            if self.display.is_some() {
                self.display = Some(expression.render(Syntax::Calc, work)?);
            }
            self.openformula = if expression.foreign(self.calculation == Syntax::GnumericOdf) {
                Some(format!(
                    "of:={}",
                    expression.render(self.calculation, work)?
                ))
            } else {
                None
            };
        }
        Ok(self.expression.take().map(|expression| Group {
            row,
            first,
            expression,
            numeric_hash,
            rewritten,
            retained,
        }))
    }
}

impl Expr {
    fn numeric_hash(&self, work: &mut usize) -> Result<u64, &'static str> {
        // GenHash visits the first 20 lexical tokens. For expressions that
        // pass same_group, all nonnumeric contributions are equal and cancel.
        // Keep its wrapping arithmetic, including possible numeric collisions.
        let mut pending = vec![Some(self)];
        let mut hash = 0u64;
        let mut tokens = 0;
        while tokens < 20 {
            let Some(value) = pending.pop() else { break };
            *work = work.checked_sub(32).ok_or(super::LIMIT)?;
            let number = match value {
                Some(Self::Number(n, percent)) => {
                    if *percent {
                        pending.push(None);
                    }
                    Some(*n)
                }
                Some(Self::Literal(s)) => s.parse::<f64>().ok(),
                Some(Self::Group(child)) => {
                    pending.extend([None, Some(child.as_ref()), None]);
                    continue;
                }
                Some(Self::Unary('%', child)) => {
                    pending.extend([None, Some(child.as_ref())]);
                    continue;
                }
                Some(Self::Unary(_, child)) => {
                    pending.extend([Some(child.as_ref()), None]);
                    continue;
                }
                Some(Self::Binary(_, a, b)) => {
                    pending.extend([Some(b.as_ref()), None, Some(a.as_ref())]);
                    continue;
                }
                Some(Self::Spaced(before, child, after)) => {
                    *work = work
                        .checked_sub(before.len() + after.len())
                        .ok_or(super::LIMIT)?;
                    pending.extend(
                        after
                            .as_bytes()
                            .chunk_by(|a, b| a == b)
                            .take(20)
                            .map(|_| None),
                    );
                    pending.push(Some(child));
                    pending.extend(
                        before
                            .as_bytes()
                            .chunk_by(|a, b| a == b)
                            .take(20)
                            .map(|_| None),
                    );
                    continue;
                }
                Some(Self::Call(_, args, _)) => {
                    *work = work.checked_sub(args.len() * 32).ok_or(super::LIMIT)?;
                    pending.push(None);
                    for (index, arg) in args.iter().enumerate().rev() {
                        pending.push(Some(arg));
                        if index > 0 {
                            pending.push(None);
                        }
                    }
                    pending.extend([None, None]);
                    continue;
                }
                _ => None,
            };
            if let Some(number) = number {
                hash = hash.wrapping_add(super::super::office::formulas::number_hash(number));
            }
            hash = hash.wrapping_mul(15);
            tokens += 1;
        }
        Ok(hash)
    }

    fn same_group(&self, previous: &Self, work: &mut usize) -> Result<bool, &'static str> {
        let mut pending = vec![(self, previous)];
        while let Some((current, prior)) = pending.pop() {
            *work = work.checked_sub(32).ok_or(super::LIMIT)?;
            match (current, prior) {
                (Self::Omitted, Self::Omitted) | (Self::OmittedZero, Self::OmittedZero) => {}
                (Self::Number(a, p), Self::Number(b, q))
                    if p == q && a.to_bits() == b.to_bits() => {}
                (Self::Literal(a), Self::Literal(b))
                | (Self::Name(a), Self::Name(b))
                | (Self::GlobalName(a), Self::GlobalName(b))
                | (Self::Bad(a), Self::Bad(b))
                    if a == b => {}
                (Self::Reference { odf: a, .. }, Self::Reference { odf: b, .. }) => {
                    *work = work
                        .checked_sub((a.len() + b.len()) * 2 + 4 * std::mem::size_of::<Endpoint>())
                        .ok_or(super::LIMIT)?;
                    let parts = |s: &str| {
                        let split = range_split(s);
                        let (first, last) =
                            split.map_or((s, None), |i| (&s[..i], Some(&s[i + 1..])));
                        std::iter::once(first)
                            .chain(last)
                            .map(|s| endpoint(s, '.', false))
                            .collect::<Option<Vec<_>>>()
                    };
                    let (Some(a), Some(b)) = (parts(a), parts(b)) else {
                        return Ok(false);
                    };
                    if a.len() != b.len() {
                        return Ok(false);
                    }
                    for (a, b) in a.iter().zip(&b) {
                        if a.sheet != b.sheet || a.relative != b.relative {
                            return Ok(false);
                        }
                        match (a.position, b.position) {
                            (Some((ar, ac)), Some((br, bc))) => {
                                let row_fixed = |cell: &str| {
                                    cell.strip_prefix('$').unwrap_or(cell).contains('$')
                                };
                                if ac != bc
                                    || a.cell.starts_with('$') != b.cell.starts_with('$')
                                    || row_fixed(&a.cell) != row_fixed(&b.cell)
                                    || ar != br + u64::from(!row_fixed(&a.cell))
                                {
                                    return Ok(false);
                                }
                            }
                            (None, None) if a.cell == b.cell => {}
                            _ => return Ok(false),
                        }
                    }
                }
                (Self::Call(a, args, omit), Self::Call(b, prior, prior_omit))
                    if a == b && omit == prior_omit && args.len() == prior.len() =>
                {
                    pending.extend(args.iter().zip(prior));
                }
                (Self::Group(a), Self::Group(b)) => pending.push((a, b)),
                (Self::Unary(a, child), Self::Unary(b, prior)) if a == b => {
                    pending.push((child, prior))
                }
                (Self::Spaced(a, child, b), Self::Spaced(c, prior, d))
                    if a.as_bytes()
                        .chunk_by(|a, b| a == b)
                        .map(|s| s[0])
                        .eq(c.as_bytes().chunk_by(|a, b| a == b).map(|s| s[0]))
                        && b.as_bytes()
                            .chunk_by(|a, b| a == b)
                            .map(|s| s[0])
                            .eq(d.as_bytes().chunk_by(|a, b| a == b).map(|s| s[0])) =>
                {
                    pending.push((child, prior))
                }
                (Self::Binary(a, left, right), Self::Binary(b, prior_left, prior_right))
                    if a == b =>
                {
                    pending.extend([
                        (left.as_ref(), prior_left.as_ref()),
                        (right.as_ref(), prior_right.as_ref()),
                    ]);
                }
                _ => return Ok(false),
            }
        }
        Ok(true)
    }
}

fn public_array_strings(rows: &mut [Vec<Expr>]) {
    for mut value in rows.iter_mut().flatten() {
        while let Expr::Spaced(_, inner, _) = value {
            value = inner;
        }
        if let Expr::Literal(source) = value
            && let Some(text) = source.strip_prefix('"').and_then(|s| s.strip_suffix('"'))
            && let Some(converted) = array_string_value(&text.replace("\"\"", "\""))
        {
            *value = match converted {
                Value::Number(n) => Expr::Number(if n == 0. { 0. } else { n }, false),
                Value::Bool(b) => Expr::Literal(if b { "TRUE" } else { "FALSE" }.into()),
                Value::LiteralError(error) => Expr::Literal(error.into()),
                _ => continue,
            };
        }
    }
}

pub(in crate::commands) fn gnumeric_text(
    source: &str,
    preserve_source: bool,
    work: &mut usize,
) -> Result<(String, bool), String> {
    let retained = source.starts_with("of:=");
    let input = if retained {
        source.to_owned()
    } else {
        format!("msoxl:={}", source.strip_prefix('=').unwrap_or(source))
    };
    let parsed = convert(true, &input, false, *work, true).map_err(str::to_owned)?;
    let Some(parsed) = parsed else {
        return Ok((source.strip_prefix('=').unwrap_or(source).into(), retained));
    };
    if preserve_source && !retained && !parsed.has_live_references(work).map_err(str::to_owned)? {
        return Ok((source.strip_prefix('=').unwrap_or(source).into(), false));
    }
    let Some(expression) = parsed.expression else {
        return Ok((source.strip_prefix('=').unwrap_or(source).into(), retained));
    };
    let mut relative_sheets = false;
    let mut pending = vec![&expression];
    while let Some(node) = pending.pop() {
        *work = work.checked_sub(1).ok_or(super::LIMIT)?;
        match node {
            Expr::Reference { odf, .. } => {
                let split = range_split(odf);
                let (first, last) =
                    split.map_or((odf.as_str(), None), |i| (&odf[..i], Some(&odf[i + 1..])));
                relative_sheets |= std::iter::once(first)
                    .chain(last)
                    .filter_map(|s| endpoint(s, '.', true))
                    .any(|p| {
                        p.workbook.is_none()
                            && p.sheet.is_some()
                            && p.relative
                            && (p.position.is_some() || split.is_some())
                    });
            }
            Expr::Call(_, args, _) => pending.extend(args),
            Expr::Array(rows) => pending.extend(rows.iter().flatten()),
            Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                pending.push(child)
            }
            Expr::Binary(_, left, right) => pending.extend([left.as_ref(), right.as_ref()]),
            _ => {}
        }
    }
    Ok((
        expression
            .render(Syntax::GnumericXml(false), work)
            .map_err(str::to_owned)?,
        relative_sheets,
    ))
}

pub(in crate::commands) fn xlsx_name(
    source: &str,
    array_strings: bool,
    work: &mut usize,
) -> Result<Option<String>, &'static str> {
    let Some(mut parsed) = convert(true, &format!("msoxl:={source}"), false, *work, true)? else {
        return Ok(None);
    };
    if !parsed.public_expression(work)? {
        return Ok(None);
    }
    let Some(mut expression) = parsed.expression else {
        return Ok(None);
    };
    if !array_strings {
        let mut pending = vec![&mut expression];
        while let Some(node) = pending.pop() {
            *work = work
                .checked_sub(std::mem::size_of::<Expr>())
                .ok_or(super::LIMIT)?;
            match node {
                Expr::Array(rows) => {
                    public_array_strings(rows);
                    pending.extend(rows.iter_mut().flatten());
                }
                Expr::Call(_, args, _) => pending.extend(args),
                Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                _ => {}
            }
        }
    }
    expression.render(Syntax::GnumericXml(true), work).map(Some)
}

pub(in crate::commands) fn expression_text(
    source: &str,
    csv: bool,
    work: &mut usize,
) -> Result<Option<String>, &'static str> {
    let converted;
    let retained = source.starts_with("of:=") || source.starts_with("msoxl:=");
    let source = if retained {
        source
    } else {
        converted = format!("msoxl:={}", source.strip_prefix('=').unwrap_or(source));
        &converted
    };
    let normalized = source.starts_with("of:=");
    let Some(mut parsed) = convert(csv || retained, source, false, *work, true)? else {
        return Ok(None);
    };
    if !parsed.public_expression(work)? {
        return Ok(None);
    }
    let Some(mut expression) = parsed.expression else {
        return Ok(None);
    };
    {
        let mut pending = vec![&mut expression];
        while let Some(node) = pending.pop() {
            *work = work
                .checked_sub(std::mem::size_of::<Expr>())
                .ok_or(super::LIMIT)?;
            match node {
                Expr::Call(name, args, _) => {
                    if normalized {
                        *name = function_names::public_odf(name);
                    }
                    pending.extend(args);
                }
                Expr::Array(rows) => {
                    public_array_strings(rows);
                    pending.extend(rows.iter_mut().flatten());
                }
                Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                    pending.push(child)
                }
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                _ => {}
            }
        }
    }
    Ok(Some(format!(
        "={}",
        expression.render(Syntax::Gnumeric, work)?
    )))
}

// Normalize public formula spelling from the retained compiler source. After
// export, only relative named-sheet references need OpenFormula metadata.
pub(in crate::commands) fn export_public_xlsx(
    excel: &mut String,
    openformula: &mut Option<String>,
    sheets: &[String],
    sheet: usize,
    links: &mut Vec<(String, Vec<String>)>,
    array_strings: bool,
    work: &mut usize,
) -> Result<(), &'static str> {
    let Some(source) = openformula.as_deref() else {
        return Ok(());
    };
    let Some(parsed) = convert(true, source, false, *work, true)? else {
        return Ok(());
    };
    if parsed.native_diagnostic.is_some() {
        return Err("Unsupported ssconvert feature: unparsed XLSX formula");
    }
    let Some(mut expression) = parsed.expression else {
        return Ok(());
    };
    let mut relative_sheets = false;
    let mut pending = vec![&mut expression];
    while let Some(node) = pending.pop() {
        *work = work
            .checked_sub(std::mem::size_of::<Expr>())
            .ok_or(super::LIMIT)?;
        match node {
            Expr::Reference {
                odf,
                excel,
                unbracketed_name,
                ..
            } => {
                let (first, last) = range_split(odf)
                    .map_or((odf.as_str(), None), |i| (&odf[..i], Some(&odf[i + 1..])));
                let mut parts: Vec<_> = std::iter::once(first)
                    .chain(last)
                    .filter_map(|s| endpoint(s, '.', true))
                    .collect();
                for part in &mut parts {
                    if part.workbook.is_none()
                        && let Some((book, sheet)) = part
                            .sheet
                            .as_deref()
                            .and_then(|s| s.strip_prefix('['))
                            .and_then(|s| s.split_once(']'))
                    {
                        part.workbook = Some(book.into());
                        part.sheet = (!sheet.is_empty()).then(|| sheet.into());
                        part.relative = false;
                    }
                }
                if let Some(first) = parts.first()
                    && let Some((start, end)) = first
                        .sheet
                        .as_deref()
                        .filter(|s| !s.starts_with('['))
                        .and_then(|s| s.split_once(':'))
                {
                    let (start, end) = (start.to_owned(), end.to_owned());
                    if parts.len() == 1 {
                        parts.push(parts[0].clone());
                    }
                    if parts[1].sheet.is_none() {
                        parts[1].relative = parts[0].relative;
                    }
                    parts[0].sheet = Some(start);
                    parts[1].sheet = Some(end);
                }
                relative_sheets |= parts.iter().any(|part| {
                    part.workbook.is_none()
                        && part.sheet.as_ref().is_some_and(|s| !s.starts_with('['))
                        && part.relative
                        && (part.position.is_some() || parts.len() > 1)
                });
                if !*unbracketed_name && let Some(first) = parts.first() {
                    *odf =
                        parts
                            .iter()
                            .enumerate()
                            .map(|(index, part)| {
                                let sheet = part.sheet.as_ref().or(first.sheet.as_ref());
                                let relative = if index > 0 && part.sheet.is_none() {
                                    first.relative
                                } else {
                                    part.relative
                                };
                                format!(
                                    "{}{}{}.{}",
                                    part.workbook.as_ref().map_or_else(
                                        String::new,
                                        |book| format!("'{}'#", book.replace('\'', "''"))
                                    ),
                                    if sheet.is_some() && !relative {
                                        "$"
                                    } else {
                                        ""
                                    },
                                    sheet.map_or_else(String::new, |s| format!(
                                        "'{}'",
                                        s.replace('\'', "''")
                                    )),
                                    part.cell
                                )
                            })
                            .collect::<Vec<_>>()
                            .join(":");
                }
                if let Some(first) = parts.first()
                    && (first.sheet.is_some() || first.workbook.is_some())
                {
                    let sheet = first.sheet.as_deref().unwrap_or("");
                    if let Some(book) = first.workbook.as_deref() {
                        let last = parts.get(1);
                        let end = last.and_then(|p| p.sheet.as_deref()).unwrap_or(sheet);
                        if !book.is_empty()
                            && !super::super::office::case_fold::same_name(sheet, end)
                        {
                            return Err("XLSX external span requires retained sheet order");
                        }
                        if book.is_empty() {
                            *excel = if sheet.is_empty() {
                                format!("[]{}", first.cell)
                            } else {
                                let span = if sheet == end {
                                    String::new()
                                } else {
                                    format!(":'{}'", end.replace('\'', "''"))
                                };
                                format!("[]'{}'{span}!{}", sheet.replace('\'', "''"), first.cell)
                            };
                        } else {
                            let index = links
                                .iter()
                                .position(|(target, _)| target == book)
                                .unwrap_or_else(|| {
                                    links.push((book.into(), Vec::new()));
                                    links.len() - 1
                                });
                            for sheet in [sheet, end] {
                                if !sheet.is_empty()
                                    && !links[index].1.iter().any(|name| {
                                        super::super::office::case_fold::same_name(name, sheet)
                                    })
                                {
                                    links[index].1.push(sheet.into());
                                }
                            }
                            let qualifier = if sheet.is_empty() {
                                format!("[{}]", index + 1)
                            } else {
                                let span = if sheet == end {
                                    sheet.to_owned()
                                } else {
                                    format!("{sheet}:{end}")
                                };
                                format!("'[{}]{}'", index + 1, span.replace('\'', "''"))
                            };
                            *excel = format!("{qualifier}!{}", first.cell);
                        }
                        if let Some(last) = last
                            && (last.cell != first.cell
                                || first.position.is_none()
                                || !book.is_empty() && sheet != end)
                        {
                            excel.push(':');
                            excel.push_str(&last.cell);
                        }
                    } else if let Some(last) = parts.get(1)
                        && let Some(end) = last.sheet.as_deref()
                        && sheet != end
                    {
                        *excel = format!(
                            "'{}':'{}'!{}",
                            sheet.replace('\'', "''"),
                            end.replace('\'', "''"),
                            first.cell
                        );
                        if first.cell != last.cell {
                            excel.push(':');
                            excel.push_str(&last.cell);
                        }
                    }
                } else if let [first, last] = parts.as_slice()
                    && let Some(end) = &last.sheet
                {
                    *excel = format!(
                        "'{}':'{}'!{}",
                        sheets[sheet].replace('\'', "''"),
                        end.replace('\'', "''"),
                        first.cell
                    );
                    if first.cell != last.cell {
                        excel.push(':');
                        excel.push_str(&last.cell);
                    }
                }
            }
            Expr::Call(name, args, _) => {
                *work = work.checked_sub(name.len() * 4).ok_or(super::LIMIT)?;
                *name = function_names::public_odf(name);
                pending.extend(args.iter_mut().rev());
            }
            Expr::Array(rows) => {
                if !array_strings {
                    public_array_strings(rows);
                }
                pending.extend(rows.iter_mut().rev().flat_map(|row| row.iter_mut().rev()))
            }
            Expr::Unary(_, child) | Expr::Group(child) | Expr::Spaced(_, child, _) => {
                pending.push(child)
            }
            Expr::Binary(_, left, right) => pending.extend([right.as_mut(), left.as_mut()]),
            _ => {}
        }
    }
    *excel = expression.render(Syntax::GnumericXlsx(sheets), work)?;
    *openformula = if relative_sheets {
        Some(format!(
            "of:={}",
            expression.render(Syntax::GnumericOdfExport, work)?
        ))
    } else {
        None
    };
    Ok(())
}

pub(super) fn parse_warning(source: &str, sheet: &str, row: usize, column: usize) -> String {
    let source = [
        "of:",
        "oooc:",
        "msoxl:",
        "{urn:oasis:names:tc:opendocument:xmlns:of:1.2}",
        "{http://openoffice.org/2004/calc}",
        "{http://schemas.microsoft.com/office/excel/formula}",
    ]
    .into_iter()
    .find_map(|prefix| source.strip_prefix(prefix))
    .unwrap_or(source);
    format!(
        "{sheet}!{}{} : Unable to parse '{source}'\n",
        crate::commands::structured::xlsx_idx_to_col_ref(column),
        row + 1
    )
}

pub(in crate::commands) fn convert(
    gnumeric: bool,
    source: &str,
    legacy: bool,
    limit: usize,
    display: bool,
) -> Result<Option<Formula>, &'static str> {
    let native = gnumeric && display && source.starts_with('=');
    let invalid_public_syntax = legacy && source.starts_with("msoxl:");
    let normalized_source;
    let source = if let Some(tail) = source.strip_prefix("oooc:") {
        normalized_source = format!("{{http://openoffice.org/2004/calc}}{tail}");
        normalized_source.as_str()
    } else if let Some(tail) = source.strip_prefix("msoxl:") {
        normalized_source = format!("{{http://schemas.microsoft.com/office/excel/formula}}{tail}");
        normalized_source.as_str()
    } else {
        source
    };
    // Retained OpenFormula uses canonical uppercase names for known functions
    // and lowercase names for unknown tokens. Display must preserve that
    // distinction when the input originally used another namespace.
    let normalized = display && source.starts_with("of:=");
    let source = if normalized { &source[4..] } else { source };
    let source = source.strip_prefix("of:").unwrap_or(source);
    let legacy = legacy || source.starts_with("{http://openoffice.org/2004/calc}");
    let excel = native
        || !legacy && source.starts_with("{http://schemas.microsoft.com/office/excel/formula}");
    let separator = if legacy || source.starts_with("{http://openoffice.org/2004/calc}") || excel {
        '!'
    } else {
        '.'
    };
    let source = source
        .strip_prefix("{urn:oasis:names:tc:opendocument:xmlns:of:1.2}")
        .or_else(|| source.strip_prefix("{http://openoffice.org/2004/calc}"))
        .or_else(|| source.strip_prefix("{http://schemas.microsoft.com/office/excel/formula}"))
        .unwrap_or(source);
    let source = source.trim();
    let source = source.strip_prefix('=').unwrap_or(source);
    if source.len() > limit {
        return Err(super::LIMIT);
    }
    let parser = Parser {
        sylk: None,
        discovered_names: None,
        invalid_public_syntax,
        native,
        native_diagnostic: None,
        gnumeric,
        source,
        pos: 0,
        nodes: (limit / std::mem::size_of::<Expr>()).min(8192),
        limited: false,
        work: limit,
        sheet_separator: separator,
        legacy,
        excel,
        normalized,
        arrays: 0,
        in_array: false,
        has_bindings: false,
        separators: false,
        error: None,
    };
    finish(parser, display)
}

fn finish(mut parser: Parser<'_>, display: bool) -> Result<Option<Formula>, &'static str> {
    let source = parser.source;
    let excel = parser.excel;
    let legacy = parser.legacy;
    let gnumeric = parser.gnumeric;
    let calculation = if gnumeric {
        Syntax::GnumericOdf
    } else {
        Syntax::Calculation
    };
    let expression = parser.expression(u8::from(!excel), 0, false);
    if parser.limited {
        return Err(super::LIMIT);
    }
    parser.space();
    let Some(mut expression) = expression.filter(|_| parser.pos == source.len()) else {
        if !excel && !source.is_empty() {
            return Ok(None);
        }
        return Ok(Some(Formula {
            invalid_public_syntax: parser.invalid_public_syntax,
            native_diagnostic: parser.native_diagnostic,
            legacy,
            calculation,
            display: None,
            excel: source.into(),
            openformula: None,
            error: Some(
                excel
                    .then_some(parser.error)
                    .flatten()
                    .unwrap_or(if source.is_empty() {
                        "#NAME?"
                    } else {
                        "#VALUE!"
                    }),
            ),
            token_error: parser.error,
            expression: None,
            external: excel,
            has_bindings: parser.has_bindings,
            separators: parser.separators,
        }));
    };
    let leading = &source[..source.len()
        - source
            .trim_start_matches(|c: char| c.is_ascii_whitespace())
            .len()];
    if !leading.is_empty() {
        expression = Expr::Spaced(leading.into(), Box::new(expression), String::new());
    }
    let mut remaining = parser.work;
    let external = excel;
    let excel = expression.render(Syntax::Excel, &mut remaining)?;
    let openformula = if expression.foreign(gnumeric) || parser.separators {
        Some(format!(
            "of:={}",
            expression.render(calculation, &mut remaining)?
        ))
    } else {
        None
    };
    let display = (display || external)
        .then(|| expression.render(Syntax::Calc, &mut remaining))
        .transpose()?;
    let mut formula = Formula {
        invalid_public_syntax: parser.invalid_public_syntax,
        native_diagnostic: parser.native_diagnostic,
        legacy,
        calculation,
        display,
        excel,
        openformula,
        error: parser.error.or(if external {
            expression.adjacency_error(&mut remaining)?
        } else {
            None
        }),
        token_error: parser.error,
        expression: Some(expression),
        external,
        has_bindings: parser.has_bindings,
        separators: parser.separators,
    };
    if legacy && formula.has_live_references(&mut remaining)? {
        // Deferred binding needs the original Calc grammar and label semantics.
        formula.openformula = Some(format!("oooc:={source}"));
    }
    Ok(Some(formula))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_errors_remain_array_elements() {
        for error in [
            "#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!",
        ] {
            let source = format!("of:=INDEX({{{error};42}};1;2)");
            let parsed = convert(false, &source, false, 65536, true)
                .unwrap()
                .unwrap();
            assert_eq!(parsed.error, None, "{source}");
            assert_eq!(parsed.excel, format!("INDEX({{{error},42}},1,2)"));
        }
    }

    #[test]
    fn unknown_sheet_ranges_keep_their_original_token() {
        for token in ["$Missing.$A$1:$Third.$C$3", "$'Missing'.$C$4:$'Third'.$A$2"] {
            let source = format!("{{urn:oasis:names:tc:opendocument:xmlns:of:1.2}}=ROW([{token}])");
            let mut parsed = convert(false, &source, false, 1_000_000, true)
                .unwrap()
                .unwrap();
            parsed
                .resolve_names(
                    &["First".into(), "Third".into()],
                    &mut 1_000_000,
                    true,
                    |_, _| Ok(None),
                )
                .unwrap();
            assert_eq!(parsed.excel, format!("ROW({token})"));
            assert_eq!(parsed.display, Some(format!("ROW({token})")));
        }
    }

    #[test]
    fn reversed_ranges_preserve_endpoint_order_and_absolute_flags() {
        for (source, expected) in [
            ("[.C4:.A2]", "C4:A2"),
            ("[.$C4:.A$2]", "$C4:A$2"),
            ("[.$A4:.C$2]", "$A4:C$2"),
            ("[.C$2:.$A4]", "C$2:$A4"),
            ("[.C$4:.$C4]", "C$4:$C4"),
        ] {
            for (namespace, source) in [
                (
                    "{urn:oasis:names:tc:opendocument:xmlns:of:1.2}",
                    source.into(),
                ),
                ("{http://openoffice.org/2004/calc}", source.replace('.', "")),
            ] {
                let source = format!("{namespace}=ROW({source})");
                let parsed = convert(false, &source, false, 1_000_000, true)
                    .unwrap()
                    .unwrap();
                assert_eq!(parsed.excel, format!("ROW({expected})"), "{source}");
                assert_eq!(parsed.display, Some(format!("ROW({expected})")));
            }
        }
    }

    #[test]
    fn formula_groups_charge_retained_tokens_and_comparisons() {
        for (namespace, separator) in [
            ("http://schemas.microsoft.com/office/excel/formula", ','),
            ("urn:oasis:names:tc:opendocument:xmlns:of:1.2", ';'),
            ("http://openoffice.org/2004/calc", ';'),
        ] {
            let source = format!(
                "{{{namespace}}}=IF(1{separator}{}1.7976931348623155e308%{separator}\"{}\")",
                "0+".repeat(10),
                "x".repeat(1024)
            );
            for (limit, succeeds) in [(4096, false), (1048576, true)] {
                let mut work = limit;
                let mut previous = None;
                let result = (0..32).try_for_each(|row| {
                    let mut parsed = convert(false, &source, false, 65536, false)?.unwrap();
                    previous = parsed.group(&source, row, false, previous.as_ref(), &mut work)?;
                    Ok::<_, &str>(())
                });
                assert_eq!(result.is_ok(), succeeds, "{namespace} {limit}");
            }
        }
    }

    #[test]
    fn ungrouped_union_arguments_match_production() {
        for (source, excel, calculation) in [
            (
                "IFERROR([.A1]~[.B1];99)",
                "IFERROR(A1,B1,99)",
                "IFERROR([.A1];[.B1];99)",
            ),
            (
                "IFNA(NA();[.A1]~[.B1])",
                "_xlfn.IFNA(NA(),A1,B1)",
                "IFNA(NA();[.A1];[.B1])",
            ),
            (
                "CHOOSE(1;[.A1]~[.B1];0)",
                "CHOOSE(1,A1,B1,0)",
                "CHOOSE(1;[.A1];[.B1];0)",
            ),
            (
                "IF(1;([.A1]~[.B1]);0)",
                "IF(1,(A1,B1),0)",
                "IF(1;([.A1]~[.B1]);0)",
            ),
        ] {
            let result = convert(false, &format!("of:={source}"), false, 65536, true)
                .unwrap()
                .unwrap();
            assert_eq!(result.excel, excel, "{source}");
            assert_eq!(
                result.openformula.as_deref(),
                Some(format!("of:={calculation}").as_str()),
                "{source}"
            );
        }
    }

    #[test]
    fn boolean_tokens_follow_native_formula_and_array_syntax() {
        for (source, expected) in [
            ("TRUE", "TRUE()"),
            ("fAlSe", "FALSE()"),
            ("IF(TRUE;FALSE;TRUE)", "IF(TRUE(),FALSE(),TRUE())"),
            ("TRUE+FALSE", "TRUE()+FALSE()"),
            ("(TRUE)", "(TRUE())"),
            ("SUM( TRUE ; FALSE )", "SUM( TRUE() , FALSE() )"),
            ("{TRUE;FALSE}", "{TRUE,FALSE}"),
            ("{TRUE;FALSE|1;0}", "{TRUE,FALSE;1,0}"),
            ("IF({TRUE;FALSE};1;0)", "IF({TRUE,FALSE},1,0)"),
            ("{(TRUE);FALSE}", "{(TRUE),FALSE}"),
            ("{TRUE+FALSE;FALSE}", "{TRUE+FALSE,FALSE}"),
            ("\"TRUE\"", "\"TRUE\""),
            ("TRUE1", "TRUE1"),
        ] {
            let result = convert(false, source, false, 65536, true).unwrap().unwrap();
            assert_eq!(result.excel, expected, "{source}");
            assert_eq!(result.display.as_deref(), Some(expected), "{source}");
        }
        for namespace in [
            "http://openoffice.org/2004/calc",
            "http://schemas.microsoft.com/office/excel/formula",
        ] {
            for (source, expected) in [
                ("TRUE", "1"),
                ("FALSE", "0"),
                ("TRUE()", "TRUE()"),
                ("{TRUE}", "{TRUE}"),
            ] {
                let source = format!("{{{namespace}}}={source}");
                assert_eq!(
                    convert(false, &source, false, 65536, true)
                        .unwrap()
                        .unwrap()
                        .excel,
                    expected
                );
            }
        }
        assert!(convert(false, "TRUE", false, 1, true).is_err());
    }

    #[test]
    fn renamed_references_preserve_literal_strings_and_escaping() {
        let changes = std::collections::BTreeMap::from([
            (
                super::super::super::office::case_fold::sheet_key("Old's"),
                "New's".into(),
            ),
            (
                super::super::super::office::case_fold::sheet_key("Other"),
                "Short".into(),
            ),
        ]);
        let source = "of:=IF(1;[$'Old''s'.$A$1:$'Other'.$B$2];INDIRECT(\"'Old''s'!A1\"))";
        assert_eq!(
            rename(source, &changes, &mut 4096).unwrap(),
            "of:=IF(1;[$'New''s'.$A$1:$'Short'.$B$2];INDIRECT(\"'Old''s'!A1\"))"
        );
        let source = "SUM('Old''s':'Other'!A1:B2)+\"\"\"'Old''s'\"";
        assert_eq!(
            rename(source, &changes, &mut 4096).unwrap(),
            "SUM('New''s':'Short'!A1:B2)+\"\"\"'Old''s'\""
        );
        assert!(rename(source, &changes, &mut 1).is_err());
    }

    #[test]
    fn omitted_separator_operands_respect_the_parser_node_limit() {
        for (prefix, separator) in [
            ("of:=", ";"),
            ("{http://schemas.microsoft.com/office/excel/formula}=", ","),
        ] {
            let source = format!("{prefix}({})", separator.repeat(9000));
            assert!(matches!(
                convert(false, &source, false, 16 * 1024 * 1024, true),
                Err(super::super::LIMIT)
            ));
        }
    }

    #[test]
    fn separator_compilation_bounds_repeated_named_range_expansion() {
        let names: Vec<_> = (0..18)
            .map(|index| crate::commands::structured::xlsx::NamedExpression {
                name: format!("Range_{index}"),
                sheet: None,
                expression: String::new(),
                openformula: Some(if index == 0 {
                    "of:=[.$A$1]".into()
                } else {
                    format!("of:=(Range_{};Range_{})", index - 1, index - 1)
                }),
                position: (0, 0, 0),
                compiled: None,
            })
            .collect();
        for source in [
            "of:=SUM((Range_17;Range_17))",
            "{http://schemas.microsoft.com/office/excel/formula}=SUM((Range_17,Range_17))",
        ] {
            let mut formula = convert(false, source, false, 65536, true).unwrap().unwrap();
            let declared = names
                .iter()
                .map(|n| ((None, n.name.to_uppercase()), n.name.as_str()))
                .collect();
            formula
                .bind_names(false, &declared, 0, &["First".into()], &mut 65536)
                .unwrap();
            assert_eq!(
                formula.compile_separators(&names, &["First".into()], 0, None, &mut 65536),
                Err(super::super::LIMIT)
            );
        }
    }

    #[test]
    fn index_preserves_a_sheet_span_as_one_reference() {
        let source = "{urn:oasis:names:tc:opendocument:xmlns:of:1.2}=INDEX([$Sheet0.$A$1:$Sheet199.$C$3];2;2;100)";
        let parsed = convert(false, source, false, 1024, false).unwrap().unwrap();
        assert_eq!(parsed.excel, "INDEX('Sheet0':'Sheet199'!$A$1:$C$3,2,2,100)");
        assert_eq!(
            parsed.openformula.as_deref(),
            Some("of:=INDEX([$Sheet0.$A$1:$Sheet199.$C$3];2;2;100)")
        );
        assert!(matches!(
            convert(false, source, false, 16, false),
            Err(super::super::LIMIT)
        ));
    }
}
