use std::collections::BTreeMap;

#[derive(Debug, Clone)]
struct PackedRefLine {
    raw_line: String,
    is_comment: bool,
    ref_name: Option<String>,
    oid: Option<String>,
    peeled: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct GitPackedRefs {
    pub refs: BTreeMap<String, String>,
    lines: Vec<PackedRefLine>,
}

impl GitPackedRefs {
    pub fn from(text: &str) -> Self {
        let mut refs = BTreeMap::new();
        let mut lines: Vec<PackedRefLine> = Vec::new();
        for raw_line in text.lines() {
            let trimmed = raw_line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with('#') {
                lines.push(PackedRefLine {
                    raw_line: raw_line.to_string(),
                    is_comment: true,
                    ref_name: None,
                    oid: None,
                    peeled: None,
                });
                continue;
            }
            if let Some(peeled_oid) = trimmed.strip_prefix('^') {
                if let Some(last) = lines.last_mut()
                    && let Some(ref rname) = last.ref_name {
                        let peeled_clean = peeled_oid.trim().to_string();
                        last.peeled = Some(peeled_clean.clone());
                        refs.insert(format!("{rname}^{{}}"), peeled_clean);
                    }
                continue;
            }
            if let Some(space_idx) = trimmed.find(' ') {
                let oid = trimmed[..space_idx].trim().to_string();
                let ref_name = trimmed[space_idx + 1..].trim().to_string();
                refs.insert(ref_name.clone(), oid.clone());
                lines.push(PackedRefLine {
                    raw_line: raw_line.to_string(),
                    is_comment: false,
                    ref_name: Some(ref_name),
                    oid: Some(oid),
                    peeled: None,
                });
            }
        }
        Self { refs, lines }
    }

    pub fn delete(&mut self, ref_name: &str) {
        self.refs.remove(ref_name);
        self.refs.remove(&format!("{ref_name}^{{}}"));
        self.lines
            .retain(|l| l.ref_name.as_deref() != Some(ref_name));
    }
}

impl std::fmt::Display for GitPackedRefs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut out = Vec::new();
        for line in &self.lines {
            if line.is_comment {
                out.push(line.raw_line.clone());
            } else if let (Some(oid), Some(rname)) = (&line.oid, &line.ref_name) {
                out.push(format!("{oid} {rname}"));
                if let Some(ref peeled) = line.peeled {
                    out.push(format!("^{peeled}"));
                }
            }
        }
        if out.is_empty() {
            write!(f, "")
        } else {
            writeln!(f, "{}", out.join("\n"))
        }
    }
}
