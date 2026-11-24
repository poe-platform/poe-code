use super::{
    BuiltinOutcome, WorkbookSheet, err_out, resolve_posix_path, xlsx, xlsx_idx_to_col_ref,
};
use std::fmt::Write;
#[path = "ssconvert_decoding.rs"]
pub(super) mod decoding;
#[path = "ssconvert_dif.rs"]
pub(super) mod dif;
#[path = "ssconvert_gnumeric.rs"]
pub(super) mod gnumeric;
#[path = "ssconvert_gnumeric_read.rs"]
pub(super) mod gnumeric_read;
#[path = "ssconvert_import.rs"]
pub(super) mod import;
#[path = "ssconvert_sylk.rs"]
pub(super) mod sylk;
#[path = "ssconvert_sylk_write.rs"]
pub(super) mod sylk_write;
#[path = "ssconvert_text.rs"]
pub(super) mod text;
#[path = "ssconvert_updates.rs"]
pub(super) mod updates;

pub(super) struct Workbook {
    pub sheets: Vec<WorkbookSheet>,
    pub properties: xlsx::Workbook,
    pub source: Option<crate::commands::archive::office::xlsx_gnumeric::Source>,
}

pub(super) fn append_sheets(
    target: &mut Workbook,
    mut incoming: Workbook,
    limit: usize,
) -> Result<(), String> {
    use crate::commands::archive::{office::case_fold, office_ods::formula};
    let mut occupied = target
        .sheets
        .iter()
        .map(|s| case_fold::sheet_key(&s.name))
        .collect::<std::collections::BTreeSet<_>>();
    let mut changes = std::collections::BTreeMap::new();
    for sheet in &mut incoming.sheets {
        let old = sheet.name.clone();
        if occupied.contains(&case_fold::sheet_key(&old)) {
            let mut base = old.as_str();
            let mut counter = 1_u32;
            if let Some((prefix, digits)) = old.strip_suffix(')').and_then(|s| s.rsplit_once('('))
                && digits.bytes().all(|c| c.is_ascii_digit())
                && let Ok(number) = if digits.is_empty() {
                    Ok(0)
                } else {
                    digits.parse::<u32>()
                }
            {
                base = prefix;
                counter = number;
            }
            loop {
                counter = counter.wrapping_add(1);
                sheet.name = format!("{base}({counter})");
                if !occupied.contains(&case_fold::sheet_key(&sheet.name)) {
                    break;
                }
            }
            changes.insert(case_fold::sheet_key(&old), sheet.name.clone());
            if let Some(typed) = &mut sheet.typed {
                typed.name.clone_from(&sheet.name);
            }
        }
        occupied.insert(case_fold::sheet_key(&sheet.name));
    }
    if !changes.is_empty() {
        let names = incoming
            .sheets
            .iter()
            .map(|s| s.name.clone())
            .collect::<Vec<_>>();
        let mut work = limit;
        for sheet in &mut incoming.sheets {
            if let Some(typed) = &mut sheet.typed {
                for source in typed
                    .cells
                    .values_mut()
                    .filter_map(|c| c.formula.as_mut())
                    .chain(typed.arrays.iter_mut().map(|g| &mut g.expression))
                {
                    let input = format!("msoxl:={source}");
                    if let Some(parsed) =
                        formula::convert(true, &input, false, work, true).map_err(str::to_owned)?
                    {
                        let canonical = parsed
                            .native_xlsx(&names, &mut work)
                            .map_err(str::to_owned)?;
                        *source = formula::rename(&canonical, &changes, &mut work)
                            .map_err(str::to_owned)?;
                    }
                }
                for source in typed
                    .cells
                    .values_mut()
                    .filter_map(|c| c.openformula.as_mut())
                    .chain(
                        typed
                            .arrays
                            .iter_mut()
                            .filter_map(|g| g.openformula.as_mut()),
                    )
                {
                    *source =
                        formula::rename(source, &changes, &mut work).map_err(str::to_owned)?;
                }
            }
        }
    }
    target.sheets.extend(incoming.sheets);
    Ok(())
}

pub(super) fn uri(cwd: &str, path: &str) -> String {
    let path = resolve_posix_path(cwd, path);
    let mut uri = String::from("file://");
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.~!$&'()*+,=:@".contains(&b) {
            uri.push(char::from(b));
        } else {
            write!(uri, "%{b:02X}").unwrap();
        }
    }
    uri
}

pub(super) fn select<'a>(
    kind: Option<&'a str>,
    path: Option<&str>,
    cwd: &str,
) -> Result<&'a str, BuiltinOutcome> {
    if let Some(kind) = kind {
        return if extension(kind).is_some() {
            Ok(kind)
        } else {
            Err(err_out(
                &format!(
                    "Unknown exporter '{kind}'.\nTry --list-exporters to see a list of possibilities.\n"
                ),
                1,
            ))
        };
    }
    let Some(path) = path else {
        return Err(err_out(
            "An output file name or an explicit export type is required.\nTry --list-exporters to see a list of possibilities.\n",
            1,
        ));
    };
    match path
        .rsplit('/')
        .next()
        .and_then(|p| p.rsplit_once('.'))
        .map(|(_, ext)| ext)
    {
        Some("csv") => Ok("Gnumeric_stf:stf_csv"),
        Some("txt") => Ok("Gnumeric_stf:stf_assistant"),
        Some("xlsx") => Ok("Gnumeric_Excel:xlsx2"),
        Some("ods") => Ok("Gnumeric_OpenCalc:odf"),
        Some("dif") => Ok("Gnumeric_dif:dif"),
        Some("slk") => Ok("Gnumeric_sylk:sylk"),
        Some("xml") => Ok("Gnumeric_XmlIO:sax:0"),
        Some("gnumeric") => Ok("Gnumeric_XmlIO:sax"),
        Some("html") => Ok("Gnumeric_html:xhtml"),
        Some("tex") => Ok("Gnumeric_html:latex_table_visible"),
        Some("me") => Ok("Gnumeric_html:roff"),
        _ => Err(err_out(
            &format!(
                "Unable to guess exporter to use for '{}'.\nTry --list-exporters to see a list of possibilities.\n",
                uri(cwd, path)
            ),
            2,
        )),
    }
}

