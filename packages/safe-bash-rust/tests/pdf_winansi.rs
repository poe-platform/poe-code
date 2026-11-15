use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
#[test]
fn winansi_punctuation_has_visible_contours() {
    let pdf = include_bytes!("fixtures/pdf-winansi.pdf");
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", pdf).unwrap();
    let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
    let result =
        try_run_archive_command("pdftocairo", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let result = try_run_archive_command(
        "convert",
        &["/page-1.png", "/page.ppm"].map(String::from),
        "",
        "/",
        &Default::default(),
        &fs,
    )
    .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let ppm = fs.read_file("/page.ppm").unwrap();
    let pixels = ppm.strip_prefix(b"P6\n400 200\n255\n").unwrap();
    for (name, left, right) in [("em dash", 103, 126), ("euro", 134, 147)] {
        assert!(
            (90..109).any(|y| (left..right).any(|x| pixels[(y * 400 + x) * 3] < 100)),
            "{name} disappeared"
        );
    }
    assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
}
