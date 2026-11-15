use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn table_rejections_preserve_diagnostics_and_empty_output() {
    for captured in [false, true] {
        for (command, stderr) in [
            (
                "join --nochi /left /right",
                "join: EINVAL: unsupported option --nochi\n",
            ),
            (
                "join --he /left /right",
                "join: EINVAL: unsupported option --he\n",
            ),
            (
                "comm directory right",
                "comm: EISDIR: illegal operation on a directory '/directory'\n",
            ),
        ] {
            let fs = MemoryVfs::new();
            fs.write_file("/left", b"a\n").unwrap();
            fs.write_file("/right", b"a\n").unwrap();
            fs.mkdir_all("/directory").unwrap();
            let mut shell = Shell::new(
                Arc::new(fs),
                ShellOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([("LC_ALL".into(), "C".into())]),
                    mode: BackendMode::NativeOnly,
                },
            );
            let script = if captured {
                format!("value=$({command}); status=$?; printf '%s' \"$value\"; exit \"$status\"")
            } else {
                command.into()
            };
            let result = shell.exec(&script).unwrap();
            assert_eq!(result.exit_code, 1, "{script}: {}", result.stderr);
            assert_eq!(result.stdout, "", "{script}");
            assert_eq!(result.stderr, stderr, "{script}");
        }
    }
}
