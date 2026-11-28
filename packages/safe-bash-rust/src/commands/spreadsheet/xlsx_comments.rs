use super::{SS, TextRun, XML, escaped, rich_text, xlsx_idx_to_col_ref};
use std::fmt::Write;

pub struct Comment {
    pub row: usize,
    pub column: usize,
    pub author: String,
    pub runs: Vec<TextRun>,
}

pub(super) fn write(comments: &[Comment], limit: usize) -> Option<(String, String)> {
    if comments.len().checked_mul(std::mem::size_of::<&str>())? > limit {
        return None;
    }
    let mut author_names: Vec<_> = comments.iter().map(|c| c.author.as_str()).collect();
    author_names.sort_unstable_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    author_names.dedup();
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
        let author = author_names
            .binary_search_by(|name| name.encode_utf16().cmp(comment.author.encode_utf16()))
            .ok()?;
        let row = comment.row;
        let column = comment.column;
        write!(
            list,
            r#"<comment ref="{}{}" authorId="{author}"><text>"#,
            xlsx_idx_to_col_ref(column),
            row + 1
        )
        .ok()?;
        list.push_str(&rich_text::write(&comment.runs, limit)?);
        list.push_str("</text></comment>");
        write!(shapes, r##"<v:shape type="#_x0000_t202" fillcolor="#ffffc0" style="position:absolute;margin-left:{:.2}pt;margin-top:{:.2}pt;width:0.00pt;height:0.00pt;z-index:{};visibility:hidden;"><x:ClientData ObjectType="Note"><x:Anchor>{}, 15, {row}, 10, {}, 15, {}, 4</x:Anchor><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:PrintObject>True</x:PrintObject><x:Row>{row}</x:Row><x:Column>{column}</x:Column></x:ClientData></v:shape>"##,
            (column + 1) as f64 * 48., row as f64 * 12.75, index + 1, column + 1, column + 3, row + 4).ok()?;
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
    use crate::commands::spreadsheet::{
        Spreadsheet, xml_attribute as attr, xml_elements as elements, xml_text as text,
    };
    use crate::commands::structured::{read_office_archive, xml};
    use std::sync::Arc;

    fn workbook_with_comments(target: &str, mode: &str, comments: &str) -> Vec<u8> {
        let relationships = format!(
            r#"<Relationships><Relationship Id="notes" Type="{}/comments" Target="{target}" TargetMode="{mode}"/></Relationships>"#,
            super::super::REL
        );
        office_package_rust::write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ledger" sheetId="1" r:id="s1"/><sheet name="Other" sheetId="2" r:id="s2"/></sheets></workbook>"#),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships><Relationship Id="s1" Target="worksheets/ledger.xml"/><Relationship Id="s2" Target="worksheets/other.xml"/></Relationships>"#),
            ("xl/worksheets/ledger.xml", br#"<worksheet><sheetData><row r="2"><c r="D2"><v>42</v></c></row></sheetData></worksheet>"#),
            ("xl/worksheets/other.xml", b"<worksheet><sheetData/></worksheet>"),
            ("xl/worksheets/_rels/ledger.xml.rels", relationships.as_bytes()),
            ("xl/notes/review.xml", comments.as_bytes()),
        ])
    }

    #[test]
    fn imported_comments_round_trip_authors_addresses_and_multiline_text() {
        let source = r#"<comments><authors><author>Audit Team</author><author/><author>Zoe &amp; Co</author></authors><commentList>
            <comment ref="D2" authorId="0"><text><t>Approval required
Second line</t></text></comment>
            <comment ref="B8" authorId="2"><text><r><t> Check &lt;total&gt;</t></r><r><t>_x000A_下一行 </t></r></text></comment>
            <comment ref="A9" authorId="1"><text><t>Anonymous</t></text></comment>
            </commentList></comments>"#;
        for target in ["/xl/notes/review.xml", "../notes/review.xml"] {
            let input = workbook_with_comments(target, "Internal", source);
            let mut book = Spreadsheet::import_xlsx(&input, 10_000_000).unwrap();
            assert_eq!(book.display(0, 1, 3, 1_000_000).unwrap(), "42");
            book.edit(&[(0, 1, 3, "43")], 1_000_000).unwrap();
            let parts = read_office_archive(&book.export_xlsx(10_000_000).unwrap());
            // Inspect the exported parts directly, independently of XLSX import.
            let comments = parts.get("xl/comments1.xml").expect("comments preserved");
            let nodes = xml::parse(std::str::from_utf8(comments).unwrap(), None, None)
                .unwrap()
                .nodes;
            let authors: Vec<_> = elements(&nodes, "author").into_iter().map(text).collect();
            let actual: Vec<_> = elements(&nodes, "comment")
                .into_iter()
                .map(|comment| {
                    let author = attr(comment, "authorId").unwrap().parse::<usize>().unwrap();
                    (
                        attr(comment, "ref").unwrap().to_owned(),
                        authors[author].clone(),
                        text(comment),
                    )
                })
                .collect();
            assert_eq!(
                actual,
                vec![
                    (
                        "D2".into(),
                        "Audit Team".into(),
                        "Approval required\nSecond line".into()
                    ),
                    (
                        "B8".into(),
                        "Zoe & Co".into(),
                        " Check <total>\n下一行 ".into()
                    ),
                    ("A9".into(), "".into(), "Anonymous".into()),
                ]
            );
            assert!(!parts.contains_key("xl/comments2.xml"));
            let rels = xml::parse(
                std::str::from_utf8(&parts["xl/worksheets/_rels/sheet1.xml.rels"]).unwrap(),
                None,
                None,
            )
            .unwrap()
            .nodes;
            assert!(elements(&rels, "Relationship").iter().any(|rel| {
                attr(rel, "Type").is_some_and(|t| t.ends_with("/comments"))
                    && attr(rel, "Target") == Some("../comments1.xml")
            }));
            assert!(
                std::str::from_utf8(&parts["[Content_Types].xml"])
                    .unwrap()
                    .contains("/xl/comments1.xml")
            );
        }
    }

    #[test]
    fn imported_comments_reject_invalid_addresses_and_author_ids() {
        for (address, author) in [("XFE1", "0"), ("A0", "0"), ("A1", "1"), ("A1", "-1")] {
            let comments = format!(
                r#"<comments><authors><author>Reviewer</author></authors><commentList><comment ref="{address}" authorId="{author}"><text><t>Note</t></text></comment></commentList></comments>"#
            );
            let input = workbook_with_comments("../notes/review.xml", "Internal", &comments);
            assert!(
                Spreadsheet::import_xlsx(&input, 1_000_000).is_err(),
                "{address}, {author}"
            );
        }
    }

    #[test]
    fn imported_comments_charge_repeated_authors_to_the_byte_limit() {
        let author = "Reviewer".repeat(500);
        let comments = (1..=100)
            .map(|row| {
                format!(r#"<comment ref="A{row}" authorId="0"><text><t>Note</t></text></comment>"#)
            })
            .collect::<String>();
        let source = format!(
            "<comments><authors><author>{author}</author></authors><commentList>{comments}</commentList></comments>"
        );
        let input = workbook_with_comments("../notes/review.xml", "Internal", &source);
        assert!(Spreadsheet::import_xlsx(&input, 200_000).is_err());
        assert!(Spreadsheet::import_xlsx(&input, 10_000_000).is_ok());
    }

    #[test]
    fn external_comment_relationships_are_not_imported() {
        let input = workbook_with_comments("../notes/review.xml", "External", "not XML");
        let book = Spreadsheet::import_xlsx(&input, 1_000_000).unwrap();
        let parts = read_office_archive(&book.export_xlsx(1_000_000).unwrap());
        assert!(!parts.contains_key("xl/comments1.xml"));
    }

    #[test]
    fn comments_without_authors_do_not_inherit_a_named_author() {
        use crate::commands::structured::xml::{self, Node};
        let authors = [Some("Ada"), None, Some(""), Some("Ada"), None];
        let comments: Vec<_> = authors
            .iter()
            .enumerate()
            .map(|(row, author)| Comment {
                row,
                column: 0,
                author: author.unwrap_or("").to_string(),
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
                        .expect("every comment must reference an author")
                        .1
                        .parse::<usize>()
                        .unwrap();
                    ids.push(id);
                }
            }
        }
        assert_eq!(ids.len(), authors.len());
        for (id, expected) in ids.into_iter().zip(authors) {
            assert_eq!(
                resolved_authors.get(id).map(String::as_str),
                Some(expected.unwrap_or(""))
            );
        }
        assert_eq!(resolved_authors.len(), 2);
    }

    #[test]
    fn comments_and_drawings_include_escaped_data_in_the_output_budget() {
        let comments = [Comment {
            row: 2,
            column: 3,
            author: "&".repeat(1024),
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
