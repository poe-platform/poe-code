use agent_skill_config_rust::exclude::{self, FsError, Host, PathFacts};
use std::collections::HashMap;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[derive(Default)]
struct Memory {
    files: HashMap<Vec<u16>, Vec<u16>>,
    link: Option<Vec<u16>>,
    collision: bool,
    partial: bool,
    rename_error: bool,
    git: Option<Vec<u16>>,
    removed: Vec<Vec<u16>>,
}
impl Host for Memory {
    type Error = &'static str;
    fn git_dir(&mut self, _cwd: &[u16]) -> Result<Option<Vec<u16>>, Self::Error> {
        Ok(self.git.clone())
    }
    fn path_facts(&mut self, path: &[u16]) -> Result<PathFacts, Self::Error> {
        Ok(PathFacts {
            resolved: path.to_vec(),
            root: u("/"),
            separator: 47,
            absolute: path.starts_with(&[47]),
        })
    }
    fn resolve(&mut self, cwd: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        Ok([cwd, &[47], path].concat())
    }
    fn join(&mut self, directory: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        let sep = if directory == [47] { vec![] } else { vec![47] };
        Ok([directory, &sep, path].concat())
    }
    fn dirname(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        Ok(path[..path.iter().rposition(|unit| *unit == 47).unwrap()].to_vec())
    }
    fn symbolic(&mut self, path: &[u16]) -> Result<bool, FsError<Self::Error>> {
        Ok(self.link.as_deref() == Some(path))
    }
    fn read(&mut self, path: &[u16]) -> Result<Vec<u16>, FsError<Self::Error>> {
        self.files
            .get(path)
            .cloned()
            .ok_or(FsError::NotFound("missing"))
    }
    fn mkdir(&mut self, _path: &[u16]) -> Result<(), Self::Error> {
        Ok(())
    }
    fn temporary_path(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        Ok([path, &u(".poe-code-test.tmp")].concat())
    }
    fn write_new(&mut self, path: &[u16], content: &[u16]) -> Result<(), FsError<Self::Error>> {
        if self.collision {
            return Err(FsError::Exists("exists"));
        }
        self.files.insert(path.to_vec(), content.to_vec());
        if self.partial {
            Err(FsError::Other("disk full"))
        } else {
            Ok(())
        }
    }
    fn rename(&mut self, from: &[u16], to: &[u16]) -> Result<(), Self::Error> {
        if self.rename_error {
            return Err("rename denied");
        }
        let content = self.files.remove(from).unwrap();
        self.files.insert(to.to_vec(), content);
        Ok(())
    }
    fn remove_force(&mut self, path: &[u16]) -> Result<(), Self::Error> {
        self.removed.push(path.to_vec());
        self.files.remove(path);
        Ok(())
    }
}
#[test]
fn blocks_preserve_utf16_unterminated_markers_and_duplicate_run_ownership() {
    let mut original = u("user");
    original.push(0xd800);
    let entries = vec![u(".codex/hooks.json")];
    let first = exclude::append(Some(&original), &u("run"), &entries, &u("custom")).unwrap();
    assert_eq!(first.id, u("run"));
    let second = exclude::append(Some(&first.content), &u("run"), &entries, &u("custom")).unwrap();
    assert_eq!(second.id, u("run:1"));
    let cleaned = exclude::remove(&second.content, &first.id, &u("custom")).unwrap();
    assert!(String::from_utf16_lossy(&cleaned).contains("custom:run:1 begin"));
    assert_eq!(
        exclude::remove(&cleaned, &second.id, &u("custom")).unwrap(),
        [original, u("\n")].concat()
    );
    let unfinished = u("# custom:run begin\nnever closed\n");
    assert_eq!(
        exclude::remove(&unfinished, &u("run"), &u("custom")).unwrap(),
        unfinished
    );
}
#[test]
fn validation_precedes_git_detection_and_no_git_is_noop() {
    let mut host = Memory::default();
    assert!(exclude::append_file(&u("/repo"), &u("run\nother"), &[], None, &mut host).is_err());
    assert_eq!(
        exclude::append_file(&u("/repo"), &u("run"), &[], None, &mut host).unwrap(),
        None
    );
    exclude::remove_file(&u("/repo"), &u("run"), None, &mut host).unwrap();
    assert!(host.files.is_empty());
}
#[test]
fn atomic_exclude_mutation_preserves_original_and_cleans_only_its_temporary_file() {
    for (collision, partial, rename_error) in [
        (true, false, false),
        (false, true, false),
        (false, false, true),
    ] {
        let mut host = Memory {
            git: Some(u(".git")),
            collision,
            partial,
            rename_error,
            ..Memory::default()
        };
        host.files.insert(u("/repo/.git/info/exclude"), u("user\n"));
        assert!(
            exclude::append_file(&u("/repo"), &u("run"), &[u("generated")], None, &mut host)
                .is_err()
        );
        assert_eq!(
            host.files.get(&u("/repo/.git/info/exclude")),
            Some(&u("user\n"))
        );
        assert_eq!(host.removed.is_empty(), collision);
    }
}
#[test]
fn symbolic_exclude_paths_are_refused_without_mutation() {
    let mut host = Memory {
        git: Some(u("/repo/.git")),
        link: Some(u("/repo/.git/info")),
        ..Memory::default()
    };
    assert!(exclude::append_file(&u("/repo"), &u("run"), &[], None, &mut host).is_err());
    assert!(host.files.is_empty());
}
