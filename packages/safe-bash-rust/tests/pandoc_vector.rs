use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

const SCENE: &str = r#"{"width":120,"height":80,"nodes":[{"id":"editable","bounds":[0,0,100,50],"transform":[1,0,0,1,0,0],"opacity":1,"kind":"path","path":{"rule":"nonzero","segments":[["M",0,0],["L",100,0],["L",100,50],["Z"]]},"fill":[255,0,0,255]}]}"#;
fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    let shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (shell, fs)
}
fn document(scene: &str) -> String {
    format!(
        r#"{{"pandoc-api-version":[1,23,1,2],"meta":{{}},"blocks":[{{"t":"Vector","c":{scene}}}]}}"#
    )
}
fn run(shell: &mut Shell, source: &str, target: &str) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc -f json -t {target} -o /output"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap()
}
#[test]
fn vector_json_roundtrips_and_reaches_both_binary_writers() {
    let (mut shell, fs) = shell();
    for target in ["json", "docx", "pdf"] {
        let output = run(&mut shell, &document(SCENE), target);
        assert_eq!(output.exit_code, 0, "{target}: {}", output.stderr);
        let bytes = fs.read_file("/output").unwrap();
        match target {
            "json" => {
                let text = String::from_utf8(bytes).unwrap();
                assert!(text.contains("\"Vector\""));
                assert!(text.contains("editable"));
                assert_eq!(run(&mut shell, &text, "json").exit_code, 0);
                assert_eq!(fs.read_file("/output").unwrap(), text.as_bytes());
            }
            "docx" => {
                let entries = safe_bash_rust::commands::codecs::parse_zip_archive(&bytes).unwrap();
                let body = &entries
                    .iter()
                    .find(|p| p.name == "word/document.xml")
                    .unwrap()
                    .content;
                let xml = String::from_utf8_lossy(body);
                assert!(xml.contains("asvg:svgBlip"), "{xml}");
                let media: Vec<_> = entries
                    .iter()
                    .filter(|p| p.name.starts_with("word/media/"))
                    .collect();
                assert_eq!(media.len(), 1);
                assert!(media[0].name.ends_with(".svg"));
                let svg = String::from_utf8_lossy(&media[0].content);
                assert!(svg.contains("<path"));
                assert!(!svg.contains("data:image/"));
            }
            "pdf" => {
                assert!(bytes.starts_with(b"%PDF-"));
                assert!(!String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
            }
            _ => unreachable!(),
        }
    }
}
#[test]
fn invalid_vectors_and_unsupported_writers_preserve_existing_output() {
    let (mut shell, fs) = shell();
    fs.write_file("/output", b"KEEP").unwrap();
    for target in [
        "html", "plain", "markdown", "rst", "latex", "rtf", "epub", "odt",
    ] {
        let output = run(&mut shell, &document(SCENE), target);
        assert_ne!(output.exit_code, 0, "{target}");
        assert!(
            output
                .stderr
                .contains("Vector requires JSON, DOCX, or PDF output"),
            "{}",
            output.stderr
        );
        assert_eq!(fs.read_file("/output").unwrap(), b"KEEP");
    }
    for target in ["json", "docx", "pdf"] {
        let output = run(
            &mut shell,
            &document(&SCENE.replace("\"opacity\":1", "\"opacity\":2")),
            target,
        );
        assert_ne!(output.exit_code, 0, "{target}");
        assert_eq!(fs.read_file("/output").unwrap(), b"KEEP");
    }
}


#[test]
fn standard_file_embeds_preserve_their_identity_for_registered_ast_handlers() {
    let (mut shell, _) = shell();
    let result = shell.exec_with_options("pandoc -f commonmark -t json", ExecOptions {
        stdin: Some("![Board](design.whiteboard#page=page1&frame=overview)".into()),
        ..Default::default()
    }).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = mcp_protocol_rust::json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    let expected = mcp_protocol_rust::json::parse(br#"[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[{"t":"Str","c":"Board"}],["design.whiteboard#page=page1&frame=overview",""]]}]}]"#, Default::default()).unwrap();
    assert_eq!(document.get("blocks"), Some(&expected));
}
