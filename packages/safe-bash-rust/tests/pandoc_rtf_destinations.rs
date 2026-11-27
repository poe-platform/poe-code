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

fn convert(input: &str, target: &str) -> safe_bash_rust::ExecOutput {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
        },
    );
    shell
        .exec_with_options(
            &format!("printf %s '{input}' | pandoc -f rtf -t {target}"),
            ExecOptions::default(),
        )
        .unwrap()
}

#[test]
fn ignorable_destinations_do_not_publish_nested_text() {
    for input in [
        r"{\rtf1\ansi A{\*\unknown hidden {more}}B}",
        r"{\rtf1\ansi A{\*\unknown hidden {\b more}\par secret}B}",
        r"{\rtf1\ansi A{\*\unknown hidden \} still hidden}B}",
        r"{\rtf1\ansi A{\*\unknown \bin3 }{}hidden}B}",
    ] {
        let result = convert(input, "plain");
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, "AB\n", "{input}");
    }
}

#[test]
fn annotations_and_field_instructions_are_not_body_text() {
    for input in [
        r"{\rtf1\ansi A{\*\annotation private comment}B}",
        r#"{\rtf1\ansi A{\field{\*\fldinst HYPERLINK "https://example.com/private"}{\fldrslt B}}}"#,
        r#"{\rtf1\ansi A{\field{\fldinst HYPERLINK "https://example.com/private"}{\fldrslt B}}}"#,
    ] {
        let result = convert(input, "plain");
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, "AB\n", "{input}");
    }
}

#[test]
fn skipping_destinations_preserves_visible_formatting_and_sibling_groups() {
    let result = convert(
        r"{\rtf1\ansi {\b Bold{\*\unknown hidden}}{\i italic}{\unknown visible}\par End}",
        "html",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout,
        "<p><strong>Bold</strong><em>italic</em>visible</p>\n<p>End</p>\n"
    );
}

#[test]
fn malformed_destinations_fail_without_publishing_text() {
    for input in [
        r"{\rtf1\ansi A{\*\unknown hidden}",
        r"{\rtf1\ansi A{\*\unknown \bin100 hidden}B}",
    ] {
        let result = convert(input, "plain");
        assert_ne!(result.exit_code, 0, "{input}");
        assert!(!result.stderr.is_empty(), "{input}");
        assert_eq!(result.stdout, "", "{input}");
    }
}