pub(super) fn extension(kind: &str) -> Option<&'static str> {
    match kind {
        "Gnumeric_stf:stf_csv" => Some("csv"),
        "Gnumeric_stf:stf_assistant" => Some("txt"),
        "Gnumeric_Excel:xlsx" | "Gnumeric_Excel:xlsx2" => Some("xlsx"),
        "Gnumeric_OpenCalc:openoffice" | "Gnumeric_OpenCalc:odf" => Some("ods"),
        "Gnumeric_dif:dif" => Some("dif"),
        "Gnumeric_sylk:sylk" => Some("slk"),
        "Gnumeric_XmlIO:sax:0" => Some("xml"),
        "Gnumeric_XmlIO:sax" => Some("gnumeric"),
        "Gnumeric_html:html32"
        | "Gnumeric_html:html40"
        | "Gnumeric_html:html40frag"
        | "Gnumeric_html:xhtml"
        | "Gnumeric_html:xhtml_range" => Some("html"),
        "Gnumeric_html:latex"
        | "Gnumeric_html:latex_table"
        | "Gnumeric_html:latex_table_visible" => Some("tex"),
        "Gnumeric_html:roff" => Some("me"),
        _ => None,
    }
}

pub(super) fn split_output(template: &str, name: &str, index: usize) -> String {
    if !template.contains('%') {
        return format!("{template}.{index}");
    }
    let mut out = String::new();
    let mut chars = template.chars();
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
        } else {
            match chars.next() {
                Some('n') => write!(out, "{index}").unwrap(),
                Some('s') => out.push_str(name.split('\0').next().unwrap()),
                Some('%') => out.push('%'),
                _ => {}
            }
        }
    }
    out
}

#[path = "ssconvert_encoding.rs"]
pub(super) mod encoding;

pub(super) struct TextOptions {
    pub separator: String,
    pub quote: String,
    pub eol: &'static str,
    pub mode: &'static str,
    pub whitespace: bool,
    pub format: &'static str,
    pub charset: String,
    pub transliterate: bool,
    pub converter_locale: &'static str,
}

impl Default for TextOptions {
    fn default() -> Self {
        Self {
            separator: ",".into(),
            quote: "\"".into(),
            eol: "\n",
            mode: "auto",
            whitespace: true,
            format: "automatic",
            charset: "UTF-8".into(),
            transliterate: false,
            converter_locale: "C",
        }
    }
}

impl TextOptions {
    pub fn field(&self, value: &str, out: &mut String) {
        let whitespace = |c: char| c.is_whitespace() && !matches!(c, '\u{b}' | '\u{85}');
        let quoted = !self.quote.is_empty()
            && (self.mode == "always"
                || self.mode == "auto"
                    && (value.contains([',', ' ', '\t', '\n', '"'])
                        || self.whitespace
                            && (value.starts_with(whitespace) || value.ends_with(whitespace))));
        if quoted {
            out.push_str(&self.quote);
            for c in value.chars() {
                if self.quote.contains(c) {
                    out.push_str(&self.quote);
                }
                out.push(c);
            }
            out.push_str(&self.quote);
        } else {
            out.push_str(value);
        }
    }

    pub fn cell(
        &self,
        cell: &xlsx::TypedCell<String>,
        date1904: bool,
        work: &mut usize,
    ) -> Option<String> {
        use crate::commands::archive::office::formulas::{self, Value};
        if self.format == "automatic" {
            return cell_text(cell, true, date1904, work);
        }
        let value = match cell.value.as_ref().unwrap_or(&xlsx::Value::Empty) {
            xlsx::Value::Empty => Value::Empty,
            xlsx::Value::Number(n) => Value::Number(*n),
            xlsx::Value::Text(s) => Value::Text(s.clone()),
            xlsx::Value::Bool(b) => Value::Bool(*b),
            xlsx::Value::Error(e) => return Some(e.clone()),
        };
        if self.format == "raw" {
            return Some(formulas::text::rendered(&value));
        }
        let pattern = cell
            .format
            .as_deref()
            .filter(|f| *f != "General")
            .or(cell.value_format.as_deref())
            .unwrap_or("General");
        match formulas::text::format(&value, pattern, date1904, "−", work).ok()? {
            Value::Text(s) => Some(s),
            Value::Error(_) => Some(String::new()),
            _ => None,
        }
    }
}

