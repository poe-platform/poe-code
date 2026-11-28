use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn array(value: &Value) -> &[Value] {
    let Value::Array(items) = value else {
        panic!("expected array: {value:?}")
    };
    items
}
fn text(value: &Value) -> String {
    let Value::String(text) = value else {
        panic!("expected string: {value:?}")
    };
    String::from_utf16_lossy(text)
}
fn resolve<'a>(objects: &'a Value, value: &'a Value) -> &'a Value {
    if matches!(value, Value::String(_)) {
        objects
            .get(&format!("obj:{}", text(value)))
            .and_then(|v| v.get("value"))
            .unwrap_or(value)
    } else {
        value
    }
}

#[test]
fn selected_overlay_and_underlay_preserve_review_notes_and_map_their_rectangles() {
    for layer in ["overlay", "underlay"] {
        let fs = Arc::new(MemoryVfs::new());
        let target = include_bytes!("fixtures/qpdf-stamp-target.pdf");
        let source = include_bytes!("fixtures/qpdf-stamp-source.pdf");
        fs.write_file("/a.pdf", target).unwrap();
        fs.write_file("/b.pdf", source).unwrap();
        let mut shell = Shell::new(
            fs.clone(),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec(&format!(
                "qpdf a.pdf --{layer} b.pdf --to=3 --from=2 -- result.pdf"
            ))
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        let result = shell
            .exec("qpdf result.pdf --json --json-key=pages --json-key=qpdf")
            .unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        let report = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        let objects = &array(report.get("qpdf").unwrap())[1];
        let pages = array(report.get("pages").unwrap());
        assert_eq!(pages.len(), 3);
        for (i, page) in pages.iter().enumerate() {
            let page = resolve(objects, page.get("object").unwrap());
            let notes = array(resolve(objects, page.get("/Annots").unwrap()))
                .iter()
                .map(|v| resolve(objects, v))
                .filter(|v| text(v.get("/Subtype").unwrap()) == "/Text")
                .collect::<Vec<_>>();
            let mut expected = vec![format!("u:A-note-{i}")];
            if i == 2 {
                expected.push("u:B-note-1".into());
            }
            assert_eq!(
                notes
                    .iter()
                    .map(|v| text(v.get("/Contents").unwrap()))
                    .collect::<Vec<_>>(),
                expected,
                "{layer} page {i}"
            );
            assert_eq!(
                notes[0].get("/Rect"),
                Some(&json::parse(b"[5,5,21,22]", Default::default()).unwrap())
            );
            if i == 2 {
                // Native qpdf, independently inspected with pypdf: cropped pages,
                // source rotation 90, source UserUnit 1.5, destination UserUnit 2.
                assert_eq!(
                    notes[1].get("/Rect"),
                    Some(
                        &json::parse(b"[2.544803,70.888889,10,78.810036]", Default::default())
                            .unwrap()
                    )
                );
            }
        }
        assert_eq!(fs.read_file("/a.pdf").unwrap(), target);
        assert_eq!(fs.read_file("/b.pdf").unwrap(), source);
    }
}

#[test]
fn repeated_source_notes_have_independent_destination_geometry() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.pdf", include_bytes!("fixtures/qpdf-stamp-target.pdf"))
        .unwrap();
    fs.write_file("/b.pdf", include_bytes!("fixtures/qpdf-stamp-source.pdf"))
        .unwrap();
    let mut shell = Shell::new(
        fs.clone(),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec("qpdf a.pdf --overlay b.pdf --from=2 --repeat=2 -- result.pdf")
        .unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let result = shell
        .exec("qpdf result.pdf --json --json-key=pages --json-key=qpdf")
        .unwrap();
    let report = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let objects = &array(report.get("qpdf").unwrap())[1];
    let mut ids = std::collections::BTreeSet::new();
    for (i, page) in array(report.get("pages").unwrap()).iter().enumerate() {
        let page = resolve(objects, page.get("object").unwrap());
        let annotations = array(resolve(objects, page.get("/Annots").unwrap()));
        assert_eq!(annotations.len(), if i == 0 { 3 } else { 2 });
        let note = annotations.last().unwrap();
        assert!(ids.insert(text(note)), "reused a mutable annotation");
        let note = resolve(objects, note);
        assert_eq!(text(note.get("/Contents").unwrap()), "u:B-note-1");
        let expected = if i == 1 {
            "[115.333333,3.333333,126.666667,14]"
        } else {
            "[2.544803,70.888889,10,78.810036]"
        };
        assert_eq!(
            note.get("/Rect"),
            Some(&json::parse(expected.as_bytes(), Default::default()).unwrap())
        );
    }
}

#[test]
fn copied_review_appearances_keep_stream_data_and_transform_both_appearance_forms() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/a.pdf", include_bytes!("fixtures/qpdf-stamp-target.pdf"))
        .unwrap();
    // The source attachment with an indirect Annots array, page backlink, and
    // normal/state-dictionary appearances sharing one translated form stream.
    fs.write_file(
        "/b.pdf",
        include_bytes!("fixtures/qpdf-stamp-appearance.pdf"),
    )
    .unwrap();
    let mut shell = Shell::new(
        fs.clone(),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec("qpdf a.pdf --overlay b.pdf --from=2 --to=3 -- result.pdf")
        .unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let result = shell
        .exec("qpdf result.pdf --json --json-key=pages --json-key=qpdf")
        .unwrap();
    let report = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let objects = &array(report.get("qpdf").unwrap())[1];
    let page_id = array(report.get("pages").unwrap())[2]
        .get("object")
        .unwrap();
    let page = resolve(objects, page_id);
    let note = resolve(
        objects,
        array(resolve(objects, page.get("/Annots").unwrap()))
            .last()
            .unwrap(),
    );
    assert_eq!(note.get("/P"), Some(page_id));
    let appearance = resolve(objects, note.get("/AP").unwrap());
    let normal = appearance.get("/N").unwrap();
    let down = resolve(objects, appearance.get("/D").unwrap())
        .get("/Review")
        .unwrap();
    // Native qpdf's annotation appearance matrix (pypdf inspection).
    let expected = json::parse(
        b"[0.46595,0,0,0.46595,3.215054,72.55914]",
        Default::default(),
    )
    .unwrap();
    for stream in [normal, down] {
        let dict = objects
            .get(&format!("obj:{}", text(stream)))
            .unwrap()
            .get("stream")
            .unwrap()
            .get("dict")
            .unwrap();
        assert_eq!(dict.get("/Matrix"), Some(&expected));
        let object = text(stream);
        let id = object.split_whitespace().next().unwrap();
        let result = shell
            .exec(&format!(
                "qpdf result.pdf --show-object={id} --filtered-stream-data"
            ))
            .unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, "0 0 16 17 re f", "")
        );
    }
}
