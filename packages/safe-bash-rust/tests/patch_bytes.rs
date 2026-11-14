use safe_bash_rust::{BackendMode, MemoryVfs, MemoryVfsLimits, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/work").unwrap();
    let shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/work".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (shell, fs)
}

const REPLACEMENT: &[u8] = b"--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";

#[test]
fn ascii_hunks_preserve_every_untouched_byte() {
    for command in [
        "patch -f -i input.patch target",
        "cat input.patch | patch -f target",
    ] {
        let (mut sh, fs) = shell();
        let tail: Vec<u8> = (0..=255).chain("\u{e080}\u{e0ff} 🦀".bytes()).collect();
        fs.write_file("/work/target", &[b"old\n".as_slice(), &tail].concat())
            .unwrap();
        fs.write_file("/work/input.patch", REPLACEMENT).unwrap();
        let result = sh.exec(command).unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(
            fs.read_file("/work/target").unwrap(),
            [b"new\n".as_slice(), &tail].concat()
        );
    }
}

#[test]
fn all_patch_formats_preserve_hunk_bytes_reverse_and_rejects() {
    for patch in [
        b"--- target\n+++ target\n@@ -1 +1 @@\n-old\n+\0\xff\x80\xc0\n".as_slice(),
        b"1c1\n< old\n---\n> \0\xff\x80\xc0\n",
        b"*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! \0\xff\x80\xc0\n",
    ] {
        for (option, input, expected, status) in [
            ("", b"old\n".as_slice(), b"\0\xff\x80\xc0\n".as_slice(), 0),
            ("-R", b"\0\xff\x80\xc0\n", b"old\n", 0),
            ("", b"other\n", b"other\n", 1),
        ] {
            let (mut sh, fs) = shell();
            fs.write_file("/work/target", input).unwrap();
            fs.write_file("/work/input.patch", patch).unwrap();
            let result = sh.exec(&format!("patch -f {option} -i input.patch target")).unwrap();
            assert_eq!(result.exit_code, status, "{}", result.stderr);
            assert_eq!(fs.read_file("/work/target").unwrap(), expected);
            if status == 1 {
                assert!(fs.read_file("/work/target.rej").unwrap().windows(5).any(|w| w == b"\0\xff\x80\xc0\n"));
            }
        }
    }
}

#[test]
fn patch_output_backup_and_reject_keep_raw_bytes() {
    for option in ["-b", "--atomic", "-o output", "-o - > output"] {
        let (mut sh, fs) = shell();
        fs.write_file("/work/target", b"old\n\0\xff\n").unwrap();
        fs.write_file("/work/output", b"previous\0\xff").unwrap();
        fs.write_file("/work/input.patch", REPLACEMENT).unwrap();
        let result = sh
            .exec(&format!("patch -f -i input.patch target {option}"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{option}: {}", result.stderr);
        assert_eq!(
            fs.read_file(if option.starts_with("-o") {
                "/work/output"
            } else {
                "/work/target"
            })
            .unwrap(),
            b"new\n\0\xff\n"
        );
        if option == "-b" {
            assert_eq!(fs.read_file("/work/target.orig").unwrap(), b"old\n\0\xff\n");
        }
        if option.starts_with("-o") {
            assert_eq!(fs.read_file("/work/target").unwrap(), b"old\n\0\xff\n");
        }
    }
}

#[test]
fn raw_filename_bytes_are_rejected_without_replacing_targets() {
    for name in [
        b"bad\0name".as_slice(),
        b"bad\xff",
        b"\"bad\\377\"",
        b"\"bad\\000name\"",
    ] {
        let (mut sh, fs) = shell();
        let patch = [
            b"--- ".as_slice(),
            name,
            b"\n+++ target\n@@ -1 +1 @@\n-old\n+new\n",
        ]
        .concat();
        fs.write_file("/work/target", b"old\n").unwrap();
        fs.write_file("/work/input.patch", &patch).unwrap();
        let result = sh.exec("patch -f -i input.patch target").unwrap();
        assert_eq!(result.exit_code, 2, "{name:?}: {}", result.stderr);
        assert_eq!(fs.read_file("/work/target").unwrap(), b"old\n");
    }
}

#[test]
fn literal_private_unicode_is_distinct_from_raw_bytes_in_paths_and_content() {
    let (mut sh, fs) = shell();
    let name = "\u{e080}🦀";
    fs.write_file(&format!("/work/{name}"), "\u{e080}\n".as_bytes())
        .unwrap();
    let patch = format!("--- {name}\n+++ {name}\n@@ -1 +1 @@\n-\u{e080}\n+\u{e0ff}\n");
    fs.write_file("/work/input.patch", patch.as_bytes())
        .unwrap();
    let result = sh.exec("patch -f -i input.patch").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        fs.read_file(&format!("/work/{name}")).unwrap(),
        "\u{e0ff}\n".as_bytes()
    );
}

#[test]
fn binary_hunks_preserve_carriage_returns_and_missing_final_newlines() {
    for (option, input, patch, expected) in [
        ("--binary", b"old\r\n".as_slice(), b"--- target\r\n+++ target\r\n@@ -1 +1 @@\r\n-old\r\n+\0\xff\r\n".as_slice(), b"\0\xff\r\n".as_slice()),
        ("", b"old", b"--- target\n+++ target\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+\0\xff\n\\ No newline at end of file\n", b"\0\xff"),
    ] {
        let (mut sh, fs) = shell();
        fs.write_file("/work/target", input).unwrap();
        fs.write_file("/work/input.patch", patch).unwrap();
        let result = sh.exec(&format!("patch -f {option} -i input.patch target")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.read_file("/work/target").unwrap(), expected);
    }
}

#[test]
fn malformed_input_and_failed_publication_preserve_binary_target() {
    let (mut sh, fs) = shell();
    fs.write_file("/work/target", b"old\n\0\xff\n").unwrap();
    fs.write_file("/work/input.patch", b"").unwrap();
    assert_eq!(
        sh.exec("patch -f -i input.patch target").unwrap().exit_code,
        0
    );
    for patch in [b"\0\xff".as_slice(), b"1c1\n< old\n---\n"] {
        fs.write_file("/work/input.patch", patch).unwrap();
        assert_eq!(
            sh.exec("patch -f -i input.patch target").unwrap().exit_code,
            2
        );
        assert_eq!(fs.read_file("/work/target").unwrap(), b"old\n\0\xff\n");
    }
    let fs = MemoryVfs::with_limits(MemoryVfsLimits {
        max_file_bytes: 8,
        ..Default::default()
    });
    fs.write_file("/target", b"old\n\0\xff\n").unwrap();
    let mut sh = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = sh.exec("patch -f target <<'PATCH'\n--- target\n+++ target\n@@ -1 +1 @@\n-old\n+too-long\nPATCH").unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(fs.read_file("/target").unwrap(), b"old\n\0\xff\n");
}
