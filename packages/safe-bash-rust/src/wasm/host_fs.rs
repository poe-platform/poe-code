use crate::vfs::{EntryIdentity, FileStat, SafeBashFs, VfsEntryKind, VfsFileEntry};
use std::sync::Arc;

#[repr(C)]
struct Field {
    ptr: *const u8,
    len: usize,
}
impl From<&[u8]> for Field {
    fn from(bytes: &[u8]) -> Self {
        Self {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}
#[repr(C)]
pub struct Request {
    operation: Field,
    path: Field,
    data: Field,
    flags: u32,
    mode: u32,
}
#[repr(C)]
pub struct Reply {
    ptr: *mut u8,
    len: usize,
}
type Callback = unsafe extern "C" fn(*const Request, *mut Reply, u32) -> i32;

#[derive(Debug, Clone, Copy)]
struct HostFs {
    call: Callback,
    max_input: usize,
}
impl HostFs {
    fn request(
        &self,
        operation: &str,
        path: &str,
        data: &[u8],
        flags: u32,
        mode: u32,
    ) -> Result<Vec<u8>, String> {
        let request = Request {
            operation: operation.as_bytes().into(),
            path: path.as_bytes().into(),
            data: data.into(),
            flags,
            mode,
        };
        let mut reply = Reply {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        // JS copies the request before suspension and transfers an exact safe_bash_alloc allocation back.
        let status = unsafe { (self.call)(&request, &mut reply, 0) };
        let data = if reply.len == 0 {
            Vec::new()
        } else {
            unsafe { Vec::from_raw_parts(reply.ptr, reply.len, reply.len) }
        };
        if status == 0 {
            Ok(data)
        } else {
            Err(String::from_utf8_lossy(&data).into_owned())
        }
    }

    fn metadata(&self, operation: &str, path: &str, handle: u32) -> Result<FileStat, String> {
        let data = self.request(operation, path, &[], handle, 0)?;
        let numbers: Vec<_> = data
            .chunks_exact(8)
            .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
            .collect();
        let [
            mode,
            size,
            atime_ms,
            mtime_ms,
            ctime,
            birth,
            revision,
            nlink,
            uid,
            gid,
            dev,
            ino,
            allocated,
            block,
            preferred,
            memory,
        ] = numbers[..]
        else {
            return Err("EIO: invalid host stat".into());
        };
        let mode = mode as u32;
        Ok(FileStat {
            kind: match mode & 0o170000 {
                0o040000 => VfsEntryKind::Directory,
                0o120000 => VfsEntryKind::Symlink,
                _ => VfsEntryKind::File,
            },
            mode,
            size: size as usize,
            atime_ms,
            mtime_ms,
            ctime_ms: ctime.is_finite().then_some(ctime),
            birthtime_ms: birth.is_finite().then_some(birth),
            revision: revision.is_finite().then_some(revision as u64),
            nlink: nlink.is_finite().then_some(nlink as usize),
            uid: uid.is_finite().then_some(uid as u32),
            gid: gid.is_finite().then_some(gid as u32),
            identity: (dev.is_finite() && ino.is_finite())
                .then_some(EntryIdentity::Unix(dev as u64, ino as u64)),
            allocated_bytes: allocated.is_finite().then_some(allocated as u64),
            io_block_size: block.is_finite().then_some(block as u64),
            preferred_io_block_size: preferred.is_finite().then_some(preferred as u64),
            filesystem_type: (memory == 1.0).then_some("memory"),
        })
    }
}

#[derive(Debug)]
struct HostDescriptor {
    fs: HostFs,
    id: u32,
}

impl Drop for HostDescriptor {
    fn drop(&mut self) {
        let _ = self.fs.request("close", "", &[], self.id, 0);
    }
}
impl crate::vfs::OpenRedirectFile for HostDescriptor {
    fn stat(&self) -> Result<FileStat, String> {
        self.fs.metadata("fstat", "", self.id)
    }
    fn read_at(&self, offset: usize, limit: usize) -> Result<Vec<u8>, String> {
        self.fs.request(
            "pread",
            "",
            &(offset as u32).to_le_bytes(),
            self.id,
            limit.min(65536) as u32,
        )
    }
    fn write_at(&self, offset: Option<usize>, bytes: &[u8]) -> Result<(), String> {
        self.fs
            .request(
                "pwrite",
                "",
                bytes,
                self.id,
                offset.map_or(u32::MAX, |n| n as u32),
            )
            .map(drop)
    }
    fn truncate_to(&self, len: usize) -> Result<(), String> {
        self.fs
            .request("ftruncate", "", &[], self.id, len as u32)
            .map(drop)
    }
}
impl SafeBashFs for HostFs {
    fn supports_command_descriptor(&self, p: &str) -> bool {
        self.request("canOpen", p, &[], 0, 0)
            .is_ok_and(|b| b.first() == Some(&1))
    }
    fn open_redirect_file(
        &self,
        p: &str,
        access: crate::vfs::RedirectAccess,
        mode: Option<u32>,
    ) -> Result<Option<std::rc::Rc<dyn crate::vfs::OpenRedirectFile>>, String> {
        use crate::vfs::RedirectAccess::*;
        let flags = match access {
            Read => 0,
            Write => 1,
            Truncate => 2,
            Append => 3,
            Exclusive => 4,
            ReadWrite => 5,
        };
        let reply = self.request("open", p, &[], flags, mode.unwrap_or(u32::MAX))?;
        if reply.is_empty() {
            if matches!(access, ReadWrite | Write) {
                return Err("ENOTSUP: operation not supported".into());
            }
            if access == Exclusive {
                self.create_file(p, &[], mode.ok_or("EINVAL: missing creation mode")?)?;
            }
            return Ok(None);
        }
        let id = u32::from_le_bytes(
            reply
                .try_into()
                .map_err(|_| "EIO: invalid host descriptor")?,
        );
        Ok(Some(std::rc::Rc::new(HostDescriptor { fs: *self, id })))
    }
    fn read_file(&self, p: &str) -> Result<Vec<u8>, String> {
        self.request("readFile", p, &[], self.max_input as u32, 0)
    }
    fn write_file(&self, p: &str, b: &[u8]) -> Result<(), String> {
        self.request("writeFile", p, b, 0, 0).map(drop)
    }
    fn append_file(&self, p: &str, b: &[u8]) -> Result<(), String> {
        self.request("appendFile", p, b, 0, 0).map(drop)
    }
    fn create_file(&self, p: &str, b: &[u8], m: u32) -> Result<(), String> {
        self.request("writeFile", p, b, 1, m).map(drop)
    }
    fn mkdir_all(&self, p: &str) -> Result<(), String> {
        self.request("mkdir", p, &[], 1, 0o777).map(drop)
    }
    fn mkdir_one(&self, p: &str, m: u32) -> Result<(), String> {
        self.request("mkdir", p, &[], 0, m).map(drop)
    }
    fn remove_path(&self, p: &str) -> Result<(), String> {
        self.request("rm", p, &[], 1, 0).map(drop)
    }
    fn remove_one(&self, p: &str, d: bool) -> Result<(), String> {
        self.request(if d { "rmdir" } else { "unlink" }, p, &[], 0, 0)
            .map(drop)
    }
    fn rename(&self, p: &str, d: &str, no_replace: bool) -> Result<(), String> {
        self.request("rename", p, d.as_bytes(), no_replace as u32, 0)
            .map(drop)
    }
    fn exists(&self, p: &str) -> bool {
        self.stat(p).is_ok()
    }
    fn is_dir(&self, p: &str) -> bool {
        self.stat(p)
            .is_ok_and(|s| s.kind == VfsEntryKind::Directory)
    }
    fn list_dir(&self, p: &str) -> Result<Vec<String>, String> {
        let names = self.request("readdir", p, &[], 0, 0)?;
        names
            .split(|&b| b == 0)
            .filter(|b| !b.is_empty())
            .map(|b| {
                String::from_utf8(b.to_vec()).map_err(|_| "EIO: invalid directory entry".into())
            })
            .collect()
    }
    fn symlink(&self, t: &str, p: &str) -> Result<(), String> {
        self.request("symlink", t, p.as_bytes(), 0, 0).map(drop)
    }
    fn readlink(&self, p: &str) -> Result<String, String> {
        String::from_utf8(self.request("readlink", p, &[], 0, 0)?)
            .map_err(|_| "EIO: invalid link".into())
    }
    fn stat(&self, p: &str) -> Result<FileStat, String> {
        self.metadata("stat", p, 0)
    }
    fn lstat(&self, p: &str) -> Result<FileStat, String> {
        self.metadata("lstat", p, 0)
    }
    fn chmod(&self, p: &str, m: u32) -> Result<(), String> {
        self.request("chmod", p, &[], 0, m).map(drop)
    }
    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        Err("ENOTSUP: host filesystem snapshots are unavailable".into())
    }
    fn replace_entries(&self, _: &[VfsFileEntry]) -> Result<(), String> {
        Err("ENOTSUP: host filesystem replacement is unavailable".into())
    }
}

// Only a private execution fork is bound; the original shell retains its filesystem.
#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_bind_fs(id: u32, call: Callback) -> i32 {
    let mut sessions = super::sessions().lock().unwrap();
    let Some(session) = sessions.get_mut(&id) else {
        return -1;
    };
    session.shell.fs = Arc::new(HostFs {
        call,
        max_input: session.shell.limits().max_input_bytes,
    });
    0
}
