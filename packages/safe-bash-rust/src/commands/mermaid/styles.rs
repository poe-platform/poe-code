use super::Statement;
use super::number;
use crate::commands::archive::{css_named_color, parse_color};
use std::collections::{BTreeMap, BTreeSet};

type Color<'a> = (&'a str, [u8; 4]);

#[derive(Default, Clone, Copy)]
pub(super) struct Style<'a> {
    pub fill: Option<Color<'a>>,
    pub stroke: Option<Color<'a>>,
    pub color: Option<Color<'a>>,
    pub width: Option<f64>,
}

impl<'a> Style<'a> {
    fn merge(&mut self, other: Self) {
        self.fill = other.fill.or(self.fill);
        self.stroke = other.stroke.or(self.stroke);
        self.color = other.color.or(self.color);
        self.width = other.width.or(self.width);
    }
    fn parse(text: &'a str) -> Result<Self, String> {
        let mut result = Self::default();
        let mut depth = 0;
        for part in text.split(|ch| {
            match ch {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            ch == ',' && depth == 0
        }) {
            let Some((name, value)) = part.split_once(':') else {
                continue;
            };
            let value = value.trim();
            match name.trim() {
                "fill" => result.fill = Some(css_color(value)?),
                "stroke" => result.stroke = Some(css_color(value)?),
                "color" => result.color = Some(css_color(value)?),
                "stroke-width" => {
                    let width = number(value.strip_suffix("px").unwrap_or(value));
                    if !width.is_finite() || width < 0. {
                        return Err("mmdc: E_SYNTAX: Invalid stroke width\n".into());
                    }
                    result.width = Some(width.abs());
                }
                _ => {}
            }
        }
        Ok(result)
    }
}

pub(in super::super) fn css_color(raw: &str) -> Result<Color<'_>, String> {
    let lower = raw.trim().to_ascii_lowercase();
    let rgba = if let Some(hex) = lower.strip_prefix('#') {
        if !matches!(hex.len(), 3 | 4 | 6 | 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("mmdc: E_CONFIG: Invalid hex color '{raw}'\n"));
        }
        parse_color(&lower)?
    } else if let Some((func, args)) = lower.split_once('(')
        && matches!(func, "rgb" | "rgba")
        && let Some(args) = args.strip_suffix(')')
    {
        let mut parts = args.split(',');
        let mut channels = [255; 4];
        let count = if func == "rgb" { 3 } else { 4 };
        if parts.clone().count() != count {
            return Err(format!("mmdc: E_CONFIG: Invalid RGB/RGBA color '{raw}'\n"));
        }
        for (i, ch) in channels[..count].iter_mut().enumerate() {
            let value = number(parts.next().unwrap());
            let max = if i == 3 { 1. } else { 255. };
            if !(0. ..=max).contains(&value) {
                return Err(format!(
                    "mmdc: E_CONFIG: Out-of-range RGB/RGBA color '{raw}'\n"
                ));
            }
            *ch = (if i == 3 { value * 255. } else { value }).round() as u8;
        }
        channels
    } else if lower == "transparent" {
        [0; 4]
    } else {
        css_named_color(&lower)
            .ok_or_else(|| format!("mmdc: E_CONFIG: Unsupported color format '{raw}'\n"))?
    };
    Ok((raw.trim(), rgba))
}

#[derive(Default)]
pub(super) struct Styles<'a> {
    classes: BTreeMap<&'a str, Style<'a>>,
    nodes: BTreeMap<&'a str, Style<'a>>,
    edges: BTreeMap<&'a str, Style<'a>>,
    assignments: BTreeMap<&'a str, Vec<&'a str>>,
    assigned: BTreeSet<(&'a str, &'a str)>,
    pub(super) budget: usize,
}

impl<'a> Styles<'a> {
    pub(super) fn new(budget: usize) -> Self {
        Self {
            budget,
            ..Self::default()
        }
    }
    pub(super) fn assign(&mut self, id: &'a str, name: &'a str) -> Result<(), String> {
        self.charge(
            std::mem::size_of::<(&str, &str)>()
                .saturating_add(id.len())
                .saturating_add(name.len()),
        )?;
        if self.assigned.insert((id, name)) {
            self.assignments.entry(id).or_default().push(name);
        }
        Ok(())
    }
    fn charge(&mut self, cost: usize) -> Result<(), String> {
        self.budget = self
            .budget
            .checked_sub(cost)
            .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
        Ok(())
    }
    pub(super) fn declaration(
        &mut self,
        keyword: &str,
        text: &'a str,
        stmt: &Statement,
    ) -> Result<(), String> {
        let rest = text[keyword.len()..].trim();
        let targets = rest.split_ascii_whitespace().next().unwrap_or("");
        let value = rest[targets.len()..].trim();
        if targets.is_empty() || value.is_empty() {
            return Err(stmt.error("E_SYNTAX", text, &format!("Missing {keyword} declaration")));
        }
        if keyword == "class" {
            for id in targets.split(',') {
                self.charge(value.len())?;
                for name in value.split(',') {
                    self.assign(id, name.trim())?;
                }
            }
        } else {
            let style = Style::parse(value)?;
            self.charge(
                targets
                    .split(',')
                    .count()
                    .saturating_mul(std::mem::size_of::<(&str, Style)>()),
            )?;
            let table = match keyword {
                "classDef" => &mut self.classes,
                "style" => &mut self.nodes,
                _ => &mut self.edges,
            };
            for id in targets.split(',') {
                table.entry(id).or_default().merge(style);
            }
        }
        Ok(())
    }
    pub(super) fn node(&self, id: &str) -> Style<'a> {
        let mut result = self.classes.get("default").copied().unwrap_or_default();
        for class in self.assignments.get(id).into_iter().flatten() {
            if let Some(style) = self.classes.get(class) {
                result.merge(*style);
            }
        }
        if let Some(style) = self.nodes.get(id) {
            result.merge(*style);
        }
        result
    }
    pub(super) fn edge(&self, index: usize) -> Style<'a> {
        let mut result = self.edges.get("default").copied().unwrap_or_default();
        if !self.edges.is_empty()
            && let Some(style) = self.edges.get(index.to_string().as_str())
        {
            result.merge(*style);
        }
        result
    }
}
