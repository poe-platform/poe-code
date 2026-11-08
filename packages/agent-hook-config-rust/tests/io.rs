use agent_hook_config_rust::{
    Catalog, GeneratedEntry, Handler,
    io::{self, FileHost, FsError, ReadScope, Stats},
};
use std::collections::{HashMap, HashSet};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[derive(Default)]
struct Memory {
    files: HashMap<Vec<u16>, Vec<u16>>,
    links: HashSet<Vec<u16>>,
    calls: Vec<(String, Vec<u16>)>,
    rename_error: bool,
    partial_write_error: bool,
}
impl FileHost for Memory {
    type Error = &'static str;
    fn resolve(&mut self, parts: &[&[u16]]) -> Result<Vec<u16>, Self::Error> {
        Ok(parts
            .iter()
            .map(|part| String::from_utf16_lossy(part))
            .collect::<Vec<_>>()
            .join("/")
            .encode_utf16()
            .collect())
    }
    fn join(&mut self, directory: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        let mut value = directory.to_vec();
        value.push(47);
        value.extend(path);
        Ok(value)
    }
    fn dirname(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        Ok(path[..path.iter().rposition(|unit| *unit == 47).unwrap()].to_vec())
    }
    fn lstat(&mut self, path: &[u16]) -> Result<Stats, FsError<Self::Error>> {
        self.calls.push(("lstat".into(), path.to_vec()));
        if self.links.contains(path) {
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
        self.calls.push(("read".into(), path.to_vec()));
        self.files
            .get(path)
            .cloned()
            .ok_or(FsError::NotFound("missing"))
    }
    fn mkdir(&mut self, path: &[u16]) -> Result<(), Self::Error> {
        self.calls.push(("mkdir".into(), path.to_vec()));
        Ok(())
    }
    fn write_new(&mut self, path: &[u16], content: &[u16]) -> Result<(), FsError<Self::Error>> {
        self.calls.push(("write".into(), path.to_vec()));
        if self.links.contains(path) || self.files.contains_key(path) {
            return Err(FsError::Exists("exists"));
        }
        self.files.insert(path.to_vec(), content.to_vec());
        if self.partial_write_error {
            Err(FsError::Other("write failed"))
        } else {
            Ok(())
        }
    }
    fn rename(&mut self, from: &[u16], to: &[u16]) -> Result<(), Self::Error> {
        self.calls.push(("rename".into(), from.to_vec()));
        if self.rename_error {
            return Err("rename failed");
        }
        let value = self.files.remove(from).unwrap();
        self.files.insert(to.to_vec(), value);
        Ok(())
    }
    fn unlink(&mut self, path: &[u16]) -> Result<(), Self::Error> {
        self.calls.push(("unlink".into(), path.to_vec()));
        self.files.remove(path);
        Ok(())
    }
}
fn entry() -> GeneratedEntry {
    GeneratedEntry {
        event: u("Stop"),
        matcher: None,
        generated_id: u("generated-current-0"),
        handler: Handler {
            kind: u("command"),
            command: Some(u("new")),
            args: None,
            timeout: None,
            status_message: Some(u("[generated:poe-code:current] new")),
        },
    }
}
#[test]
fn reading_scopes_preserve_user_project_order_and_reject_final_symlinks() {
    let mut host = Memory::default();
    host.files.insert(
        u("/home/.claude/settings.json"),
        u("{\"hooks\":{\"Stop\":[{\"hooks\":[{\"command\":\"user\"}]}]}}"),
    );
    host.files.insert(
        u("/work/.claude/settings.json"),
        u("{\"hooks\":{\"Stop\":[{\"hooks\":[{\"command\":\"project\"}]}]}}"),
    );
    let result = io::read_hooks(
        &Catalog::builtins().unwrap(),
        &u("/work"),
        &u("/home"),
        ReadScope::Merged,
        &mut host,
    )
    .unwrap();
    assert_eq!(
        result.read_paths,
        [
            u("/home/.claude/settings.json"),
            u("/work/.claude/settings.json")
        ]
    );
    assert_eq!(result.entries.len(), 2);
    host.links.insert(u("/work/.claude/settings.json"));
    assert!(
        io::read_hooks(
            &Catalog::builtins().unwrap(),
            &u("/work"),
            &u("/home"),
            ReadScope::Project,
            &mut host
        )
        .is_err()
    );
}
#[test]
fn atomic_write_retries_existing_temporary_paths_and_preserves_them() {
    let mut host = Memory::default();
    host.links.insert(u("/work/hooks.json.tmp-current-0"));
    let result = io::write_hooks(
        &u("/work/hooks.json"),
        &[entry()],
        &u("current"),
        false,
        &mut host,
    )
    .unwrap();
    assert!(result.file_created);
    assert_eq!(result.generated_written, 1);
    assert!(host.links.contains(&u("/work/hooks.json.tmp-current-0")));
    assert!(
        !host
            .files
            .contains_key(&u("/work/hooks.json.tmp-current-1"))
    );
    assert_eq!(
        String::from_utf16_lossy(host.files.get(&u("/work/hooks.json")).unwrap()),
        "{\n  \"hooks\": {\n    \"Stop\": [\n      {\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"new\",\n            \"statusMessage\": \"[generated:poe-code:current] new\"\n          }\n        ]\n      }\n    ]\n  }\n}\n"
    );
}
#[test]
fn failed_write_or_rename_cleans_only_owned_temporary_files() {
    for partial in [false, true] {
        let mut host = Memory {
            rename_error: !partial,
            partial_write_error: partial,
            ..Memory::default()
        };
        host.files
            .insert(u("/work/hooks.json"), u("{\"user\":true}"));
        assert!(
            io::write_hooks(
                &u("/work/hooks.json"),
                &[entry()],
                &u("current"),
                false,
                &mut host
            )
            .is_err()
        );
        assert_eq!(
            host.files.get(&u("/work/hooks.json")),
            Some(&u("{\"user\":true}"))
        );
        assert!(
            !host
                .files
                .contains_key(&u("/work/hooks.json.tmp-current-0"))
        );
    }
}

#[test]
fn atomic_file_text_preserves_js_numeric_key_order_and_escaped_structural_text() {
    let mut host = Memory::default();
    host.files.insert(
        u("/work/hooks.json"),
        u(r#"{"2":"second","1":"first","obj":{"5":true,"3":true},"text":"quote\"{[,:]}"}"#),
    );
    io::write_hooks(&u("/work/hooks.json"), &[], &u("current"), false, &mut host).unwrap();
    assert_eq!(
        host.files.get(&u("/work/hooks.json")).unwrap(),
        &u(
            "{\n  \"1\": \"first\",\n  \"2\": \"second\",\n  \"obj\": {\n    \"3\": true,\n    \"5\": true\n  },\n  \"text\": \"quote\\\"{[,:]}\",\n  \"hooks\": {}\n}\n"
        )
    );
}
