use crate::utils::{Author, format_author, parse_author};

#[derive(Debug, Clone, PartialEq)]
pub struct TagObject {
    pub object: String,
    pub object_type: String,
    pub tag: String,
    pub tagger: Author,
    pub message: String,
    pub gpgsig: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GitAnnotatedTag {
    raw: String,
}

impl GitAnnotatedTag {
    pub fn from_str(text: &str) -> Self {
        Self {
            raw: text.to_string(),
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self::from_str(&String::from_utf8_lossy(bytes))
    }

    pub fn from_object(obj: &TagObject) -> Self {
        let gpg = obj.gpgsig.as_deref().unwrap_or("");
        let rendered = format!(
            "object {}\ntype {}\ntag {}\ntagger {}\n\n{}{}",
            obj.object,
            obj.object_type,
            obj.tag,
            format_author(&obj.tagger),
            obj.message,
            if gpg.is_empty() {
                if obj.message.ends_with('\n') {
                    "".to_string()
                } else {
                    "\n".to_string()
                }
            } else {
                format!("\n{gpg}")
            }
        );
        Self { raw: rendered }
    }

    pub fn parse(&self) -> TagObject {
        let split_idx = self.raw.find("\n\n").unwrap_or(self.raw.len());
        let header_part = &self.raw[..split_idx];
        let body_part = if split_idx + 2 <= self.raw.len() {
            &self.raw[split_idx + 2..]
        } else {
            ""
        };

        let mut object = String::new();
        let mut object_type = String::new();
        let mut tag = String::new();
        let mut tagger = Author {
            name: String::new(),
            email: String::new(),
            timestamp: 0,
            timezone_offset: 0.0,
        };

        for line in header_part.lines() {
            if let Some(rest) = line.strip_prefix("object ") {
                object = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("type ") {
                object_type = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("tag ") {
                tag = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("tagger ") {
                tagger = parse_author(rest);
            }
        }

        let sig_marker = body_part
            .find("-----BEGIN PGP SIGNATURE-----")
            .or_else(|| body_part.find("-----BEGIN SSH SIGNATURE-----"))
            .or_else(|| body_part.find("-----BEGIN PGP MESSAGE-----"));
        let (message, gpgsig) = if let Some(sig_idx) = sig_marker {
            let msg = body_part[..sig_idx].trim_end_matches('\n').to_string();
            let sig = body_part[sig_idx..].to_string();
            (msg, Some(sig))
        } else {
            (body_part.trim_end_matches('\n').to_string(), None)
        };

        TagObject {
            object,
            object_type,
            tag,
            tagger,
            message,
            gpgsig,
        }
    }

    pub fn payload(&self) -> String {
        let sig_marker = self
            .raw
            .find("-----BEGIN PGP SIGNATURE-----")
            .or_else(|| self.raw.find("-----BEGIN SSH SIGNATURE-----"))
            .or_else(|| self.raw.find("-----BEGIN PGP MESSAGE-----"));
        if let Some(sig_idx) = sig_marker {
            self.raw[..sig_idx].to_string()
        } else {
            self.raw.clone()
        }
    }

    pub fn gpgsig(&self) -> Option<String> {
        self.parse().gpgsig
    }

    pub fn render(&self) -> &str {
        &self.raw
    }

    pub fn to_object(&self) -> Vec<u8> {
        self.raw.as_bytes().to_vec()
    }
}
