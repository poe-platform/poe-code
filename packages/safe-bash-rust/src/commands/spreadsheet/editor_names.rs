use super::{NamedExpression, Spreadsheet, case_fold, formulas};
use std::collections::BTreeMap;

fn rename_bindings(
    bindings: &mut BTreeMap<String, Option<usize>>,
    index: usize,
    replacement: &str,
) {
    let before = bindings.len();
    bindings.retain(|_, bound| *bound != Some(index));
    if bindings.len() != before {
        bindings.insert(replacement.into(), Some(index));
    }
}

impl Spreadsheet {
    /// Create or replace a named expression and recalculate once. Renames use
    /// resolved AST identities, preserving local variables and other scopes.
    pub fn set_named_expression(
        &mut self,
        index: Option<usize>,
        mut definition: NamedExpression,
        limit: usize,
    ) -> Result<usize, String> {
        if index.is_some_and(|i| i >= self.options.names.len()) {
            return Err("Unknown named expression".into());
        }
        if !super::editor_tables::valid_table_name(&definition.name)
            || ["TRUE", "FALSE"]
                .iter()
                .any(|n| definition.name.eq_ignore_ascii_case(n))
            || self.options.names.iter().enumerate().any(|(i, n)| {
                Some(i) != index
                    && n.sheet == definition.sheet
                    && case_fold::same_name(&n.name, &definition.name)
            })
            || self
                .options
                .tables
                .iter()
                .any(|t| case_fold::same_name(&t.name, &definition.name))
        {
            return Err("Names must be unique in their scope and cannot be cell references or contain spaces".into());
        }
        if definition.sheet.is_some_and(|s| s >= self.sheets.len())
            || definition.position.0 >= self.sheets.len()
            || !(-1_048_576..1_048_576).contains(&definition.position.1)
            || !(-16_384..16_384).contains(&definition.position.2)
        {
            return Err("Invalid named expression scope or position".into());
        }
        let mut work = limit / 2;
        let sheets: Vec<_> = self.sheets.iter().map(|s| s.name.clone()).collect();
        let source = definition
            .openformula
            .as_deref()
            .unwrap_or(&definition.expression);
        if !formulas::name_references(
            source,
            &sheets,
            &self.options.names,
            &self.options.tables,
            definition.position,
            definition.sheet,
            None,
            &mut work,
        )?
        .1
        {
            return Err("Invalid named expression formula".into());
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        definition.compiled = index.and_then(|i| {
            let old = &self.options.names[i];
            (old.expression == definition.expression
                && old.openformula == definition.openformula
                && old.position == definition.position
                && old.sheet == definition.sheet)
                .then(|| old.compiled.clone())
                .flatten()
        });
        let target = index.unwrap_or(next.options.names.len());
        let rename = index.filter(|&i| self.options.names[i].name != definition.name);
        if let Some(index) = index {
            next.options.names[index] = definition;
        } else {
            next.options.names.push(definition);
        }
        if let Some(index) = rename {
            let replacement = next.options.names[target].name.clone();
            let renamed = next.options.names.clone();
            let mut rewrite = |source: &mut String,
                               position,
                               scope,
                               bindings: Option<&BTreeMap<String, Option<usize>>>|
             -> Result<(), String> {
                let (tokens, _) = formulas::name_references(
                    source,
                    &sheets,
                    &self.options.names,
                    &self.options.tables,
                    position,
                    scope,
                    bindings,
                    &mut work,
                )?;
                if !tokens.iter().any(|t| t.2 == Some(index)) {
                    return Ok(());
                }
                let mut expected = Vec::with_capacity(tokens.len());
                let mut shift = 0isize;
                for &(start, length, resolved) in &tokens {
                    let offset = start
                        .checked_add_signed(shift)
                        .ok_or("Invalid named expression token")?;
                    if resolved == Some(index) {
                        expected.push((offset, replacement.len(), resolved));
                        shift += replacement.len() as isize - length as isize;
                    } else {
                        expected.push((offset, length, resolved));
                    }
                }
                for (start, length, _) in tokens.into_iter().rev().filter(|t| t.2 == Some(index)) {
                    work = work
                        .checked_sub(replacement.len())
                        .ok_or("Name rename exceeds its limit")?;
                    if !source.get(start..start + length).is_some_and(|token| {
                        bindings.is_some_and(|b| b.get(token) == Some(&Some(index)))
                            || case_fold::same_name(token, &self.options.names[index].name)
                    }) {
                        return Err("Cannot safely rename this named expression token".into());
                    }
                    source.replace_range(start..start + length, &replacement);
                }
                let mut updated_bindings = bindings.cloned();
                if let Some(bindings) = &mut updated_bindings {
                    rename_bindings(bindings, index, &replacement);
                }
                let (resolved, _) = formulas::name_references(
                    source,
                    &sheets,
                    &renamed,
                    &self.options.tables,
                    position,
                    scope,
                    updated_bindings.as_ref(),
                    &mut work,
                )?;
                if expected
                    .iter()
                    .any(|token| resolved.binary_search(token).is_err())
                {
                    return Err("This rename would change a formula's name scope or capture a local variable".into());
                }
                Ok(())
            };
            for (s, sheet) in next.sheets.iter_mut().enumerate() {
                for (&(r, c), cell) in &mut sheet.cells {
                    for source in [
                        &mut cell.formula,
                        &mut cell.openformula,
                        &mut cell.formula_display,
                    ]
                    .into_iter()
                    .flatten()
                    {
                        rewrite(source, (s, r as i64, c as i64), Some(s), None)?;
                    }
                }
                for array in &mut sheet.arrays {
                    let position = (s, array.range[0] as i64, array.range[1] as i64);
                    rewrite(&mut array.expression, position, Some(s), None)?;
                    for source in [&mut array.openformula, &mut array.formula_display]
                        .into_iter()
                        .flatten()
                    {
                        rewrite(source, position, Some(s), None)?;
                    }
                }
            }
            for name in &mut next.options.names {
                let bindings = name.compiled.as_ref().map(|c| &c.bindings);
                rewrite(&mut name.expression, name.position, name.sheet, bindings)?;
                if let Some(source) = &mut name.openformula {
                    rewrite(source, name.position, name.sheet, bindings)?;
                }
                if let Some(compiled) = &mut name.compiled {
                    rewrite(
                        &mut compiled.expression,
                        name.position,
                        name.sheet,
                        Some(&compiled.bindings),
                    )?;
                    rename_bindings(&mut compiled.bindings, index, &replacement);
                }
            }
            for table in &mut next.options.tables {
                for (column, definition) in &mut table.calculated_columns {
                    rewrite(
                        &mut definition.formula,
                        (
                            table.sheet,
                            (table.area[0] + usize::from(table.header)) as i64,
                            (table.area[1] + column) as i64,
                        ),
                        Some(table.sheet),
                        None,
                    )?;
                }
            }
            for rule in &mut next.options.conditional_formats {
                let (row, column) = rule.anchor().unwrap_or((0, 0));
                for source in rule.rule.formulas_mut() {
                    rewrite(
                        source,
                        (rule.sheet, row as i64, column as i64),
                        Some(rule.sheet),
                        None,
                    )?;
                }
            }
        }
        next.options.name_dependencies.clear();
        next.options.name_uses.clear();
        next.spills = formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or("Named expression exceeds its calculation limit")?;
        *self = next;
        Ok(target)
    }

    /// Delete one definition without replacing references by cached values.
    pub fn remove_named_expression(&mut self, index: usize, limit: usize) -> Result<(), String> {
        if index >= self.options.names.len() {
            return Err("Unknown named expression".into());
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        next.options.names.remove(index);
        for pivot in next.options.pivots.values_mut() {
            if let Some(super::PivotSource::Name(bound)) = pivot.source_binding {
                pivot.source_binding = Some(if bound == index {
                    super::PivotSource::Missing
                } else {
                    super::PivotSource::Name(bound - usize::from(bound > index))
                });
            }
        }
        for name in &mut next.options.names {
            if let Some(compiled) = &mut name.compiled {
                for bound in compiled.bindings.values_mut() {
                    *bound = bound.and_then(|i| (i != index).then(|| i - usize::from(i > index)));
                }
            }
        }
        next.options.name_dependencies.clear();
        next.options.name_uses.clear();
        next.spills = formulas::cache(&mut next.sheets, &next.options, None, limit / 2, true)
            .ok_or("Named expression deletion exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }
}
