use crate::vfs::{SafeBashFs, VfsFileEntry};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct RealVfs {
    root: PathBuf,
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
        follow_final: bool,
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
            if !follow_final && pending.is_empty() {
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
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(current)
    }
}

impl SafeBashFs for RealVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let host = self.walk(&self.root, path, true, false)?;
        std::fs::read(host).map_err(|e| e.to_string())
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let host = self.walk(&self.root, path, true, false)?;
        if let Some(parent) = host.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(host, data).map_err(|e| e.to_string())
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let host = self.walk(&self.root, path, false, false)?;
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

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let host = self.walk(&self.root, path, true, false)?;
        std::fs::create_dir_all(host).map_err(|e| e.to_string())
    }

    fn exists(&self, path: &str) -> bool {
        self.walk(&self.root, path, true, false)
            .map(|p| p.exists())
            .unwrap_or(false)
    }

    fn is_dir(&self, path: &str) -> bool {
        self.walk(&self.root, path, true, false)
            .map(|p| p.is_dir())
            .unwrap_or(false)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let host = self.walk(&self.root, path, true, false)?;
        let mut names = Vec::new();
        for entry in std::fs::read_dir(host).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        names.sort();
        Ok(names)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        #[cfg(unix)]
        {
            let host = self.walk(&self.root, path, false, false)?;
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
            if let Err(error) = self.walk(start, target, true, true)
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
        let host = self.walk(&self.root, path, false, false)?;
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
            assert_eq!(vfs.readlink("/nested/dir/link.txt").unwrap(), "hello.txt");
            vfs.symlink("/nested/dir/hello.txt", "/absolute").unwrap();
            assert_eq!(vfs.read_file("/absolute").unwrap(), b"real-vfs-bytes");
            assert_eq!(vfs.readlink("/absolute").unwrap(), "/nested/dir/hello.txt");
            assert!(vfs.symlink("../outside", "/escape").is_err());
            std::os::unix::fs::symlink(tmp_root.parent().unwrap(), tmp_root.join("outside"))
                .unwrap();
            assert!(vfs.list_dir("/outside").is_err());
            assert!(!vfs.exists("/outside"));
            assert!(vfs.write_file("/outside/never-created", b"x").is_err());
            assert!(vfs.readlink("/outside").is_err());
            vfs.remove_path("/outside").unwrap();
            vfs.symlink("nested/dir", "/alias").unwrap();
            assert_eq!(vfs.list_dir("/alias/..").unwrap(), vec!["dir"]);
        }

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
        vfs.append_file("/sub/tree/log.txt", b"b").unwrap();
        assert_eq!(vfs.read_file("/sub/tree/log.txt").unwrap(), b"ab");
        vfs.remove("/sub", true).unwrap();
        assert!(!vfs.exists("/sub"));
        let _ = std::fs::remove_dir_all(&tmp_root);
    }
}
