use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
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
fn part(bytes: &[u8], name: &str) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|p| p.name == name)
            .unwrap()
            .content,
    )
    .unwrap()
}
fn levels(value: &Value, result: &mut Vec<f64>) {
    if value.get("t") == Some(&Value::String("Header".encode_utf16().collect())) {
        let Some(Value::Array(c)) = value.get("c") else {
            panic!("header content")
        };
        let Value::Number(level) = c[0] else {
            panic!("header level")
        };
        result.push(level);
    }
    match value {
        Value::Array(values) => {
            for v in values {
                levels(v, result);
            }
        }
        Value::Object(values) => {
            for (_, v) in values {
                levels(v, result);
            }
        }
        _ => {}
    }
}
const MARKDOWN: &str = "# TOP\n\n> # QUOTE\n\n- # LIST\n\nText[^n].\n\n[^n]: # NOTE\n";
const JSON: &str = r#"{"meta":{},"blocks":[
{"t":"Header","c":[1,["top",[],[]],[{"t":"Str","c":"TOP"}]]},
{"t":"Div","c":[["wrapper",[],[]],[{"t":"BlockQuote","c":[{"t":"Header","c":[1,["quote",[],[]],[{"t":"Str","c":"QUOTE"}]]}]}]]},
{"t":"BulletList","c":[[{"t":"Header","c":[1,["list",[],[]],[{"t":"Str","c":"LIST"}]]}]]},
{"t":"Para","c":[{"t":"Str","c":"Text"},{"t":"Note","c":[{"t":"Header","c":[1,["note",[],[]],[{"t":"Str","c":"NOTE"}]]}]}]}
]}"#;

#[test]
fn markdown_shifts_reach_nested_headings_and_demote_below_one() {
    for shift in [-6, -1, 1, 6] {
        let (mut sh, _) = shell();
        let output = sh
            .exec_with_options(
                &format!("pandoc -f markdown -t json --shift-heading-level-by={shift}"),
                ExecOptions {
                    stdin: Some(MARKDOWN.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        let ast = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
        let mut actual = Vec::new();
        levels(&ast, &mut actual);
        assert_eq!(
            actual,
            if shift < 0 {
                vec![]
            } else {
                vec![(1 + shift).min(6) as f64; 4]
            }
        );
        for marker in ["TOP", "QUOTE", "LIST", "NOTE"] {
            assert!(output.stdout.contains(marker));
        }
    }
}

#[test]
fn word_shifts_preserve_nested_content_and_real_notes_for_both_native_readers() {
    for (from, source) in [("markdown", MARKDOWN), ("json", JSON)] {
        for shift in [-1, 1, 6] {
            let (mut sh, fs) = shell();
            let output = sh
                .exec_with_options(
                    &format!("pandoc -f {from} -t docx --shift-heading-level-by={shift} -o /out"),
                    ExecOptions {
                        stdin: Some(source.into()),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(output.exit_code, 0, "{from}: {}", output.stderr);
            let bytes = fs.read_file("/out").unwrap();
            let body = part(&bytes, "word/document.xml");
            let notes = part(&bytes, "word/footnotes.xml");
            for marker in ["TOP", "QUOTE", "LIST"] {
                assert!(body.contains(marker));
            }
            assert!(notes.contains("NOTE"));
            if shift < 0 {
                assert!(!body.contains("w:val=\"Heading"));
                assert!(!notes.contains("w:val=\"Heading"));
            } else {
                let style = format!("w:val=\"Heading{}\"", (1 + shift).min(6));
                assert_eq!(body.matches(&style).count(), 3, "{from}: {shift}");
                assert_eq!(notes.matches(&style).count(), 1, "{from}: {shift}");
            }
        }
    }
}

#[test]
fn invalid_heading_shift_options_fail_without_touching_outputs() {
    for shift in ["-7", "7", "1.5", "wat", "2147483647", "-2147483648"] {
        for separator in ["=", " "] {
            let (mut sh, fs) = shell();
            fs.write_file("/saved", b"KEEP").unwrap();
            let output = sh.exec_with_options(&format!("pandoc -f markdown -t docx --shift-heading-level-by{separator}{shift} -o /saved"),
                ExecOptions { stdin: Some("# Title".into()), ..Default::default() }).unwrap();
            assert_ne!(output.exit_code, 0, "accepted {shift}");
            assert!(output.stderr.contains("E_OPTION"), "{}", output.stderr);
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        }
    }
}

#[test]
fn demotion_cannot_hide_malformed_nested_headers() {
    for replacement in [
        r#"[0,["quote",[],[]]"#,
        r#"[1.5,["quote",[],[]]"#,
        r#"[1,["quote",[1],[]]"#,
        r#"[1,["quote",[],[["key"]]]"#,
    ] {
        let source = JSON.replace(r#"[1,["quote",[],[]]"#, replacement);
        assert_ne!(source, JSON);
        for format in ["docx", "pdf"] {
            let (mut sh, fs) = shell();
            fs.write_file("/saved", b"KEEP").unwrap();
            let output = sh
                .exec_with_options(
                    &format!("pandoc -f json -t {format} --shift-heading-level-by=-1 -o /saved"),
                    ExecOptions {
                        stdin: Some(source.clone()),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_ne!(output.exit_code, 0);
            assert!(output.stderr.contains("E_AST"), "{}", output.stderr);
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        }
    }
}
