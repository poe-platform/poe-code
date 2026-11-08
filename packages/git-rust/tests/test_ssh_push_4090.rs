use git_rust::{MemoryFs, cli::execute_git_cli};

fn git(fs: &MemoryFs, dir: &str, args: &[&str]) -> String {
    let result = execute_git_cli(fs, dir, args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout.trim().to_string()
}

fn repositories() -> MemoryFs {
    let fs = MemoryFs::new();
    git(&fs, "/remote", &["init", "-b", "main"]);
    commit(&fs, "/remote", "initial");
    git(&fs, "/", &["clone", "git@localhost:/remote", "/client"]);
    fs
}

fn commit(fs: &MemoryFs, dir: &str, content: &str) -> String {
    git(fs, dir, &["config", "user.name", "Test"]);
    git(fs, dir, &["config", "user.email", "test@example.com"]);
    fs.write_str(&format!("{dir}/file"), content);
    git(fs, dir, &["add", "file"]);
    git(fs, dir, &["commit", "-m", content]);
    git(fs, dir, &["rev-parse", "HEAD"])
}

#[test]
fn rejected_pushes_preserve_remote_objects_and_refs() {
    for rejection in ["not-fast-forward", "pre-receive", "update"] {
        let fs = repositories();
        let new_oid = commit(&fs, "/client", "incoming");
        if rejection == "not-fast-forward" {
            commit(&fs, "/remote", "diverged");
        } else {
            fs.write_str(
                &format!("/remote/.git/hooks/{rejection}"),
                &format!("#!/bin/sh\ngit cat-file -p {new_oid} > .git/inspected\nexit 1\n"),
            );
        }
        let objects = fs.list_paths_under("/remote/.git/objects");
        let remote_paths = fs.list_paths_under("/remote/.git");
        let head = git(&fs, "/remote", &["rev-parse", "HEAD"]);
        let tracking = git(&fs, "/client", &["rev-parse", "refs/remotes/origin/main"]);
        let result = execute_git_cli(&fs, "/client", &["push", "origin", "main"]);
        assert_ne!(result.exit_code, 0, "{rejection}");
        assert_eq!(
            fs.list_paths_under("/remote/.git/objects"),
            objects,
            "{rejection}"
        );
        assert!(
            !fs.list_paths_under("/remote/.git")
                .iter()
                .any(|path| path.starts_with("/remote/.git/incoming-"))
        );
        assert!(remote_paths.iter().all(|path| fs.exists(path)));
        assert_eq!(git(&fs, "/remote", &["rev-parse", "HEAD"]), head);
        assert_eq!(
            git(&fs, "/client", &["rev-parse", "refs/remotes/origin/main"]),
            tracking
        );
        if rejection != "not-fast-forward" {
            assert!(
                fs.read_str("/remote/.git/inspected")
                    .unwrap()
                    .contains("incoming")
            );
        }
    }
}

#[test]
fn deleting_branch_prunes_only_its_remote_tracking_ref() {
    let fs = repositories();
    git(&fs, "/client", &["branch", "topic"]);
    git(&fs, "/client", &["push", "origin", "topic"]);
    git(&fs, "/client", &["pack-refs", "--all"]);
    git(&fs, "/client", &["push", "origin", "--delete", "topic"]);
    assert_ne!(
        execute_git_cli(&fs, "/client", &["rev-parse", "refs/remotes/origin/topic"]).exit_code,
        0
    );
    git(&fs, "/client", &["rev-parse", "refs/remotes/origin/main"]);
    assert_ne!(
        execute_git_cli(&fs, "/remote", &["rev-parse", "refs/heads/topic"]).exit_code,
        0
    );
}

#[test]
fn accepted_push_hooks_read_quarantined_objects_before_promotion() {
    let fs = repositories();
    let new_oid = commit(&fs, "/client", "accepted incoming");
    let object_path = format!("/remote/.git/objects/{}/{}", &new_oid[..2], &new_oid[2..]);
    let script = format!(
        "#!/bin/sh\nif test -f {object_path}; then\n exit 1\nfi\ngit cat-file -p {new_oid} > .git/inspected\n"
    );
    for hook in ["pre-receive", "update"] {
        fs.write_str(&format!("/remote/.git/hooks/{hook}"), &script);
    }
    fs.write_str(
        "/remote/.git/hooks/post-receive",
        &format!("#!/bin/sh\ngit cat-file -p {new_oid} > .git/promoted\n"),
    );
    git(&fs, "/client", &["push", "origin", "main"]);
    assert!(fs.exists(&object_path));
    assert_eq!(git(&fs, "/remote", &["rev-parse", "HEAD"]), new_oid);
    for log in ["inspected", "promoted"] {
        assert!(
            fs.read_str(&format!("/remote/.git/{log}"))
                .unwrap()
                .contains("accepted incoming")
        );
    }
    assert!(
        !fs.list_paths_under("/remote/.git")
            .iter()
            .any(|path| path.starts_with("/remote/.git/incoming-"))
    );
    // After scope cleanup, ordinary reads must still work from the promoted store.
    assert!(git(&fs, "/remote", &["cat-file", "-p", &new_oid]).contains("accepted incoming"));
}
