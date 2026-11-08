use config_mutations_rust::mock::{
    Action, Error, MockMachine, Operation, Request, directory_parts,
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn exclusive_write_collision_precedes_parent_admission() {
    let mut m = MockMachine::new(Operation::Write, u("/home/k/file"));
    assert_eq!(m.start().unwrap(), Request::Exclusive);
    assert_eq!(m.respond(true).unwrap(), Request::File);
    assert_eq!(
        m.respond(true).unwrap(),
        Request::Error(Error {
            code: "EEXIST",
            message: u("EEXIST: file already exists, open '/home/k/file'")
        })
    );
    assert!(m.respond(true).is_err());
    let mut m = MockMachine::new(Operation::Write, u("/home/k/file"));
    m.start().unwrap();
    assert_eq!(m.respond(false).unwrap(), Request::Parent);
    assert_eq!(m.respond(true).unwrap(), Request::Done(Action::Write));
}
#[test]
fn file_and_directory_admission_retains_stat_link_list_chmod_exists_semantics() {
    for op in [
        Operation::Stat,
        Operation::Lstat,
        Operation::List,
        Operation::Chmod,
        Operation::Exists,
    ] {
        let mut m = MockMachine::new(op, u("/home/k/file"));
        assert_eq!(m.start().unwrap(), Request::File);
        assert_eq!(m.respond(false).unwrap(), Request::Directory);
        let r = m.respond(true).unwrap();
        assert_eq!(
            r,
            Request::Done(match op {
                Operation::Stat => Action::Stat(0o755),
                Operation::Lstat => Action::Link,
                Operation::List => Action::List,
                Operation::Chmod => Action::Noop,
                Operation::Exists => Action::Exists(true),
                _ => unreachable!(),
            })
        );
    }
    let mut m = MockMachine::new(Operation::List, u("/file"));
    m.start().unwrap();
    assert_eq!(
        m.respond(true).unwrap(),
        Request::Error(Error {
            code: "ENOTDIR",
            message: u("ENOTDIR: not a directory, scandir '/file'")
        })
    );
}
#[test]
fn recursive_mkdir_skips_parent_and_missing_operations_keep_sdk_messages() {
    let mut m = MockMachine::new(Operation::Mkdir, u("/deep/path"));
    assert_eq!(m.start().unwrap(), Request::Recursive);
    assert_eq!(m.respond(true).unwrap(), Request::Done(Action::Mkdir(true)));
    for (op, name) in [
        (Operation::Read, "open"),
        (Operation::Unlink, "unlink"),
        (Operation::Rename, "rename"),
    ] {
        let mut m = MockMachine::new(op, u("🦀"));
        m.start().unwrap();
        assert_eq!(
            m.respond(false).unwrap(),
            Request::Error(Error {
                code: "ENOENT",
                message: u(&format!("ENOENT: no such file or directory, {name} '🦀'"))
            })
        );
    }
}
#[test]
fn directory_parts_preserve_utf16_for_platform_join_requests() {
    assert_eq!(
        directory_parts(&u("//home/k/./../🦀//"), 47),
        [u("home"), u("k"), u("."), u(".."), u("🦀")]
    );
    assert_eq!(
        directory_parts(&[92, 0xd800, 92, 0xdc00, 92], 92),
        [vec![0xd800], vec![0xdc00]]
    );
}
