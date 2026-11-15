use super::{PandocBlock, PandocInline};

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
                !text.is_empty()
            });
        }
        for node in nodes {
            match node {
                PandocInline::Strong(children)
                | PandocInline::Emph(children)
                | PandocInline::Strikeout(children)
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
        match block {
            PandocBlock::Header(_, _, nodes)
            | PandocBlock::Para(nodes)
            | PandocBlock::Plain(nodes) => {
                inlines(nodes, target, policy, strip_comments)?;
            }
            PandocBlock::BlockQuote(children) => prepare(children, target, policy, strip_comments)?,
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
