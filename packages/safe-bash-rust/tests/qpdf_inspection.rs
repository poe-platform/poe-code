use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn document(extra: &[(usize, usize, &str)]) -> Vec<u8> {
    let mut objects = vec![
        (1, 0, "<< /Type /Catalog /Pages 2 0 R >>"),
        (2, 0, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        (3, 0, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"),
    ];
    objects.extend_from_slice(extra);
    let count = objects.iter().map(|o| o.0).max().unwrap() + 1;
    let mut rows = vec![None; count];
    let mut text = String::from("%PDF-1.7\n");
    for (number, generation, body) in objects {
        rows[number] = Some((text.len(), generation));
        text.push_str(&format!("{number} {generation} obj\n{body}\nendobj\n"));
    }
    let xref = text.len();
    text.push_str(&format!("xref\n0 {count}\n"));
    for row in rows {
        match row {
            Some((offset, generation)) => text.push_str(&format!("{offset:010} {generation:05} n \n")),
            None => text.push_str("0000000000 65535 f \n"),
        }
    }
    text.push_str(&format!("trailer << /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"));
    text.into_bytes()
}

#[test]
fn inspection_matches_native_sorted_dictionaries_and_original_string_bytes() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let input = document(&[
        (4, 0, "<< /Z << /z 1 /a 2 /Z 3 /A 4 >> /A [<< /z 1 /a 2 /Z 3 /A 4 >>] >>"),
        (5, 0, "[<4128295c0a0d09080c> <00011f7f80ff> <4142> <> <feff96ea>]"),
    ]);
    fs.write_file("/in", &input).unwrap();
    for (number, expected) in [
        (4, "<< /A [ << /A 4 /Z 3 /a 2 /z 1 >> ] /Z << /A 4 /Z 3 /a 2 /z 1 >> >>\n"),
        (5, "[ (A\\(\\)\\\\\\n\\r\\t\\b\\f) <00011f7f80ff> (AB) () <feff96ea> ]\n"),
    ] {
        let result = shell.exec(&format!("qpdf in --show-object={number}")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, expected, ""));
    }
    assert_eq!(fs.read_file("/in").unwrap(), input);
}

#[test]
fn inspection_uses_exact_generations_and_handles_trailer_and_zero() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let input = document(&[(42, 7, "123"), (44, 7, "<< /Length 7 >>\nstream\npayload\nendstream")]);
    fs.write_file("/in", &input).unwrap();
    for flags in ["", " --raw-stream-data", " --filtered-stream-data"] {
        for (selector, expected) in [
            ("42,7", "123\n"), ("+42,7tail", "123\n"), ("42,0", "null\n"), ("42", "null\n"),
            ("43,7", "null\n"), ("44,0", "null\n"), ("0", ""), ("0,bad", ""),
            ("trailer", "<< /Root 1 0 R /Size 45 >>\n"), ("NaN", "null\n"), ("-1", "null\n"),
        ] {
            let result = shell.exec(&format!("qpdf in --show-object={selector}{flags}")).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, expected, ""), "{selector}{flags}");
        }
        let result = shell.exec(&format!("qpdf in --show-object=44,7{flags}")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
            (0, if flags.is_empty() { "Object is stream.  Dictionary:\n<< /Length 7 >>\n" } else { "payload" }, ""));
    }
}

#[test]
fn inspection_matches_the_native_linearized_stream_fixture() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/in", include_bytes!("../../safe-bash-command-qpdf/src/fixtures/linearized.pdf")).unwrap();
    let result = shell.exec("qpdf in --show-object=2").unwrap();
    assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
        (0, "Object is stream.  Dictionary:\n<< /Filter /FlateDecode /Length 59 >>\n", ""));
}

