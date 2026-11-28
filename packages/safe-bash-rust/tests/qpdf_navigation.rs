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
    let Value::String(value) = value else {
        panic!("expected string")
    };
    String::from_utf16(value).unwrap()
}

#[test]
fn selection_preserves_primary_attachments_and_page_destinations() {
    for flags in [
        "--pages . 3,1,2 --",
        "--pages . 3 . 1,2 --",
        "--collate --pages . 3,2 . 1 --",
    ] {
        let fs = Arc::new(MemoryVfs::new());
        let input = include_bytes!("fixtures/qpdf-navigation.pdf");
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
            .exec(&format!("qpdf a.pdf {flags} result.pdf"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{flags}: {}", result.stderr);
        assert!(!result.used_typescript_bridge);
        let attachment = shell
            .exec("qpdf result.pdf --show-attachment=A.txt")
            .unwrap();
        assert_eq!(attachment.exit_code, 0, "{}", attachment.stderr);
        assert_eq!(attachment.stdout.as_bytes(), b"A payload");
        let result = shell.exec("qpdf result.pdf --json").unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let report = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        let outlines = array(report.get("outlines").unwrap());
        assert_eq!(outlines.len(), 3);
        for (outline, (title, page)) in outlines.iter().zip([("A1", 2.), ("A2", 3.), ("A3", 1.)]) {
            assert_eq!(text(outline.get("title").unwrap()), title);
            assert_eq!(outline.get("destpageposfrom1"), Some(&Value::Number(page)));
        }
        let objects = &array(report.get("qpdf").unwrap())[1];
        let resolve = |reference: &Value| {
            objects
                .get(&format!("obj:{}", text(reference)))
                .unwrap()
                .get("value")
                .unwrap()
        };
        let catalog = resolve(
            objects
                .get("trailer")
                .unwrap()
                .get("value")
                .unwrap()
                .get("/Root")
                .unwrap(),
        );
        let names = resolve(catalog.get("/Names").unwrap());
        let destinations = resolve(names.get("/Dests").unwrap());
        let pair = array(destinations.get("/Names").unwrap());
        assert_eq!(text(&pair[0]), "u:Abookmark");
        let destination = resolve(&pair[1]);
        assert_eq!(
            array(destination.get("/D").unwrap())[0],
            *array(report.get("pages").unwrap())[0]
                .get("object")
                .unwrap()
        );
        assert_eq!(fs.read_file("/a.pdf").unwrap(), input);
    }
}
