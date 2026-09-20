type Text = Vec<u16>;
use super::super::units;
// Adapted from yaml-rust2 0.10.4 (MIT); see THIRD_PARTY_NOTICES.md.

use super::scanner::{Marker, ScanError, Scanner, TScalarStyle, Token, TokenType};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Debug, Eq)]
enum State {
    StreamStart,
    ImplicitDocumentStart,
    DocumentStart,
    DocumentContent,
    DocumentEnd,
    BlockNode,
    // BlockNodeOrIndentlessSequence,
    // FlowNode,
    BlockSequenceFirstEntry,
    BlockSequenceEntry,
    IndentlessSequenceEntry,
    BlockMappingFirstKey,
    BlockMappingKey,
    BlockMappingValue,
    FlowSequenceFirstEntry,
    FlowSequenceEntry,
    FlowSequenceEntryMappingKey,
    FlowSequenceEntryMappingValue,
    FlowSequenceEntryMappingEnd,
    FlowMappingFirstKey,
    FlowMappingKey,
    FlowMappingValue,
    FlowMappingEmptyValue,
    End,
}

#[derive(Clone, PartialEq, Debug, Eq)]
pub enum Event {
    Nothing,
    StreamStart,
    StreamEnd,
    DocumentStart,
    DocumentEnd,
    Alias(usize),
    Scalar(Text, TScalarStyle, usize, Option<Tag>),
    SequenceStart(usize, Option<Tag>),
    SequenceEnd,
    MappingStart(usize, Option<Tag>),
    MappingEnd,
}

#[derive(Clone, PartialEq, Debug, Eq)]
pub struct Tag {
    pub handle: Text,
    pub suffix: Text,
}

impl Event {
    fn empty_scalar() -> Event {
        // a null scalar
        Event::Scalar(Text::new(), TScalarStyle::Plain, 0, None)
    }

    fn empty_scalar_with_anchor(anchor: usize, tag: Option<Tag>) -> Event {
        Event::Scalar(Text::new(), TScalarStyle::Plain, anchor, tag)
    }
}

#[derive(Debug)]
pub struct Parser<T> {
    pub(in crate::yaml) version: (u32, u32),
    scanner: Scanner<T>,
    states: Vec<State>,
    state: State,
    token: Option<Token>,
    current: Option<(Event, Marker)>,
    anchors: HashMap<Text, usize>,
    pub(in crate::yaml) anchor_names: HashMap<usize, Text>,
    anchor_id: usize,
    tags: HashMap<Text, Text>,
    keep_tags: bool,
}

pub type ParseResult = Result<(Event, Marker), ScanError>;

impl<T: Iterator<Item = u16>> Parser<T> {
    pub fn new(src: T) -> Parser<T> {
        Parser {
            version: (1, 2),
            scanner: Scanner::new(src),
            states: Vec::new(),
            state: State::StreamStart,
            token: None,
            current: None,

            anchors: HashMap::new(),
            anchor_names: HashMap::new(),
            // valid anchor_id starts from 1
            anchor_id: 1,
            tags: HashMap::new(),
            keep_tags: false,
        }
    }

    #[must_use]
    pub fn keep_tags(mut self, value: bool) -> Self {
        self.keep_tags = value;
        self
    }

    pub fn peek(&mut self) -> Result<&(Event, Marker), ScanError> {
        if let Some(ref x) = self.current {
            Ok(x)
        } else {
            self.current = Some(self.next_token()?);
            self.peek()
        }
    }

    pub fn next_token(&mut self) -> ParseResult {
        match self.current.take() {
            None => self.parse(),
            Some(v) => Ok(v),
        }
    }

    fn peek_token(&mut self) -> Result<&Token, ScanError> {
        match self.token {
            None => {
                self.token = Some(self.scan_next_token()?);
                Ok(self.token.as_ref().unwrap())
            }
            Some(ref tok) => Ok(tok),
        }
    }

    fn scan_next_token(&mut self) -> Result<Token, ScanError> {
        let token = self.scanner.next();
        match token {
            None => match self.scanner.get_error() {
                None => Err(ScanError::new(self.scanner.mark(), "unexpected eof")),
                Some(e) => Err(e),
            },
            Some(tok) => Ok(tok),
        }
    }

    fn fetch_token(&mut self) -> Token {
        self.token
            .take()
            .expect("fetch_token needs to be preceded by peek_token")
    }