pub(super) fn export_sheets(
    book: &Workbook,
    options: Option<&str>,
    exporter: &str,
    split: bool,
    text: &mut TextOptions,
) -> Result<Vec<usize>, String> {
    use crate::commands::archive::office::case_fold;
    let mut selected = Vec::new();
    let mut chars = options.unwrap_or("").chars().peekable();
    let whitespace = |c: char| c.is_ascii_whitespace() && c != '\u{b}';
    while chars.peek().is_some() {
        while chars.next_if(|c| whitespace(*c)).is_some() {}
        if chars.peek().is_none() {
            break;
        }
        let quoted = |chars: &mut std::iter::Peekable<std::str::Chars<'_>>| {
            let quote = chars.next().unwrap();
            let mut value = String::new();
            while let Some(c) = chars.next() {
                if c == quote {
                    return Ok(value);
                }
                if c == '\\' {
                    let Some(c) = chars.next() else { break };
                    value.push(c);
                } else {
                    value.push(c);
                }
            }
            Err("ssconvert: Quoted string not terminated\n".to_owned())
        };
        let key = if matches!(chars.peek(), Some('\'' | '"')) {
            quoted(&mut chars)?
        } else {
            let mut key = String::new();
            while let Some(c) =
                chars.next_if(|c| c.is_ascii_alphanumeric() || "-!_.,:;|/$%#@~".contains(*c))
            {
                key.push(c);
            }
            if key.is_empty() {
                return Err("ssconvert: Syntax error\n".into());
            }
            key
        };
        while chars.next_if(|c| whitespace(*c)).is_some() {}
        if chars.next() != Some('=') {
            return Err("ssconvert: Syntax error\n".into());
        }
        while chars.next_if(|c| whitespace(*c)).is_some() {}
        let value = if matches!(chars.peek(), Some('\'' | '"')) {
            quoted(&mut chars)?
        } else {
            let mut value = String::new();
            while let Some(c) = chars.next_if(|c| !whitespace(*c)) {
                value.push(c);
            }
            value
        };
        if matches!(key.as_str(), "sheet" | "active-sheet") {
            let index = if key == "active-sheet" {
                (!book.sheets.is_empty()).then_some(book.properties.active_sheet)
            } else {
                book.sheets
                    .iter()
                    .position(|s| super::sheet_name_fold::fold(&s.name) == super::sheet_name_fold::fold(&value))
            };
            selected.push(index.ok_or_else(|| format!("ssconvert: Unknown sheet \"{value}\"\n"))?);
        } else if exporter.starts_with("Gnumeric_stf:") {
            let invalid = || format!("ssconvert: Invalid value for option {key}: \"{value}\"\n");
            match key.as_str() {
                "separator" => text.separator = value,
                "quote" => text.quote = value,
                "eol" => {
                    text.eol = match value.to_ascii_lowercase().as_str() {
                        "unix" => "\n",
                        "mac" => "\r",
                        "windows" => "\r\n",
                        _ => {
                            return Err(
                                "ssconvert: eol must be one of unix, mac, and windows\n".into()
                            );
                        }
                    }
                }
                "quoting-mode" => {
                    text.mode = match value.as_str() {
                        "never" | "GSF_OUTPUT_CSV_QUOTING_MODE_NEVER" => "never",
                        "auto" | "GSF_OUTPUT_CSV_QUOTING_MODE_AUTO" => "auto",
                        "always" | "GSF_OUTPUT_CSV_QUOTING_MODE_ALWAYS" => "always",
                        _ => return Err(invalid()),
                    }
                }
                "quoting-on-whitespace" => {
                    text.whitespace = match case_fold::fold(&value).as_str() {
                        "true" | "yes" | "1" => true,
                        "false" | "no" | "0" => false,
                        _ => return Err(invalid()),
                    }
                }
                "format" => {
                    text.format = match value.as_str() {
                        "automatic" | "GNM_STF_FORMAT_AUTO" => "automatic",
                        "raw" | "GNM_STF_FORMAT_RAW" => "raw",
                        "preserve" | "GNM_STF_FORMAT_PRESERVE" => "preserve",
                        _ => return Err(invalid()),
                    }
                }
                "transliterate-mode" => {
                    text.transliterate = match value.as_str() {
                        "transliterate" | "GNM_STF_TRANSLITERATE_MODE_TRANS" => true,
                        "escape" | "GNM_STF_TRANSLITERATE_MODE_ESCAPE" => false,
                        _ => return Err(invalid()),
                    };
                }
                "charset" => text.charset = value,
                "locale" => {}
                _ => {
                    return Err(format!(
                        "ssconvert: Invalid export option \"{key}\" for format {exporter}\n"
                    ));
                }
            }
        } else {
            return Err(format!(
                "ssconvert: Invalid export option \"{key}\" for format {exporter}\n"
            ));
        }
    }
    let subset = !exporter.starts_with("Gnumeric_Excel:")
        && !exporter.starts_with("Gnumeric_OpenCalc:")
        && !exporter.starts_with("Gnumeric_XmlIO:")
        && !matches!(exporter, "Gnumeric_html:xhtml_range" | "Gnumeric_html:roff");
    if split && !subset {
        return Err(format!(
            "Selected exporter ({exporter}) does not have the ability to split a workbook into sheets.\n"
        ));
    }
    let single = matches!(
        exporter,
        "Gnumeric_stf:stf_csv" | "Gnumeric_dif:dif" | "Gnumeric_sylk:sylk"
    ) || exporter.starts_with("Gnumeric_html:latex");
    if !selected.is_empty() && !split {
        if single && selected.len() != 1 {
            return Err(format!(
                "Selected exporter ({exporter}) can only export one sheet at a time.\n"
            ));
        }
        if !subset {
            return Err(format!(
                "Selected exporter ({exporter}) does not have the ability to export a subset of sheets.\n"
            ));
        }
    }
    // LaTeX's runtime selection uses the active view outside per-sheet exports.
    if !split
        && (exporter.starts_with("Gnumeric_html:latex")
            || matches!(exporter, "Gnumeric_dif:dif" | "Gnumeric_sylk:sylk"))
    {
        selected.clear();
    }
    if selected.is_empty() {
        if !split && (single || exporter == "Gnumeric_html:xhtml_range") {
            if !book.sheets.is_empty() {
                selected.push(book.properties.active_sheet);
            }
        } else {
            selected.extend(0..book.sheets.len());
        }
    }
    Ok(selected)
}

pub(super) fn cell_text(
    cell: &xlsx::TypedCell<String>,
    automatic: bool,
    date1904: bool,
    work: &mut usize,
) -> Option<String> {
    use crate::commands::archive::office::{dates, formulas};
    if cell.value.is_none() && cell.format.as_deref().is_none_or(|f| f == "General") {
        return Some(String::new());
    }
    match cell.value.as_ref().unwrap_or(&xlsx::Value::Empty) {
        xlsx::Value::Empty if automatic || cell.format.is_none() => Some(String::new()),
        xlsx::Value::Text(s) | xlsx::Value::Error(s) => Some(s.clone()),
        xlsx::Value::Bool(b) => Some(if *b { "TRUE" } else { "FALSE" }.into()),
        xlsx::Value::Number(_) | xlsx::Value::Empty => {
            let n = match cell.value.as_ref().unwrap_or(&xlsx::Value::Empty) {
                xlsx::Value::Number(n) => *n,
                _ => 0.,
            };
            let format = cell
                .format
                .as_deref()
                .filter(|f| *f != "General")
                .or(cell.value_format.as_deref());
            let mut automatic_format = String::new();
            let format = if automatic {
                let sections = dates::sections(format.unwrap_or("General"), false).ok()?;
                let (pattern, _) = dates::select(&sections, n)?;
                let tokens = formulas::text::scan(pattern, work).ok()?;
                let tokens = tokens
                    .iter()
                    .filter(|(_, literal)| !literal)
                    .map(|(s, _)| s.as_str())
                    .collect::<String>()
                    .to_ascii_lowercase();
                let elapsed = ["[h", "[m", "[s"].iter().any(|part| tokens.contains(part));
                let time = elapsed
                    || tokens.contains(['h', 's'])
                    || tokens.contains("am/pm")
                    || tokens.contains("a/p");
                let date = tokens.contains(['y', 'd']) || tokens.contains('m') && !time;
                if !date && !time {
                    return Some(xlsx::display_number(n));
                }
                let validity = formulas::text::calculate(
                    &formulas::Value::Number(n),
                    &formulas::Value::Text("yyyy".into()),
                    date1904,
                    work,
                )
                .ok()?;
                if matches!(validity, formulas::Value::Error(_)) {
                    return Some(xlsx::display_number(n));
                }
                let fraction = (n - (n + 0.5).floor()).abs();
                let seconds = 86400. * fraction;
                let date = !elapsed && (date || n.abs() >= 1.);
                let time = time || fraction > 1e-9;
                if date {
                    automatic_format.push_str("yyyy/mm/dd");
                }
                if time {
                    if date {
                        automatic_format.push(' ');
                    }
                    automatic_format.push_str(if elapsed { "[h]:mm:ss" } else { "hh:mm:ss" });
                    if (seconds - (seconds + 0.5).floor()).abs() >= 0.0005 {
                        automatic_format.push_str(".000");
                    }
                }
                Some(automatic_format.as_str())
            } else {
                format
            };
            if let Some(format) = format {
                let rendered = formulas::text::calculate(
                    &formulas::Value::Number(n),
                    &formulas::Value::Text(format.into()),
                    date1904,
                    work,
                )
                .ok()?;
                if let formulas::Value::Text(s) = rendered {
                    return Some(s);
                }
                return None;
            }
            Some(xlsx::display_number(n))
        }
    }
}

