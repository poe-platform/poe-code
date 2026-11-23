use super::{LIMIT, NamedExpression, Sheet, Syntax, Workbook, formula_tokens, formulas};
use std::collections::BTreeMap;

type Coord = (usize, usize, usize);

struct Group {
    first: Coord,
    last: usize,
    origin: Coord,
    source: String,
    matrix: bool,
}

pub(super) fn regroup(
    sheets: &mut [Sheet<String>],
    book: &mut Workbook,
    sources: &[(String, String)],
    names: &[NamedExpression],
    raw_groups: &BTreeMap<Coord, usize>,
    work: &mut usize,
) -> Result<(), &'static str> {
    // Token signatures and parsed expressions are temporary, like calculation
    // state. Bound that pass separately; retain charges for cell code and origins.
    let mut temporary_budget = *work;
    let temporary = &mut temporary_budget;
    let mut columns = BTreeMap::<(usize, usize), Vec<Group>>::new();
    for (s, sheet) in sheets.iter().enumerate() {
        for (&(r, c), cell) in &sheet.cells {
            let Some(source) = cell
                .openformula
                .as_deref()
                .and_then(|source| source.strip_prefix("msoxl:="))
                .or(cell.formula.as_deref())
            else {
                continue;
            };
            let mut matrix = false;
            let mut follower = false;
            for array in &sheet.arrays {
                *temporary = temporary.checked_sub(1).ok_or(LIMIT)?;
                let [row, col, width, height] = array.range;
                if (row..row + height).contains(&r) && (col..col + width).contains(&c) {
                    matrix = (r, c) == (row, col);
                    follower = !matrix;
                    break;
                }
            }
            if follower {
                continue;
            }
            *temporary = temporary.checked_sub(source.len() + 192).ok_or(LIMIT)?;
            let position = (s, r, c);
            columns.entry((s, c)).or_default().push(Group {
                first: position,
                last: r,
                origin: book
                    .formula_origins
                    .get(&position)
                    .copied()
                    .unwrap_or(position),
                source: source.into(),
                matrix,
            });
        }
    }
    let mut expressions = BTreeMap::new();
    let mut tokens = BTreeMap::<usize, BTreeMap<String, (String, u64)>>::new();
    let sheet_names: Vec<_> = sources.iter().map(|(name, _)| name.clone()).collect();
    for cells in columns.into_values() {
        let mut imported: Vec<Group> = Vec::new();
        for cell in cells {
            if let Some(prior) = imported.last_mut()
                && !cell.matrix
                && !prior.matrix
                && prior.last + 1 == cell.first.1
                && raw_groups
                    .get(&prior.first)
                    .is_some_and(|height| cell.first.1 < prior.first.1 + height)
            {
                prior.last = cell.last;
            } else {
                imported.push(cell);
            }
        }
        let mut grouped: Vec<Group> = Vec::new();
        for current in imported {
            let mut equal = false;
            if let Some(previous) = grouped.last()
                && !previous.matrix
                && previous.last + 1 == current.first.1
            {
                let tokens = tokens.entry(current.first.0).or_default();
                for group in [previous, &current] {
                    if !tokens.contains_key(group.source.as_str()) {
                        let output = formula_tokens(
                            &group.source,
                            names,
                            sources,
                            (Some(group.first.0), Some(group.first.0)),
                            (0, 0),
                            Syntax::XlsxGroup,
                            temporary,
                        )
                        .ok_or(LIMIT)?;
                        *temporary = temporary
                            .checked_sub(group.source.len() + output.text.len() + 128)
                            .ok_or(LIMIT)?;
                        tokens.insert(
                            group.source.clone(),
                            (output.text.into_owned(), output.numeric_hash),
                        );
                    }
                }
                if tokens[&previous.source] == tokens[&current.source] {
                    for group in [previous, &current] {
                        if let std::collections::btree_map::Entry::Vacant(entry) =
                            expressions.entry(group.origin)
                        {
                            *temporary = temporary.checked_sub(96).ok_or(LIMIT)?;
                            entry.insert(
                                formulas::xlsx_group_expression(
                                    &group.source,
                                    book,
                                    &sheet_names,
                                    group.origin,
                                    temporary,
                                )
                                .map_err(|_| LIMIT)?,
                            );
                        }
                    }
                    if let (Some(left), Some(right)) = (
                        &expressions[&previous.origin],
                        &expressions[&current.origin],
                    ) {
                        equal = left.same_xlsx_group(right, temporary).ok_or(LIMIT)?;
                    }
                }
            }
            if equal {
                let previous = grouped.last_mut().unwrap();
                // A preceding single joins an existing import-cache group using
                // that group's code. Otherwise the preceding group's code wins.
                if previous.last == previous.first.1 && current.last > current.first.1 {
                    previous.source = current.source;
                    previous.origin = current.origin;
                }
                previous.last = current.last;
            } else {
                grouped.push(current);
            }
        }
        for group in grouped {
            if group.first.1 == group.last {
                continue;
            }
            let (s, first, c) = group.first;
            for r in first..=group.last {
                *temporary = temporary
                    .checked_sub(group.source.len() + 8 + 64)
                    .ok_or(LIMIT)?;
                *work = work.checked_sub(group.source.len() + 8 + 64).ok_or(LIMIT)?;
                let cell = sheets[s].cells.get_mut(&(r, c)).unwrap();
                cell.openformula = Some(format!("msoxl:={}", group.source));
                book.formula_origins.insert((s, r, c), group.origin);
            }
            for array in &mut sheets[s].arrays {
                *temporary = temporary.checked_sub(1).ok_or(LIMIT)?;
                if array.range[1] == c && (first..=group.last).contains(&array.range[0]) {
                    *temporary = temporary.checked_sub(group.source.len() + 8).ok_or(LIMIT)?;
                    *work = work.checked_sub(group.source.len() + 8).ok_or(LIMIT)?;
                    array.openformula = Some(format!("msoxl:={}", group.source));
                }
            }
        }
    }
    Ok(())
}
