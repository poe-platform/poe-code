use process_runner_rust::upload_transaction::{self, Action, Fault, Paths, Transaction};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn transaction(files: usize) -> Transaction {
    Transaction::new(
        Paths {
            workspace: u("/workspace"),
            upload: u("/upload"),
            archive: u("/upload/workspace.tar"),
        },
        (0..files).map(|index| u(&format!("{index}.txt"))).collect(),
    )
}
#[test]
fn upload_transaction_stages_files_and_atomically_promotes_in_sdk_order() {
    let mut tx = transaction(2);
    let mut kinds = Vec::new();
    loop {
        let effect = tx.next();
        kinds.push(effect.kind());
        if matches!(effect, Action::Done { .. }) {
            break;
        }
        assert_eq!(tx.advance(true, true), None);
    }
    assert_eq!(
        kinds,
        [
            "removeTree",
            "removeTree",
            "mkdir",
            "mkdir",
            "writeArchive",
            "writeFile",
            "writeFile",
            "stat",
            "rename",
            "rename",
            "rename",
            "removeTree",
            "done"
        ]
    );
    assert!(tx.success());
    assert_eq!(tx.advance(true, false), None);
    let mut tx = transaction(0);
    while !matches!(tx.next(), Action::Done { .. }) {
        tx.advance(true, false);
    }
    assert!(tx.success());
}
#[test]
fn failures_restore_missing_existing_workspace_but_never_replace_promoted_content() {
    let mut tx = transaction(0);
    while tx.next().kind() != "stat" {
        tx.advance(true, false);
    }
    tx.advance(true, true);
    assert_eq!(tx.next().kind(), "rename");
    tx.advance(true, false);
    assert_eq!(tx.next().kind(), "rename");
    assert_eq!(tx.advance(false, false), Some(Fault::Primary));
    assert_eq!(tx.next().kind(), "stat");
    tx.advance(true, false);
    let Action::Rename { source, target } = tx.next() else {
        panic!("missing restore");
    };
    assert_eq!(source, u("/workspace.upload-backup"));
    assert_eq!(target, u("/workspace"));
    assert_eq!(tx.advance(false, false), Some(Fault::Ignore));
    assert_eq!(tx.next().kind(), "removeTree");
    tx.advance(true, false);
    assert_eq!(tx.next().kind(), "removeFile");
    tx.advance(true, false);
    assert!(!tx.success());
    assert!(matches!(tx.next(), Action::Done { success: false }));
    let mut tx = transaction(0);
    while tx.next().kind() != "stat" {
        tx.advance(true, false);
    }
    tx.advance(true, true);
    tx.advance(true, false);
    tx.advance(true, false);
    assert_eq!(tx.advance(false, false), Some(Fault::Primary));
    tx.advance(true, true);
    assert_eq!(tx.next().kind(), "removeTree");
}
#[test]
fn preliminary_cleanup_faults_skip_rollback_and_rollback_stat_faults_replace_primary() {
    let mut tx = transaction(0);
    assert_eq!(tx.advance(false, false), Some(Fault::Primary));
    assert!(matches!(tx.next(), Action::Done { success: false }));
    let mut tx = transaction(0);
    tx.advance(true, false);
    tx.advance(true, false);
    assert_eq!(tx.advance(false, false), Some(Fault::Primary));
    assert_eq!(tx.next().kind(), "stat");
    assert_eq!(tx.advance(false, false), Some(Fault::Replace));
    assert!(matches!(tx.next(), Action::Done { success: false }));
    let mut tx = transaction(0);
    tx.advance(true, false);
    tx.advance(true, false);
    tx.advance(false, false);
    tx.advance(true, false);
    assert_eq!(tx.advance(false, false), Some(Fault::Ignore));
    assert_eq!(tx.advance(false, false), Some(Fault::Ignore));
    assert!(!tx.success());
    assert_eq!(
        upload_transaction::RENAME_ERROR,
        "Workspace transfer filesystem must support atomic rename."
    );
}
