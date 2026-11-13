use git_rust::cli::execute_git_cli;
use git_rust::commands::plumbing::{read_commit, write_blob, write_commit, write_tree};
use git_rust::fixtures::make_fixture;
use git_rust::models::TreeEntry;

#[test]
fn merge_tree_preserves_deletion_across_multiple_bases() {
    let f = make_fixture("test-checkout");
    let gitdir = f.gitdir.clone();
    let head = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout;
    let template = read_commit(&f.fs, &gitdir, head.trim()).unwrap().commit;
    let make_commit = |paths: &[&str], parents: &[&str]| {
        let entries: Vec<_> = paths
            .iter()
            .map(|path| TreeEntry {
                mode: "100644".into(),
                path: (*path).into(),
                oid: write_blob(&f.fs, &gitdir, path.as_bytes()).unwrap(),
                entry_type: "blob".into(),
            })
            .collect();
        let mut commit = template.clone();
        commit.tree = write_tree(&f.fs, &gitdir, &entries).unwrap();
        commit.parent = parents.iter().map(|p| (*p).into()).collect();
        write_commit(&f.fs, &gitdir, &commit).unwrap()
    };
    let root = make_commit(&[], &[]);
    let x = make_commit(&["x"], &[&root]);
    let y = make_commit(&["y"], &[&root]);
    let u = make_commit(&["u", "y"], &[&x, &y]);
    let v = make_commit(&["v", "x", "y"], &[&y, &x]);
    let z = make_commit(&["z"], &[&root]);
    let three_u = make_commit(&["u", "y", "z"], &[&x, &y, &z]);
    let three_v = make_commit(&["v", "x", "y", "z"], &[&z, &y, &x]);
    let nested_u = make_commit(&["a", "u", "v", "y"], &[&u, &v]);
    let nested_v = make_commit(&["b", "u", "v", "y"], &[&v, &u]);
    let index = f.fs.read(&format!("{gitdir}/index"));
    let status = execute_git_cli(&f.fs, &f.dir, &["status", "--porcelain"]).stdout;
    for (left, right, expected) in [
        (&u, &v, "u\nv\ny\n"),
        (&three_u, &three_v, "u\nv\ny\nz\n"),
        (&nested_u, &nested_v, "a\nb\nu\nv\ny\n"),
    ] {
        for (ours, theirs) in [(left, right), (right, left)] {
            let result =
                execute_git_cli(&f.fs, &f.dir, &["merge-tree", "--write-tree", ours, theirs]);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let tree = execute_git_cli(
                &f.fs,
                &f.dir,
                &["ls-tree", "--name-only", result.stdout.trim()],
            );
            assert_eq!(tree.exit_code, 0, "{}", tree.stderr);
            assert_eq!(tree.stdout, expected);
            assert_eq!(f.fs.read(&format!("{gitdir}/index")), index);
            assert_eq!(
                execute_git_cli(&f.fs, &f.dir, &["status", "--porcelain"]).stdout,
                status
            );
        }
    }
    // Conflicting ancestors must not silently become an empty base or alter the index.
    let deleted = make_commit(&[], &[&x]);
    let modified = make_commit(&["x", "y"], &[&x]);
    let mut changed = read_commit(&f.fs, &gitdir, &modified).unwrap().commit;
    changed.tree = write_tree(
        &f.fs,
        &gitdir,
        &[TreeEntry {
            mode: "100644".into(),
            path: "x".into(),
            entry_type: "blob".into(),
            oid: write_blob(&f.fs, &gitdir, b"changed").unwrap(),
        }],
    )
    .unwrap();
    let modified = write_commit(&f.fs, &gitdir, &changed).unwrap();
    let left = make_commit(&["u"], &[&deleted, &modified]);
    let right = make_commit(&["v"], &[&modified, &deleted]);
    let result = execute_git_cli(
        &f.fs,
        &f.dir,
        &["merge-tree", "--write-tree", &left, &right],
    );
    assert_eq!(result.exit_code, 128);
    assert!(
        result
            .stderr
            .contains("Merges with conflicts are not supported")
    );
    assert_eq!(f.fs.read(&format!("{gitdir}/index")), index);
}
