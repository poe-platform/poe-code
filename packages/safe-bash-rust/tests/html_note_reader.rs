use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions,
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
fn read(shell: &mut Shell, source: &str) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            "pandoc -f html -t json",
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap()
}

#[test]
fn native_html_json_preserves_standard_editor_and_pandoc_notes() {
    let editor = "<p>Text<sup><a id='ref' role='doc-noteref' href='#note'>1</a></sup> again<a role='doc-noteref' href='#note'>1</a></p><section id='footnotes' role='doc-endnotes'><ol><li id='note'><p>Note <strong>bold</strong> <a href='https://example.com'>Link</a></p><p>Second <code>code</code><img src='unread.png'></p></li></ol></section>";
    let (mut shell, _) = shell();
    for (source, count) in [
        (editor, 2),
        (
            include_str!("../../document-converter-rust/tests/fixtures/pandoc-footnote.html"),
            1,
        ),
    ] {
        let output = read(&mut shell, source);
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        assert_eq!(
            output.stdout.matches("\"t\":\"Note\"").count(),
            count,
            "{}",
            output.stdout
        );
        assert!(!output.stdout.contains("OrderedList"));
        assert!(!output.stdout.contains("doc-backlink"));
        assert!(output.stdout.contains("footnotes"));
        if count == 2 {
            assert!(output.stdout.contains("https://example.com"));
            assert!(output.stdout.contains("unread.png"));
        }
    }
}

#[test]
fn native_html_json_retains_note_container_styles_and_ordinary_body_backlinks() {
    let source = "<p id='intro'>Intro</p><p><a role='doc-backlink' href='#intro'>Return</a><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes' style='color:#123456;font-style:italic'><ol style='font-weight:bold'><li id='note' dir='ltr'><p>Note<a role='doc-backlink' href='#ref'>Back</a></p></li></ol></section>";
    let (mut shell, fs) = shell();
    let output = read(&mut shell, source);
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    for value in [
        "Return",
        "123456",
        "font-weight:bold",
        "font-style:italic",
        "ltr",
    ] {
        assert!(
            output.stdout.contains(value),
            "missing {value}: {}",
            output.stdout
        );
    }
    assert!(!output.stdout.contains("\"Back\""));
    fs.write_file("/notes.json", output.stdout.as_bytes())
        .unwrap();
    let binary = shell
        .exec("pandoc -f json -t docx /notes.json -o /notes.docx")
        .unwrap();
    assert_eq!(binary.exit_code, 0, "{}", binary.stderr);
    let parts =
        safe_bash_rust::commands::codecs::parse_zip_archive(&fs.read_file("/notes.docx").unwrap())
            .unwrap();
    let note = parts
        .iter()
        .find(|part| part.name == "word/footnotes.xml")
        .unwrap();
    let note = String::from_utf8_lossy(&note.content);
    for expected in ["123456", "<w:b/>", "<w:i/>", "Note"] {
        assert!(note.contains(expected), "{note}");
    }
    assert!(!note.contains("Back"));
}

