use super::super::super::name_order;
use super::super::{FormulaTokens, formula_tokens};
use super::{INVALID, LIMIT, Syntax, attr, xml};

pub(super) struct Names<'a> {
    pub(super) labels: &'a [crate::commands::spreadsheet::model::NamedExpression],
    pub(super) used: Vec<(usize, usize)>,
}

struct Definition {
    element: xml::Element,
    formula: String,
    reference: Option<(super::super::super::xlsx_references::Reference, usize)>,
}

impl Names<'_> {
    pub(super) fn export(
        &self,
        container: &mut xml::Element,
        sheets: &[(String, String)],
        work: &mut usize,
    ) -> Result<(), &'static str> {
        let mut definitions = Vec::new();
        let mut metadata = Vec::new();
        for node in std::mem::take(&mut container.children) {
            let xml::Node::Element(mut element) = node else {
                continue;
            };
            if element.tag.rsplit(':').next() != Some("definedName") {
                continue;
            }
            let Some(label) = attr(&element, "name") else {
                continue;
            };
            let scope = attr(&element, "localSheetId").and_then(|s| s.parse().ok());
            let source = super::super::text(&element);
            *work = work
                .checked_sub(
                    source.len()
                        + label.len() * 3
                        + std::mem::size_of::<Definition>()
                        + std::mem::size_of::<name_order::Name>(),
                )
                .ok_or(LIMIT)?;
            let key = super::super::super::case_fold::sheet_key(label);
            let FormulaTokens {
                text,
                names,
                relative,
                first_reference,
                ..
            } = formula_tokens(
                source.trim(),
                self.labels,
                sheets,
                (scope, Some(0)),
                (0, 0),
                Syntax::Xlsx,
                work,
            )
            .ok_or(LIMIT)?;
            let formula = text.into_owned();
            element.children.clear();
            definitions.push(Definition {
                element,
                formula,
                reference: first_reference,
            });
            metadata.push(name_order::Name {
                key,
                scope,
                dependencies: names,
                relative,
            });
        }
        if definitions.len() != self.labels.len() {
            return Err(INVALID);
        }
        let order = name_order::order(&metadata, sheets.len(), &self.used, work)?;
        let mut output = Vec::new();
        for (index, local) in order {
            let definition = &definitions[index];
            let size = definition.element.tag.len()
                + definition.formula.len()
                + definition
                    .element
                    .attrs
                    .iter()
                    .map(|(k, v)| k.len() + v.len() + 64)
                    .sum::<usize>()
                + std::mem::size_of::<xml::Element>()
                + 128;
            *work = work.checked_sub(size).ok_or(LIMIT)?;
            let mut formula = definition.formula.clone();
            if metadata[index].relative
                && let Some(sheet) = local
            {
                *work = work
                    .checked_sub(sheets[sheet].0.len() * 2 + 3)
                    .ok_or(LIMIT)?;
                if let Some((reference, end)) = definition.reference {
                    for (name, _) in sheets {
                        *work = work.checked_sub(name.len() * 3 + 1).ok_or(LIMIT)?;
                    }
                    let prefix = reference
                        .render(
                            sheets.iter().map(|s| &s.0),
                            (metadata[index].scope.unwrap_or(0), sheet),
                            (0, 0),
                            true,
                            Syntax::Xlsx,
                        )
                        .unwrap_or_else(|| "#REF!".into());
                    formula.replace_range(..end, &prefix);
                } else {
                    let prefix = super::super::super::sheet_name::quote_sheet(&sheets[sheet].0);
                    formula.insert_str(0, &format!("{prefix}!"));
                }
            }
            let mut element = xml::Element {
                namespace: String::new(),
                self_closing: false,
                tag: definition.element.tag.clone(),
                attrs: definition.element.attrs.clone(),
                children: vec![xml::Node::Text(formula, None)],
            };
            element.attrs.retain(|(key, _)| key != "localSheetId");
            if let Some(sheet) = local {
                element
                    .attrs
                    .push(("localSheetId".into(), sheet.to_string()));
            }
            output.push(xml::Node::Element(element));
        }
        container.children = output;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_sheet_name_expansion_obeys_the_work_budget() {
        let source = "<definedNames><definedName name=\"Relative\">A1</definedName></definedNames>";
        let names = Names {
            labels: &[crate::commands::spreadsheet::model::NamedExpression {
                name: "Relative".into(),
                sheet: None,
                expression: "A1".into(),
                openformula: None,
                position: (0, 0, 0),
                compiled: None,
            }],
            used: Vec::new(),
        };
        let sheets = (0..1000)
            .map(|i| (format!("Sheet{i}"), String::new()))
            .collect::<Vec<_>>();
        for (limit, success) in [(4096, false), (2_000_000, true)] {
            let mut doc = xml::parse(source, None, None).unwrap();
            let xml::Node::Element(container) = &mut doc.nodes[0] else {
                panic!("names");
            };
            let result = names.export(container, &sheets, &mut { limit });
            assert_eq!(result.is_ok(), success);
            if success {
                assert_eq!(container.children.len(), 1000);
                let xml::Node::Element(last) = container.children.last().unwrap() else {
                    panic!("name");
                };
                assert_eq!(attr(last, "localSheetId"), Some("999"));
                assert_eq!(super::super::super::text(last), "Sheet999!A1");
            } else {
                assert_eq!(result.unwrap_err(), LIMIT);
            }
        }
    }
}