    fn skip(&mut self) {
        self.token = None;
        //self.peek_token();
    }
    fn pop_state(&mut self) {
        self.state = self.states.pop().unwrap();
    }
    fn push_state(&mut self, state: State) {
        self.states.push(state);
    }

    fn parse(&mut self) -> ParseResult {
        if self.state == State::End {
            return Ok((Event::StreamEnd, self.scanner.mark()));
        }
        let (ev, mark) = self.state_machine()?;
        // println!("EV {:?}", ev);
        Ok((ev, mark))
    }

    fn state_machine(&mut self) -> ParseResult {
        // let next_tok = self.peek_token().cloned()?;
        // println!("cur_state {:?}, next tok: {:?}", self.state, next_tok);
        debug_print!("\n\x1B[;33mParser state: {:?} \x1B[;0m", self.state);

        match self.state {
            State::StreamStart => self.stream_start(),

            State::ImplicitDocumentStart => self.document_start(true),
            State::DocumentStart => self.document_start(false),
            State::DocumentContent => self.document_content(),
            State::DocumentEnd => self.document_end(),

            State::BlockNode => self.parse_node(true, false),
            // State::BlockNodeOrIndentlessSequence => self.parse_node(true, true),
            // State::FlowNode => self.parse_node(false, false),
            State::BlockMappingFirstKey => self.block_mapping_key(true),
            State::BlockMappingKey => self.block_mapping_key(false),
            State::BlockMappingValue => self.block_mapping_value(),

            State::BlockSequenceFirstEntry => self.block_sequence_entry(true),
            State::BlockSequenceEntry => self.block_sequence_entry(false),

            State::FlowSequenceFirstEntry => self.flow_sequence_entry(true),
            State::FlowSequenceEntry => self.flow_sequence_entry(false),

            State::FlowMappingFirstKey => self.flow_mapping_key(true),
            State::FlowMappingKey => self.flow_mapping_key(false),
            State::FlowMappingValue => self.flow_mapping_value(false),

            State::IndentlessSequenceEntry => self.indentless_sequence_entry(),

            State::FlowSequenceEntryMappingKey => self.flow_sequence_entry_mapping_key(),
            State::FlowSequenceEntryMappingValue => self.flow_sequence_entry_mapping_value(),
            State::FlowSequenceEntryMappingEnd => self.flow_sequence_entry_mapping_end(),
            State::FlowMappingEmptyValue => self.flow_mapping_value(true),

            /* impossible */
            State::End => unreachable!(),
        }
    }

    fn stream_start(&mut self) -> ParseResult {
        match *self.peek_token()? {
            Token(mark, TokenType::StreamStart(_)) => {
                self.state = State::ImplicitDocumentStart;
                self.skip();
                Ok((Event::StreamStart, mark))
            }
            Token(mark, _) => Err(ScanError::new(mark, "did not find expected <stream-start>")),
        }
    }

    fn document_start(&mut self, implicit: bool) -> ParseResult {
        while let TokenType::DocumentEnd = self.peek_token()?.1 {
            self.skip();
        }

        match *self.peek_token()? {
            Token(mark, TokenType::StreamEnd) => {
                self.state = State::End;
                self.skip();
                Ok((Event::StreamEnd, mark))
            }
            Token(
                _,
                TokenType::VersionDirective(..)
                | TokenType::TagDirective(..)
                | TokenType::DocumentStart,
            ) => {
                // explicit document
                self.explicit_document_start()
            }
            Token(mark, _) if implicit => {
                self.parser_process_directives()?;
                self.push_state(State::DocumentEnd);
                self.state = State::BlockNode;
                Ok((Event::DocumentStart, mark))
            }
            _ => {
                // explicit document
                self.explicit_document_start()
            }
        }
    }

    fn parser_process_directives(&mut self) -> Result<(), ScanError> {
        let mut version_directive_received = false;
        let mut tags = self.tags.clone();
        loop {
            match self.peek_token()? {
                Token(mark, TokenType::VersionDirective(major, minor)) => {
                    // XXX parsing with warning according to spec
                    //if major != 1 || minor > 2 {
                    //    return Err(ScanError::new(tok.0,
                    //        "found incompatible YAML document"));
                    //}
                    if version_directive_received {
                        return Err(ScanError::new(*mark, "duplicate version directive"));
                    }
                    version_directive_received = true;
                    self.version = (*major, *minor);
                }
                Token(mark, TokenType::TagDirective(handle, prefix)) => {
                    if tags.contains_key(handle) {
                        return Err(ScanError::new(
                            *mark,
                            "the TAG directive must only be given at most once per handle in the same document",
                        ));
                    }
                    tags.insert(handle.clone(), prefix.clone());
                }
                _ => break,
            }
            self.skip();
        }
        self.tags = tags;
        Ok(())
    }

