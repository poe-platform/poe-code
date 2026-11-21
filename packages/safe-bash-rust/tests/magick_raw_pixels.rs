use safe_bash_rust::{SafeBashFs, Shell};

#[test]
fn raw_rgba_output_contains_pixels_instead_of_a_synthetic_png_header() {
    let (mut shell, fs) = Shell::with_memory_fs();
    for (output, expected) in [
        ("/out.rgba", vec![255, 0, 0, 0, 255, 0, 0, 0]),
        ("RGBA:/out.bin", vec![255, 0, 0, 0, 255, 0, 0, 0]),
        ("/out.rgb", vec![255, 0, 0, 255, 0, 0]),
    ] {
        let result = shell.exec(&format!("magick -size 2x1 xc:red -transparent red -depth 8 {output}")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let path = output.strip_prefix("RGBA:").unwrap_or(output);
        assert_eq!(fs.read_file(path).unwrap(), expected, "{output}");
    }
}
