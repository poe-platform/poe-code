use crate::utils::{Author, format_author, parse_author};

#[derive(Debug, Clone, PartialEq)]
pub struct CommitObject {
    pub message: String,
    pub tree: String,
    pub parent: Vec<String>,
    pub author: Author,
    pub committer: Author,
    pub gpgsig: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GitCommit {
    raw: String,
}

impl GitCommit {
    pub fn from_str(text: &str) -> Self {
        Self {
            raw: text.to_string(),
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self::from_str(&String::from_utf8_lossy(bytes))
    }

    pub fn from_object(obj: &CommitObject) -> Self {
        let mut lines = Vec::new();
        lines.push(format!("tree {}", obj.tree));
        for p in &obj.parent {
            lines.push(format!("parent {p}"));
        }
        lines.push(format!("author {}", format_author(&obj.author)));
        lines.push(format!("committer {}", format_author(&obj.committer)));
        if let Some(ref sig) = obj.gpgsig {
            let indented = sig
                .trim_end_matches('\n')
                .lines()
                .map(|l| format!(" {l}"))
                .collect::<Vec<_>>()
                .join("\n");
            lines.push(format!("gpgsig{indented}"));
        }
        let msg = if obj.message.ends_with('\n') {
            obj.message.clone()
        } else {
            format!("{}\n", obj.message)
        };
        Self {
            raw: format!("{}\n\n{}", lines.join("\n"), msg),
        }
    }

    pub fn from_payload_signature(payload: &str, signature: &str) -> Self {
        let split_idx = payload.find("\n\n").unwrap_or(payload.len());
        let headers = &payload[..split_idx];
        let message = if split_idx + 2 <= payload.len() {
            &payload[split_idx + 2..]
        } else {
            ""
        };
        let indented = signature
            .trim_end_matches('\n')
            .lines()
            .map(|l| format!(" {l}"))
            .collect::<Vec<_>>()
            .join("\n");
        let commit = format!("{headers}\ngpgsig{indented}\n\n{message}").replace("\r\n", "\n");
        Self { raw: commit }
    }

    pub fn parse(&self) -> CommitObject {
        let split_idx = self.raw.find("\n\n").unwrap_or(self.raw.len());
        let header_part = &self.raw[..split_idx];
        let message = if split_idx + 2 <= self.raw.len() {
            self.raw[split_idx + 2..].to_string()
        } else {
            String::new()
        };

        let mut tree = String::new();
        let mut parent = Vec::new();
        let mut author = Author {
            name: String::new(),
            email: String::new(),
            timestamp: 0,
            timezone_offset: 0.0,
        };
        let mut committer = author.clone();
        let mut gpgsig_lines: Vec<String> = Vec::new();
        let mut in_gpgsig = false;

        for line in header_part.lines() {
            if in_gpgsig {
                if let Some(stripped) = line.strip_prefix(' ') {
                    gpgsig_lines.push(stripped.to_string());
                    continue;
                } else {
                    in_gpgsig = false;
                }
            }
            if let Some(rest) = line.strip_prefix("tree ") {
                tree = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("parent ") {
                parent.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("author ") {
                author = parse_author(rest);
            } else if let Some(rest) = line.strip_prefix("committer ") {
                committer = parse_author(rest);
            } else if let Some(rest) = line.strip_prefix("gpgsig") {
                in_gpgsig = true;
                gpgsig_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
            }
        }

        let gpgsig = if gpgsig_lines.is_empty() {
            None
        } else {
            Some(gpgsig_lines.join("\n"))
        };

        CommitObject {
            message,
            tree,
            parent,
            author,
            committer,
            gpgsig,
        }
    }

    pub fn without_signature(&self) -> String {
        let split_idx = self.raw.find("\n\n").unwrap_or(self.raw.len());
        let header_part = &self.raw[..split_idx];
        let message = if split_idx <= self.raw.len() {
            &self.raw[split_idx..]
        } else {
            ""
        };
        let mut kept_headers = Vec::new();
        let mut in_gpgsig = false;
        for line in header_part.lines() {
            if in_gpgsig {
                if line.starts_with(' ') {
                    continue;
                }
                in_gpgsig = false;
            }
            if line.starts_with("gpgsig") {
                in_gpgsig = true;
                continue;
            }
            kept_headers.push(line);
        }
        format!("{}{}", kept_headers.join("\n"), message)
    }

    pub fn render(&self) -> &str {
        &self.raw
    }

    pub fn to_object(&self) -> Vec<u8> {
        self.raw.as_bytes().to_vec()
    }
}
