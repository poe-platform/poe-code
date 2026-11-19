#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PktLineItem {
    Line(Vec<u8>),
    Flush,
    Delim,
    Eof,
}

pub struct GitPktLine;

impl GitPktLine {
    /// Decode one complete packet and return its consumed byte count. Unlike
    /// the compatibility stream reader, malformed or truncated input is an error.
    /// The rest of the input may be a binary pack and is neither parsed nor copied.
    pub fn decode(input: &[u8]) -> Result<(PktLineItem, usize), crate::errors::GitError> {
        let invalid = || crate::errors::GitError::internal("Invalid or truncated Git packet line");
        let header = input.get(..4).ok_or_else(invalid)?;
        if !header.iter().all(u8::is_ascii_hexdigit) {
            return Err(invalid());
        }
        let size = usize::from_str_radix(std::str::from_utf8(header).map_err(|_| invalid())?, 16)
            .map_err(|_| invalid())?;
        let item = match size {
            0 | 2 => PktLineItem::Flush,
            1 => PktLineItem::Delim,
            3 => return Err(invalid()),
            4..=65520 => PktLineItem::Line(input.get(4..size).ok_or_else(invalid)?.to_vec()),
            _ => return Err(invalid()),
        };
        Ok((item, size.max(4)))
    }

    pub fn flush() -> Vec<u8> {
        b"0000".to_vec()
    }

    pub fn delim() -> Vec<u8> {
        b"0001".to_vec()
    }

    pub fn response_end() -> Vec<u8> {
        b"0002".to_vec()
    }

    pub fn encode(line: &[u8]) -> Vec<u8> {
        let length = line.len() + 4;
        let prefix = format!("{length:04x}");
        let mut out = Vec::with_capacity(length);
        out.extend_from_slice(prefix.as_bytes());
        out.extend_from_slice(line);
        out
    }

    pub fn encode_str(line: &str) -> Vec<u8> {
        Self::encode(line.as_bytes())
    }

    pub fn stream_reader(stream: &[u8]) -> PktLineReader {
        PktLineReader {
            data: stream.to_vec(),
            pos: 0,
        }
    }
}

pub struct PktLineReader {
    data: Vec<u8>,
    pos: usize,
}

impl PktLineReader {
    pub fn read(&mut self) -> PktLineItem {
        if self.pos + 4 > self.data.len() {
            return PktLineItem::Eof;
        }
        let header = String::from_utf8_lossy(&self.data[self.pos..self.pos + 4]);
        self.pos += 4;
        if header == "0000" {
            return PktLineItem::Flush;
        }
        if header == "0001" {
            return PktLineItem::Delim;
        }
        if header == "0002" {
            return PktLineItem::Flush;
        }
        let Ok(total_len) = usize::from_str_radix(&header, 16) else {
            return PktLineItem::Eof;
        };
        if total_len < 4 {
            return PktLineItem::Flush;
        }
        let payload_len = total_len - 4;
        let end = (self.pos + payload_len).min(self.data.len());
        let slice = self.data[self.pos..end].to_vec();
        self.pos = end;
        PktLineItem::Line(slice)
    }

    pub fn remaining(&self) -> &[u8] {
        &self.data[self.pos..]
    }
}
