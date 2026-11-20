use super::{PandocBlock, PandocInline};

pub(super) fn strip_html_comments(text: &mut String) {
    let mut cleaned = String::new();
    let mut rest = text.as_str();
    while let Some(start) = rest.find("<!--") {
        cleaned.push_str(&rest[..start]);
        rest = rest[start + 4..]
            .find("-->")
            .map_or("", |end| &rest[start + 4 + end + 3..]);
    }
    cleaned.push_str(rest);
    *text = cleaned;
}

// Apply writer policy before any output is written, including nested list/table content.
pub(super) fn prepare(
    blocks: &mut [PandocBlock],
    target: &str,
    policy: Option<&str>,
    strip_comments: bool,
) -> Result<(), &'static str> {
    fn inlines(
        nodes: &mut Vec<PandocInline>,
        target: &str,
        policy: Option<&str>,
        strip_comments: bool,
    ) -> Result<(), &'static str> {
        if strip_comments {
            nodes.retain_mut(|node| {
                let PandocInline::Raw(format, text) = node else {
                    return true;
                };
                if format != "html" {
                    return true;
                }
                strip_html_comments(text);
                !text.is_empty()
            });
        }
        for node in nodes {
            match node {
                PandocInline::Note(blocks) => prepare(blocks, target, policy, strip_comments)?,
                PandocInline::Strong(children)
                | PandocInline::Emph(children)
                | PandocInline::Strikeout(children)
                | PandocInline::Subscript(children)
                | PandocInline::Superscript(children)
                | PandocInline::SmallCaps(children)
                | PandocInline::Quoted(_, children)
                | PandocInline::Span(_, children)
                | PandocInline::Link(_, children, _, _)
                | PandocInline::Image(_, children, _, _) => {
                    inlines(children, target, policy, strip_comments)?;
                }
                PandocInline::Raw(format, text) => {
                    if matches!(target, "html" | "html5" | "plain") {
                        if policy == Some("reject") || target == "plain" && policy.is_none() {
                            return Err(
                                "E_CAPABILITY: Raw inline content requires an explicit output policy\n",
                            );
                        }
                        if policy == Some("escape") || target == "plain" {
                            *node = PandocInline::Text(text.clone());
                        } else if policy == Some("retain")
                            && !matches!(format.as_str(), "html" | "html5")
                        {
                            return Err(
                                "E_CAPABILITY: Only HTML raw content can be retained in HTML output\n",
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
    for block in blocks {
        if matches!(target, "html" | "html5")
            && let PandocBlock::Header(_, attr, _) = block
        {
            super::pandoc_headings::prepare_html_attributes(attr)?;
        }
        match block {
            PandocBlock::Raw(format, text) => {
                if strip_comments && matches!(format.as_str(), "html" | "html5") {
                    strip_html_comments(text);
                }
                if text.is_empty() {
                    continue;
                }
                if policy == Some("reject") {
                    return Err("E_CAPABILITY: Raw block content rejected by output policy\n");
                }
                if policy == Some("escape") || target == "plain" && policy == Some("retain") {
                    *block = PandocBlock::Para(vec![PandocInline::Text(text.clone())]);
                } else if target == "json"
                    || matches!(format.as_str(), "html" | "html5")
                        && matches!(
                            target,
                            "html"
                                | "html5"
                                | "docx"
                                | "pdf"
                                | "epub"
                                | "epub3"
                                | "odt"
                                | "markdown"
                                | "markdown_github"
                                | "markdown_mmd"
                                | "markdown_phpextra"
                                | "markdown_strict"
                                | "md"
                                | "gfm"
                                | "commonmark"
                                | "commonmark_x"
                        )
                    || matches!(format.as_str(), "latex" | "tex") && target == "latex"
                    || format == "rtf" && target == "rtf"
                    || format == "rst" && target == "rst"
                {
                    // The corresponding renderer retains the source verbatim.
                } else {
                    return Err(
                        "E_CAPABILITY: Raw block format requires a compatible output or explicit escape policy\n",
                    );
                }
            }
            PandocBlock::Header(_, _, nodes)
            | PandocBlock::Para(nodes)
            | PandocBlock::Plain(nodes) => {
                inlines(nodes, target, policy, strip_comments)?;
            }
            PandocBlock::Figure(_, short, caption, children) => {
                if let Some(short) = short { inlines(short, target, policy, strip_comments)?; }
                prepare(caption, target, policy, strip_comments)?;
                prepare(children, target, policy, strip_comments)?;
            }
            PandocBlock::BlockQuote(children) | PandocBlock::Div(_, children) => {
                prepare(children, target, policy, strip_comments)?
            }
            PandocBlock::List(_, items) => {
                for item in items {
                    prepare(item, target, policy, strip_comments)?;
                }
            }
            PandocBlock::Table(table) => {
                for cell in table.head.iter_mut().chain(&mut table.body).flatten() {
                    prepare(&mut cell.blocks, target, policy, strip_comments)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}
