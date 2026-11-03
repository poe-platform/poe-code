// Block starts and line breaks are delayed until there is content to indent.
#[derive(Clone, Copy)]
pub(super) enum Block {
    Plain,
    Quote,
    Indent(usize),
}

pub(super) struct Writer {
    output: String,
    blocks: Vec<Block>,
    active: usize,
    newlines: usize,
    pre: bool,
    width: Option<usize>,
    word: Vec<char>,
    written: usize,
    first: bool,
    margin: usize,
}

impl Writer {
    pub(super) fn new(width: Option<u64>) -> Self {
        Self {
            output: String::new(),
            blocks: Vec::new(),
            active: 0,
            newlines: 0,
            pre: false,
            width: width.map(|w| usize::try_from(w).unwrap_or(usize::MAX)),
            word: Vec::new(),
            written: 0,
            first: true,
            margin: 0,
        }
    }

    fn indent(&mut self, start: usize, end: usize, include_indents: bool, trailing: bool) -> usize {
        let mut written = 0;
        let mut spaces = 0;
        for block in &self.blocks[start..end] {
            match block {
                Block::Quote => {
                    self.output.extend(std::iter::repeat_n(' ', spaces));
                    self.output.push('>');
                    written += spaces + 1;
                    spaces = 1;
                }
                Block::Indent(n) if include_indents => spaces += n,
                _ => {}
            }
        }
        if trailing {
            self.output.extend(std::iter::repeat_n(' ', spaces));
            written += spaces;
        }
        written
    }

    fn ensure_lines(&mut self, count: usize) {
        if !self.output.is_empty() {
            self.newlines = if self.pre {
                self.newlines + count
            } else {
                count
            };
        }
    }

    fn prepare(&mut self, newline: bool, trailing: bool) -> usize {
        let pending = self.blocks.get(self.active);
        let starts_indent = matches!(pending, Some(Block::Indent(_)));
        if pending.is_some() && !starts_indent && !self.output.is_empty() {
            self.newlines = self.newlines.max(2);
        }
        if newline {
            if !starts_indent {
                self.ensure_lines(1);
            }
            return 0;
        }
        let full = self.newlines != 0 || self.output.is_empty();
        if self.newlines != 0 {
            for _ in 1..self.newlines {
                self.output.push('\n');
                self.indent(0, self.active, true, false);
            }
            self.output.push('\n');
            self.newlines = 0;
        }
        let end = self.blocks.len();
        let padding = if full {
            let prefix = self.blocks[self.active..]
                .iter()
                .position(|b| matches!(b, Block::Indent(_)))
                .map_or(end, |i| self.active + i);
            self.indent(0, prefix, true, trailing)
        } else {
            self.indent(self.active, end, false, trailing)
        };
        self.active = end;
        padding
    }

    fn drain_word(&mut self, space: bool) {
        if self.word.is_empty() {
            return;
        }
        if space {
            self.output.push(' ');
            self.written += 1;
        }
        self.written += self.word.len();
        self.output.extend(self.word.drain(..));
    }

    fn wrap_line(&mut self) {
        self.output.push('\n');
        self.margin = self.indent(0, self.active, true, true);
        self.written = 0;
        self.first = true;
        self.drain_word(false);
    }

    pub(super) fn write(&mut self, text: &str, wrap: bool) {
        for c in text.chars() {
            let pad = self.prepare(c == '\n', true);
            self.margin += pad;
            if c == '\n' {
                continue;
            }
            let limit = self.width.unwrap_or(0).saturating_sub(self.margin);
            if wrap && self.width.is_some() && c.is_whitespace() {
                if self.written == 0 {
                    continue;
                }
                if !self.word.is_empty() && self.written + self.word.len() >= limit {
                    self.wrap_line();
                } else {
                    self.drain_word(true);
                    self.first = false;
                }
            } else if self.first {
                self.output.push(c);
                self.written += 1;
            } else if self.written + self.word.len() + 2 > limit {
                self.wrap_line();
                self.output.push(c);
                self.written += 1;
            } else {
                self.word.push(c);
            }
        }
    }

    pub(super) fn block(&mut self, kind: Block, body: impl FnOnce(&mut Self)) {
        self.blocks.push(kind);
        body(self);
        if !self.word.is_empty() {
            self.prepare(false, true);
            self.drain_word(true);
        }
        self.written = 0;
        self.margin = 0;
        self.first = true;
        if self.blocks.len() > self.active {
            self.prepare(false, false);
        }
        self.blocks.pop();
        self.active = self.blocks.len();
        self.ensure_lines(if matches!(kind, Block::Indent(_)) {
            1
        } else {
            2
        });
    }

    pub(super) fn pre(&mut self, text: &str) {
        self.block(Block::Plain, |w| {
            w.pre = true;
            w.write(text, false);
            w.prepare(false, !w.word.is_empty());
            w.pre = false;
        });
    }

    pub(super) fn finish(mut self) -> String {
        if self.newlines != 0 {
            self.output.push('\n');
        }
        self.output
    }
}
