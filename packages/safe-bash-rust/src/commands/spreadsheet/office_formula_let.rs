// Lexical LET bindings adapted from IronCalc logical/let.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// Resolve names while parsing; evaluate each binding once, preserving references.
use super::super::{case_fold::same_name, editor_tables::valid_table_name};
use super::{Calculation, Coord, Expr, Parser, Value};

pub(super) fn identifier(source: &str) -> &str {
    let end = source
        .char_indices()
        .find(|(_, c)| !c.is_alphanumeric() && !matches!(c, '_' | '.' | '\\'))
        .map_or(source.len(), |(i, _)| i);
    &source[..end]
}
pub(super) fn unprefixed(name: &str) -> &str {
    if name.get(..6).is_some_and(|prefix| {
        prefix.eq_ignore_ascii_case("_xlpm.") || prefix.eq_ignore_ascii_case("_xlop.")
    }) {
        &name[6..]
    } else {
        name
    }
}
impl<'a, S: Iterator<Item = &'a str> + Clone> Parser<'a, S> {
    pub(super) fn local_reference(&mut self) -> Option<Expr> {
        if self.locals.is_empty() {
            return None;
        }
        let name = identifier(self.source);
        if name.is_empty()
            || self.source[name.len()..]
                .trim_ascii_start()
                .starts_with(['!', '['])
        {
            return None;
        }
        let index = self
            .locals
            .iter()
            .rposition(|local| same_name(local, unprefixed(name)))?;
        if let Some(tokens) = &mut self.local_tokens {
            tokens.push((self.source.len(), name.len()));
        }
        self.source = &self.source[name.len()..];
        Some(Expr::Local(index))
    }

    pub(super) fn let_arguments(&mut self, depth: usize) -> Option<Vec<Expr>> {
        let frame = self.locals.len();
        let result = (|| {
            let mut args = Vec::new();
            let separator = if self.odf { ";" } else { "," };
            if !self.take(")") {
                loop {
                    self.space();
                    let raw = identifier(self.source);
                    let declaration = args.len() % 2 == 0
                        && !raw.is_empty()
                        && self.source[raw.len()..]
                            .trim_ascii_start()
                            .starts_with(separator);
                    if declaration {
                        let name = unprefixed(raw);
                        let valid = (name.eq_ignore_ascii_case("r")
                            || name.eq_ignore_ascii_case("c")
                            || valid_table_name(name))
                            && !name.eq_ignore_ascii_case("TRUE")
                            && !name.eq_ignore_ascii_case("FALSE");
                        self.nodes = self
                            .nodes
                            .checked_sub(raw.len().div_ceil(std::mem::size_of::<Expr>()) * 2 + 1)
                            .or_else(|| {
                                self.limited = true;
                                None
                            })?;
                        if let Some(tokens) = &mut self.local_tokens {
                            tokens.push((self.source.len(), raw.len()));
                        }
                        self.source = &self.source[raw.len()..];
                        if !valid {
                            self.error.get_or_insert("#VALUE!");
                        }
                        args.push(Expr::Value(Value::Text(if valid {
                            name.to_owned()
                        } else {
                            String::new()
                        })));
                    } else {
                        args.push(
                            if self.source.starts_with(')') || self.source.starts_with(separator) {
                                self.nodes = self.nodes.checked_sub(1).or_else(|| {
                                    self.limited = true;
                                    None
                                })?;
                                Expr::Value(Value::Blank)
                            } else {
                                let Some(expression) = self.expression(0, depth + 1, true) else {
                                    self.error.get_or_insert("#ERROR!");
                                    return Some(args);
                                };
                                expression
                            },
                        );
                    }
                    if args.len() % 2 == 0 {
                        if let Expr::Value(Value::Text(name)) = &args[args.len() - 2] {
                            if self.locals[frame..]
                                .iter()
                                .any(|local| same_name(local, name))
                            {
                                self.error.get_or_insert("#ERROR!");
                            }
                            self.locals.push(name.clone());
                        } else {
                            self.error.get_or_insert("#VALUE!");
                        }
                    }
                    if self.take(")") {
                        break;
                    }
                    if !self.take(separator) {
                        self.error.get_or_insert("#ERROR!");
                        return None;
                    }
                    if args.len() % 2 == 1 && !declaration {
                        self.error.get_or_insert("#VALUE!");
                    }
                    if args.len() >= 253 {
                        self.error.get_or_insert("#ERROR!");
                        return None;
                    }
                }
            }
            if args.len() < 3 || args.len() % 2 == 0 {
                self.error.get_or_insert("#ERROR!");
            }
            Some(args)
        })();
        self.locals.truncate(frame);
        result
    }
}
impl Calculation<'_> {
    pub(super) fn local_value(
        &mut self,
        index: usize,
        pos: Coord,
        depth: usize,
        reference: bool,
    ) -> Option<Value> {
        // Move only the vector header so the allocation budget can be checked
        // before cloning a bound array or string.
        let locals = std::mem::take(&mut self.locals);
        let result = (|| {
            let (value, format) = locals.get(index)?.as_ref();
            self.charge_value(value)?;
            self.result_format = *format;
            Some(value.clone())
        })();
        self.locals = locals;
        let value = result?;
        if !reference && matches!(value, Value::Single(_) | Value::InvalidReference) {
            self.scalar(value, pos, depth + 1)
        } else {
            Some(value)
        }
    }
    pub(super) fn let_value(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.len() < 3 || args.len() % 2 == 0 {
            return Some(Value::Error("#ERROR!"));
        }
        let frame = self.locals.len();
        let result = (|| {
            for pair in args[..args.len() - 1].chunks_exact(2) {
                self.work = self.work.checked_sub(std::mem::size_of::<Value>() + 32)?;
                self.result_format = None;
                let value = self.eval(&pair[1], pos, depth + 1, true)?;
                self.locals
                    .push(std::sync::Arc::new((value, self.result_format)));
            }
            self.result_format = None;
            self.eval(args.last()?, pos, depth + 1, true)
        })();
        self.locals.truncate(frame);
        result
    }
}