    fn explicit_document_start(&mut self) -> ParseResult {
        self.parser_process_directives()?;
        match *self.peek_token()? {
            Token(mark, TokenType::DocumentStart) => {
                self.push_state(State::DocumentEnd);
                self.state = State::DocumentContent;
                self.skip();
                Ok((Event::DocumentStart, mark))
            }
            Token(mark, _) => Err(ScanError::new(
                mark,
                "did not find expected <document start>",
            )),
        }
    }

    fn document_content(&mut self) -> ParseResult {
        match *self.peek_token()? {
            Token(
                mark,
                TokenType::VersionDirective(..)
                | TokenType::TagDirective(..)
                | TokenType::DocumentStart
                | TokenType::DocumentEnd
                | TokenType::StreamEnd,
            ) => {
                self.pop_state();
                // empty scalar
                Ok((Event::empty_scalar(), mark))
            }
            _ => self.parse_node(true, false),
        }
    }

    fn document_end(&mut self) -> ParseResult {
        let mut explicit_end = false;
        let marker: Marker = match *self.peek_token()? {
            Token(mark, TokenType::DocumentEnd) => {
                explicit_end = true;
                self.skip();
                mark
            }
            Token(mark, _) => mark,
        };

        if !self.keep_tags {
            self.tags.clear();
        }
        if explicit_end {
            self.state = State::ImplicitDocumentStart;
        } else {
            if let Token(mark, TokenType::VersionDirective(..) | TokenType::TagDirective(..)) =
                *self.peek_token()?
            {
                return Err(ScanError::new(
                    mark,
                    "missing explicit document end marker before directive",
                ));
            }
            self.state = State::DocumentStart;
        }

        Ok((Event::DocumentEnd, marker))
    }

    fn register_anchor(&mut self, name: Text, _: &Marker) -> usize {
        // anchors can be overridden/reused
        // if self.anchors.contains_key(name) {
        //     return Err(ScanError::new(*mark,
        //         "while parsing anchor, found duplicated anchor"));
        // }
        let new_id = self.anchor_id;
        self.anchor_id += 1;
        self.anchor_names.insert(new_id, name.clone());
        self.anchors.insert(name, new_id);
        new_id
    }

    fn parse_node(&mut self, block: bool, indentless_sequence: bool) -> ParseResult {
        let mut anchor_id = 0;
        let mut tag = None;
        match *self.peek_token()? {
            Token(_, TokenType::Alias(_)) => {
                self.pop_state();
                if let Token(mark, TokenType::Alias(name)) = self.fetch_token() {
                    match self.anchors.get(&name) {
                        None => {
                            return Err(ScanError::new(
                                mark,
                                "while parsing node, found unknown anchor",
                            ));
                        }
                        Some(id) => return Ok((Event::Alias(*id), mark)),
                    }
                }
                unreachable!()
            }
            Token(_, TokenType::Anchor(_)) => {
                if let Token(mark, TokenType::Anchor(name)) = self.fetch_token() {
                    anchor_id = self.register_anchor(name, &mark);
                    if let TokenType::Tag(..) = self.peek_token()?.1 {
                        if let TokenType::Tag(handle, suffix) = self.fetch_token().1 {
                            tag = Some(self.resolve_tag(mark, &handle, suffix)?);
                        } else {
                            unreachable!()
                        }
                    }
                } else {
                    unreachable!()
                }
            }
            Token(mark, TokenType::Tag(..)) => {
                if let TokenType::Tag(handle, suffix) = self.fetch_token().1 {
                    tag = Some(self.resolve_tag(mark, &handle, suffix)?);
                    if let TokenType::Anchor(_) = &self.peek_token()?.1 {
                        if let Token(mark, TokenType::Anchor(name)) = self.fetch_token() {
                            anchor_id = self.register_anchor(name, &mark);
                        } else {
                            unreachable!()
                        }
                    }
                } else {
                    unreachable!()
                }
            }
            _ => {}
        }
        match *self.peek_token()? {
            Token(mark, TokenType::BlockEntry) if indentless_sequence => {
                self.state = State::IndentlessSequenceEntry;
                Ok((Event::SequenceStart(anchor_id, tag), mark))
            }
            Token(_, TokenType::Scalar(..)) => {
                self.pop_state();
                if let Token(mark, TokenType::Scalar(style, v)) = self.fetch_token() {
                    Ok((Event::Scalar(v, style, anchor_id, tag), mark))
                } else {
                    unreachable!()
                }
            }
            Token(mark, TokenType::FlowSequenceStart) => {
                self.state = State::FlowSequenceFirstEntry;
                Ok((Event::SequenceStart(anchor_id, tag), mark))
            }
            Token(mark, TokenType::FlowMappingStart) => {
                self.state = State::FlowMappingFirstKey;
                Ok((Event::MappingStart(anchor_id, tag), mark))
            }
            Token(mark, TokenType::BlockSequenceStart) if block => {
                self.state = State::BlockSequenceFirstEntry;
                Ok((Event::SequenceStart(anchor_id, tag), mark))
            }
            Token(mark, TokenType::BlockMappingStart) if block => {
                self.state = State::BlockMappingFirstKey;
                Ok((Event::MappingStart(anchor_id, tag), mark))
            }
            // ex 7.2, an empty scalar can follow a secondary tag
            Token(mark, _) if tag.is_some() || anchor_id > 0 => {
                self.pop_state();
                Ok((Event::empty_scalar_with_anchor(anchor_id, tag), mark))
            }
            Token(mark, _) => Err(ScanError::new(
                mark,
                "while parsing a node, did not find expected node content",
            )),
        }
    }

