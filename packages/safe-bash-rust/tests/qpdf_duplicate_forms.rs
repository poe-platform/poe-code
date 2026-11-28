use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn duplicate(input: &[u8], range: &str) -> (Shell, Arc<MemoryVfs>) {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.pdf", input).unwrap();
    let mut shell = Shell::new(
        fs.clone(),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec(&format!("qpdf a.pdf --pages . {range} -- result.pdf"))
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(!result.used_typescript_bridge);
    (shell, fs)
}

#[test]
fn repeated_pages_have_distinct_field_names_and_preserve_values() {
    for (range, expected) in [
        ("1,1,3", vec!["A_field", "A_field+1"]),
        ("1,1,1,3", vec!["A_field", "A_field+1", "A_field+2"]),
        ("1,3", vec!["A_field"]),
        ("1,3,1,1", vec!["A_field", "A_field+1", "A_field+2"]),
    ] {
        let (mut shell, _) = duplicate(include_bytes!("fixtures/qpdf-duplicate-form.pdf"), range);
        let report = shell
            .exec("qpdf result.pdf --json --json-key=acroform")
            .unwrap();
        assert_eq!(report.exit_code, 0, "{}", report.stderr);
        let report = json::parse(report.stdout.as_bytes(), Default::default()).unwrap();
        let Value::Array(fields) = report.get("acroform").unwrap().get("fields").unwrap() else {
            panic!("missing fields: {report:?}");
        };
        let names: Vec<_> = fields
            .iter()
            .map(|field| {
                assert_eq!(
                    field.get("value"),
                    Some(&Value::String("u:A_value".encode_utf16().collect()))
                );
                let Value::String(name) = field.get("fullname").unwrap() else {
                    panic!()
                };
                String::from_utf16(name).unwrap()
            })
            .collect();
        assert_eq!(names, expected, "range {range}");
    }
}

#[test]
#[ignore = "requires the independent pypdf reader"]
fn independent_reader_verifies_field_identity_and_page_ownership() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    for (input, parented) in [
        (
            include_bytes!("fixtures/qpdf-duplicate-form.pdf").as_slice(),
            "false",
        ),
        (
            include_bytes!("fixtures/qpdf-duplicate-parent-form.pdf").as_slice(),
            "true",
        ),
    ] {
        let (_, fs) = duplicate(input, "1,1,3");
        let mut child = Command::new("python3").args(["-c", r#"
import io, sys
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject
r = PdfReader(io.BytesIO(sys.stdin.buffer.read()))
parented = sys.argv[1] == 'true'
roots = ['Parent', 'Parent+1'] if parented else ['A_field', 'A_field+1']
assert [(k, r.get_fields()[k].get('/V')) for k in roots] == [(k, 'A_value') for k in roots]
widgets = [[a for a in p.get('/Annots', []) if a.get_object().get('/Subtype') == '/Widget'] for p in r.pages]
expected = [['A_field'], ['A_field' if parented else 'A_field+1'], []]
assert [[a.get_object().get('/T') for a in page] for page in widgets] == expected
assert widgets[0][0] != widgets[1][0]
registered = r.trailer['/Root']['/AcroForm']['/Fields']
assert len(registered) == 2 and registered[0] != registered[1]
for i in range(2):
    widget = widgets[i][0].get_object()
    assert widget.raw_get('/P') == r.pages[i].indirect_reference
    root = registered[i].get_object()
    assert root['/T'] == roots[i]
    if parented:
        assert widget.raw_get('/Parent') == registered[i]
        assert root['/Kids'] == [widgets[i][0]]
    else:
        assert registered[i] == widgets[i][0]
registered[1].get_object()[NameObject('/V')] = TextStringObject('changed')
saved = io.BytesIO()
PdfWriter(clone_from=r).write(saved)
reopened = PdfReader(saved).get_fields()
assert reopened[roots[0]]['/V'] == 'A_value'
assert reopened[roots[1]]['/V'] == 'changed'
"#, parented]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&fs.read_file("/result.pdf").unwrap())
            .unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}

#[test]
fn repeated_parented_widgets_preserve_the_field_hierarchy() {
    let (mut shell, _) = duplicate(
        include_bytes!("fixtures/qpdf-duplicate-parent-form.pdf"),
        "1,1,3",
    );
    let report = shell
        .exec("qpdf result.pdf --json --json-key=acroform")
        .unwrap();
    assert_eq!(report.exit_code, 0, "{}", report.stderr);
    assert!(
        report.stdout.contains("Parent.A_field"),
        "{}",
        report.stdout
    );
    assert!(
        report.stdout.contains("Parent+1.A_field"),
        "{}",
        report.stdout
    );
}
