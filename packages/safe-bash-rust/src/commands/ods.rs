// Default OpenDocument spreadsheet parts and sparse table serialization.
use super::{
    WorkbookSheet, format_ss_number, parse_cell_coord,
    xlsx::{Cell, Value, value},
};
use crate::commands::{archive::TarEntry, codecs::encode_zip_members};
use std::{collections::BTreeSet, fmt::Write, sync::Arc};
#[path = "ods_definitions.rs"]
mod definitions;
#[path = "ods_rich.rs"]
mod rich;
#[path = "ods_styles.rs"]
mod styles;

fn escaped(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\r', "&#13;")
        .replace('\n', "&#10;")
        .replace('\t', "&#9;")
}

fn text(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(at) = rest.find([' ', '\t', '\n']) {
        out.push_str(&escaped(&rest[..at]));
        rest = &rest[at..];
        if rest.starts_with(' ') {
            let n = rest.bytes().take_while(|b| *b == b' ').count();
            if n == 1 {
                out.push_str("<text:s/>")
            } else {
                write!(out, r#"<text:s text:c="{n}"/>"#).unwrap();
            }
            rest = &rest[n..];
        } else {
            out.push_str(if rest.starts_with('\t') {
                "<text:tab/>"
            } else {
                "<text:line-break/>"
            });
            rest = &rest[1..];
        }
    }
    out.push_str(&escaped(rest));
    out
}

// OpenFormula encloses cell references (and both ends of a range) in brackets.
fn formula(s: &str) -> String {
    let mut out = String::from("of:=");
    let mut rest = s;
    while !rest.is_empty() {
        let c = rest.chars().next().unwrap();
        if c == '"' {
            let end = rest[1..].find('"').map_or(rest.len(), |i| i + 2);
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            continue;
        }
        if c.is_ascii_alphanumeric() || matches!(c, '$' | '_') {
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '$' | '_' | '.')))
                .unwrap_or(rest.len());
            let token = &rest[..end];
            rest = &rest[end..];
            if parse_cell_coord(token).is_some() && !rest.starts_with('(') {
                write!(out, "[.{token}").unwrap();
                if let Some(next) = rest.strip_prefix(':') {
                    let end = next
                        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '$'))
                        .unwrap_or(next.len());
                    if parse_cell_coord(&next[..end]).is_some() {
                        write!(out, ":.{}", &next[..end]).unwrap();
                        rest = &next[end..];
                    }
                }
                out.push(']');
            } else {
                out.push_str(token);
            }
        } else {
            out.push(if c == ',' { ';' } else { c });
            rest = &rest[c.len_utf8()..];
        }
    }
    escaped(&out)
}