#[test]
fn inspection_preserves_compressed_object_strings_and_xref_trailer_fields() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/in", include_bytes!("../../safe-bash-command-qpdf/src/fixtures/compressed-pages.pdf")).unwrap();
    let pages = shell.exec("qpdf in --show-object=1,0").unwrap();
    assert_eq!((pages.exit_code, pages.stdout.as_str(), pages.stderr.as_str()),
        (0, "<< /Count 3 /Kids [ 4 0 R 5 0 R 6 0 R ] /Type /Pages >>\n", ""));
    let info = shell.exec("qpdf in --show-object=3").unwrap();
    assert_eq!((info.exit_code, info.stderr.as_str()), (0, ""));
    let hex = "feff007000640066002d006c006900620020002800680074007400700073003a002f002f006700690074006800750062002e0063006f006d002f0048006f007000640069006e0067002f007000640066002d006c006900620029";
    for key in ["Creator", "Producer"] { assert!(info.stdout.contains(&format!("/{key} <{hex}>")), "{}", info.stdout); }
    for flag in ["", " --raw-stream-data", " --filtered-stream-data"] {
        let trailer = shell.exec(&format!("qpdf in --show-object=trailer{flag}")).unwrap();
        assert_eq!((trailer.exit_code, trailer.stderr.as_str()), (0, ""));
        assert!(trailer.stdout.starts_with("<< "));
        for field in ["/Filter /FlateDecode", "/Index [ 0 9 ]", "/Root 2 0 R", "/Size 9", "/Type /XRef", "/Length 38"] {
            assert!(trailer.stdout.contains(field), "{}", trailer.stdout);
        }
    }
}

#[test]
fn inspection_keeps_incremental_trailers_separate_from_inherited_metadata() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let mut text = String::from_utf8(document(&[(4, 0, "<< /Title (original) >>")])).unwrap()
        .replace("/Root 1 0 R >>", "/Root 1 0 R /Info 4 0 R >>");
    let previous: usize = text.rsplit_once("startxref\n").unwrap().1.lines().next().unwrap().parse().unwrap();
    let object = text.len();
    text.push_str("5 0 obj\n(updated)\nendobj\n");
    let newest = text.len();
    text.push_str(&format!("xref\n5 1\n{object:010} 00000 n \ntrailer << /Size 6 /Prev {previous} >>\nstartxref\n{newest}\n%%EOF\n"));
    // Independently checked against all three JavaScript execution paths:
    // inspection shows the physical newest trailer, not inherited Root/Info.
    let expected = format!("<< /Prev {previous} /Size 6 >>\n");
    for prefix in ["", "leading bytes\n"] {
        fs.write_file("/in", format!("{prefix}{text}").as_bytes()).unwrap();
        for flags in ["", " --raw-stream-data", " --filtered-stream-data"] {
            let result = shell.exec(&format!("qpdf in --show-object=trailer{flags}")).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, expected.as_str(), ""));
        }
        let pages = shell.exec("qpdf in --show-npages").unwrap();
        assert_eq!((pages.exit_code, pages.stdout.as_str(), pages.stderr.as_str()), (0, "1\n", ""));
        let info = shell.exec("qpdf in --show-object=4").unwrap();
        assert_eq!((info.exit_code, info.stdout.as_str(), info.stderr.as_str()), (0, "<< /Title (original) >>\n", ""));
    }
}

#[test]
fn inspection_lists_images_only_on_pages_that_have_them() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    // Same empty/image/empty page cases as the native qpdf page-display reference.
    let input = document(&[
        (2, 0, "<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 7 0 R] >>"),
        (4, 0, "<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Form 6 0 R /Again 6 0 R >> >> >>"),
        (5, 0, "<< /Subtype /Image /Width 1 /Height 2 /Length 0 >>\nstream\n\nendstream"),
        (6, 0, "<< /Subtype /Form /Resources << /XObject << /Pic#201 5 0 R >> >> /Length 0 >>\nstream\n\nendstream"),
        (7, 0, "<< /Type /Page /Parent 2 0 R >>"),
    ]);
    fs.write_file("/in", &input).unwrap();
    for (flags, expected) in [
        ("", "page 1: 3 0 R\n  content:\npage 2: 4 0 R\n  content:\npage 3: 7 0 R\n  content:\n"),
        (" --with-images", "page 1: 3 0 R\n  content:\npage 2: 4 0 R\n  images:\n    /Pic 1: 5 0 R, 1 x 2\n  content:\npage 3: 7 0 R\n  content:\n"),
    ] {
        let result = shell.exec(&format!("qpdf in --show-pages{flags}")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, expected, ""));
    }
}
