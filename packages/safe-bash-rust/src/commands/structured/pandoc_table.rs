use super::{
    JVal, PandocAttr, PandocBlock, PandocInline, MdqDefinitions, pandoc_blocks_to_json, parse_pandoc_md_inlines,
};
use std::fmt::Alignment;

#[derive(Clone, Debug, Default)]
pub(super) struct Cell {
    pub align: Option<Alignment>,
    pub column: usize,
    pub blocks: Vec<PandocBlock>,
    pub span: (usize, usize),
}

#[derive(Clone, Debug, Default)]
pub(super) struct Table {
    pub cols: Vec<(Option<Alignment>, f64)>,
    pub head: Vec<Vec<Cell>>,
    pub body: Vec<Vec<Cell>>,
}

impl Table {
    pub fn simple(
        header: Vec<String>,
        rows: Vec<Vec<String>>,
        align: Option<Vec<Option<Alignment>>>,
        definitions: Option<&MdqDefinitions>,
    ) -> Self {
        let cols = (0..header.len())
            .map(|i| (align.as_ref().and_then(|v| v[i]), 0.))
            .collect();
        let row = |r: Vec<String>| {
            r.into_iter()
                .enumerate()
                .map(|(column, text)| {
                    let nodes = if align.is_some() {
                        parse_pandoc_md_inlines(&text, definitions)
                    } else {
                        let mut nodes = Vec::new();
                        for (i, word) in text.split(' ').enumerate() {
                            if i > 0 {
                                nodes.push(PandocInline::Space);
                            }
                            if !word.is_empty() {
                                nodes.push(PandocInline::Text(word.to_owned()));
                            }
                        }
                        nodes
                    };
                    Cell {
                        align: None,
                        column,
                        span: (1, 1),
                        blocks: if nodes.is_empty() {
                            vec![]
                        } else {
                            vec![PandocBlock::Plain(nodes)]
                        },
                    }
                })
                .collect()
        };
        Self {
            cols,
            head: vec![row(header)],
            body: rows.into_iter().map(row).collect(),
        }
    }

    pub fn json(&self) -> JVal {
        use JVal::{Array as A, Object as O, Str as S};
        let attr = || PandocAttr::default().json();
        let n = |v: usize| JVal::Number(v as f64, None);
        let tag = |t: &str| O(vec![("t".into(), S(t.into()))]);
        let align = |a| {
            tag(match a {
                Some(Alignment::Left) => "AlignLeft",
                Some(Alignment::Center) => "AlignCenter",
                Some(Alignment::Right) => "AlignRight",
                None => "AlignDefault",
            })
        };
        let rows = |rows: &[Vec<Cell>]| {
            A(rows
                .iter()
                .map(|row| {
                    A(vec![
                        attr(),
                        A(row
                            .iter()
                            .map(|c| {
                                A(vec![
                                    attr(),
                                    align(c.align),
                                    n(c.span.0),
                                    n(c.span.1),
                                    pandoc_blocks_to_json(&c.blocks),
                                ])
                            })
                            .collect()),
                    ])
                })
                .collect())
        };
        let cols = self
            .cols
            .iter()
            .map(|&(a, w)| {
                A(vec![
                    align(a),
                    if w == 0. {
                        tag("ColWidthDefault")
                    } else {
                        O(vec![
                            ("t".into(), S("ColWidth".into())),
                            ("c".into(), JVal::Number(w, None)),
                        ])
                    },
                ])
            })
            .collect();
        O(vec![
            ("t".into(), S("Table".into())),
            (
                "c".into(),
                A(vec![
                    attr(),
                    A(vec![JVal::Null, A(vec![])]),
                    A(cols),
                    A(vec![attr(), rows(&self.head)]),
                    A(vec![A(vec![attr(), n(0), A(vec![]), rows(&self.body)])]),
                    A(vec![attr(), A(vec![])]),
                ]),
            ),
        ])
    }
}
