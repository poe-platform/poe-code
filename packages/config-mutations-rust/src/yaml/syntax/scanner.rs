// Adapted from yaml-rust2 0.10.4 (MIT); see THIRD_PARTY_NOTICES.md.

#![allow(clippy::cast_possible_wrap)]
#![allow(clippy::cast_sign_loss)]

type Text = Vec<u16>;
use super::super::units;
use std::{char, collections::VecDeque, error::Error, fmt};

use super::char_traits::{
    as_hex, is_alpha, is_anchor_char, is_blank, is_blank_or_breakz, is_break, is_breakz, is_digit,
    is_flow, is_hex, is_tag_char, is_uri_char, is_z,
};

#[derive(Clone, Copy, PartialEq, Debug, Eq)]
pub enum TEncoding {
    Utf8,
}

#[derive(Clone, Copy, PartialEq, Debug, Eq)]
pub enum TScalarStyle {
    Plain,
    SingleQuoted,
    DoubleQuoted,

    Literal,
    Folded,
}

#[derive(Clone, Copy, PartialEq, Debug, Eq)]
pub struct Marker {
    index: usize,
    line: usize,
    col: usize,
}

impl Marker {
    fn new(index: usize, line: usize, col: usize) -> Marker {
        Marker { index, line, col }
    }

    #[must_use]
    pub fn index(&self) -> usize {
        self.index
    }

    #[must_use]
    pub fn line(&self) -> usize {
        self.line
    }

    #[must_use]
    pub fn col(&self) -> usize {
        self.col
    }
}

#[derive(Clone, PartialEq, Debug, Eq)]
pub struct ScanError {
    mark: Marker,
    info: String,
}

impl ScanError {
    #[must_use]
    pub fn new(loc: Marker, info: &str) -> ScanError {
        ScanError {
            mark: loc,
            info: info.to_owned(),
        }
    }

    #[must_use]
    pub fn new_string(loc: Marker, info: String) -> ScanError {
        ScanError { mark: loc, info }
    }

    #[must_use]
    pub fn marker(&self) -> &Marker {
        &self.mark
    }

    #[must_use]
    pub fn info(&self) -> &str {
        self.info.as_ref()
    }
}

impl Error for ScanError {
    fn description(&self) -> &str {
        self.info.as_ref()
    }

    fn cause(&self) -> Option<&dyn Error> {
        None
    }
}

impl fmt::Display for ScanError {
    // col starts from 0
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        write!(
            formatter,
            "{} at byte {} line {} column {}",
            self.info,
            self.mark.index,
            self.mark.line,
            self.mark.col + 1,
        )
    }
}

#[derive(Clone, PartialEq, Debug, Eq)]
pub enum TokenType {
    StreamStart(TEncoding),
    StreamEnd,
    VersionDirective(u32, u32),
    TagDirective(Text, Text),
    DocumentStart,
    DocumentEnd,
    BlockSequenceStart,
    BlockMappingStart,
    BlockEnd,
    FlowSequenceStart,
    FlowSequenceEnd,
    FlowMappingStart,
    FlowMappingEnd,
    BlockEntry,
    FlowEntry,
    Key,
    Value,
    Alias(Text),
    Anchor(Text),
    Tag(Text, Text),
    Scalar(TScalarStyle, Text),
}

#[derive(Clone, PartialEq, Debug, Eq)]
pub struct Token(pub Marker, pub TokenType);

#[derive(Clone, PartialEq, Debug, Eq)]
struct SimpleKey {
    possible: bool,
    required: bool,
    token_number: usize,
    mark: Marker,
}

impl SimpleKey {
    fn new(mark: Marker) -> SimpleKey {
        SimpleKey {
            possible: false,
            required: false,
            token_number: 0,
            mark,
        }
    }
}

#[derive(Clone, Debug, Default)]
struct Indent {
    indent: isize,
    needs_block_end: bool,
}

const BUFFER_LEN: usize = 16;

#[derive(Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct Scanner<T> {
    rdr: T,
    mark: Marker,
    tokens: VecDeque<Token>,
    buffer: VecDeque<u16>,
    error: Option<ScanError>,

    stream_start_produced: bool,
    stream_end_produced: bool,
    adjacent_value_allowed_at: usize,
    simple_key_allowed: bool,
    simple_keys: Vec<SimpleKey>,
    indent: isize,
    indents: Vec<Indent>,
    flow_level: usize,
    tokens_parsed: usize,
    token_available: bool,
    leading_whitespace: bool,
    flow_mapping_started: bool,
    implicit_flow_mapping: bool,
}

impl<T: Iterator<Item = u16>> Iterator for Scanner<T> {
    type Item = Token;
    fn next(&mut self) -> Option<Token> {
        if self.error.is_some() {
            return None;
        }
        match self.next_token() {
            Ok(Some(tok)) => {
                debug_print!(
                    "    \x1B[;32m\u{21B3} {:?} \x1B[;36m{:?}\x1B[;m",
                    tok.1,
                    tok.0
                );
                Some(tok)
            }
            Ok(tok) => tok,
            Err(e) => {
                self.error = Some(e);
                None
            }
        }
    }
}

pub type ScanResult = Result<(), ScanError>;

impl<T: Iterator<Item = u16>> Scanner<T> {
    pub fn new(rdr: T) -> Scanner<T> {
        Scanner {
            rdr,
            buffer: VecDeque::with_capacity(BUFFER_LEN),
            mark: Marker::new(0, 1, 0),
            tokens: VecDeque::new(),
            error: None,

            stream_start_produced: false,
            stream_end_produced: false,
            adjacent_value_allowed_at: 0,
            simple_key_allowed: true,
            simple_keys: Vec::new(),
            indent: -1,
            indents: Vec::new(),
            flow_level: 0,
            tokens_parsed: 0,
            token_available: false,
            leading_whitespace: true,
            flow_mapping_started: false,
            implicit_flow_mapping: false,
        }
    }

    #[inline]
    pub fn get_error(&self) -> Option<ScanError> {
        self.error.clone()
    }

    #[inline]
    fn lookahead(&mut self, count: usize) {
        if self.buffer.len() >= count {
            return;
        }
        for _ in 0..(count - self.buffer.len()) {
            self.buffer.push_back(self.rdr.next().unwrap_or(0));
        }
    }

    #[inline]
    fn skip_blank(&mut self) {
        self.buffer.pop_front();

        self.mark.index += 1;
        self.mark.col += 1;
    }

    #[inline]
    fn skip_non_blank(&mut self) {
        self.buffer.pop_front();

        self.mark.index += 1;
        self.mark.col += 1;
        self.leading_whitespace = false;
    }

    #[inline]
    fn skip_n_non_blank(&mut self, n: usize) {
        self.buffer.drain(0..n);

        self.mark.index += n;
        self.mark.col += n;
        self.leading_whitespace = false;
    }

    #[inline]
    fn skip_nl(&mut self) {
        self.buffer.pop_front();

        self.mark.index += 1;
        self.mark.col = 0;
        self.mark.line += 1;
        self.leading_whitespace = true;
    }

    #[inline]
    fn skip_linebreak(&mut self) {
        if self.buffer[0] == 13 && self.buffer[1] == 10 {
            // While technically not a blank, this does not matter as `self.leading_whitespace`
            // will be reset by `skip_nl`.
            self.skip_blank();
            self.skip_nl();
        } else if is_break(self.buffer[0]) {
            self.skip_nl();
        }
    }

    #[inline]
    fn ch(&self) -> u16 {
        self.buffer[0]
    }

    #[inline]
    fn look_ch(&mut self) -> u16 {
        self.lookahead(1);
        self.ch()
    }

