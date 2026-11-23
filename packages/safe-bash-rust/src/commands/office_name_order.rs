use std::collections::BTreeSet;

pub(in crate::commands::archive) struct Name {
    pub(in crate::commands::archive) key: String,
    pub(in crate::commands::archive) scope: Option<usize>,
    pub(in crate::commands::archive) dependencies: Vec<usize>,
    pub(in crate::commands::archive) relative: bool,
}

struct Export<'a> {
    names: &'a [Name],
    created: BTreeSet<(Option<usize>, &'a str)>,
    output: Vec<(usize, Option<usize>)>,
}

const LIMIT: &str = "Error: conversion failed: worksheet exceeds byte limit\n";

impl Export<'_> {
    fn create(
        &mut self,
        index: usize,
        local: Option<usize>,
        current: Option<usize>,
        work: &mut usize,
    ) -> Result<(), &'static str> {
        // Register before visiting dependencies, including recursive aliases.
        let mut pending = vec![(index, local, true)];
        while let Some((index, local, force)) = pending.pop() {
            let name = &self.names[index];
            *work = work.checked_sub(name.key.len() + 64).ok_or(LIMIT)?;
            let lookup = if name.scope.is_none() && name.relative {
                current
            } else {
                name.scope
            };
            if !force && self.created.contains(&(lookup, name.key.as_str())) {
                continue;
            }
            if self.output.len() == usize::from(u16::MAX) {
                return Err(LIMIT);
            }
            *work = work
                .checked_sub(std::mem::size_of::<(usize, Option<usize>)>())
                .ok_or(LIMIT)?;
            self.output.push((index, local));
            self.created.insert((local, name.key.as_str()));
            for &dependency in name.dependencies.iter().rev() {
                *work = work
                    .checked_sub(std::mem::size_of::<(usize, Option<usize>, bool)>())
                    .ok_or(LIMIT)?;
                pending.push((dependency, self.names[dependency].scope, false));
            }
        }
        Ok(())
    }
}

pub(in crate::commands::archive) fn order(
    names: &[Name],
    sheets: usize,
    used: &[(usize, usize)],
    work: &mut usize,
) -> Result<Vec<(usize, Option<usize>)>, &'static str> {
    let sorting = names
        .iter()
        .try_fold(0usize, |total, name| total.checked_add(name.key.len() + 64))
        .and_then(|total| {
            total.checked_mul(2 * (names.len().checked_ilog2().unwrap_or(0) as usize + 1))
        })
        .ok_or(LIMIT)?;
    *work = work.checked_sub(sorting).ok_or(LIMIT)?;
    *work = work
        .checked_sub(
            names.len() * (std::mem::size_of::<(usize, String)>() + std::mem::size_of::<usize>()),
        )
        .ok_or(LIMIT)?;
    let mut order = names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            super::collation::uppercase(&name.key, work)
                .map(|key| (index, key))
                .ok_or(LIMIT)
        })
        .collect::<Result<Vec<_>, _>>()?;
    order.sort_by(|(a, key_a), (b, key_b)| {
        names[*a]
            .scope
            .cmp(&names[*b].scope)
            .then_with(|| key_a.encode_utf16().cmp(key_b.encode_utf16()))
    });
    let mut export = Export {
        names,
        created: BTreeSet::new(),
        output: Vec::new(),
    };
    let mut deferred = Vec::new();
    for (index, _) in order {
        let name = &names[index];
        *work = work.checked_sub(name.key.len() + 64).ok_or(LIMIT)?;
        if export.created.contains(&(name.scope, name.key.as_str())) {
            continue;
        }
        if name.scope.is_none() && name.relative {
            deferred.push(index);
        } else {
            export.create(index, name.scope, None, work)?;
        }
    }
    for sheet in 0..sheets {
        for &index in &deferred {
            let name = &names[index];
            *work = work.checked_sub(name.key.len() + 64).ok_or(LIMIT)?;
            if !export.created.contains(&(Some(sheet), name.key.as_str())) {
                export.create(index, Some(sheet), None, work)?;
            }
        }
    }
    for &(sheet, index) in used {
        let name = &names[index];
        let lookup = if name.scope.is_none() && name.relative {
            Some(sheet)
        } else {
            name.scope
        };
        *work = work.checked_sub(name.key.len() + 64).ok_or(LIMIT)?;
        if !export.created.contains(&(lookup, name.key.as_str())) {
            export.create(index, name.scope, Some(sheet), work)?;
        }
    }
    Ok(export.output)
}
