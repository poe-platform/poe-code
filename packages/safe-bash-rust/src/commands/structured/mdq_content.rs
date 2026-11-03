// Source Markdown stays untouched until a selector edits it. After an edit,
// keep the visible text and its inline objects: neither needs to parse again.
use super::{
    MdqBlock, MdqDefinitions, MdqMatcher, MdqReferences,
    mdq_emphasis::{self, Event, Kind},
    mdq_inline_atoms, mdq_inline_parts,
};

#[derive(Clone, Default, Debug)]
pub(super) struct Content {
    pub text: String,
    pub events: Option<Vec<Event>>,
}

impl Content {
    pub fn source(text: String) -> Self {
        Self { text, events: None }
    }

    pub fn select(
        &mut self,
        defs: &MdqDefinitions,
        m: &MdqMatcher,
        label: bool,
    ) -> Result<bool, String> {
        let parsed = self.events.is_none().then(|| {
            mdq_emphasis::projection(&self.text, mdq_inline_atoms(defs, &self.text, label))
        });
        let text = parsed.as_ref().map_or(&self.text, |(s, _)| s);
        let Some(result) = super::mdq_match_text(m, text) else {
            return Ok(false);
        };
        if let super::MdqMatch::Replaced { text, ranges } = result {
            let events = parsed
                .map(|(_, events)| events)
                .or_else(|| self.events.take())
                .unwrap();
            self.events = Some(mdq_emphasis::reconstruct(&text, events, &ranges)?);
            self.text = text;
        }
        Ok(true)
    }

    pub fn parts(
        &self,
        defs: &MdqDefinitions,
        mut refs: Option<&mut MdqReferences>,
        label: bool,
        mut emit: impl FnMut(&str, bool),
    ) {
        let Some(events) = &self.events else {
            if label {
                super::mdq_emit_atoms(
                    defs,
                    &self.text,
                    mdq_inline_atoms(defs, &self.text, true),
                    refs,
                    &mut emit,
                );
            } else {
                mdq_inline_parts(defs, &self.text, refs, emit);
            }
            return;
        };
        let mut buf = String::new();
        let mut closes = Vec::<&Event>::new();
        let mut links = 0usize;
        let mut pos = 0;
        for i in 0..=events.len() {
            while let Some(e) = closes.last().copied().filter(|e| e.next == i) {
                closes.pop();
                buf.push_str(&self.text[pos..e.end]);
                pos = e.end;
                if let Some(r) = refs.as_deref_mut() {
                    match &e.kind {
                        Kind::Mark(marker) => buf.push_str(marker),
                        Kind::Link { target, .. } => {
                            buf.push(']');
                            buf.push_str(&r.suffix(target));
                            links -= 1;
                            if links == 0 {
                                emit(&buf, false);
                                buf.clear();
                            }
                        }
                        _ => unreachable!(),
                    }
                }
            }
            let Some(e) = events.get(i) else {
                break;
            };
            buf.push_str(&self.text[pos..e.start]);
            pos = e.start;
            let inner = &self.text[e.start..e.end];
            match &e.kind {
                Kind::Note => {
                    if let Some(r) = refs.as_deref_mut() {
                        buf.push_str(&format!("[^{}]", r.note_id(inner, defs)));
                    }
                }
                Kind::Html => buf.push_str(inner),
                Kind::Code => {
                    if refs.is_some() {
                        super::mdq_write_inline_code(&mut buf, inner);
                    } else {
                        buf.push_str(inner);
                    }
                }
                Kind::Mark(marker) => {
                    if inner.is_empty() {
                        continue;
                    }
                    if refs.is_some() {
                        buf.push_str(marker);
                    }
                    closes.push(e);
                    continue;
                }
                Kind::Link { target, image, .. } => {
                    if let Some(auto) = target.auto_text() {
                        buf.push_str(if refs.is_some() { &auto } else { inner });
                    } else {
                        if refs.is_some() {
                            if links == 0 {
                                emit(&buf, true);
                                buf.clear();
                            }
                            if *image {
                                buf.push('!');
                            }
                            buf.push('[');
                            links += 1;
                        }
                        closes.push(e);
                        continue;
                    }
                }
            }
            pos = e.end;
        }
        buf.push_str(&self.text[pos..]);
        emit(&buf, true);
    }

    pub fn render(
        &self,
        defs: &MdqDefinitions,
        refs: Option<&mut MdqReferences>,
        label: bool,
    ) -> String {
        let mut out = String::new();
        self.parts(defs, refs, label, |s, _| out.push_str(s));
        out
    }

    pub fn children(&self, defs: &MdqDefinitions, label: bool, out: &mut Vec<MdqBlock>) {
        let Some(events) = &self.events else {
            for (_, atom) in mdq_inline_atoms(defs, &self.text, label) {
                use super::MdqInlineAtom::*;
                let n = match atom {
                    Html(text) => MdqBlock {
                        kind: "html".into(),
                        text: text.into(),
                        ..Default::default()
                    },
                    Footnote(s) => MdqBlock {
                        kind: "footnote".into(),
                        text: s.into(),
                        ..Default::default()
                    },
                    Link {
                        image,
                        display,
                        target,
                        ..
                    } => {
                        let literal = image || target.auto.is_some();
                        MdqBlock {
                            kind: if image { "image" } else { "link" }.into(),
                            inline: Self {
                                text: display.into_owned(),
                                events: literal.then(Vec::new),
                            },
                            target,
                            ..Default::default()
                        }
                    }
                };
                out.push(n);
            }
            return;
        };
        let mut i = 0;
        while let Some(e) = events.get(i) {
            let text = &self.text[e.start..e.end];
            let n = match &e.kind {
                Kind::Mark(_) | Kind::Code => {
                    i += 1;
                    continue;
                }
                Kind::Html => MdqBlock {
                    kind: "html".into(),
                    text: text.into(),
                    ..Default::default()
                },
                Kind::Note => MdqBlock {
                    kind: "footnote".into(),
                    text: text.into(),
                    ..Default::default()
                },
                Kind::Link { image, target, .. } => {
                    let mut children = events[i + 1..e.next].to_vec();
                    for child in &mut children {
                        child.start -= e.start;
                        child.end -= e.start;
                        child.next -= i + 1;
                    }
                    MdqBlock {
                        kind: if *image { "image" } else { "link" }.into(),
                        inline: Self {
                            text: text.into(),
                            events: Some(children),
                        },
                        target: target.clone(),
                        ..Default::default()
                    }
                }
            };
            out.push(n);
            i = e.next;
        }
    }
}
