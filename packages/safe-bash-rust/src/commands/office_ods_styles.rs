use super::appearance;
use super::{INVALID, LIMIT, attr, count};
use crate::commands::structured::{
    xlsx::{Axis, Style},
    xml::{Element, Node},
};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// Keep references into the parsed package; resolve inheritance only when used.
#[derive(Clone)]
struct Resolved<'a> {
    format: Option<&'a str>,
    style: Arc<Style>,
    size: Option<f64>,
}
pub(super) struct Styles<'a> {
    nodes: BTreeMap<(&'a str, &'a str), (&'a Element, bool)>,
    formats: BTreeMap<&'a str, String>,
    resolved: BTreeMap<(&'a str, &'a str), Resolved<'a>>,
    default_style: Option<Arc<Style>>,
    remaining: usize,
    default: Option<&'a Element>,
}
impl<'a> Styles<'a> {
    pub fn read(roots: &[&'a Element], legacy: bool, limit: usize) -> Result<Self, String> {
        let mut result = Self {
            nodes: BTreeMap::new(),
            formats: BTreeMap::new(),
            resolved: BTreeMap::new(),
            default: None,
            default_style: None,
            remaining: limit,
        };
        let mut remaining = limit;
        for root in roots {
            for node in &root.children {
                let Node::Element(container) = node else {
                    continue;
                };
                let common =
                    root.tag == "office:document-styles" && container.tag == "office:styles";
                if !common && container.tag != "office:automatic-styles" {
                    continue;
                }
                for node in &container.children {
                    let Node::Element(el) = node else { continue };
                    remaining = remaining.checked_sub(64).ok_or(LIMIT)?;
                    if common
                        && el.tag == "style:default-style"
                        && attr(el, "style:family") == Some("table-cell")
                    {
                        result.default = Some(el);
                    }
                    let Some(name) = attr(el, "style:name").filter(|s| !s.is_empty()) else {
                        continue;
                    };
                    if el.tag == "style:style"
                        && let Some(
                            family @ ("table-cell" | "table-row" | "table-column" | "table"),
                        ) = attr(el, "style:family")
                    {
                        result.nodes.insert(
                            (family, name),
                            (el, legacy || root.tag == "office:document-styles"),
                        );
                    }
                    if matches!(
                        el.tag.as_str(),
                        "number:number-style"
                            | "number:currency-style"
                            | "number:percentage-style"
                            | "number:date-style"
                            | "number:time-style"
                            | "number:boolean-style"
                            | "number:text-style"
                    ) {
                        let format = number_format(el, remaining)?;
                        remaining = remaining.checked_sub(format.len()).ok_or(LIMIT)?;
                        result.formats.insert(name, format);
                    }
                }
            }
        }
        result.default_style = result
            .default
            .map(|node| appearance::read(node, true, None, &mut remaining))
            .transpose()?;
        result.remaining = remaining;
        Ok(result)
    }
    pub fn resolve(&mut self, name: Option<&str>) -> Result<Option<(&str, Arc<Style>)>, String> {
        let Some(resolved) = self.resolve_named(name, "table-cell")? else {
            let format = self
                .default
                .and_then(|node| attr(node, "style:data-style-name"))
                .and_then(|name| self.formats.get(name))
                .map_or("General", String::as_str);
            return Ok(self
                .default_style
                .as_ref()
                .map(|style| (format, style.clone())));
        };
        Ok(Some((
            resolved
                .format
                .and_then(|n| self.formats.get(n))
                .map_or("General", String::as_str),
            resolved.style,
        )))
    }
    pub fn axis(
        &mut self,
        node: &Element,
        family: &str,
        level: usize,
    ) -> Result<Option<Axis>, String> {
        let resolved = self.resolve_named(attr(node, "table:style-name"), family)?;
        let hidden = attr(node, "table:visibility").is_some_and(|v| v != "visible");
        Ok((resolved.is_some() || hidden || level > 0).then(|| Axis {
            size: resolved.as_ref().and_then(|r| r.size),
            style: resolved.map(|r| r.style),
            hidden,
            level,
        }))
    }
    pub fn view(&mut self, name: Option<&str>) -> Result<Vec<(&'static str, bool)>, String> {
        let Some((node, generic)) = name.and_then(|n| self.nodes.get(&("table", n))).copied()
        else {
            return Ok(Vec::new());
        };
        // Validate inheritance even though the retained ODF view uses this style's
        // own properties. Parent view properties do not replace missing fields.
        self.resolve_named(name, "table")?;
        let properties = node.children.iter().find_map(|n| match n {
            Node::Element(e) if !generic && e.tag == "style:table-properties" => Some(e),
            _ => None,
        });
        let mut view = Vec::new();
        for (source, target) in [
            ("gnm:display-formulas", "showFormulas"),
            ("gnm:display-col-header", "showRowColHeaders"),
        ] {
            if let Some(value) = properties.and_then(|p| attr(p, source)) {
                view.push((target, value == "true"));
            }
        }
        view.push((
            "rightToLeft",
            properties.and_then(|p| attr(p, "style:writing-mode")) == Some("rl-tb"),
        ));
        Ok(view)
    }
    fn resolve_named(
        &mut self,
        name: Option<&str>,
        family: &str,
    ) -> Result<Option<Resolved<'a>>, String> {
        let Some((mut node, mut generic)) =
            name.and_then(|n| self.nodes.get(&(family, n))).copied()
        else {
            return Ok(None);
        };
        let mut path = Vec::new();
        let mut seen = BTreeSet::new();
        let mut inherited = None;
        loop {
            let name = attr(node, "style:name").unwrap();
            if let Some(cached) = self.resolved.get(&(family, name)) {
                inherited = Some(cached.clone());
                break;
            }
            if !seen.insert(name) {
                return Err(format!("{INVALID}cyclic style inheritance"));
            }
            path.push((node, generic));
            let Some(parent) =
                attr(node, "style:parent-style-name").and_then(|n| self.nodes.get(&(family, n)))
            else {
                break;
            };
            (node, generic) = *parent;
        }
        for (node, generic) in path.into_iter().rev() {
            let format = attr(node, "style:data-style-name")
                .filter(|n| self.formats.contains_key(n))
                .or_else(|| inherited.as_ref().and_then(|r| r.format));
            let style = appearance::read(
                node,
                generic,
                inherited.as_ref().map(|r| r.style.as_ref()),
                &mut self.remaining,
            )?;
            let property = match family {
                "table-row" => Some(("style:table-row-properties", "style:row-height")),
                "table-column" => Some(("style:table-column-properties", "style:column-width")),
                _ => None,
            };
            let size = property
                .and_then(|(tag, attribute)| {
                    node.children
                        .iter()
                        .find_map(|n| match n {
                            Node::Element(e)
                                if e.tag == tag || generic && e.tag == "style:properties" =>
                            {
                                Some(e)
                            }
                            _ => None,
                        })
                        .and_then(|p| appearance::distance(attr(p, attribute)))
                })
                .or_else(|| inherited.as_ref().and_then(|r| r.size));
            let resolved = Resolved {
                format,
                style,
                size,
            };
            self.resolved.insert(
                (
                    attr(node, "style:family").unwrap(),
                    attr(node, "style:name").unwrap(),
                ),
                resolved.clone(),
            );
            inherited = Some(resolved);
        }
        Ok(inherited)
    }
}
fn number_format(node: &Element, limit: usize) -> Result<String, String> {
    let mut out = String::new();
    for n in &node.children {
        let Node::Element(el) = n else { continue };
        let long = attr(el, "number:style") == Some("long");
        match el.tag.as_str() {
            "number:text" | "number:currency-symbol" => {
                out.push('"');
                for n in &el.children {
                    if let Node::Text(s, _) | Node::Cdata(s) = n {
                        for c in s.chars() {
                            out.push(c);
                            if c == '"' {
                                out.push(c);
                            }
                        }
                    }
                }
                out.push('"');
            }
            "number:number" | "number:scientific-number" => {
                let digits = count(attr(el, "number:decimal-places").or(Some("0")))?;
                let minimum = count(attr(el, "number:min-integer-digits"))?;
                if digits.saturating_add(minimum) > limit.saturating_sub(out.len()) {
                    return Err(LIMIT.into());
                }
                if attr(el, "number:grouping") == Some("true") {
                    out.push_str("#,##");
                }
                out.extend(std::iter::repeat_n('0', minimum));
                if digits > 0 {
                    out.push('.');
                    out.extend(std::iter::repeat_n('0', digits));
                }
                if el.tag == "number:scientific-number" {
                    let digits = count(attr(el, "number:min-exponent-digits").or(Some("2")))?;
                    if digits > limit.saturating_sub(out.len()) {
                        return Err(LIMIT.into());
                    }
                    out.push_str("E+");
                    out.extend(std::iter::repeat_n('0', digits));
                }
            }
            "number:day" => out.push_str(if long { "dd" } else { "d" }),
            "number:month" => out.push_str(if attr(el, "number:textual") == Some("true") {
                if long { "mmmm" } else { "mmm" }
            } else if long {
                "mm"
            } else {
                "m"
            }),
            "number:year" => out.push_str(if long { "yyyy" } else { "yy" }),
            "number:day-of-week" => out.push_str(if long { "dddd" } else { "ddd" }),
            "number:hours" => out.push_str(
                if attr(node, "number:truncate-on-overflow") == Some("false") {
                    "[h]"
                } else if long {
                    "hh"
                } else {
                    "h"
                },
            ),
            "number:minutes" => out.push_str(if long { "mm" } else { "m" }),
            "number:seconds" => out.push_str(if long { "ss" } else { "s" }),
            "number:am-pm" => out.push_str("AM/PM"),
            "number:text-content" => out.push('@'),
            _ => {}
        }
        if out.len() > limit {
            return Err(LIMIT.into());
        }
    }
    if out.is_empty() {
        if limit < 7 {
            return Err(LIMIT.into());
        }
        out.push_str("General");
    }
    Ok(out)
}

