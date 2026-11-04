use super::*;
use crate::vfs::memory::{RetainedFile, fill_random};

const READ: u32 = 1;
const WRITE: u32 = 2;
const CREATE: u32 = 4;
const EXCLUSIVE: u32 = 8;
const TRUNCATE: u32 = 16;
const APPEND: u32 = 32;
const NO_FOLLOW: u32 = 64;
const SYNCHRONIZE: u32 = 128;

enum Target {
    Regular(RetainedFile),
    ReadOnly(Box<dyn crate::vfs::FileReadHandle>),
    Device {
        stat: FileStat,
        name: String,
        mounted: bool,
    },
}
pub(super) struct Descriptor {
    target: Target,
    flags: u32,
    position: u64,
}

impl WasmSession {
    fn open_descriptor(&mut self, path: &str, flags: u32, mode: u32) -> Result<(u32, u8), String> {
        if self.profile == Profile::Overlay {
            return Err("ENOTSUP".into());
        }
        if flags > 255 || flags & 3 == 0 || mode > 0o7777 || flags & WRITE == 0 && flags & (TRUNCATE | APPEND) != 0 {
            return Err("EINVAL".into());
        }
        let fs = &self.shell.fs;
        let exclusive = flags & EXCLUSIVE != 0;
        let p = fs.access_path(path, !exclusive && flags & NO_FOLLOW == 0)?;
        let existing = match fs.lstat(&p) {
            Ok(st) => Some(st),
            Err(e) if e.starts_with("ENOENT:") && flags & (CREATE | EXCLUSIVE) != 0 => None,
            Err(e) => return Err(e),
        };
        let device = existing.as_ref().is_some_and(|st| st.mode & 0o170000 == 0o020000);
        let mounted = self.profile == Profile::Devices;
        let id = self.next_descriptor;
        let next = id.checked_add(1).filter(|n| *n <= i32::MAX as u32).ok_or("EMFILE")?;
        if self.descriptors.len() >= self.memory_vfs.max_entries() {
            return Err("ENOSPC".into());
        }
        if device && (mounted && flags & NO_FOLLOW != 0 || !mounted && flags & SYNCHRONIZE != 0) {
            return Err("ENOTSUP".into());
        }
        let target = if let Some(stat) = existing {
            if exclusive {
                return Err("EEXIST".into());
            }
            if stat.kind == VfsEntryKind::Symlink {
                return Err("ELOOP".into());
            }
            if stat.kind == VfsEntryKind::Directory {
                return Err("EISDIR".into());
            }
            if flags & READ != 0 && stat.mode & 0o400 == 0 || flags & WRITE != 0 && stat.mode & 0o200 == 0 {
                return Err("EACCES".into());
            }
            if device {
                Target::Device {
                    stat,
                    name: crate::vfs::basename_posix_path(&p),
                    mounted,
                }
            } else {
                let file = self.memory_vfs.retain_file(&p)?;
                if flags & TRUNCATE != 0 {
                    file.truncate(0)?;
                }
                Target::Regular(file)
            }
        } else {
            if mounted && p.starts_with("/dev/") {
                return Err(if flags & NO_FOLLOW != 0 { "ENOTSUP" } else { "ENOENT" }.into());
            }
            if fs.stat(&crate::vfs::dirname_posix_path(&p))?.mode & 0o300 != 0o300 {
                return Err("EACCES".into());
            }
            fs.write_file(&p, &[])?;
            fs.chmod(&p, mode)?;
            Target::Regular(self.memory_vfs.retain_file(&p)?)
        };
        let kind = match target {
            Target::Regular(_) | Target::ReadOnly(_) => 0,
            Target::Device { mounted: false, .. } => 1,
            Target::Device { mounted: true, .. } => 2,
        };
        self.descriptors.insert(
            id,
            Descriptor {
                target,
                flags,
                position: 0,
            },
        );
        self.next_descriptor = next;
        Ok((id, kind))
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_open_read_file(id: u32, ptr: *const u8, len: usize, mode: u32) -> i32 {
    let mut map = sessions().lock().unwrap();
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let path = unsafe { str_from_raw(ptr, len) };
    let wrapped = sess.profile == Profile::Memory && !sess.shell.backend.provided_devices;
    let stream = mode == 2;
    let mut syscall = if stream { "readStream" } else { "openReadFile" };
    let mut resolved = None;
    let result = (|| {
        let fs = &sess.shell.fs;
        let p = fs.access_path(path, true)?;
        let st = fs.lstat(&p)?;
        let null = st.mode & 0o170000 == 0o020000 && st.allocated_bytes == Some(0);
        if !stream && sess.profile == Profile::Devices && (p == "/dev" || p.starts_with("/dev/")) {
            return Err("ENOTSUP: operation not supported".into());
        }
        if wrapped && p == "/dev" {
            syscall = "";
            return Err("EISDIR: illegal operation on a directory".into());
        }
        resolved = Some(p);
        let p = resolved.as_deref().unwrap();
        let device = stream && st.mode & 0o170000 == 0o020000;
        let target = if null || device {
            Target::Device { stat: st, name: crate::vfs::basename_posix_path(p), mounted: sess.profile == Profile::Devices }
        } else if stream {
            Target::ReadOnly(fs.open_stream_reader(p)?)
        } else {
            Target::ReadOnly(fs.open_read_file(p, mode == 1)?)
        };
        let fd = sess.next_descriptor;
        let next = fd.checked_add(1).filter(|n| *n <= i32::MAX as u32).ok_or("EMFILE: too many open files")?;
        if sess.descriptors.len() >= sess.memory_vfs.max_entries() { return Err("ENOSPC: no space left on device".into()); }
        sess.descriptors.insert(fd, Descriptor { target, flags: READ, position: 0 });
        sess.next_descriptor = next;
        // Handle errors refer to the backing operand, not an overlay or mount alias.
        sess.last_output_buf.clear();
        sess.last_output_buf.push(if device { 5 } else if null { 4 } else { 3 });
        sess.last_output_buf.extend_from_slice(if sess.profile == Profile::Memory { path } else { p }.as_bytes());
        Ok(fd as i32)
    })();
    result.unwrap_or_else(|e: String| {
        let mut operand = path;
        if (wrapped || sess.profile == Profile::Overlay) && path.contains('\0') {
            return sess.read_error(&e, "resolve", path, None, Some("paths must be strings without NUL bytes"));
        }
        if wrapped && resolved.is_none() {
            if e.starts_with("EACCES:") && let Some((_, suffix)) = e.split_once(", lstat '") {
                syscall = "lstat";
                operand = suffix.strip_suffix('\'').unwrap_or(path);
            } else if e.starts_with("ELOOP:") || e.starts_with("ENOTDIR: not a directory '") {
                syscall = "";
            }
        }
        sess.read_error(&e, syscall, operand, resolved.as_deref(), None)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_open(id: u32, ptr: *const u8, len: usize, flags: u32, mode: u32) -> i32 {
    let mut map = sessions().lock().unwrap();
    let Some(sess) = map.get_mut(&id) else { return -1 };
    let path = unsafe { str_from_raw(ptr, len) };
    let prefix = if sess.profile == Profile::Devices && !path.starts_with('/') {
        "/"
    } else {
        ""
    };
    match sess.open_descriptor(path, flags, mode) {
        Ok((fd, kind)) => {
            sess.last_output_buf = vec![kind, u8::from(!prefix.is_empty())];
            fd as i32
        }
        Err(e) => {
            sess.last_output_buf = format!("{}:{prefix}{path}", e.split(':').next().unwrap()).into_bytes();
            -(sess.last_output_buf.len() as i32)
        }
    }
}

// read, write, truncate, stat, tell, probe, sync, close. position -1 uses the cursor.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_descriptor(
    id: u32,
    fd: u32,
    op: u32,
    position: f64,
    ptr: *const u8,
    len: usize,
) -> f64 {
    let mut map = sessions().lock().unwrap();
    let Some(sess) = map.get_mut(&id) else { return -1.0 };
    let random_bytes = if op == 0 && sess.descriptors.get(&fd).is_some_and(|d|
        d.flags & READ != 0 && matches!(&d.target, Target::Device { name, .. } if name == "urandom" || name == "random")
    ) {
        // Host entropy can reenter this instance, including closing the descriptor.
        drop(map);
        let mut bytes = vec![0; len];
        let result = bytes.chunks_mut(65536).try_for_each(fill_random).map(|()| bytes);
        map = sessions().lock().unwrap();
        Some(result)
    } else {
        None
    };
    let Some(sess) = map.get_mut(&id) else { return -1.0 };
    let result: Result<u64, String> = (|| {
        let d = sess.descriptors.get_mut(&fd).ok_or("EBADF")?;
        let sequential = position == -1.0;
        let offset = if sequential { d.position } else { position as u64 };
        match op {
            0 => {
                if d.flags & READ == 0 {
                    return Err("EBADF".into());
                }
                let bytes = match &d.target {
                    Target::ReadOnly(handle) => handle.read(offset, len)?,
                    Target::Regular(file) => file.read(offset, len),
                    Target::Device { name, .. } if name == "null" => Vec::new(),
                    Target::Device { .. } => match random_bytes {
                        Some(result) => result?,
                        None => vec![0; len],
                    },
                };
                let n = bytes.len() as u64;
                if sequential {
                    d.position += n;
                }
                sess.last_output_buf = bytes;
                Ok(n)
            }
            1 => {
                if d.flags & WRITE == 0 {
                    return Err("EBADF".into());
                }
                let end = match &d.target {
                    Target::ReadOnly(_) => return Err("EBADF".into()),
                    Target::Regular(file) => {
                        let append = d.flags & APPEND != 0;
                        if append && !sequential {
                            return Err("EINVAL".into());
                        }
                        if len == 0 {
                            return Ok(0);
                        }
                        file.write((!append).then_some(offset), unsafe { slice_from_raw(ptr, len) })? as u64
                    }
                    Target::Device { name, .. } if name == "urandom" => return Err("EPERM".into()),
                    Target::Device { mounted, .. } => {
                        if *mounted {
                            offset + len as u64
                        } else {
                            0
                        }
                    }
                };
                if sequential {
                    d.position = end;
                }
                Ok(len as u64)
            }
            2 => {
                if d.flags & WRITE == 0 {
                    return Err("EBADF".into());
                }
                match &d.target {
                    Target::Regular(file) => file.truncate(offset)?,
                    Target::Device { mounted: false, .. } => return Err("ENOTSUP".into()),
                    _ => {}
                }
                Ok(0)
            }
            3 => {
                sess.last_output_buf = stat_bytes(match &d.target {
                    Target::ReadOnly(handle) => handle.stat()?,
                    Target::Regular(f) => f.stat(),
                    Target::Device { stat, .. } => stat.clone(),
                });
                Ok(sess.last_output_buf.len() as u64)
            }
            4 => Ok(d.position),
            5 if !matches!(d.target, Target::Device { mounted: true, .. }) => Err("ENOTSUP".into()),
            6 if matches!(d.target, Target::Device { mounted: false, .. }) => Err("ENOTSUP".into()),
            5 | 6 => Ok(0),
            7 => {
                sess.descriptors.remove(&fd);
                Ok(0)
            }
            _ => Err("EINVAL".into()),
        }
    })();
    match result {
        Ok(n) => n as f64,
        Err(e) => {
            sess.last_output_buf = e.into_bytes();
            -(sess.last_output_buf.len() as f64)
        }
    }
}
