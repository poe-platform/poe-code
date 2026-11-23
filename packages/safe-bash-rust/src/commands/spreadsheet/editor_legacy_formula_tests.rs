use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

fn workbook() -> Vec<u8> {
    crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="ModernList">_xlfn.SEQUENCE(2)</definedName></definedNames></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/metadata.xml", include_bytes!("xlsx/dynamic-metadata.xml")),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1"><c r="A1"><v>0.5</v></c><c r="H1"><f t="array" ref="H1:H3">_xlfn.EXPON.DIST(A1:A3,1,TRUE)</f></c></row>
        <row r="2"><c r="A2"><v>1</v></c>
        <c r="B2"><f>_xlfn.EXPON.DIST(A:A,1,TRUE)</f></c>
        <c r="C2"><f>A:A+1</f></c><c r="D2"><f>IF(TRUE,A:A,0)</f></c>
        <c r="E2"><f>SUM(A:A)</f></c><c r="F2"><f>SUMPRODUCT(A1:A3,{1;2;3})</f></c>
        <c r="G2"><f>A1:A3</f></c>
        <c r="J2"><f>PMT(A:A,2,100)</f></c><c r="K2"><f>TEXT(A:A,"0.00")</f></c>
        <c r="L2"><f>_xlfn.BITLSHIFT(A:A,1)</f></c><c r="M2"><f>EDATE(A:A,1)</f></c>
        <c r="N2"><f>"EXPAND("&amp;A:A</f></c>
        <c r="I2" cm="1"><f>IF(A2=1,5,_xlfn.EXPON.DIST(A1:A3,1,TRUE))</f></c></row>
        <row r="3"><c r="A3"><v>2</v></c></row>
        <row r="5"><c r="B5" cm="1"><f t="array" ref="B5:B7">_xlfn.EXPON.DIST(A1:A3,1,TRUE)</f></c><c r="J5"><f>ModernList</f></c><c r="L5"><f>SUM(_xlfn.SEQUENCE(3))</f></c></row>
        </sheetData></worksheet>"#),
    ])
}
fn near(book: &Spreadsheet, row: usize, col: usize, expected: f64) {
    match book.cell(0, row, col).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => assert!(
            (n - expected).abs() < 1e-12,
            "{row},{col}: {n} != {expected}"
        ),
        _ => panic!("{row},{col}: {}", book.display(0, row, col, LIMIT).unwrap()),
    }
}

#[test]
fn legacy_scalar_formulas_and_both_array_kinds_keep_their_modes_on_import_and_roundtrip() {
    let book = Spreadsheet::import_xlsx(&workbook(), LIMIT).unwrap();
    for mut book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, n) in [
            (1, 1, 0.6321205588285577),
            (1, 2, 2.),
            (1, 3, 1.),
            (1, 4, 3.5),
            (1, 5, 8.5),
            (1, 6, 1.),
            (1, 8, 5.),
            (1, 9, -133.33333333333333),
            (1, 11, 2.),
            (1, 12, 32.),
            (4, 9, 1.),
            (5, 9, 2.),
            (4, 11, 6.),
        ] {
            near(&book, r, c, n);
        }
        for (i, n) in [0.3934693402873666, 0.6321205588285577, 0.8646647167633873]
            .into_iter()
            .enumerate()
        {
            near(&book, i, 7, n);
            near(&book, i + 4, 1, n);
        }
        assert!(book.cell(0, 2, 1).is_none());
        assert_eq!(book.display(0, 1, 10, LIMIT).unwrap(), "1.00");
        assert_eq!(book.display(0, 1, 13, LIMIT).unwrap(), "EXPAND(1");
        assert!(book.sheets[0].cells[&(1, 13)].legacy_formula);
        assert!(!book.sheets[0].cells[&(4, 9)].legacy_formula);
        book.edit(&[(0, 1, 0, "3")], LIMIT).unwrap();
        near(&book, 1, 1, 0.950212931632136);
        near(&book, 1, 2, 4.);
        near(&book, 1, 3, 3.);
        near(&book, 1, 8, 0.3934693402873666);
        near(&book, 2, 8, 0.950212931632136);
        near(&book, 3, 8, 0.8646647167633873);
    }
}

#[test]
fn editing_a_legacy_formula_enables_arrays_and_copying_preserves_implicit_intersection() {
    let mut book = Spreadsheet::import_xlsx(&workbook(), LIMIT).unwrap();
    let copied = book
        .relocate_cell(&book.sheets[0].cells[&(1, 1)], (1, 1), (2, 1), 0, LIMIT)
        .unwrap();
    book.replace_cells(vec![(0, 2, 1, Some(copied))], LIMIT)
        .unwrap();
    near(&book, 2, 1, 0.8646647167633873);
    book.edit(
        &[(0, 1, 1, "=EXPON.DIST(A1:A3,1,TRUE)"), (0, 2, 1, "")],
        LIMIT,
    )
    .unwrap();
    for (i, n) in [0.3934693402873666, 0.6321205588285577, 0.8646647167633873]
        .into_iter()
        .enumerate()
    {
        near(&book, 1 + i, 1, n);
    }
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    near(&restored, 3, 1, 0.8646647167633873);
}

#[test]
fn newly_authored_scalar_results_can_still_spill_after_excel_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 0, 2, "=IF(A1=1,5,EXPON.DIST(A1:A2,1,TRUE))"),
            (0, 1, 2, "temporary"),
        ],
        LIMIT,
    )
    .unwrap();
    for row in 0..2 {
        book.sheets[0].cells.get_mut(&(row, 2)).unwrap().format = Some("0.00".into());
    }
    book.edit(&[(0, 1, 2, "")], LIMIT).unwrap();
    let mut book = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "");
    assert_eq!(
        book.sheets[0]
            .cells
            .get(&(1, 2))
            .and_then(|c| c.format.as_deref()),
        Some("0.00")
    );
    book.edit(&[(0, 0, 0, "3")], LIMIT).unwrap();
    near(&book, 0, 2, 0.950212931632136);
    near(&book, 1, 2, 0.8646647167633873);
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "0.86");
}
