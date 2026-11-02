use super::{SafeBashFs, stream_file_error};
use crate::vfs::{OpenRedirectFile, VfsEntryKind};
use std::{borrow::Cow, cmp::Ordering, rc::Rc};

pub(super) const PAGE: usize = 16 * 1024;

pub(super) fn scratch(fs: &dyn SafeBashFs, path: &str) -> Result<Rc<dyn OpenRedirectFile>, String> {
    let (entry, stat) = fs.inspect_command_entry(path, true, "stat").map_err(|e| stream_file_error(e, "stat", path))?;
    if stat.kind != VfsEntryKind::Directory { return Err(format!("ENOTDIR: not a directory '{path}'")); }
    fs.scratch_file(&entry)
}

pub(super) enum Record {
    Bytes(Vec<u8>),
    Stored { file: Rc<dyn OpenRedirectFile>, offset: usize, length: usize },
}

impl Default for Record {
    fn default() -> Self { Self::Bytes(Vec::new()) }
}

impl Record {
    pub(super) fn len(&self) -> usize {
        match self { Self::Bytes(b) => b.len(), Self::Stored { length, .. } => *length }
    }

    pub(super) fn append(&mut self, chunk: &[u8], inline_limit: usize, fs: &dyn SafeBashFs, directory: &str) -> Result<(), String> {
        let end = self.len().checked_add(chunk.len()).ok_or("EFBIG: sort record too large")?;
        if let Self::Bytes(bytes) = self {
            if end <= inline_limit { bytes.extend_from_slice(chunk); return Ok(()); }
            let file = scratch(fs, directory)?;
            file.write_at(Some(0), bytes)?;
            *self = Self::Stored { file, offset: 0, length: bytes.len() };
        }
        let Self::Stored { file, length, .. } = self else { unreachable!() };
        for part in chunk.chunks(PAGE) {
            file.write_at(Some(*length), part)?;
            *length += part.len();
        }
        Ok(())
    }

    pub(super) fn read(&self, start: usize, size: usize) -> Result<Cow<'_, [u8]>, String> {
        match self {
            Self::Bytes(b) => Ok(Cow::Borrowed(&b[start..start+size])),
            Self::Stored { file, offset, .. } => {
                let data = file.read_at(offset + start, size)?;
                if data.len() != size { return Err("EIO: incomplete sort record".into()); }
                Ok(Cow::Owned(data))
            }
        }
    }

    pub(super) fn chunks(&self, mut use_chunk: impl FnMut(&[u8]) -> Result<(), String>) -> Result<(), String> {
        for offset in (0..self.len()).step_by(PAGE) {
            use_chunk(&self.read(offset, PAGE.min(self.len() - offset))?)?;
        }
        Ok(())
    }

    pub(super) fn byte_order(&self, other: &Self) -> Result<Ordering, String> {
        let length = self.len().min(other.len());
        for offset in (0..length).step_by(PAGE) {
            let size = PAGE.min(length - offset);
            let order = self.read(offset, size)?.cmp(&other.read(offset, size)?);
            if !order.is_eq() { return Ok(order); }
        }
        Ok(self.len().cmp(&other.len()))
    }
}

// The slice comparator cannot return scratch I/O errors. Merge owned records
// explicitly when the batch includes a stored record.
pub(super) fn sort_batch(batch: &mut [Record], bytes: &impl Fn(&[u8], &[u8]) -> Ordering,
    compare: &impl Fn(&Record, &Record) -> Result<Ordering, String>,
) -> Result<(), String> {
    if batch.iter().all(|r| matches!(r, Record::Bytes(_))) {
        batch.sort_by(|a, b| match (a, b) { (Record::Bytes(a), Record::Bytes(b)) => bytes(a, b), _ => unreachable!() });
        return Ok(());
    }
    let mut work = Vec::with_capacity(batch.len());
    let mut width = 1;
    while width < batch.len() {
        for pair in batch.chunks_mut(width.saturating_mul(2)) {
            let (left, right) = pair.split_at_mut(width.min(pair.len()));
            let mut left = left.iter_mut().peekable();
            let mut right = right.iter_mut().peekable();
            while let (Some(a), Some(b)) = (left.peek(), right.peek()) {
                let first = if compare(a, b)?.is_le() { left.next() } else { right.next() };
                work.push(std::mem::take(first.unwrap()));
            }
            work.extend(left.chain(right).map(std::mem::take));
        }
        for (target, record) in batch.iter_mut().zip(work.drain(..)) { *target = record; }
        width = width.saturating_mul(2);
    }
    Ok(())
}
