use git_rust::{MemoryFs, execute_git_cli, mkdirp};

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    mkdirp(|p| fs.mkdir(p), "/repo", 10).unwrap();
    for args in [vec!["init"], vec!["add", "."], vec!["commit", "-m", "base"]] {
        if args[0] == "add" {
            fs.write_str("/repo/a", "old trailing \nold\n");
            fs.write_str("/repo/b", "base\n");
        }
        assert_eq!(execute_git_cli(&fs, "/repo", &args).exit_code, 0);
    }
    fs
}

#[test]
fn check_reports_only_added_lines_and_native_diagnostics() {
    let fs = repo();
    fs.write_str("/repo/a", "old trailing \nold\nfoo \n \tbad\n<<<<<<< ours\n=======\n>>>>>>> theirs\n\n");
    let result = execute_git_cli(&fs, "/repo", &["diff", "--check"]);
    assert_eq!(result.exit_code, 2, "{}", result.stderr);
    assert_eq!(result.stdout, "a:3: trailing whitespace.\n+foo \na:4: space before tab in indent.\n+ \tbad\na:5: leftover conflict marker\na:6: leftover conflict marker\na:7: leftover conflict marker\na:8: new blank line at EOF.\n");
    assert!(result.stderr.is_empty());
}

#[test]
fn check_clean_cached_and_path_selection() {
    let fs = repo();
    fs.write_str("/repo/a", "clean change\n");
    assert_eq!(execute_git_cli(&fs, "/repo", &["diff", "--check"]).exit_code, 0);
    fs.write_str("/repo/b", "bad \n");
    assert_eq!(execute_git_cli(&fs, "/repo", &["diff", "--check", "--", "a"]).exit_code, 0);
    assert_eq!(execute_git_cli(&fs, "/repo", &["add", "b"]).exit_code, 0);
    fs.write_str("/repo/b", "fixed\n");
    let result = execute_git_cli(&fs, "/repo", &["diff", "--cached", "--check", "--", "b"]);
    assert_eq!(result.exit_code, 2);
    assert_eq!(result.stdout, "b:1: trailing whitespace.\n+bad \n");
    assert_eq!(execute_git_cli(&fs, "/repo", &["diff", "--check"]).exit_code, 0);
}

#[test]
fn check_option_combinations_match_git() {
    let fs = repo();
    fs.write_str("/repo/a", "bad \n");
    for mode in ["--name-only", "--name-status"] {
        for args in [vec!["diff", "--check", mode], vec!["diff", mode, "--check"]] {
            let result = execute_git_cli(&fs, "/repo", &args);
            assert_eq!(result.exit_code, 128);
        }
    }
    for mode in ["--stat", "--numstat"] {
        let result = execute_git_cli(&fs, "/repo", &["diff", mode, "--check"]);
        assert_eq!(result.exit_code, 2);
        assert_eq!(result.stdout, "a:1: trailing whitespace.\n+bad \n");
    }
    assert_eq!(execute_git_cli(&fs, "/repo", &["diff", "--check", "--exit-code"]).exit_code, 3);
    let quiet = execute_git_cli(&fs, "/repo", &["diff", "--check", "--quiet"]);
    assert_eq!(quiet.exit_code, 1);
    assert!(quiet.stdout.is_empty());
}

#[test]
fn check_handles_binary_deletions_reverse_and_missing_final_newline() {
    let fs = repo();
    fs.write_str("/repo/a", "binary\0 \n");
    assert_eq!(execute_git_cli(&fs, "/repo", &["diff", "--check"]).exit_code, 0);
    fs.rm("/repo/a").unwrap();
    assert_eq!(execute_git_cli(&fs, "/repo", &["diff", "--check"]).exit_code, 0);
    fs.write_str("/repo/a", "bad ");
    let result = execute_git_cli(&fs, "/repo", &["diff", "--check"]);
    assert_eq!(result.stdout, "a:1: trailing whitespace.\n+bad \n");
    assert_eq!(result.exit_code, 2);
    let reverse = execute_git_cli(&fs, "/repo", &["diff", "--check", "-R"]);
    assert_eq!(reverse.stdout, "a:1: trailing whitespace.\n+old trailing \n");
}

#[test]
fn check_unborn_index_and_combined_errors() {
    let fs = MemoryFs::new();
    mkdirp(|p| fs.mkdir(p), "/repo", 10).unwrap();
    assert_eq!(execute_git_cli(&fs, "/repo", &["init"]).exit_code, 0);
    fs.write_str("/repo/new", " \tbad \n<<<<<<<x\n||||||| base\n========\n");
    assert_eq!(execute_git_cli(&fs, "/repo", &["add", "."]).exit_code, 0);
    let result = execute_git_cli(&fs, "/repo", &["diff", "--staged", "--check"]);
    assert_eq!(result.exit_code, 2);
    assert_eq!(result.stdout, "new:1: trailing whitespace, space before tab in indent.\n+ \tbad \nnew:3: leftover conflict marker\n");
}
