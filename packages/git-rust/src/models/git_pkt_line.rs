#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PktLineItem {
    Line(Vec<u8>),
    Flush,
    Delim,
    Eof,
}

pub struct GitPktLine;

impl GitPktLine {
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