    fn block_mapping_key(&mut self, first: bool) -> ParseResult {
        // skip BlockMappingStart
        if first {
            let _ = self.peek_token()?;
            //self.marks.push(tok.0);
            self.skip();
        }
        match *self.peek_token()? {
            Token(_, TokenType::Key) => {
                self.skip();
                if let Token(mark, TokenType::Key | TokenType::Value | TokenType::BlockEnd) =
                    *self.peek_token()?
                {
                    self.state = State::BlockMappingValue;
                    // empty scalar
                    Ok((Event::empty_scalar(), mark))
                } else {
                    self.push_state(State::BlockMappingValue);
                    self.parse_node(true, true)
                }
            }
            // XXX(chenyh): libyaml failed to parse spec 1.2, ex8.18
            Token(mark, TokenType::Value) => {
                self.state = State::BlockMappingValue;
                Ok((Event::empty_scalar(), mark))
            }
            Token(mark, TokenType::BlockEnd) => {
                self.pop_state();
                self.skip();
                Ok((Event::MappingEnd, mark))
            }
            Token(mark, _) => Err(ScanError::new(
                mark,
                "while parsing a block mapping, did not find expected key",
            )),
        }
    }

    fn block_mapping_value(&mut self) -> ParseResult {
        match *self.peek_token()? {
            Token(_, TokenType::Value) => {
                self.skip();
                if let Token(mark, TokenType::Key | TokenType::Value | TokenType::BlockEnd) =
                    *self.peek_token()?
                {
                    self.state = State::BlockMappingKey;
                    // empty scalar
                    Ok((Event::empty_scalar(), mark))
                } else {
                    self.push_state(State::BlockMappingKey);
                    self.parse_node(true, true)
                }
            }
            Token(mark, _) => {
                self.state = State::BlockMappingKey;
                // empty scalar
                Ok((Event::empty_scalar(), mark))
            }
        }
    }

