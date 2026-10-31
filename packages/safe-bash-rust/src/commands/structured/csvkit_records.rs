// csvkit feeds its CSV parser one physical input line at a time. A blank
// line has zero fields; a quoted empty field is one field containing "".
pub(super) fn records(
    input: &str,
    delimiter: char,
    quote: char,
    skip_space: bool,
    skip_lines: usize,
) -> impl Iterator<Item = Result<Vec<String>, &'static str>> {
    let mut lines = input.split_inclusive('\n').skip(skip_lines);
    std::iter::from_fn(move || {
        let mut row = Vec::new();
        let mut field = String::new();
        let mut quoted = false;
        let mut field_start = true;
        let mut active = false;
        loop {
            let Some(line) = lines.next() else {
                if !active {
                    return None;
                }
                row.push(field);
                return Some(Ok(row));
            };
            let mut chars = line.chars().peekable();
            while let Some(ch) = chars.next() {
                if quoted {
                    if ch != quote {
                        field.push(ch);
                    } else if chars.next_if_eq(&quote).is_some() {
                        field.push(quote);
                    } else {
                        quoted = false;
                    }
                    continue;
                }
                if matches!(ch, '\r' | '\n') {
                    if chars.any(|rest| !matches!(rest, '\n' | '\r')) {
                        return Some(Err(
                            "Error: new-line character seen in unquoted field - do you need to open the file with newline=''?\n",
                        ));
                    }
                    if active {
                        row.push(field);
                    }
                    return Some(Ok(row));
                }
                active = true;
                if field_start && ch == ' ' && skip_space {
                    continue;
                }
                if ch == delimiter {
                    row.push(std::mem::take(&mut field));
                    field_start = true;
                } else {
                    if field_start && ch == quote {
                        quoted = true;
                    } else {
                        field.push(ch);
                    }
                    field_start = false;
                }
            }
        }
    })
}
