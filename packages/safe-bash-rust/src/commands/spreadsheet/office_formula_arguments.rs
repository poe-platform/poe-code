use std::borrow::Cow;

#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands) enum Syntax {
    Editor,
    EditorDisplay,
    Csv,
    Ods,
    OdsRecompiledMicrosoft,
    Xlsx,
    EditorXlsx,
    XlsxImport,
    XlsxCode,
    XlsxGroup,
}

#[derive(Clone, Copy)]
enum Rule {
    None,
    If,
    Round,
    Week,
    Log,
    LogNorm,
    Euro,
    Poisson,
    Cumulative,
    Hypergeometric,
    Database,
    Accrint,
    Accrintm,
}

struct Call {
    rule: Rule,
    name: (usize, usize),
    name_edit: Option<usize>,
    argument: usize,
    index: usize,
}

// Excel's international scanner includes the token after a quoted or Unicode
// document header, even when that token is a separator or parenthesis.
pub(in crate::commands) fn external_reference_end(source: &str) -> Option<usize> {
    let end = source.find(']').map_or(source.len(), |i| i + 1);
    if source[..end].is_ascii() && !source[..end].contains('\'') && !source[end..].starts_with('!')
    {
        return Some(
            1 + source[1..]
                .chars()
                .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$' | ']' | '!'))
                .map(char::len_utf8)
                .sum::<usize>(),
        );
    }
    let mut end = source.find(']')? + 1;
    let Some(c) = source[end..]
        .chars()
        .next()
        .filter(|c| !c.is_ascii_whitespace())
    else {
        return Some(end);
    };
    end += c.len_utf8();
    if c == '\'' {
        loop {
            let Some(next) = source[end..].find('\'') else {
                return Some(source.len());
            };
            end += next + 1;
            if !source[end..].starts_with('\'') {
                break;
            }
            end += 1;
        }
    } else if c.is_alphanumeric() || matches!(c, '_' | '$' | '?' | '!') {
        end += source[end..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '$' | '.' | '?' | '!'))
            .map(char::len_utf8)
            .sum::<usize>();
    }
    Some(end)
}

pub(in crate::commands) fn argument_count(
    source: &str,
    mut in_array: bool,
    work: &mut usize,
) -> Option<usize> {
    let mut depth = 0usize;
    let mut commas = 0;
    let mut content = false;
    let mut quote = None;
    for c in source.trim_start().strip_prefix('(')?.chars() {
        *work = work.checked_sub(1)?;
        if let Some(quoted) = quote {
            if c == quoted {
                quote = None;
            }
            continue;
        }
        match c {
            ')' if depth == 0 => return Some(commas + usize::from(content)),
            ')' => depth -= 1,
            '(' => depth += 1,
            '{' => in_array = true,
            '}' => in_array = false,
            ',' if depth == 0 && !in_array => commas += 1,
            '\'' | '"' => quote = Some(c),
            _ => {}
        }
        content |= !c.is_whitespace();
    }
    Some(commas + usize::from(content))
}

