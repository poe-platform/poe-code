// OpenDocument's retained text reader uses lexical XML, including raw entity
// spelling and whitespace. XML admission/DOM normalization would change it.
use super::office_xml::{Token, decode, entities, tokens};
use super::{
    html_escape_str,
    office::{DocumentBlock as Block, DocumentText as Text, space},
};
use crate::commands::codecs::zip_directory;
use std::borrow::Cow;

const LIMIT: &str = "document exceeds byte limit";

fn text(raw: &str) -> Result<Text, String> {
    let value = entities(raw.trim_matches(space))?;
    Ok(Text {
        html: html_escape_str(&value),
        value,
        styles: Vec::new(),
    })
}

fn until(tokens: &[Token<'_>], pos: &mut usize, end: &str) -> Result<Text, String> {
    let mut raw = String::new();
    while let Some(token) = tokens.get(*pos) {
        *pos += 1;
        match token {
            Token::End(tag, _) if *tag == end => break,
            Token::Text(s) => raw.push_str(s),
            _ => {}
        }
    }
    text(&raw)
}

pub(super) fn read(bytes: &[u8], limit: usize) -> Result<Vec<Block>, String> {
    let read = || -> Result<Vec<Block>, String> {
        let (members, _) = zip_directory(bytes.len(), |range| Ok(Cow::Borrowed(&bytes[range])))?;
        let mut remaining = limit;
        let mut content = Cow::Borrowed(&b""[..]);
        for member in members {
            remaining = remaining.checked_sub(member.size).ok_or(LIMIT)?;
            // Office packages support stored and DEFLATE members. Admission
            // happens before decoding so declared sizes cannot bypass limits.
            if !matches!(member.method, 0 | 8) {
                return Err("ZIP unsupported compression method".into());
            }
            let decoded = member.decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)?;
            if member.name == "content.xml" {
                content = decoded;
            }
        }
        let source = decode(&content)?;
        if source.len() > limit {
            return Err(LIMIT.into());
        }
        let tokens = tokens(&source)?;
        let mut pos = 0;
        let mut blocks = Vec::new();
        while let Some(token) = tokens.get(pos) {
            pos += 1;
            match token {
                Token::Start {
                    name: tag @ ("text:p" | "text:h"),
                    empty: false,
                    ..
                } => {
                    let text = until(&tokens, &mut pos, tag)?;
                    if !text.value.is_empty() {
                        blocks.push(Block::Paragraph {
                            text,
                            heading: *tag == "text:h",
                            list: None,
                        });
                    }
                }
                Token::Start {
                    name: "table:table",
                    empty: false,
                    ..
                } => {
                    let mut rows = Vec::new();
                    while let Some(token) = tokens.get(pos) {
                        pos += 1;
                        match token {
                            Token::End("table:table", _) => break,
                            Token::Start {
                                name: "table:table-row",
                                empty: false,
                                ..
                            } => {
                                let mut cells = Vec::new();
                                while let Some(token) = tokens.get(pos) {
                                    pos += 1;
                                    match token {
                                        Token::End("table:table-row", _) => break,
                                        Token::Start {
                                            name: "table:table-cell",
                                            empty: false,
                                            ..
                                        } => cells.push(until(
                                            &tokens,
                                            &mut pos,
                                            "table:table-cell",
                                        )?),
                                        _ => {}
                                    }
                                }
                                if !cells.is_empty() {
                                    rows.push(cells);
                                }
                            }
                            _ => {}
                        }
                    }
                    if !rows.is_empty() {
                        blocks.push(Block::Table(rows));
                    }
                }
                _ => {}
            }
        }
        if blocks.is_empty() {
            let raw = tokens
                .iter()
                .filter_map(|t| {
                    if let Token::Text(t) = t {
                        Some(*t)
                    } else {
                        None
                    }
                })
                .collect::<String>();
            blocks.push(Block::Paragraph {
                text: text(&raw)?,
                heading: false,
                list: None,
            });
        }
        let mut remaining = limit;
        for block in &blocks {
            let size = match block {
                Block::Paragraph { text, .. } => text.value.len() + text.html.len(),
                Block::Table(rows) => rows
                    .iter()
                    .flatten()
                    .map(|t| t.value.len() + t.html.len())
                    .sum(),
                Block::Image { .. } | Block::PageSize(_) | Block::PageBreak(_) => unreachable!(),
            };
            remaining = remaining.checked_sub(size).ok_or(LIMIT)?;
        }
        Ok(blocks)
    };
    read().map_err(|e| {
        let message = if e == "ZIP missing end record" {
            "ZIP truncated or missing end of central directory"
        } else {
            &e
        };
        format!("Error: conversion failed: {message}\n")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structured::write_zip_stored;

    #[test]
    fn open_document_checks_all_members_against_the_decoding_budget() {
        let bytes = write_zip_stored(&[
            ("content.xml", b"<office><text:p>kept</text:p></office>"),
            ("Pictures/unused", &[0; 2048]),
        ]);
        assert_eq!(
            read(&bytes, 1024).err().unwrap(),
            "Error: conversion failed: document exceeds byte limit\n"
        );
        let blocks = read(&bytes, 4096).unwrap();
        assert!(matches!(&blocks[0],Block::Paragraph{text,..} if text.value=="kept"));
    }
}