    fn flow_mapping_key(&mut self, first: bool) -> ParseResult {
        if first {
            let _ = self.peek_token()?;
            self.skip();
        }
        let marker: Marker = {
            match *self.peek_token()? {
                Token(mark, TokenType::FlowMappingEnd) => mark,
                Token(mark, _) => {
                    if !first {
                        match *self.peek_token()? {
                            Token(_, TokenType::FlowEntry) => self.skip(),
                            Token(mark, _) => {
                                return Err(ScanError::new(
                                    mark,
                                    "while parsing a flow mapping, did not find expected ',' or '}'",
                                ));
                            }
                        }
                    }

                    match *self.peek_token()? {
                        Token(_, TokenType::Key) => {
                            self.skip();
                            if let Token(
                                mark,
                                TokenType::Value | TokenType::FlowEntry | TokenType::FlowMappingEnd,
                            ) = *self.peek_token()?
                            {
                                self.state = State::FlowMappingValue;
                                return Ok((Event::empty_scalar(), mark));
                            }
                            self.push_state(State::FlowMappingValue);
                            return self.parse_node(false, false);
                        }
                        Token(marker, TokenType::Value) => {
                            self.state = State::FlowMappingValue;
                            return Ok((Event::empty_scalar(), marker));
                        }
                        Token(_, TokenType::FlowMappingEnd) => (),
                        _ => {
                            self.push_state(State::FlowMappingEmptyValue);
                            return self.parse_node(false, false);
                        }
                    }

                    mark
                }
            }
        };

        self.pop_state();
        self.skip();
        Ok((Event::MappingEnd, marker))
    }

    fn flow_mapping_value(&mut self, empty: bool) -> ParseResult {
        let mark: Marker = {
            if empty {
                let Token(mark, _) = *self.peek_token()?;
                self.state = State::FlowMappingKey;
                return Ok((Event::empty_scalar(), mark));
            }
            match *self.peek_token()? {
                Token(marker, TokenType::Value) => {
                    self.skip();
                    match self.peek_token()?.1 {
                        TokenType::FlowEntry | TokenType::FlowMappingEnd => {}
                        _ => {
                            self.push_state(State::FlowMappingKey);
                            return self.parse_node(false, false);
                        }
                    }
                    marker
                }
                Token(marker, _) => marker,
            }
        };

        self.state = State::FlowMappingKey;
        Ok((Event::empty_scalar(), mark))
    }

    fn flow_sequence_entry(&mut self, first: bool) -> ParseResult {
        // skip FlowMappingStart
        if first {
            let _ = self.peek_token()?;
            //self.marks.push(tok.0);
            self.skip();
        }
        match *self.peek_token()? {
            Token(mark, TokenType::FlowSequenceEnd) => {
                self.pop_state();
                self.skip();
                return Ok((Event::SequenceEnd, mark));
            }
            Token(_, TokenType::FlowEntry) if !first => {
                self.skip();
            }
            Token(mark, _) if !first => {
                return Err(ScanError::new(
                    mark,
                    "while parsing a flow sequence, expected ',' or ']'",
                ));
            }
            _ => { /* next */ }
        }
        match *self.peek_token()? {
            Token(mark, TokenType::FlowSequenceEnd) => {
                self.pop_state();
                self.skip();
                Ok((Event::SequenceEnd, mark))
            }
            Token(mark, TokenType::Key) => {
                self.state = State::FlowSequenceEntryMappingKey;
                self.skip();
                Ok((Event::MappingStart(0, None), mark))
            }
            _ => {
                self.push_state(State::FlowSequenceEntry);
                self.parse_node(false, false)
            }
        }
    }

    fn indentless_sequence_entry(&mut self) -> ParseResult {
        match *self.peek_token()? {
            Token(_, TokenType::BlockEntry) => (),
            Token(mark, _) => {
                self.pop_state();
                return Ok((Event::SequenceEnd, mark));
            }
        }
        self.skip();
        if let Token(
            mark,
            TokenType::BlockEntry | TokenType::Key | TokenType::Value | TokenType::BlockEnd,
        ) = *self.peek_token()?
        {
            self.state = State::IndentlessSequenceEntry;
            Ok((Event::empty_scalar(), mark))
        } else {
            self.push_state(State::IndentlessSequenceEntry);
            self.parse_node(true, false)
        }
    }

    fn block_sequence_entry(&mut self, first: bool) -> ParseResult {
        // BLOCK-SEQUENCE-START
        if first {
            let _ = self.peek_token()?;
            //self.marks.push(tok.0);
            self.skip();
        }
        match *self.peek_token()? {
            Token(mark, TokenType::BlockEnd) => {
                self.pop_state();
                self.skip();
                Ok((Event::SequenceEnd, mark))
            }
            Token(_, TokenType::BlockEntry) => {
                self.skip();
                if let Token(mark, TokenType::BlockEntry | TokenType::BlockEnd) =
                    *self.peek_token()?
                {
                    self.state = State::BlockSequenceEntry;
                    Ok((Event::empty_scalar(), mark))
                } else {
                    self.push_state(State::BlockSequenceEntry);
                    self.parse_node(true, false)
                }
            }
            Token(mark, _) => Err(ScanError::new(
                mark,
                "while parsing a block collection, did not find expected '-' indicator",
            )),
        }
    }

