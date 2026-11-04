use crate::vfs::path::DeviceTraversal;
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
    devices: bool,
    namespaced: bool,
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

    fn device_path(
        &self,
        path: &str,
        follow: bool,
        traversal: DeviceTraversal,
    ) -> Result<String, String> {
        use crate::vfs::path::{DeviceLookup, walk_device_path};
        walk_device_path(
            path,
            follow,
            40,
            traversal,
            |p| {
                if !self.namespaced {
                    return Ok(None);
                }
                let bytes = self.request("namespace", p, &[], 0, 0)?;
                let root =
                    String::from_utf8(bytes).map_err(|_| "EIO: invalid filesystem namespace")?;
                if !root.starts_with('/')
                    || crate::vfs::normalize_posix_path(&root) != root
                    || !crate::vfs::is_path_within(&root, p)
                {
                    return Err("EIO: invalid filesystem namespace".into());
                }
                Ok(Some(root))
            },
            |p, _, _| match self.metadata("lstat", p, 0) {
                Ok(st) => Ok(match st.kind {
                    VfsEntryKind::Symlink => DeviceLookup::Link(
                        String::from_utf8(self.request("readlink", p, &[], 0, 0)?)
                            .map_err(|_| "EIO: invalid link")?,
                    ),
                    VfsEntryKind::Directory => DeviceLookup::Directory(st.mode & 0o100 != 0),
                    VfsEntryKind::File => DeviceLookup::Other,
                }),
                Err(e) if e.starts_with("ENOENT:") => Ok(DeviceLookup::Missing),
                Err(e) if e.starts_with("ENOTSUP:") && !self.namespaced => Ok(DeviceLookup::Other),
                Err(e) => Err(e),
            },
        )
    }

    fn mutable(&self, path: &str, follow: bool) -> Result<(), String> {
        if self.reserved_device(path, follow)?.is_some() {
            return Err(format!("EBUSY: resource busy or locked '{path}'"));
        }
        Ok(())
    }
    fn own_stamp(&self, bytes: Vec<u8>) -> Result<crate::vfs::PublicationStamp, String> {
        let id = u32::from_le_bytes(
            bytes
                .try_into()
                .map_err(|_| "EIO: invalid publication stamp")?,
        );
        let fs = *self;
        Ok(crate::vfs::PublicationStamp::new(
            id.into(),
            (id != 0).then(|| {
                Box::new(move || {
                    let _ = fs.request("forgetPublication", "", &[], id, 0);
                }) as Box<dyn FnOnce()>
            }),
        ))
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

fn device_metadata(entry: &str) -> Result<FileStat, String> {
    static DEVICES: std::sync::OnceLock<crate::vfs::MemoryVfs> = std::sync::OnceLock::new();
    DEVICES
        .get_or_init(|| {
            let fs = crate::vfs::MemoryVfs::new();
            fs.set_devices(crate::vfs::memory::Devices::Null);
            fs
        })
        .stat(entry)
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
    fn reserved_device(&self, path: &str, follow: bool) -> Result<Option<&'static str>, String> {
        if !self.devices {
            return Ok(None);
        }
        Ok(
            match self
                .device_path(path, follow, DeviceTraversal::Classify)?
                .as_str()
            {
                "/" => Some("/"),
                "/dev" => Some("/dev"),
                "/dev/null" => Some("/dev/null"),
                _ => None,
            },
        )
    }

    fn default_device_view(&self) -> bool {
        self.devices
    }

    fn access_path(&self, path: &str, follow: bool) -> Result<String, String> {
        if self.namespaced {
            return self.device_path(
                path,
                follow,
                DeviceTraversal::Access {
                    devices: self.devices,
                },
            );
        }
        crate::vfs::path::walk_path(
            path,
            follow,
            crate::vfs::path::WalkPurpose::Access,
            |p| (None, self, p.to_owned()),
            |_| false,
        )
    }

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
        if let Some(entry) = self.reserved_device(p, access != Exclusive)? {
            if access == Exclusive {
                return Err("EEXIST: file already exists".into());
            }
            if entry != "/dev/null" {
                return Err("EISDIR: illegal operation on a directory".into());
            }
            return Ok(None);
        }
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
    fn observe_publication(
        &self,
        path: &str,
        _generation: u64,
        mode: crate::vfs::PublicationMode,
    ) -> Result<crate::vfs::PublicationStamp, String> {
        use crate::vfs::PublicationMode::*;
        self.mutable(path, false)?;
        let bytes = self.request(
            "observePublication",
            path,
            &[],
            match mode {
                Write => 0,
                Rollback => 1,
                Replace => 2,
            },
            0,
        )?;
        self.own_stamp(bytes)
    }
    fn observe_patch(&self, path: &str) -> Result<(u64, crate::vfs::PublicationStamp), String> {
        self.mutable(path, false)?;
        let stamp = self.own_stamp(self.request("observePatch", path, &[], 0, 0)?)?;
        if stamp.version == 0 {
            return Err("filesystem does not support race-safe patch mutations".into());
        }
        Ok((stamp.version, stamp))
    }
    fn patch_file(
        &self,
        path: &str,
        bytes: Option<&[u8]>,
        expected: (u64, u64),
    ) -> Result<u64, String> {
        self.request(
            "patchFile",
            path,
            bytes.unwrap_or_default(),
            expected.0 as u32,
            u32::from(bytes.is_some()),
        )?;
        Ok(expected.1)
    }
    fn publish_file(
        &self,
        path: &str,
        data: &[u8],
        inputs: &[String],
        stamp: u64,
    ) -> Result<u64, String> {
        if stamp == 0 {
            return Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file publication".into());
        }
        for input in inputs {
            if input == path
                || self.request("publicationAlias", input, &[], stamp as u32, 0)? != [0]
            {
                return Err(
                    "INVALID_VALUE: Input and output VFS identities must be distinct".into(),
                );
            }
        }
        self.request("publish", path, data, stamp as u32, 0)?;
        Ok(stamp)
    }
    fn replace_file_entry_with_mode(
        &self,
        path: &str,
        bytes: &[u8],
        mode: u32,
        stamp: u64,
    ) -> Result<(), String> {
        if stamp == 0 {
            return Err("ENOTSUP: retained file replacement is unsupported".into());
        }
        self.request("replaceEntry", path, bytes, stamp as u32, mode)
            .map(drop)
    }
    fn remove_published(&self, path: &str, stamp: u64) -> Result<bool, String> {
        Ok(self.request("removePublished", path, &[], stamp as u32, 0)? == [1])
    }
    fn read_file(&self, p: &str) -> Result<Vec<u8>, String> {
        match self.reserved_device(p, true)? {
            Some("/dev/null") => return Ok(Vec::new()),
            Some(_) => return Err(format!("EISDIR: illegal operation on a directory '{p}'")),
            None => {}
        }
        self.request("readFile", p, &[], self.max_input as u32, 0)
    }
    fn write_file(&self, p: &str, b: &[u8]) -> Result<(), String> {
        match self.reserved_device(p, true)? {
            Some("/dev/null") => return Ok(()),
            Some(_) => return Err(format!("EISDIR: illegal operation on a directory '{p}'")),
            None => {}
        }
        self.request("writeFile", p, b, 0, 0).map(drop)
    }
    fn append_file(&self, p: &str, b: &[u8]) -> Result<(), String> {
        match self.reserved_device(p, true)? {
            Some("/dev/null") => return Ok(()),
            Some(_) => return Err(format!("EISDIR: illegal operation on a directory '{p}'")),
            None => {}
        }
        self.request("appendFile", p, b, 0, 0).map(drop)
    }
    fn create_file(&self, p: &str, b: &[u8], m: u32) -> Result<(), String> {
        if self.reserved_device(p, false)?.is_some() {
            return Err("EEXIST: file already exists".into());
        }
        self.request("writeFile", p, b, 1, m).map(drop)
    }
    fn mkdir_all(&self, p: &str) -> Result<(), String> {
        match self.reserved_device(p, true)? {
            Some("/dev/null") => return Err("EEXIST: file already exists".into()),
            Some(_) => return Ok(()),
            None => {}
        }
        self.request("mkdir", p, &[], 1, 0o777).map(drop)
    }
    fn mkdir_one(&self, p: &str, m: u32) -> Result<(), String> {
        if self.reserved_device(p, true)?.is_some() {
            return Err("EEXIST: file already exists".into());
        }
        self.request("mkdir", p, &[], 0, m).map(drop)
    }
    fn remove_path(&self, p: &str) -> Result<(), String> {
        self.mutable(p, false)?;
        self.request("rm", p, &[], 1, 0).map(drop)
    }
    fn remove_one(&self, p: &str, d: bool) -> Result<(), String> {
        if d && self.reserved_device(p, false)? == Some("/dev/null") {
            return Err("ENOTDIR: not a directory".into());
        }
        self.mutable(p, false)?;
        self.request(if d { "rmdir" } else { "unlink" }, p, &[], 0, 0)
            .map(drop)
    }
    fn rename(&self, p: &str, d: &str, no_replace: bool) -> Result<(), String> {
        self.mutable(p, false)?;
        self.mutable(d, false)?;
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
        let reserved = self.reserved_device(p, true)?;
        if reserved == Some("/dev/null") {
            return Err(format!("ENOTDIR: not a directory '{p}'"));
        }
        let names = match self.request("readdir", reserved.unwrap_or(p), &[], 0, 0) {
            Err(e)
                if reserved.is_some()
                    && (e.starts_with("ENOENT:") || e.starts_with("ENOTDIR:")) =>
            {
                Vec::new()
            }
            result => result?,
        };
        let mut entries: Vec<String> = names
            .split(|&b| b == 0)
            .filter(|b| !b.is_empty())
            .map(|b| {
                String::from_utf8(b.to_vec()).map_err(|_| "EIO: invalid directory entry".into())
            })
            .collect::<Result<_, String>>()?;
        if let Some(name) = reserved.map(|dir| if dir == "/" { "dev" } else { "null" })
            && !entries.iter().any(|n| n == name)
        {
            entries.push(name.into());
        }
        Ok(entries)
    }
    fn supports_hard_links(&self, path: &str) -> bool {
        self.reserved_device(path, false)
            .is_ok_and(|entry| entry.is_none())
            && self
                .request("canLink", path, &[], 0, 0)
                .is_ok_and(|reply| reply == [1])
    }
    fn hard_link(&self, source: &str, destination: &str) -> Result<(), String> {
        if self.reserved_device(source, false)?.is_some()
            || self.reserved_device(destination, false)?.is_some()
        {
            return Err("EBUSY: resource busy or locked".into());
        }
        self.request("link", source, destination.as_bytes(), 0, 0)
            .map(drop)
    }
    fn symlink(&self, t: &str, p: &str) -> Result<(), String> {
        self.mutable(p, false)?;
        self.request("symlink", t, p.as_bytes(), 0, 0).map(drop)
    }
    fn readlink(&self, p: &str) -> Result<String, String> {
        if self.reserved_device(p, false)?.is_some() {
            return Err(format!("EINVAL: invalid argument '{p}'"));
        }
        String::from_utf8(self.request("readlink", p, &[], 0, 0)?)
            .map_err(|_| "EIO: invalid link".into())
    }
    fn stat(&self, p: &str) -> Result<FileStat, String> {
        if let Some(entry @ ("/dev" | "/dev/null")) = self.reserved_device(p, true)? {
            return device_metadata(entry);
        }
        self.metadata("stat", p, 0)
    }
    fn lstat(&self, p: &str) -> Result<FileStat, String> {
        if let Some(entry @ ("/dev" | "/dev/null")) = self.reserved_device(p, false)? {
            return device_metadata(entry);
        }
        self.metadata("lstat", p, 0)
    }
    fn chmod(&self, p: &str, m: u32) -> Result<(), String> {
        self.mutable(p, true)?;
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
pub extern "C" fn safe_bash_bind_fs(id: u32, call: Callback, namespaced: bool) -> i32 {
    let mut sessions = super::sessions().lock().unwrap();
    let Some(session) = sessions.get_mut(&id) else {
        return -1;
    };
    session.shell.fs = Arc::new(HostFs {
        call,
        max_input: session.shell.limits().max_input_bytes,
        devices: !session.shell.backend.provided_devices,
        namespaced,
    });
    0
}