pub(super) fn axis_child(parent: &str, child: &str, legacy: bool) -> bool {
    match parent {
        "table:table" => {
            !legacy
                || !matches!(
                    child,
                    "table:table-rows"
                        | "table:table-columns"
                        | "table:table-header-rows"
                        | "table:table-header-columns"
                )
        }
        "table:table-row-group" => matches!(child, "table:table-row" | "table:table-row-group"),
        "table:table-column-group" => {
            matches!(child, "table:table-column" | "table:table-column-group")
                || !legacy && child == "table:table-header-columns"
        }
        "table:table-rows" | "table:table-header-rows" => child == "table:table-row",
        "table:table-columns" | "table:table-header-columns" => child == "table:table-column",
        _ => false,
    }
}
pub(super) fn column_defaults<'a>(
    table: &'a Element,
    styles: &mut Styles<'_>,
    axes: &mut BTreeMap<usize, Axis>,
    remaining: &mut usize,
    legacy: bool,
) -> Result<Vec<(usize, usize, &'a str)>, String> {
    let mut defaults = Vec::new();
    let mut column = 0;
    let mut pending: Vec<_> = table
        .children
        .iter()
        .rev()
        .map(|n| (n, 0usize, table.tag.as_str()))
        .collect();
    while let Some((node, level, parent)) = pending.pop() {
        let Node::Element(el) = node else { continue };
        if !axis_child(parent, &el.tag, legacy) {
            continue;
        }
        if matches!(
            el.tag.as_str(),
            "table:table-column-group" | "table:table-header-columns" | "table:table-columns"
        ) {
            let level = level + usize::from(el.tag == "table:table-column-group");
            pending.extend(
                el.children
                    .iter()
                    .rev()
                    .map(|n| (n, level, el.tag.as_str())),
            );
        }
        if el.tag != "table:table-column" {
            continue;
        }
        let repeat = count(attr(el, "table:number-columns-repeated"))?;
        if repeat > 16384 - column {
            return Err("ssconvert OpenDocument column extent limit exceeded".into());
        }
        if let Some(axis) = styles.axis(el, "table-column", level)? {
            if repeat != 0 && axis.size.is_some_and(|n| !n.is_finite()) {
                return Err("Invalid axis size".into());
            }
            *remaining = remaining
                .checked_sub(
                    repeat
                        .checked_mul(std::mem::size_of::<Axis>() + 32)
                        .ok_or(LIMIT)?,
                )
                .ok_or(LIMIT)?;
            for i in column..column + repeat {
                axes.insert(i, axis.clone());
            }
        }
        if let Some(name) = attr(el, "table:default-cell-style-name") {
            defaults.push((column, column + repeat, name));
        }
        column += repeat;
    }
    Ok(defaults)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root(styles: &str) -> Element {
        super::super::document(&format!(r#"<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"><office:automatic-styles>{styles}</office:automatic-styles></office:document-content>"#), false, "", &mut String::new()).unwrap()
    }
    #[test]
    fn table_view_resolves_long_inheritance_without_copying_parent_view_fields() {
        let mut source = String::from(
            r#"<style:style style:name="S0" style:family="table"><style:table-properties style:writing-mode="rl-tb"/></style:style>"#,
        );
        for i in 1..3000 {
            source.push_str(&format!(r#"<style:style style:name="S{i}" style:family="table" style:parent-style-name="S{}"/>"#, i - 1));
        }
        let root = root(&source);
        let mut styles = Styles::read(&[&root], false, 2_000_000).unwrap();
        assert_eq!(styles.view(Some("S0")).unwrap(), [("rightToLeft", true)]);
        assert_eq!(
            styles.view(Some("S2999")).unwrap(),
            [("rightToLeft", false)]
        );
        let mut styles = Styles::read(&[&root], false, 250_000).unwrap();
        assert_eq!(styles.view(Some("S2999")).err().as_deref(), Some(LIMIT));
    }

    #[test]
    fn axis_style_inheritance_is_iterative_and_keeps_family_identity() {
        let mut source = String::from(
            r#"<style:style style:name="S0" style:family="table-column"><style:table-column-properties style:column-width="2in"/></style:style>"#,
        );
        for i in 1..3000 {
            source.push_str(&format!(r#"<style:style style:name="S{i}" style:family="table-column" style:parent-style-name="S{}"/>"#, i - 1));
        }
        source.push_str(r#"<style:style style:name="S2999" style:family="table-row"><style:table-row-properties style:row-height="0.5in"/></style:style>"#);
        let root = root(&source);
        let mut styles = Styles::read(&[&root], false, 2_000_000).unwrap();
        assert_eq!(
            styles
                .resolve_named(Some("S2999"), "table-column")
                .unwrap()
                .unwrap()
                .size,
            Some(144.)
        );
        assert_eq!(
            styles
                .resolve_named(Some("S2999"), "table-row")
                .unwrap()
                .unwrap()
                .size,
            Some(36.)
        );
        let mut styles = Styles::read(&[&root], false, 250_000).unwrap();
        assert_eq!(
            styles
                .resolve_named(Some("S2999"), "table-column")
                .err()
                .as_deref(),
            Some(LIMIT)
        );
    }

    #[test]
    fn unused_number_styles_are_bounded_before_digit_expansion() {
        for properties in [
            "number:decimal-places",
            "number:min-integer-digits",
            "number:min-exponent-digits",
        ] {
            let root = root(&format!(
                r#"<number:number-style style:name="N1"><number:scientific-number {properties}="9007199254740991"/></number:number-style>"#
            ));
            assert_eq!(
                Styles::read(&[&root], false, 4096).err().as_deref(),
                Some(LIMIT)
            );
        }
        let root = root(&(0..20).map(|i| format!(r#"<number:number-style style:name="N{i}"><number:number number:decimal-places="512"/></number:number-style>"#)).collect::<String>());
        assert_eq!(
            Styles::read(&[&root], false, 4096).err().as_deref(),
            Some(LIMIT)
        );
    }
    #[test]
    fn inherited_font_data_uses_a_persistent_cache_budget() {
        let family = "x".repeat(4096);
        let mut text = format!(
            r#"<style:style style:name="s0" style:family="table-cell"><style:text-properties xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" fo:font-family="{family}"/></style:style>"#
        );
        for i in 1..8 {
            text.push_str(&format!(r#"<style:style style:name="s{i}" style:family="table-cell" style:parent-style-name="s0"/>"#));
        }
        let root = root(&text);
        let mut styles = Styles::read(&[&root], false, 20_000).unwrap();
        assert_eq!(
            styles.resolve(Some("s1")).unwrap().unwrap().1.family,
            family
        );
        assert!(styles.resolve(Some("s2")).is_ok());
        assert!(styles.resolve(Some("s3")).is_ok());
        // A separate resolution must retain the cost of already cached siblings.
        assert_eq!(styles.resolve(Some("s4")).err().as_deref(), Some(LIMIT));
        // Reusing an existing style does not clone its retained font data.
        assert!(styles.resolve(Some("s1")).is_ok());
    }
    #[test]
    fn deep_inheritance_resolves_without_recursive_calls() {
        let mut text = String::from(
            r#"<number:number-style style:name="N1"><number:number number:decimal-places="2"/></number:number-style><style:style style:name="s0" style:family="table-cell" style:data-style-name="N1"/>"#,
        );
        for i in 1..3000 {
            text.push_str(&format!(r#"<style:style style:name="s{i}" style:family="table-cell" style:parent-style-name="s{}"/>"#,i-1));
        }
        let root = root(&text);
        let mut styles = Styles::read(&[&root], false, 1 << 20).unwrap();
        assert_eq!(
            styles.resolve(Some("s2999")).unwrap().map(|(f, _)| f),
            Some("0.00")
        );
        assert_eq!(
            styles.resolve(Some("s1500")).unwrap().map(|(f, _)| f),
            Some("0.00")
        );
    }
}
