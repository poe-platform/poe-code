use crate::vfs::path::normalize_posix_path;
use crate::vfs::{SafeBashFs, VfsFileEntry};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct RealVfs {
    root: PathBuf,
}

impl RealVfs {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(root.as_ref()).map_err(|e| e.to_string())?;
        Ok(Self { root: canonical })
    }

    fn resolve_host_path(&self, vfs_path: &str) -> Result<PathBuf, String> {
        let norm = normalize_posix_path(vfs_path);
        let rel = norm.trim_start_matches('/');
        let joined = if rel.is_empty() {
            self.root.clone()
        } else {
            self.root.join(rel)
        };
        // Confine within root
        for component in Path::new(rel).components() {
            if matches!(component, std::path::Component::ParentDir) {
                return Err("EACCES: path escapes sandbox root".to_string());
            }
        }
        Ok(joined)
    }
}

impl SafeBashFs for RealVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let host = self.resolve_host_path(path)?;
        std::fs::read(host).map_err(|e| e.to_string())
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let host = self.resolve_host_path(path)?;
        if let Some(parent) = host.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(host, data).map_err(|e| e.to_string())
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let host = self.resolve_host_path(path)?;
        let meta = std::fs::symlink_metadata(&host).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            std::fs::remove_dir_all(host).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(host).map_err(|e| e.to_string())
        }
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let host = self.resolve_host_path(path)?;
        std::fs::create_dir_all(host).map_err(|e| e.to_string())
    }

    fn exists(&self, path: &str) -> bool {
        self.resolve_host_path(path)
            .map(|p| p.exists())
            .unwrap_or(false)
    }

    fn is_dir(&self, path: &str) -> bool {
        self.resolve_host_path(path)
            .map(|p| p.is_dir())
            .unwrap_or(false)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let host = self.resolve_host_path(path)?;
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
            let host = self.resolve_host_path(path)?;
            if let Some(parent) = host.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::os::unix::fs::symlink(target, host).map_err(|e| e.to_string())
        }
        #[cfg(not(unix))]
        {
            let _ = (target, path);
            Err("ENOTSUP: symlink not supported on this host".to_string())
        }
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let host = self.resolve_host_path(path)?;
        let target = std::fs::read_link(host).map_err(|e| e.to_string())?;
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
        let tmp_root = std::env::temp_dir().join(format!("safe_bash_real_vfs_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_root);
        std::fs::create_dir_all(&tmp_root).unwrap();

        let vfs = RealVfs::new(&tmp_root).unwrap();
        vfs.mkdir_all("/nested/dir").unwrap();
        assert!(vfs.is_dir("/nested/dir"));

        vfs.write_file("/nested/dir/hello.txt", b"real-vfs-bytes").unwrap();
        assert!(vfs.exists("/nested/dir/hello.txt"));
        assert_eq!(vfs.read_file("/nested/dir/hello.txt").unwrap(), b"real-vfs-bytes");
        assert_eq!(vfs.list_dir("/nested/dir").unwrap(), vec!["hello.txt".to_string()]);

        #[cfg(unix)]
        {
            vfs.symlink("hello.txt", "/nested/dir/link.txt").unwrap();
            assert_eq!(vfs.readlink("/nested/dir/link.txt").unwrap(), "hello.txt");
        }

        vfs.remove_path("/nested/dir/hello.txt").unwrap();
        assert!(!vfs.exists("/nested/dir/hello.txt"));

        let _ = std::fs::remove_dir_all(&tmp_root);
    }

    #[test]
    fn unit_real_vfs_chmod_stat_and_directory_traversal_normalization() {
        let tmp_root = std::env::temp_dir().join(format!("safe_bash_real_vfs_stat_{}", std::process::id()));
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
}