    #[inline]
    #[must_use]
    fn raw_read_ch(&mut self) -> u16 {
        self.rdr.next().unwrap_or(0)
    }

    #[inline]
    fn ch_is(&self, c: u16) -> bool {
        self.buffer[0] == c
    }

    #[inline]
    pub fn stream_started(&self) -> bool {
        self.stream_start_produced
    }

    #[inline]
    pub fn stream_ended(&self) -> bool {
        self.stream_end_produced
    }

    #[inline]
    pub fn mark(&self) -> Marker {
        self.mark
    }

    // Read and consume a line break (either `\r`, `\n` or `\r\n`).
    //
    // A `\n` is pushed into `s`.
    //
    // # Panics (in debug)
    // If the next characters do not correspond to a line break.
    #[inline]
    fn read_break(&mut self, s: &mut Text) {
        let c = self.buffer[0];
        let nc = self.buffer[1];
        debug_assert!(is_break(c));
        if c == 13 && nc == 10 {
            self.skip_blank();
        }
        self.skip_nl();

        s.push(10);
    }

    fn next_is_document_end(&self) -> bool {
        assert!(self.buffer.len() >= 4);
        self.buffer[0] == 46
            && self.buffer[1] == 46
            && self.buffer[2] == 46
            && is_blank_or_breakz(self.buffer[3])
    }

    #[inline]
    fn next_is_document_indicator(&self) -> bool {
        assert!(self.buffer.len() >= 4);
        self.mark.col == 0
            && (((self.buffer[0] == 45) && (self.buffer[1] == 45) && (self.buffer[2] == 45))
                || ((self.buffer[0] == 46) && (self.buffer[1] == 46) && (self.buffer[2] == 46)))
            && is_blank_or_breakz(self.buffer[3])
    }

    fn insert_token(&mut self, pos: usize, tok: Token) {
        let old_len = self.tokens.len();
        assert!(pos <= old_len);
        self.tokens.insert(pos, tok);
    }

    fn allow_simple_key(&mut self) {
        self.simple_key_allowed = true;
    }

    fn disallow_simple_key(&mut self) {
        self.simple_key_allowed = false;
    }

