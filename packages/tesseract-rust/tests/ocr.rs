use poe_tesseract::{Limits, Model, Options, recognize};

#[test]
fn english_recognition_includes_positioned_layout() {
    let result = recognize(include_bytes!("fixtures/english.png"), &Options::default()).unwrap();
    assert!(result.text.contains("HELLO WORLD"), "{}", result.text);
    assert!(result.tsv.starts_with("level\tpage_num\tblock_num"));
    assert!(result.tsv.contains("HELLO"));
    assert!(result.hocr.contains("ocrx_word"));
    assert!(result.width > 0 && result.height > 0);
}

#[test]
fn injected_model_is_used_instead_of_implicitly_reading_host_files() {
    let options = Options {
        model: Model {
            language: "eng",
            data: b"not a traineddata file",
        },
        ..Options::default()
    };
    assert!(recognize(include_bytes!("fixtures/english.png"), &options).is_err());
}

#[test]
fn invalid_images_and_excessive_inputs_fail_before_recognition() {
    assert!(recognize(b"not an image", &Options::default()).is_err());
    let options = Options {
        limits: Limits {
            max_input_bytes: 1,
            ..Limits::default()
        },
        ..Options::default()
    };
    assert!(
        recognize(include_bytes!("fixtures/english.png"), &options)
            .unwrap_err()
            .contains("input")
    );
    let options = Options {
        limits: Limits {
            max_pixels: 1,
            ..Limits::default()
        },
        ..Options::default()
    };
    assert!(
        recognize(include_bytes!("fixtures/english.png"), &options)
            .unwrap_err()
            .contains("pixel")
    );
}

#[test]
fn invalid_language_names_are_rejected() {
    for language in ["", "../eng", "eng+kor", "eng\0"] {
        let options = Options {
            model: Model {
                language,
                data: poe_tesseract::ENGLISH,
            },
            ..Options::default()
        };
        assert!(recognize(include_bytes!("fixtures/english.png"), &options).is_err());
    }
}

fn with_model_config(config: &[u8]) -> Vec<u8> {
    let data = poe_tesseract::ENGLISH;
    let count = u32::from_le_bytes(data[..4].try_into().unwrap()) as usize;
    let header = 4 + count * 8;
    let mut model = data[..header].to_vec();
    for i in 0..count {
        let start = 4 + i * 8;
        let offset = i64::from_le_bytes(model[start..start + 8].try_into().unwrap());
        if offset >= 0 {
            model[start..start + 8].copy_from_slice(&(offset + config.len() as i64).to_le_bytes());
        }
    }
    model[4..12].copy_from_slice(&(header as i64).to_le_bytes());
    model.extend_from_slice(config);
    model.extend_from_slice(&data[header..]);
    model
}

#[test]
fn embedded_model_configuration_cannot_request_host_file_writes() {
    let model =
        with_model_config(b"tessedit_write_params_to_file /poe-ocr-nonexistent-parent/params\n");
    let error = recognize(
        include_bytes!("fixtures/english.png"),
        &Options {
            model: Model {
                language: "eng",
                data: &model,
            },
            ..Options::default()
        },
    )
    .unwrap_err();
    assert!(error.contains("configuration"), "{error}");
}

#[test]
fn official_cjk_spacing_configuration_remains_supported() {
    let model = with_model_config(b"# Language spacing\npreserve_interword_spaces 1\n");
    let result = recognize(
        include_bytes!("fixtures/english.png"),
        &Options {
            model: Model {
                language: "eng",
                data: &model,
            },
            ..Options::default()
        },
    )
    .unwrap();
    assert!(result.text.contains("HELLO WORLD"));
}

#[test]
fn malformed_model_tables_are_rejected_before_native_allocation() {
    let mut model = with_model_config(b"preserve_interword_spaces 1\n");
    // Native code uses offset differences as allocation sizes. Invalid offsets
    // must be rejected without reaching the C++ allocator.
    model[4..12].copy_from_slice(&i64::MAX.to_le_bytes());
    for data in [&[][..], &model[..]] {
        let error = recognize(
            include_bytes!("fixtures/english.png"),
            &Options {
                model: Model {
                    language: "eng",
                    data,
                },
                ..Options::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("component table"), "{error}");
    }
}
