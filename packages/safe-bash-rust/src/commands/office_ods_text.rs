use super::{INVALID, LIMIT, appearance::set, attr, js_number};
use crate::commands::structured::{
    xlsx::TextRun,
    xml::{Element, Node},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub(super) fn inline_allowed(name: &str, parent: &str, legacy: bool) -> bool {
    if legacy {
        parent == "text:p" && matches!(name, "text:span" | "text:s")
    } else {
        matches!(
            name,
            "text:span" | "text:s" | "text:tab" | "text:line-break"
        ) || name == "text:a" && matches!(parent, "text:span" | "text:p")
    }
}
type Attributes = Vec<(&'static str, String)>;
pub(super) struct TextStyles<'a> {
    legacy: bool,
    styles: BTreeMap<(&'a str, &'a str), (&'a Element, bool)>,
    fonts: BTreeMap<&'a str, &'a str>,
    resolved: BTreeMap<(&'a str, &'a str), Arc<Attributes>>,
}
fn retained(attributes: &Attributes) -> usize {
    attributes.iter().map(|(_, v)| v.len() + 80).sum::<usize>() + 64
}
impl<'a> TextStyles<'a> {
    pub fn read(
        roots: &[&'a Element],
        legacy: bool,
        remaining: &mut usize,
    ) -> Result<Self, String> {
        let mut result = Self {
            legacy,
            styles: BTreeMap::new(),
            fonts: BTreeMap::new(),
            resolved: BTreeMap::new(),
        };
        for root in roots {
            for container in &root.children {
                let Node::Element(container) = container else {
                    continue;
                };
                for node in &container.children {
                    let Node::Element(node) = node else { continue };
                    let Some(name) = attr(node, "style:name").filter(|s| !s.is_empty()) else {
                        continue;
                    };
                    if !node.tag.starts_with("style:") {
                        continue;
                    }
                    let container = container.tag.split_once(':').map(|(_, s)| s).unwrap_or("");
                    if matches!(container, "styles" | "automatic-styles")
                        && node.tag == "style:style"
                    {
                        *remaining = remaining.checked_sub(80).ok_or(LIMIT)?;
                        result.styles.insert(
                            (attr(node, "style:family").unwrap_or(""), name),
                            (node, root.tag == "office:document-styles"),
                        );
                    }
                    if matches!(container, "font-face-decls" | "font-decls") {
                        if let Some(family) =
                            attr(node, "svg:font-family").or_else(|| attr(node, "fo:font-family"))
                        {
                            let family = ['\'', '"']
                                .into_iter()
                                .find_map(|q| family.strip_prefix(q)?.strip_suffix(q))
                                .unwrap_or(family);
                            *remaining = remaining.checked_sub(64).ok_or(LIMIT)?;
                            result.fonts.insert(name, family);
                        }
                    }
                }
            }
        }
        Ok(result)
    }
    fn resolve(
        &mut self,
        name: Option<&str>,
        family: &str,
        remaining: &mut usize,
    ) -> Result<Arc<Attributes>, String> {
        let Some((mut node, mut styles_part)) = name
            .and_then(|name| self.styles.get(&(family, name)))
            .copied()
        else {
            return Ok(Arc::default());
        };
        let mut path = Vec::new();
        let mut seen = BTreeSet::new();
        let mut inherited = Arc::default();
        loop {
            let key = (
                attr(node, "style:family").unwrap_or(""),
                attr(node, "style:name").unwrap(),
            );
            if let Some(cached) = self.resolved.get(&key) {
                inherited = Arc::clone(cached);
                break;
            }
            if !seen.insert(key) {
                return Err(format!("{INVALID}cyclic text style inheritance"));
            }
            path.push((key, node, styles_part));
            let Some(&(parent, parent_styles_part)) = attr(node, "style:parent-style-name")
                .and_then(|name| self.styles.get(&(family, name)))
            else {
                break;
            };
            node = parent;
            styles_part = parent_styles_part;
        }
        for (key, node, styles_part) in path.into_iter().rev() {
            if retained(&inherited) > *remaining {
                return Err(LIMIT.into());
            }
            let mut attributes = (*inherited).clone();
            for p in &node.children {
                let Node::Element(p) = p else { continue };
                if !matches!(p.tag.as_str(), "style:text-properties" | "style:properties") {
                    continue;
                }
                if !styles_part && (p.tag == "style:properties") != self.legacy {
                    continue;
                }
                if let Some(font) = attr(p, "fo:font-family").or_else(|| {
                    attr(p, "style:font-name").map(|n| self.fonts.get(n).copied().unwrap_or(n))
                }) {
                    if font.len() > *remaining {
                        return Err(LIMIT.into());
                    }
                    set(&mut attributes, "family", font);
                }
                if let Some(size) = super::appearance::distance(attr(p, "fo:font-size")) {
                    set(&mut attributes, "size", (size * 1024.).round().to_string());
                }
                if let Some(weight) = attr(p, "fo:font-weight")
                    .and_then(|v| match v {
                        "normal" => Some(400.),
                        "bold" => Some(700.),
                        _ => js_number(v),
                    })
                    .filter(|n| n.fract() == 0. && *n >= 100. && *n <= 900.)
                {
                    set(
                        &mut attributes,
                        "bold",
                        ((weight - 400.) / 300.).to_string(),
                    );
                }
                for (source, target) in [
                    ("fo:font-style", "italic"),
                    ("style:text-line-through-style", "strikethrough"),
                ] {
                    if let Some(v) = attr(p, source) {
                        let enabled = if target == "italic" {
                            matches!(v, "italic" | "oblique")
                        } else {
                            v != "none"
                        };
                        set(&mut attributes, target, u8::from(enabled).to_string());
                    }
                }
                if let Some(position) = attr(p, "style:text-position") {
                    let token = position
                        .trim()
                        .split([' ', '\t', '\r', '\n'])
                        .next()
                        .unwrap_or("");
                    let script = match token {
                        "sub" => Some(-1),
                        "super" => Some(1),
                        _ => token
                            .strip_suffix('%')
                            .filter(|s| !s.is_empty())
                            .and_then(js_number)
                            .filter(|n| *n == 0.)
                            .map(|_| 0),
                    };
                    if let Some(script) = script {
                        set(
                            &mut attributes,
                            "subscript",
                            u8::from(script == -1).to_string(),
                        );
                        set(
                            &mut attributes,
                            "superscript",
                            u8::from(script == 1).to_string(),
                        );
                    }
                }
                let underline = attr(p, "style:text-underline-style");
                let kind = attr(p, "style:text-underline-type");
                if underline.is_some() || kind == Some("none") {
                    let double = kind == Some("double")
                        || attr(p, "style:text-underline-width") == Some("bold");
                    let low = attr(p, "gnm:text-underline-placement") == Some("low");
                    let value = if underline == Some("none") || kind == Some("none") {
                        "none"
                    } else if low {
                        if double {
                            "doubleAccounting"
                        } else {
                            "singleAccounting"
                        }
                    } else if double {
                        "double"
                    } else {
                        "single"
                    };
                    set(&mut attributes, "underline", value);
                }
                if let Some(color) = super::appearance::color(attr(p, "fo:color")) {
                    set(&mut attributes, "color", color);
                }
            }
            *remaining = remaining.checked_sub(retained(&attributes)).ok_or(LIMIT)?;
            inherited = Arc::new(attributes);
            self.resolved.insert(key, Arc::clone(&inherited));
        }
        Ok(inherited)
    }
    pub fn text(&mut self, node: &Element, remaining: &mut usize) -> Result<Vec<TextRun>, String> {
        let mut runs = Vec::new();
        let annotation = node.tag == "office:annotation";
        for (i, paragraph) in super::children(node, "text:p").enumerate() {
            if i > 0 {
                append(&mut runs, "\n", &Arc::default(), remaining)?;
            }
            let attributes =
                self.resolve(attr(paragraph, "text:style-name"), "paragraph", remaining)?;
            let mut pending: Vec<_> = paragraph
                .children
                .iter()
                .rev()
                .map(|node| (node, Arc::clone(&attributes), paragraph))
                .collect();
            while let Some((node, attributes, parent)) = pending.pop() {
                match node {
                    Node::Text(value, _) | Node::Cdata(value) => {
                        append(&mut runs, value, &attributes, remaining)?
                    }
                    Node::Element(element)
                        if if annotation {
                            if self.legacy {
                                matches!(
                                    element.tag.as_str(),
                                    "text:span"
                                        | "text:a"
                                        | "text:s"
                                        | "text:tab"
                                        | "text:tab-stop"
                                        | "text:line-break"
                                )
                            } else {
                                matches!(
                                    element.tag.as_str(),
                                    "text:span" | "text:s" | "text:tab" | "text:line-break"
                                ) || element.tag == "text:a" && parent.tag == "text:span"
                            }
                        } else {
                            inline_allowed(&element.tag, &parent.tag, self.legacy)
                        } =>
                    {
                        match element.tag.as_str() {
                            "text:span" | "text:a" => {
                                let own = self.resolve(
                                    attr(element, "text:style-name"),
                                    "text",
                                    remaining,
                                )?;
                                let attributes = if own.is_empty() {
                                    attributes
                                } else {
                                    *remaining = remaining
                                        .checked_sub(retained(&attributes) + retained(&own))
                                        .ok_or(LIMIT)?;
                                    let mut merged = (*attributes).clone();
                                    for (key, value) in own.iter() {
                                        set(&mut merged, key, value.clone());
                                    }
                                    Arc::new(merged)
                                };
                                pending.extend(
                                    element
                                        .children
                                        .iter()
                                        .rev()
                                        .map(|node| (node, Arc::clone(&attributes), element)),
                                );
                            }
                            "text:tab" | "text:tab-stop" => {
                                append(&mut runs, "\t", &attributes, remaining)?
                            }
                            "text:line-break" => append(&mut runs, "\n", &attributes, remaining)?,
                            "text:s" => {
                                let count = js_number(attr(element, "text:c").unwrap_or("1"))
                                    .filter(|n| {
                                        *n >= 0. && *n <= 9007199254740991. && n.fract() == 0.
                                    })
                                    .ok_or_else(|| format!("{INVALID}invalid text space count"))?;
                                if count > *remaining as f64 {
                                    if annotation && count > 536870888. {
                                        return Err(format!("{INVALID}Invalid string length"));
                                    }
                                    return Err(LIMIT.into());
                                }
                                append(
                                    &mut runs,
                                    &" ".repeat(count as usize),
                                    &attributes,
                                    remaining,
                                )?;
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
        if annotation {
            if runs.iter().any(|run| {
                run.attributes
                    .iter()
                    .any(|(key, value)| *key == "family" && value.contains(':'))
            }) {
                for run in &mut runs {
                    run.attributes = Arc::default();
                }
            } else {
                for run in &mut runs {
                    for (key, value) in Arc::make_mut(&mut run.attributes) {
                        if *key == "size" && value.parse::<f64>().is_ok_and(|n| !n.is_finite()) {
                            *value = "0".into();
                        }
                    }
                }
            }
        }
        Ok(runs)
    }
}

fn append(
    runs: &mut Vec<TextRun>,
    text: &str,
    attributes: &Arc<Attributes>,
    remaining: &mut usize,
) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    *remaining = remaining.checked_sub(text.len()).ok_or(LIMIT)?;
    if let Some(previous) = runs.last_mut().filter(|r| {
        r.attributes.len() == attributes.len()
            && attributes.iter().all(|a| r.attributes.contains(a))
    }) {
        previous.text.push_str(text);
    } else {
        *remaining = remaining
            .checked_sub(std::mem::size_of::<TextRun>())
            .ok_or(LIMIT)?;
        runs.push(TextRun {
            text: text.into(),
            attributes: Arc::clone(attributes),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::children;
    use super::*;
    fn document(content: &str) -> Element {
        super::super::document(&format!(r#"<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">{content}</office:document-content>"#), false, "", &mut String::new()).unwrap()
    }
    #[test]
    fn cell_text_expansion_and_inherited_fonts_share_a_budget() {
        let font = "x".repeat(4096);
        let definitions = format!(r#"<style:style style:name="base" style:family="text"><style:text-properties fo:font-family="{font}"/></style:style>"#)
            + &(0..4).map(|i| format!(r#"<style:style style:name="s{i}" style:family="text" style:parent-style-name="base"/>"#)).collect::<String>();
        let content = (0..4)
            .map(|i| format!(r#"<text:span text:style-name="s{i}">value</text:span>"#))
            .collect::<String>();
        let root = document(&format!(
            "<office:automatic-styles>{definitions}</office:automatic-styles><table:table-cell><text:p>{content}</text:p></table:table-cell>"
        ));
        let annotation = children(&root, "table:table-cell").next().unwrap();
        let mut remaining = 18_000;
        let mut styles = TextStyles::read(&[&root], false, &mut remaining).unwrap();
        assert_eq!(
            styles.text(annotation, &mut remaining).err().as_deref(),
            Some(LIMIT)
        );
        let mut remaining = 64_000;
        let mut styles = TextStyles::read(&[&root], false, &mut remaining).unwrap();
        let runs = styles.text(annotation, &mut remaining).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].text, "valuevaluevaluevalue");
        assert_eq!(
            runs[0]
                .attributes
                .iter()
                .find(|(k, _)| *k == "family")
                .unwrap()
                .1,
            font
        );
        let root = document(
            r#"<office:annotation><text:p><text:s text:c="100000"/></text:p></office:annotation>"#,
        );
        let mut remaining = 4096;
        let mut styles = TextStyles::read(&[&root], false, &mut remaining).unwrap();
        assert_eq!(
            styles
                .text(
                    children(&root, "office:annotation").next().unwrap(),
                    &mut remaining
                )
                .err()
                .as_deref(),
            Some(LIMIT)
        );
    }
    #[test]
    fn deep_text_style_inheritance_is_iterative() {
        let mut definitions = String::from(
            r#"<style:style style:name="s0" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>"#,
        );
        for i in 1..3000 {
            definitions.push_str(&format!(r#"<style:style style:name="s{i}" style:family="text" style:parent-style-name="s{}"/>"#, i - 1));
        }
        let root = document(&format!(
            r#"<office:automatic-styles>{definitions}</office:automatic-styles><table:table-cell><text:p><text:span text:style-name="s2999">deep</text:span></text:p></table:table-cell>"#
        ));
        let mut remaining = 1 << 20;
        let mut styles = TextStyles::read(&[&root], false, &mut remaining).unwrap();
        let runs = styles
            .text(
                children(&root, "table:table-cell").next().unwrap(),
                &mut remaining,
            )
            .unwrap();
        assert_eq!(runs[0].text, "deep");
        assert_eq!(
            runs[0]
                .attributes
                .iter()
                .find(|(k, _)| *k == "bold")
                .unwrap()
                .1,
            "1"
        );
    }
}
