use safe_bash_rust::{MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn device_cmyk_fill_stroke_and_color_space_restore() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/input.pdf",
        include_bytes!("../../pdf-ast/src/fixtures/device-cmyk.pdf"),
    )
    .unwrap();
    let mut shell = Shell::new(Arc::new(fs.clone()), ShellOptions::default());
    let red = [255, 46, 23];
    let white = [255, 255, 255];
    let black = [44, 46, 53];
    let colors = [
        red,
        white,
        black,
        [6, 6, 12],
        [32, 28, 21],
        red,
        white,
        red,
        [251, 49, 153],
        [0, 0, 0],
        [255, 235, 61],
        [255, 0, 0],
        red,
        white,
        red,
    ];
    for command in ["pdftoppm", "pdftocairo"] {
        let result = shell
            .exec(&format!(
                "{command} -png -r 72 -singlefile /input.pdf /page"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let result = shell.exec("convert /page.png /page.ppm").unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let ppm = fs.read_file("/page.ppm").unwrap();
        assert!(ppm.starts_with(b"P6\n300 40\n255\n"));
        let pixels = &ppm[ppm.len() - 300 * 40 * 3..];
        for (i, color) in colors.iter().enumerate() {
            for y in [10, 30] {
                let expected = match (i, y) {
                    (5 | 7, 30) => [0, 185, 242],
                    (6, 30) => black,
                    _ => *color,
                };
                let at = (y * 300 + i * 20 + 10) * 3;
                assert_eq!(
                    &pixels[at..at + 3],
                    &expected,
                    "{command}, swatch {i}, row {y}"
                );
            }
        }
    }
}