#[test]
fn native_html_json_bounds_note_expansion_and_rejects_invalid_targets_atomically() {
    let (mut shell, fs) = shell();
    fs.write_file("/saved", b"KEEP").unwrap();
    for source in [
        "<p><a role='doc-noteref' href='#missing'>1</a></p>",
        "<p><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes'><ol><li id='note'><p><a role='doc-noteref' href='#note'>1</a></p></li></ol></section>",
    ] {
        let output = shell
            .exec_with_options(
                "pandoc -f html -t json -o /saved",
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0);
        assert!(
            output.stderr.to_lowercase().contains("footnote"),
            "{}",
            output.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
    shell.set_limits(ShellLimits {
        max_parse_units: 40,
        ..Default::default()
    });
    let source = format!(
        "<p>{}</p><section role='doc-endnotes'><ol><li id='note'><p><b>A</b></p></li></ol></section>",
        "<a role='doc-noteref' href='#note'>1</a>".repeat(10)
    );
    let output = read(&mut shell, &source);
    assert_ne!(output.exit_code, 0);
    assert!(output.stderr.contains("E_LIMIT"), "{}", output.stderr);
}

#[test]
fn native_html_note_text_expansion_respects_the_shell_memory_budget() {
    let (mut shell, fs) = shell();
    shell.set_limits(ShellLimits {
        max_memory_bytes: 20000,
        ..Default::default()
    });
    fs.write_file("/saved", b"KEEP").unwrap();
    let source = format!(
        "<p>{}</p><section role='doc-endnotes'><ol><li id='note'><p>{}</p></li></ol></section>",
        "<a role='doc-noteref' href='#note'>1</a>".repeat(20),
        "x".repeat(2048)
    );
    assert!(source.len() < 20000);
    let output = shell
        .exec_with_options(
            "pandoc -f html -t json -o /saved",
            ExecOptions {
                stdin: Some(source),
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(output.exit_code, 0);
    assert!(
        output.stderr.contains("expanded text limit"),
        "{}",
        output.stderr
    );
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn native_html_note_style_index_respects_the_shell_memory_budget_before_output() {
    let (mut shell, fs) = shell();
    shell.set_limits(ShellLimits {
        max_memory_bytes: 128 * 1024,
        ..Default::default()
    });
    let references = (0..60)
        .map(|i| format!("<a role='doc-noteref' href='#n{i}'>1</a>"))
        .collect::<String>();
    let definitions = (0..60)
        .map(|i| format!("<li id='n{i}'><p>N</p></li>"))
        .collect::<String>();
    let source = format!(
        "<p>{references}</p><a href='{}'><section role='doc-endnotes'><ol>{definitions}</ol></section></a>",
        "x".repeat(32 * 1024)
    );
    assert!(source.len() < 128 * 1024);
    fs.write_file("/saved", b"KEEP").unwrap();
    let output = shell
        .exec_with_options(
            "pandoc -f html -t docx -o /saved",
            ExecOptions {
                stdin: Some(source),
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(output.exit_code, 0);
    assert!(
        output.stderr.contains("HTML note style byte limit"),
        "{}",
        output.stderr
    );
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn native_html_literal_code_references_fail_without_consuming_definitions() {
    let (mut shell, _) = shell();
    for tag in ["pre", "code", "tt", "samp", "var", "kbd"] {
        let source = format!(
            "<{tag}><a role='doc-noteref' href='#note'>1</a></{tag}><section role='doc-endnotes'><ol><li id='note'><p>IMPORTANT NOTE</p></li></ol></section>"
        );
        let output = read(&mut shell, &source);
        assert_ne!(output.exit_code, 0);
        assert!(
            output.stderr.contains("literal code"),
            "{tag}: {}",
            output.stderr
        );
    }
}

#[test]
fn native_binary_note_resources_include_bodies_and_exclude_removed_backlinks() {
    let (mut shell, fs) = shell();
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    fs.write_file("/pixel.png", &image).unwrap();
    let source = "<p>Text<a id='ref' role='doc-noteref' href='#note'>1</a> again<a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes'><hr/><ol><li id='note'><p>Note <img src='pixel.png'><a role='doc-backlink' href='#ref'><img src='ignored.png'></a></p></li></ol></section>";
    for format in ["docx", "pdf"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f html -t {format} -o /out.{format}"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        let bytes = fs.read_file(&format!("/out.{format}")).unwrap();
        if format == "docx" {
            let parts = safe_bash_rust::commands::codecs::parse_zip_archive(&bytes).unwrap();
            let main = String::from_utf8_lossy(
                &parts
                    .iter()
                    .find(|part| part.name == "word/document.xml")
                    .unwrap()
                    .content,
            );
            assert_eq!(main.matches("<w:footnoteReference ").count(), 2);
            assert!(parts.iter().any(|part| part.name == "word/footnotes.xml"));
            assert!(parts.iter().any(|part| part.content == image));
        } else {
            assert!(bytes.starts_with(b"%PDF-"));
            assert!(String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
        }
        fs.write_file("/saved", b"KEEP").unwrap();
        let body_backlink = format!(
            "{source}<p><a role='doc-backlink' href='#ref'><img src='body-missing.png'></a></p>"
        );
        let failure = shell
            .exec_with_options(
                &format!("pandoc -f html -t {format} -o /saved"),
                ExecOptions {
                    stdin: Some(body_backlink),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(failure.exit_code, 0);
        assert!(
            failure.stderr.contains("body-missing.png"),
            "{}",
            failure.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}