pub(super) fn extent(sheet: &WorkbookSheet, empty_text: bool) -> (usize, usize, usize, usize) {
    if let Some(typed) = &sheet.typed {
        return typed
            .cells
            .iter()
            .filter(|(_, cell)| {
                !matches!(cell.value, None | Some(xlsx::Value::Empty))
                    && (empty_text
                        || !matches!(&cell.value, Some(xlsx::Value::Text(s)) if s.is_empty()))
            })
            .fold(None, |bounds, (&(r, c), _)| {
                Some(bounds.map_or(
                    (r, c, r, c),
                    |(y, x, yy, xx): (usize, usize, usize, usize)| {
                        (y.min(r), x.min(c), yy.max(r), xx.max(c))
                    },
                ))
            })
            .unwrap_or((0, 0, 0, 0));
    }
    let mut result = None;
    for (r, row) in sheet.rows.iter().enumerate() {
        for (c, _) in row.iter().enumerate().filter(|(_, s)| !s.is_empty()) {
            result = Some(result.map_or(
                (r, c, r, c),
                |(y, x, yy, xx): (usize, usize, usize, usize)| {
                    (y.min(r), x.min(c), yy.max(r), xx.max(c))
                },
            ));
        }
    }
    result.unwrap_or((0, 0, 0, 0))
}

fn decimal_precision(sheet: &WorkbookSheet, column: usize) -> Option<usize> {
    if sheet.typed.is_some() || !sheet.delimited {
        return None;
    }
    let mut precision = None;
    for row in sheet.rows.iter().skip(usize::from(sheet.rows.len() > 1)) {
        let Some(value) = row.get(column) else {
            continue;
        };
        if value.is_empty() || value.starts_with(['\'', '=']) {
            continue;
        }
        if !value.trim().parse::<f64>().ok()?.is_finite() {
            return None;
        }
        let count = value.split_once('.').map_or(0, |(_, fraction)| {
            fraction.bytes().take_while(u8::is_ascii_digit).count()
        });
        if precision.is_some_and(|previous| previous != count) {
            return None;
        }
        precision = Some(count);
    }
    precision.filter(|count| *count > 0)
}

fn html_text(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\0' => break,
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\r' => {
                out.push_str("<br>\r");
                if chars.next_if_eq(&'\n').is_some() {
                    out.push('\n');
                }
            }
            '\n' => out.push_str("<br>\n"),
            '\t' | ' '..='\u{7f}' => out.push(c),
            c => {
                write!(out, "&#{};", c as u32).unwrap();
            }
        }
    }
    out
}

