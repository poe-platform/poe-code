use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

fn input_pdf() -> Vec<u8> {
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 6 /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] >>",
    ];
    objects.extend(["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"; 6]);
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{body}\nendobj\n", i + 1));
    }
    let xref = pdf.len();
    pdf.push_str("xref\n0 9\n0000000000 65535 f \n");
    for offset in &offsets[1..] {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ));
    pdf.into_bytes()
}

#[test]
fn invalid_page_labels_preserve_input_and_existing_or_absent_output() {
    let syntax = "page label spec must be n:[D|a|A|r|R][/start[/prefix]]";
    let input = input_pdf();
    for (specs, message) in [
        (vec!["1:Q"], syntax),
        (vec!["bad"], syntax),
        (vec!["1:n"], syntax),
        (vec!["1x:D"], syntax),
        (vec!["1:D/2x"], syntax),
        (vec!["1:D/title"], syntax),
        (vec!["1:D/-2"], syntax),
        (vec!["r:D"], syntax),
        (
            vec!["0:D"],
            "the first page label specification must start with page 1",
        ),
        (
            vec!["2:D"],
            "the first page label specification must start with page 1",
        ),
        (
            vec!["z:D"],
            "the first page label specification must start with page 1",
        ),
        (
            vec!["1:D/9223372036854775808"],
            "overflow/underflow converting 9223372036854775808 to 64-bit integer",
        ),
        (
            vec!["9223372036854775808:D"],
            "overflow/underflow converting 9223372036854775808 to 64-bit integer",
        ),
        (vec!["1:D/0"], "starting page number must be >= 1"),
        (
            vec!["1:D", "1:r"],
            "page label specifications must be in order by first page",
        ),
        (
            vec!["1:D", "z:r", "r2:A"],
            "page label specifications must be in order by first page",
        ),
    ] {
        for existing in [false, true] {
            let fs = MemoryVfs::new();
            fs.write_file("/in.pdf", &input).unwrap();
            if existing {
                fs.write_file("/out.pdf", b"original").unwrap();
            }
            let mut args = vec!["in.pdf", "out.pdf", "--set-page-labels"];
            args.extend_from_slice(&specs);
            args.push("--");
            let result = try_run_archive_command(
                "qpdf",
                &args.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 2, "{specs:?}: {}", result.stderr);
            assert_eq!(result.stderr, format!("qpdf: {message}\n"));
            assert!(result.stdout.is_empty());
            assert_eq!(fs.read_file("/in.pdf").unwrap(), input);
            if existing {
                assert_eq!(fs.read_file("/out.pdf").unwrap(), b"original");
            } else {
                assert!(!fs.exists("/out.pdf"));
            }
        }
    }
}

#[test]
fn relative_page_labels_use_selected_page_count_and_preserve_prefix_slashes() {
    let fs = MemoryVfs::new();
    fs.write_file("/in.pdf", &input_pdf()).unwrap();
    for (position, offset) in [("z", 1), ("r1", 1), ("r2", 2)] {
        for selected in [false, true] {
            let relative = format!("{position}:r/2/part/a");
            let mut args = vec![
                "in.pdf",
                "out.pdf",
                "--set-page-labels",
                "1:",
                &relative,
                "--",
            ];
            if selected {
                args.extend(["--pages", ".", "2-5", "--"]);
            }
            let result = try_run_archive_command(
                "qpdf",
                &args.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let bytes = fs.read_file("/out.pdf").unwrap();
            let text = String::from_utf8_lossy(&bytes);
            let index = if selected { 4 } else { 6 } - offset;
            assert!(
                text.contains(&format!(
                    "/Nums [ 0 <<\n>> {index} <<\n/S /r\n/St 2\n/P (part/a)\n>> ]"
                )),
                "{text}"
            );
        }
    }
}

#[test]
fn page_label_numbers_accept_leading_zeros_and_the_i64_upper_bound() {
    let fs = MemoryVfs::new();
    fs.write_file("/in.pdf", &input_pdf()).unwrap();
    for (spec, expected) in [
        ("0001:D/0002/part/a", "/St 2\n/P (part/a)"),
        ("1:D/9223372036854775807", "/St 9223372036854776000"),
    ] {
        let args = ["in.pdf", "out.pdf", "--set-page-labels", spec, "--"].map(str::to_owned);
        let result =
            try_run_archive_command("qpdf", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(String::from_utf8_lossy(&fs.read_file("/out.pdf").unwrap()).contains(expected));
    }
}
