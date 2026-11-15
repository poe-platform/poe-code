use safe_bash_rust::{BackendMode, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn append_declarations_preserve_the_expanded_argument() {
    for builtin in ["declare", "typeset", "export"] {
        for suffix in ["bar", "bar baz"] {
            for body in [
                format!("x=foo; {builtin} x+=\"$suffix\""),
                format!("for i in 1 2; do x=foo; {builtin} x+=\"$suffix\"; done"),
                format!("for ((i=0;i<2;i++)); do x=foo; {builtin} x+=\"$suffix\"; done"),
            ] {
                let mut shell = Shell::new(
                    Arc::new(MemoryVfs::new()),
                    ShellOptions {
                        mode: BackendMode::NativeOnly,
                        ..ShellOptions::default()
                    },
                );
                let source =
                    format!("suffix='{suffix}'; {body}; printf '[%s][%s]\\n' \"$x\" \"$_\"");
                let result = shell.exec(&source).unwrap();
                assert_eq!(result.exit_code, 0, "{source}");
                assert_eq!(result.stderr, "", "{source}");
                assert_eq!(
                    result.stdout,
                    format!("[foo{suffix}][x+={suffix}]\n"),
                    "{source}"
                );
            }
        }
    }
}
