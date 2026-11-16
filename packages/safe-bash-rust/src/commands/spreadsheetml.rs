use super::{WorkbookSheet, XmlElement, XmlNode, eval_ss_formula_cell_str, format_ss_number, xml, xlsx_idx_to_col_ref};

pub(super) const NAMESPACE: &str = "urn:schemas-microsoft-com:office:spreadsheet";
const INVALID: &str = "ssconvert: invalid SpreadsheetML workbook\n";
const LIMIT: &str = "ssconvert: SpreadsheetML workbook exceeds input limit\n";

fn elements(element: &XmlElement) -> impl Iterator<Item = &XmlElement> {
    element.children.iter().filter_map(|node| if let XmlNode::Element(el) = node { Some(el) } else { None })
}

fn namespace<'a>(prefix: &str, element: &'a XmlElement, parents: &[&'a XmlElement]) -> Option<&'a str> {
    std::iter::once(element).chain(parents.iter().rev().copied()).find_map(|el| {
        el.attrs.iter().find(|(name, _)| if prefix.is_empty() { name == "xmlns" } else { name.strip_prefix("xmlns:") == Some(prefix) }).map(|(_, value)| value.as_str())
    })
}

fn named(element: &XmlElement, parents: &[&XmlElement], local: &str) -> bool {
    let (prefix, name) = element.tag.split_once(':').unwrap_or(("", &element.tag));
    name == local && namespace(prefix, element, parents) == Some(NAMESPACE)
}

fn attr<'a>(element: &'a XmlElement, parents: &[&'a XmlElement], local: &str) -> Option<&'a str> {
    element.attrs.iter().find_map(|(name, value)| {
        let (prefix, name) = name.split_once(':')?;
        (name == local && namespace(prefix, element, parents) == Some(NAMESPACE)).then_some(value.as_str())
    })
}

fn index(value: Option<&str>, next: usize) -> Result<usize, &'static str> {
    let index = match value { Some(value) => value.parse::<usize>().ok().and_then(|v| v.checked_sub(1)).ok_or(INVALID)?, None => next };
    if index < next { return Err(INVALID); }
    Ok(index)
}

fn spend(remaining: &mut usize, bytes: usize) -> Result<(), &'static str> {
    *remaining = remaining.checked_sub(bytes).ok_or(LIMIT)?;
    Ok(())
}

fn axis(input: &str, current: usize, maximum: usize) -> Option<(usize, &str)> {
    let (coordinate, rest) = if let Some(relative) = input.strip_prefix('[') {
        let (offset, rest) = relative.split_once(']')?;
        (current.checked_add_signed(offset.parse().ok()?)?, rest)
    } else {
        let end = input.find(|c: char| !c.is_ascii_digit()).unwrap_or(input.len());
        if end == 0 { (current, input) } else { (input[..end].parse::<usize>().ok()?.checked_sub(1)?, &input[end..]) }
    };
    (coordinate < maximum).then_some((coordinate, rest))
}

fn formula(input: &str, row: usize, column: usize) -> Result<String, &'static str> {
    if input.len() > 8192 || input.bytes().filter(|b| b"()+-*/".contains(b)).take(96).count() >= 96 { return Err(LIMIT); }
    let mut rest = input.strip_prefix('=').ok_or(INVALID)?;
    let mut output = String::new();
    let mut quoted = false;
    let mut boundary = true;
    while let Some(c) = rest.chars().next() {
        if !quoted && boundary && c == 'R'
            && let Some((r, after_row)) = axis(&rest[1..], row, 1_048_576)
            && let Some(after_c) = after_row.strip_prefix('C')
            && let Some((col, after)) = axis(after_c, column, 16_384)
            && !after.starts_with(|c: char| c.is_alphanumeric() || c == '_')
        {
            output.push_str(&xlsx_idx_to_col_ref(col));
            output.push_str(&(r + 1).to_string());
            rest = after;
            boundary = false;
            continue;
        }
        if c == '"' { quoted = !quoted; }
        output.push(c);
        rest = &rest[c.len_utf8()..];
        boundary = !c.is_alphanumeric() && c != '_' && c != '.';
    }
    Ok(output)
}

