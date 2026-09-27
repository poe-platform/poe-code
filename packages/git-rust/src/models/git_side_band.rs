use crate::models::git_pkt_line::{GitPktLine, PktLineItem};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SideBandDemuxResult {
    pub packetlines: Vec<Vec<u8>>,
    pub packfile: Vec<u8>,
    pub progress: Vec<Vec<u8>>,
    pub error: Option<String>,
}

pub struct GitSideBand;

impl GitSideBand {
    pub fn demux(input: &[u8]) -> SideBandDemuxResult {
        let mut reader = GitPktLine::stream_reader(input);
        let mut packetlines = Vec::new();
        let mut packfile = Vec::new();
        let mut progress = Vec::new();
        let mut error = None;

        loop {
            match reader.read() {
                PktLineItem::Eof => break,
                PktLineItem::Flush | PktLineItem::Delim => {
                    packetlines.push(Vec::new());
                }
                PktLineItem::Line(line) => {
                    if line.is_empty() {
                        continue;
                    }
                    match line[0] {
                        1 => {
                            packfile.extend_from_slice(&line[1..]);
                        }
                        2 => {
                            progress.push(line[1..].to_vec());
                        }
                        3 => {
                            let err_msg = String::from_utf8_lossy(&line[1..]).to_string();
                            progress.push(line[1..].to_vec());
                            packfile.clear();
                            error = Some(err_msg);
                            break;
                        }
                        _ => {
                            packetlines.push(line);
                        }
                    }
                }
            }
        }

        SideBandDemuxResult {
            packetlines,
            packfile,
            progress,
            error,
        }
    }

    pub fn mux(_protocol: &str, packfile: &[u8], progress: &[Vec<u8>], error: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        for p in progress {
            let mut payload = vec![2u8];
            payload.extend_from_slice(p);
            out.extend_from_slice(&GitPktLine::encode(&payload));
        }
        if !packfile.is_empty() {
            for chunk in packfile.chunks(65515) {
                let mut payload = vec![1u8];
                payload.extend_from_slice(chunk);
                out.extend_from_slice(&GitPktLine::encode(&payload));
            }
        }
        for e in error {
            let mut payload = vec![3u8];
            payload.extend_from_slice(e);
            out.extend_from_slice(&GitPktLine::encode(&payload));
        }
        out.extend_from_slice(&GitPktLine::flush());
        out
    }
}
