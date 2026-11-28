use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn magick_clut_maps_channels_and_consumes_table() {
    for (options, expected) in [
        ("", "af5f1b378f1672891f\n"),
        ("-channel R", "af282837646472c8c8\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("printf %s 'P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 255  0 0 0  255 255 0\n' > colors.ppm\nprintf %s 'P3\n3 1\n255\n40 40 40  100 100 100  200 200 200\n' > row.ppm\nmagick row.ppm colors.ppm {options} -clut -depth 8 rgb:out.rgb && xxd -p out.rgb"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{options}");
    }
}

#[test]
fn magick_clut_requires_a_lookup_image() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("magick xc:red -clut rgb:out.rgb").unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("image sequence is required"),
        "{}",
        result.stderr
    );
}

#[test]
fn magick_clut_handles_one_dimensional_tables_and_operation_order() {
    for (inputs, expected) in [
        ("horizontal.ppm", "ff00ff\n"),
        ("vertical.ppm", "ff00ff\n"),
        ("xc:blue xc:white", "0000ff\n"),
        ("-negate horizontal.ppm", "000000\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "printf %s 'P3\n1 1\n255\n0 128 255\n' > pixel.ppm\nprintf %s 'P3\n2 1\n255\n255 0 0 0 0 255\n' > horizontal.ppm\nprintf %s 'P3\n1 2\n255\n255 0 0 0 0 255\n' > vertical.ppm\nmagick pixel.ppm {inputs} -clut -depth 8 rgb:out.rgb && xxd -p out.rgb"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{inputs}");
    }
}
