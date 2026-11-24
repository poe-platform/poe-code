use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions, commands::archive::base64_decode,
    vfs::stream_string_to_bytes,
};
use std::sync::Arc;

#[test]
fn metadata_handling_matches_javascript() {
    let Value::Array(fixtures) = json::parse(
        include_bytes!("fixtures/pdfinfo-meta-parity.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let text = |value: &Value| {
        let Value::String(value) = value else {
            panic!()
        };
        String::from_utf16(value).unwrap()
    };
    let mut failures = Vec::new();
    for fixture in fixtures {
        let name = text(fixture.get("name").unwrap());
        let Value::Array(args) = fixture.get("args").unwrap() else {
            panic!()
        };
        let flags = args.iter().map(text).collect::<Vec<_>>().join(" ");
        let bytes = base64_decode(&text(fixture.get("pdf").unwrap())).unwrap();
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file("/in.pdf", &bytes).unwrap();
        let mut shell = Shell::new(
            fs.clone(),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell.exec(&format!("pdfinfo {flags}")).unwrap();
        let Value::Number(status) = fixture.get("status").unwrap() else {
            panic!()
        };
        let expected = (
            *status as i32,
            text(fixture.get("stderr").unwrap()),
            base64_decode(&text(fixture.get("stdout").unwrap())).unwrap(),
        );
        let actual = (
            result.exit_code,
            result.stderr,
            stream_string_to_bytes(&result.stdout),
        );
        if actual != expected {
            failures.push(format!("{name}/{flags}: {actual:?} != {expected:?}"));
        }
        assert!(!result.used_typescript_bridge);
        assert_eq!(fs.read_file("/in.pdf").unwrap(), bytes);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
