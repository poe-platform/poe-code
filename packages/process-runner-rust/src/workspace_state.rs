//! Content admission and download conflict state with shared UTF-16 path keys.
use mcp_oauth_rust::sha256;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
pub const LIMIT_ERROR: &str = "runner.upload_max_file_mb must be a finite positive number.";
pub fn max_bytes(mb: f64) -> Result<f64, &'static str> {
    if !mb.is_finite() || mb <= 0.0 {
        return Err(LIMIT_ERROR);
    }
    Ok(mb * 1024.0 * 1024.0)
}
pub fn warning(path: &[u16], bytes: usize) -> Vec<u16> {
    let mut text = "Skipping ".encode_utf16().collect::<Vec<_>>();
    text.extend(path);
    text.extend(format!(": {bytes} bytes exceeds upload_max_file_mb.").encode_utf16());
    text
}
struct File {
    hash: [u8; 32],
    uploaded: bool,
}
#[derive(Default)]
pub struct State {
    files: HashMap<Arc<[u16]>, File>,
    order: Vec<Arc<[u16]>>,
}
impl State {
    pub fn admit(&mut self, path: &[u16], content: &[u8], max: f64) -> bool {
        let uploaded = content.len() as f64 <= max;
        let file = File {
            hash: sha256(content),
            uploaded,
        };
        if let Some(previous) = self.files.get_mut(path) {
            *previous = file;
        } else {
            let key: Arc<[u16]> = path.into();
            self.order.push(key.clone());
            self.files.insert(key, file);
        }
        uploaded
    }
    pub fn conflict(&self, path: &[u16], remote: &[u8], local: Option<&[u8]>) -> bool {
        let Some(local) = local else {
            return false;
        };
        let local = sha256(local);
        let remote = sha256(remote);
        let changed = self.files.get(path).is_none_or(|file| file.hash != local);
        changed && local != remote
    }
    pub fn same(&self, path: &[u16], content: &[u8]) -> bool {
        self.files
            .get(path)
            .is_some_and(|file| file.hash == sha256(content))
    }
    pub fn deletions(&self, remote: &[Vec<u16>]) -> Vec<Vec<u16>> {
        let present = remote.iter().map(Vec::as_slice).collect::<HashSet<_>>();
        self.order
            .iter()
            .filter(|path| {
                self.files
                    .get(path.as_ref())
                    .is_some_and(|file| file.uploaded)
                    && !present.contains(path.as_ref())
            })
            .map(|path| path.to_vec())
            .collect()
    }
}
