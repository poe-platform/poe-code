use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/pixel.png",
        &terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
    )
    .unwrap();
    (
        Shell::new(
            Arc::new(fs.clone()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        ),
        fs,
    )
}
fn convert(shell: &mut Shell, source: &str, from: &str, to: &str) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc -f {from} -t {to}"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap()
}
fn string(value: &Value, field: &str) -> String {
    let Some(Value::String(text)) = value.get(field) else {
        panic!("{field}")
    };
    String::from_utf16(text).unwrap()
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

#[test]
fn implicit_figures_match_javascript_profiles_containers_and_captions() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-figures.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let (mut shell, _) = shell();
    for case in cases {
        let source = string(&case, "source");
        let from = string(&case, "from");
        let result = convert(&mut shell, &source, &from, "json");
        if case.get("error").is_some() {
            assert_ne!(result.exit_code, 0, "{from}: {source}");
            assert!(result.stderr.contains("Unsupported extension"));
            continue;
        }
        assert_eq!(result.exit_code, 0, "{from}: {source}: {}", result.stderr);
        let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        assert_eq!(
            actual.get("blocks"),
            case.get("blocks"),
            "{} ({from})",
            string(&case, "id")
        );
    }
}

#[test]
fn figure_json_roundtrips_short_long_caption_body_and_attributes() {
    let source = r#"{"blocks":[{"t":"Figure","c":[["figure",["custom"],[["dir","rtl"]]],[[{"t":"Str","c":"SHORT"}],[{"t":"Para","c":[{"t":"Emph","c":[{"t":"Str","c":"LONG"}]}]}]],[{"t":"Para","c":[{"t":"Str","c":"BODY"}]}]]}]}"#;
    let (mut shell, _) = shell();
    let result = convert(&mut shell, source, "json", "json");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let expected = json::parse(source.as_bytes(), Default::default()).unwrap();
    let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    assert_eq!(actual.get("blocks"), expected.get("blocks"));
    let result = convert(&mut shell, source, "json", "html");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(
        result
            .stdout
            .contains("<figure id=\"figure\" class=\"custom\" dir=\"rtl\">")
    );
    assert!(
        result
            .stdout
            .contains("<figcaption><p><em>LONG</em></p>\n</figcaption>")
    );
    assert!(!result.stdout.contains("SHORT"));
}

#[test]
fn figures_preserve_images_and_visible_captions_in_binary_and_existing_writers() {
    let source = "![CAPTION *EMPH*](pixel.png)";
    let (mut shell, fs) = shell();
    for target in ["docx", "pdf", "odt", "epub"] {
        let result = convert(
            &mut shell,
            source,
            "markdown",
            &format!("{target} -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{target}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        match target {
            "docx" => {
                let xml = part(&bytes, "word/document.xml");
                assert!(xml.contains("<w:drawing "));
                assert!(xml.contains(">CAPTION "));
                assert!(xml.contains(">EMPH</w:t>"));
                assert!(xml.contains("<w:i/>"));
                assert_eq!(
                    parse_zip_archive(&bytes)
                        .unwrap()
                        .iter()
                        .filter(|p| p.name.starts_with("word/media/"))
                        .count(),
                    1
                );
            }
            "pdf" => {
                assert!(String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
                let result = convert(
                    &mut shell,
                    "![](pixel.png)\n\nCAPTION *EMPH*",
                    "markdown-implicit_figures",
                    "pdf -o /control",
                );
                assert_eq!(result.exit_code, 0, "{}", result.stderr);
                assert_eq!(
                    bytes,
                    fs.read_file("/control").unwrap(),
                    "PDF must include visible caption with formatting"
                );
            }
            _ => {
                let html = part(
                    &bytes,
                    if target == "odt" {
                        "content.xml"
                    } else {
                        "EPUB/ch1.xhtml"
                    },
                );
                assert!(html.contains("<figure>"));
                assert!(html.contains("src=\"pixel.png\""));
                assert!(html.contains(
                    "<figcaption aria-hidden=\"true\">CAPTION <em>EMPH</em></figcaption>"
                ));
            }
        }
    }
    for target in ["html", "plain", "markdown", "latex", "rtf", "rst"] {
        let result = convert(&mut shell, source, "markdown", target);
        assert_eq!(result.exit_code, 0, "{target}: {}", result.stderr);
        assert!(
            result.stdout.contains("CAPTION"),
            "{target}: {}",
            result.stdout
        );
        if matches!(target, "html" | "markdown" | "latex" | "rst") {
            assert!(
                result.stdout.contains("pixel.png"),
                "{target}: {}",
                result.stdout
            );
        }
    }
}

#[test]
fn figure_caption_notes_are_visible_and_missing_caption_resources_fail_atomically() {
    let (mut shell, fs) = shell();
    for target in ["docx", "pdf"] {
        let source = "![CAPTION[^n]](pixel.png)\n\n[^n]: NOTE BODY";
        let result = convert(
            &mut shell,
            source,
            "markdown",
            &format!("{target} -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{target}: {}", result.stderr);
        if target == "docx" {
            let bytes = fs.read_file("/output").unwrap();
            assert!(part(&bytes, "word/document.xml").contains("footnoteReference"));
            assert!(part(&bytes, "word/footnotes.xml").contains("NOTE BODY"));
        }
        fs.write_file("/output", b"KEEP").unwrap();
        let source = "![CAPTION[^n]](pixel.png)\n\n[^n]: ![VISIBLE](missing.png)";
        let result = convert(
            &mut shell,
            source,
            "markdown",
            &format!("{target} -o /output"),
        );
        assert_ne!(result.exit_code, 0, "{target}");
        assert_eq!(fs.read_file("/output").unwrap(), b"KEEP");
    }
}
