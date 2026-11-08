mod support;
use config_extends_rust::discover::{Error, Host, find_base};
use std::collections::HashMap;
use support::complete;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
struct Memory {
    files: HashMap<Vec<u16>, Vec<u16>>,
    reads: Vec<Vec<u16>>,
    failure: Option<&'static str>,
}
impl Host for Memory {
    type Error = &'static str;
    fn join(&mut self, directory: &[u16], file: &[u16]) -> Vec<u16> {
        let mut path = directory.to_vec();
        path.push(47);
        path.extend(file);
        path
    }
    fn contains(&mut self, _directory: &[u16], file: &[u16]) -> bool {
        !file.windows(3).any(|window| window == [46, 46, 47])
    }
    async fn read(&mut self, path: &[u16]) -> Result<Option<Vec<u16>>, Self::Error> {
        self.reads.push(path.to_vec());
        if let Some(error) = self.failure {
            return Err(error);
        }
        Ok(self.files.get(path).cloned())
    }
}
fn memory(files: &[(&str, &str)]) -> Memory {
    Memory {
        files: files
            .iter()
            .map(|(path, content)| (u(path), u(content)))
            .collect(),
        reads: vec![],
        failure: None,
    }
}
#[test]
fn directory_and_extension_priority_and_missing_reads_follow_sdk_order() {
    let mut host = memory(&[
        ("/first/review.json", "first"),
        ("/second/review.md", "second"),
    ]);
    let result = complete(find_base(
        &u("review"),
        &[u("/first"), u("/second")],
        &mut host,
    ))
    .unwrap();
    assert_eq!(result.file_path, u("/first/review.json"));
    assert_eq!(result.content, u("first"));
    assert_eq!(result.base_index, 0);
    assert_eq!(
        host.reads,
        [
            "/first/review.md",
            "/first/review.yaml",
            "/first/review.yml",
            "/first/review.json"
        ]
        .map(u)
    );
    let mut host = memory(&[("/second/review.yaml", "second")]);
    assert_eq!(
        complete(find_base(
            &u("review"),
            &[u("/first"), u("/second")],
            &mut host
        ))
        .unwrap()
        .base_index,
        1
    );
}
#[test]
fn missing_reports_every_checked_path_and_host_errors_retain_identity() {
    let mut host = memory(&[]);
    assert_eq!(
        complete(find_base(&u("review"), &[u("/first")], &mut host)).unwrap_err(),
        Error::Policy(u(
            "Base \"review\" not found.\nChecked paths:\n- /first/review.md\n- /first/review.yaml\n- /first/review.yml\n- /first/review.json"
        ))
    );
    host.failure = Some("permission denied");
    assert_eq!(
        complete(find_base(&u("review"), &[u("/first")], &mut host)).unwrap_err(),
        Error::Host("permission denied")
    );
}
#[test]
fn containment_is_checked_before_reading_and_utf16_names_are_lossless() {
    let mut host = memory(&[]);
    assert_eq!(
        complete(find_base(&u("../secret"), &[u("/first")], &mut host)).unwrap_err(),
        Error::Policy(u(
            "Base name must remain inside configured base directories."
        ))
    );
    assert!(host.reads.is_empty());
    let name = vec![0xd800];
    let mut file = u("/first/");
    file.push(0xd800);
    file.extend(u(".md"));
    host.files.insert(file.clone(), u("body"));
    assert_eq!(
        complete(find_base(&name, &[u("/first")], &mut host))
            .unwrap()
            .file_path,
        file
    );
}
