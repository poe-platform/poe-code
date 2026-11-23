// Implicit-intersection cases adapted from IronCalc f936620 parser tests.
// See LICENSE.IronCalc. The editor always retains explicit intersections in XLSX.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn explicit_intersection_uses_position_and_array_top_left() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "3"),
            (0, 1, 0, "6"),
            (0, 2, 0, "9"),
            (0, 0, 1, "12"),
        ],
        LIMIT,
    )
    .unwrap();
    for (f, expected) in [
        ("=@A1:A3", "6"),
        ("=@A1:A3+12", "18"),
        ("=-@A1:A3^2", "36"),
        ("=@A1:A3%", "6.00%"),
        ("=@(A1:A3*2)", "6"),
        ("=SUM(@A1:A3)", "6"),
        ("=@A:A", "6"),
        ("=@{4,5;6,7}", "4"),
        ("=@SEQUENCE(3)", "1"),
        ("=LET(items,A1:A3,@items)", "6"),
        ("=LET(items,{7,8},@items)", "7"),
        ("=@A1:B3", "#VALUE!"),
        ("=@A3:A5", "#VALUE!"),
        ("=@#N/A", "#N/A"),
        ("=@TRUE", "TRUE"),
        ("=@Z1:Z3", "0"),
        ("=LEN(@Z1:Z3)", "0"),
        ("=COLUMNS(@A1:A3)", "1"),
        ("=ISREF(@A1:A3)", "TRUE"),
        ("=ROW(@A1:A3)", "2"),
        ("=ISFORMULA(@A1:A3)", "FALSE"),
    ] {
        b.edit(&[(0, 1, 3, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 1, 3, LIMIT).unwrap(), expected, "{f}");
        assert_eq!(b.display(0, 2, 3, LIMIT).unwrap(), "", "no spill for {f}");
    }
}

