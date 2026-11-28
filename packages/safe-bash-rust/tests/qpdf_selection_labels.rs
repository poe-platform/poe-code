use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn merge(flags: &str) -> (Vec<u8>, String) {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.pdf", include_bytes!("fixtures/qpdf-labels-a.pdf"))
        .unwrap();
    fs.write_file("/b.pdf", include_bytes!("fixtures/qpdf-labels-b.pdf"))
        .unwrap();
    let mut shell = Shell::new(
        fs.clone(),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec(&format!("qpdf --empty {flags} result.pdf"))
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(!result.used_typescript_bridge);
    let report = shell.exec("qpdf result.pdf --json").unwrap();
    assert_eq!(report.exit_code, 0, "{}", report.stderr);
    (fs.read_file("/result.pdf").unwrap(), report.stdout)
}

type PageLabel = (&'static str, &'static str, f64);

const CASES: &[(&str, &[PageLabel])] = &[
    (
        "--pages a.pdf 1-3 b.pdf 1-2 --",
        &[
            ("A-", "/r", 4.),
            ("A-", "/D", 10.),
            ("A-", "/D", 11.),
            ("B-", "/r", 4.),
            ("B-", "/D", 10.),
        ],
    ),
    (
        "--pages a.pdf 3,1,3 b.pdf 2 --",
        &[
            ("A-", "/D", 11.),
            ("A-", "/r", 4.),
            ("A-", "/D", 11.),
            ("B-", "/D", 10.),
        ],
    ),
    (
        "--collate --pages a.pdf 1-3 b.pdf 1-2 --",
        &[
            ("A-", "/r", 4.),
            ("B-", "/r", 4.),
            ("A-", "/D", 10.),
            ("B-", "/D", 10.),
            ("A-", "/D", 11.),
        ],
    ),
];

#[test]
fn selections_preserve_page_label_ranges() {
    for (flags, expected) in CASES {
        let (_, report) = merge(flags);
        let report = json::parse(report.as_bytes(), Default::default()).unwrap();
        let Value::Array(pages) = report.get("pages").unwrap() else {
            panic!("pages")
        };
        assert_eq!(pages.len(), expected.len());
        for (page, (prefix, style, start)) in pages.iter().zip(*expected) {
            let label = page.get("label").unwrap();
            assert_eq!(
                label.get("/P"),
                Some(&Value::String(
                    format!("u:{prefix}").encode_utf16().collect()
                )),
                "{flags}"
            );
            assert_eq!(
                label.get("/S"),
                Some(&Value::String(style.encode_utf16().collect())),
                "{flags}"
            );
            assert_eq!(label.get("/St"), Some(&Value::Number(*start)), "{flags}");
        }
    }
}

#[test]
#[ignore = "requires the independent pypdf reader"]
fn independent_reader_preserves_logical_labels() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    for ((flags, _), expected) in CASES.iter().zip([
        "A-iv,A-10,A-11,B-iv,B-10",
        "A-11,A-iv,A-11,B-10",
        "A-iv,B-iv,A-10,B-10,A-11",
    ]) {
        let (bytes, _) = merge(flags);
        let mut child = Command::new("python3").args(["-c", "import io,sys; from pypdf import PdfReader; print(','.join(PdfReader(io.BytesIO(sys.stdin.buffer.read())).page_labels))"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(&bytes).unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(
            String::from_utf8(result.stdout).unwrap().trim(),
            expected,
            "{flags}"
        );
    }
}
