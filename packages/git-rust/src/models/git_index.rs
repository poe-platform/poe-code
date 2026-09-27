use std::collections::{BTreeMap, BTreeSet};

use crate::errors::GitError;
use crate::fs::FileStat;
use crate::utils::{compare_strings, from_hex, normalize_mode, shasum_bytes, to_hex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheEntryFlags {
    pub assume_valid: bool,
    pub extended: bool,
    pub stage: u8,
    pub name_length: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    pub ctime_seconds: u32,
    pub ctime_nanoseconds: u32,
    pub mtime_seconds: u32,
    pub mtime_nanoseconds: u32,
    pub dev: u32,
    pub ino: u32,
    pub mode: u32,
    pub uid: u32,
    pub gid: u32,
    pub size: u32,
    pub oid: String,
    pub flags: CacheEntryFlags,
    pub path: String,
    pub stages: Vec<Option<IndexEntry>>,
}

#[derive(Debug, Clone, Default)]
pub struct GitIndex {
    entries: BTreeMap<String, IndexEntry>,
    unmerged_paths: BTreeSet<String>,
}

impl GitIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_buffer(buffer: &[u8]) -> Result<Self, GitError> {
        if buffer.is_empty() {
            return Ok(Self::new());
        }
        if buffer.len() < 12 || &buffer[0..4] != b"DIRC" {
            return Err(GitError::internal("Invalid dircache magic header"));
        }
        let version = u32::from_be_bytes([buffer[4], buffer[5], buffer[6], buffer[7]]);
        if version != 2 && version != 3 {
            return Err(GitError::internal(&format!(
                "Unsupported dircache version: {version}"
            )));
        }
        let num_entries = u32::from_be_bytes([buffer[8], buffer[9], buffer[10], buffer[11]]) as usize;
        let mut index = Self::new();
        let mut pos = 12usize;

        for _ in 0..num_entries {
            if pos + 62 > buffer.len() {
                return Err(GitError::internal("Truncated dircache entry"));
            }
            let read_u32 = |offset: usize| -> u32 {
                u32::from_be_bytes([
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                ])
            };
            let entry_start = pos;
            let ctime_seconds = read_u32(pos);
            let ctime_nanoseconds = read_u32(pos + 4);
            let mtime_seconds = read_u32(pos + 8);
            let mtime_nanoseconds = read_u32(pos + 12);
            let dev = read_u32(pos + 16);
            let ino = read_u32(pos + 20);
            let mode = read_u32(pos + 24);
            let uid = read_u32(pos + 28);
            let gid = read_u32(pos + 32);
            let size = read_u32(pos + 36);
            let oid = to_hex(&buffer[pos + 40..pos + 60]);
            let raw_flags = u16::from_be_bytes([buffer[pos + 60], buffer[pos + 61]]);
            let flags = parse_cache_entry_flags(raw_flags);
            pos += 62;
            if version == 3 && flags.extended {
                pos += 2;
            }
            let nul_rel = buffer[pos..]
                .iter()
                .position(|&b| b == 0)
                .ok_or_else(|| GitError::internal("Missing NUL terminator for index path"))?;
            if nul_rel < 1 {
                return Err(GitError::internal("Got a path length of 0"));
            }
            let path = String::from_utf8_lossy(&buffer[pos..pos + nul_rel]).to_string();
            if path.contains("..\\") || path.contains("../") {
                return Err(GitError::unsafe_filepath(&path));
            }
            pos += nul_rel;

            let entry_len_so_far = pos - entry_start;
            let mut padding = 8 - (entry_len_so_far % 8);
            if padding == 0 {
                padding = 8;
            }
            if pos + padding > buffer.len() {
                return Err(GitError::internal("Unexpected end of index file during padding"));
            }
            for &pad_byte in &buffer[pos..pos + padding] {
                if pad_byte != 0 {
                    return Err(GitError::internal(&format!(
                        "Expected 1-8 null characters but got '{pad_byte}' after {path}"
                    )));
                }
            }
            pos += padding;

            let entry = IndexEntry {
                ctime_seconds,
                ctime_nanoseconds,
                mtime_seconds,
                mtime_nanoseconds,
                dev,
                ino,
                mode,
                uid,
                gid,
                size,
                oid,
                flags,
                path,
                stages: Vec::new(),
            };
            index.add_entry(entry);
        }

        Ok(index)
    }

    fn add_entry(&mut self, mut entry: IndexEntry) {
        if entry.flags.stage == 0 {
            entry.stages = vec![Some(entry.clone())];
            self.entries.insert(entry.path.clone(), entry);
            return;
        }
        let path = entry.path.clone();
        let stage = entry.flags.stage as usize;
        let existing = self.entries.entry(path.clone()).or_insert_with(|| {
            let mut base = entry.clone();
            base.stages = vec![None, None, None, None];
            base
        });
        if existing.stages.len() < 4 {
            existing.stages.resize(4, None);
        }
        existing.stages[stage] = Some(entry);
        self.unmerged_paths.insert(path);
    }

    pub fn unmerged_paths(&self) -> Vec<String> {
        self.unmerged_paths.iter().cloned().collect()
    }

    pub fn entries(&self) -> Vec<IndexEntry> {
        let mut list: Vec<IndexEntry> = self.entries.values().cloned().collect();
        list.sort_by(|a, b| compare_strings(&a.path, &b.path));
        list
    }

    pub fn entries_map(&self) -> &BTreeMap<String, IndexEntry> {
        &self.entries
    }

    pub fn entries_flat(&self) -> Vec<IndexEntry> {
        let mut out = Vec::new();
        for entry in self.entries() {
            if entry.stages.len() > 1 {
                for st in entry.stages.into_iter().flatten() {
                    out.push(st);
                }
            } else {
                out.push(entry);
            }
        }
        out
    }

    pub fn insert(
        &mut self,
        filepath: &str,
        stats: Option<&FileStat>,
        oid: &str,
        stage: u8,
    ) {
        let (ctime_s, ctime_ns, mtime_s, mtime_ns, dev, ino, mode, uid, gid, size) =
            if let Some(st) = stats {
                (
                    st.ctime_seconds,
                    st.ctime_nanoseconds,
                    st.mtime_seconds,
                    st.mtime_nanoseconds,
                    st.dev as u32,
                    st.ino as u32,
                    normalize_mode(st.mode),
                    st.uid,
                    st.gid,
                    st.size as u32,
                )
            } else {
                (0, 0, 0, 0, 0, 0, 0o100644, 0, 0, 0)
            };

        let name_len = filepath.len().min(0xfff) as u16;
        let entry = IndexEntry {
            ctime_seconds: ctime_s,
            ctime_nanoseconds: ctime_ns,
            mtime_seconds: mtime_s,
            mtime_nanoseconds: mtime_ns,
            dev,
            ino,
            mode,
            uid,
            gid,
            size,
            oid: oid.to_string(),
            flags: CacheEntryFlags {
                assume_valid: false,
                extended: false,
                stage,
                name_length: name_len,
            },
            path: filepath.to_string(),
            stages: Vec::new(),
        };
        if stage == 0 {
            self.unmerged_paths.remove(filepath);
        }
        self.add_entry(entry);
    }

    pub fn delete(&mut self, filepath: &str) {
        self.entries.remove(filepath);
        self.unmerged_paths.remove(filepath);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.unmerged_paths.clear();
    }

    pub fn render(&self) -> String {
        self.entries()
            .iter()
            .map(|e| format!("{:06o} {}    {}", e.mode, e.oid, e.path))
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn to_object(&self) -> Result<Vec<u8>, GitError> {
        let flat = self.entries_flat();
        let mut out = Vec::with_capacity(12 + flat.len() * 72 + 20);
        out.extend_from_slice(b"DIRC");
        out.extend_from_slice(&2u32.to_be_bytes());
        out.extend_from_slice(&(flat.len() as u32).to_be_bytes());

        for entry in flat {
            let entry_start = out.len();
            out.extend_from_slice(&entry.ctime_seconds.to_be_bytes());
            out.extend_from_slice(&entry.ctime_nanoseconds.to_be_bytes());
            out.extend_from_slice(&entry.mtime_seconds.to_be_bytes());
            out.extend_from_slice(&entry.mtime_nanoseconds.to_be_bytes());
            out.extend_from_slice(&entry.dev.to_be_bytes());
            out.extend_from_slice(&entry.ino.to_be_bytes());
            out.extend_from_slice(&entry.mode.to_be_bytes());
            out.extend_from_slice(&entry.uid.to_be_bytes());
            out.extend_from_slice(&entry.gid.to_be_bytes());
            out.extend_from_slice(&entry.size.to_be_bytes());

            let padded_oid = if entry.oid.len() < 40 {
                format!("{:0<40}", entry.oid)
            } else {
                entry.oid.clone()
            };
            let oid_bytes = from_hex(&padded_oid)?;
            out.extend_from_slice(&oid_bytes);

            let path_bytes = entry.path.as_bytes();
            let name_len = path_bytes.len().min(0xfff) as u16;
            let raw_flags = render_cache_entry_flags(&CacheEntryFlags {
                name_length: name_len,
                ..entry.flags
            });
            out.extend_from_slice(&raw_flags.to_be_bytes());
            out.extend_from_slice(path_bytes);

            let entry_len = out.len() - entry_start;
            let mut padding = 8 - (entry_len % 8);
            if padding == 0 {
                padding = 8;
            }
            out.resize(out.len() + padding, 0);
        }

        let sha = shasum_bytes(&out);
        out.extend_from_slice(&sha);
        Ok(out)
    }
}

fn parse_cache_entry_flags(flags: u16) -> CacheEntryFlags {
    CacheEntryFlags {
        assume_valid: (flags & 0x8000) != 0,
        extended: (flags & 0x4000) != 0,
        stage: ((flags & 0x3000) >> 12) as u8,
        name_length: flags & 0x0fff,
    }
}

fn render_cache_entry_flags(flags: &CacheEntryFlags) -> u16 {
    let mut out = flags.name_length & 0x0fff;
    if flags.assume_valid {
        out |= 0x8000;
    }
    if flags.extended {
        out |= 0x4000;
    }
    out |= ((flags.stage as u16) & 0x03) << 12;
    out
}
