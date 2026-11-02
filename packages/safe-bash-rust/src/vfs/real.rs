use crate::vfs::{FileStat, SafeBashFs, VfsEntryKind, VfsFileEntry};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct RealVfs {
    root: PathBuf,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Walk {
    Follow,
    Entry,
    RenameEntry,
}

fn mutation_error(e: std::io::Error) -> String {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::NotFound => "ENOENT: no such file or directory".into(),
        ErrorKind::AlreadyExists => "EEXIST: file already exists".into(),
        ErrorKind::IsADirectory => "EISDIR: illegal operation on a directory".into(),
        ErrorKind::NotADirectory => "ENOTDIR: not a directory".into(),
        ErrorKind::DirectoryNotEmpty => "ENOTEMPTY: directory not empty".into(),
        ErrorKind::PermissionDenied => "EACCES: permission denied".into(),
        ErrorKind::CrossesDevices => "EXDEV: cross-device link not permitted".into(),
        ErrorKind::InvalidInput => "EINVAL: invalid argument".into(),
        _ => e.to_string(),
    }
}

impl RealVfs {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(root.as_ref()).map_err(|e| e.to_string())?;
        if !canonical.is_dir() {
            return Err("ENOTDIR: filesystem root is not a directory".into());
        }
        Ok(Self { root: canonical })
    }

    // Like the JS host adapter, this assumes the host tree is not concurrently
    // replaced by another writer between path resolution and the operation.
    fn walk(
        &self,
        start: &Path,
        path: &str,
        mode: Walk,
        from_link: bool,
    ) -> Result<PathBuf, String> {
        if std::fs::canonicalize(&self.root).map_err(|e| e.to_string())? != self.root {
            return Err("EACCES: filesystem root changed".into());
        }
        let mut current = start.to_owned();
        let mut pending: Vec<_> = path
            .split('/')
            .rev()
            .filter(|s| !s.is_empty())
            .map(|s| (s.to_owned(), from_link))
            .collect();
        let mut hops = 0;
        while let Some((name, link)) = pending.pop() {
            match name.as_str() {
                "." => continue,
                ".." => {
                    if current != self.root {
                        current.pop();
                    } else if link {
                        return Err("EACCES: symlink target escapes root".into());
                    }
                    continue;
                }
                _ => {}
            }
            if Path::new(&name).file_name() != Some(name.as_ref()) {
                return Err("EINVAL: invalid path component".into());
            }
            current.push(&name);
            if mode != Walk::Follow && pending.is_empty() {
                break;
            }
            match std::fs::symlink_metadata(&current) {
                Ok(meta) if meta.is_symlink() => {
                    hops += 1;
                    if hops > 40 {
                        return Err("ELOOP: too many symbolic links".into());
                    }
                    let target = std::fs::read_link(&current).map_err(|e| e.to_string())?;
                    current.pop();
                    let rest = if target.is_absolute() {
                        current.clone_from(&self.root);
                        target
                            .strip_prefix(&self.root)
                            .map_err(|_| "EACCES: symlink target escapes root")?
                    } else {
                        &target
                    };
                    let rest = rest.to_str().ok_or("EINVAL: non-UTF-8 link target")?;
                    pending.extend(
                        rest.split('/')
                            .rev()
                            .filter(|s| !s.is_empty())
                            .map(|s| (s.to_owned(), true)),
                    );
                }
                Ok(meta) if !meta.is_file() && !meta.is_dir() => {
                    return Err("ENOTSUP: unsupported file type".into());
                }
                Ok(meta) if !meta.is_dir() && !pending.is_empty() => {
                    return Err("ENOTDIR: not a directory".into());
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound && (mode != Walk::RenameEntry || pending.is_empty()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("ENOENT: no such file or directory".into()),
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(current)
    }

    fn write_bytes(&self, path: &str, data: &[u8], append: bool) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        if let Some(parent) = host.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        use std::io::Write;
        std::fs::OpenOptions::new().write(true).append(append).truncate(!append).create(true)
            .open(host).and_then(|mut f| f.write_all(data)).map_err(|e| e.to_string())
    }

    fn metadata(&self, path: &str, follow: bool) -> Result<FileStat, String> {
        let host = self.walk(&self.root, path, if follow { Walk::Follow } else { Walk::Entry }, false)?;
        let meta = std::fs::symlink_metadata(host).map_err(|e| e.to_string())?;
        let kind = if meta.is_file() {
            VfsEntryKind::File
        } else if meta.is_dir() {
            VfsEntryKind::Directory
        } else if meta.is_symlink() {
            VfsEntryKind::Symlink
        } else {
            return Err("ENOTSUP: unsupported file type".into());
        };
        #[cfg(unix)]
        let mode = std::os::unix::fs::PermissionsExt::mode(&meta.permissions());
        #[cfg(not(unix))]
        let mode = match kind {
            VfsEntryKind::File => 0o100666,
            VfsEntryKind::Directory => 0o040777,
            VfsEntryKind::Symlink => 0o120777,
        } & if meta.permissions().readonly() {
            !0o222
        } else {
            !0
        };
        #[cfg(unix)]
        let (identity, allocated_bytes, nlink, uid, gid, io_block_size) = {
            use std::os::unix::fs::MetadataExt;
            (Some(crate::vfs::EntryIdentity::Unix(meta.dev(), meta.ino())), meta.blocks().checked_mul(512), Some(meta.nlink() as usize), Some(meta.uid()), Some(meta.gid()), Some(meta.blksize()))
        };
        #[cfg(not(unix))]
        let (identity, allocated_bytes, nlink, uid, gid, io_block_size) = (None, None, None, None, None, None);
        let timestamp = |time: std::time::SystemTime| {
            let millis = |d: Duration| d.as_secs() as f64 * 1000.0 + d.subsec_nanos() as f64 / 1e6;
            time.duration_since(UNIX_EPOCH).map(millis).unwrap_or_else(|e| -millis(e.duration()))
        };
        Ok(FileStat {
            nlink, uid, gid, io_block_size, filesystem_type: None,
            identity,
            allocated_bytes,
            kind,
            mode,
            size: meta.len().try_into().map_err(|_| "EOVERFLOW: file size")?,
            #[cfg(unix)]
            ctime_ms: {
                use std::os::unix::fs::MetadataExt;
                Some(meta.ctime() as f64 * 1000.0 + meta.ctime_nsec() as f64 / 1e6)
            },
            #[cfg(not(unix))]
            ctime_ms: None,
            birthtime_ms: meta.created().ok().map(timestamp),
            atime_ms: timestamp(meta.accessed().map_err(|e| e.to_string())?),
            mtime_ms: timestamp(meta.modified().map_err(|e| e.to_string())?),
        })
    }
}

impl super::OpenRedirectFile for std::fs::File {
    fn read_at(&self, offset: usize, limit: usize) -> Result<Vec<u8>, String> {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = self;
        file.seek(SeekFrom::Start(offset as u64)).map_err(mutation_error)?;
        let mut bytes = Vec::new();
        file.take(limit as u64).read_to_end(&mut bytes).map_err(mutation_error)?;
        Ok(bytes)
    }

    fn write_at(&self, offset: Option<usize>, bytes: &[u8]) -> Result<(), String> {
        use std::io::{Seek, SeekFrom, Write};
        let mut file = self;
        file.seek(offset.map_or(SeekFrom::End(0), |n| SeekFrom::Start(n as u64))).map_err(mutation_error)?;
        file.write_all(bytes).map_err(mutation_error)
    }
}

impl SafeBashFs for RealVfs {
    fn stat(&self, path: &str) -> Result<FileStat, String> {
        self.metadata(path, true)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        self.metadata(path, false)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        #[cfg(unix)]
        let permissions = std::os::unix::fs::PermissionsExt::from_mode(mode & 0o7777);
        #[cfg(not(unix))]
        let permissions = {
            let mut permissions = std::fs::metadata(&host)
                .map_err(|e| e.to_string())?
                .permissions();
            permissions.set_readonly(mode & 0o200 == 0);
            permissions
        };
        std::fs::set_permissions(host, permissions).map_err(|e| e.to_string())
    }

    fn set_times(&self, path: &str, atime_ms: Option<f64>, mtime_ms: Option<f64>) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        let time = |ms: f64| {
            let duration = Duration::try_from_secs_f64(ms.abs() / 1000.0).map_err(|_| "EOVERFLOW: file timestamp")?;
            if ms < 0.0 { UNIX_EPOCH.checked_sub(duration) } else { UNIX_EPOCH.checked_add(duration) }.ok_or("EOVERFLOW: file timestamp")
        };
        let mut times = std::fs::FileTimes::new();
        if let Some(ms) = atime_ms { times = times.set_accessed(time(ms)?); }
        if let Some(ms) = mtime_ms { times = times.set_modified(time(ms)?); }
        std::fs::File::open(host).and_then(|file| file.set_times(times)).map_err(|e| e.to_string())
    }

    #[cfg(all(target_os = "linux", any(target_arch = "x86", target_arch = "x86_64", target_arch = "riscv64", target_arch = "arm", target_arch = "aarch64")))]
    fn scratch_file(&self, directory: &str) -> Result<std::rc::Rc<dyn super::OpenRedirectFile>, String> {
        use std::os::unix::fs::OpenOptionsExt;
        let parent = self.walk(&self.root, directory, Walk::Follow, false)?;
        // Linux O_TMPFILE creates a private inode without a name to replace or clean up.
        let o_directory = if cfg!(any(target_arch = "arm", target_arch = "aarch64")) { 0o40000 } else { 0o200000 };
        std::fs::OpenOptions::new().read(true).write(true).custom_flags(0o20000000 | o_directory).mode(0o600)
            .open(parent).map(|file| std::rc::Rc::new(file) as _).map_err(mutation_error)
    }

    fn open_redirect_file(&self, path: &str, access: crate::vfs::RedirectAccess, create_mode: u32) -> Result<Option<std::rc::Rc<dyn super::OpenRedirectFile>>, String> {
        let exclusive = access == super::RedirectAccess::Exclusive;
        let host = self.walk(&self.root, path, if exclusive { Walk::RenameEntry } else { Walk::Follow }, false)?;
        let mut options = std::fs::OpenOptions::new();
        options.read(matches!(access, super::RedirectAccess::Read | super::RedirectAccess::ReadWrite))
            .write(access != super::RedirectAccess::Read).create(access != super::RedirectAccess::Read).create_new(exclusive)
            .append(access == super::RedirectAccess::Append).truncate(access == super::RedirectAccess::Truncate);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, create_mode);
        options.open(host).map(|f| Some(std::rc::Rc::new(f) as _)).map_err(mutation_error)
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        std::fs::read(host).map_err(mutation_error)
    }

    fn open_chunks(&self, path: &str) -> Result<super::ChunkReader<'_>, String> {
        use std::io::Read;
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        let mut file = std::fs::File::open(host).map_err(mutation_error)?;
        Ok(Box::new(move |chunk| {
            chunk.resize(65536, 0);
            let count = file.read(chunk).map_err(mutation_error)?;
            chunk.truncate(count);
            Ok(())
        }))
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        use std::io::Write;
        let host = self.walk(&self.root, path, Walk::RenameEntry, false)?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, mode);
        let mut file = options.open(host).map_err(mutation_error)?;
        file.write_all(data).map_err(mutation_error)?;
        #[cfg(unix)]
        file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(mode)).map_err(mutation_error)?;
        Ok(())
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_bytes(path, data, false)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_bytes(path, data, true)
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        if source.is_empty() || destination.is_empty() { return Err("ENOENT: no such file or directory".into()); }
        let from = self.walk(&self.root, source, Walk::RenameEntry, false)?;
        let to = self.walk(&self.root, destination, Walk::RenameEntry, false)?;
        if from == self.root || to == self.root { return Err("EBUSY: resource busy or locked".into()); }
        if [source, destination].iter().any(|p| matches!(p.trim_end_matches('/').rsplit('/').next(), Some("." | ".."))) {
            return Err("EINVAL: invalid argument".into());
        }
        if (source.ends_with('/') || destination.ends_with('/')) && !std::fs::symlink_metadata(&from).is_ok_and(|m| m.is_dir()) {
            return Err("ENOTDIR: not a directory".into());
        }
        let result = if no_replace {
            #[cfg(target_os = "linux")]
            {
                use std::ffi::{CString, c_char, c_int, c_uint};
                use std::os::unix::ffi::OsStrExt;
                unsafe extern "C" {
                    fn renameat2(oldfd: c_int, old: *const c_char, newfd: c_int, new: *const c_char, flags: c_uint) -> c_int;
                }
                let from = CString::new(from.as_os_str().as_bytes()).map_err(|_| "EINVAL: invalid argument")?;
                let to = CString::new(to.as_os_str().as_bytes()).map_err(|_| "EINVAL: invalid argument")?;
                // Absolute paths ignore dirfd; RENAME_NOREPLACE tests and moves atomically.
                if unsafe { renameat2(-100, from.as_ptr(), -100, to.as_ptr(), 1) } == 0 { Ok(()) }
                else { Err(std::io::Error::last_os_error()) }
            }
            #[cfg(not(target_os = "linux"))]
            return Err("ENOTSUP: operation not supported".into());
        } else {
            std::fs::rename(from, to)
        };
        result.map_err(mutation_error)
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::RenameEntry, false)?;
        if matches!(path.trim_end_matches('/').rsplit('/').next(), Some("." | "..")) {
            return Err("EINVAL: invalid argument".into());
        }
        if host == self.root { return Err("EBUSY: resource busy or locked".into()); }
        if path.ends_with('/') && !directory {
            return Err(if std::fs::symlink_metadata(host).map_err(mutation_error)?.is_dir() {
                "EISDIR: illegal operation on a directory"
            } else { "ENOTDIR: not a directory" }.into());
        }
        if directory { std::fs::remove_dir(host) } else { std::fs::remove_file(host) }.map_err(mutation_error)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::RenameEntry, false)?;
        if host == self.root
            || matches!(
                path.trim_end_matches('/').rsplit('/').next(),
                Some("." | "..")
            )
        {
            return Err("EBUSY: refusing to remove root or dot directory".into());
        }
        let meta = std::fs::symlink_metadata(&host).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            std::fs::remove_dir_all(host).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(host).map_err(|e| e.to_string())
        }
    }

    fn mkdir_one(&self, path: &str, mode: u32) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::RenameEntry, false)?;
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, mode);
        builder.create(host).map_err(|e| e.to_string())?;
        self.chmod(path, mode)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        std::fs::create_dir_all(host).map_err(|e| e.to_string())
    }

    fn exists(&self, path: &str) -> bool {
        self.walk(&self.root, path, Walk::Follow, false)
            .map(|p| p.exists())
            .unwrap_or(false)
    }

    fn is_dir(&self, path: &str) -> bool {
        self.walk(&self.root, path, Walk::Follow, false)
            .map(|p| p.is_dir())
            .unwrap_or(false)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        let mut names = Vec::new();
        for entry in std::fs::read_dir(host).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        names.sort();
        Ok(names)
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let host = self.walk(&self.root, path, Walk::Follow, false)?;
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(host).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entries.len() == limit { return Err("EFBIG: directory entry limit exceeded".into()); }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let mode = if kind.is_file() { 0o100000 } else if kind.is_symlink() { 0o120000 }
                else if kind.is_dir() { 0o040000 } else { return Err("ENOTSUP: unsupported file type".into()); };
            entries.push((entry.file_name().to_string_lossy().into_owned(), mode));
        }
        Ok(entries)
    }

    fn supports_hard_links(&self, _path: &str) -> bool { true }

    fn hard_link(&self, source: &str, destination: &str) -> Result<(), String> {
        let src = self.walk(&self.root, source, Walk::RenameEntry, false)?;
        let dst = self.walk(&self.root, destination, Walk::RenameEntry, false)?;
        std::fs::hard_link(src, dst).map_err(mutation_error)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        #[cfg(unix)]
        {
            let host = self.walk(&self.root, path, Walk::Entry, false)?;
            let parent = host
                .parent()
                .filter(|p| p.starts_with(&self.root))
                .ok_or("EBUSY: root")?;
            let (start, stored) = if target.starts_with('/') {
                (
                    self.root.as_path(),
                    self.root.join(target.trim_start_matches('/')),
                )
            } else {
                (parent, PathBuf::from(target))
            };
            if let Err(error) = self.walk(start, target, Walk::Follow, true)
                && !error.starts_with("ELOOP:")
            {
                return Err(error);
            }
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            std::os::unix::fs::symlink(stored, host).map_err(|e| e.to_string())
        }
        #[cfg(not(unix))]
        {
            let _ = (target, path);
            Err("ENOTSUP: symlink not supported on this host".to_string())
        }
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let host = self.walk(&self.root, path, Walk::Entry, false)?;
        let target = std::fs::read_link(host).map_err(|e| e.to_string())?;
        if target.is_absolute() {
            let relative = target
                .strip_prefix(&self.root)
                .map_err(|_| "EACCES: symlink target escapes root")?;
            return Ok(format!("/{}", relative.display()));
        }
        Ok(target.to_string_lossy().into_owned())
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        Ok(Vec::new())
    }

    fn replace_entries(&self, _entries: &[VfsFileEntry]) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_real_vfs_confines_paths_and_performs_crud() {
        let tmp_root =
            std::env::temp_dir().join(format!("safe_bash_real_vfs_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_root);
        std::fs::create_dir_all(&tmp_root).unwrap();

        let vfs = RealVfs::new(&tmp_root).unwrap();
        vfs.mkdir_all("/nested/dir").unwrap();
        assert!(vfs.is_dir("/nested/dir"));

        vfs.write_file("/nested/dir/hello.txt", b"real-vfs-bytes")
            .unwrap();
        assert!(vfs.exists("/nested/dir/hello.txt"));
        assert_eq!(
            vfs.read_file("/nested/dir/hello.txt").unwrap(),
            b"real-vfs-bytes"
        );
        assert_eq!(
            vfs.list_dir("/nested/dir").unwrap(),
            vec!["hello.txt".to_string()]
        );

        #[cfg(unix)]
        {
            vfs.symlink("hello.txt", "/nested/dir/link.txt").unwrap();
            assert!(vfs.create_file("/nested/dir/link.txt", b"no", 0o600).unwrap_err().starts_with("EEXIST"));
            assert_eq!(vfs.read_file("/nested/dir/hello.txt").unwrap(), b"real-vfs-bytes");
            assert_eq!(vfs.readlink("/nested/dir/link.txt").unwrap(), "hello.txt");
            vfs.hard_link("/nested/dir/link.txt", "/other-link").unwrap();
            let linked = vfs.lstat("/other-link").unwrap();
            assert_eq!(linked.identity, vfs.lstat("/nested/dir/link.txt").unwrap().identity);
            assert_eq!(linked.nlink, Some(2));
            vfs.remove_path("/other-link").unwrap();
            vfs.symlink("/nested/dir/hello.txt", "/absolute").unwrap();
            assert_eq!(vfs.read_file("/absolute").unwrap(), b"real-vfs-bytes");
            assert_eq!(vfs.readlink("/absolute").unwrap(), "/nested/dir/hello.txt");
            assert!(vfs.symlink("../outside", "/escape").is_err());
            std::os::unix::fs::symlink(tmp_root.parent().unwrap(), tmp_root.join("outside"))
                .unwrap();
            assert!(vfs.list_dir("/outside").is_err());
            assert!(vfs.hard_link("/nested/dir/hello.txt", "/outside/no-link").is_err());
            assert!(!vfs.exists("/outside"));
            assert!(vfs.write_file("/outside/never-created", b"x").is_err());
            assert!(vfs.readlink("/outside").is_err());
            assert!(vfs.rename("/nested/dir/hello.txt", "/outside/never-created", false).is_err());
            vfs.remove_path("/outside").unwrap();
            vfs.symlink("nested/dir", "/alias").unwrap();
            assert_eq!(vfs.list_dir("/alias/..").unwrap(), vec!["dir"]);
        }

        assert!(vfs.rename("/", "/moved", false).is_err());
        assert!(vfs.rename("/nested/dir/hello.txt", "/absent/../moved", false).is_err());
        #[cfg(target_os = "linux")]
        {
            vfs.write_file("/occupied", b"keep").unwrap();
            assert!(vfs.rename("/nested/dir/hello.txt", "/occupied", true).unwrap_err().starts_with("EEXIST:"));
            assert_eq!(vfs.read_file("/occupied").unwrap(), b"keep");
            vfs.rename("/nested/dir/hello.txt", "/moved", true).unwrap();
            vfs.rename("/moved", "/nested/dir/hello.txt", false).unwrap();
        }
        assert!(vfs.remove_path("/absent/../nested").is_err());
        assert!(vfs.remove_path("/").is_err());
        vfs.remove_path("/nested/dir/hello.txt").unwrap();
        assert!(!vfs.exists("/nested/dir/hello.txt"));

        let _ = std::fs::remove_dir_all(&tmp_root);
    }

    #[test]
    fn unit_real_vfs_chmod_stat_and_directory_traversal_normalization() {
        let tmp_root =
            std::env::temp_dir().join(format!("safe_bash_real_vfs_stat_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_root);
        std::fs::create_dir_all(&tmp_root).unwrap();

        let vfs = RealVfs::new(&tmp_root).unwrap();
        vfs.write_file("/../../confined.txt", b"safe").unwrap();
        assert!(vfs.exists("/confined.txt"));
        let st = vfs.stat("/confined.txt").unwrap();
        assert_eq!(st.size, 4);
        assert_eq!(st.kind, crate::VfsEntryKind::File);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            vfs.mkdir("/shared/nested", true, 0o777).unwrap();
            assert_eq!(vfs.stat("/shared/nested").unwrap().mode & 0o777, 0o777);
            assert!(vfs.mkdir_one("/shared", 0o700).is_err());
            assert_eq!(vfs.stat("/shared").unwrap().mode & 0o777, 0o777);
            vfs.symlink("confined.txt", "/alias").unwrap();
            vfs.chmod("/alias", 0o610).unwrap();
            vfs.set_mtime("/alias", 1_600_000_001_234).unwrap();
            let metadata = std::fs::metadata(tmp_root.join("confined.txt")).unwrap();
            assert_eq!(metadata.permissions().mode() & 0o7777, 0o610);
            let stat = vfs.stat("/alias").unwrap();
            assert_eq!(stat.mode, 0o100610);
            assert_eq!(stat.mtime_ms, 1_600_000_001_234.0);
            assert_eq!(
                vfs.lstat("/alias").unwrap().kind,
                crate::VfsEntryKind::Symlink
            );
        }

        let _ = std::fs::remove_dir_all(&tmp_root);
    }

    #[test]
    fn unit_real_vfs_append_and_remove_recursive() {
        let tmp_root =
            std::env::temp_dir().join(format!("safe_bash_real_vfs_app_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_root);
        std::fs::create_dir_all(&tmp_root).unwrap();
        let vfs = RealVfs::new(&tmp_root).unwrap();
        vfs.mkdir_all("/sub/tree").unwrap();
        vfs.write_file("/sub/tree/log.txt", b"a").unwrap();
        vfs.set_times("/sub/tree/log.txt", Some(1_000.0), None).unwrap();
        vfs.append_file("/sub/tree/log.txt", b"b").unwrap();
        assert_eq!(vfs.stat("/sub/tree/log.txt").unwrap().atime_ms, 1_000.0);
        assert_eq!(vfs.read_file("/sub/tree/log.txt").unwrap(), b"ab");
        vfs.remove("/sub", true).unwrap();
        assert!(!vfs.exists("/sub"));
        let _ = std::fs::remove_dir_all(&tmp_root);
    }
}