fn number_style(format: &str, name: &str, work: &mut usize) -> Result<String, String> {
    use crate::commands::archive::office::{dates, formulas::text::scan};
    let sections = dates::sections(format, false)?;
    if sections.len() != 1 {
        return Err("Unsupported ssconvert feature: multi-section ODF number format\n".into());
    }
    let tokens = scan(&sections[0].pattern, work)
        .map_err(|_| "ssconvert: ODS output exceeds byte limit\n")?;
    let raw = tokens
        .iter()
        .filter(|(_, literal)| !literal)
        .map(|(s, _)| s.as_str())
        .collect::<String>()
        .to_lowercase();
    let kind = if raw.contains(['y', 'd']) {
        "date"
    } else if raw.contains(['h', 's']) {
        "time"
    } else if raw.contains('@') {
        "text"
    } else if raw.contains('%') {
        "percentage"
    } else {
        "number"
    };
    let mut body = String::new();
    let mut elapsed = false;
    if matches!(kind, "date" | "time") {
        let mut i = 0;
        while i < tokens.len() {
            let (token, literal) = &tokens[i];
            if *literal {
                write!(body, "<number:text>{}</number:text>", escaped(token)).unwrap();
                i += 1;
                continue;
            }
            if token == "[" && tokens.get(i + 2).is_some_and(|(s, _)| s == "]") {
                elapsed = true;
                i += 1;
            }
            let field = tokens[i].0.to_lowercase();
            if field == "]" {
                i += 1;
                continue;
            }
            let mut n = 1;
            while tokens
                .get(i + 1)
                .is_some_and(|(s, literal)| !literal && s.eq_ignore_ascii_case(&field))
            {
                n += 1;
                i += 1;
            }
            let minute = field == "m"
                && (kind == "time"
                    || tokens[..i]
                        .iter()
                        .any(|(s, l)| !l && s.eq_ignore_ascii_case("h"))
                        && tokens[i + 1..]
                            .iter()
                            .any(|(s, l)| !l && s.eq_ignore_ascii_case("s")));
            let tag = match field.as_str() {
                "y" => Some("year"),
                "d" => Some(if n > 2 { "day-of-week" } else { "day" }),
                "m" => Some(if minute { "minutes" } else { "month" }),
                "h" => Some("hours"),
                "s" => Some("seconds"),
                _ => None,
            };
            if let Some(tag) = tag {
                write!(
                    body,
                    "<number:{tag} number:style=\"{}\"{}/>",
                    if n > 1 { "long" } else { "short" },
                    if field == "m" && !minute && n > 2 {
                        " number:textual=\"true\""
                    } else {
                        ""
                    }
                )
                .unwrap();
            } else {
                write!(
                    body,
                    "<number:text>{}</number:text>",
                    escaped(&tokens[i].0.repeat(n))
                )
                .unwrap();
            }
            i += 1;
        }
    } else if kind == "text" {
        body.push_str("<number:text-content/>");
    } else {
        let digit = |(s, l): &(String, bool)| !l && matches!(s.as_str(), "0" | "#");
        let first = tokens.iter().position(digit);
        let last = tokens.iter().rposition(digit);
        if first.is_none() || raw.contains(['?', 'e', '/']) {
            return Err(format!(
                "Unsupported ssconvert feature: ODF numeric format {format}\n"
            ));
        }
        let (first, last) = (first.unwrap(), last.unwrap());
        let dot = tokens.iter().position(|(s, l)| !l && s == ".");
        let decimals = dot.map_or(0, |i| {
            tokens[i + 1..=last].iter().filter(|t| digit(t)).count()
        });
        let min = tokens[first..dot.unwrap_or(last + 1)]
            .iter()
            .filter(|(s, l)| !l && s == "0")
            .count();
        for (s, _) in &tokens[..first] {
            write!(body, "<number:text>{}</number:text>", escaped(s)).unwrap();
        }
        write!(body,"<number:number number:decimal-places=\"{decimals}\" number:min-integer-digits=\"{min}\" number:grouping=\"{}\"/>",raw.contains(',')).unwrap();
        for (s, _) in &tokens[last + 1..] {
            write!(body, "<number:text>{}</number:text>", escaped(s)).unwrap();
        }
    }
    Ok(format!(
        "<number:{kind}-style style:name=\"N{name}\"{}>{body}</number:{kind}-style>",
        if elapsed {
            " number:truncate-on-overflow=\"false\""
        } else {
            ""
        }
    ))
}

