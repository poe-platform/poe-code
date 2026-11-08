pub use crate::vfs::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_fs_reexports_normalize_and_memory_vfs() {
        assert_eq!(normalize_posix_path("/a/./b/../c"), "/a/c");
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/dir").unwrap();
        vfs.write_file("/dir/test.txt", b"ok").unwrap();
        assert_eq!(vfs.read_file("/dir/test.txt").unwrap(), b"ok");
    }

    #[test]
    fn unit_fs_reexports_overlay_and_mount_vfs() {
        let base = std::sync::Arc::new(MemoryVfs::new());
        let upper = std::sync::Arc::new(MemoryVfs::new());
        base.mkdir_all("/mnt").unwrap();
        base.write_file("/base.txt", b"base").unwrap();
        let overlay = OverlayVfs::new(base, upper);
        overlay.write_file("/base.txt", b"upper").unwrap();
        assert_eq!(overlay.read_file("/base.txt").unwrap(), b"upper");
    }
}
