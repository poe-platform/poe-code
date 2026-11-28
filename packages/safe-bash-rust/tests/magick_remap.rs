use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn magick_remap_consumes_palette_and_uses_only_its_colors() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "printf %s 'P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 255  0 0 0  255 255 0\n' > colors.ppm\nprintf %s 'P3\n3 1\n255\n40 40 40  100 100 100  200 200 200\n' > row.ppm\nmagick row.ppm +dither -remap colors.ppm -depth 8 rgb:out.rgb && xxd -p out.rgb",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "000000000000ffffff\n");
}

#[test]
fn magick_remap_applies_at_its_position_to_each_image() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("printf %s 'P3\n1 1\n255\n255 0 0\n' > palette.ppm; magick xc:gray xc:white +dither -remap palette.ppm -negate -depth 8 rgb:out.rgb && xxd -p out.rgb").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "00ffff00ffff\n");
}

#[test]
fn magick_remap_reports_missing_palette() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec("magick xc:red +dither -remap missing.ppm rgb:out.rgb")
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("unable to open image"),
        "{}",
        result.stderr
    );
}
