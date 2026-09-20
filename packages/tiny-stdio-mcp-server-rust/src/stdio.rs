#[derive(Debug, PartialEq, Eq)]
pub enum InputError {
    InvalidUtf8,
    LineLimit,
    Closed,
    InvalidLimit,
}

pub struct LineInput {
    max_bytes: usize,
    line_bytes: usize,
    pending: Vec<u16>,
    utf8: Vec<u8>,
    trailing_high_surrogate: bool,
    after_cr: bool,
    closed: bool,
}

impl LineInput {
    pub fn new(max_bytes: usize) -> Result<Self, InputError> {
        if max_bytes == 0 {
            return Err(InputError::InvalidLimit);
        }
        Ok(Self {
            max_bytes,
            line_bytes: 0,
            pending: Vec::new(),
            utf8: Vec::with_capacity(4),
            trailing_high_surrogate: false,
            after_cr: false,
            closed: false,
        })
    }

    pub fn push_bytes(
        &mut self,
        input: &[u8],
        mut line: impl FnMut(Vec<u16>),
    ) -> Result<(), InputError> {
        if self.closed {
            return Err(InputError::Closed);
        }
        self.trailing_high_surrogate = false;
        for byte in input {
            if *byte < 128 && self.utf8.is_empty() {
                if *byte == 10 || *byte == 13 {
                    self.end_line(*byte as u16, &mut line);
                } else {
                    self.charge(1)?;
                    self.after_cr = false;
                    self.pending.push(*byte as u16);
                }
                continue;
            }
            self.charge(1)?;
            self.after_cr = false;
            self.utf8.push(*byte);
            match std::str::from_utf8(&self.utf8) {
                Ok(text) => {
                    self.pending.extend(text.encode_utf16());
                    self.utf8.clear();
                }
                Err(error) if error.error_len().is_none() => {}
                Err(_) => {
                    self.closed = true;
                    return Err(InputError::InvalidUtf8);
                }
            }
        }
        Ok(())
    }

    pub fn push_utf16(
        &mut self,
        input: &[u16],
        mut line: impl FnMut(Vec<u16>),
    ) -> Result<(), InputError> {
        if self.closed {
            return Err(InputError::Closed);
        }
        if !self.utf8.is_empty() {
            self.closed = true;
            return Err(InputError::InvalidUtf8);
        }
        for unit in input {
            if *unit == 10 || *unit == 13 {
                self.end_line(*unit, &mut line);
                continue;
            }
            let width = if *unit <= 0x7f
                || (self.trailing_high_surrogate && (0xdc00..=0xdfff).contains(unit))
            {
                1
            } else if *unit <= 0x7ff {
                2
            } else {
                3
            };
            self.charge(width)?;
            self.trailing_high_surrogate = (0xd800..=0xdbff).contains(unit);
            self.after_cr = false;
            self.pending.push(*unit);
        }
        Ok(())
    }

    pub fn finish(&mut self, mut line: impl FnMut(Vec<u16>)) -> Result<(), InputError> {
        if self.closed {
            return Err(InputError::Closed);
        }
        self.closed = true;
        if !self.utf8.is_empty() {
            return Err(InputError::InvalidUtf8);
        }
        if !self.pending.is_empty() {
            line(std::mem::take(&mut self.pending));
        }
        Ok(())
    }

    pub fn abort(&mut self) {
        self.closed = true;
        self.pending = Vec::new();
        self.utf8.clear();
        self.line_bytes = 0;
    }

    fn charge(&mut self, width: usize) -> Result<(), InputError> {
        if width > self.max_bytes - self.line_bytes {
            self.closed = true;
            return Err(InputError::LineLimit);
        }
        self.line_bytes += width;
        Ok(())
    }

    fn end_line(&mut self, unit: u16, line: &mut impl FnMut(Vec<u16>)) {
        self.line_bytes = 0;
        self.trailing_high_surrogate = false;
        if unit != 10 || !self.after_cr {
            line(std::mem::take(&mut self.pending));
        }
        self.after_cr = unit == 13;
    }
}

impl std::fmt::Display for InputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidUtf8 => "Invalid UTF-8 stdio input",
            Self::LineLimit => "Stdio input line byte limit exceeded",
            Self::Closed => "Stdio input is closed",
            Self::InvalidLimit => "Stdio input line capacity must be positive",
        })
    }
}

impl std::error::Error for InputError {}
