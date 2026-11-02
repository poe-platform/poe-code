use super::{SafeBashFs, sort_record::{PAGE, Record, scratch}};
use crate::vfs::OpenRedirectFile;
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
    directory: &'a str,
    cache_limit: usize,
    cache: Vec<u8>,
    file: Option<Rc<dyn OpenRedirectFile>>,
    end: usize,
    bins: Vec<Option<Run>>,
}

impl<'a> SortRuns<'a> {
    pub(super) fn new(fs: &'a dyn SafeBashFs, directory: &'a str, cache_limit: usize) -> Self {
        Self { fs, directory, cache_limit, cache: vec![0; 8], file: None, end: 8, bins: Vec::new() }
    }

    fn write(&mut self, offset: usize, bytes: &[u8]) -> Result<(), String> {
        let end = offset.checked_add(bytes.len()).ok_or("EFBIG: sort storage too large")?;
        if self.file.is_none() && end > self.cache_limit {
            let file = scratch(self.fs, self.directory)?;
            for (index, chunk) in self.cache.chunks(PAGE).enumerate() { file.write_at(Some(index * PAGE), chunk)?; }
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

    pub(super) fn append(&mut self, run: &mut Run, record: &Record) -> Result<(), String> {
        let node = self.end;
        let mut header = [0; 16];
        header[8..].copy_from_slice(&(record.len() as u64).to_le_bytes());
        self.write(node, &header)?;
        record.chunks(|chunk| self.write(self.end, chunk))?;
        self.link(run, node)
    }

    fn link(&mut self, run: &mut Run, node: usize) -> Result<(), String> {
        if run.last == 0 { run.first = node; }
        else { self.write(run.last, &(node as u64).to_le_bytes())?; }
        run.last = node;
        Ok(())
    }

    fn record(&self, node: usize) -> Result<(usize, Record), String> {
        let header = self.read(node, 16)?;
        let field = |i| usize::try_from(u64::from_le_bytes(header[i..i+8].try_into().unwrap())).map_err(|_| "EIO: invalid sort run");
        let length = field(8)?;
        let offset = node + 16;
        let record = if length > PAGE && let Some(file) = &self.file {
            Record::Stored { file: file.clone(), offset, length }
        } else { Record::Bytes(self.read(offset, length)?) };
        Ok((field(0)?, record))
    }

    fn merge(&mut self, mut a: Run, mut b: Run, compare: &impl Fn(&Record, &Record) -> Result<Ordering, String>) -> Result<Run, String> {
        if a.first == 0 { return Ok(b); }
        if b.first == 0 { return Ok(a); }
        let mut out = Run::default();
        let mut left = self.record(a.first)?;
        let mut right = self.record(b.first)?;
        loop {
            let (run, head, other) = if compare(&left.1, &right.1)?.is_le() { (&mut a, &mut left, &b) } else { (&mut b, &mut right, &a) };
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

    pub(super) fn add(&mut self, mut run: Run, compare: &impl Fn(&Record, &Record) -> Result<Ordering, String>) -> Result<(), String> {
        for level in 0..self.bins.len() {
            let Some(older) = self.bins[level].take() else { self.bins[level] = Some(run); return Ok(()) };
            run = self.merge(older, run, compare)?;
        }
        self.bins.push(Some(run));
        Ok(())
    }

    pub(super) fn finish(mut self, compare: &impl Fn(&Record, &Record) -> Result<Ordering, String>, mut output: impl FnMut(Record) -> Result<(), String>) -> Result<(), String> {
        let mut tail = Run::default();
        for older in std::mem::take(&mut self.bins).into_iter().flatten() {
            tail = self.merge(older, tail, compare)?;
        }
        let mut node = tail.first;
        while node != 0 {
            let (next, record) = self.record(node)?;
            output(record)?;
            node = next;
        }
        Ok(())
    }
}
