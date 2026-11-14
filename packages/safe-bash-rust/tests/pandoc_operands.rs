use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell(a: &str, b: &str) -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.write_file("/a.md", a.as_bytes()).unwrap();
    fs.write_file("/b.md", b.as_bytes()).unwrap();
    let sh = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (sh, fs)
}

#[test]
fn markdown_operands_preserve_paragraph_boundaries() {
    for flag in ["", "--file-scope"] {
        for (a, b, expected) in [
            ("a", "b", "a\n\nb\n"),
            ("a\n", "b\n", "a\n\nb\n"),
            ("a\r\n", "b\r\n", "a\n\nb\n"),
            ("", "b", "b\n"),
            ("a", "", "a\n"),
            ("# A", "# B", "A\n\nB\n"),
        ] {
            let (mut sh, _) = shell(a, b);
            let result = sh
                .exec(&format!("pandoc -f markdown -t plain /a.md /b.md {flag}"))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(result.stdout, expected, "{a:?} {b:?} {flag}");
        }
    }
}

#[test]
fn file_scope_parses_independent_lists() {
    for (flag, count) in [("", 1), ("--file-scope", 2)] {
        let (mut sh, _) = shell("- a", "- b");
        let result = sh
            .exec(&format!("pandoc -f markdown -t json /a.md /b.md {flag}"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(
            result.stdout.matches("BulletList").count(),
            count,
            "{}",
            result.stdout
        );
    }
}

#[test]
fn stdin_order_and_failed_reads_preserve_destination() {
    for flag in ["", "--file-scope"] {
        for (operands, expected) in [
            ("/a.md - /b.md", "a\n\ns\n\nb\n"),
            ("- /a.md", "s\n\na\n"),
            ("/a.md", "a\n"),
        ] {
            let (mut sh, _) = shell("a", "b");
            let result = sh
                .exec_with_options(
                    &format!("pandoc -f markdown -t plain {operands} {flag}"),
                    ExecOptions {
                        stdin: Some("s".into()),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(result.stdout, expected);
        }
        let (mut sh, fs) = shell("a", "b");
        fs.write_file("/out.txt", b"KEEP").unwrap();
        let result = sh
            .exec(&format!(
                "pandoc -f markdown -t plain /a.md /missing.md -o /out.txt {flag}"
            ))
            .unwrap();
        assert_ne!(result.exit_code, 0);
        assert_eq!(fs.read_file("/out.txt").unwrap(), b"KEEP");
    }
}
