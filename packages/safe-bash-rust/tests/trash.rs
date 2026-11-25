use safe_bash_rust::vfs::{TrashBackend, TrashItem, TrashLocation};
use safe_bash_rust::{FileStat, MemoryVfs, SafeBashFs, Shell, ShellOptions, VfsFileEntry};
use std::sync::{Arc, Mutex};
struct Trash {
    memory: MemoryVfs,
    calls: Mutex<Vec<String>>,
}
impl TrashBackend for Trash {
    fn put(&self, path: &str) -> Result<(), String> {
        if path == "/denied" {
            return Err("EACCES: denied".into());
        }
        self.calls.lock().unwrap().push(path.into());
        self.memory.mkdir_all("/.trash/files")?;
        self.memory.rename(path, "/.trash/files/item", true)
    }
    fn list(&self) -> Result<Vec<TrashItem>, String> {
        Ok(vec![TrashItem {
            name: "item".into(),
            path: "/a".into(),
            deletion_date: "2026-11-25T00:00:00".into(),
        }])
    }
    fn restore(&self, _: &str) -> Result<(), String> {
        self.memory.rename("/.trash/files/item", "/a", true)
    }
}
impl SafeBashFs for Trash {
    fn trash(&self, path: &str) -> Result<Option<TrashLocation<'_>>, String> {
        Ok(Some(TrashLocation {
            backend: self,
            path: path.into(),
        }))
    }
    fn read_file(&self, p: &str) -> Result<Vec<u8>, String> {
        self.memory.read_file(p)
    }
    fn write_file(&self, p: &str, b: &[u8]) -> Result<(), String> {
        self.memory.write_file(p, b)
    }
    fn mkdir_all(&self, p: &str) -> Result<(), String> {
        self.memory.mkdir_all(p)
    }
    fn remove_path(&self, _: &str) -> Result<(), String> {
        panic!("destructive fallback")
    }
    fn exists(&self, p: &str) -> bool {
        self.memory.exists(p)
    }
    fn is_dir(&self, p: &str) -> bool {
        self.memory.is_dir(p)
    }
    fn list_dir(&self, p: &str) -> Result<Vec<String>, String> {
        self.memory.list_dir(p)
    }
    fn symlink(&self, t: &str, p: &str) -> Result<(), String> {
        self.memory.symlink(t, p)
    }
    fn readlink(&self, p: &str) -> Result<String, String> {
        self.memory.readlink(p)
    }
    fn lstat(&self, p: &str) -> Result<FileStat, String> {
        self.memory.lstat(p)
    }
    fn stat(&self, p: &str) -> Result<FileStat, String> {
        self.memory.stat(p)
    }
    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        self.memory.export_entries()
    }
    fn replace_entries(&self, e: &[VfsFileEntry]) -> Result<(), String> {
        self.memory.replace_entries(e)
    }
}
#[test]
fn rm_flags_and_explicit_commands_share_one_subtree_operation() {
    let fs = Arc::new(Trash {
        memory: MemoryVfs::new(),
        calls: Mutex::new(vec![]),
    });
    fs.mkdir_all("/a/sub").unwrap();
    fs.write_file("/a/sub/file", b"saved").unwrap();
    fs.write_file("/denied", b"saved").unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions::default());
    assert_ne!(shell.exec("rm /a").unwrap().exit_code, 0);
    assert_eq!(shell.exec("rm -f /missing").unwrap().exit_code, 0);
    assert_ne!(shell.exec("rm -f /denied").unwrap().exit_code, 0);
    let result = shell.exec("printf 'y\\n' | rm -ri /a").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(*fs.calls.lock().unwrap(), ["/a"]);
    assert_eq!(
        fs.read_file("/.trash/files/item/sub/file").unwrap(),
        b"saved"
    );
    assert!(
        shell
            .exec("trash-list")
            .unwrap()
            .stdout
            .contains("item\t2026-11-25")
    );
    assert_eq!(shell.exec("trash-restore item").unwrap().exit_code, 0);
    assert_eq!(shell.exec("trash-put /a").unwrap().exit_code, 0);
    assert_eq!(fs.calls.lock().unwrap().len(), 2);
}
