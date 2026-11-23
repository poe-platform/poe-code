use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn randarray_defaults_coercion_and_errors() {
    let mut b = Spreadsheet::new();
    for (formula, expected) in [
        ("=RANDARRAY(1,1,7,7)", "7"),
        ("=RANDARRAY(,,7,7,)", "7"),
        ("=RANDARRAY(1,1,7,7,TRUE)", "7"),
        ("=RANDARRAY(1,1,7,7,\"TRUE\")", "7"),
        ("=RANDARRAY(1,1,7,7,\"FALSE\")", "7"),
        ("=RANDARRAY(1,1,7,7,\"bad\")", "#VALUE!"),
        ("=RANDARRAY(1,1,1.5,2,TRUE)", "#VALUE!"),
        ("=RANDARRAY(1,1,-2,-1.5,TRUE)", "#VALUE!"),
        ("=RANDARRAY(1,1,2,1)", "#VALUE!"),
        ("=RANDARRAY(0)", "#CALC!"),
        ("=RANDARRAY(-0.5)", "#VALUE!"),
        ("=RANDARRAY(0.5)", "#CALC!"),
        ("=RANDARRAY(Z1)", "#CALC!"),
        ("=RANDARRAY(FALSE)", "#CALC!"),
        ("=RANDARRAY(\"bad\")", "#VALUE!"),
        ("=RANDARRAY(1048577)", "#VALUE!"),
        ("=RANDARRAY(1,16385)", "#VALUE!"),
        ("=RANDARRAY(1000,1001)", "#ERROR!"),
        ("=RANDARRAY(1,1,0,1,TRUE,1)", "#ERROR!"),
        ("=RANDARRAY(#N/A)", "#N/A"),
        ("=RANDARRAY(1,1,#DIV/0!)", "#DIV/0!"),
        ("=RANDARRAY(1,1,0,1,#REF!)", "#REF!"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn randarray_values_are_bounded_and_integer_modes_include_both_endpoints() {
    let mut b = Spreadsheet::new();
    for (formula, min, max, integer) in [
        ("=RANDARRAY(32,16)", 0., 1., false),
        ("=RANDARRAY(32,16,-5,10)", -5., 10., false),
        ("=RANDARRAY(32,16,-1,0,TRUE)", -1., 0., true),
        ("=RANDARRAY(32,16,-1E308,1E308)", -1e308, 1e308, false),
        ("=RANDARRAY(32,16,-1E308,1E308,TRUE)", -1e308, 1e308, true),
        ("=RANDARRAY(32,16,1E308,1E308,TRUE)", 1e308, 1e308, true),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let mut seen = std::collections::BTreeSet::new();
        for r in 0..32 {
            for c in 0..16 {
                let Some(Value::Number(n)) = b.cell(0, r, c).and_then(|c| c.value.clone()) else {
                    panic!("{formula}: nonnumber at {r},{c}")
                };
                assert!(n.is_finite() && n >= min && n <= max, "{formula}: {n}");
                if integer {
                    assert_eq!(n.fract(), 0.);
                }
                seen.insert(n.to_bits());
            }
        }
        if min == -1. {
            assert_eq!(seen.len(), 2);
        } // Failure probability < 2^-510.
        if min == 0. {
            assert!(seen.len() > 500);
        }
    }
}

#[test]
fn randarray_spill_dependencies_stay_consistent_and_render_does_not_resample() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=C2*4"),
            (0, 0, 2, "=RANDARRAY(3,4)"),
            (0, 5, 0, "=SUM(C1#)"),
        ],
        LIMIT,
    )
    .unwrap();
    let Some(Value::Number(n)) = b.cell(0, 1, 2).and_then(|c| c.value.clone()) else {
        panic!()
    };
    assert!(matches!(b.cell(0,0,0).and_then(|c|c.value.clone()),Some(Value::Number(v)) if v==n*4.));
    let first = b.display(0, 1, 2, LIMIT).unwrap();
    for _ in 0..10 {
        assert_eq!(b.display(0, 1, 2, LIMIT).unwrap(), first);
    }
    b.edit(&[(0, 10, 0, "new edit")], LIMIT).unwrap();
    assert!(matches!(b.cell(0,1,2).and_then(|c|c.value.clone()),Some(Value::Number(v)) if v!=n));
    let Some(Value::Number(n)) = b.cell(0, 1, 2).and_then(|c| c.value.clone()) else {
        panic!()
    };
    assert!(matches!(b.cell(0,0,0).and_then(|c|c.value.clone()),Some(Value::Number(v)) if v==n*4.));
}

