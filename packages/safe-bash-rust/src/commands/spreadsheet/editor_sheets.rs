use super::{
    Spreadsheet, formula_arguments::Syntax, formulas, valid_sheet_name, xlsx_import,
    xlsx_references,
};

impl Spreadsheet {
    pub fn rename_sheet(&mut self, sheet: usize, name: &str, limit: usize) -> Result<(), String> {
        if sheet >= self.sheets.len() {
            return Err("Unknown sheet".into());
        }
        if !valid_sheet_name(name)
            || name.chars().count() > 31
            || self
                .sheets
                .iter()
                .enumerate()
                .any(|(i, s)| i != sheet && super::case_fold::same_name(&s.name, name))
        {
            return Err("Sheet names must be unique and contain 1–31 valid characters".into());
        }
        if self.sheets[sheet].name == name {
            return Ok(());
        }
        let mut next = self.with_sheet_references(sheet, Some(name), limit)?;
        next.sheets[sheet].name = name.into();
        next.spills = formulas::cache(&mut next.sheets, &next.options, None, limit / 2, true)
            .ok_or("Sheet rename exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }

    pub fn delete_sheet(&mut self, sheet: usize, limit: usize) -> Result<(), String> {
        if sheet >= self.sheets.len() {
            return Err("Unknown sheet".into());
        }
        if self.sheets.len() == 1 {
            return Err("Cannot delete the only sheet".into());
        }
        if self
            .options
            .pivots
            .values()
            .any(|p| p.source_binding.is_none() && p.source_sheet == sheet && p.sheet != sheet)
        {
            return Err("Remove pivot tables using this source before deleting its sheet".into());
        }
        let mut next = self.with_sheet_references(sheet, None, limit)?;
        next.sheets.remove(sheet);
        let shift = |s: usize| (s != sheet).then(|| s - usize::from(s > sheet));
        next.options.pivots.retain(|_, pivot| {
            let Some(destination) = shift(pivot.sheet) else {
                return false;
            };
            pivot.sheet = destination;
            pivot.source_sheet = shift(pivot.source_sheet).unwrap_or(0);
            true
        });
        let mut retained_tables = Vec::with_capacity(next.options.tables.len());
        let mut retained_count = 0;
        next.options.tables.retain_mut(|t| {
            if let Some(s) = shift(t.sheet) {
                t.sheet = s;
                retained_tables.push(Some(retained_count));
                retained_count += 1;
                true
            } else {
                retained_tables.push(None);
                false
            }
        });
        next.options.conditional_formats.retain_mut(|rule| {
            if let Some(s) = shift(rule.sheet) {
                rule.sheet = s;
                true
            } else {
                false
            }
        });
        let mut retained_names = Vec::with_capacity(next.options.names.len());
        let mut retained_count = 0;
        next.options.names.retain_mut(|n| {
            if n.sheet == Some(sheet) {
                retained_names.push(None);
                return false;
            }
            retained_names.push(Some(retained_count));
            retained_count += 1;
            n.sheet = n.sheet.and_then(shift);
            n.position.0 = shift(n.position.0).unwrap_or(0);
            true
        });
        for pivot in next.options.pivots.values_mut() {
            pivot.source_binding = pivot.source_binding.map(|binding| match binding {
                super::PivotSource::Name(i) => retained_names
                    .get(i)
                    .copied()
                    .flatten()
                    .map_or(super::PivotSource::Missing, super::PivotSource::Name),
                super::PivotSource::Table(i) => retained_tables
                    .get(i)
                    .copied()
                    .flatten()
                    .map_or(super::PivotSource::Missing, super::PivotSource::Table),
                super::PivotSource::Missing => super::PivotSource::Missing,
            });
        }
        for name in &mut next.options.names {
            if let Some(compiled) = &mut name.compiled {
                for binding in compiled.bindings.values_mut() {
                    *binding = binding.and_then(|i| retained_names.get(i).copied().flatten());
                }
            }
        }
        next.options.name_dependencies.clear();
        next.options.name_uses.clear();
        next.options.uninterned_arrays = next
            .options
            .uninterned_arrays
            .into_iter()
            .filter_map(|(s, r, c)| Some((shift(s)?, r, c)))
            .collect();
        next.options.explicit_formula_styles = next
            .options
            .explicit_formula_styles
            .into_iter()
            .filter_map(|(s, r, c)| Some((shift(s)?, r, c)))
            .collect();
        next.spills = formulas::cache(&mut next.sheets, &next.options, None, limit / 2, true)
            .ok_or("Sheet deletion exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }

    // Structural changes are rare and must be atomic across formulas, names,
    // arrays and workbook metadata. Ordinary cell edits retain their sparse
    // transaction path. The JSON decoder bounds the temporary workbook.
    fn with_sheet_references(
        &self,
        changed: usize,
        replacement: Option<&str>,
        limit: usize,
    ) -> Result<Self, String> {
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let names: Vec<_> = self.sheets.iter().map(|s| s.name.clone()).collect();
        let sources: Vec<_> = names.iter().map(|s| (s.clone(), String::new())).collect();
        let mut work = limit / 2;
        let mut rewrite = |expression: &str,
                           original: Option<&str>,
                           scope: usize,
                           offset: (i64, i64),
                           compiled: bool|
         -> Result<String, String> {
            if original.is_some_and(|s| s.starts_with("of:=")) {
                return Err("Sheet changes for OpenFormula documents are not supported yet".into());
            }
            let source = original
                .and_then(|s| s.strip_prefix("msoxl:="))
                .unwrap_or(expression);
            // Imported symbols may intentionally bind a different name with the
            // same spelling. Token normalization would erase that distinction.
            let source = if compiled {
                std::borrow::Cow::Borrowed(source)
            } else {
                xlsx_import::formula_tokens(
                    source,
                    &self.options.names,
                    &sources,
                    (Some(scope), Some(scope)),
                    offset,
                    Syntax::Editor,
                    &mut work,
                )
                .ok_or("Sheet change exceeds its formula limit")?
                .text
            };
            let (formula, _) = xlsx_references::map_sheet_references(
                &source,
                &names
                    .iter()
                    .enumerate()
                    .map(|(i, name)| {
                        (
                            name.as_str(),
                            if i == changed {
                                replacement
                            } else {
                                Some(name.as_str())
                            },
                        )
                    })
                    .collect::<Vec<_>>(),
                &mut work,
            )
            .ok_or("Sheet change exceeds its formula limit")?;
            if replacement.is_none() {
                let tables: Vec<_> = self
                    .options
                    .tables
                    .iter()
                    .filter(|t| t.sheet == changed)
                    .map(|t| super::TableReferenceMap {
                        name: &t.name,
                        replacement: None,
                        columns: Vec::new(),
                        local: false,
                    })
                    .collect();
                super::map_table_references(&formula, &tables, &mut work)
                    .map(|(formula, _)| formula)
                    .ok_or_else(|| "Sheet change exceeds its table-reference limit".into())
            } else {
                Ok(formula)
            }
        };
        for (s, sheet) in next.sheets.iter_mut().enumerate() {
            if replacement.is_none() && s == changed {
                continue;
            }
            for (&(r, c), cell) in &mut sheet.cells {
                let Some(formula) = &cell.formula else {
                    continue;
                };
                let (_, or, oc) = self
                    .options
                    .formula_origins
                    .get(&(s, r, c))
                    .copied()
                    .unwrap_or((s, r, c));
                let formula = rewrite(
                    formula,
                    cell.openformula.as_deref(),
                    s,
                    (r as i64 - or as i64, c as i64 - oc as i64),
                    false,
                )?;
                if let Some(display) = &cell.formula_display {
                    cell.formula_display = Some(rewrite(display, None, s, (0, 0), false)?);
                }
                cell.openformula = Some(format!("msoxl:={formula}"));
                cell.formula = Some(formula);
                cell.value = None;
                cell.value_format = None;
            }
            for group in &mut sheet.arrays {
                let [r, c, _, _] = group.range;
                let (_, or, oc) = self
                    .options
                    .formula_origins
                    .get(&(s, r, c))
                    .copied()
                    .unwrap_or((s, r, c));
                group.expression = rewrite(
                    &group.expression,
                    group.openformula.as_deref(),
                    s,
                    (r as i64 - or as i64, c as i64 - oc as i64),
                    false,
                )?;
                group.openformula = Some(format!("msoxl:={}", group.expression));
                if let Some(display) = &group.formula_display {
                    group.formula_display = Some(rewrite(display, None, s, (0, 0), false)?);
                }
            }
        }
        for name in &mut next.options.names {
            if replacement.is_none() && name.sheet == Some(changed) {
                continue;
            }
            name.expression = rewrite(
                &name.expression,
                name.openformula.as_deref(),
                name.sheet.unwrap_or(0),
                (0, 0),
                false,
            )?;
            name.openformula = Some(format!("msoxl:={}", name.expression));
            if let Some(compiled) = &mut name.compiled {
                compiled.expression = format!(
                    "msoxl:={}",
                    rewrite(
                        &compiled.expression,
                        Some(&compiled.expression),
                        name.sheet.unwrap_or(0),
                        (0, 0),
                        true,
                    )?
                );
            }
        }
        for table in &mut next.options.tables {
            if replacement.is_none() && table.sheet == changed {
                continue;
            }
            for definition in table.calculated_columns.values_mut() {
                definition.formula =
                    rewrite(&definition.formula, None, table.sheet, (0, 0), false)?;
            }
        }
        for rule in &mut next.options.conditional_formats {
            if replacement.is_none() && rule.sheet == changed {
                continue;
            }
            for source in rule.rule.formulas_mut() {
                *source = rewrite(source, None, rule.sheet, (0, 0), false)?;
            }
        }
        next.options.formula_origins.clear();
        Ok(next)
    }
}