    fn flow_sequence_entry_mapping_key(&mut self) -> ParseResult {
        if let Token(mark, TokenType::Value | TokenType::FlowEntry | TokenType::FlowSequenceEnd) =
            *self.peek_token()?
        {
            self.skip();
            self.state = State::FlowSequenceEntryMappingValue;
            Ok((Event::empty_scalar(), mark))
        } else {
            self.push_state(State::FlowSequenceEntryMappingValue);
            self.parse_node(false, false)
        }
    }

    fn flow_sequence_entry_mapping_value(&mut self) -> ParseResult {
        match *self.peek_token()? {
            Token(_, TokenType::Value) => {
                self.skip();
                self.state = State::FlowSequenceEntryMappingValue;
                if let Token(mark, TokenType::FlowEntry | TokenType::FlowSequenceEnd) =
                    *self.peek_token()?
                {
                    self.state = State::FlowSequenceEntryMappingEnd;
                    Ok((Event::empty_scalar(), mark))
                } else {
                    self.push_state(State::FlowSequenceEntryMappingEnd);
                    self.parse_node(false, false)
                }
            }
            Token(mark, _) => {
                self.state = State::FlowSequenceEntryMappingEnd;
                Ok((Event::empty_scalar(), mark))
            }
        }
    }

    #[allow(clippy::unnecessary_wraps)]
    fn flow_sequence_entry_mapping_end(&mut self) -> ParseResult {
        self.state = State::FlowSequenceEntry;
        Ok((Event::MappingEnd, self.scanner.mark()))
    }

    fn resolve_tag(&self, mark: Marker, handle: &Text, suffix: Text) -> Result<Tag, ScanError> {
        let suffix = if handle.as_slice() == [33, 33] || self.tags.contains_key(handle) {
            decode_tag(&suffix).ok_or_else(|| ScanError::new(mark, "URIError: URI malformed"))?
        } else {
            suffix
        };
        if handle.as_slice() == [33, 33] {
            // "!!" is a shorthand for "tag:yaml.org,2002:". However, that default can be
            // overridden.
            match self.tags.get(&units("!!")) {
                Some(prefix) => Ok(Tag {
                    handle: prefix.clone(),
                    suffix,
                }),
                None => Ok(Tag {
                    handle: units("tag:yaml.org,2002:"),
                    suffix,
                }),
            }
        } else if handle.is_empty() && suffix.as_slice() == [33] {
            // "!" introduces a local tag. Local tags may have their prefix overridden.
            match self.tags.get(&units("")) {
                Some(prefix) => Ok(Tag {
                    handle: prefix.clone(),
                    suffix,
                }),
                None => Ok(Tag {
                    handle: Text::new(),
                    suffix,
                }),
            }
        } else {
            // Lookup handle in our tag directives.
            let prefix = self.tags.get(handle);
            if let Some(prefix) = prefix {
                Ok(Tag {
                    handle: prefix.clone(),
                    suffix,
                })
            } else {
                // Otherwise, it may be a local handle. With a local handle, the handle is set to
                // "!" and the suffix to whatever follows it ("!foo" -> ("!", "foo")).
                // If the handle is of the form "!foo!", this cannot be a local handle and we need
                // to error.
                if handle.len() >= 2 && handle.starts_with(&[33]) && handle.ends_with(&[33]) {
                    Err(ScanError::new(mark, "the handle wasn't declared"))
                } else {
                    Ok(Tag {
                        handle: handle.clone(),
                        suffix,
                    })
                }
            }
        }
    }
}

fn decode_tag(text: &[u16]) -> Option<Text> {
    let mut output = vec![];
    let mut i = 0;
    while i < text.len() {
        if text[i] != 37 {
            output.push(text[i]);
            i += 1;
            continue;
        }
        let mut bytes = vec![];
        while text.get(i) == Some(&37) {
            let hi = char::from_u32(u32::from(*text.get(i + 1)?))?.to_digit(16)?;
            let lo = char::from_u32(u32::from(*text.get(i + 2)?))?.to_digit(16)?;
            bytes.push((hi * 16 + lo) as u8);
            i += 3;
        }
        output.extend(std::str::from_utf8(&bytes).ok()?.encode_utf16());
    }
    Some(output)
}