#[test]
fn randarray_spills_resize_and_preserve_obstructions() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "2"),
            (0, 0, 2, "=RANDARRAY(A1,2,7,7)"),
            (0, 1, 3, "occupied"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "#SPILL!");
    b.edit(&[(0, 1, 3, "")], LIMIT).unwrap();
    assert_eq!(b.display(0, 1, 3, LIMIT).unwrap(), "7");
    b.edit(&[(0, 0, 0, "1")], LIMIT).unwrap();
    assert_eq!(b.display(0, 1, 3, LIMIT).unwrap(), "");
    b.edit(&[(0, 0, 2, "=@RANDARRAY(2,2,7,7)")], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "7");
    assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), "");
}

#[test]
fn randarray_budget_failure_is_atomic_and_roundtrips_keep_formulas() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "=RANDARRAY(2,3,7,7)")], LIMIT).unwrap();
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=RANDARRAY(1000000)")], 100_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
    for reopened in [
        Spreadsheet::from_json(&before, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(reopened.display(0, 1, 2, LIMIT).unwrap(), "7");
        assert!(reopened.input(0, 0, 0).contains("RANDARRAY"));
    }
}

#[test]
fn randarray_excel_empty_formula_cache_markers_are_not_authored_spill_obstructions() {
    for (follower, expected) in [("<f ca=\"1\"/>", "7"), ("<f>5</f>", "#SPILL!")] {
        let sheet = format!(
            r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A2">_xlfn.RANDARRAY(2,1,7,7)</f><v>7</v></c></row><row r="2"><c r="A2">{follower}<v>7</v></c></row></sheetData></worksheet>"#
        );
        let bytes=crate::commands::structured::write_zip_stored(&[
            ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
            ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>"#),
            ("_rels/.rels",include_bytes!("xlsx/root.rels")),
            ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
            ("xl/metadata.xml",include_bytes!("xlsx/dynamic-metadata.xml")),
            ("xl/worksheets/sheet1.xml",sheet.as_bytes()),
        ]);
        let b = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected);
        assert_eq!(
            b.display(0, 1, 0, LIMIT).unwrap(),
            if expected == "7" { "7" } else { "5" }
        );
    }
}

