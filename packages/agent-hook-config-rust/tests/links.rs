use agent_hook_config_rust::{
    Catalog,
    io::{FileHost, FsError, Stats},
    links::{self, LinkHost, PathFacts, Replaced, Scope},
};
use std::collections::HashMap;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[derive(Default)]
struct Memory {
    files: HashMap<Vec<u16>, Vec<u16>>,
    links: HashMap<Vec<u16>, Vec<u16>>,
    fail_link: bool,
    recreate: bool,
    ancestor_link: bool,
    calls: Vec<String>,
}
impl FileHost for Memory {
    type Error = &'static str;
    fn resolve(&mut self, parts: &[&[u16]]) -> Result<Vec<u16>, Self::Error> {
        Ok(u(&parts
            .iter()
            .map(|p| String::from_utf16_lossy(p))
            .collect::<Vec<_>>()
            .join("/")))
    }
    fn join(&mut self, directory: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        self.resolve(&[directory, path])
    }
    fn dirname(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        Ok(path[..path.iter().rposition(|u| *u == 47).unwrap()].to_vec())
    }
    fn lstat(&mut self, path: &[u16]) -> Result<Stats, FsError<Self::Error>> {
        if self.links.contains_key(path) || self.ancestor_link && path == u("/repo/.claude") {
            Ok(Stats {
                symbolic: true,
                file: false,
            })
        } else if self.files.contains_key(path) {
            Ok(Stats {
                symbolic: false,
                file: true,
            })
        } else {
            Err(FsError::NotFound("missing"))
        }
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
    fn write_new(&mut self, path: &[u16], text: &[u16]) -> Result<(), FsError<Self::Error>> {
        if self.files.contains_key(path) || self.links.contains_key(path) {
            return Err(FsError::Exists("exists"));
        }
        self.files.insert(path.to_vec(), text.to_vec());
        Ok(())
    }
    fn rename(&mut self, _from: &[u16], _to: &[u16]) -> Result<(), Self::Error> {
        unreachable!()
    }
    fn unlink(&mut self, path: &[u16]) -> Result<(), Self::Error> {
        self.calls.push("unlink".into());
        self.files.remove(path);
        self.links.remove(path);
        Ok(())
    }
}
impl LinkHost for Memory {
    fn path_facts(
        &mut self,
        resolved: &[u16],
        root: Option<&[u16]>,
    ) -> Result<PathFacts, Self::Error> {
        let base = root.unwrap_or(&[47]);
        let text = String::from_utf16_lossy(resolved);
        let prefix = String::from_utf16_lossy(base);
        Ok(PathFacts {
            root: u("/"),
            relative: u(text.strip_prefix(&format!("{prefix}/")).unwrap_or(&text)),
            absolute_relative: false,
            separator: 47,
        })
    }
    fn read_link(&mut self, path: &[u16]) -> Result<Vec<u16>, FsError<Self::Error>> {
        self.links
            .get(path)
            .cloned()
            .ok_or(FsError::NotFound("missing"))
    }
    fn symlink(&mut self, target: &[u16], path: &[u16]) -> Result<(), Self::Error> {
        if self.recreate {
            self.files.insert(path.to_vec(), u("new occupant"));
        }
        if self.fail_link {
            return Err("symlink denied");
        }
        self.links.insert(path.to_vec(), target.to_vec());
        Ok(())
    }
}
fn config() -> agent_hook_config_rust::Config {
    Catalog::builtins().unwrap().configs()[0].1.clone()
}
#[test]
fn same_agent_project_link_is_user_scoped_and_idempotent() {
    let cfg = config();
    let mut host = Memory::default();
    let first = links::symlink_hooks(
        Some(&cfg),
        Some(&cfg),
        &u("claude"),
        &u("claude"),
        &u("/repo"),
        &u("/home"),
        Scope::Project,
        &mut host,
    )
    .unwrap();
    assert_eq!(first.target_path, u("/home/.claude/settings.json"));
    assert_eq!(first.symlink_path, u("/repo/.claude/settings.json"));
    assert_eq!(first.replaced, Replaced::None);
    let second = links::symlink_hooks(
        Some(&cfg),
        Some(&cfg),
        &u("claude"),
        &u("claude"),
        &u("/repo"),
        &u("/home"),
        Scope::Project,
        &mut host,
    )
    .unwrap();
    assert_eq!(first, second);
    assert!(host.calls.is_empty());
}
#[test]
fn generated_file_is_restored_exclusively_and_restore_failure_retains_both_errors() {
    let cfg = config();
    let original =
        u(r#"{"hooks":{"Stop":[{"hooks":[{"statusMessage":"[generated:poe-code:old]"}]}]}}"#);
    for recreate in [false, true] {
        let mut host = Memory {
            fail_link: true,
            recreate,
            ..Memory::default()
        };
        host.files
            .insert(u("/repo/.claude/settings.json"), original.clone());
        let error = links::symlink_hooks(
            Some(&cfg),
            Some(&cfg),
            &u("claude"),
            &u("claude"),
            &u("/repo"),
            &u("/home"),
            Scope::Project,
            &mut host,
        )
        .unwrap_err();
        if recreate {
            assert!(matches!(error, links::Error::Restore { .. }));
            assert_eq!(
                host.files.get(&u("/repo/.claude/settings.json")),
                Some(&u("new occupant"))
            );
        } else {
            assert!(matches!(error, links::Error::Host("symlink denied")));
            assert_eq!(
                host.files.get(&u("/repo/.claude/settings.json")),
                Some(&original)
            );
        }
    }
}
#[test]
fn user_files_and_parent_symlinks_are_preserved() {
    let cfg = config();
    for content in [
        "{}",
        r#"{"permissions":{},"hooks":{"Stop":[{"hooks":[{"statusMessage":"[generated:poe-code:old]"}]}]}}"#,
    ] {
        let mut host = Memory::default();
        host.files
            .insert(u("/repo/.claude/settings.json"), u(content));
        assert!(matches!(
            links::symlink_hooks(
                Some(&cfg),
                Some(&cfg),
                &u("claude"),
                &u("claude"),
                &u("/repo"),
                &u("/home"),
                Scope::Project,
                &mut host
            ),
            Err(links::Error::UserAuthored(_))
        ));
        assert!(host.calls.is_empty());
    }
    let mut host = Memory {
        ancestor_link: true,
        ..Memory::default()
    };
    assert!(
        links::symlink_hooks(
            Some(&cfg),
            Some(&cfg),
            &u("claude"),
            &u("claude"),
            &u("/repo"),
            &u("/home"),
            Scope::Project,
            &mut host
        )
        .is_err()
    );
    assert!(host.calls.is_empty());
}