// Table renames/conversions use the same parser to exclude declarations and
// bound names. An identifier before its binding remains a real table reference.
// SpreadsheetML distinguishes bound parameters from workbook names. Adapted
// from IronCalc expressions/parser/stringify.rs without cloning the AST.
pub(in crate::commands::spreadsheet) fn xlsx_variables<'a>(
    source: &'a str,
    work: &mut usize,
) -> Option<std::borrow::Cow<'a, str>> {
    let (locals, intersections) = lexical_tokens(source, work)?;
    let mut edits = Vec::new();
    for (start, length) in locals {
        let token = &source[start..start + length];
        let optional = token.starts_with('[') && token.ends_with(']');
        let name = if optional {
            &token[1..token.len() - 1]
        } else {
            token
        };
        // The token collector also preserves malformed tails. Leave them alone.
        if name.is_empty() || identifier(name) != name || unprefixed(name) != name {
            continue;
        }
        *work = work.checked_sub(2 * std::mem::size_of::<(usize, usize, &str)>())?;
        edits.push((
            start,
            usize::from(optional),
            if optional { "_xlop." } else { "_xlpm." },
        ));
        if optional {
            edits.push((start + length - 1, 1, ""));
        }
    }
    for (start, length) in intersections {
        *work = work.checked_sub(2 * std::mem::size_of::<(usize, usize, &str)>())?;
        edits.push((start, 1, "_xlfn.SINGLE("));
        edits.push((start + length, 0, ")"));
    }
    if edits.is_empty() {
        return Some(std::borrow::Cow::Borrowed(source));
    }
    // Zero-width closing events must precede the next token's replacement.
    edits.sort_unstable_by_key(|&(start, length, _)| (start, length));
    let size = edits
        .iter()
        .try_fold(source.len(), |size, &(_, length, text)| {
            size.checked_sub(length)?.checked_add(text.len())
        })?;
    *work = work.checked_sub(size)?;
    let mut output = String::with_capacity(size);
    let mut copied = 0;
    for (start, length, text) in edits {
        output.push_str(&source[copied..start]);
        output.push_str(text);
        copied = start + length;
    }
    output.push_str(&source[copied..]);
    Some(std::borrow::Cow::Owned(output))
}

