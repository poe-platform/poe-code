use super::{SS, TextRun, XML, escaped, rich_text, xlsx_idx_to_col_ref};
use std::fmt::Write;

#[derive(Clone)]
pub(in crate::commands) struct Comment {
    pub row: usize,
    pub column: usize,
    pub author: Option<String>,
    pub runs: Vec<TextRun>,
    pub print: bool,
}

pub(super) fn write(comments: &[Comment], limit: usize) -> Option<(String, String)> {
    if comments.len().checked_mul(std::mem::size_of::<&str>())? > limit {
        return None;
    }
    let mut author_names = Vec::new();
    let mut author_indexes = std::collections::BTreeMap::new();
    for name in comments.iter().filter_map(|c| c.author.as_deref()) {
        if let std::collections::btree_map::Entry::Vacant(entry) = author_indexes.entry(name) {
            entry.insert(author_names.len());
            author_names.push(name);
        }
    }
    let mut authors = String::new();
    for name in &author_names {
        if name.is_empty() {
            authors.push_str("<author/>");
        } else {
            write!(authors, "<author>{}</author>", escaped(name)).ok()?;
        }
        if authors.len() > limit {
            return None;
        }
    }
    let mut list = String::new();
    let mut shapes = String::new();
    for (index, comment) in comments.iter().enumerate() {
        let author = comment
            .author
            .as_deref()
            .map(|name| format!(" authorId=\"{}\"", author_indexes[name]))
            .unwrap_or_default();
        let row = comment.row;
        let column = comment.column;
        write!(
            list,
            r#"<comment ref="{}{}"{author}><text>"#,
            xlsx_idx_to_col_ref(column),
            row + 1
        )
        .ok()?;
        list.push_str(&rich_text::write(&comment.runs, true, limit)?);
        list.push_str("</text></comment>");
        write!(shapes, r##"<v:shape type="#_x0000_t202" fillcolor="#ffffc0" style="position:absolute;margin-left:{:.2}pt;margin-top:{:.2}pt;width:0.00pt;height:0.00pt;z-index:{};visibility:hidden;"><x:ClientData ObjectType="Note"><x:Anchor>{}, 15, {row}, 10, {}, 15, {}, 4</x:Anchor><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:PrintObject>{}</x:PrintObject><x:Row>{row}</x:Row><x:Column>{column}</x:Column></x:ClientData></v:shape>"##,
            (column + 1) as f64 * 48., row as f64 * 12.75, index + 1, column + 1, column + 3, row + 4, if comment.print { "True" } else { "False" }).ok()?;
        if authors
            .len()
            .saturating_add(list.len())
            .saturating_add(shapes.len())
            > limit
        {
            return None;
        }
    }
    let authors = if authors.is_empty() {
        "<authors/>".into()
    } else {
        format!("<authors>{authors}</authors>")
    };
    let comments = format!(
        "{XML}<comments xmlns=\"{SS}\">{authors}<commentList>{list}</commentList></comments>\n"
    );
    let drawing = format!(
        r#"{XML}<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shapetype id="_x0000_t202"/>{shapes}</xml>
"#
    );
    (comments.len().saturating_add(drawing.len()) <= limit).then_some((comments, drawing))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    #[test]
    fn comments_without_authors_do_not_inherit_a_named_author() {
        use crate::commands::structured::xml::{self, Node};
        let authors = [Some("Ada"), None, Some(""), Some("Ada"), None];
        let comments: Vec<_> = authors
            .iter()
            .enumerate()
            .map(|(row, author)| Comment {
                print: true,
                row,
                column: 0,
                author: author.map(str::to_owned),
                runs: Vec::new(),
            })
            .collect();
        let (source, _) = write(&comments, 32_768).unwrap();
        let document = xml::parse(&source, None, None).unwrap();
        let Node::Element(root) = &document.nodes[0] else {
            panic!("comments")
        };
        let mut resolved_authors = Vec::new();
        let mut ids = Vec::new();
        for node in &root.children {
            let Node::Element(group) = node else { continue };
            for node in &group.children {
                let Node::Element(element) = node else {
                    continue;
                };
                if group.tag == "authors" {
                    resolved_authors.push(
                        element
                            .children
                            .iter()
                            .filter_map(|n| match n {
                                Node::Text(s, _) => Some(s.as_str()),
                                _ => None,
                            })
                            .collect::<String>(),
                    );
                } else if group.tag == "commentList" {
                    let id = element
                        .attrs
                        .iter()
                        .find(|(key, _)| key == "authorId")
                        .map(|(_, value)| value.parse::<usize>().unwrap());
                    ids.push(id);
                }
            }
        }
        assert_eq!(ids.len(), authors.len());
        for (id, expected) in ids.into_iter().zip(authors) {
            assert_eq!(
                id.and_then(|id| resolved_authors.get(id))
                    .map(String::as_str),
                expected
            );
        }
        assert_eq!(resolved_authors.len(), 2);
    }

    #[test]
    fn comments_and_drawings_include_escaped_data_in_the_output_budget() {
        let comments = [Comment {
            print: true,
            row: 2,
            column: 3,
            author: Some("&".repeat(1024)),
            runs: vec![TextRun {
                text: "<".repeat(1024),
                attributes: Arc::new(vec![("family", "\"".repeat(1024))]),
            }],
        }];
        let (xml, drawing) = write(&comments, 32_768).unwrap();
        let size = xml.len() + drawing.len();
        assert!(xml.contains("&amp;") && xml.contains("&lt;") && xml.contains("&quot;"));
        assert!(drawing.contains("<x:Row>2</x:Row><x:Column>3</x:Column>"));
        assert!(write(&comments, size - 1).is_none());
        assert_eq!(write(&comments, size), Some((xml, drawing)));
        assert!(write(&comments, 4096).is_none());
    }
}
