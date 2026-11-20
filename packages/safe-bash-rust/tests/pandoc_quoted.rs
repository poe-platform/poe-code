use mcp_protocol_rust::json;
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

const QUOTED: &str = r#"{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Quoted","c":[{"t":"DoubleQuote"},[{"t":"Str","c":"outer"},{"t":"Space"},{"t":"Quoted","c":[{"t":"SingleQuote"},[{"t":"Strong","c":[{"t":"Str","c":"inner"}]}]]},{"t":"Space"},{"t":"Str","c":"end"}]]}]}]}"#;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    let shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (shell, fs)
}

#[test]
fn quoted_json_round_trips_without_losing_its_kind_or_children() {
    let (mut shell, _) = shell();
    let output = shell
        .exec_with_options(
            "pandoc -f json -t json",
            ExecOptions {
                stdin: Some(QUOTED.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    let actual = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
    let expected = json::parse(QUOTED.as_bytes(), Default::default()).unwrap();
    assert_eq!(actual.get("blocks"), expected.get("blocks"));
}

#[test]
fn quoted_text_uses_the_selected_writers_quote_conventions() {
    let (mut shell, _) = shell();
    for (format, text) in [
        ("plain", "\"outer 'inner' end\""),
        ("markdown", "\"outer '**inner**' end\""),
        ("html", "“outer ‘<strong>inner</strong>’ end”"),
        ("rst", "“outer ‘**inner**’ end”"),
        ("latex", "``outer `\\textbf{inner}' end''"),
        (
            "rtf",
            "\\u8220 ?outer \\u8216 ?{\\b inner}\\u8217 ? end\\u8221 ?",
        ),
    ] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f json -t {format}"),
                ExecOptions {
                    stdin: Some(QUOTED.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{format}: {}", output.stderr);
        assert!(output.stdout.contains(text), "{format}: {}", output.stdout);
    }
    let output = shell
        .exec_with_options(
            "pandoc -f json -t html --ascii",
            ExecOptions {
                stdin: Some(QUOTED.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert!(
        output
            .stdout
            .contains("&#8220;outer &#8216;<strong>inner</strong>&#8217; end&#8221;"),
        "{}",
        output.stdout
    );
}

#[test]
fn invalid_quote_kinds_preserve_existing_output() {
    let (mut shell, fs) = shell();
    for replacement in [
        r#"{"t":"OtherQuote"}"#,
        r#"{"t":"DoubleQuote","c":[]}"#,
        r#""DoubleQuote""#,
        "{}",
        "null",
    ] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let source = QUOTED.replace(r#"{"t":"DoubleQuote"}"#, replacement);
        let output = shell
            .exec_with_options(
                "pandoc -f json -t json -o /saved",
                ExecOptions {
                    stdin: Some(source),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0, "accepted {replacement}");
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn quoted_headings_keep_their_child_text_in_identifiers() {
    let (mut shell, _) = shell();
    let output = shell
        .exec_with_options(
            "pandoc -f markdown -t html",
            ExecOptions {
                stdin: Some("# \"Hello 'world'\"".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert_eq!(
        output.stdout,
        "<h1 id=\"hello-world\">“Hello ‘world’”</h1>\n"
    );
}

#[test]
fn quoted_children_cannot_bypass_writer_or_raw_content_checks() {
    let (mut shell, fs) = shell();
    for (replacement, flags) in [
        (
            r#"{"t":"SmallCaps","c":[{"t":"Str","c":"caps"}]}"#,
            "-t markdown",
        ),
        (
            r#"{"t":"RawInline","c":["html","<b>raw</b>"]}"#,
            "-t html --raw-content=reject",
        ),
        (
            r#"{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"note"}]}]}"#,
            "-t markdown",
        ),
    ] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let source = QUOTED.replace(r#"{"t":"Str","c":"inner"}"#, replacement);
        let output = shell
            .exec_with_options(
                &format!("pandoc -f json {flags} -o /saved"),
                ExecOptions {
                    stdin: Some(source),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0, "accepted {replacement}");
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}
