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
}
