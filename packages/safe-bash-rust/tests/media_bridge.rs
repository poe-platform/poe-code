use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn fixture(mode: BackendMode) -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/work").unwrap();
    fs.write_file("/work/red.ppm", b"P6\n2 1\n255\n\xff\x00\x00\xff\x00\x00").unwrap();
    fs.write_file("/work/blue.ppm", b"P6\n2 1\n255\n\x00\x00\xff\x00\x00\xff").unwrap();
    let shell = Shell::new(Arc::new(fs.clone()), ShellOptions { cwd: Some("/work".into()), mode, ..Default::default() });
    (shell, fs)
}

#[test]
fn hybrid_montage_retains_real_pixels_without_replaying_prior_commands() {
    let (mut shell, fs) = fixture(BackendMode::Hybrid);
    let result = shell.exec("printf once >> visits; montage red.ppm blue.ppm -tile 2x1 -geometry 2x1+0+0 'sheet with space.ppm'; printf after").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(fs.read_file("/work/visits").unwrap(), b"once");
    assert_eq!(result.stdout, "after");
    assert_eq!(fs.read_file("/work/sheet with space.ppm").unwrap(), b"P6\n4 1\n255\n\xff\x00\x00\xff\x00\x00\x00\x00\xff\x00\x00\xff");
    assert!(result.used_typescript_bridge);
    assert!(!shell.exec("printf native").unwrap().used_typescript_bridge);
}

#[test]
fn native_only_image_conversion_preserves_existing_output_on_unsupported_operation() {
    let (mut shell, fs) = fixture(BackendMode::NativeOnly);
    fs.write_file("/work/output.png", b"existing output").unwrap();
    let result = shell.exec("convert red.ppm output.png").unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("TypeScript"));
    assert_eq!(fs.read_file("/work/output.png").unwrap(), b"existing output");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn hybrid_ffmpeg_preserves_audio_samples() {
    let (mut shell, fs) = fixture(BackendMode::Hybrid);
    let samples = [0i16, 1200, -2400, 3600, -4800, 6000];
    let pcm: Vec<u8> = samples.iter().flat_map(|sample| sample.to_le_bytes()).collect();
    let mut wav = b"RIFF".to_vec();
    wav.extend_from_slice(&(36u32 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00");
    wav.extend_from_slice(&8000u32.to_le_bytes());
    wav.extend_from_slice(&16000u32.to_le_bytes());
    wav.extend_from_slice(b"\x02\x00\x10\x00data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);
    fs.write_file("/work/input.wav", &wav).unwrap();
    let result = shell.exec("ffmpeg -i input.wav output.wav").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let output = fs.read_file("/work/output.wav").unwrap();
    assert_eq!(&output[..4], b"RIFF");
    assert_eq!(&output[8..12], b"WAVE");
    assert_eq!(&output[44..], &pcm);
    assert!(result.used_typescript_bridge);
}

#[test]
fn bridge_usage_propagates_through_command_substitution_and_preserves_quoted_paths() {
    let (mut shell, fs) = fixture(BackendMode::Hybrid);
    let result = shell.exec("name=\"red 'copy'.ppm\"; cp red.ppm \"$name\"; printf '%s' \"$(magick identify -format '%w' \"$name\")\"").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "2");
    assert!(result.used_typescript_bridge);
    assert!(fs.exists("/work/red 'copy'.ppm"));
}

#[test]
fn image_pipes_preserve_binary_bytes_across_the_bridge() {
    let (mut shell, fs) = fixture(BackendMode::Hybrid);
    for command in ["magick red.ppm ppm:- > result.ppm", "cat red.ppm | magick ppm:- result.ppm"] {
        let result = shell.exec(command).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.read_file("/work/result.ppm").unwrap(), fs.read_file("/work/red.ppm").unwrap(), "{command}");
        assert!(result.used_typescript_bridge);
    }
}

#[test]
fn hybrid_pandoc_writes_wordprocessingml_and_reads_document_content() {
    let (mut shell, fs) = fixture(BackendMode::Hybrid);
    fs.write_file("/work/guide.md", b"# Welcome\n\nMeet Maya at 09:00.\n").unwrap();
    let result = shell.exec("pandoc guide.md -f markdown -t docx -o guide.docx").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = shell.exec("unzip -p guide.docx word/document.xml").unwrap();
    assert!(document.stdout.contains("http://schemas.openxmlformats.org/wordprocessingml/2006/main"), "{}", document.stdout);
    assert!(document.stdout.contains("Meet Maya at 09:00."));
    let relationships = shell.exec("unzip -p guide.docx _rels/.rels").unwrap();
    assert!(relationships.stdout.contains("relationships/officeDocument"), "{}", relationships.stderr);
    let text = shell.exec("pandoc guide.docx -t plain").unwrap();
    assert_eq!(text.exit_code, 0, "{}", text.stderr);
    assert!(text.stdout.contains("Welcome") && text.stdout.contains("Meet Maya at 09:00."), "{}", text.stdout);
    assert!(result.used_typescript_bridge && text.used_typescript_bridge);
}

#[test]
fn native_only_pandoc_preserves_existing_document() {
    let (mut shell, fs) = fixture(BackendMode::NativeOnly);
    fs.write_file("/work/guide.md", b"# Welcome\n").unwrap();
    fs.write_file("/work/guide.docx", b"existing document").unwrap();
    let result = shell.exec("pandoc guide.md -o guide.docx").unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("TypeScript"));
    assert_eq!(fs.read_file("/work/guide.docx").unwrap(), b"existing document");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn hybrid_rsvg_convert_renders_files_and_piped_svg() {
    for mode in [BackendMode::Hybrid, BackendMode::TypeScriptOnly] {
        let (mut shell, fs) = fixture(mode);
        fs.write_file("/work/input.svg", b"<svg width=\"2\" height=\"1\"><rect width=\"2\" height=\"1\" fill=\"red\"/></svg>").unwrap();
        for command in [
            "rsvg-convert input.svg -o 'output image.png'",
            "cat input.svg | rsvg-convert -o 'output image.png'",
        ] {
            let result = shell.exec(command).unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert!(result.used_typescript_bridge);
            let result = shell.exec("convert 'output image.png' output.ppm").unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(fs.read_file("/work/output.ppm").unwrap(), b"P6\n2 1\n255\n\xff\x00\x00\xff\x00\x00");
        }
    }
}

#[test]
fn hybrid_rsvg_convert_reports_renderer_errors_without_replacing_output() {
    let (mut shell, fs) = fixture(BackendMode::Hybrid);
    fs.write_file("/work/input.svg", b"<svg width=\"2\" height=\"1\"><image/></svg>").unwrap();
    fs.write_file("/work/output.png", b"existing output").unwrap();
    let result = shell.exec("rsvg-convert input.svg -o output.png").unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("Unsupported SVG element image"), "{}", result.stderr);
    assert_eq!(fs.read_file("/work/output.png").unwrap(), b"existing output");
    assert!(result.used_typescript_bridge);
}
