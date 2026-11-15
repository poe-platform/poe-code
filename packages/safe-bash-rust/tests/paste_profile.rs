use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn paste_unicode_and_empty_stream_profile() {
    for separator in ["\n", "\0"] {
        for locale in ["C", "POSIX", "C.UTF-8"] {
            let fs = MemoryVfs::new();
            fs.write_file(
                "/rows",
                format!("a{separator}b{separator}c{separator}").as_bytes(),
            )
            .unwrap();
            fs.write_file("/empty", b"").unwrap();
            let mut shell = Shell::new(
                Arc::new(fs.clone()),
                ShellOptions {
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let zero = if separator == "\0" { "-z" } else { "" };
            for (args, expected) in [
                ("-sd 'é😀' /rows", format!("aéb😀c{separator}")),
                (
                    "-d 'é😀' /rows /rows /rows",
                    format!("aéa😀a{separator}béb😀b{separator}céc😀c{separator}"),
                ),
                ("-s /empty", String::new()),
                ("-s - -", String::new()),
                (
                    "-s /rows /empty /rows",
                    format!("a\tb\tc{separator}a\tb\tc{separator}"),
                ),
            ] {
                let command = format!("LC_ALL={locale} paste {zero} {args} > /result");
                let result = shell.exec(&command).unwrap();
                assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
                assert_eq!(result.stderr, "", "{command}");
                assert_eq!(
                    fs.read_file("/result").unwrap(),
                    expected.as_bytes(),
                    "{command}"
                );
            }
            let result = shell
                .exec(&format!(
                    "cat /rows | LC_ALL={locale} paste {zero} -sd 'é😀' - - > /result"
                ))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(
                fs.read_file("/result").unwrap(),
                format!("aéb😀c{separator}").as_bytes()
            );
        }
    }
}
