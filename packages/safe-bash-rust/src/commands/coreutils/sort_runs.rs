use super::{SafeBashFs, stream_file_error};
use crate::vfs::{OpenRedirectFile, VfsEntryKind};
use std::cmp::Ordering;
use std::rc::Rc;

// Zero ends a run. Nodes have two little-endian u64 fields (next and byte length)
// followed by the record. Merging rewires next pointers without copying payloads.
#[derive(Default)]
pub(super) struct Run {
    first: usize,
    last: usize,
}

pub(super) struct SortRuns<'a> {
    fs: &'a dyn SafeBashFs,
    directory: String,
    cache_limit: usize,
    cache: Vec<u8>,
    file: Option<Rc<dyn OpenRedirectFile>>,
    end: usize,
    bins: Vec<Option<Run>>,
}

impl<'a> SortRuns<'a> {
    pub(super) fn new(fs: &'a dyn SafeBashFs, directory: String, cache_limit: usize) -> Self {
        Self { fs, directory, cache_limit, cache: vec![0; 8], file: None, end: 8, bins: Vec::new() }
    }

    fn write(&mut self, offset: usize, bytes: &[u8]) -> Result<(), String> {
        let end = offset.checked_add(bytes.len()).ok_or("EFBIG: sort storage too large")?;
        if self.file.is_none() && end > self.cache_limit {
            let path = &self.directory;
            let (entry, stat) = self.fs.inspect_command_entry(path, true, "stat").map_err(|e| stream_file_error(e, "stat", path))?;
            if stat.kind != VfsEntryKind::Directory { return Err(format!("ENOTDIR: not a directory '{path}'")); }
            let file = self.fs.scratch_file(&entry)?;
            file.write_at(Some(0), &self.cache)?;
            self.cache = Vec::new();
            self.file = Some(file);
        }
        if let Some(file) = &self.file {
            file.write_at(Some(offset), bytes)?;
        } else {
            if end > self.cache.len() { self.cache.resize(end, 0); }
            self.cache[offset..end].copy_from_slice(bytes);
        }
        self.end = self.end.max(end);
        Ok(())
    }

    fn read(&self, offset: usize, size: usize) -> Result<Vec<u8>, String> {
        let end = offset.checked_add(size).filter(|&e| e <= self.end).ok_or("EIO: invalid sort run")?;
        if let Some(file) = &self.file {
            let data = file.read_at(offset, size)?;
            if data.len() != size { return Err("EIO: incomplete sort run".into()); }
            Ok(data)
        } else { Ok(self.cache[offset..end].to_vec()) }
    }

    pub(super) fn append(&mut self, run: &mut Run, record: &[u8]) -> Result<(), String> {
        let node = self.end;
        let mut header = [0; 16];
        header[8..].copy_from_slice(&(record.len() as u64).to_le_bytes());
        self.write(node, &header)?;
        self.write(self.end, record)?;
        self.link(run, node)
    }

    fn link(&mut self, run: &mut Run, node: usize) -> Result<(), String> {
        if run.last == 0 { run.first = node; }
        else { self.write(run.last, &(node as u64).to_le_bytes())?; }
        run.last = node;
        Ok(())
    }

    fn record(&self, node: usize) -> Result<(usize, Vec<u8>), String> {
        let header = self.read(node, 16)?;
        let field = |i| usize::try_from(u64::from_le_bytes(header[i..i+8].try_into().unwrap())).map_err(|_| "EIO: invalid sort run");
        Ok((field(0)?, self.read(node + 16, field(8)?)?))
    }

    fn merge(&mut self, mut a: Run, mut b: Run, compare: &impl Fn(&[u8], &[u8]) -> Ordering) -> Result<Run, String> {
        if a.first == 0 { return Ok(b); }
        if b.first == 0 { return Ok(a); }
        let mut out = Run::default();
        let mut left = self.record(a.first)?;
        let mut right = self.record(b.first)?;
        loop {
            let (run, head, other) = if compare(&left.1, &right.1).is_le() { (&mut a, &mut left, &b) } else { (&mut b, &mut right, &a) };
            self.link(&mut out, run.first)?;
            run.first = head.0;
            if run.first == 0 {
                self.link(&mut out, other.first)?;
                out.last = other.last;
                return Ok(out);
            }
            *head = self.record(run.first)?;
        }
    }

    pub(super) fn add(&mut self, mut run: Run, compare: &impl Fn(&[u8], &[u8]) -> Ordering) -> Result<(), String> {
        for level in 0..self.bins.len() {
            let Some(older) = self.bins[level].take() else { self.bins[level] = Some(run); return Ok(()) };
            run = self.merge(older, run, compare)?;
        }
        self.bins.push(Some(run));
        Ok(())
    }

    pub(super) fn finish(mut self, compare: &impl Fn(&[u8], &[u8]) -> Ordering, mut output: impl FnMut(Vec<u8>)) -> Result<(), String> {
        let mut tail = Run::default();
        for older in std::mem::take(&mut self.bins).into_iter().flatten() {
            tail = self.merge(older, tail, compare)?;
        }
        let mut node = tail.first;
        while node != 0 {
            let (next, record) = self.record(node)?;
            output(record);
            node = next;
        }
        Ok(())
    }
}
