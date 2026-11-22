use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

#[test]
fn grayscale_uses_rec709_luma_and_rec601_when_selected() {
    // Native ImageMagick reference values, also covered by the JS command fixtures.
    for (color, rec709, rec601) in [
        ("#ff0000", 54, 76),
        ("#00ff00", 182, 150),
        ("#0000ff", 18, 29),
        ("#356acb", 102, 101),
    ] {
        for (flag, space, expected) in [
            ("-colorspace", "Gray", rec709),
            ("-grayscale", "Rec709Luma", rec709),
            ("-grayscale", "Rec601Luma", rec601),
        ] {
            let fs = MemoryVfs::new();
            let args = [
                "-size",
                "1x1",
                &format!("xc:{color}"),
                flag,
                space,
                "/out.ppm",
            ]
            .map(str::to_owned);
            let out = try_run_archive_command("magick", &args, "", "/", &Default::default(), &fs)
                .unwrap();
            assert_eq!(out.exit_code, 0, "{}", out.stderr);
            let ppm = fs.read_file("/out.ppm").unwrap();
            assert_eq!(
                &ppm[ppm.len() - 3..],
                &[expected; 3],
                "{color} {flag} {space}"
            );
        }
    }
}
