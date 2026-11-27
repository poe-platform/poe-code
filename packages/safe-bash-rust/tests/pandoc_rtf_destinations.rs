use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn pandoc_rtf_excludes_hidden_destinations() {
    for (input, expected) in [
        (r"{\rtf1\ansi A{\*\unknown hidden {more}}B}", "AB\n"),
        (r"{\rtf1 A{\*\unknown hidden {\b more}\par}B}", "AB\n"),
        (r"{\rtf1 A{\annotation private note}B}", "AB\n"),
        (
            r#"{\rtf1 A{\field{\*\fldinst HYPERLINK "secret"}{\fldrslt visible}}B}"#,
            "AvisibleB\n",
        ),
        (r"{\rtf1 A{\fldinst secret}B}", "AB\n"),
        (r"{\rtf1 A{\*\unknown escaped \} still hidden}B}", "AB\n"),
        (r"{\rtf1 A{\*\unknown\bin3 }{}hidden}B}", "AB\n"),
        (r"{\rtf1 A{\b bold} {\i italic}B}", "Abold italicB\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | pandoc -f rtf -t plain"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {result:?}");
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}