#[test]
fn explicit_intersection_excel_spelling_preserves_binding() {
    use super::formulas::xlsx_variables;
    for (source, expected) in [
        ("@A1:A3+12", "_xlfn.SINGLE(A1:A3)+12"),
        ("SUM(@A1:A3)", "SUM(_xlfn.SINGLE(A1:A3))"),
        ("LCM(A1,B1,@J:J)", "LCM(A1,B1,_xlfn.SINGLE(J:J))"),
        ("-@A1:A3^2", "-_xlfn.SINGLE(A1:A3)^2"),
        ("@A1:A3%", "_xlfn.SINGLE(A1:A3)%"),
        (
            "@(@A1:A3+@B1:B3)",
            "_xlfn.SINGLE((_xlfn.SINGLE(A1:A3)+_xlfn.SINGLE(B1:B3)))",
        ),
        ("@A1#", "_xlfn.SINGLE(A1#)"),
        (
            "LET(items,A1:A3,@items)",
            "LET(_xlpm.items,A1:A3,_xlfn.SINGLE(_xlpm.items))",
        ),
        (
            "LAMBDA(items,@items)(A1:A3)",
            "LAMBDA(_xlpm.items,_xlfn.SINGLE(_xlpm.items))(A1:A3)",
        ),
        ("SUM(@Orders[Amount])", "SUM(_xlfn.SINGLE(Orders[Amount]))"),
        ("SUM(Orders[@Amount])", "SUM(Orders[@Amount])"),
        ("@'a@b'!A1:A3", "_xlfn.SINGLE('a@b'!A1:A3)"),
        ("\"a@b\"", "\"a@b\""),
    ] {
        assert_eq!(
            xlsx_variables(source, &mut { LIMIT }).unwrap(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn explicit_intersections_survive_excel_without_private_formula_metadata() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Units"),
            (0, 1, 0, "3"),
            (0, 2, 0, "6"),
            (0, 3, 0, "9"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Orders", [0, 0, 3, 0], LIMIT).unwrap();
    b.options.names.push(super::NamedExpression {
        name: "Selected".into(),
        expression: "=@Orders[Units]".into(),
        sheet: None,
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    b.edit(
        &[
            (0, 2, 2, "=LET(items,Orders[Units],@items)"),
            (0, 2, 3, "=Selected"),
            (0, 2, 4, "=ROW(@Orders[Units])"),
            (0, 5, 0, "=SEQUENCE(3,1,10)"),
            (0, 6, 2, "=@A6#"),
            (0, 2, 5, "=LAMBDA(items,@items)(Orders[Units])"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 2, 3, LIMIT).unwrap(), "6", "before export");
    let bytes = b.export_xlsx(LIMIT).unwrap();
    let mut archive = crate::commands::structured::read_office_archive(&bytes);
    let sheet = std::str::from_utf8(&archive["xl/worksheets/sheet1.xml"]).unwrap();
    assert!(sheet.contains("_xlfn.SINGLE(_xlpm.items)"), "{sheet}");
    assert!(
        sheet.contains("_xlfn.SINGLE(_xlfn.ANCHORARRAY(A6))"),
        "{sheet}"
    );
    let workbook = std::str::from_utf8(&archive["xl/workbook.xml"]).unwrap();
    assert!(
        workbook.contains("_xlfn.SINGLE(Orders[Units])"),
        "{workbook}"
    );
    for bytes in archive.values_mut() {
        let Ok(text) = std::str::from_utf8(bytes) else {
            continue;
        };
        // Make the import rely exclusively on standard Excel formulas.
        let text = text.replace("ssc:openformula=", "ssc:ignored=");
        *bytes = text.into_bytes();
    }
    let entries: Vec<_> = archive
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    let standard = office_package_rust::write_zip_stored(&entries);
    for (stage, mut reopened) in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&standard, LIMIT).unwrap(),
    ]
    .into_iter()
    .enumerate()
    {
        for (r, c, e) in [
            (2, 2, "6"),
            (2, 3, "6"),
            (2, 4, "3"),
            (6, 2, "11"),
            (2, 5, "6"),
        ] {
            assert_eq!(
                reopened.display(0, r, c, LIMIT).unwrap(),
                e,
                "stage {stage}: {r},{c}"
            );
        }
        reopened.edit(&[(0, 2, 0, "12")], LIMIT).unwrap();
        assert_eq!(reopened.display(0, 2, 2, LIMIT).unwrap(), "12");
        reopened.rename_table(0, "Stock", LIMIT).unwrap();
        assert_eq!(reopened.display(0, 2, 3, LIMIT).unwrap(), "12");
        reopened.edit_axis(0, false, 1, 1, LIMIT).unwrap();
        assert_eq!(reopened.display(0, 3, 2, LIMIT).unwrap(), "12");
        assert_eq!(reopened.display(0, 3, 4, LIMIT).unwrap(), "4");
    }
}

#[test]
fn explicit_intersection_copy_tracks_relative_references_and_quoted_at() {
    let mut b = Spreadsheet::new();
    b.add_sheet("a@b").unwrap();
    b.edit(
        &[
            (1, 0, 0, "10"),
            (1, 1, 0, "20"),
            (1, 2, 0, "30"),
            (0, 0, 1, "=LET(items,'a@b'!$A1:$A3,@items)"),
            (0, 0, 2, "=\"a@b\""),
        ],
        LIMIT,
    )
    .unwrap();
    let copied = b
        .relocate_cell(&b.cell(0, 0, 1).unwrap(), (0, 1), (1, 1), 0, LIMIT)
        .unwrap();
    assert_eq!(
        copied.formula.as_deref(),
        Some("_xlfn.LET(items,'a@b'!$A2:$A4,@items)")
    );
    b.replace_cells(vec![(0, 1, 1, Some(copied))], LIMIT)
        .unwrap();
    assert_eq!(b.display(0, 1, 1, LIMIT).unwrap(), "20");
    b.rename_sheet(1, "New@Name", LIMIT).unwrap();
    assert_eq!(b.display(0, 1, 1, LIMIT).unwrap(), "20");
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "a@b");
    assert!(b.input(0, 1, 1).contains("New@Name"));
}

#[test]
fn explicit_intersection_whole_column_stays_sparse_and_limits_roll_back() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 999999, 0, "42"),
            (0, 999999, 1, "=@A:A"),
            (0, 999999, 2, "=ROW(@A:A)"),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(b.display(0, 999999, 1, LIMIT).unwrap(), "42");
    assert_eq!(b.display(0, 999999, 2, LIMIT).unwrap(), "1000000");
    let before = b.to_json();
    assert!(
        b.edit(
            &[(0, 999999, 0, "99"), (0, 0, 3, "=@SEQUENCE(1000000)")],
            100_000
        )
        .is_err()
    );
    assert_eq!(b.to_json(), before);
    let nested = format!("={}1", "@".repeat(100));
    assert!(b.edit(&[(0, 0, 3, &nested)], LIMIT).is_err());
    assert_eq!(b.to_json(), before);
    assert!(super::formulas::xlsx_variables("SUM(@A:A)", &mut 1).is_none());
}
