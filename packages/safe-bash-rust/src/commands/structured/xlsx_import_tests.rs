use super::*;

#[test]
fn xlsx_archive_validates_the_directory_crc_and_aggregate_expansion() {
    let original = include_bytes!("../../../tests/fixtures/xml-prefixes.xlsx");
    assert!(read_xlsx_all_sheets(&original[..original.len() - 22], "Sheet1", ["FALSE", "TRUE"], 65536).is_err());
    assert!(read_xlsx_all_sheets(original, "Sheet1", ["FALSE", "TRUE"], 1024).unwrap_err().contains("input limit"));
    let expanded = include_bytes!("../../../tests/fixtures/expanded-workbook.xlsx");
    assert!(expanded.len() < 8192);
    assert!(read_xlsx_all_sheets(expanded, "Sheet1", ["FALSE", "TRUE"], 8192).unwrap_err().contains("input limit"));
    let streamed = include_bytes!("../../../tests/fixtures/streamed-workbook.xlsx");
    let sheets = read_xlsx_all_sheets(streamed, "Sheet1", ["FALSE", "TRUE"], 65536).unwrap();
    assert_eq!(sheets[0].rows[1], ["café 🚀 & <tag>", " lead bold tail "]);
    let mut crc = original.to_vec();
    let central = crc.windows(4).position(|bytes| bytes == b"PK\x01\x02").unwrap();
    let local = u32::from_le_bytes(crc[central + 42..central + 46].try_into().unwrap()) as usize;
    crc[central + 16] ^= 1;
    crc[local + 14] ^= 1;
    assert!(read_xlsx_all_sheets(&crc, "Sheet1", ["FALSE", "TRUE"], 65536).unwrap_err().contains("CRC32"));
}

#[test]
fn xlsx_xml_part_failures_preserve_exports() {
    let source = include_bytes!("../../../tests/fixtures/xml-prefixes.xlsx");
    for part in ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"] {
        let mut entries = read_office_archive(source);
        entries.insert(part.to_string(), b"<broken>".to_vec());
        let bytes = write_zip_stored(&entries.iter().map(|(name, bytes)| (name.as_str(), bytes.as_slice())).collect::<Vec<_>>());
        let fs = crate::MemoryVfs::new();
        fs.write_file("/input.xlsx", &bytes).unwrap();
        fs.write_file("/output", b"saved export").unwrap();
        for (command, args) in [("ssconvert", vec!["/input.xlsx", "/output"]), ("pandoc", vec!["-f", "xlsx", "-t", "json", "/input.xlsx", "-o", "/output"]), ("in2csv", vec!["/input.xlsx"])] {
            let args = args.into_iter().map(String::from).collect::<Vec<_>>();
            let result = try_run_structured_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "{command} accepted malformed {part}");
            assert_eq!(fs.read_file("/output").unwrap(), b"saved export");
            assert!(result.stdout.is_empty());
        }
    }
}

#[test]
fn xlsx_selection_uses_active_view_names_and_checks_every_name_before_publication() {
    let fs = crate::MemoryVfs::new();
    fs.write_file("/input.xlsx", include_bytes!("../../../tests/fixtures/selected-sheets.xlsx")).unwrap();
    for (options, expected) in [(vec![], "Step,Due\nShip,Friday\n"), (vec!["-O", "sheet=STRASSE"], "Unicode\n"), (vec!["-O", "sheet=plan"], "Item,Owner\nPrototype,Ada\n")] {
        let args = options.into_iter().chain(["/input.xlsx", "/output.csv"]).map(String::from).collect::<Vec<_>>();
        let result = try_run_structured_command("ssconvert", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.read_file("/output.csv").unwrap(), expected.as_bytes());
    }
    fs.write_file("/out-0.csv", b"saved export").unwrap();
    let args = ["-S", "-O", "sheet=Plan sheet=Missing", "/input.xlsx", "/out-%n.csv"].map(String::from);
    let result = try_run_structured_command("ssconvert", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(fs.read_file("/out-0.csv").unwrap(), b"saved export");
}

#[test]
fn xlsx_boolean_formatting_applies_only_to_boolean_cells() {
    let xml = r#"<worksheet><sheetData><row><c t="b"><v>1</v></c><c t="inlineStr"><is><t>True</t></is></c><c t="b"><v>0</v></c><c t="s"><v>0</v></c></row></sheetData></worksheet>"#;
    for spelling in [["FALSE", "TRUE"], ["false", "true"], ["False", "True"]] {
        assert_eq!(parse_xlsx_worksheet_xml(xml, &["False".into()], spelling, &mut 8192).unwrap(), vec![vec![spelling[1], "True", spelling[0], "False"]]);
    }
}

#[test]
fn xlsx_selection_bounds_repeated_sheet_storage_before_publishing() {
    let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
    shell.set_limits(crate::budget::ShellLimits { max_input_bytes: 700, ..Default::default() });
    fs.write_file("/input.csv", b"Label\nValue\n").unwrap();
    fs.write_file("/output.txt", b"saved export").unwrap();
    let options = "sheet=input.csv ".repeat(8);
    let result = shell.exec(&format!("ssconvert -O '{options}' /input.csv /output.txt")).unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stderr, "ssconvert: selected sheets exceed input limit\n");
    assert_eq!(fs.read_file("/output.txt").unwrap(), b"saved export");
}
