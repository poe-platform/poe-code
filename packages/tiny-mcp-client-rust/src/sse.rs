//! Bounded UTF-16 SSE framing. Host code owns network byte decoding and I/O.
#[derive(Debug, PartialEq)]
pub struct SseMessage {
    pub data: Vec<u16>,
    pub id: Option<Vec<u16>>,
    pub event: Option<Vec<u16>>,
}
pub struct SseParser {
    max_event_bytes: usize,
    accept_endpoint: bool,
    accept_all: bool,
    buffer: Vec<u16>,
    buffer_bytes: usize,
    skip_lf: bool,
    event_type: Option<Vec<u16>>,
    event_type_bytes: usize,
    data: Vec<u16>,
    has_data: bool,
    data_bytes: usize,
    event_id: Vec<u16>,
    event_id_bytes: usize,
    has_event_id: bool,
    last_event_id: Option<Vec<u16>>,
}
fn utf8_bytes(text: &[u16]) -> usize {
    char::decode_utf16(text.iter().copied())
        .map(|point| point.map_or(3, char::len_utf8))
        .sum()
}
fn text_is(text: &[u16], expected: &str) -> bool {
    text.iter().copied().eq(expected.encode_utf16())
}
impl SseParser {
    pub fn new(max_event_bytes: usize) -> Result<Self, String> {
        if max_event_bytes == 0 || max_event_bytes as u64 > 9_007_199_254_740_991 {
            return Err("SSE event byte limit must be a positive safe integer".into());
        }
        Ok(Self {
            max_event_bytes,
            accept_endpoint: false,
            accept_all: false,
            buffer: Vec::new(),
            buffer_bytes: 0,
            skip_lf: false,
            event_type: None,
            event_type_bytes: 0,
            data: Vec::new(),
            has_data: false,
            data_bytes: 0,
            event_id: Vec::new(),
            event_id_bytes: 0,
            has_event_id: false,
            last_event_id: None,
        })
    }
    pub fn with_endpoint_events(mut self) -> Self {
        self.accept_endpoint = true;
        self
    }
    /// Emit all named SSE events for typed streaming protocols.
    pub fn with_all_events(mut self) -> Self {
        self.accept_all = true;
        self
    }
    pub fn last_event_id(&self) -> Option<Vec<u16>> {
        self.last_event_id.clone()
    }
    fn limit_error(&self) -> String {
        format!("SSE event exceeds {} bytes", self.max_event_bytes)
    }
    fn append(&mut self, text: &[u16]) -> Result<(), String> {
        let correction = if matches!(self.buffer.last(), Some(0xd800..=0xdbff))
            && matches!(text.first(), Some(0xdc00..=0xdfff))
        {
            2
        } else {
            0
        };
        let bytes = self
            .buffer_bytes
            .checked_add(utf8_bytes(text))
            .and_then(|bytes| bytes.checked_sub(correction))
            .ok_or_else(|| self.limit_error())?;
        if bytes > self.max_event_bytes {
            return Err(self.limit_error());
        }
        self.buffer.extend_from_slice(text);
        self.buffer_bytes = bytes;
        Ok(())
    }
    fn assert_size(&self) -> Result<(), String> {
        let metadata = self.event_type_bytes + self.event_id_bytes;
        if self
            .data_bytes
            .checked_add(metadata)
            .and_then(|bytes| bytes.checked_add(self.buffer_bytes))
            .is_none_or(|bytes| bytes > self.max_event_bytes)
        {
            return Err(self.limit_error());
        }
        Ok(())
    }
    pub fn push(&mut self, chunk: &[u16]) -> Result<Vec<SseMessage>, String> {
        let result = self.push_chunk(chunk);
        if result.is_err() {
            self.flush();
        }
        result
    }
    fn push_chunk(&mut self, mut chunk: &[u16]) -> Result<Vec<SseMessage>, String> {
        let mut messages = Vec::new();
        if chunk.is_empty() {
            return Ok(messages);
        }
        if self.skip_lf {
            self.skip_lf = false;
            if chunk.first() == Some(&10) {
                chunk = &chunk[1..];
            }
        }
        while let Some(index) = chunk.iter().position(|unit| *unit == 10 || *unit == 13) {
            self.append(&chunk[..index])?;
            let separator = chunk[index];
            chunk = &chunk[index + 1..];
            if separator == 13 {
                if chunk.first() == Some(&10) {
                    chunk = &chunk[1..];
                } else if chunk.is_empty() {
                    self.skip_lf = true;
                }
            }
            let line = std::mem::take(&mut self.buffer);
            self.buffer_bytes = 0;
            self.consume_line(&line, &mut messages);
            self.assert_size()?;
        }
        self.append(chunk)?;
        self.assert_size()?;
        Ok(messages)
    }
    fn consume_line(&mut self, line: &[u16], messages: &mut Vec<SseMessage>) {
        if line.is_empty() {
            if self.has_event_id {
                self.last_event_id = Some(self.event_id.clone());
            }
            if self.has_data
                && (self.accept_all
                    || self.event_type.as_ref().is_none_or(|event| {
                        text_is(event, "message")
                            || (self.accept_endpoint && text_is(event, "endpoint"))
                    }))
            {
                messages.push(SseMessage {
                    data: std::mem::take(&mut self.data),
                    id: self.has_event_id.then(|| self.event_id.clone()),
                    event: self
                        .event_type
                        .as_ref()
                        .filter(|event| self.accept_all || text_is(event, "endpoint"))
                        .cloned(),
                });
            }
            self.reset_event();
            return;
        }
        if line.first() == Some(&58) {
            return;
        }
        let index = line.iter().position(|unit| *unit == 58);
        let field = index.map_or(line, |index| &line[..index]);
        let mut value = index.map_or(&[][..], |index| &line[index + 1..]);
        if value.first() == Some(&32) {
            value = &value[1..];
        }
        if text_is(field, "event") {
            self.event_type = Some(value.to_vec());
            self.event_type_bytes = utf8_bytes(value);
        } else if text_is(field, "data") {
            self.data_bytes += utf8_bytes(value) + usize::from(self.has_data);
            if self.has_data {
                self.data.push(10);
            }
            self.data.extend_from_slice(value);
            self.has_data = true;
        } else if text_is(field, "id") && !value.contains(&0) {
            self.event_id = value.to_vec();
            self.event_id_bytes = utf8_bytes(value);
            self.has_event_id = true;
        }
    }
    fn reset_event(&mut self) {
        self.event_type = None;
        self.event_type_bytes = 0;
        self.data = Vec::new();
        self.has_data = false;
        self.data_bytes = 0;
        self.event_id = Vec::new();
        self.event_id_bytes = 0;
        self.has_event_id = false;
    }
    pub fn flush(&mut self) {
        self.buffer = Vec::new();
        self.buffer_bytes = 0;
        self.skip_lf = false;
        self.reset_event();
    }
}
