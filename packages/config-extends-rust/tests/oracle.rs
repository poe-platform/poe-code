//! Dev-only SDK comparison uses stdin/stdout; fixtures never touch the filesystem.
use config_extends_rust::{Layer, merge_layers};
use config_mutations_rust::value::Value;
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn s(text: &str) -> Value {
    Value::String(u(text))
}
fn o(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
#[test]
fn owned_merge_matches_current_sdk_for_generated_priority_null_array_and_provenance_cases() {
    let mut cases = vec![];
    let mut expected = vec![];
    for seed in 0..64 {
        let first = o(vec![
            (
                "title",
                if seed & 1 == 0 {
                    Value::Null
                } else {
                    s("highest")
                },
            ),
            ("prompt", if seed & 2 == 0 { s("") } else { s("prompt") }),
            ("nested", o(vec![("x", Value::Number(f64::from(seed)))])),
            (
                "array",
                Value::Array(vec![Value::Null, o(vec![("prompt", s(""))])]),
            ),
            ("literal.dot", s("dot")),
            ("literal\\slash", s("slash")),
        ]);
        let second = o(vec![
            ("title", s("lower")),
            ("prompt", s("inherited")),
            (
                "nested",
                o(vec![("x", Value::Number(-1.0)), ("y", Value::Bool(true))]),
            ),
            ("array", Value::Array(vec![s("ignored")])),
        ]);
        let layers = [
            Layer {
                source: u("first"),
                data: first.clone(),
            },
            Layer {
                source: u("second"),
                data: second.clone(),
            },
        ];
        let result = merge_layers(&layers).unwrap();
        expected.push(o(vec![
            ("data", result.data),
            (
                "sources",
                Value::Object(
                    result
                        .sources
                        .into_iter()
                        .map(|(key, source)| (key, Value::String(source)))
                        .collect(),
                ),
            ),
        ]));
        cases.push(Value::Array(vec![
            o(vec![("source", s("first")), ("data", first)]),
            o(vec![("source", s("second")), ("data", second)]),
        ]));
    }
    let input = mcp_protocol_rust::json::stringify(&json(&Value::Array(cases)));
    let script = "import {mergeLayers} from '../config-extends/dist/merge.js';let input='';for await(const chunk of process.stdin)input+=chunk;console.log(JSON.stringify(JSON.parse(input).map(mergeLayers)));";
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Dev Node SDK oracle");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let actual = mcp_protocol_rust::json::parse_utf16(
        &String::from_utf8(result.stdout)
            .unwrap()
            .encode_utf16()
            .collect::<Vec<_>>(),
        mcp_protocol_rust::json::Limits::default(),
    )
    .unwrap();
    assert_eq!(actual, json(&Value::Array(expected)));
}
fn json(value: &Value) -> mcp_protocol_rust::json::Value {
    use mcp_protocol_rust::json::Value as J;
    match value {
        Value::Null => J::Null,
        Value::Bool(value) => J::Bool(*value),
        Value::Number(value) => J::Number(*value),
        Value::String(value) => J::String(value.clone()),
        Value::Array(items) => J::Array(items.iter().map(json).collect()),
        Value::Object(fields) => J::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), json(value)))
                .collect(),
        ),
        _ => panic!("Oracle fixtures contain JSON values only"),
    }
}

#[test]
fn document_admission_matches_sdk_formats_bom_extends_and_markdown_prompts() {
    use config_extends_rust::document::{Extends, Format, parse_document};
    let mut cases = vec![];
    let mut expected = vec![];
    for extension in [".md", ".yaml", ".yml", ".json", ".txt", ""] {
        for source in [
            "{\"title\":\"Hello\",\"extends\":true}",
            "title: Hello\nextends: './base.md'",
            "---\nprompt: metadata\ntitle: next\n---\nBody",
            "---\rtitle: Hello\r---\rBody",
            "# comment only\n",
            "null",
            "---\n# horizontal rule",
            "hello",
            "[1]",
            "extends: 42",
            "extends: /absolute",
            "extends: ''",
        ] {
            for bom in ["", "\u{feff}"] {
                let source = format!("{bom}{source}");
                let file = format!("/tmp/config{extension}");
                cases.push(Value::Array(vec![s(&source), s(&file)]));
                let result = match parse_document(
                    &u(&source),
                    &u(extension),
                    &u(&file),
                    &mut |path| path.first() == Some(&47),
                    None,
                ) {
                    Ok(parsed) => o(vec![
                        ("data", parsed.yaml.value),
                        (
                            "format",
                            s(match parsed.format {
                                Format::Markdown => "markdown",
                                Format::Yaml => "yaml",
                                Format::Json => "json",
                            }),
                        ),
                        (
                            "extends",
                            match parsed.extends {
                                Extends::Disabled => Value::Bool(false),
                                Extends::Enabled => Value::Bool(true),
                                Extends::Path(path) => Value::String(path),
                            },
                        ),
                        ("hasExtendsField", Value::Bool(parsed.has_extends)),
                    ]),
                    Err(_) => s("error"),
                };
                expected.push(result);
            }
        }
    }
    let script = "import {parseDocument} from '../config-extends/dist/parse.js';let input='';for await(const chunk of process.stdin)input+=chunk;console.log(JSON.stringify(JSON.parse(input).map(args=>{try{return parseDocument(...args)}catch{return 'error'}})));";
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(mcp_protocol_rust::json::stringify(&json(&Value::Array(cases))).as_bytes())
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let actual =
        mcp_protocol_rust::json::parse(&result.stdout, mcp_protocol_rust::json::Limits::default())
            .unwrap();
    assert_eq!(actual, json(&Value::Array(expected)));
}
