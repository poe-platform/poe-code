use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions, commands::archive::base64_decode,
    vfs::stream_string_to_bytes,
};
use std::sync::Arc;

#[test]
fn recovered_trailer_inspection_matches_javascript() {
    let strict = json::parse(
        include_bytes!("fixtures/strict-catalogs.json"),
        Default::default(),
    )
    .unwrap();
    let recovered = json::parse(
        include_bytes!("fixtures/recovered-catalogs.json"),
        Default::default(),
    )
    .unwrap();
    let Value::Array(fixtures) = json::parse(
        include_bytes!("fixtures/qpdf-trailer-parity.json"),
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
        let flags = text(fixture.get("flags").unwrap());
        let corpus = text(fixture.get("corpus").unwrap());
        let sources = if corpus == "strict-catalogs" {
            &strict
        } else {
            &recovered
        };
        let source = sources.get("cases").unwrap().get(&name).unwrap();
        let bytes = base64_decode(&text(source.get("pdf").unwrap())).unwrap();
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
        let result = shell.exec(&format!("qpdf in.pdf {flags}")).unwrap();
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