#[test]
fn rand_and_randbetween_validate_arity_types_and_integer_intervals() {
    let mut b = Spreadsheet::new();
    for (formula, expected) in [
        ("=RAND(1)", "#ERROR!"),
        ("=RAND(1,2)", "#ERROR!"),
        ("=RANDBETWEEN()", "#ERROR!"),
        ("=RANDBETWEEN(1)", "#ERROR!"),
        ("=RANDBETWEEN(1,2,3)", "#ERROR!"),
        ("=RANDBETWEEN(3,1)", "#NUM!"),
        ("=RANDBETWEEN(1.1,1.9)", "#NUM!"),
        ("=RANDBETWEEN(-1.9,-1.1)", "#NUM!"),
        ("=RANDBETWEEN(1.1,2.9)", "2"),
        ("=RANDBETWEEN(-2.9,-1.1)", "-2"),
        ("=RANDBETWEEN(,0)", "0"),
        ("=RANDBETWEEN(Z1,0)", "0"),
        ("=RANDBETWEEN(\"2\",\"2\")", "2"),
        ("=RANDBETWEEN(\"bad\",3)", "#VALUE!"),
        ("=RANDBETWEEN(TRUE,3)", "#VALUE!"),
        ("=RANDBETWEEN(1,FALSE)", "#VALUE!"),
        ("=RANDBETWEEN(\"TRUE\",3)", "#VALUE!"),
        ("=RANDBETWEEN(#N/A,3)", "#N/A"),
        ("=RANDBETWEEN(1,#DIV/0!)", "#DIV/0!"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn rand_and_randbetween_broadcast_and_preserve_element_errors() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=RANDBETWEEN({1.1;#N/A;TRUE},{2.9,1.9})"),
            (0, 4, 0, "=RANDBETWEEN({-2.9,-1.9},{-1.1,-1.1})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 0, "2"),
        (0, 1, "#NUM!"),
        (1, 0, "#N/A"),
        (1, 1, "#N/A"),
        (2, 0, "#VALUE!"),
        (2, 1, "#VALUE!"),
        (4, 0, "-2"),
        (4, 1, "#NUM!"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
    for restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), "2");
        assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "#N/A");
    }
}

#[test]
fn rand_values_are_independent_but_let_and_references_reuse_their_result() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=RAND()"),
            (0, 0, 1, "=A1*4"),
            (0, 0, 2, "=LET(x,RAND(),x=x)"),
            (0, 0, 3, "=LET(x,RAND(),y,RAND(),x=y)"),
            (0, 2, 0, "=MAKEARRAY(33,16,LAMBDA(r,c,RAND()))"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "TRUE");
    assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), "FALSE");
    let mut seen = std::collections::BTreeSet::new();
    for r in 2..35 {
        for c in 0..16 {
            let Some(Value::Number(n)) = b.cell(0, r, c).and_then(|c| c.value.clone()) else {
                panic!("{r},{c}")
            };
            assert!((0.0..1.0).contains(&n));
            seen.insert(n.to_bits());
        }
    }
    assert!(seen.len() > 520);
    let Some(Value::Number(n)) = b.cell(0, 0, 0).and_then(|c| c.value.clone()) else {
        panic!()
    };
    assert!(matches!(b.cell(0,0,1).and_then(|c|c.value.clone()),Some(Value::Number(v)) if v==n*4.));
    let first = b.display(0, 0, 0, LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), first);
    b.edit(&[(0, 40, 0, "change")], LIMIT).unwrap();
    assert_ne!(b.display(0, 0, 0, LIMIT).unwrap(), first);
}

#[test]
fn randbetween_extreme_and_fractional_bounds_never_escape_the_interval() {
    let mut b = Spreadsheet::new();
    for (min, max) in [
        (-1e308, 1e308),
        (-1.9, 1.9),
        (1.9, 2.1),
        (-2.1, -1.9),
        (1e308, 1e308),
    ] {
        let formula = format!("=RANDBETWEEN(SEQUENCE(33,16,0,0)+({min}),{max})");
        b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        for r in 0..33 {
            for c in 0..16 {
                let Some(Value::Number(n)) = b.cell(0, r, c).and_then(|c| c.value.clone()) else {
                    panic!("{formula}: {r},{c}")
                };
                assert!(
                    n.is_finite() && n >= min && n <= max && n.fract() == 0.,
                    "{formula}: {n}"
                );
            }
        }
    }
    let before = b.to_json();
    assert!(
        b.edit(
            &[(0, 0, 0, "=RANDBETWEEN(SEQUENCE(1000000),1000000)")],
            100_000
        )
        .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn randbetween_propagates_argument_errors_before_coercion_errors() {
    let mut b = Spreadsheet::new();
    for (formula, expected) in [
        ("=RANDBETWEEN(TRUE,#N/A)", "#N/A"),
        ("=RANDBETWEEN(\"bad\",#DIV/0!)", "#DIV/0!"),
        ("=RANDBETWEEN(#REF!,#N/A)", "#REF!"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}
