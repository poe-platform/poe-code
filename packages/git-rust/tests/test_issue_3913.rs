use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Tester"]);
    ok(&fs, &["config", "user.email", "t@example.com"]);
    for message in ["first", "second"] {
        fs.write_str("/repo/a.txt", &format!("{message}\n"));
        ok(&fs, &["add", "."]);
        ok(&fs, &["commit", "-m", message]);
    }
    fs
}

#[test]
fn custom_formats_keep_patch_stat_separator() {
    let fs = repo();
    let stat = ok(&fs, &["diff", "--stat", "HEAD^", "HEAD"]);
    let patch = ok(&fs, &["diff", "HEAD^", "HEAD"]);
    for command in ["show", "log"] {
        for format in [
            "--format=%s",
            "--format=format:%s",
            "--pretty=format:%s",
            "--format=tformat:%s",
        ] {
            for modes in [["-p", "--stat"], ["--stat", "-p"]] {
                assert_eq!(
                    ok(&fs, &[command, "-1", format, modes[0], modes[1]]),
                    format!("second\n---\n{stat}\n{patch}")
                );
            }
        }
    }
}

#[test]
fn body_starts_after_subject_paragraph_and_all_separator_lines() {
    let fs = repo();
    let tree = ok(&fs, &["rev-parse", "HEAD^{tree}"]).trim().to_string();
    for message in [
        "\n\nSubject\n\nBody\n",
        "Subject\n\n\nBody\n",
        "\nSubject\ncontinued\n\n\nBody\n\nNext\n",
        "Subject\n\n\n",
    ] {
        let oid = git_rust::write_object(
            &fs,
            "/repo/.git",
            "commit",
            Some("commit"),
            Some(
                format!(
                    "tree {tree}\nauthor A <a@b> 0 +0000\ncommitter A <a@b> 0 +0000\n\n{message}"
                )
                .as_bytes(),
            ),
            None,
            None,
            None,
            false,
        )
        .unwrap();
        let expected = if message.contains("Next") {
            "Subject continued|Body\n\nNext\n|\n"
        } else if message.contains("Body") {
            "Subject|Body\n|\n"
        } else {
            "Subject||\n"
        };
        for command in ["show", "log"] {
            assert_eq!(ok(&fs, &[command, "-s", "--format=%s|%b|", &oid]), expected);
        }
    }
}

#[test]
fn clean_merge_show_has_no_single_parent_diff() {
    let fs = repo();
    ok(&fs, &["checkout", "-b", "side", "HEAD^"]);
    fs.write_str("/repo/side.txt", "side\n");
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "side"]);
    ok(&fs, &["checkout", "main"]);
    ok(&fs, &["merge", "side"]);
    for modes in [
        vec![],
        vec!["-p"],
        vec!["--stat"],
        vec!["-p", "--stat"],
        vec!["--name-only"],
    ] {
        let mut args = vec!["show", "--format=format:merged"];
        args.extend(modes);
        let expected = if args.contains(&"--stat") {
            format!("merged\n{}", ok(&fs, &["diff", "--stat", "HEAD^", "HEAD"]))
        } else {
            "merged".to_string()
        };
        assert_eq!(ok(&fs, &args), expected);
    }
    assert!(ok(&fs, &["show", "HEAD^", "--format=%s"]).contains("diff --git"));
}