pub(in crate::commands::spreadsheet) fn lexical_tokens(
    source: &str,
    work: &mut usize,
) -> Option<(Vec<(usize, usize)>, Vec<(usize, usize)>)> {
    if !source.contains('@')
        && !source.char_indices().any(|(start, _)| {
            ["LET", "LAMBDA"].iter().any(|name| {
                source[start..]
                    .get(..name.len())
                    .is_some_and(|word| word.eq_ignore_ascii_case(name))
                    && source[start + name.len()..]
                        .trim_ascii_start()
                        .starts_with('(')
                    && source[..start]
                        .chars()
                        .next_back()
                        .is_none_or(|c| !c.is_alphanumeric() && !matches!(c, '_' | '\\'))
            })
        })
    {
        return Some((Vec::new(), Vec::new()));
    }
    let length = source.len();
    let odf = source.starts_with("of:=");
    let source = source
        .strip_prefix("of:=")
        .or_else(|| source.strip_prefix("msoxl:="))
        .unwrap_or(source);
    let source = source.strip_prefix('=').unwrap_or(source);
    let nodes = (*work / std::mem::size_of::<Expr>()).min(8192);
    let mut parser = Parser {
        source,
        nodes,
        limited: false,
        error: None,
        raw_tail: false,
        editor: false,
        arrays: 0,
        uninterned_arrays: false,
        sheets: std::iter::empty(),
        names: &[],
        tables: &[],
        bindings: None,
        operators: Vec::new(),
        name_stack: Vec::new(),
        locals: Vec::new(),
        lambda_depth: 0,
        local_tokens: Some(Vec::new()),
        export_names: None,
        position: (0, 0, 0),
        scope: None,
        odf,
        xlsx: !odf,
        csv: false,
        r1c1: false,
        sizes: &[],
    };
    let _ = parser.expression(0, 0, false);
    parser.space();
    *work = work.checked_sub((nodes - parser.nodes).checked_mul(std::mem::size_of::<Expr>())?)?;
    if parser.limited {
        return None;
    }
    let mut tokens = parser.local_tokens?;
    // Preserve an unparsed tail verbatim instead of interpreting identifiers
    // in an incomplete formula as workbook names or table references.
    if !parser.source.is_empty() {
        tokens.push((parser.source.len(), parser.source.len()));
    }
    for (start, _) in &mut tokens {
        *start = length - *start;
    }
    tokens.sort_unstable();
    tokens.dedup();
    let intersections = parser
        .operators
        .into_iter()
        .filter(|&(_, _, op)| op == '@')
        .map(|(start, span, _)| (length - start, span))
        .collect();
    Some((tokens, intersections))
}

#[cfg(test)]
mod tests {
    #[test]
    fn bound_calculations_run_once() {
        use super::super::{Calculation, Workbook, parse};
        let book = Workbook::default();
        let sheets = vec!["Sheet1".to_owned()];
        let repeated = format!(
            "msoxl:=SUM({})",
            vec!["SUM(_xlfn.SEQUENCE(128))"; 10].join(",")
        );
        let bound = format!(
            "msoxl:=_xlfn.LET(total,SUM(_xlfn.SEQUENCE(128)),SUM({}))",
            vec!["total"; 10].join(",")
        );
        let mut costs = Vec::new();
        for source in [repeated, bound] {
            let expression = parse(
                &source,
                &sheets,
                &book,
                (0, 0, 0),
                None,
                false,
                None,
                1_000_000,
                false,
            )
            .unwrap()
            .unwrap();
            let mut calc = Calculation::new(&book, &sheets, vec![(1, 1)], 1_000_000);
            assert_eq!(
                calc.eval(&expression, (0, 0, 0), 0, true).unwrap().cached(),
                "82560"
            );
            costs.push(1_000_000 - calc.work);
        }
        assert!(costs[1] < costs[0] / 5, "cached binding costs {costs:?}");
    }

    #[test]
    fn local_spans_exclude_table_names() {
        assert_eq!(
            super::lexical_tokens("SUM(Sales)+LETTERS(", &mut 100_000),
            Some((Vec::new(), Vec::new()))
        );
        let source = "LET(Orders,2,Sales,3,Orders+Sales)";
        let spans = super::lexical_tokens(source, &mut 100_000).unwrap().0;
        assert_eq!(spans, vec![(4, 6), (13, 5), (21, 6), (28, 5)]);
    }
}