fn latex_text(value: &str, math: bool) -> String {
    let chars: Vec<_> = value
        .chars()
        .take_while(|c| *c != '\0')
        .map(|c| {
            if c == '−' {
                '-'
            } else if c as u32 > 255 {
                '?'
            } else {
                c
            }
        })
        .collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\'
            && chars.get(i + 1).is_some_and(|c| matches!(c, 'l' | 'L'))
            && chars.get(i + 2) == Some(&'{')
        {
            let mut depth = 1;
            let mut end = i + 3;
            while end < chars.len() {
                if chars[end] == '{' {
                    depth += 1;
                }
                if chars[end] == '}' {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                end += 1;
            }
            if depth == 0 {
                out.extend(&chars[i + 3..end]);
                i = end + 1;
                continue;
            }
        }
        match c {
            '$' | '&' | '%' | '#' => {
                out.push('\\');
                out.push(c);
            }
            '_' | '{' | '}' if !math => {
                out.push('\\');
                out.push(c);
            }
            '~' | '^' if c == '~' || !math => {
                out.push('\\');
                out.push(c);
                out.push_str("{ }");
            }
            '\\' => out.push_str("$\\backslash$"),
            '<' | '>' if !math => {
                out.push('$');
                out.push(c);
                out.push('$');
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

pub(super) fn document(
    sheets: &[&WorkbookSheet],
    book: &xlsx::Workbook,
    kind: &str,
    limit: usize,
) -> Option<Vec<u8>> {
    let mut out = String::new();
    let mut work = limit;
    let latex = kind.starts_with("Gnumeric_html:latex");
    let roff = kind == "Gnumeric_html:roff";
    let fragment = matches!(
        kind,
        "Gnumeric_html:latex_table" | "Gnumeric_html:latex_table_visible"
    );
    let legacy = kind == "Gnumeric_html:html32";
    let range = kind == "Gnumeric_html:xhtml_range";
    if roff {
        out.push_str(".\\\" TROFF file\n.fo ''%''\n");
    } else if !latex {
        out.push_str(match kind {
            "Gnumeric_html:html32" => include_str!("ssconvert/html32.html"),
            "Gnumeric_html:html40" => include_str!("ssconvert/html40.html"),
            "Gnumeric_html:html40frag" => "",
            _ => include_str!("ssconvert/xhtml.html"),
        });
    }
    for &sheet in sheets {
        let original = sheet;
        let cached = sheet.cached_formulas();
        let sheet = cached.as_ref().unwrap_or(sheet);
        let (r, c, y, x) = extent(sheet, false);
        let precisions: Vec<_> = (c..=x)
            .map(|col| decimal_precision(original, col))
            .collect();
        if y.saturating_sub(r)
            .saturating_add(1)
            .saturating_mul(x.saturating_sub(c).saturating_add(1))
            > limit
        {
            return None;
        }
        if latex {
            if fragment {
                out.push_str(include_str!("ssconvert/latexFragmentHeader.tex"));
            } else {
                out.push_str(include_str!("ssconvert/latexHeader.tex"));
                out.push_str("\\setlength\\gnumericTableWidth{%\n");
                for _ in c..=x {
                    out.push_str("\t48.0pt+%\n");
                }
                let count = x - c + 1;
                write!(out, "0pt}}\n\\def\\gumericNumCols{{{count}}}\n").ok()?;
                out.push_str(include_str!("ssconvert/latexWidthSetup.tex"));
                for col in c..=x {
                    let n = xlsx_idx_to_col_ref(col);
                    writeln!(out,"\\ifthenelse{{\\isundefined{{\\gnumericCol{n}}}}}{{\\newlength{{\\gnumericCol{n}}}}}{{}}\\settowidth{{\\gnumericCol{n}}}{{\\begin{{tabular}}{{@{{}}p{{48.0pt*\\gnumericScale}}@{{}}}}x\\end{{tabular}}}}").ok()?;
                }
                out.push_str("\n\\begin{longtable}[c]{%\n");
                for col in c..=x {
                    writeln!(out, "\tb{{\\gnumericCol{}}}%", xlsx_idx_to_col_ref(col)).ok()?;
                }
                out.push_str("\t}\n\n");
                let mut options = include_str!("ssconvert/latexTableOptions.tex").to_owned();
                for align in ["c", "l", "r"] {
                    options = options.replace(
                        &format!("\\multicolumn{{1}}{{{align}}}"),
                        &format!("\\multicolumn{{{count}}}{{{align}}}"),
                    );
                }
                options = options.replace(
                    &format!("\\multicolumn{{{count}}}{{c}}{{colTag}}"),
                    "\\multicolumn{1}{c}{colTag}",
                );
                let middle: String = (2..count)
                    .map(|col| format!("%\t&\\multicolumn{{1}}{{c}}{{colTag}}\t%Column {col}\n"))
                    .collect();
                options = options.replace(
                    "%\t&\\multicolumn{1}{c}{colTag}\t\\\\",
                    &(middle + "%\t&\\multicolumn{1}{c}{colTag}\t\\\\"),
                );
                out.push_str(&options);
            }
        } else if roff {
            write!(out, "{}\n\n.TS H\nallbox;\n", sheet.name).ok()?;
        } else {
            out.push_str(if legacy {
                "<p><table border=\"1\">\n"
            } else {
                "<p></p><table cellspacing=\"0\" cellpadding=\"3\">\n"
            });
            if !range {
                writeln!(out, "<caption>{}</caption>", html_text(&sheet.name)).ok()?;
            }
        }
        for row in r..=y {
            if roff {
                if row > r {
                    out.push_str(".T&\n");
                }
                let mut vsize = 10.;
                for col in c..=x {
                    if col > c {
                        out.push(' ');
                    }
                    let cell = sheet.typed.as_ref().and_then(|s| s.cells.get(&(row, col)));
                    let present = cell.is_some()
                        || sheet
                            .rows
                            .get(row)
                            .and_then(|r| r.get(col))
                            .is_some_and(|s| !s.is_empty());
                    if !present {
                        out.push('l');
                        continue;
                    }
                    let style = cell.and_then(|c| c.style.as_ref());
                    let align = style
                        .and_then(|s| s.attributes.iter().find(|(k, _)| *k == "HAlign"))
                        .and_then(|(_, v)| v.parse::<u32>().ok())
                        .unwrap_or(1);
                    out.push(if align & 4 != 0 {
                        'r'
                    } else if [8, 64, 128].contains(&align) {
                        'c'
                    } else {
                        'l'
                    });
                    let font = |key, default| {
                        style
                            .and_then(|s| s.font.iter().find(|(k, _)| *k == key))
                            .and_then(|(_, v)| v.parse::<f64>().ok())
                            .unwrap_or(default)
                    };
                    let bold = font("Bold", 0.) != 0.;
                    let italic = font("Italic", 0.) != 0.;
                    let family = style.map_or(String::new(), |s| s.family.to_ascii_lowercase());
                    let mono = matches!(family.as_str(), "courier" | "fixed");
                    let helvetica = family == "helvetica";
                    if mono || helvetica || bold || italic {
                        write!(
                            out,
                            "f{}{}{}{}",
                            if mono {
                                "C"
                            } else if helvetica {
                                "H"
                            } else {
                                "T"
                            },
                            if bold { "B" } else { "" },
                            if italic { "I" } else { "" },
                            if !bold && !italic { "R" } else { "" }
                        )
                        .ok()?;
                    }
                    let size = font("Unit", 10.).trunc();
                    if size != 0. {
                        write!(out, "p{size}").ok()?;
                        vsize = f64::max(vsize, size);
                    }
                }
                write!(out, ".\n.vs {:.2}p\n", 2.5 + vsize).ok()?;
            } else if !latex {
                out.push_str("<tr>\n");
            }
            for col in c..=x {
                let value = sheet
                    .rows
                    .get(row)
                    .and_then(|r| r.get(col))
                    .map_or("", String::as_str);
                let precision = if original
                    .rows
                    .get(row)
                    .and_then(|r| r.get(col))
                    .is_some_and(|value| value.starts_with('='))
                {
                    None
                } else {
                    precisions[col - c]
                };
                let number = match xlsx::value(value, sheet.typed.is_none() && sheet.delimited) {
                    xlsx::Cell::Number(n) => {
                        let text = if let Some(precision) = precision {
                            let mut text = xlsx::fixed_number(n, precision % 256, 0);
                            if n < 0. && text.bytes().any(|b| matches!(b, b'1'..=b'9')) {
                                text.insert(0, '-');
                            }
                            text
                        } else {
                            xlsx::display_number(n)
                        };
                        Some(if latex {
                            text
                        } else {
                            text.replace('-', "−")
                        })
                    }
                    _ => None,
                };
                let typed = sheet
                    .typed
                    .as_ref()
                    .and_then(|sheet| sheet.cells.get(&(row, col)));
                let rendered = if let Some(cell) = typed {
                    Some({
                        let text = cell_text(cell, false, book.date1904, &mut work)?;
                        if !latex
                            && matches!(cell.value, Some(xlsx::Value::Number(_)))
                            && cell.format.as_ref().is_none_or(|f| !f.contains('y'))
                        {
                            text.replace('-', "−")
                        } else {
                            text
                        }
                    })
                } else {
                    None
                };
                let align = match typed.and_then(|cell| cell.value.as_ref()) {
                    Some(xlsx::Value::Number(_)) => "right",
                    Some(xlsx::Value::Bool(_) | xlsx::Value::Error(_)) => "center",
                    Some(_) => "left",
                    None => {
                        if number.is_some() {
                            "right"
                        } else {
                            "left"
                        }
                    }
                };
                let value = rendered
                    .as_deref()
                    .unwrap_or_else(|| number.as_deref().unwrap_or(value));
                if roff {
                    if col > c {
                        out.push('\t');
                    }
                    if value.is_empty() && typed.is_none() {
                        out.push(' ');
                    } else {
                        for ch in value.chars().take_while(|c| *c != '\0') {
                            if matches!(ch, '.' | '\\') {
                                out.push('\\');
                            }
                            out.push(ch);
                        }
                    }
                } else if latex {
                    out.push_str(if col > c {
                        "\t&"
                    } else if fragment {
                        ""
                    } else {
                        "\t "
                    });
                    if !value.is_empty() {
                        if fragment {
                            out.push_str(&latex_text(value, false));
                        } else {
                            let align = typed
                                .and_then(|cell| cell.style.as_ref())
                                .and_then(|style| {
                                    style.attributes.iter().find(|(key, _)| *key == "HAlign")
                                })
                                .map_or(align, |(_, value)| {
                                    match crate::commands::js_number(value, 0.) {
                                        1. => align,
                                        2. => "left",
                                        4. => "right",
                                        8. | 64. | 128. => "center",
                                        32. => "justify",
                                        _ => "",
                                    }
                                });
                            use crate::commands::archive::office::{dates, formulas::text::scan};
                            let numeric = if let Some(cell) = typed {
                                let format = cell
                                    .format
                                    .as_deref()
                                    .or_else(|| {
                                        cell.style
                                            .as_ref()?
                                            .attributes
                                            .iter()
                                            .find(|(key, _)| *key == "Format")
                                            .map(|(_, value)| value.as_str())
                                    })
                                    .unwrap_or("General");
                                let sections = dates::sections(format, false).ok()?;
                                let pattern = match cell.value {
                                    Some(xlsx::Value::Number(n)) => dates::select(&sections, n)?.0,
                                    _ => &sections.first()?.pattern,
                                };
                                let tokens = scan(pattern, &mut work)
                                    .ok()?
                                    .into_iter()
                                    .filter(|(_, literal)| !literal)
                                    .map(|(s, _)| s)
                                    .collect::<String>()
                                    .to_lowercase();
                                tokens.contains(['0', '#', '?'])
                                    && !tokens.contains(['y', 'm', 'd', 'h', 's'])
                            } else {
                                precision.is_some()
                            };
                            let text = if numeric {
                                format!("${}$", latex_text(value, true))
                            } else {
                                latex_text(value, false)
                            };
                            if align.is_empty() {
                                write!(out, "\\makebox{{{text}}}").ok()?;
                            } else if align == "justify" {
                                write!(out, "\\gnumbox[s]{{{text}}}").ok()?;
                            } else {
                                write!(
                                    out,
                                    "\\gnumericPB{{\\{}}}\\gnumbox{}{{{text}}}",
                                    match align {
                                        "right" => "raggedleft",
                                        "center" => "centering",
                                        _ => "raggedright",
                                    },
                                    match align {
                                        "right" => "[r]",
                                        "center" => "",
                                        _ => "[l]",
                                    },
                                )
                                .ok()?;
                            }
                        }
                    }
                    if !fragment {
                        out.push('\n');
                    }
                } else {
                    let style = typed.and_then(|c| c.style.as_ref()).or_else(|| {
                        sheet
                            .typed
                            .as_ref()?
                            .style_regions
                            .iter()
                            .rev()
                            .find(|(r, _)| row >= r[0] && row <= r[2] && col >= r[1] && col <= r[3])
                            .map(|(_, s)| s)
                    });
                    let attr = |key| {
                        style
                            .and_then(|s| s.attributes.iter().find(|(k, _)| *k == key))
                            .map(|(_, v)| v.as_str())
                    };
                    let font = |key, default| {
                        style
                            .and_then(|s| s.font.iter().find(|(k, _)| *k == key))
                            .and_then(|(_, v)| v.parse::<f64>().ok())
                            .unwrap_or(default)
                    };
                    let background = attr("Shade").is_some_and(|s| s != "0");
                    out.push_str("<td ");
                    if background && (legacy || kind == "Gnumeric_html:xhtml" || range) {
                        out.push_str(" bgcolor=\"#FFFFFF\"");
                    }
                    if !value.is_empty() || typed.is_some() {
                        out.push_str(" valign=\"bottom\" ");
                        let align = match attr("HAlign") {
                            Some("2") => "left",
                            Some("4") => "right",
                            Some("8" | "64" | "128") => "center",
                            Some("32") => "justify",
                            Some("16") => "",
                            _ => align,
                        };
                        if !align.is_empty() {
                            write!(out, " align=\"{align}\" ").ok()?;
                        }
                    }
                    if !legacy {
                        out.push_str(" style=\"");
                        if background {
                            out.push_str("background:#FFFFFF;");
                        }
                        if !value.is_empty() || typed.is_some() {
                            write!(out, " font-size:{}pt;", (font("Unit", 10.) + 0.5).floor())
                                .ok()?;
                        }
                        if let Some(style) = style {
                            for edge in ["Top", "Bottom", "Left", "Right"] {
                                if let Some((_, kind, color)) =
                                    style.borders.iter().find(|b| b.0 == edge)
                                    && *kind == 1
                                {
                                    write!(
                                        out,
                                        " border-{}:thin solid #{};",
                                        edge.to_ascii_lowercase(),
                                        color.strip_prefix("FF").unwrap_or(color)
                                    )
                                    .ok()?;
                                }
                            }
                        }
                        out.push('"');
                    }
                    out.push('>');
                    let italic = font("Italic", 0.) != 0.;
                    let bold = font("Bold", 0.) != 0.;
                    let mono = style.is_some_and(|s| {
                        matches!(s.family.to_ascii_lowercase().as_str(), "courier" | "fixed")
                    });
                    if italic {
                        out.push_str("<i>");
                    }
                    if bold {
                        out.push_str("<b>");
                    }
                    if mono {
                        out.push_str("<tt>");
                    }
                    out.push_str(&html_text(value));
                    if mono {
                        out.push_str("</tt>");
                    }
                    if bold {
                        out.push_str("</b>");
                    }
                    if italic {
                        out.push_str("</i>");
                    }
                    out.push_str("</td>\n");
                }
                if out.len() > limit {
                    return None;
                }
            }
            out.push_str(if latex {
                "\\\\\n"
            } else if roff {
                "\n"
            } else {
                "</tr>\n"
            });
            if roff && row == r {
                out.push_str(".TH\n");
            }
        }
        if latex {
            if !fragment {
                out.push_str(include_str!("ssconvert/latexEnd.tex"));
            }
        } else if roff {
            out.push_str(".TE\n\n");
        } else {
            out.push_str("</table>\n");
        }
    }
    if !latex && !roff && kind != "Gnumeric_html:html40frag" {
        out.push_str("</body>\n</html>\n");
    }
    if out.len() > limit {
        return None;
    }
    Some(if latex {
        out.chars().map(|c| c as u8).collect()
    } else {
        out.into_bytes()
    })
}

#[cfg(test)]
mod tests {
    use super::super::{JVal, cmd_ssconvert, parse_json_stream, read_office_archive};
    use crate::{MemoryVfs, SafeBashFs};
    use std::collections::BTreeMap;

    #[test]
    fn exporter_selection_and_destinations_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-routing-production.json"
        ));
    }

    #[test]
    fn cell_updates_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-set-production.json"
        ));
    }

    #[test]
    fn imported_workbook_updates_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-import-updates-production.json"
        ));
    }

    #[test]
    fn imported_calculation_and_csv_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-calculation-production.json"
        ));
    }

    #[test]
    fn active_sheet_updates_and_exports_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-active-production.json"
        ));
    }

    #[test]
    fn export_sheet_selection_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-selection-production.json"
        ));
    }

    #[test]
    fn text_export_options_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-options-production.json"
        ));
    }

    #[test]
    fn text_export_encoding_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-encoding-production.json"
        ));
    }

    #[test]
    fn text_import_inference_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-text-production.json"
        ));
    }

    #[test]
    fn text_import_decoding_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-decoding-production.json"
        ));
    }

    #[test]
    fn importer_selection_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-importers-production.json"
        ));
    }

    #[test]
    fn dif_import_and_export_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-dif-production.json"
        ));
    }

    #[test]
    fn sylk_import_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-sylk-production.json"
        ));
    }

    #[test]
    fn ods_style_regions_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-ods-regions-production.json"
        ));
    }

    #[test]
    fn xlsx_style_regions_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-regions-production.json"
        ));
    }

    #[test]
    fn sylk_export_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-sylk-export-production.json"
        ));
    }

    #[test]
    fn gnumeric_export_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-gnumeric-export-production.json"
        ));
    }

    #[test]
    fn gnumeric_import_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-gnumeric-import-production.json"
        ));
    }

    #[test]
    fn gnumeric_styles_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-gnumeric-styles-production.json"
        ));
    }

    #[test]
    fn xlsx_validation_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-validation-production.json"
        ));
    }

    #[test]
    fn xlsx_conditional_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-conditional-production.json"
        ));
    }

    #[test]
    fn xlsx_breaks_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-breaks-production.json"
        ));
    }

    #[test]
    fn xlsx_print_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-print-production.json"
        ));
    }

    #[test]
    fn xlsx_view_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-view-production.json"
        ));
    }

    #[test]
    fn xlsx_format_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-format-production.json"
        ));
    }

    #[test]
    fn xlsx_names_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-names-production.json"
        ));
    }

    #[test]
    fn xlsx_calculation_settings_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-calculation-production.json"
        ));
    }

    #[test]
    fn xlsx_document_properties_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-xlsx-properties-production.json"
        ));
    }

    #[test]
    fn gnumeric_document_properties_match_production() {
        let fixture = crate::commands::codecs::gzip_decompress(include_bytes!(
            "../../tests/fixtures/ssconvert-gnumeric-properties-production.json.gz"
        )).unwrap();
        check_fixture(std::str::from_utf8(&fixture).unwrap());
    }

    #[test]
    fn numeric_spellings_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-numbers-production.json"
        ));
    }

    #[test]
    fn ods_gnumeric_print_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-ods-gnumeric-print-production.json"
        ));
    }

    #[test]
    fn ods_print_numbers_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-ods-print-numbers-production.json"
        ));
    }

    #[test]
    fn ods_label_ranges_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-ods-label-ranges-production.json"
        ));
    }

    #[test]
    fn ods_label_formulas_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-ods-label-formulas-production.json"
        ));
    }

    #[test]
    fn ods_legacy_labels_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-ods-legacy-labels-production.json"
        ));
    }

    #[test]
    fn label_references_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-label-references-production.json"
        ));
    }

    #[test]
    fn radical_labels_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-radical-labels-production.json"
        ));
    }

    #[test]
    fn live_names_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-live-names-production.json"
        ));
    }

    #[test]
    fn global_names_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-global-names-production.json"
        ));
    }

    #[test]
    fn name_import_order_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-name-import-order-production.json"
        ));
    }

    #[test]
    fn name_scope_order_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-name-scope-order-production.json"
        ));
    }

    #[test]
    fn sheet_construction_matches_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-sheet-construction-production.json"
        ));
    }

    #[test]
    fn name_rejection_groups_match_production() {
        check_fixture(include_str!(
            "../../tests/fixtures/ssconvert-name-rejection-groups-production.json"
        ));
    }

    fn check_fixture(fixture: &str) {
        fn object(value: &JVal) -> &[(String, JVal)] {
            let JVal::Object(value) = value else {
                panic!("object")
            };
            value
        }
        fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
            &object(value)
                .iter()
                .find(|(name, _)| name == key)
                .unwrap()
                .1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(value) = value else {
                panic!("string")
            };
            value
        }
        fn array(value: &JVal) -> &[JVal] {
            let JVal::Array(value) = value else {
                panic!("array")
            };
            value
        }
        fn bytes(value: &JVal) -> Vec<u8> {
            string(value)
                .as_bytes()
                .chunks_exact(2)
                .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
                .collect()
        }
        let data = parse_json_stream(fixture).unwrap();
        let mut failures = Vec::new();
        for case in array(field(&data[0], "cases")) {
            let fs = MemoryVfs::new();
            fs.mkdir_all("/work").unwrap();
            for (name, value) in object(field(case, "input")) {
                fs.write_file(&format!("/work/{name}"), string(value).as_bytes())
                    .unwrap();
            }
            if let Some((_, input)) = object(case).iter().find(|(key, _)| key == "inputHex") {
                for (name, value) in object(input) {
                    fs.write_file(&format!("/work/{name}"), &bytes(value))
                        .unwrap();
                }
            }
            for path in array(field(case, "outputs")) {
                fs.write_file(&format!("/work/{}", string(path)), b"existing output")
                    .unwrap();
            }
            let args: Vec<_> = array(field(case, "args"))
                .iter()
                .map(|v| string(v).to_owned())
                .collect();
            let env = object(case)
                .iter()
                .find(|(key, _)| key == "env")
                .map(|(_, env)| {
                    object(env)
                        .iter()
                        .map(|(key, value)| (key.clone(), string(value).to_owned()))
                        .collect()
                })
                .unwrap_or_default();
            let result = cmd_ssconvert(&args, "", "/work", &env, &fs);
            let expected = field(case, "production");
            let JVal::Number(code, _) = field(expected, "exitCode") else {
                panic!("code")
            };
            let files = object(field(expected, "files"));
            let actual: BTreeMap<_, _> = fs
                .read_dir("/work")
                .unwrap()
                .into_iter()
                .filter_map(|entry| {
                    let path = format!("/work/{entry}");
                    fs.read_file(&path).ok().map(|bytes| (entry, bytes))
                })
                .collect();
            let same = actual.len() == files.len()
                && files.iter().all(|(path, value)| {
                    let expected = bytes(value);
                    actual.get(path).is_some_and(|actual| {
                        if expected.starts_with(b"PK\x03\x04")
                            && crate::commands::codecs::zip_directory(expected.len(), |r| {
                                Ok(std::borrow::Cow::Borrowed(&expected[r]))
                            })
                            .is_ok()
                        {
                            let a = read_office_archive(actual);
                            let e = read_office_archive(&expected);
                            if a != e {
                                for name in a.keys().filter(|name| !e.contains_key(*name)) {
                                    failures.push(format!(
                                        "{} unexpected {name}",
                                        string(field(case, "name"))
                                    ));
                                }
                                {
                                    let (a, e) = (&a, &e);
                                    for (name, expected) in e {
                                        if let Some(actual) = a.get(name) {
                                            if actual != expected {
                                                let at = actual
                                                    .iter()
                                                    .zip(expected)
                                                    .position(|(a, b)| a != b)
                                                    .unwrap_or(actual.len().min(expected.len()));
                                                failures.push(format!(
                                                    "{} {name} at {at}: actual {:?}, expected {:?}",
                                                    string(field(case, "name")),
                                                    String::from_utf8_lossy(
                                                        &actual[at.saturating_sub(50)
                                                            ..actual.len().min(at + 200)]
                                                    ),
                                                    String::from_utf8_lossy(
                                                        &expected[at.saturating_sub(50)
                                                            ..expected.len().min(at + 200)]
                                                    )
                                                ));
                                            }
                                        } else {
                                            failures.push(format!(
                                                "{} missing {name}",
                                                string(field(case, "name"))
                                            ));
                                        }
                                    }
                                }
                            }
                            a == e
                        } else {
                            let decoded;
                            let expected = if expected.starts_with(b"\x1f\x8b\x08") {
                                assert_eq!(actual.get(..10), expected.get(..10));
                                decoded = crate::commands::codecs::gzip_decompress_bounded(
                                    actual, 10_000_000,
                                )
                                .unwrap();
                                crate::commands::codecs::gzip_decompress_bounded(
                                    &expected, 10_000_000,
                                )
                                .unwrap()
                            } else {
                                decoded = actual.clone();
                                expected
                            };
                            let actual = &decoded;
                            if *actual != expected {
                                let at = actual
                                    .iter()
                                    .zip(&expected)
                                    .position(|(a, b)| a != b)
                                    .unwrap_or(actual.len().min(expected.len()));
                                failures.push(format!(
                                    "{} {path} at {at}: actual {:?}, expected {:?}",
                                    string(field(case, "name")),
                                    String::from_utf8_lossy(
                                        &actual[at.saturating_sub(50)..actual.len().min(at + 100)]
                                    ),
                                    String::from_utf8_lossy(
                                        &expected
                                            [at.saturating_sub(50)..expected.len().min(at + 100)]
                                    )
                                ));
                            }
                            *actual == expected
                        }
                    })
                });
            if result.exit_code != *code as i32
                || result.stdout != string(field(expected, "stdout"))
                || result.stderr != string(field(expected, "stderr"))
                || !same
            {
                failures.push(format!(
                    "{}: status {} stderr {:?}, files {:?}",
                    string(field(case, "name")),
                    result.exit_code,
                    result.stderr,
                    actual.keys().collect::<Vec<_>>()
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