    pub fn fetch_next_token(&mut self) -> ScanResult {
        self.lookahead(1);
        // eprintln!("--> fetch_next_token Cur {:?} {:?}", self.mark, self.ch());

        if !self.stream_start_produced {
            self.fetch_stream_start();
            return Ok(());
        }
        self.skip_to_next_token()?;

        debug_print!(
            "  \x1B[38;5;244m\u{2192} fetch_next_token after whitespace {:?} {:?}\x1B[m",
            self.mark,
            self.ch()
        );

        self.stale_simple_keys()?;

        let mark = self.mark;
        self.unroll_indent(mark.col as isize);

        self.lookahead(4);

        if is_z(self.ch()) {
            self.fetch_stream_end()?;
            return Ok(());
        }

        // Is it a directive?
        if self.mark.col == 0 && self.ch_is(37) {
            return self.fetch_directive();
        }

        if self.mark.col == 0
            && self.buffer[0] == 45
            && self.buffer[1] == 45
            && self.buffer[2] == 45
            && is_blank_or_breakz(self.buffer[3])
        {
            self.fetch_document_indicator(TokenType::DocumentStart)?;
            return Ok(());
        }

        if self.mark.col == 0
            && self.buffer[0] == 46
            && self.buffer[1] == 46
            && self.buffer[2] == 46
            && is_blank_or_breakz(self.buffer[3])
        {
            self.fetch_document_indicator(TokenType::DocumentEnd)?;
            self.skip_ws_to_eol(SkipTabs::Yes)?;
            if !is_breakz(self.ch()) {
                return Err(ScanError::new(
                    self.mark,
                    "invalid content after document end marker",
                ));
            }
            return Ok(());
        }

        if (self.mark.col as isize) < self.indent {
            return Err(ScanError::new(self.mark, "invalid indentation"));
        }

        let c = self.buffer[0];
        let nc = self.buffer[1];
        match c {
            91 => self.fetch_flow_collection_start(TokenType::FlowSequenceStart),
            123 => self.fetch_flow_collection_start(TokenType::FlowMappingStart),
            93 => self.fetch_flow_collection_end(TokenType::FlowSequenceEnd),
            125 => self.fetch_flow_collection_end(TokenType::FlowMappingEnd),
            44 => self.fetch_flow_entry(),
            45 if is_blank_or_breakz(nc) => self.fetch_block_entry(),
            63 if is_blank_or_breakz(nc) => self.fetch_key(),
            58 if is_blank_or_breakz(nc)
                || (self.flow_level > 0
                    && (is_flow(nc) || self.mark.index == self.adjacent_value_allowed_at)) =>
            {
                self.fetch_value()
            }
            // Is it an alias?
            42 => self.fetch_anchor(true),
            // Is it an anchor?
            38 => self.fetch_anchor(false),
            33 => self.fetch_tag(),
            // Is it a literal scalar?
            124 if self.flow_level == 0 => self.fetch_block_scalar(true),
            // Is it a folded scalar?
            62 if self.flow_level == 0 => self.fetch_block_scalar(false),
            39 => self.fetch_flow_scalar(true),
            34 => self.fetch_flow_scalar(false),
            // plain scalar
            45 if !is_blank_or_breakz(nc) => self.fetch_plain_scalar(),
            58 | 63 if !is_blank_or_breakz(nc) && self.flow_level == 0 => self.fetch_plain_scalar(),
            37 | 64 | 96 => Err(ScanError::new(
                self.mark,
                &format!("unexpected character: `{c}'"),
            )),
            _ => self.fetch_plain_scalar(),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ScanError> {
        if self.stream_end_produced {
            return Ok(None);
        }

        if !self.token_available {
            self.fetch_more_tokens()?;
        }
        let Some(t) = self.tokens.pop_front() else {
            return Err(ScanError::new(
                self.mark,
                "did not find expected next token",
            ));
        };
        self.token_available = false;
        self.tokens_parsed += 1;

        if let TokenType::StreamEnd = t.1 {
            self.stream_end_produced = true;
        }
        Ok(Some(t))
    }

    pub fn fetch_more_tokens(&mut self) -> ScanResult {
        let mut need_more;
        loop {
            if self.tokens.is_empty() {
                need_more = true;
            } else {
                need_more = false;
                // Stale potential keys that we know won't be keys.
                self.stale_simple_keys()?;
                // If our next token to be emitted may be a key, fetch more context.
                for sk in &self.simple_keys {
                    if sk.possible && sk.token_number == self.tokens_parsed {
                        need_more = true;
                        break;
                    }
                }
            }

            if !need_more {
                break;
            }
            self.fetch_next_token()?;
        }
        self.token_available = true;

        Ok(())
    }

    fn stale_simple_keys(&mut self) -> ScanResult {
        for sk in &mut self.simple_keys {
            if sk.possible
                // If not in a flow construct, simple keys cannot span multiple lines.
                && self.flow_level == 0
                    && (sk.mark.line < self.mark.line || sk.mark.index + 1024 < self.mark.index)
            {
                if sk.required {
                    return Err(ScanError::new(self.mark, "simple key expect ':'"));
                }
                sk.possible = false;
            }
        }
        Ok(())
    }

    fn skip_to_next_token(&mut self) -> ScanResult {
        loop {
            // TODO(chenyh) BOM
            match self.look_ch() {
                // Tabs may not be used as indentation.
                // "Indentation" only exists as long as a block is started, but does not exist
                // inside of flow-style constructs. Tabs are allowed as part of leading
                // whitespaces outside of indentation.
                // If a flow-style construct is in an indented block, its contents must still be
                // indented. Also, tabs are allowed anywhere in it if it has no content.
                9 if self.is_within_block()
                    && self.leading_whitespace
                    && (self.mark.col as isize) < self.indent =>
                {
                    self.skip_ws_to_eol(SkipTabs::Yes)?;
                    // If we have content on that line with a tab, return an error.
                    if !is_breakz(self.ch()) {
                        return Err(ScanError::new(
                            self.mark,
                            "tabs disallowed within this context (block indentation)",
                        ));
                    }
                }
                9 | 32 => self.skip_blank(),
                10 | 13 => {
                    self.lookahead(2);
                    self.skip_linebreak();
                    if self.flow_level == 0 {
                        self.allow_simple_key();
                    }
                }
                35 => {
                    while !is_breakz(self.look_ch()) {
                        self.skip_non_blank();
                    }
                }
                _ => break,
            }
        }
        Ok(())
    }

    fn skip_yaml_whitespace(&mut self) -> ScanResult {
        let mut need_whitespace = true;
        loop {
            match self.look_ch() {
                32 => {
                    self.skip_blank();

                    need_whitespace = false;
                }
                10 | 13 => {
                    self.lookahead(2);
                    self.skip_linebreak();
                    if self.flow_level == 0 {
                        self.allow_simple_key();
                    }
                    need_whitespace = false;
                }
                35 => {
                    while !is_breakz(self.look_ch()) {
                        self.skip_non_blank();
                    }
                }
                _ => break,
            }
        }

        if need_whitespace {
            Err(ScanError::new(self.mark(), "expected whitespace"))
        } else {
            Ok(())
        }
    }

    fn skip_ws_to_eol(&mut self, skip_tabs: SkipTabs) -> Result<SkipTabs, ScanError> {
        let mut encountered_tab = false;
        let mut has_yaml_ws = false;
        loop {
            match self.look_ch() {
                32 => {
                    has_yaml_ws = true;
                    self.skip_blank();
                }
                9 if skip_tabs != SkipTabs::No => {
                    encountered_tab = true;
                    self.skip_blank();
                }
                // YAML comments must be preceded by whitespace.
                35 if !encountered_tab && !has_yaml_ws => {
                    return Err(ScanError::new(
                        self.mark,
                        "comments must be separated from other tokens by whitespace",
                    ));
                }
                35 => {
                    while !is_breakz(self.look_ch()) {
                        self.skip_non_blank();
                    }
                }
                _ => break,
            }
        }

        Ok(SkipTabs::Result(encountered_tab, has_yaml_ws))
    }

    fn fetch_stream_start(&mut self) {
        let mark = self.mark;
        self.indent = -1;
        self.stream_start_produced = true;
        self.allow_simple_key();
        self.tokens
            .push_back(Token(mark, TokenType::StreamStart(TEncoding::Utf8)));
        self.simple_keys.push(SimpleKey::new(Marker::new(0, 0, 0)));
    }

    fn fetch_stream_end(&mut self) -> ScanResult {
        // force new line
        if self.mark.col != 0 {
            self.mark.col = 0;
            self.mark.line += 1;
        }

        // If the stream ended, we won't have more context. We can stall all the simple keys we
        // had. If one was required, however, that was an error and we must propagate it.
        for sk in &mut self.simple_keys {
            if sk.required && sk.possible {
                return Err(ScanError::new(self.mark, "simple key expected"));
            }
            sk.possible = false;
        }

        self.unroll_indent(-1);
        self.remove_simple_key()?;
        self.disallow_simple_key();

        self.tokens
            .push_back(Token(self.mark, TokenType::StreamEnd));
        Ok(())
    }

    fn fetch_directive(&mut self) -> ScanResult {
        self.unroll_indent(-1);
        self.remove_simple_key()?;

        self.disallow_simple_key();

        let tok = self.scan_directive()?;
        self.tokens.push_back(tok);

        Ok(())
    }

    fn scan_directive(&mut self) -> Result<Token, ScanError> {
        let start_mark = self.mark;
        self.skip_non_blank();

        let name = self.scan_directive_name()?;
        let tok = match String::from_utf16_lossy(&name).as_str() {
            "YAML" => self.scan_version_directive_value(&start_mark)?,
            "TAG" => self.scan_tag_directive_value(&start_mark)?,
            // XXX This should be a warning instead of an error
            _ => {
                // skip current line
                while !is_breakz(self.look_ch()) {
                    self.skip_non_blank();
                }
                // XXX return an empty TagDirective token
                Token(
                    start_mark,
                    TokenType::TagDirective(Text::new(), Text::new()),
                )
                // return Err(ScanError::new(start_mark,
                //     "while scanning a directive, found unknown directive name"))
            }
        };

        self.skip_ws_to_eol(SkipTabs::Yes)?;

        if is_breakz(self.ch()) {
            self.lookahead(2);
            self.skip_linebreak();
            Ok(tok)
        } else {
            Err(ScanError::new(
                start_mark,
                "while scanning a directive, did not find expected comment or line break",
            ))
        }
    }

    fn scan_version_directive_value(&mut self, mark: &Marker) -> Result<Token, ScanError> {
        while is_blank(self.look_ch()) {
            self.skip_blank();
        }

        let major = self.scan_version_directive_number(mark)?;

        if self.ch() != 46 {
            return Err(ScanError::new(
                *mark,
                "while scanning a YAML directive, did not find expected digit or '.' character",
            ));
        }
        self.skip_non_blank();

        let minor = self.scan_version_directive_number(mark)?;

        Ok(Token(*mark, TokenType::VersionDirective(major, minor)))
    }

    fn scan_directive_name(&mut self) -> Result<Text, ScanError> {
        let start_mark = self.mark;
        let mut string = Text::new();
        while is_alpha(self.look_ch()) {
            string.push(self.ch());
            self.skip_non_blank();
        }

        if string.is_empty() {
            return Err(ScanError::new(
                start_mark,
                "while scanning a directive, could not find expected directive name",
            ));
        }

        if !is_blank_or_breakz(self.ch()) {
            return Err(ScanError::new(
                start_mark,
                "while scanning a directive, found unexpected non-alphabetical character",
            ));
        }

        Ok(string)
    }

    fn scan_version_directive_number(&mut self, mark: &Marker) -> Result<u32, ScanError> {
        let mut val = 0u32;
        let mut length = 0usize;
        while let Some(digit) =
            char::from_u32(u32::from(self.look_ch())).and_then(|ch| ch.to_digit(10))
        {
            if length + 1 > 9 {
                return Err(ScanError::new(
                    *mark,
                    "while scanning a YAML directive, found extremely long version number",
                ));
            }
            length += 1;
            val = val * 10 + digit;
            self.skip_non_blank();
        }

        if length == 0 {
            return Err(ScanError::new(
                *mark,
                "while scanning a YAML directive, did not find expected version number",
            ));
        }

        Ok(val)
    }

    fn scan_tag_directive_value(&mut self, mark: &Marker) -> Result<Token, ScanError> {
        /* Eat whitespaces. */
        while is_blank(self.look_ch()) {
            self.skip_blank();
        }
        let handle = self.scan_tag_handle(true, mark)?;

        /* Eat whitespaces. */
        while is_blank(self.look_ch()) {
            self.skip_blank();
        }

        let prefix = self.scan_tag_prefix(mark)?;

        self.lookahead(1);

        if is_blank_or_breakz(self.ch()) {
            Ok(Token(*mark, TokenType::TagDirective(handle, prefix)))
        } else {
            Err(ScanError::new(
                *mark,
                "while scanning TAG, did not find expected whitespace or line break",
            ))
        }
    }

    fn fetch_tag(&mut self) -> ScanResult {
        self.save_simple_key();
        self.disallow_simple_key();

        let tok = self.scan_tag()?;
        self.tokens.push_back(tok);
        Ok(())
    }

    fn scan_tag(&mut self) -> Result<Token, ScanError> {
        let start_mark = self.mark;
        let mut handle = Text::new();
        let mut suffix;

        // Check if the tag is in the canonical form (verbatim).
        self.lookahead(2);

        if self.buffer[1] == 60 {
            suffix = self.scan_verbatim_tag(&start_mark)?;
        } else {
            // The tag has either the '!suffix' or the '!handle!suffix'
            handle = self.scan_tag_handle(false, &start_mark)?;
            // Check if it is, indeed, handle.
            if handle.len() >= 2 && handle.starts_with(&[33]) && handle.ends_with(&[33]) {
                // A tag handle starting with "!!" is a secondary tag handle.
                let is_secondary_handle = handle == [33, 33];
                suffix = self.scan_tag_shorthand_suffix(
                    false,
                    is_secondary_handle,
                    &Text::new(),
                    &start_mark,
                )?;
            } else {
                suffix = self.scan_tag_shorthand_suffix(false, false, &handle, &start_mark)?;
                handle = units("!");
                // A special case: the '!' tag.  Set the handle to '' and the
                // suffix to '!'.
                if suffix.is_empty() {
                    handle.clear();
                    suffix = units("!");
                }
            }
        }

        if is_blank_or_breakz(self.look_ch()) || (self.flow_level > 0 && is_flow(self.ch())) {
            // XXX: ex 7.2, an empty scalar can follow a secondary tag
            Ok(Token(start_mark, TokenType::Tag(handle, suffix)))
        } else {
            Err(ScanError::new(
                start_mark,
                "while scanning a tag, did not find expected whitespace or line break",
            ))
        }
    }

    fn scan_tag_handle(&mut self, directive: bool, mark: &Marker) -> Result<Text, ScanError> {
        let mut string = Text::new();
        if self.look_ch() != 33 {
            return Err(ScanError::new(
                *mark,
                "while scanning a tag, did not find expected '!'",
            ));
        }

        string.push(self.ch());
        self.skip_non_blank();

        while is_alpha(self.look_ch()) {
            string.push(self.ch());
            self.skip_non_blank();
        }

        // Check if the trailing character is '!' and copy it.
        if self.ch() == 33 {
            string.push(self.ch());
            self.skip_non_blank();
        } else if directive && string != [33] {
            // It's either the '!' tag or not really a tag handle.  If it's a %TAG
            // directive, it's an error.  If it's a tag token, it must be a part of
            // URI.
            return Err(ScanError::new(
                *mark,
                "while parsing a tag directive, did not find expected '!'",
            ));
        }
        Ok(string)
    }

    fn scan_tag_prefix(&mut self, start_mark: &Marker) -> Result<Text, ScanError> {
        let mut string = Text::new();

        if self.look_ch() == 33 {
            // If we have a local tag, insert and skip `!`.
            string.push(self.ch());
            self.skip_non_blank();
        } else if !is_tag_char(self.ch()) {
            // Otherwise, check if the first global tag character is valid.
            return Err(ScanError::new(*start_mark, "invalid global tag character"));
        } else {
            // Otherwise, push the first character.
            string.push(self.ch());
            self.skip_non_blank();
        }

        while is_uri_char(self.look_ch()) {
            string.push(self.ch());
            self.skip_non_blank();
        }

        Ok(string)
    }

    fn scan_verbatim_tag(&mut self, start_mark: &Marker) -> Result<Text, ScanError> {
        // Eat `!<`
        self.skip_non_blank();
        self.skip_non_blank();

        let mut string = Text::new();
        while is_uri_char(self.look_ch()) {
            string.push(self.ch());
            self.skip_non_blank();
        }

        if self.ch() != 62 {
            return Err(ScanError::new(
                *start_mark,
                "while scanning a verbatim tag, did not find the expected '>'",
            ));
        }
        self.skip_non_blank();

        Ok(string)
    }

    fn scan_tag_shorthand_suffix(
        &mut self,
        _directive: bool,
        _is_secondary: bool,
        head: &Text,
        mark: &Marker,
    ) -> Result<Text, ScanError> {
        let mut length = head.len();
        let mut string = Text::new();

        // Copy the head if needed.
        // Note that we don't copy the leading '!' character.
        if length > 1 {
            string.extend(head.iter().copied().skip(1));
        }

        while is_tag_char(self.look_ch()) {
            // Check if it is a URI-escape sequence.
            string.push(self.ch());
            self.skip_non_blank();

            length += 1;
        }

        if length == 0 {
            return Err(ScanError::new(
                *mark,
                "while parsing a tag, did not find expected tag URI",
            ));
        }

        Ok(string)
    }

    fn fetch_anchor(&mut self, alias: bool) -> ScanResult {
        self.save_simple_key();
        self.disallow_simple_key();

        let tok = self.scan_anchor(alias)?;
        if !alias && matches!(self.ch(), 91 | 123) {
            return Err(ScanError::new(
                self.mark,
                "Tags and anchors must be separated from the next token by white space",
            ));
        }

        self.tokens.push_back(tok);

        Ok(())
    }

    fn scan_anchor(&mut self, alias: bool) -> Result<Token, ScanError> {
        let mut string = Text::new();
        let start_mark = self.mark;

        self.skip_non_blank();
        while is_anchor_char(self.look_ch()) {
            string.push(self.ch());
            self.skip_non_blank();
        }

        if string.is_empty() {
            return Err(ScanError::new(
                start_mark,
                "while scanning an anchor or alias, did not find expected alphabetic or numeric character",
            ));
        }

        if alias {
            Ok(Token(start_mark, TokenType::Alias(string)))
        } else {
            Ok(Token(start_mark, TokenType::Anchor(string)))
        }
    }

    fn fetch_flow_collection_start(&mut self, tok: TokenType) -> ScanResult {
        // The indicators '[' and '{' may start a simple key.
        self.save_simple_key();

        self.roll_one_col_indent();
        self.increase_flow_level()?;

        self.allow_simple_key();

        let start_mark = self.mark;
        self.skip_non_blank();

        if tok == TokenType::FlowMappingStart {
            self.flow_mapping_started = true;
        }

        self.skip_ws_to_eol(SkipTabs::Yes)?;

        self.tokens.push_back(Token(start_mark, tok));
        Ok(())
    }

    fn fetch_flow_collection_end(&mut self, tok: TokenType) -> ScanResult {
        self.remove_simple_key()?;
        self.decrease_flow_level();

        self.disallow_simple_key();

        self.end_implicit_mapping(self.mark);

        let start_mark = self.mark;
        self.skip_non_blank();
        self.skip_ws_to_eol(SkipTabs::Yes)?;

        // A flow collection within a flow mapping can be a key. In that case, the value may be
        // adjacent to the `:`.
        // ```yaml
        // - [ {a: b}:value ]
        // ```
        if self.flow_level > 0 {
            self.adjacent_value_allowed_at = self.mark.index;
        }

        self.tokens.push_back(Token(start_mark, tok));
        Ok(())
    }

    fn fetch_flow_entry(&mut self) -> ScanResult {
        self.remove_simple_key()?;
        self.allow_simple_key();

        self.end_implicit_mapping(self.mark);

        let start_mark = self.mark;
        self.skip_non_blank();
        self.skip_ws_to_eol(SkipTabs::Yes)?;

        self.tokens
            .push_back(Token(start_mark, TokenType::FlowEntry));
        Ok(())
    }

    fn increase_flow_level(&mut self) -> ScanResult {
        self.simple_keys.push(SimpleKey::new(Marker::new(0, 0, 0)));
        self.flow_level = self
            .flow_level
            .checked_add(1)
            .ok_or_else(|| ScanError::new(self.mark, "recursion limit exceeded"))?;
        Ok(())
    }

    fn decrease_flow_level(&mut self) {
        if self.flow_level > 0 {
            self.flow_level -= 1;
            self.simple_keys.pop().unwrap();
        }
    }

    fn fetch_block_entry(&mut self) -> ScanResult {
        if self.flow_level > 0 {
            // - * only allowed in block
            return Err(ScanError::new(
                self.mark,
                r#""-" is only valid inside a block"#,
            ));
        }
        // Check if we are allowed to start a new entry.
        if !self.simple_key_allowed {
            return Err(ScanError::new(
                self.mark,
                "block sequence entries are not allowed in this context",
            ));
        }

        // ???, fixes test G9HC.
        if let Some(Token(mark, TokenType::Anchor(..) | TokenType::Tag(..))) = self.tokens.back()
            && self.mark.col == 0
            && mark.col == 0
            && self.indent > -1
        {
            return Err(ScanError::new(*mark, "invalid indentation for anchor"));
        }

        // Skip over the `-`.
        let mark = self.mark;
        self.skip_non_blank();

        // generate BLOCK-SEQUENCE-START if indented
        self.roll_indent(mark.col, None, TokenType::BlockSequenceStart, mark);
        let found_tabs = self.skip_ws_to_eol(SkipTabs::Yes)?.found_tabs();
        self.lookahead(2);
        if found_tabs && self.buffer[0] == 45 && is_blank_or_breakz(self.buffer[1]) {
            return Err(ScanError::new(
                self.mark,
                "'-' must be followed by a valid YAML whitespace",
            ));
        }

        self.skip_ws_to_eol(SkipTabs::No)?;
        if is_break(self.look_ch()) || is_flow(self.ch()) {
            self.roll_one_col_indent();
        }

        self.remove_simple_key()?;
        self.allow_simple_key();

        self.tokens
            .push_back(Token(self.mark, TokenType::BlockEntry));

        Ok(())
    }

    fn fetch_document_indicator(&mut self, t: TokenType) -> ScanResult {
        self.unroll_indent(-1);
        self.remove_simple_key()?;
        self.disallow_simple_key();

        let mark = self.mark;

        self.skip_n_non_blank(3);

        self.tokens.push_back(Token(mark, t));
        Ok(())
    }

    fn fetch_block_scalar(&mut self, literal: bool) -> ScanResult {
        self.save_simple_key();
        self.allow_simple_key();
        let tok = self.scan_block_scalar(literal)?;

        self.tokens.push_back(tok);
        Ok(())
    }

    #[allow(clippy::too_many_lines)]
    fn scan_block_scalar(&mut self, literal: bool) -> Result<Token, ScanError> {
        let start_mark = self.mark;
        let mut chomping = Chomping::Clip;
        let mut increment: usize = 0;
        let mut indent: usize = 0;
        let mut trailing_blank: bool;
        let mut leading_blank: bool = false;
        let style = if literal {
            TScalarStyle::Literal
        } else {
            TScalarStyle::Folded
        };

        let mut string = Text::new();
        let mut leading_break = Text::new();
        let mut trailing_breaks = Text::new();
        let mut chomping_break = Text::new();

        // skip '|' or '>'
        self.skip_non_blank();
        self.unroll_non_block_indents();

        if self.look_ch() == 43 || self.ch() == 45 {
            if self.ch() == 43 {
                chomping = Chomping::Keep;
            } else {
                chomping = Chomping::Strip;
            }
            self.skip_non_blank();
            if is_digit(self.look_ch()) {
                if self.ch() == 48 {
                    return Err(ScanError::new(
                        start_mark,
                        "while scanning a block scalar, found an indentation indicator equal to 0",
                    ));
                }
                increment = usize::from(self.ch()) - 48;
                self.skip_non_blank();
            }
        } else if is_digit(self.ch()) {
            if self.ch() == 48 {
                return Err(ScanError::new(
                    start_mark,
                    "while scanning a block scalar, found an indentation indicator equal to 0",
                ));
            }

            increment = usize::from(self.ch()) - 48;
            self.skip_non_blank();
            self.lookahead(1);
            if self.ch() == 43 || self.ch() == 45 {
                if self.ch() == 43 {
                    chomping = Chomping::Keep;
                } else {
                    chomping = Chomping::Strip;
                }
                self.skip_non_blank();
            }
        }

        self.skip_ws_to_eol(SkipTabs::Yes)?;

        // Check if we are at the end of the line.
        if !is_breakz(self.look_ch()) {
            return Err(ScanError::new(
                start_mark,
                "while scanning a block scalar, did not find expected comment or line break",
            ));
        }

        if is_break(self.ch()) {
            self.lookahead(2);
            self.read_break(&mut chomping_break);
        }

        if self.look_ch() == 9 {
            return Err(ScanError::new(
                start_mark,
                "a block scalar content cannot start with a tab",
            ));
        }

        if increment > 0 {
            indent = if self.indent >= 0 {
                (self.indent + increment as isize) as usize
            } else {
                increment
            }
        }

        // Scan the leading line breaks and determine the indentation level if needed.
        if indent == 0 {
            self.skip_block_scalar_first_line_indent(&mut indent, &mut trailing_breaks);
        } else {
            self.skip_block_scalar_indent(indent, &mut trailing_breaks);
        }

        // We have an end-of-stream with no content, e.g.:
        // ```yaml
        // - |+
        // ```
        if is_z(self.ch()) {
            let contents = match chomping {
                Chomping::Strip | Chomping::Clip => Text::new(),
                Chomping::Keep => {
                    if self.mark.line > start_mark.line && self.mark.col > 0 {
                        trailing_breaks.push(10);
                    }
                    trailing_breaks
                }
            };
            return Ok(Token(start_mark, TokenType::Scalar(style, contents)));
        }

        if self.mark.col < indent && (self.mark.col as isize) > self.indent {
            return Err(ScanError::new(
                self.mark,
                "wrongly indented line in block scalar",
            ));
        }

        let mut line_buffer = Text::with_capacity(100);
        let start_mark = self.mark;
        while self.mark.col == indent && !is_z(self.ch()) {
            if indent == 0 {
                self.lookahead(4);
                if self.next_is_document_end() {
                    break;
                }
            }

            // We are at the first content character of a content line.
            trailing_blank = is_blank(self.ch());
            if !literal && !leading_break.is_empty() && !leading_blank && !trailing_blank {
                string.extend_from_slice(&trailing_breaks);
                if trailing_breaks.is_empty() {
                    string.push(32);
                }
            } else {
                string.extend_from_slice(&leading_break);
                string.extend_from_slice(&trailing_breaks);
            }

            leading_break.clear();
            trailing_breaks.clear();

            leading_blank = is_blank(self.ch());

            self.scan_block_scalar_content_line(&mut string, &mut line_buffer);

            // break on EOF
            if is_z(self.ch()) {
                break;
            }

            self.lookahead(2);
            self.read_break(&mut leading_break);

            // Eat the following indentation spaces and line breaks.
            self.skip_block_scalar_indent(indent, &mut trailing_breaks);
        }

        // Chomp the tail.
        if chomping != Chomping::Strip {
            string.extend_from_slice(&leading_break);
            // If we had reached an eof but the last character wasn't an end-of-line, check if the
            // last line was indented at least as the rest of the scalar, then we need to consider
            // there is a newline.
            if is_z(self.ch()) && self.mark.col >= indent.max(1) {
                string.push(10);
            }
        }

        if chomping == Chomping::Keep {
            string.extend_from_slice(&trailing_breaks);
        }

        Ok(Token(start_mark, TokenType::Scalar(style, string)))
    }

    fn scan_block_scalar_content_line(&mut self, string: &mut Text, line_buffer: &mut Text) {
        // Start by evaluating characters in the buffer.
        while !self.buffer.is_empty() && !is_breakz(self.ch()) {
            string.push(self.ch());
            // We may technically skip non-blank characters. However, the only distinction is
            // to determine what is leading whitespace and what is not. Here, we read the
            // contents of the line until either eof or a linebreak. We know we will not read
            // `self.leading_whitespace` until the end of the line, where it will be reset.
            // This allows us to call a slightly less expensive function.
            self.skip_blank();
        }

        // All characters that were in the buffer were consumed. We need to check if more
        // follow.
        if self.buffer.is_empty() {
            // We will read all consecutive non-breakz characters. We push them into a
            // temporary buffer. The main difference with going through `self.buffer` is that
            // characters are appended here as their real size (1B for ascii, or up to 4 bytes for
            // UTF-8). We can then use the internal `line_buffer` `Vec` to push data into `string`
            // (using `Text::push_str`).
            let mut c = self.raw_read_ch();
            while !is_breakz(c) {
                line_buffer.push(c);
                c = self.raw_read_ch();
            }

            // Our last character read is stored in `c`. It is either an EOF or a break. In any
            // case, we need to push it back into `self.buffer` so it may be properly read
            // after. We must not insert it in `string`.
            self.buffer.push_back(c);

            // We need to manually update our position; we haven't called a `skip` function.
            self.mark.col += line_buffer.len();
            self.mark.index += line_buffer.len();

            // We can now append our bytes to our `string`.
            string.reserve(line_buffer.len());
            string.extend_from_slice(line_buffer);
            // This clears the _contents_ without touching the _capacity_.
            line_buffer.clear();
        }
    }

    fn skip_block_scalar_indent(&mut self, indent: usize, breaks: &mut Text) {
        loop {
            // Consume all spaces. Tabs cannot be used as indentation.
            if indent < BUFFER_LEN - 2 {
                self.lookahead(BUFFER_LEN);
                while self.mark.col < indent && self.ch() == 32 {
                    self.skip_blank();
                }
            } else {
                loop {
                    self.lookahead(BUFFER_LEN);
                    while !self.buffer.is_empty() && self.mark.col < indent && self.ch() == 32 {
                        self.skip_blank();
                    }
                    // If we reached our indent, we can break. We must also break if we have
                    // reached content or EOF; that is, the buffer is not empty and the next
                    // character is not a space.
                    if self.mark.col == indent || (!self.buffer.is_empty() && self.ch() != 32) {
                        break;
                    }
                }
                self.lookahead(2);
            }

            // If our current line is empty, skip over the break and continue looping.
            if is_break(self.ch()) {
                self.read_break(breaks);
            } else {
                // Otherwise, we have a content line. Return control.
                break;
            }
        }
    }

    fn skip_block_scalar_first_line_indent(&mut self, indent: &mut usize, breaks: &mut Text) {
        let mut max_indent = 0;
        loop {
            // Consume all spaces. Tabs cannot be used as indentation.
            while self.look_ch() == 32 {
                self.skip_blank();
            }

            if self.mark.col > max_indent {
                max_indent = self.mark.col;
            }

            if is_break(self.ch()) {
                // If our current line is empty, skip over the break and continue looping.
                self.lookahead(2);
                self.read_break(breaks);
            } else {
                // Otherwise, we have a content line. Return control.
                break;
            }
        }

        // In case a yaml looks like:
        // ```yaml
        // |
        // foo
        // bar
        // ```
        // We need to set the indent to 0 and not 1. In all other cases, the indent must be at
        // least 1. When in the above example, `self.indent` will be set to -1.
        *indent = max_indent.max((self.indent + 1) as usize);
        if self.indent > 0 {
            *indent = (*indent).max(1);
        }
    }

    fn fetch_flow_scalar(&mut self, single: bool) -> ScanResult {
        self.save_simple_key();
        self.disallow_simple_key();

        let tok = self.scan_flow_scalar(single)?;

        // From spec: To ensure JSON compatibility, if a key inside a flow mapping is JSON-like,
        // YAML allows the following value to be specified adjacent to the “:”.
        self.skip_to_next_token()?;
        self.adjacent_value_allowed_at = self.mark.index;

        self.tokens.push_back(tok);
        Ok(())
    }

    #[allow(clippy::too_many_lines)]
    fn scan_flow_scalar(&mut self, single: bool) -> Result<Token, ScanError> {
        let start_mark = self.mark;

        let mut string = Text::new();
        let mut leading_break = Text::new();
        let mut trailing_breaks = Text::new();
        let mut whitespaces = Text::new();
        let mut leading_blanks;

        /* Eat the left quote. */
        self.skip_non_blank();

        loop {
            /* Check for a document indicator. */
            self.lookahead(4);

            if self.mark.col == 0
                && (((self.buffer[0] == 45) && (self.buffer[1] == 45) && (self.buffer[2] == 45))
                    || ((self.buffer[0] == 46) && (self.buffer[1] == 46) && (self.buffer[2] == 46)))
                && is_blank_or_breakz(self.buffer[3])
            {
                return Err(ScanError::new(
                    start_mark,
                    "while scanning a quoted scalar, found unexpected document indicator",
                ));
            }

            if is_z(self.ch()) {
                return Err(ScanError::new(
                    start_mark,
                    "while scanning a quoted scalar, found unexpected end of stream",
                ));
            }

            if (self.mark.col as isize) < self.indent {
                return Err(ScanError::new(
                    start_mark,
                    "invalid indentation in quoted scalar",
                ));
            }

            leading_blanks = false;
            self.consume_flow_scalar_non_whitespace_chars(
                single,
                &mut string,
                &mut leading_blanks,
                &start_mark,
            )?;

            match self.look_ch() {
                39 if single => break,
                34 if !single => break,
                _ => {}
            }

            // Consume blank characters.
            while is_blank(self.ch()) || is_break(self.ch()) {
                if is_blank(self.ch()) {
                    // Consume a space or a tab character.
                    if leading_blanks {
                        if self.ch() == 9 && (self.mark.col as isize) < self.indent {
                            return Err(ScanError::new(
                                self.mark,
                                "tab cannot be used as indentation",
                            ));
                        }
                        self.skip_blank();
                    } else {
                        whitespaces.push(self.ch());
                        self.skip_blank();
                    }
                } else {
                    self.lookahead(2);
                    // Check if it is a first line break.
                    if leading_blanks {
                        self.read_break(&mut trailing_breaks);
                    } else {
                        whitespaces.clear();
                        self.read_break(&mut leading_break);
                        leading_blanks = true;
                    }
                }
                self.lookahead(1);
            }

            // Join the whitespaces or fold line breaks.
            if leading_blanks {
                if leading_break.is_empty() {
                    string.extend_from_slice(&leading_break);
                    string.extend_from_slice(&trailing_breaks);
                    trailing_breaks.clear();
                    leading_break.clear();
                } else {
                    if trailing_breaks.is_empty() {
                        string.push(32);
                    } else {
                        string.extend_from_slice(&trailing_breaks);
                        trailing_breaks.clear();
                    }
                    leading_break.clear();
                }
            } else {
                string.extend_from_slice(&whitespaces);
                whitespaces.clear();
            }
        } // loop

        // Eat the right quote.
        self.skip_non_blank();
        // Ensure there is no invalid trailing content.
        self.skip_ws_to_eol(SkipTabs::Yes)?;
        match self.ch() {
            // These can be encountered in flow sequences or mappings.
            44 | 125 | 93 if self.flow_level > 0 => {}
            // An end-of-line / end-of-stream is fine. No trailing content.
            c if is_breakz(c) => {}
            // ':' can be encountered if our scalar is a key.
            // Outside of flow contexts, keys cannot span multiple lines
            58 if self.flow_level == 0 && start_mark.line == self.mark.line => {}
            // Inside a flow context, this is allowed.
            58 if self.flow_level > 0 => {}
            _ => {
                return Err(ScanError::new(
                    self.mark,
                    "invalid trailing content after double-quoted scalar",
                ));
            }
        }

        let style = if single {
            TScalarStyle::SingleQuoted
        } else {
            TScalarStyle::DoubleQuoted
        };
        Ok(Token(start_mark, TokenType::Scalar(style, string)))
    }

    fn consume_flow_scalar_non_whitespace_chars(
        &mut self,
        single: bool,
        string: &mut Text,
        leading_blanks: &mut bool,
        start_mark: &Marker,
    ) -> Result<(), ScanError> {
        self.lookahead(2);
        while !is_blank_or_breakz(self.ch()) {
            match self.ch() {
                // Check for an escaped single quote.
                39 if self.buffer[1] == 39 && single => {
                    string.push(39);
                    self.skip_n_non_blank(2);
                }
                // Check for the right quote.
                39 if single => break,
                34 if !single => break,
                // Check for an escaped line break.
                92 if !single && is_break(self.buffer[1]) => {
                    self.lookahead(3);
                    self.skip_non_blank();
                    self.skip_linebreak();
                    *leading_blanks = true;
                    break;
                }
                // Check for an escape sequence.
                92 if !single => {
                    string
                        .extend_from_slice(&self.resolve_flow_scalar_escape_sequence(start_mark)?);
                }
                c => {
                    string.push(c);
                    self.skip_non_blank();
                }
            }
            self.lookahead(2);
        }
        Ok(())
    }

    fn resolve_flow_scalar_escape_sequence(
        &mut self,
        start_mark: &Marker,
    ) -> Result<Text, ScanError> {
        let mut code_length = 0usize;
        let mut ret = 0;

        match self.buffer[1] {
            48 => ret = 0,
            97 => ret = 7,
            98 => ret = 8,
            116 | 9 => ret = 9,
            110 => ret = 10,
            118 => ret = 11,
            102 => ret = 12,
            114 => ret = 13,
            101 => ret = 27,
            32 => ret = 32,
            34 => ret = 34,
            47 => ret = 47,
            92 => ret = 92,
            // Unicode next line (#x85)
            78 => ret = 0x85,
            // Unicode non-breaking space (#xA0)
            95 => ret = 0xA0,
            // Unicode line separator (#x2028)
            76 => ret = 0x2028,
            // Unicode paragraph separator (#x2029)
            80 => ret = 0x2029,
            120 => code_length = 2,
            117 => code_length = 4,
            85 => code_length = 8,
            _ => {
                return Err(ScanError::new(
                    *start_mark,
                    "while parsing a quoted scalar, found unknown escape character",
                ));
            }
        }
        self.skip_n_non_blank(2);

        // Consume an arbitrary escape code.
        if code_length > 0 {
            self.lookahead(code_length);
            let mut value = 0u32;
            for i in 0..code_length {
                if !is_hex(self.buffer[i]) {
                    return Err(ScanError::new(
                        *start_mark,
                        "while parsing a quoted scalar, did not find expected hexadecimal number",
                    ));
                }
                value = (value << 4) + as_hex(self.buffer[i]);
            }

            self.skip_n_non_blank(code_length);
            if value <= 65535 {
                return Ok(vec![value as u16]);
            }
            let Some(ch) = char::from_u32(value) else {
                return Err(ScanError::new(
                    *start_mark,
                    "invalid Unicode character escape code",
                ));
            };
            return Ok(units(ch.to_string().as_str()));
        }
        Ok(vec![ret])
    }

    fn fetch_plain_scalar(&mut self) -> ScanResult {
        self.save_simple_key();
        self.disallow_simple_key();

        let tok = self.scan_plain_scalar()?;

        self.tokens.push_back(tok);
        Ok(())
    }

    #[allow(clippy::too_many_lines)]
    fn scan_plain_scalar(&mut self) -> Result<Token, ScanError> {
        self.unroll_non_block_indents();
        let indent = self.indent + 1;
        let start_mark = self.mark;

        if self.flow_level > 0 && (start_mark.col as isize) < indent {
            return Err(ScanError::new(
                start_mark,
                "invalid indentation in flow construct",
            ));
        }

        let mut string = Text::with_capacity(32);
        let mut leading_break = Text::with_capacity(32);
        let mut trailing_breaks = Text::with_capacity(32);
        let mut whitespaces = Text::with_capacity(32);

        loop {
            self.lookahead(4);
            if self.next_is_document_indicator() || self.ch() == 35 {
                break;
            }

            if self.flow_level > 0 && self.ch() == 45 && is_flow(self.buffer[1]) {
                return Err(ScanError::new(
                    self.mark,
                    "plain scalar cannot start with '-' followed by ,[]{}",
                ));
            }

            if !is_blank_or_breakz(self.ch()) && self.next_can_be_plain_scalar() {
                if self.leading_whitespace {
                    if leading_break.is_empty() {
                        string.extend_from_slice(&leading_break);
                        string.extend_from_slice(&trailing_breaks);
                        trailing_breaks.clear();
                        leading_break.clear();
                    } else {
                        if trailing_breaks.is_empty() {
                            string.push(32);
                        } else {
                            string.extend_from_slice(&trailing_breaks);
                            trailing_breaks.clear();
                        }
                        leading_break.clear();
                    }
                    self.leading_whitespace = false;
                } else if !whitespaces.is_empty() {
                    string.extend_from_slice(&whitespaces);
                    whitespaces.clear();
                }

                // We can unroll the first iteration of the loop.
                string.push(self.ch());
                self.skip_non_blank();
                self.lookahead(2);

                // Add content non-blank characters to the scalar.
                while !is_blank_or_breakz(self.ch()) {
                    if !self.next_can_be_plain_scalar() {
                        break;
                    }

                    string.push(self.ch());
                    self.skip_non_blank();
                    self.lookahead(2);
                }
            }

            // We may reach the end of a plain scalar if:
            //  - We reach eof
            //  - We reach ": "
            //  - We find a flow character in a flow context
            if !(is_blank(self.ch()) || is_break(self.ch())) {
                break;
            }

            // Process blank characters.
            while is_blank(self.look_ch()) || is_break(self.ch()) {
                if is_blank(self.ch()) {
                    if !self.leading_whitespace {
                        whitespaces.push(self.ch());
                        self.skip_blank();
                    } else if (self.mark.col as isize) < indent && self.ch() == 9 {
                        // Tabs in an indentation columns are allowed if and only if the line is
                        // empty. Skip to the end of the line.
                        self.skip_ws_to_eol(SkipTabs::Yes)?;
                        if !is_breakz(self.ch()) {
                            return Err(ScanError::new(
                                start_mark,
                                "while scanning a plain scalar, found a tab",
                            ));
                        }
                    } else {
                        self.skip_blank();
                    }
                } else {
                    self.lookahead(2);
                    // Check if it is a first line break
                    if self.leading_whitespace {
                        self.read_break(&mut trailing_breaks);
                    } else {
                        whitespaces.clear();
                        self.read_break(&mut leading_break);
                        self.leading_whitespace = true;
                    }
                }
            }

            // check indentation level
            if self.flow_level == 0 && (self.mark.col as isize) < indent {
                break;
            }
        }

        if self.leading_whitespace {
            self.allow_simple_key();
        }

        Ok(Token(
            start_mark,
            TokenType::Scalar(TScalarStyle::Plain, string),
        ))
    }

    fn fetch_key(&mut self) -> ScanResult {
        let start_mark = self.mark;
        if self.flow_level == 0 {
            // Check if we are allowed to start a new key (not necessarily simple).
            if !self.simple_key_allowed {
                return Err(ScanError::new(
                    self.mark,
                    "mapping keys are not allowed in this context",
                ));
            }
            self.roll_indent(
                start_mark.col,
                None,
                TokenType::BlockMappingStart,
                start_mark,
            );
        } else {
            // The parser, upon receiving a `Key`, will insert a `MappingStart` event.
            self.flow_mapping_started = true;
        }

        self.remove_simple_key()?;

        if self.flow_level == 0 {
            self.allow_simple_key();
        } else {
            self.disallow_simple_key();
        }

        self.skip_non_blank();
        self.skip_yaml_whitespace()?;
        if self.ch() == 9 {
            return Err(ScanError::new(
                self.mark(),
                "tabs disallowed in this context",
            ));
        }
        self.tokens.push_back(Token(start_mark, TokenType::Key));
        Ok(())
    }

    fn fetch_value(&mut self) -> ScanResult {
        let sk = self.simple_keys.last().unwrap().clone();
        let start_mark = self.mark;
        self.implicit_flow_mapping = self.flow_level > 0 && !self.flow_mapping_started;

        // Skip over ':'.
        self.skip_non_blank();
        if self.look_ch() == 9
            && !self.skip_ws_to_eol(SkipTabs::Yes)?.has_valid_yaml_ws()
            && (self.ch() == 45 || is_alpha(self.ch()))
        {
            return Err(ScanError::new(
                self.mark,
                "':' must be followed by a valid YAML whitespace",
            ));
        }

        if sk.possible {
            // insert simple key
            let tok = Token(sk.mark, TokenType::Key);
            self.insert_token(sk.token_number - self.tokens_parsed, tok);
            if self.implicit_flow_mapping {
                if sk.mark.line < start_mark.line {
                    return Err(ScanError::new(
                        start_mark,
                        "illegal placement of ':' indicator",
                    ));
                }
                self.insert_token(
                    sk.token_number - self.tokens_parsed,
                    Token(self.mark, TokenType::FlowMappingStart),
                );
            }

            // Add the BLOCK-MAPPING-START token if needed.
            self.roll_indent(
                sk.mark.col,
                Some(sk.token_number),
                TokenType::BlockMappingStart,
                start_mark,
            );
            self.roll_one_col_indent();

            self.simple_keys.last_mut().unwrap().possible = false;
            self.disallow_simple_key();
        } else {
            if self.implicit_flow_mapping {
                self.tokens
                    .push_back(Token(self.mark, TokenType::FlowMappingStart));
            }
            // The ':' indicator follows a complex key.
            if self.flow_level == 0 {
                if !self.simple_key_allowed {
                    return Err(ScanError::new(
                        start_mark,
                        "mapping values are not allowed in this context",
                    ));
                }

                self.roll_indent(
                    start_mark.col,
                    None,
                    TokenType::BlockMappingStart,
                    start_mark,
                );
            }
            self.roll_one_col_indent();

            if self.flow_level == 0 {
                self.allow_simple_key();
            } else {
                self.disallow_simple_key();
            }
        }
        self.tokens.push_back(Token(start_mark, TokenType::Value));

        Ok(())
    }

    fn roll_indent(&mut self, col: usize, number: Option<usize>, tok: TokenType, mark: Marker) {
        if self.flow_level > 0 {
            return;
        }

        // If the last indent was a non-block indent, remove it.
        // This means that we prepared an indent that we thought we wouldn't use, but realized just
        // now that it is a block indent.
        if self.indent <= col as isize
            && let Some(indent) = self.indents.last()
            && !indent.needs_block_end
        {
            self.indent = indent.indent;
            self.indents.pop();
        }

        if self.indent < col as isize {
            self.indents.push(Indent {
                indent: self.indent,
                needs_block_end: true,
            });
            self.indent = col as isize;
            let tokens_parsed = self.tokens_parsed;
            match number {
                Some(n) => self.insert_token(n - tokens_parsed, Token(mark, tok)),
                None => self.tokens.push_back(Token(mark, tok)),
            }
        }
    }

    fn unroll_indent(&mut self, col: isize) {
        if self.flow_level > 0 {
            return;
        }
        while self.indent > col {
            let indent = self.indents.pop().unwrap();
            self.indent = indent.indent;
            if indent.needs_block_end {
                self.tokens.push_back(Token(self.mark, TokenType::BlockEnd));
            }
        }
    }

    fn roll_one_col_indent(&mut self) {
        if self.flow_level == 0
            && self
                .indents
                .last()
                .is_some_and(|indent| indent.needs_block_end)
        {
            self.indents.push(Indent {
                indent: self.indent,
                needs_block_end: false,
            });
            self.indent += 1;
        }
    }

    fn unroll_non_block_indents(&mut self) {
        while let Some(indent) = self.indents.last() {
            if indent.needs_block_end {
                break;
            }
            self.indent = indent.indent;
            self.indents.pop();
        }
    }

    fn save_simple_key(&mut self) {
        if self.simple_key_allowed {
            let required = self.flow_level == 0
                && self.indent == (self.mark.col as isize)
                && self.indents.last().unwrap().needs_block_end;
            let mut sk = SimpleKey::new(self.mark);
            sk.possible = true;
            sk.required = required;
            sk.token_number = self.tokens_parsed + self.tokens.len();

            self.simple_keys.pop();
            self.simple_keys.push(sk);
        }
    }

    fn remove_simple_key(&mut self) -> ScanResult {
        let last = self.simple_keys.last_mut().unwrap();
        if last.possible && last.required {
            return Err(ScanError::new(self.mark, "simple key expected"));
        }

        last.possible = false;
        Ok(())
    }

    // For some reason, `#[inline]` is not enough.
    #[allow(clippy::inline_always)]
    #[inline(always)]
    fn next_can_be_plain_scalar(&self) -> bool {
        match self.ch() {
            // indicators can end a plain scalar, see 7.3.3. Plain Style
            58 if is_blank_or_breakz(self.buffer[1])
                || (self.flow_level > 0 && is_flow(self.buffer[1])) =>
            {
                false
            }
            c if self.flow_level > 0 && is_flow(c) => false,
            _ => true,
        }
    }

    fn is_within_block(&self) -> bool {
        !self.indents.is_empty()
    }

    fn end_implicit_mapping(&mut self, mark: Marker) {
        if self.implicit_flow_mapping {
            self.implicit_flow_mapping = false;
            self.flow_mapping_started = false;
            self.tokens
                .push_back(Token(mark, TokenType::FlowMappingEnd));
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum SkipTabs {
    Yes,
    No,
    Result(bool, bool),
}

impl SkipTabs {
    fn found_tabs(self) -> bool {
        matches!(self, SkipTabs::Result(true, _))
    }

    fn has_valid_yaml_ws(self) -> bool {
        matches!(self, SkipTabs::Result(_, true))
    }
}

#[derive(PartialEq, Eq)]
pub enum Chomping {
    Strip,
    Clip,
    Keep,
}
