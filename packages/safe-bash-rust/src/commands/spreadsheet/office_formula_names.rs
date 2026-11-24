use super::{Expr, Parser};
use crate::commands::spreadsheet::model::{NamedExpression, Table};

// Capture resolved name tokens in the existing AST parser. LET/LAMBDA locals,
// strings, function names and structured references use their own AST nodes.
pub(in crate::commands::spreadsheet) fn name_references(
    source: &str,
    sheets: &[String],
    names: &[NamedExpression],
    tables: &[Table],
    position: (usize, i64, i64),
    scope: Option<usize>,
    bindings: Option<&std::collections::BTreeMap<String, Option<usize>>>,
    work: &mut usize,
) -> Result<(Vec<(usize, usize, Option<usize>)>, bool), String> {
    *work = work
        .checked_sub(source.len().saturating_mul(names.len().saturating_add(2)))
        .ok_or("Named expression exceeds its formula limit")?;
    let length = source.len();
    let odf = source.starts_with("of:=");
    let xlsx = !odf && (scope.is_some() || source.starts_with("msoxl:="));
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
        editor: true,
        arrays: 0,
        uninterned_arrays: false,
        sheets: sheets.iter().map(String::as_str),
        names,
        tables,
        bindings,
        operators: Vec::new(),
        name_stack: Vec::new(),
        locals: Vec::new(),
        lambda_depth: 0,
        local_tokens: None,
        name_tokens: Some(Vec::new()),
        export_names: None,
        position,
        scope,
        odf,
        xlsx,
        csv: false,
        r1c1: false,
        sizes: &[],
    };
    let expression = parser.expression(0, 0, false);
    parser.space();
    *work = work
        .checked_sub((nodes - parser.nodes).saturating_mul(std::mem::size_of::<Expr>()))
        .ok_or("Named expression exceeds its formula limit")?;
    if parser.limited {
        return Err("Named expression exceeds its formula limit".into());
    }
    let valid = expression.is_some()
        && parser.source.is_empty()
        && !matches!(
            parser.error,
            Some("Err:501" | "Err:508" | "Err:509" | "Err:510" | "Err:512")
        );
    let mut tokens = parser.name_tokens.unwrap();
    for (start, _, _) in &mut tokens {
        *start = length - *start;
    }
    tokens.sort_unstable();
    tokens.dedup();
    Ok((tokens, valid))
}

// OOXML uses [0]!Name for an explicitly workbook-scoped name (also emitted
// by LibreOffice's ScCompiler::CreateStringFromIndex for chart OOXML). Emit
// explicit scopes for imported bindings so sheet-local names cannot capture
// them when Excel or another reader recalculates the exported workbook.
pub(in crate::commands::spreadsheet) fn xlsx_bound_name(
    name: &NamedExpression,
    sheets: &[String],
    names: &[NamedExpression],
    tables: &[Table],
    work: &mut usize,
) -> Option<String> {
    let compiled = name.compiled.as_ref()?;
    let (tokens, valid) = name_references(
        &compiled.expression,
        sheets,
        names,
        tables,
        name.position,
        name.sheet,
        Some(&compiled.bindings),
        work,
    )
    .ok()?;
    if !valid {
        return None;
    }
    let mut source = compiled.expression.clone();
    for (start, length, resolved) in tokens.into_iter().rev() {
        if source.get(..start)?.trim_end().ends_with('!')
            || !compiled
                .bindings
                .contains_key(source.get(start..start + length)?)
        {
            continue;
        }
        let replacement = if let Some(index) = resolved {
            let target = names.get(index)?;
            let prefix = if let Some(sheet) = target.sheet {
                crate::commands::spreadsheet::sheet_name::quote_sheet(sheets.get(sheet)?)
            } else {
                "[0]".into()
            };
            format!("{prefix}!{}", target.name)
        } else {
            "#NAME?".into()
        };
        *work = work.checked_sub(source.len().checked_add(replacement.len())?)?;
        source.replace_range(start..start + length, &replacement);
    }
    Some(
        source
            .strip_prefix("msoxl:=")
            .unwrap_or(&source)
            .trim_start_matches('=')
            .to_owned(),
    )
}
