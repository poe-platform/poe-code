use poe_tesseract::cli::{Action, parse_tesseract};
use poe_tesseract::cli::{PdfAction, parse_ocrmypdf};

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| (*s).into()).collect()
}

#[test]
fn parses_tesseract_language_layout_and_output() {
    let Action::Recognize(request) = parse_tesseract(&args(&[
        "scan.png",
        "stdout",
        "-l",
        "kor",
        "--psm",
        "6",
        "--dpi",
        "300",
        "--tessdata-dir",
        "/models",
        "tsv",
    ]))
    .unwrap() else {
        panic!("expected recognition")
    };
    assert_eq!(request.language, "kor");
    assert_eq!(request.psm, 6);
    assert_eq!(request.output, "stdout");
    assert_eq!(request.format, "tsv");
    assert_eq!(request.tessdata_dir.as_deref(), Some("/models"));
}

#[test]
fn invalid_cli_does_not_silently_ignore_arguments() {
    for argv in [
        vec!["image.png"],
        vec!["image.png", "stdout", "--psm", "99"],
        vec!["image.png", "stdout", "--unknown"],
        vec!["image.png", "stdout", "-l"],
        vec!["image.png", "stdout", "txt", "tsv"],
    ] {
        assert!(parse_tesseract(&args(&argv)).is_err(), "{argv:?}");
    }
}

#[test]
fn information_commands_need_no_input_image() {
    assert!(matches!(
        parse_tesseract(&args(&["--help"])),
        Ok(Action::Help)
    ));
    assert!(matches!(
        parse_tesseract(&args(&["--version"])),
        Ok(Action::Version)
    ));
    assert!(matches!(
        parse_tesseract(&args(&["--list-langs"])),
        Ok(Action::Languages)
    ));
}

#[test]
fn pdf_cli_explicitly_handles_existing_text_and_sidecar_output() {
    let PdfAction::Recognize(request) = parse_ocrmypdf(&args(&[
        "--skip-text",
        "--sidecar",
        "out.txt",
        "scan.pdf",
        "out.pdf",
    ]))
    .unwrap() else {
        panic!("expected PDF recognition")
    };
    assert!(request.skip_text);
    assert_eq!(request.sidecar.as_deref(), Some("out.txt"));
    assert_eq!(request.output, "out.pdf");
    assert!(parse_ocrmypdf(&args(&["--deskew", "scan.pdf", "out.pdf"])).is_err());
    assert!(parse_ocrmypdf(&args(&["--output-type", "pdfa", "scan.pdf", "out.pdf"])).is_err());
}
