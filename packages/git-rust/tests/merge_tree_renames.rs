use git_rust::cli::execute_git_cli;
use git_rust::commands::plumbing::{read_commit, write_blob, write_commit, write_tree};
use git_rust::fixtures::make_fixture;
use git_rust::models::TreeEntry;

#[test]
fn merge_tree_tracks_exact_renames() {
    let f = make_fixture("test-checkout");
    let head = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout;
    let template = read_commit(&f.fs, &f.gitdir, head.trim()).unwrap().commit;
    let make_commit = |files: &[(&str, &str)], parents: &[&str]| {
        let entries: Vec<_> = files
            .iter()
            .map(|(path, content)| TreeEntry {
                mode: "100644".into(),
                path: (*path).into(),
                oid: write_blob(&f.fs, &f.gitdir, content.as_bytes()).unwrap(),
                entry_type: "blob".into(),
            })
            .collect();
        let mut commit = template.clone();
        commit.tree = write_tree(&f.fs, &f.gitdir, &entries).unwrap();
        commit.parent = parents.iter().map(|p| (*p).into()).collect();
        write_commit(&f.fs, &f.gitdir, &commit).unwrap()
    };
    let base = make_commit(&[("keep", "keep\n"), ("old", "original\n")], &[]);
    let left = make_commit(&[("keep", "keep\n"), ("new", "original\n")], &[&base]);
    let index = f.fs.read(&format!("{}/index", f.gitdir));
    for (name, files, exit_code, paths, content) in [
        (
            "edit",
            vec![("keep", "keep\n"), ("old", "edited\n")],
            0,
            "keep\nnew\n",
            "edited\n",
        ),
        (
            "delete",
            vec![("keep", "keep\n")],
            1,
            "keep\nnew\n",
            "original\n",
        ),
        (
            "different rename",
            vec![("keep", "keep\n"), ("other", "original\n")],
            1,
            "keep\nnew\nother\n",
            "original\n",
        ),
        (
            "same rename",
            vec![("keep", "keep\n"), ("new", "original\n")],
            0,
            "keep\nnew\n",
            "original\n",
        ),
    ] {
        let right = make_commit(&files, &[&base]);
        for (ours, theirs) in [(&left, &right), (&right, &left)] {
            let result =
                execute_git_cli(&f.fs, &f.dir, &["merge-tree", "--write-tree", ours, theirs]);
            assert_eq!(
                result.exit_code, exit_code,
                "{name}: {} {}",
                result.stdout, result.stderr
            );
            let tree = result.stdout.lines().next().unwrap();
            let listing = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "--name-only", tree]);
            assert_eq!(listing.stdout, paths, "{name}");
            let blob = execute_git_cli(&f.fs, &f.dir, &["show", &format!("{tree}:new")]);
            assert_eq!(blob.exit_code, 0, "{}", blob.stderr);
            assert_eq!(blob.stdout, content, "{name}");
            assert_eq!(f.fs.read(&format!("{}/index", f.gitdir)), index);
        }
    }
}
