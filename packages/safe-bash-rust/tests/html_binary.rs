use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

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
fn convert(shell: &mut Shell, html: &str, format: &str, flags: &str) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc -f html -t {format} {flags}"),
            ExecOptions {
                stdin: Some(html.into()),
                ..Default::default()
            },
        )
        .unwrap()
}
fn part(bytes: &[u8], name: &str) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|part| part.name == name)
            .unwrap()
            .content,
    )
    .unwrap()
}
fn png() -> Vec<u8> {
    let pixels: Vec<_> = (0..32 * 32 * 4)
        .map(|i| ((i * 57 + i / 7) % 251) as u8)
        .collect();
    terminal_png_rust::png::encode(32, 32, &pixels).unwrap()
}

#[test]
fn html_word_embeds_office_rasters_and_pdf_renders_them() {
    for (extension, bytes) in [
        (
            "gif",
            include_bytes!("fixtures/html-images/pixel.gif").as_slice(),
        ),
        (
            "bmp",
            include_bytes!("fixtures/html-images/pixel.bmp").as_slice(),
        ),
        (
            "tiff",
            include_bytes!("fixtures/html-images/pixel.tiff").as_slice(),
        ),
    ] {
        let (mut shell, fs) = shell();
        fs.write_file(&format!("/pixel.{extension}"), bytes)
            .unwrap();
        let html = format!(
            "<!doctype html><custom-wrapper><p>Before</p><img src='pixel.{extension}' width='8' height='6'><p>After</p></custom-wrapper>"
        );
        let result = convert(&mut shell, &html, "docx", "-M title=Descriptive -o /word");
        assert_eq!(result.exit_code, 0, "{extension}: {}", result.stderr);
        let output = fs.read_file("/word").unwrap();
        let parts = parse_zip_archive(&output).unwrap();
        assert!(
            parts
                .iter()
                .any(|entry| entry.name.starts_with("word/media/") && entry.content == bytes)
        );
        let body = part(&output, "word/document.xml");
        assert!(body.contains("Before") && body.contains("After") && body.contains("w:drawing"));
        assert_eq!(body.matches("Descriptive").count(), 1);
        assert!(body.find("Descriptive").unwrap() < body.find("Before").unwrap());
        assert!(part(&output, "docProps/core.xml").contains("Descriptive"));
        fs.write_file("/pdf", b"KEEP").unwrap();
        let result = convert(&mut shell, &html, "pdf", "-o /pdf");
        assert_eq!(result.exit_code, 0, "{extension}: {}", result.stderr);
        let output = fs.read_file("/pdf").unwrap();
        let raw = String::from_utf8_lossy(&output);
        assert!(raw.starts_with("%PDF-"));
        assert!(raw.contains("/Subtype /Image"));
        assert!(raw.contains("/Width 8 /Height 6"));
    }
}

#[test]
fn unsupported_tiff_profile_does_not_replace_existing_pdf() {
    let (mut shell, fs) = shell();
    fs.write_file(
        "/image.tiff",
        include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-cmyk.tiff"),
    )
    .unwrap();
    fs.write_file("/saved.pdf", b"KEEP").unwrap();
    let result = convert(
        &mut shell,
        "<p><img src='image.tiff'></p>",
        "pdf",
        "-o /saved.pdf",
    );
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("Unsupported TIFF encoding"),
        "{}",
        result.stderr
    );
    assert_eq!(fs.read_file("/saved.pdf").unwrap(), b"KEEP");
}

#[test]
fn html_resource_input_limit_is_checked_before_serialization() {
    let (mut shell, fs) = shell();
    let image = png();
    assert!(image.len() > 512);
    fs.write_file("/large.png", &image).unwrap();
    fs.write_file("/saved", b"KEEP").unwrap();
    shell.set_limits(ShellLimits {
        max_input_bytes: 512,
        ..Default::default()
    });
    for format in ["docx", "pdf"] {
        let result = convert(
            &mut shell,
            "<p><img src='large.png'></p>",
            format,
            "-o /saved",
        );
        assert_ne!(result.exit_code, 0);
        assert!(
            result.stderr.contains("Document resource byte limit"),
            "{}",
            result.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn html_repeated_resources_are_bounded_before_clone() {
    let (mut shell, fs) = shell();
    let image = png();
    fs.write_file("/pixel.png", &image).unwrap();
    fs.write_file("/saved", b"KEEP").unwrap();
    shell.set_limits(ShellLimits {
        max_memory_bytes: image.len() * 2,
        ..Default::default()
    });
    let html = "<p><img src='pixel.png'></p>".repeat(3);
    let result = convert(&mut shell, &html, "docx", "-o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("HTML image byte limit"),
        "{}",
        result.stderr
    );
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn html_lower_shell_parse_and_input_limits_are_preserved() {
    let (mut shell, fs) = shell();
    fs.write_file("/saved", b"KEEP").unwrap();
    shell.set_limits(ShellLimits {
        max_parse_units: 32,
        ..Default::default()
    });
    let result = convert(&mut shell, &"<p>text</p>".repeat(20), "docx", "-o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("node limit"), "{}", result.stderr);
    shell.set_limits(ShellLimits {
        max_input_bytes: 32,
        ..Default::default()
    });
    let error = shell
        .exec_with_options(
            "pandoc -f html -t docx -o /saved",
            ExecOptions {
                stdin: Some(format!("<p>{}</p>", "text".repeat(10))),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(error.contains("maxInputBytes"), "{error}");
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn html_pdf_uses_the_shell_layout_budget_before_publication() {
    let (mut shell, fs) = shell();
    fs.write_file("/saved", b"KEEP").unwrap();
    shell.set_limits(ShellLimits {
        max_parse_units: 128,
        ..Default::default()
    });
    let result = convert(
        &mut shell,
        &format!("<p>{}</p>", "budget ".repeat(128)),
        "pdf",
        "-o /saved",
    );
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("layoutWork"), "{}", result.stderr);
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn html_heading_shifts_reach_nested_containers_and_drop_demoted_heading_ids() {
    for shift in [1, -1] {
        let (mut shell, fs) = shell();
        let html = "<h1 id='top'>TOP</h1><blockquote id='wrapper'><h1 id='quote'>QUOTE</h1></blockquote><ul><li><h1 id='list'>LIST</h1></li></ul><table><tr><td><h1 id='cell'>CELL</h1></td></tr></table><div dir='ltr'><h1 id='direction'>DIRECTION</h1></div>";
        let result = convert(
            &mut shell,
            html,
            "docx",
            &format!("--shift-heading-level-by={shift} -o /word"),
        );
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let xml = part(&fs.read_file("/word").unwrap(), "word/document.xml");
        assert!(!xml.contains("w:pStyle w:val=\"Heading1\""), "{xml}");
        assert_eq!(
            xml.matches("w:pStyle w:val=\"Heading2\"").count(),
            if shift == 1 { 5 } else { 0 },
            "{xml}"
        );
        for id in ["top", "quote", "list", "cell", "direction"] {
            assert_eq!(xml.contains(&format!("w:name=\"{id}\"")), shift > 0);
        }
        assert!(xml.contains("w:name=\"wrapper\""));
    }
}

#[test]
fn html_pdf_output_budget_reaches_writer_before_serialization() {
    let (mut shell, fs) = shell();
    fs.write_file("/saved", b"KEEP").unwrap();
    shell.set_limits(ShellLimits {
        max_memory_bytes: 1024,
        ..Default::default()
    });
    let result = convert(&mut shell, "<p>Bounded PDF</p>", "pdf", "-o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("PDF outputBytes"),
        "{}",
        result.stderr
    );
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}
