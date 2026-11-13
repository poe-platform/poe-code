use git_rust::cli::execute_git_cli;
use git_rust::commands::plumbing::{find_merge_base, read_commit, write_commit};
use git_rust::fixtures::make_fixture;

#[test]
fn merge_base_compares_first_commit_with_combined_remaining_histories() {
    let f = make_fixture("test-checkout");
    let head = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout;
    let template = read_commit(&f.fs, &f.gitdir, head.trim()).unwrap().commit;
    let make_commit = |message: &str, parents: &[&str]| {
        let mut commit = template.clone();
        commit.message = message.into();
        commit.parent = parents.iter().map(|p| (*p).into()).collect();
        write_commit(&f.fs, &f.gitdir, &commit).unwrap()
    };
    let root = make_commit("root", &[]);
    let x = make_commit("x", &[&root]);
    let y = make_commit("y", &[&root]);
    let merged = make_commit("merged", &[&x, &y]);
    let unrelated = make_commit("unrelated", &[]);
    for (commits, mut expected) in [
        (vec![&x, &root], vec![root.clone()]),
        (vec![&x, &root, &x], vec![x.clone()]),
        (vec![&x, &x, &root], vec![x.clone()]),
        (vec![&x, &root, &root, &x], vec![x.clone()]),
        (vec![&x, &unrelated, &root], vec![root.clone()]),
        (vec![&x, &unrelated, &unrelated], vec![]),
        (vec![&merged, &root, &x, &y], vec![x.clone(), y.clone()]),
    ] {
        let mut args = vec!["merge-base", "--all"];
        args.extend(commits.iter().map(|oid| oid.as_str()));
        let result = execute_git_cli(&f.fs, &f.dir, &args);
        assert_eq!(
            result.exit_code,
            i32::from(expected.is_empty()),
            "{args:?}: {}",
            result.stderr
        );
        let mut actual: Vec<_> = result.stdout.lines().map(String::from).collect();
        actual.sort();
        expected.sort();
        assert_eq!(actual, expected, "{args:?}");
        if expected.len() <= 1 {
            args.remove(1);
            let default_result = execute_git_cli(&f.fs, &f.dir, &args);
            assert_eq!(default_result.exit_code, result.exit_code);
            assert_eq!(default_result.stdout, result.stdout);
        }
        let oids: Vec<_> = commits.into_iter().cloned().collect();
        let mut bases = find_merge_base(&f.fs, &f.gitdir, &oids).unwrap();
        bases.sort();
        assert_eq!(bases, expected);
    }
}

#[test]
fn merge_base_rejects_invalid_later_commit() {
    let f = make_fixture("test-checkout");
    let result = execute_git_cli(&f.fs, &f.dir, &["merge-base", "HEAD", "HEAD", "missing"]);
    assert_eq!(result.exit_code, 128);
    assert_eq!(result.stderr, "fatal: Not a valid commit name missing\n");
}
