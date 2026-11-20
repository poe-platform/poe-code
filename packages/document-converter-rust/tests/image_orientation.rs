use document_converter_rust::{Format, convert};

fn request(mode: &str, content: &str, bytes: &[u8]) -> Vec<u8> {
    let field = if mode == "html" {
        format!("\"html\":\"{content}\"")
    } else {
        format!("\"document\":{{\"metadata\":{{}},\"blocks\":{content}}}")
    };
    let json = format!(
        r#"{{"mode":"{mode}",{field},"resources":[{{"id":"picture","offset":0,"length":{}}}]}}"#,
        bytes.len()
    );
    let mut framed = (json.len() as u32).to_le_bytes().to_vec();
    framed.extend(json.bytes());
    framed.extend(bytes);
    framed
}

fn pandoc(attributes: &str) -> String {
    format!(
        r#"[{{"t":"Para","c":[{{"t":"Image","c":[["",[],[{attributes}]],[],["picture",""]]}}]}}]"#
    )
}

#[test]
fn pdf_html_and_pandoc_use_oriented_natural_geometry_but_word_keeps_original_axes() {
    macro_rules! cases { ($($n:literal),*) => { [$(
        (include_bytes!(concat!("../../pdf-ast-rust/tests/fixtures/orientation/",$n,".png")).as_slice(), $n),
        (include_bytes!(concat!("../../pdf-ast-rust/tests/fixtures/orientation/",$n,".jpg")).as_slice(), $n),
        (include_bytes!(concat!("../../pdf-ast-rust/tests/fixtures/orientation/",$n,".tiff")).as_slice(), $n),
    )*] }; }
    for (bytes, orientation) in cases!(1, 2, 3, 4, 5, 6, 7, 8) {
        for format in [Format::Pdf, Format::Docx] {
            let (w, h) = if format == Format::Pdf && orientation >= 5 {
                (40, 60)
            } else {
                (60, 40)
            };
            for (mode, implicit, explicit) in [
                (
                    "html",
                    "<p><img src='picture'></p>".into(),
                    format!("<p><img src='picture' width='{w}' height='{h}'></p>"),
                ),
                (
                    "html",
                    "<p><img src='picture' width='120'></p>".into(),
                    format!(
                        "<p><img src='picture' width='120' height='{}'></p>",
                        120 * h / w
                    ),
                ),
                (
                    "pandoc",
                    pandoc(""),
                    pandoc(&format!(
                        r#"["width","{}px"],["height","{}px"]"#,
                        if format == Format::Docx {
                            w as f64 * 4. / 3.
                        } else {
                            w as f64
                        },
                        if format == Format::Docx {
                            h as f64 * 4. / 3.
                        } else {
                            h as f64
                        }
                    )),
                ),
                (
                    "pandoc",
                    pandoc(r#"["width","120px"]"#),
                    pandoc(&format!(
                        r#"["width","120px"],["height","{}px"]"#,
                        120 * h / w
                    )),
                ),
                (
                    "pandoc",
                    r#"[{"t":"RawBlock","c":["html","<p><img src='picture' width='120'></p>"]}]"#
                        .into(),
                    format!(
                        r#"[{{"t":"RawBlock","c":["html","<p><img src='picture' width='120' height='{}'></p>"]}}]"#,
                        120 * h / w
                    ),
                ),
            ] {
                let actual = convert(&request(mode, &implicit, bytes), format)
                    .unwrap()
                    .bytes;
                let expected = convert(&request(mode, &explicit, bytes), format)
                    .unwrap()
                    .bytes;
                assert!(
                    actual == expected,
                    "{format:?} {mode} orientation {orientation}: {implicit}"
                );
            }
        }
    }
}
