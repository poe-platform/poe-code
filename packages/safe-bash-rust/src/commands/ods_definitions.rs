use super::{
    super::{
        ssconvert::gnumeric_read::attr,
        xml::{Element, Node},
    },
    escaped,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write,
};

struct Definition {
    identity: Option<(String, String, String, String)>,
    name: String,
    shape: String,
    xml: String,
}

#[derive(Default)]
pub(super) struct Definitions {
    sections: BTreeMap<&'static str, Vec<Definition>>,
    pub names: BTreeSet<String>,
}

impl Definitions {
    pub fn read(
        source: Option<&crate::commands::archive::office_ods::Source>,
        extended: bool,
    ) -> Self {
        let mut result = Self::default();
        for (content, record) in source.into_iter().flat_map(|s| &s.records) {
            let section = match record.tag.as_str() {
                "office:automatic-styles" if *content => "content",
                "office:automatic-styles" => "layouts",
                "office:master-styles" => "masters",
                "office:styles" => "styles",
                "office:font-face-decls" => "fonts",
                _ => continue,
            };
            let entries = result.sections.entry(section).or_default();
            for node in &record.children {
                let Node::Element(node) = node else { continue };
                let name = attr(node, "style:name").unwrap_or("").to_owned();
                let identity = (!name.is_empty()).then(|| {
                    (
                        node.namespace.clone(),
                        node.tag.clone(),
                        attr(node, "style:family").unwrap_or("").to_owned(),
                        name.clone(),
                    )
                });
                if !name.is_empty() {
                    result.names.insert(name.clone());
                }
                let definition = Definition {
                    identity: identity.clone(),
                    name,
                    shape: retained(node, extended, true),
                    xml: retained(node, extended, false),
                };
                if let Some(old) = entries
                    .iter_mut()
                    .find(|e| identity.is_some() && e.identity == identity)
                {
                    *old = definition;
                } else {
                    entries.push(definition);
                }
            }
        }
        result
    }

    pub fn register(
        &mut self,
        section: &'static str,
        tag: &str,
        preferred: &str,
        attributes: &str,
        content: &str,
    ) -> String {
        let element = |attributes: &str| {
            if content.is_empty() {
                format!("<{tag}{attributes}/>")
            } else {
                format!("<{tag}{attributes}>{content}</{tag}>")
            }
        };
        let shape = element(attributes);
        let entries = self.sections.entry(section).or_default();
        if let Some(existing) = entries
            .iter()
            .rev()
            .find(|e| !e.name.is_empty() && e.shape == shape)
        {
            return existing.name.clone();
        }
        let mut name = preferred.to_owned();
        let mut suffix = 0;
        while !self.names.insert(name.clone()) {
            suffix += 1;
            name = format!("{preferred}_{suffix}");
        }
        entries.push(Definition {
            identity: None,
            shape,
            name: name.clone(),
            xml: element(&format!(" style:name=\"{}\"{attributes}", escaped(&name))),
        });
        name
    }

    pub fn render(&self, section: &str) -> String {
        self.sections
            .get(section)
            .into_iter()
            .flatten()
            .map(|e| e.xml.as_str())
            .collect()
    }
}

fn retained(node: &Element, extended: bool, omit_name: bool) -> String {
    let allowed = |key: &str| {
        !key.starts_with("?:")
            && !key.starts_with('{')
            && (extended || !key.starts_with("gnm:") && !key.starts_with("calcext:"))
    };
    if !allowed(&node.tag) {
        return String::new();
    }
    let mut out = format!("<{}", node.tag);
    for (key, value) in &node.attrs {
        if allowed(key) && !(omit_name && key == "style:name") {
            write!(out, " {key}=\"{}\"", escaped(value)).unwrap();
        }
    }
    let mut content = String::new();
    for child in &node.children {
        match child {
            Node::Element(child) => content.push_str(&retained(child, extended, false)),
            Node::Text(text, _) | Node::Cdata(text) => content.push_str(&escaped(text)),
            _ => {}
        }
    }
    if content.is_empty() {
        out.push_str("/>");
    } else {
        write!(out, ">{content}</{}>", node.tag).unwrap();
    }
    out
}
