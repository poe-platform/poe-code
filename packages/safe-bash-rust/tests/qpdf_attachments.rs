use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions, commands::archive::base64_decode,
    vfs::stream_string_to_bytes,
};
use std::sync::Arc;

#[test]
fn attachment_listing_and_extraction_match_both_javascript_routes() {
    let sources = json::parse(
        include_bytes!("fixtures/attachment-inspection.json"),
        Default::default(),
    )
    .unwrap();
    let Value::Array(fixtures) = json::parse(
        include_bytes!("fixtures/qpdf-attachment-parity.json"),
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

#[test]
fn attachment_object_read_failures_are_not_silently_skipped() {
    let sources = json::parse(
        include_bytes!("fixtures/attachment-inspection.json"),
        Default::default(),
    )
    .unwrap();
    let Value::String(source) = sources
        .get("cases")
        .unwrap()
        .get("duplicates")
        .unwrap()
        .get("pdf")
        .unwrap()
    else {
        panic!()
    };
    let mut bytes = base64_decode(&String::from_utf16(source).unwrap()).unwrap();
    let offset = bytes.windows(7).position(|b| b == b"4 0 obj").unwrap();
    bytes[offset] = b'X';
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
    for flags in [
        "--list-attachments",
        "--show-attachment=alpha",
        "--show-attachment=actual.bin",
    ] {
        let result = shell.exec(&format!("qpdf in.pdf {flags}")).unwrap();
        assert_eq!(result.exit_code, 2, "{flags}: {result:?}");
        assert!(result.stdout.is_empty());
        assert_eq!(
            result.stderr,
            "qpdf: in.pdf: invalid PDF object or stream\n"
        );
        assert_eq!(fs.read_file("/in.pdf").unwrap(), bytes);
    }
}

#[test]
fn missing_or_nonstream_references_do_not_hide_later_duplicate_keys() {
    let sources = json::parse(
        include_bytes!("fixtures/attachment-inspection.json"),
        Default::default(),
    )
    .unwrap();
    let Value::String(source) = sources
        .get("cases")
        .unwrap()
        .get("duplicates")
        .unwrap()
        .get("pdf")
        .unwrap()
    else {
        panic!()
    };
    let original = base64_decode(&String::from_utf16(source).unwrap()).unwrap();
    let offset = original.windows(8).position(|b| b == b"/F 4 0 R").unwrap() + 3;
    for reference in *b"390" {
        let mut bytes = original.clone();
        bytes[offset] = reference;
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
        for (flags, status, stdout, stderr) in [
            ("--list-attachments", 0, "alpha -> 8,0\n", ""),
            ("--show-attachment=alpha", 0, "XYZ", ""),
            (
                "--show-attachment=actual.bin",
                2,
                "",
                "qpdf: attachment actual.bin not found\n",
            ),
        ] {
            let result = shell.exec(&format!("qpdf in.pdf {flags}")).unwrap();
            assert_eq!(
                (
                    result.exit_code,
                    result.stdout.as_str(),
                    result.stderr.as_str()
                ),
                (status, stdout, stderr)
            );
            assert_eq!(fs.read_file("/in.pdf").unwrap(), bytes);
        }
    }
}