pub(super) fn read(bytes: &[u8], mut remaining: usize, recalc: bool) -> Result<Vec<WorkbookSheet>, String> {
    if bytes.len() > remaining { return Err(LIMIT.into()); }
    let source = std::str::from_utf8(bytes).map_err(|_| INVALID)?;
    let document = xml::parse(source, None, None).map_err(|_| INVALID)?;
    let root = document.nodes.iter().find_map(|node| if let XmlNode::Element(el) = node { Some(el) } else { None }).ok_or(INVALID)?;
    if !named(root, &[], "Workbook") { return Err(INVALID.into()); }
    let mut sheets = Vec::new();
    for worksheet in elements(root).filter(|el| named(el, &[root], "Worksheet")) {
        let name = attr(worksheet, &[root], "Name").ok_or(INVALID)?;
        spend(&mut remaining, std::mem::size_of::<WorkbookSheet>().saturating_add(name.len()))?;
        let mut sheet = WorkbookSheet { name: name.into(), active: sheets.is_empty(), delimited: false, rows: Vec::new(), empty_text_cells: Vec::new() };
        let mut formulas = Vec::new();
        let mut next_row = 0;
        for table in elements(worksheet).filter(|el| named(el, &[root, worksheet], "Table")) {
            for row in elements(table).filter(|el| named(el, &[root, worksheet, table], "Row")) {
                let r = index(attr(row, &[root, worksheet, table], "Index"), next_row)?;
                if r >= 1_048_576 { return Err(LIMIT.into()); }
                spend(&mut remaining, (r + 1 - sheet.rows.len()).saturating_mul(std::mem::size_of::<Vec<String>>()))?;
                sheet.rows.resize_with(r + 1, Vec::new);
                next_row = r + 1;
                let mut next_column = 0;
                for cell in elements(row).filter(|el| named(el, &[root, worksheet, table, row], "Cell")) {
                    let parents = [root, worksheet, table, row];
                    let c = index(attr(cell, &parents, "Index"), next_column)?;
                    if c >= 16_384 { return Err(LIMIT.into()); }
                    spend(&mut remaining, (c + 1 - sheet.rows[r].len()).saturating_mul(std::mem::size_of::<String>()))?;
                    sheet.rows[r].resize_with(c + 1, String::new);
                    next_column = c + 1;
                    if let Some(data) = elements(cell).find(|el| named(el, &[root, worksheet, table, row, cell], "Data")) {
                        let mut value = String::new();
                        let mut pending = vec![data.children.iter()];
                        while let Some(children) = pending.last_mut() {
                            match children.next() {
                                Some(XmlNode::Text(text, _) | XmlNode::Cdata(text)) => { spend(&mut remaining, text.len())?; value.push_str(text); }
                                Some(XmlNode::Element(el)) => pending.push(el.children.iter()),
                                Some(XmlNode::Markup(_)) => {},
                                None => { pending.pop(); }
                            }
                        }
                        let original_length = value.len();
                        match attr(data, &[root, worksheet, table, row, cell], "Type").unwrap_or("String") {
                            "Number" => { let n = value.trim().parse::<f64>().map_err(|_| INVALID)?; if !n.is_finite() { return Err(INVALID.into()); } value = format_ss_number(n); }
                            "String" => { if value.is_empty() { spend(&mut remaining, std::mem::size_of::<(usize, usize)>())?; sheet.empty_text_cells.push((r, c)); } }
                            "Boolean" => {
                                if value.eq_ignore_ascii_case("true") { value = "TRUE".into(); }
                                else if value.eq_ignore_ascii_case("false") { value = "FALSE".into(); }
                                else { return Err("ssconvert: invalid SpreadsheetML boolean\n".into()); }
                            }
                            "DateTime" => {
                                let (seconds, nanos, _) = crate::commands::coreutils::parse_absolute_date_spec(&value, 0).map_err(|_| INVALID)?;
                                let base = crate::commands::coreutils::days_from_civil(1899, 12, 31) as f64;
                                let mut serial = seconds as f64 / 86400.0 - base + nanos as f64 / 86_400_000_000_000.0;
                                if serial >= 60.0 { serial += 1.0; }
                                value = format_ss_number(serial);
                            }
                            "Error" => {},
                            _ => return Err("ssconvert: unsupported SpreadsheetML cell type\n".into()),
                        }
                        if value.len() > original_length { spend(&mut remaining, value.len() - original_length)?; }
                        sheet.rows[r][c] = value;
                    }
                    if recalc && let Some(expression) = attr(cell, &parents, "Formula") {
                        let expression = formula(expression, r, c)?;
                        spend(&mut remaining, expression.len().saturating_add(std::mem::size_of::<(usize, usize, String)>()))?;
                        formulas.push((r, c, expression));
                    }
                }
            }
        }
        if recalc {
            for _ in 0..4 {
                for (r, c, expression) in &formulas {
                    let value = eval_ss_formula_cell_str(expression, &sheet.rows).ok_or("ssconvert: unsupported SpreadsheetML formula\n")?;
                    if value.len() > sheet.rows[*r][*c].len() { spend(&mut remaining, value.len() - sheet.rows[*r][*c].len())?; }
                    sheet.rows[*r][*c] = value;
                }
            }
        }
        sheets.push(sheet);
    }
    if sheets.is_empty() { return Err(INVALID.into()); }
    Ok(sheets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_and_sparse_coordinates_survive_explicit_recalculation() {
        let xml = format!(r#"<Workbook xmlns="{NAMESPACE}" xmlns:s="{NAMESPACE}"><Worksheet s:Name="S"><Table><Row s:Index="3"><Cell><Data s:Type="Number">4</Data></Cell><Cell s:Formula="=RC[-1]+2"><Data s:Type="Number">99</Data></Cell><Cell><Data s:Type="String">=1+2</Data></Cell></Row></Table></Worksheet></Workbook>"#);
        let cached = read(xml.as_bytes(), 4096, false).unwrap();
        assert_eq!(cached[0].rows, [vec![], vec![], vec!["4", "99", "=1+2"]]);
        let calculated = read(xml.as_bytes(), 4096, true).unwrap();
        assert_eq!(calculated[0].rows[2], ["4", "6", "=1+2"]);
    }

    #[test]
    fn rejects_expanded_sparse_storage_and_foreign_roots() {
        let xml = format!(r#"<Workbook xmlns="{NAMESPACE}" xmlns:s="{NAMESPACE}"><Worksheet s:Name="S"><Table><Row s:Index="1000"><Cell><Data s:Type="Number">4</Data></Cell></Row></Table></Worksheet></Workbook>"#);
        assert_eq!(read(xml.as_bytes(), 1024, false).unwrap_err(), LIMIT);
        assert_eq!(read(xml.replace(NAMESPACE, "foreign").as_bytes(), 4096, false).unwrap_err(), INVALID);
        assert!(read(&xml.as_bytes()[..xml.len()-3], 4096, false).is_err());
    }
}
