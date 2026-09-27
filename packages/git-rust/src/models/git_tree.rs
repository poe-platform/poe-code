use crate::errors::GitError;
use crate::utils::{compare_strings, compare_tree_entry_path, from_hex, to_hex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeEntry {
    pub mode: String,
    pub path: String,
    pub oid: String,
    pub entry_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTree {
    entries: Vec<TreeEntry>,
}

impl GitTree {
    pub fn from_bytes(buffer: &[u8]) -> Result<Self, GitError> {
        let mut entries = Vec::new();
        let mut cursor = 0usize;
        while cursor < buffer.len() {
            let space_rel = buffer[cursor..]
                .iter()
                .position(|&b| b == b' ')
                .ok_or_else(|| {
                    GitError::internal(&format!(
                        "GitTree: Error parsing buffer at byte location {cursor}: Could not find the next space character."
                    ))
                })?;
            let space = cursor + space_rel;
            let null_rel = buffer[cursor..]
                .iter()
                .position(|&b| b == 0)
                .ok_or_else(|| {
                    GitError::internal(&format!(
                        "GitTree: Error parsing buffer at byte location {cursor}: Could not find the next null character."
                    ))
                })?;
            let nullchar = cursor + null_rel;
            let mut mode = String::from_utf8_lossy(&buffer[cursor..space]).to_string();
            if mode == "40000" {
                mode = "040000".to_string();
            }
            let entry_type = tree_mode_to_type(&mode)?.to_string();
            let path = String::from_utf8_lossy(&buffer[space + 1..nullchar]).to_string();
            validate_tree_entry_name(&path)?;
            if nullchar + 21 > buffer.len() {
                return Err(GitError::internal("GitTree: truncated 20-byte OID"));
            }
            let oid = to_hex(&buffer[nullchar + 1..nullchar + 21]);
            cursor = nullchar + 21;
            entries.push(TreeEntry {
                mode,
                path,
                oid,
                entry_type,
            });
        }
        entries.sort_by(|a, b| compare_strings(&a.path, &b.path));
        Ok(Self { entries })
    }

    pub fn from_entries(raw_entries: Vec<TreeEntry>) -> Result<Self, GitError> {
        let mut entries = Vec::with_capacity(raw_entries.len());
        for mut entry in raw_entries {
            validate_tree_entry_name(&entry.path)?;
            entry.mode = limit_mode_to_allowed(&entry.mode)?;
            if entry.entry_type.is_empty() {
                entry.entry_type = tree_mode_to_type(&entry.mode)?.to_string();
            }
            entries.push(entry);
        }
        entries.sort_by(|a, b| compare_strings(&a.path, &b.path));
        Ok(Self { entries })
    }

    pub fn entries(&self) -> &[TreeEntry] {
        &self.entries
    }

    pub fn render(&self) -> String {
        self.entries
            .iter()
            .map(|e| format!("{} {} {}    {}", e.mode, e.entry_type, e.oid, e.path))
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn to_object(&self) -> Result<Vec<u8>, GitError> {
        let mut sorted = self.entries.clone();
        sorted.sort_by(|a, b| compare_tree_entry_path(&a.path, &a.mode, &b.path, &b.mode));
        let mut out = Vec::new();
        for entry in sorted {
            let mode_trimmed = entry.mode.strip_prefix('0').unwrap_or(&entry.mode);
            out.extend_from_slice(mode_trimmed.as_bytes());
            out.push(b' ');
            out.extend_from_slice(entry.path.as_bytes());
            out.push(0);
            let oid_bytes = from_hex(&entry.oid)?;
            out.extend_from_slice(&oid_bytes);
        }
        Ok(out)
    }
}

fn tree_mode_to_type(mode: &str) -> Result<&'static str, GitError> {
    match mode {
        "040000" => Ok("tree"),
        "100644" | "100755" | "120000" => Ok("blob"),
        "160000" => Ok("commit"),
        _ => Err(GitError::internal(&format!(
            "Unexpected GitTree entry mode: {mode}"
        ))),
    }
}

fn limit_mode_to_allowed(mode: &str) -> Result<String, GitError> {
    let m = mode.trim_start_matches('0');
    if m.starts_with('4') {
        return Ok("040000".to_string());
    }
    if m.starts_with("1006") {
        return Ok("100644".to_string());
    }
    if m.starts_with("1007") {
        return Ok("100755".to_string());
    }
    if m.starts_with("120") {
        return Ok("120000".to_string());
    }
    if m.starts_with("160") {
        return Ok("160000".to_string());
    }
    Err(GitError::internal(&format!(
        "Could not understand file mode: {mode}"
    )))
}

pub fn validate_tree_entry_name(path: &str) -> Result<(), GitError> {
    let hfs_clean: String = path
        .chars()
        .filter(|&c| {
            !matches!(
                c,
                '\u{200C}'..='\u{200F}'
                    | '\u{202A}'..='\u{202E}'
                    | '\u{206A}'..='\u{206F}'
                    | '\u{FEFF}'
            )
        })
        .collect();

    let ntfs_clean = hfs_clean.split(':').next().unwrap_or("");
    let normalized = ntfs_clean
        .to_ascii_lowercase()
        .trim_end_matches(['.', ' '])
        .to_string();

    let is_ntfs_short_git = {
        let s = normalized.strip_prefix('.').unwrap_or(&normalized);
        s.len() == 5
            && s.starts_with("git~")
            && matches!(s.as_bytes()[4], b'1'..=b'9')
    };

    if path.contains('\\')
        || path.contains('/')
        || hfs_clean == "."
        || hfs_clean == ".."
        || normalized == ".git"
        || is_ntfs_short_git
    {
        return Err(GitError::unsafe_filepath(path));
    }
    Ok(())
}