pub(super) fn write(
    sheets: &[WorkbookSheet],
    book: Option<&super::xlsx::Workbook>,
    extended: bool,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let limit_error = "ssconvert: ODS output exceeds byte limit\n";
    let mut styles = String::new();
    let mut formats = Vec::<(String, Option<Arc<super::xlsx::Style>>)>::new();
    let mut work = limit;
    let source = book.and_then(|book| book.odf.as_ref());
    let gnumeric = book.and_then(|book| book.gnumeric.as_ref());
    let mut rich = rich::RichText::default();
    let mut definitions = definitions::Definitions::read(source, extended);
    let mut table_style_names = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        use super::ssconvert::gnumeric_read::{attr, number, source_sheet};
        let node = source_sheet(gnumeric, &sheet.name);
        let flag = |key, fallback| {
            node.map_or(fallback, |n| {
                number(n, key, if fallback { 1. } else { 0. }) != 0.
            })
        };
        let visible = node
            .and_then(|n| attr(n, "Visibility"))
            .is_none_or(|v| v == "GNM_SHEET_VISIBILITY_VISIBLE");
        let mut table_properties = format!(
            r#"<style:table-properties table:display="{visible}" style:writing-mode="{}""#,
            if flag("RTL_Layout", false) {
                "rl-tb"
            } else {
                "lr-tb"
            }
        );
        if extended {
            write!(table_properties, r#" gnm:display-formulas="{}" gnm:display-col-header="{}" gnm:display-row-header="{}""#, flag("DisplayFormulas", false), !flag("HideColHeader", false), !flag("HideRowHeader", false)).unwrap();
        }
        table_properties.push_str("/>");
        let print_records = source
            .and_then(|s| s.print.get(&sheet.name))
            .into_iter()
            .chain(
                node.into_iter()
                    .flat_map(|n| super::ssconvert::gnumeric_read::children(n, "PrintInformation")),
            );
        let layout = definitions.register(
            "layouts",
            "style:page-layout",
            &format!("pl{index}"),
            "",
            &format!(
                r#"<style:page-layout-properties style:print="charts drawings objects"{}/>"#,
                styles::print(
                    sheet.typed.as_ref().map(|s| &s.print),
                    print_records,
                    extended
                )
            ),
        );
        let master = definitions.register(
            "masters",
            "style:master-page",
            &format!("mp{index}"),
            &format!(r#" style:page-layout-name="{}""#, escaped(&layout)),
            "",
        );
        let table_style = definitions.register(
            "content",
            "style:style",
            &format!("ta{index}"),
            &format!(
                r#" style:family="table" style:master-page-name="{}""#,
                escaped(&master)
            ),
            &table_properties,
        );
        table_style_names.push(table_style);
        if gnumeric.is_some()
            && let Some(typed) = &sheet.typed
        {
            for comment in &typed.comments {
                rich.register(&comment.runs, extended, &mut definitions);
            }
            for cell in typed.cells.values() {
                if let Some(runs) = &cell.rich_text {
                    rich.register(runs, extended, &mut definitions);
                }
            }
        }
    }
    let mut reserved = definitions.names.clone();
    let mut style_names = Vec::new();
    let mut cell_styles = String::new();

    let label_sheets: Vec<_> = sheets.iter().filter_map(|s| s.typed.as_ref()).collect();
    let names = |scope| -> Result<String, String> {
        let mut names = String::new();
        let mut remaining = limit;
        if let Some(book) = book {
            for name in book.names.iter().filter(|name| name.sheet == scope) {
                let base = format!(
                    "'{}'.${}${}",
                    sheets[name.position.0].name.replace('\'', "''"),
                    super::xlsx_idx_to_col_ref(name.position.2 as usize),
                    name.position.1 + 1
                );
                if gnumeric.is_some() || name.expression.contains(".quoted:") {
                    let mut parsed = crate::commands::archive::office_ods::formula::convert(
                        true,
                        &name
                            .openformula
                            .clone()
                            .unwrap_or_else(|| format!("={}", name.expression)),
                        false,
                        remaining,
                        true,
                    )
                    .map_err(str::to_owned)?
                    .ok_or(limit_error)?;
                    parsed
                        .output_labels(
                            &label_sheets,
                            book,
                            (
                                name.position.0,
                                name.position.1 as usize,
                                name.position.2 as usize,
                            ),
                            &mut remaining,
                        )
                        .map_err(str::to_owned)?;
                    let value = parsed
                        .open_document(&mut remaining)
                        .map_err(str::to_owned)?
                        .ok_or(limit_error)?;
                    if parsed.named_range().is_some() {
                        let range = value
                            .strip_prefix("of:=[")
                            .and_then(|v| v.strip_suffix(']'))
                            .ok_or(limit_error)?;
                        write!(names, r#"<table:named-range table:name="{}" table:cell-range-address="{}" table:base-cell-address="{}"/>"#, escaped(&name.name), escaped(range), escaped(&base)).unwrap();
                    } else {
                        write!(names, r#"<table:named-expression table:name="{}" table:expression="{}" table:base-cell-address="{}"/>"#, escaped(&name.name), escaped(&value), escaped(&base)).unwrap();
                    }
                } else {
                    write!(names, r#"<table:named-expression table:name="{}" table:expression="{}" table:base-cell-address="{}"/>"#, escaped(&name.name), formula(&name.expression), escaped(&base)).unwrap();
                }
            }
        }
        Ok(if names.is_empty() {
            "<table:named-expressions/>".into()
        } else {
            format!("<table:named-expressions>{names}</table:named-expressions>")
        })
    };
    let namespaces = include_str!("ods/namespaces.txt");
    let mut tables = String::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let dimensions = book
            .and_then(|b| b.sheet_sizes.get(index))
            .copied()
            .unwrap_or((65536, 256));
        let cols = sheet
            .rows
            .iter()
            .map(Vec::len)
            .max()
            .unwrap_or(0)
            .max(dimensions.1);
        let cached = sheet.cached_formulas();
        write!(
            tables,
            r#"<table:table table:name="{}" table:style-name="{}">"#,
            escaped(&sheet.name),
            escaped(&table_style_names[index])
        )
        .map_err(|_| limit_error)?;
        let mut next_column = 0;
        if let Some(typed) = &sheet.typed {
            for (ordinal, (&column, axis)) in typed.columns.iter().enumerate() {
                if column > next_column {
                    write!(
                        tables,
                        r#"<table:table-column table:number-columns-repeated="{}"/>"#,
                        column - next_column
                    )
                    .unwrap();
                }
                let name = format!("co{index}_{ordinal}");
                write!(styles, r#"<style:style style:name="{name}" style:family="table-column"><style:table-column-properties"#).unwrap();
                if let Some(size) = axis.size {
                    write!(
                        styles,
                        r#" style:column-width="{}pt""#,
                        super::xlsx::display_number(size)
                    )
                    .unwrap();
                }
                styles.push_str("/></style:style>");
                write!(
                    tables,
                    r#"<table:table-column table:style-name="{name}" table:visibility="{}"/>"#,
                    if axis.hidden { "collapse" } else { "visible" }
                )
                .unwrap();
                next_column = column + 1;
            }
        }
        if cols > next_column {
            tables.push_str("<table:table-column");
            if cols - next_column > 1 {
                write!(
                    tables,
                    r#" table:number-columns-repeated="{}""#,
                    cols - next_column
                )
                .unwrap();
            }
            tables.push_str("/>");
        }
        let mut row_styles = std::collections::BTreeMap::new();
        if let Some(typed) = &sheet.typed {
            for (&row, axis) in typed.rows.iter().filter(|(_, axis)| axis.size.is_some()) {
                let name = format!("ro{index}_{row}");
                write!(styles, r#"<style:style style:name="{name}" style:family="table-row"><style:table-row-properties"#).unwrap();
                if let Some(size) = axis.size {
                    write!(
                        styles,
                        r#" style:row-height="{}pt""#,
                        super::xlsx::display_number(size)
                    )
                    .unwrap();
                }
                styles.push_str("/></style:style>");
                row_styles.insert(row, name);
            }
        }
        if let Some(typed) = &sheet.typed {
            for (_, style) in &typed.style_regions {
                let format = style
                    .attributes
                    .iter()
                    .find(|(k, _)| *k == "Format")
                    .map_or("General", |(_, v)| v.as_str());
                let key = (format.to_owned(), Some(style.clone()));
                if formats.contains(&key) {
                    continue;
                }
                let mut ordinal = style_names.len();
                let mut name = format!("ce{ordinal}");
                while reserved.contains(&name) || reserved.contains(&format!("N{name}")) {
                    ordinal += 1;
                    name = format!("ce{ordinal}");
                }
                reserved.insert(name.clone());
                reserved.insert(format!("N{name}"));
                style_names.push(name.clone());
                if format != "General" {
                    cell_styles.push_str(&number_style(format, &name, &mut work)?);
                }
                cell_styles.push_str(&styles::cell(
                    Some(style),
                    format != "General",
                    &name,
                    extended,
                ));
                formats.push(key);
            }
        }
        // Boundaries describe sparse cells and style rectangles without expanding
        // whole rows or columns into millions of blank cell objects.
        let regions = sheet
            .typed
            .as_ref()
            .map_or(&[][..], |s| s.style_regions.as_slice());
        let mut rows = BTreeSet::from([0]);
        for (row, values) in sheet.rows.iter().enumerate() {
            if values.iter().any(|s| !s.is_empty()) {
                rows.extend([row, row + 1]);
            }
        }
        if let Some(typed) = &sheet.typed {
            for &(row, _) in typed.cells.keys() {
                rows.extend([row, row + 1]);
            }
            for &row in typed.rows.keys() {
                rows.extend([row, row + 1]);
            }
            if gnumeric.is_some() {
                for &[row, _, _, height] in &typed.merges {
                    rows.extend([row, row + 1, row + height]);
                }
                for comment in &typed.comments {
                    rows.extend([comment.row, comment.row + 1]);
                }
            }
        }
        for (range, _) in regions {
            rows.extend([range[0], range[2] + 1]);
        }
        rows.insert(dimensions.0.max(*rows.last().unwrap()));
        let rows = rows.into_iter().collect::<Vec<_>>();
        for interval in rows.windows(2) {
            let i = interval[0];
            let repeat = interval[1] - i;
            let row = sheet.rows.get(i).map_or(&[][..], Vec::as_slice);
            let active = regions
                .iter()
                .filter(|(r, _)| i >= r[0] && i <= r[2])
                .collect::<Vec<_>>();
            let mut columns = BTreeSet::from([0, cols]);
            for (col, value) in row.iter().enumerate() {
                if !value.is_empty() {
                    columns.extend([col, col + 1]);
                }
            }
            if let Some(typed) = &sheet.typed {
                for (&(_, col), _) in typed.cells.range((i, 0)..=(i, usize::MAX)) {
                    columns.extend([col, col + 1]);
                }
                if gnumeric.is_some() {
                    for &[row, col, width, height] in &typed.merges {
                        if i >= row && i < row + height {
                            columns.extend([col, col + 1, col + width]);
                        }
                    }
                    for comment in typed.comments.iter().filter(|c| c.row == i) {
                        columns.extend([comment.column, comment.column + 1]);
                    }
                }
            }
            for (range, _) in &active {
                columns.extend([range[1], range[3] + 1]);
            }
            tables.push_str("<table:table-row");
            if repeat > 1 {
                write!(tables, r#" table:number-rows-repeated="{repeat}""#).unwrap();
            }
            if sheet
                .typed
                .as_ref()
                .and_then(|s| s.rows.get(&i))
                .is_some_and(|a| a.hidden)
            {
                tables.push_str(r#" table:visibility="collapse""#);
            }
            if let Some(name) = row_styles.get(&i) {
                write!(tables, r#" table:style-name="{name}""#).unwrap();
            }
            tables.push('>');
            let columns = columns.into_iter().collect::<Vec<_>>();
            for interval in columns.windows(2) {
                let j = interval[0];
                let repeat = interval[1] - j;
                let raw = row.get(j).map_or("", String::as_str);
                let typed = sheet.typed.as_ref().and_then(|s| s.cells.get(&(i, j)));
                use super::ssconvert::gnumeric_read::{attr, children, source_sheet, source_style};
                let link = source_sheet(gnumeric, &sheet.name)
                    .and_then(|n| source_style(n, i, j))
                    .and_then(|n| children(n, "HyperLink").next());
                let mut hyperlink = String::new();
                if let Some(link) = link
                    && let Some(target) = attr(link, "target").filter(|s| !s.is_empty())
                {
                    let target = if attr(link, "type") == Some("GnmHLinkCurWB") {
                        let parsed = crate::commands::archive::office_ods::formula::convert(
                            true,
                            &format!("={target}"),
                            false,
                            work,
                            true,
                        )
                        .map_err(str::to_owned)?;
                        let display = parsed
                            .as_ref()
                            .and_then(|p| p.display.as_deref())
                            .unwrap_or(target);
                        let target = if target.starts_with('$') {
                            display
                        } else {
                            display.strip_prefix('$').unwrap_or(display)
                        };
                        let mut fragment = String::from("#");
                        for b in target.bytes() {
                            if b.is_ascii_alphanumeric()
                                || b";/ :@&=+$,-_.!~*'()".contains(&b) && b != b' '
                            {
                                fragment.push(char::from(b));
                            } else {
                                write!(fragment, "%{b:02X}").unwrap();
                            }
                        }
                        fragment
                    } else {
                        target.to_owned()
                    };
                    write!(
                        hyperlink,
                        r#"<text:a xlink:href="{}" xlink:type="simple""#,
                        escaped(&target)
                    )
                    .unwrap();
                    if let Some(tip) = attr(link, "tip") {
                        write!(hyperlink, r#" office:title="{}""#, escaped(tip)).unwrap();
                    }
                    hyperlink.push('>');
                }
                let merge = sheet
                    .typed
                    .as_ref()
                    .filter(|_| gnumeric.is_some())
                    .and_then(|s| {
                        s.merges
                            .iter()
                            .find(|&&[r, c, w, h]| i >= r && i < r + h && j >= c && j < c + w)
                    });
                if merge.is_some_and(|r| i != r[0] || j != r[1]) {
                    tables.push_str("<table:covered-table-cell");
                    if repeat > 1 {
                        write!(tables, r#" table:number-columns-repeated="{repeat}""#).unwrap();
                    }
                    tables.push_str("/>");
                    continue;
                }
                let spans = merge.map_or_else(String::new, |r| {
                    format!(
                        r#" table:number-columns-spanned="{}" table:number-rows-spanned="{}""#,
                        r[2], r[3]
                    )
                });
                let region_style = active
                    .iter()
                    .rev()
                    .find(|(r, _)| j >= r[1] && j <= r[3])
                    .map(|(_, style)| {
                        let format = style
                            .attributes
                            .iter()
                            .find(|(k, _)| *k == "Format")
                            .map_or("General", |(_, v)| v.as_str());
                        let key = (format.to_owned(), Some(style.clone()));
                        &style_names[formats.iter().position(|f| *f == key).unwrap()]
                    });
                if typed.is_none() && raw.is_empty() {
                    tables.push_str("<table:table-cell");
                    tables.push_str(&spans);
                    if let Some(name) = region_style {
                        write!(tables, r#" table:style-name="{name}""#).unwrap();
                    }
                    if repeat > 1 {
                        write!(tables, r#" table:number-columns-repeated="{repeat}""#).unwrap();
                    }
                    tables.push_str("/>");
                    continue;
                }
                // Own the selected name before registering a cell's combined style.
                let region_style = region_style.cloned();
                tables.push_str("<table:table-cell");
                tables.push_str(&spans);
                let mut cell = value(raw, sheet.delimited);
                let mut computed = typed.is_some_and(|cell| cell.formula.is_some());
                if let Some(typed) = typed {
                    if typed.formula.is_none()
                        && let Some(Value::Error(error)) = &typed.value
                    {
                        computed = true;
                        if extended {
                            write!(tables, r#" gnm:error-value="{}""#, escaped(error)).unwrap();
                        }
                        write!(tables, r#" table:formula="of:={}""#, escaped(error)).unwrap();
                    }
                    let group = sheet.typed.as_ref().and_then(|s| {
                        s.arrays.iter().find(|g| {
                            i >= g.range[0]
                                && j >= g.range[1]
                                && i < g.range[0] + g.range[3]
                                && j < g.range[1] + g.range[2]
                        })
                    });
                    if let Some(f) = typed
                        .formula
                        .as_ref()
                        .filter(|_| group.is_none_or(|g| g.range[0] == i && g.range[1] == j))
                    {
                        let source =
                            if gnumeric.is_none() && book.is_some_and(|book| book.odf.is_some()) {
                                typed.openformula.clone().unwrap_or_else(|| format!("={f}"))
                            } else {
                                format!(
                                    "={}",
                                    if gnumeric.is_some() {
                                        typed.formula_display.as_ref().unwrap_or(f)
                                    } else {
                                        f
                                    }
                                )
                            };
                        let mut parsed = crate::commands::archive::office_ods::formula::convert(
                            true, &source, false, work, true,
                        )
                        .map_err(|e| format!("ssconvert: {e}\n"))?
                        .ok_or(limit_error)?;
                        if let Some(book) = book {
                            parsed
                                .output_labels(&label_sheets, book, (index, i, j), &mut work)
                                .map_err(str::to_owned)?;
                        }
                        let formula = parsed
                            .open_document(&mut work)
                            .map_err(|e| format!("ssconvert: {e}\n"))?
                            .ok_or(limit_error)?;
                        write!(tables, r#" table:formula="{}""#, escaped(&formula)).unwrap();
                        if let Some(group) = group {
                            write!(tables,r#" table:number-matrix-columns-spanned="{}" table:number-matrix-rows-spanned="{}""#,group.range[2],group.range[3]).unwrap();
                        }
                    }
                    let format = typed.format.as_deref().unwrap_or("General");
                    let style = typed
                        .style
                        .as_ref()
                        .filter(|s| s.as_ref() != &super::xlsx::Style::default());
                    if let Some(name) = source.and_then(|s| s.cell_styles.get(&(index, i, j))) {
                        write!(tables, r#" table:style-name="{}""#, escaped(name)).unwrap();
                    } else if format != "General" || style.is_some() {
                        let key = (format.to_owned(), style.cloned());
                        let index = if let Some(index) = formats.iter().position(|f| *f == key) {
                            index
                        } else {
                            let index = formats.len();
                            let mut ordinal = style_names.len();
                            let mut name = format!("ce{ordinal}");
                            while reserved.contains(&name) || reserved.contains(&format!("N{name}"))
                            {
                                ordinal += 1;
                                name = format!("ce{ordinal}");
                            }
                            reserved.insert(name.clone());
                            reserved.insert(format!("N{name}"));
                            style_names.push(name.clone());
                            if format != "General" {
                                cell_styles.push_str(&number_style(format, &name, &mut work)?);
                            }
                            cell_styles.push_str(&styles::cell(
                                style.map(AsRef::as_ref),
                                format != "General",
                                &name,
                                extended,
                            ));
                            formats.push(key);
                            index
                        };
                        write!(
                            tables,
                            r#" table:style-name="{}""#,
                            region_style.as_ref().unwrap_or(&style_names[index])
                        )
                        .unwrap();
                    } else if let Some(name) = &region_style {
                        write!(tables, r#" table:style-name="{name}""#).unwrap();
                    }
                    cell = match typed.value.as_ref() {
                        Some(Value::Number(n)) => Cell::Number(*n),
                        Some(Value::Bool(b)) => Cell::Bool(*b),
                        Some(Value::Text(s) | Value::Error(s)) => Cell::Text(s),
                        _ => {
                            if gnumeric.is_some() {
                                tables.push_str("/>");
                            } else {
                                tables.push_str("><text:p/></table:table-cell>");
                            }
                            continue;
                        }
                    };
                } else if let Cell::Formula(f) = cell {
                    computed = true;
                    write!(tables, r#" table:formula="{}""#, formula(f))
                        .map_err(|_| limit_error)?;
                    let v = &cached.as_ref().ok_or(limit_error)?.rows[i][j];
                    cell = match value(v, true) {
                        Cell::Formula(_) => Cell::Text(""),
                        other => other,
                    };
                }
                match cell {
                    Cell::Number(n) => {
                        use crate::commands::archive::office::{dates, formulas::text::scan};
                        let sections = dates::sections(
                            typed.and_then(|c| c.format.as_deref()).unwrap_or("General"),
                            false,
                        )?;
                        let tokens =
                            scan(&sections[0].pattern, &mut work).map_err(|_| limit_error)?;
                        let raw = tokens
                            .iter()
                            .filter(|(_, literal)| !literal)
                            .map(|(s, _)| s.as_str())
                            .collect::<String>()
                            .to_lowercase();
                        let rendered = if let Some(cell) = typed {
                            super::ssconvert::cell_text(
                                cell,
                                true,
                                book.is_some_and(|b| b.date1904),
                                &mut work,
                            )
                            .ok_or(limit_error)?
                        } else {
                            format_ss_number(n)
                        };
                        if raw.contains(['y', 'd']) {
                            use crate::commands::coreutils::{civil_from_days, days_from_civil};
                            let serial = (n + 0.5 / 86400.).floor();
                            let mac = book.is_some_and(|b| b.date1904);
                            let days = if mac {
                                days_from_civil(1904, 1, 1)
                            } else {
                                days_from_civil(1899, 12, 31)
                            };
                            if !(-2147483648. ..2147483647.).contains(&n) || !mac && serial == 60. {
                                return Err("Unsupported ssconvert feature: OpenDocument date outside supported calendar\n".into());
                            }
                            let (y, m, d) = civil_from_days(
                                days + serial as i64 - i64::from(!mac && serial >= 60.),
                            );
                            if !(1..=65535).contains(&y) {
                                return Err("Unsupported ssconvert feature: OpenDocument date outside supported calendar\n".into());
                            }
                            let mut date = if y < 10000 {
                                format!("{y:04}-{m:02}-{d:02}")
                            } else {
                                format!("+{y:06}-{m:02}")
                            };
                            if n != n.floor() {
                                let seconds = ((n - n.floor()) * 86400.).round() as u64 % 86400;
                                write!(
                                    date,
                                    "T{:02}:{:02}:{:02}",
                                    seconds / 3600,
                                    seconds / 60 % 60,
                                    seconds % 60
                                )
                                .unwrap();
                            }
                            write!(
                                tables,
                                r#" office:value-type="date" office:date-value="{date}""#
                            )
                            .unwrap();
                        } else if raw.contains(['h', 's']) && n >= 0. && (n * 86400.).is_finite() {
                            let seconds = n * 86400.;
                            let remainder = seconds % 60.;
                            write!(tables, r#" office:value-type="time" office:time-value="PT0{}H{:02.0}M{}{remainder}S""#, (seconds / 3600.).floor(), (seconds / 60.).floor() % 60., if remainder < 10. { "0" } else { "" }).unwrap();
                        } else {
                            write!(
                                tables,
                                r#" office:value-type="float" office:value="{}""#,
                                if book.is_some_and(|b| b.gnumeric.is_some()) {
                                    crate::commands::archive::office::formulas::Value::Number(n)
                                        .cached()
                                } else {
                                    format_ss_number(n)
                                }
                            )
                            .unwrap();
                        }
                        write!(
                            tables,
                            "><text:p>{}</text:p>",
                            rich::linked(&rendered, &hyperlink)
                        )
                        .unwrap();
                    }
                    Cell::Bool(b) => {
                        write!(tables,r#" office:value-type="boolean" office:boolean-value="{b}"><text:p>{}</text:p>"#,rich::linked(if b{"TRUE"}else{"FALSE"}, &hyperlink)).map_err(|_| limit_error)?;
                    }
                    Cell::Text(s) => {
                        tables.push_str(r#" office:value-type="string""#);
                        if computed {
                            write!(tables, r#" office:string-value="{}""#, escaped(s))
                                .map_err(|_| limit_error)?;
                        }
                        let comment = sheet
                            .typed
                            .as_ref()
                            .and_then(|s| s.comments.iter().find(|c| c.row == i && c.column == j))
                            .filter(|_| gnumeric.is_some());
                        if let Some(comment) = comment {
                            tables.push_str("><office:annotation>");
                            if let Some(author) = &comment.author {
                                write!(tables, "<dc:creator>{}</dc:creator>", escaped(author))
                                    .unwrap();
                            }
                            write!(
                                tables,
                                "<text:p>{}</text:p></office:annotation>",
                                rich.content(&comment.runs, "")
                            )
                            .unwrap();
                        } else {
                            tables.push('>');
                        }
                        if s.is_empty() {
                            tables.push_str("<text:p/>");
                        } else {
                            let content = typed
                                .and_then(|c| c.rich_text.as_ref())
                                .filter(|_| gnumeric.is_some())
                                .map_or_else(
                                    || rich::linked(s, &hyperlink),
                                    |runs| rich.content(runs, &hyperlink),
                                );
                            write!(tables, "<text:p>{content}</text:p>")
                                .map_err(|_| limit_error)?;
                        }
                    }
                    Cell::Formula(_) => unreachable!(),
                }
                tables.push_str("</table:table-cell>");
                if tables.len() > limit {
                    return Err(limit_error.into());
                }
            }
            tables.push_str("</table:table-row>");
            if tables.len() > limit {
                return Err(limit_error.into());
            }
        }
        tables.push_str(&names(Some(index))?);
        tables.push_str("</table:table>");
    }
    styles.push_str(&cell_styles);
    let active = escaped(
        &sheets
            .get(book.map_or(0, |book| book.active_sheet))
            .or_else(|| sheets.first())
            .ok_or(limit_error)?
            .name,
    );
    let mut labels = String::new();
    if let Some(book) = book {
        for (index, ranges) in book.label_ranges.iter().enumerate() {
            for pair in ranges {
                let address = |range: [usize; 4], sheet: usize| {
                    format!(
                        "$'{}'.${}${}:.${}${}",
                        sheets[sheet].name.replace('\'', "''"),
                        super::xlsx_idx_to_col_ref(range[1]),
                        range[0] + 1,
                        super::xlsx_idx_to_col_ref(range[3]),
                        range[2] + 1,
                    )
                };
                let start = labels.len();
                write!(labels, r#"<table:label-range table:label-cell-range-address="{}" table:data-cell-range-address="{}" table:orientation="{}"/>"#,
                    escaped(&address(pair.labels, index)), escaped(&address(pair.data, pair.data_sheet)),
                    if pair.column { "column" } else { "row" }).unwrap();
                work = work.checked_sub(labels.len() - start).ok_or(limit_error)?;
            }
        }
    }
    if !labels.is_empty() {
        labels = format!("<table:label-ranges>{labels}</table:label-ranges>");
    }
    let mut entries = Vec::new();
    let mut remaining = limit;
    let fonts = definitions.render("fonts");
    let fonts = if fonts.is_empty() {
        "<office:font-face-decls/>".into()
    } else {
        format!("<office:font-face-decls>{fonts}</office:font-face-decls>")
    };
    for (name, content) in [
        (
            "mimetype",
            "application/vnd.oasis.opendocument.spreadsheet".to_owned(),
        ),
        (
            "content.xml",
            format!(
                include_str!("ods/content.xml"),
                namespaces = namespaces,
                table_styles = definitions.render("content"),
                fonts = fonts,
                automatic_labels = book.is_some_and(|book| book.automatic_label_lookup),
                null_date = if book.is_some_and(|book| book.date1904) {
                    "1904-1-1"
                } else {
                    "1899-12-30"
                },
                iteration_status = if book
                    .and_then(|b| b.iteration.as_ref())
                    .is_some_and(|i| i.enabled)
                {
                    "enable"
                } else {
                    "disable"
                },
                iteration_steps = book
                    .and_then(|b| b.iteration.as_ref())
                    .map_or(100, |i| i.maximum),
                iteration_tolerance = super::xlsx::display_number(
                    book.and_then(|b| b.iteration.as_ref())
                        .map_or(0.001, |i| i.tolerance)
                ),
                styles = styles,
                names = names(None)?,
                labels = labels,
                tables = tables
            ),
        ),
        (
            "styles.xml",
            format!(
                include_str!("ods/styles.xml"),
                namespaces = namespaces,
                fonts = fonts,
                layouts = definitions.render("layouts"),
                masters = definitions.render("masters"),
                common_styles = {
                    let styles = definitions.render("styles");
                    if styles.is_empty() {
                        "<office:styles/>".into()
                    } else {
                        format!("<office:styles>{styles}</office:styles>")
                    }
                }
            ),
        ),
        (
            "meta.xml",
            format!(include_str!("ods/meta.xml"), namespaces = namespaces),
        ),
        (
            "settings.xml",
            format!(
                include_str!("ods/settings.xml"),
                namespaces = namespaces,
                foreign = extended,
                active = active
            ),
        ),
        (
            "META-INF/manifest.xml",
            include_str!("ods/manifest.xml").to_owned(),
        ),
    ] {
        remaining = remaining
            .checked_sub(content.len() + name.len() + 64)
            .ok_or(limit_error)?;
        entries.push(TarEntry {
            name: name.into(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 946684800.,
            atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: content.into_bytes(),
        });
    }
    Ok(encode_zip_members(
        &entries,
        (8, 6),
        &["mimetype"],
        true,
        (false, None, false),
        (&Default::default(), &Default::default()),
        |_, _, _, _| true,
    ))
}
