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
struct TimedRequest {
    base: Request,
    atime_ms: f64,
    mtime_ms: f64,
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
    no_symlinks: bool,
    default_mkdir: bool,
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
        self.call_request(&Request {
            operation: operation.as_bytes().into(),
            path: path.as_bytes().into(),
            data: data.into(),
            flags,
            mode,
        })
    }
    fn call_request(&self, request: *const Request) -> Result<Vec<u8>, String> {
        let mut reply = Reply {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        // JS copies the request before suspension and transfers an exact safe_bash_alloc allocation back.
        let status = unsafe { (self.call)(request, &mut reply, 0) };
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
        Self::parse_stat(&data)
    }
    fn parse_stat(data: &[u8]) -> Result<FileStat, String> {
        let (fixed, name) = data.split_at_checked(136).ok_or("EIO: invalid host stat")?;
        let numbers: Vec<_> = fixed
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
            type_tag,
            scope,
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
            identity: (dev.is_finite() && ino.is_finite()).then_some(EntryIdentity::Host {
                scope: scope as u64, dev: dev as u64, ino: ino as u64,
            }),
            allocated_bytes: allocated.is_finite().then_some(allocated as u64),
            io_block_size: block.is_finite().then_some(block as u64),
            preferred_io_block_size: preferred.is_finite().then_some(preferred as u64),
            filesystem_type: match type_tag {
                0.0 if name.is_empty() => None,
                1.0 if name.is_empty() => Some("memory".into()),
                2.0 => Some(std::str::from_utf8(name).map_err(|_| "EIO: invalid host filesystem type")?.to_owned().into()),
                _ => return Err("EIO: invalid host stat".into()),
            },
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
        if self.id != 0 { let _ = self.fs.request("close", "", &[], self.id, 0); }
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
enum HostRead {
    File(HostDescriptor),
    Null,
}

impl crate::vfs::FileReadHandle for HostRead {
    fn stat(&self) -> Result<FileStat, String> {
        match self {
            Self::File(h) => h.fs.metadata("fstat", "", h.id),
            Self::Null => device_metadata("/dev/null"),
        }
    }
    fn seek_end(&self) -> Result<u64, String> {
        let Self::File(h) = self else { return Ok(0) };
        let bytes = h.fs.request("seekEnd", "", &[], h.id, 0)?;
        Ok(u64::from_le_bytes(
            bytes.try_into().map_err(|_| "EIO: invalid end offset")?,
        ))
    }
    fn read(&self, offset: u64, maximum: usize) -> Result<Vec<u8>, String> {
        let Self::File(h) = self else {
            return Ok(Vec::new());
        };
        let mut result = Vec::new();
        while result.len() < maximum {
            let position = offset
                .checked_add(result.len() as u64)
                .ok_or("EOVERFLOW: read offset")?;
            let size = (maximum - result.len()).min(65536).min(
                h.fs.max_input
                    .saturating_sub(result.len())
                    .saturating_add(1),
            );
            let data =
                h.fs.request("rangeRead", "", &position.to_le_bytes(), h.id, size as u32)?;
            if data.is_empty() {
                break;
            }
            if data.len() > size {
                return Err("EIO: invalid range read".into());
            }
            if data.len() > h.fs.max_input - result.len() {
                return Err("EFBIG: file input limit exceeded".into());
            }
            if data.len() == maximum {
                return Ok(data);
            }
            result
                .try_reserve(data.len())
                .map_err(|_| "ENOMEM: insufficient memory for range read")?;
            result.extend_from_slice(&data);
        }
        Ok(result)
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
    fn open_exclusive_redirect(&self, path: &str, mode: u32) -> Result<Option<crate::vfs::ChunkWriter<'static>>, String> {
        self.mutable(path, false)?;
        self.request("beginExclusive", path, &[], 0, mode)?;
        let fs = *self;
        let path = path.to_owned();
        let mut bytes = Vec::new();
        Ok(Some(Box::new(move |chunk| {
            if let Some(chunk) = chunk {
                bytes.try_reserve(chunk.len()).map_err(|_| "ENOMEM: redirection too large")?;
                bytes.extend_from_slice(chunk);
                Ok(())
            } else { fs.request("finishExclusive", &path, &bytes, 0, mode).map(drop) }
        })))
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
    fn retain_removal(&self,path:&str,parent:FileStat,expected:FileStat)->Result<crate::vfs::RemovalReceipt<'_>,String>{
        self.mutable(path,false)?;
        let data=self.request("retainRemoval",path,&[],0,0)?;
        if data.len()<16 { return Err("EIO: invalid removal receipt".into()); }
        let stamp=self.own_stamp(data[..4].to_vec())?;
        let parent_len=u32::from_le_bytes(data[12..16].try_into().unwrap()) as usize;
        let (parent_bytes,entry_bytes)=data[16..].split_at_checked(parent_len).ok_or("EIO: invalid removal receipt")?;
        let observed_parent=Self::parse_stat(parent_bytes)?;
        let observed=Self::parse_stat(entry_bytes)?;
        if parent.identity.is_none() || parent.identity!=observed_parent.identity || !expected.same_snapshot(&observed) {
            return Err("EAGAIN: ZIP move source changed during selection".into());
        }
        let scope=|offset|u32::from_le_bytes(data[offset..offset+4].try_into().unwrap());
        Ok(crate::vfs::RemovalReceipt { parent:(scope(4),parent.identity.unwrap()),entry:(scope(8),expected.identity.unwrap()),
            remove:Box::new(move |advance|{
                let receipt=stamp;
                self.request("removeRetained","",&[],receipt.version as u32,advance.try_into().map_err(|_|"EOVERFLOW: removal count")?)?;
                Ok(())
            })
        })
    }
    fn publish_zip_volumes(&self, files:Vec<(String,Vec<u8>,u32)>, guards:&[crate::vfs::PublicationStamp],
        temporary:Option<(&str,u64)>, _version:u64)->Result<(),String>{
        if files.len()!=guards.len() { return Err("ENOTSUP: split publication requires a receipt per volume".into()); }
        for (disk,((_,data,_),guard)) in files.iter().zip(guards).enumerate() {
            self.request("stageVolume",&format!(".zip-volume-{}",disk+1),data,guard.version as u32,temporary.map_or(0,|(_,id)|id as u32))?;
        }
        for guard in guards {self.request("validateVolume","",&[],guard.version as u32,0)?;}
        for ((path,_,mode),guard) in files.into_iter().zip(guards) {
            self.replace_file_entry_with_mode(&path,&[],mode,guard.version)?;
        }
        Ok(())
    }
    fn validate_staged_file(&self, path: &str, temporary: Option<(&str,u64)>, bytes: &[u8], stamp: u64, check_only: bool,
        check: &mut dyn FnMut(&str) -> bool) -> Result<(bool, u64), String> {
        let file = self.request("stageForTest", path, bytes, stamp as u32, temporary.map_or(0,|(_,id)|id as u32))?;
        let file = std::str::from_utf8(&file).map_err(|_| "EIO: invalid staging path")?;
        let valid = check(file);
        if check_only { self.request("discardCheckedArchive",path,&[],stamp as u32,valid.into())?; }
        Ok((valid,stamp))
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
                StagingDirectory => 3,
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
    fn inspect_extraction(
        &self,
        path: &str,
        allow_trusted_ancestry: bool,
    ) -> Result<(Option<FileStat>, crate::vfs::PublicationStamp), String> {
        if let Some(device) = self.reserved_device(path, false)? {
            return Ok((
                Some(device_metadata(device)?),
                crate::vfs::PublicationStamp::new(0, None),
            ));
        }
        let mut bytes = self.request(
            "inspectExtraction",
            path,
            &[],
            u32::from(allow_trusted_ancestry),
            0,
        )?;
        if bytes.len() < 4 {
            return Err("EIO: invalid extraction receipt".into());
        }
        let stat = if bytes.len() == 4 {
            None
        } else {
            Some(Self::parse_stat(&bytes[4..])?)
        };
        bytes.truncate(4);
        Ok((stat, self.own_stamp(bytes)?))
    }
    fn publish_extraction_symlink(&self,path:&str,target:&str,_parent:&FileStat,_expected:Option<&FileStat>,stamp:u64)->Result<(),String> {
        self.mutable(path,false)?;
        self.request("extractSymlink",path,target.as_bytes(),stamp as u32,0).map(drop)
    }
    fn prepare_extraction_directory(
        &self,
        path: &str,
        _parent: &FileStat,
        _expected: Option<&FileStat>,
        mode: u32,
        times: (Option<f64>, Option<f64>),
        stamp: u64,
    ) -> Result<FileStat, String> {
        if stamp == 0 {
            self.mutable(path, false)?;
            return Err("ENOTSUP: extraction directory metadata is unsupported".into());
        }
        let mut data = [0u8; 16];
        data[..8].copy_from_slice(&times.0.unwrap_or(f64::NAN).to_le_bytes());
        data[8..].copy_from_slice(&times.1.unwrap_or(f64::NAN).to_le_bytes());
        Self::parse_stat(&self.request(
            "prepareExtractionDirectory",
            path,
            &data,
            stamp as u32,
            mode,
        )?)
    }
    fn remove_extraction_entry(
        &self,
        path: &str,
        _expected: &FileStat,
        version: u64,
    ) -> Result<(), String> {
        self.mutable(path, false)?;
        self.request("removeExtraction", path, &[], version as u32, 0)
            .map(drop)
    }
    fn replace_file_with_backup(&self, path: &str, data: &[u8], version: u64, backup: &str, backup_version: u64) -> Result<(), String> {
        self.mutable(path, false)?;
        self.mutable(backup, false)?;
        self.request("replaceWithBackup", path, data, version as u32, backup_version as u32).map(drop)
    }
    fn replace_file_entry_with_metadata(
        &self,
        path: &str,
        data: &[u8],
        mode: u32,
        times: (Option<f64>, Option<f64>),
        stamp: u64,
    ) -> Result<(), String> {
        if stamp == 0 {
            return Err("ENOTSUP: retained file replacement is unsupported".into());
        }
        let request = TimedRequest {
            base: Request {
                operation: b"extractEntry".as_slice().into(),
                path: path.as_bytes().into(),
                data: data.into(),
                flags: stamp as u32,
                mode,
            },
            atime_ms: times.0.unwrap_or(f64::NAN),
            mtime_ms: times.1.unwrap_or(f64::NAN),
        };
        self.call_request((&raw const request).cast()).map(drop)
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
    fn open_read_file(
        &self,
        p: &str,
        allow_directory: bool,
    ) -> Result<Box<dyn crate::vfs::FileReadHandle>, String> {
        match self.reserved_device(p, true)? {
            Some("/dev/null") => return Ok(Box::new(HostRead::Null)),
            Some("/dev") => return Err("EISDIR: illegal operation on a directory".into()),
            _ => {}
        }
        let reply = self.request("openReadFile", p, &[], u32::from(allow_directory), 0)?;
        let id = u32::from_le_bytes(
            reply
                .try_into()
                .map_err(|_| "EIO: invalid retained handle")?,
        );
        Ok(Box::new(HostRead::File(HostDescriptor { fs: *self, id })))
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
    fn create_temp(&self, path: &str, directory: bool, mode: u32) -> Result<(), String> {
        if self.reserved_device(path, false)?.is_some() { return Err("EEXIST: file already exists".into()); }
        self.request("mktemp", path, &[], directory as u32, mode).map(drop)
    }
    fn create_file(&self, p: &str, b: &[u8], m: u32) -> Result<(), String> {
        if self.reserved_device(p, false)?.is_some() {
            return Err("EEXIST: file already exists".into());
        }
        // Use the host's private exclusive-create operation when no group or
        // other access is allowed: the backend must guarantee permission support.
        if m & 0o077 == 0 { return self.request("mktemp", p, b, 0, m).map(drop); }
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
    fn mkdir_with_default_mode(&self, path: &str, recursive: bool, try_backing: bool) -> Result<(), (String, &'static str, String)> {
        Self { default_mkdir: true, ..*self }.mkdir_with_operation(path, recursive, 0o755, try_backing)
    }
    fn mkdir_one(&self, p: &str, m: u32) -> Result<(), String> {
        if self.reserved_device(p, true)?.is_some() {
            return Err("EEXIST: file already exists".into());
        }
        self.request("mkdir", p, &[], if self.default_mkdir { 2 } else { 0 }, m).map(drop)
    }
    fn remove_command_entry(&self, path: &str, parent: &FileStat, expected: &FileStat, force: bool) -> Result<(), String> {
        self.mutable(path,false)?;
        let bytes = self.request("inspectRm",path,&[],0,0)?;
        let (header, stats) = bytes.split_at_checked(8).ok_or("EIO: invalid rm observation")?;
        let stamp = self.own_stamp(header[..4].to_vec())?;
        let (dir, entry) = stats.split_at_checked(u32::from_le_bytes(header[4..].try_into().unwrap()) as usize)
            .ok_or("EIO: invalid rm parent")?;
        if entry.is_empty() && force { return Ok(()); }
        if entry.is_empty() { return Err(format!("ENOENT: no such file or directory '{path}'")); }
        let mut current = Self::parse_stat(entry)?;
        current.atime_ms = expected.atime_ms;
        if current != *expected || parent.identity != Self::parse_stat(dir)?.identity {
            return Err(format!("EAGAIN: entry changed, rm '{path}'"));
        }
        self.request("removeObserved",path,&[],stamp.version as u32,u32::from(force)).map(drop)
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
    fn move_across_devices(&self, source: &str, destination: &str, budget: Option<&crate::ExecutionBudget>) -> Result<(), String> {
        use crate::vfs::FileReadHandle;
        let step = || { if let Some(b) = budget { b.check_cancelled()?; b.tick_fs_op()?; } Ok::<_, String>(()) };
        step()?;
        self.mutable(source, false)?;
        self.mutable(destination, false)?;
        let observed = self.request("retainMoveFile", source, &[], 0, 0)?;
        let (id, metadata) = observed.split_at_checked(4).ok_or("EIO: invalid move source")?;
        let source_guard = self.own_stamp(id.to_vec())?;
        let st = Self::parse_stat(metadata)?;
        if st.size > self.max_input {
            return Err(budget.map_or_else(|| "EFBIG: file input limit exceeded".into(), |b|
                b.record_exceeded(crate::ShellLimits::limit_error("maxInputBytes", self.max_input))));
        }
        step()?;
        let observed = self.request("inspectMoveDestination", destination, &[], 0, source_guard.version as u32)?;
        let (id, existing) = observed.split_at_checked(4).ok_or("EIO: invalid move destination")?;
        let target_guard = self.own_stamp(id.to_vec())?;
        if !existing.is_empty() && Self::parse_stat(existing)?.kind == VfsEntryKind::Directory {
            return Err(format!("EISDIR: illegal operation on a directory '{destination}'"));
        }
        step()?;
        let id = u32::from_le_bytes(self.request("openReadFile", source, &[], 0, 0)?.try_into()
            .map_err(|_| "EIO: invalid retained handle")?);
        let reader = HostRead::File(HostDescriptor { fs: *self, id });
        let check = || self.request("checkMoveRead", source, &[], source_guard.version as u32, id);
        step()?; check()?;
        let mut bytes = Vec::new();
        while bytes.len() < st.size {
            step()?;
            let chunk = reader.read(bytes.len() as u64, (st.size - bytes.len()).min(65536))?;
            if chunk.is_empty() { return Err(format!("EBUSY: move source changed during read '{source}'")); }
            bytes.try_reserve(chunk.len()).map_err(|_| "ENOMEM: insufficient memory for move")?;
            bytes.extend_from_slice(&chunk);
        }
        step()?; check()?;
        if let HostRead::File(mut descriptor) = reader {
            let id = std::mem::take(&mut descriptor.id);
            self.request("close", "", &[], id, 1)?;
        }
        step()?;
        self.replace_file_entry_with_metadata(destination, &bytes, st.mode & 0o7777,
            (Some(st.atime_ms), Some(st.mtime_ms)), target_guard.version)?;
        step()?;
        self.request("removeRetained", "", &[], source_guard.version as u32, 0).map(drop)
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
    fn supports_symbolic_links(&self, _entry: &str) -> bool { !self.no_symlinks }
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
    fn set_times(&self, path: &str, atime: Option<f64>, mtime: Option<f64>) -> Result<(), String> {
        self.mutable(path, true)?;
        let times = match (atime, mtime) {
            (Some(a), Some(m)) => [a, m],
            (None, None) => return Ok(()),
            _ => {
                let st = self.stat(path)?;
                [atime.unwrap_or(st.atime_ms), mtime.unwrap_or(st.mtime_ms)]
            }
        };
        let bytes = [times[0].to_le_bytes(), times[1].to_le_bytes()].concat();
        self.request("utimes", path, &bytes, 0, 0).map(drop)
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
pub extern "C" fn safe_bash_bind_fs(id: u32, call: Callback, namespaced: bool, no_symlinks: bool) -> i32 {
    let mut sessions = super::sessions().lock().unwrap();
    let Some(session) = sessions.get_mut(&id) else {
        return -1;
    };
    session.shell.fs = Arc::new(HostFs {
        default_mkdir: false,
        call,
        max_input: session.shell.limits().max_input_bytes,
        devices: !session.shell.backend.provided_devices,
        namespaced,
        no_symlinks,
    });
    0
}