// Inputs use comma argument separators. ODS formulas have already had their
// references, operators and function names translated to SpreadsheetML.
pub(in crate::commands) fn rewrite<'a>(
    source: &'a str,
    syntax: Syntax,
    // Ordered spans of compiled names and opaque bad-token tails.
    verbatim: &[std::ops::Range<usize>],
    work: &mut usize,
) -> Option<Cow<'a, str>> {
    *work = work.checked_sub(source.len())?;
    let locals = super::formulas::lexical_tokens(source, work)?.0;
    let mut stack = Vec::<Call>::new();
    let mut edits = Vec::<(usize, usize, Cow<'a, str>)>::new();
    let mut in_array = false;
    let mut brackets = 0usize;
    let mut quote = None;
    let mut word = None::<(usize, usize)>;
    let mut external_end = 0;
    let mut protected = verbatim.iter().peekable();
    for (i, c) in source.char_indices() {
        while protected.peek().is_some_and(|range| i >= range.end) {
            protected.next();
        }
        if protected.peek().is_some_and(|range| range.contains(&i)) {
            word = None;
            continue;
        }
        if i < external_end {
            continue;
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        if matches!(c, '\'' | '"') {
            quote = Some(c);
            word = None;
            continue;
        }
        if c == '#' && matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode) {
            external_end = i + super::xlsx_import::error_token(&source[i..]).len();
            word = None;
            continue;
        }
        if c == '['
            && matches!(syntax, Syntax::Ods | Syntax::OdsRecompiledMicrosoft)
            && let Some(end) = external_reference_end(&source[i..])
        {
            external_end = i + end;
            word = None;
            continue;
        }
        if c == '[' {
            brackets += 1;
        } else if c == ']' {
            brackets = brackets.saturating_sub(1);
        }
        if brackets > 0 {
            continue;
        }
        if matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode) {
            let question = word.is_some_and(|(start, _)| source[start..].starts_with('?'));
            if c == '?' || question && c == '!' {
                word = Some((if question { word.unwrap().0 } else { i }, i + 1));
                continue;
            }
        }
        if syntax == Syntax::OdsRecompiledMicrosoft
            && word.is_none()
            && (c.is_ascii_digit() || c == '.')
        {
            let (token, _) = super::number_token(&source[i..], true);
            external_end = i + token.len();
            if let Ok(number) = token.parse::<f64>() {
                let number = if number.is_infinite() {
                    f64::MAX
                } else if number.is_subnormal() {
                    0.
                } else {
                    number
                };
                let normalized = super::number_format::number(number, true);
                if normalized != token {
                    *work = work.checked_sub(
                        std::mem::size_of::<(usize, usize, Cow<'_, str>)>() + normalized.len(),
                    )?;
                    edits.push((i, external_end, Cow::Owned(normalized)));
                }
            }
            continue;
        }
        if c.is_alphanumeric() || matches!(c, '_' | '.' | '$') {
            word = Some((word.map_or(i, |(start, _)| start), i + c.len_utf8()));
            continue;
        }
        if c.is_whitespace()
            && (!matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode)
                || c.is_ascii())
        {
            continue;
        }
        // Array separators do not count as function arguments, even inside
        // malformed calls. A closing brace ends the scanner's array state.
        if c == '{' {
            in_array = true;
        } else if c == '}' {
            in_array = false;
        } else if c == '(' {
            let mut range = word.unwrap_or((i, i));
            if locals
                .binary_search_by_key(&range.0, |&(start, _)| start)
                .is_ok()
            {
                // A local function can shadow a built-in name. Its spelling and
                // argument list must not receive built-in namespace/default rewrites.
                range = (i, i);
            }
            if matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode)
                && super::coordinate(&source[range.0..range.1]).is_some()
                && super::function_names::imported(&source[range.0..range.1].to_ascii_uppercase())
                    .is_none()
            {
                break;
            }
            let name = super::collation::uppercase(&source[range.0..range.1], work)?;
            let imported = matches!(
                syntax,
                Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode | Syntax::EditorDisplay
            )
            .then(|| super::function_names::imported(&name))
            .flatten();
            let canonical = match (syntax, name.as_str()) {
                (Syntax::Csv, "F.DIST") => "_XLFN.F.DIST",
                (Syntax::Ods | Syntax::OdsRecompiledMicrosoft, _)
                    if source[range.0..range.1] != name
                        && !super::function_names::imported(&name)
                            .is_some_and(|(_, excel)| source[range.0..range.1] == *excel) =>
                {
                    ""
                }
                _ => &name,
            };
            let rule = match canonical {
                _ if matches!(syntax, Syntax::Editor | Syntax::EditorDisplay) => Rule::None,
                "WEEKNUM"
                    if matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode) =>
                {
                    Rule::Week
                }
                _ if matches!(syntax, Syntax::XlsxImport | Syntax::XlsxCode) => Rule::None,
                "IF" => Rule::If,
                "ROUND" | "ROUNDUP" | "ROUNDDOWN" => Rule::Round,
                "LOGINV" => Rule::Log,
                "LOGNORMDIST" => Rule::LogNorm,
                "EUROCONVERT" => Rule::Euro,
                "POISSON" => Rule::Poisson,
                "GAMMADIST" | "NORMDIST" => Rule::Cumulative,
                "_XLFN.F.DIST" if syntax != Syntax::Csv || name == "F.DIST" => Rule::Cumulative,
                "HYPGEOMDIST" => Rule::Hypergeometric,
                "DCOUNT" | "DCOUNTA" => Rule::Database,
                "ACCRINT" => Rule::Accrint,
                "ACCRINTM" => Rule::Accrintm,
                _ => Rule::None,
            };
            let export_name = if syntax == Syntax::Editor {
                match name.as_str() {
                    "FLOOR" => Some("FLOOR"),
                    "CEILING" | "ECMA.CEILING" => Some("CEILING"),
                    "SKEW.P" => Some("_xlfn.SKEW.P"),
                    "FORMULATEXT" => Some("_xlfn.FORMULATEXT"),
                    _ => super::function_names::editor_complex(&name)
                        .or_else(|| super::function_names::imported(&name))
                        .map(|(_, excel)| excel)
                        .or_else(|| super::function_names::name(&name, true)),
                }
            } else if syntax == Syntax::EditorDisplay {
                imported.map(|(_, excel)| {
                    let name = excel.strip_prefix("_xlfn.").unwrap_or(excel);
                    name.strip_prefix("_xlws.").unwrap_or(name)
                })
            } else {
                imported.map(|(ui, excel)| {
                    if syntax == Syntax::XlsxImport
                        || syntax == Syntax::XlsxCode && ui == "HYPGEOMDIST"
                    {
                        ui
                    } else {
                        excel
                    }
                })
            };
            // Imported names can already use SpreadsheetML namespaces. A prefix
            // alone does not make an unknown function (such as _xlfn.ROUND) valid.
            // Preserve the existing imported Gnumeric extensions, which the
            // evaluator supports separately from Calc's built-in catalog.
            let known = if matches!(syntax, Syntax::Ods | Syntax::OdsRecompiledMicrosoft) {
                // The ODS parser has already resolved identities and preserved
                // coordinate tokens followed by parentheses for error export.
                true
            } else if matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode) {
                imported.is_some()
            } else {
                super::function_names::name(&name, true).is_some()
                    || matches!(name.as_str(), "COLUMNNUMBER" | "ARRAY" | "FLIP")
                    || super::function_names::imported(&name).is_some()
                    || [
                        "COM.MICROSOFT.",
                        "ORG.OPENOFFICE.",
                        "ORG.LIBREOFFICE.",
                        "LEGACY.",
                    ]
                    .iter()
                    .any(|prefix| {
                        name.strip_prefix(prefix)
                            .is_some_and(|name| super::function_names::name(name, true).is_some())
                    })
            };
            let first_edit = edits.len();
            if !matches!(syntax, Syntax::Csv | Syntax::Editor | Syntax::EditorDisplay)
                && export_name.is_none()
                && !known
                && range.0 != range.1
            {
                *work = work.checked_sub(
                    (range.1 - range.0)
                        .checked_mul(3)?
                        .checked_add(std::mem::size_of::<(usize, usize, Cow<'_, str>)>())?,
                )?;
                edits.push((
                    range.0,
                    range.1,
                    Cow::Owned(super::function_names::unknown(&source[range.0..range.1])),
                ));
            }
            let name_end = if imported.is_some() && syntax != Syntax::XlsxCode {
                i
            } else {
                range.1
            };
            if let Some(name) = export_name
                && source[range.0..name_end] != *name
            {
                *work = work.checked_sub(
                    std::mem::size_of::<(usize, usize, Cow<'_, str>)>() + name.len(),
                )?;
                edits.push((range.0, name_end, Cow::Owned(name.to_owned())));
            }
            *work = work.checked_sub(std::mem::size_of::<Call>())?;
            stack.push(Call {
                rule,
                name: range,
                name_edit: (edits.len() > first_edit).then_some(first_edit),
                argument: i + 1,
                index: 0,
            });
        } else if c == ')' || c == ',' && !in_array && syntax != Syntax::OdsRecompiledMicrosoft {
            if let Some(call) = stack.last_mut() {
                let argument = &source[call.argument..i];
                let whitespace = |c: char| {
                    c.is_whitespace()
                        && (!matches!(syntax, Syntax::Xlsx | Syntax::XlsxImport | Syntax::XlsxCode)
                            || c.is_ascii())
                };
                let trimmed_start = argument.trim_start_matches(whitespace);
                let trimmed = trimmed_start.trim_end_matches(whitespace);
                let replacement = match call.rule {
                    Rule::Accrint if call.index == 4 && trimmed.is_empty() => Some("1000"),
                    Rule::Accrintm if call.index == 3 && trimmed.is_empty() => Some("1000"),
                    Rule::Database
                        if call.index == 1
                            && c == ','
                            && !trimmed.starts_with(['+', '-'])
                            && trimmed.parse::<f64>() == Ok(0.) =>
                    {
                        Some("")
                    }
                    _ => None,
                };
                if let Some(text) = replacement {
                    *work = work.checked_sub(
                        std::mem::size_of::<(usize, usize, Cow<'_, str>)>() + text.len(),
                    )?;
                    let start = call.argument + argument.len() - trimmed_start.len();
                    let end = start + trimmed.len();
                    edits.push((start, end, Cow::Borrowed(text)));
                }
                if c == ')' {
                    let suffix = match call.rule {
                        Rule::If if call.index == 0 => ",TRUE()",
                        Rule::Round if call.index == 0 => ",0",
                        Rule::Week if call.index == 0 => ",1",
                        Rule::Log | Rule::LogNorm if call.index == 0 => ",0,1",
                        Rule::Log | Rule::LogNorm if call.index == 1 => ",1",
                        Rule::Euro if call.index == 2 => ",0",
                        Rule::Poisson if call.index == 1 => ",1",
                        Rule::Cumulative if call.index == 2 => ",1",
                        Rule::Hypergeometric if call.index == 3 => ",0",
                        _ => "",
                    };
                    if !suffix.is_empty() {
                        *work = work.checked_sub(
                            std::mem::size_of::<(usize, usize, Cow<'_, str>)>() + suffix.len(),
                        )?;
                        edits.push((i, i, Cow::Borrowed(suffix)));
                    }
                    let name = match call.rule {
                        Rule::LogNorm if call.index == 3 && syntax != Syntax::Csv => {
                            Some("_xlfn.LOGNORM.DIST")
                        }
                        Rule::Hypergeometric if syntax != Syntax::Csv => Some("_xlfn.HYPGEOM.DIST"),
                        _ => None,
                    };
                    if let Some(name) = name {
                        *work = work.checked_sub(
                            std::mem::size_of::<(usize, usize, Cow<'_, str>)>() + name.len(),
                        )?;
                        if let Some(index) = call.name_edit {
                            edits[index].2 = Cow::Borrowed(name);
                        } else {
                            edits.push((call.name.0, call.name.1, Cow::Borrowed(name)));
                        }
                    }
                } else {
                    call.index += 1;
                    call.argument = i + 1;
                }
            }
            if c == ')' {
                stack.pop();
            }
        }
        word = None;
    }
    if edits.is_empty() {
        return Some(Cow::Borrowed(source));
    }
    *work = work.checked_sub(edits.len().checked_mul(edits.len().ilog2() as usize + 1)?)?;
    edits.sort_by_key(|(start, end, _)| (*start, *end));
    let len = edits
        .iter()
        .try_fold(source.len(), |len, (start, end, text)| {
            len.checked_sub(end - start)?.checked_add(text.len())
        })?;
    *work = work.checked_sub(len)?;
    let mut output = String::with_capacity(len);
    let mut last = 0;
    for (start, end, text) in edits {
        output.push_str(source.get(last..start)?);
        output.push_str(&text);
        last = end;
    }
    output.push_str(&source[last..]);
    Some(Cow::Owned(output))
}
