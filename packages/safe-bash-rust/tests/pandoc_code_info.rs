use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn fenced_code_info_decodes_once_without_changing_the_code_body() {
    // Expected language tokens match the public JavaScript reader. CommonMark
    // and GFM also match Pandoc, apart from its escaped-entity double decoding.
    for (info, language) in [
        ("f&ouml;", "fö"),
        ("f&amp;ouml;", "f&ouml;"),
        (r"f\*oo", "f*oo"),
        ("&#x66;oo", "foo"),
        ("a&#32;b rest", "a"),
        (r"f\&ouml;", "f&ouml;"),
    ] {
        for from in ["commonmark", "gfm", "markdown"] {
            let mut shell = Shell::new(
                Arc::new(MemoryVfs::new()),
                ShellOptions {
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let code = "x &amp; \\*";
            let result = shell
                .exec_with_options(
                    &format!("pandoc -f {from} -t json"),
                    ExecOptions {
                        stdin: Some(format!("``` {info}\n{code}\n```\n")),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
            let expected = Value::Array(vec![Value::Object(vec![
                (
                    "t".encode_utf16().collect(),
                    Value::String("CodeBlock".encode_utf16().collect()),
                ),
                (
                    "c".encode_utf16().collect(),
                    Value::Array(vec![
                        Value::Array(vec![
                            Value::String(Vec::new()),
                            Value::Array(vec![Value::String(language.encode_utf16().collect())]),
                            Value::Array(Vec::new()),
                        ]),
                        Value::String(code.encode_utf16().collect()),
                    ]),
                ),
            ])]);
            assert_eq!(actual.get("blocks"), Some(&expected), "{from}: {info}");
        }
    }
}
