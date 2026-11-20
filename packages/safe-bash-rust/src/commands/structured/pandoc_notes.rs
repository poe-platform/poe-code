use super::{
    MdqDefinitions, PandocBlock, PandocInline, PandocPipeTables, pandoc_list,
    parse_pandoc_markdown_with_defs,
};
use std::collections::{HashMap, HashSet};

pub(super) struct Resolver<'a> {
    pub sources: &'a HashMap<String, String>,
    pub definitions: &'a MdqDefinitions,
    pub tables: PandocPipeTables,
    pub tasks: pandoc_list::Tasks,
    pub raw_html: bool,
    pub nodes: usize,
    pub bytes: usize,
    pub active: HashSet<String>,
}

impl Resolver<'_> {
    pub fn blocks(&mut self, blocks: &mut [PandocBlock], depth: usize) -> Option<()> {
        if depth > 64 {
            return None;
        }
        for block in blocks {
            self.nodes = self.nodes.checked_sub(1)?;
            match block {
                PandocBlock::Header(_, _, nodes)
                | PandocBlock::Para(nodes)
                | PandocBlock::Plain(nodes) => self.inlines(nodes, depth + 1)?,
                PandocBlock::Figure(_, short, caption, children) => {
                    if let Some(short) = short { self.inlines(short, depth + 1)?; }
                    self.blocks(caption, depth + 1)?;
                    self.blocks(children, depth + 1)?;
                }
                PandocBlock::BlockQuote(blocks) | PandocBlock::Div(_, blocks) => {
                    self.blocks(blocks, depth + 1)?
                }
                PandocBlock::List(_, items) => {
                    for blocks in items {
                        self.blocks(blocks, depth + 1)?;
                    }
                }
                PandocBlock::Table(table) => {
                    for row in table.head.iter_mut().chain(&mut table.body) {
                        for cell in row {
                            self.blocks(&mut cell.blocks, depth + 1)?;
                        }
                    }
                }
                PandocBlock::CodeBlock(_, text) | PandocBlock::Raw(_, text) => {
                    self.bytes = self.bytes.checked_sub(text.len())?
                }
                PandocBlock::HorizontalRule | PandocBlock::Vector(_) => {}
            }
        }
        Some(())
    }

    pub(super) fn inlines(&mut self, nodes: &mut Vec<PandocInline>, depth: usize) -> Option<()> {
        if depth > 64 {
            return None;
        }
        for node in nodes.iter_mut() {
            self.nodes = self.nodes.checked_sub(1)?;
            match node {
                PandocInline::NoteReference(label) => {
                    if let Some(source) = self
                        .sources
                        .get(label)
                        .filter(|_| !self.active.contains(label))
                    {
                        // Charge each expansion, not just each unique definition. This
                        // bounds repeated references and branching note graphs.
                        self.bytes = self.bytes.checked_sub(source.len())?;
                        let label = label.clone();
                        self.active.insert(label.clone());
                        let mut blocks = parse_pandoc_markdown_with_defs(
                            source,
                            self.tables,
                            depth + 1,
                            self.tasks,
                            self.definitions,
                            self.raw_html,
                        )?;
                        self.blocks(&mut blocks, depth + 1)?;
                        self.active.remove(&label);
                        *node = PandocInline::Note(blocks);
                    } else {
                        *node = PandocInline::Text(format!("[^{label}]"));
                    }
                }
                PandocInline::Note(blocks) => self.blocks(blocks, depth + 1)?,
                PandocInline::Strong(children)
                | PandocInline::Emph(children)
                | PandocInline::Strikeout(children)
                | PandocInline::Subscript(children)
                | PandocInline::Superscript(children)
                | PandocInline::SmallCaps(children)
                | PandocInline::Quoted(_, children)
                | PandocInline::Span(_, children)
                | PandocInline::Link(_, children, _, _)
                | PandocInline::Image(_, children, _, _) => self.inlines(children, depth + 1)?,
                PandocInline::Text(text)
                | PandocInline::Code(_, text)
                | PandocInline::Raw(_, text) => self.bytes = self.bytes.checked_sub(text.len())?,
                _ => {}
            }
        }
        if self.sources.is_empty() {
            return Some(());
        }
        let mut merged = Vec::with_capacity(nodes.len());
        for node in nodes.drain(..) {
            if let (Some(PandocInline::Text(previous)), PandocInline::Text(text)) =
                (merged.last_mut(), &node)
            {
                previous.push_str(text);
            } else {
                merged.push(node);
            }
        }
        *nodes = merged;
        Some(())
    }
}

pub(super) fn contains(blocks: &[PandocBlock]) -> bool {
    fn inlines(nodes: &[PandocInline]) -> bool {
        nodes.iter().any(|node| match node {
            PandocInline::Note(_) => true,
            PandocInline::Strong(children)
            | PandocInline::Emph(children)
            | PandocInline::Strikeout(children)
            | PandocInline::Subscript(children)
            | PandocInline::Superscript(children)
            | PandocInline::SmallCaps(children)
            | PandocInline::Quoted(_, children)
            | PandocInline::Span(_, children)
            | PandocInline::Link(_, children, _, _)
            | PandocInline::Image(_, children, _, _) => inlines(children),
            _ => false,
        })
    }
    blocks.iter().any(|block| match block {
        PandocBlock::Header(_, _, nodes) | PandocBlock::Para(nodes) | PandocBlock::Plain(nodes) => {
            inlines(nodes)
        }
        PandocBlock::Figure(_, short, caption, children) => short.as_ref().is_some_and(|nodes| inlines(nodes)) || contains(caption) || contains(children),
        PandocBlock::BlockQuote(blocks) | PandocBlock::Div(_, blocks) => contains(blocks),
        PandocBlock::List(_, items) => items.iter().any(|blocks| contains(blocks)),
        PandocBlock::Table(table) => table
            .head
            .iter()
            .chain(&table.body)
            .flatten()
            .any(|cell| contains(&cell.blocks)),
        _ => false,
    })
}
