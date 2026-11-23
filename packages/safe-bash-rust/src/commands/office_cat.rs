use super::{
    BuiltinOutcome, SafeBashFs, err_out, office, office_docx, office_odf, office_pptx, ok_out,
    read_office_source, resolve_posix_path,
};

pub(super) fn run(files: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut out = String::new();
    for file in files {
        let full = resolve_posix_path(cwd, file);
        let bytes = match fs.read_file(&full) {
            Ok(bytes) => bytes,
            Err(_) => {
                return err_out(
                    &format!("Error: source file could not be loaded: {file}\n"),
                    1,
                );
            }
        };
        let lower = file.to_ascii_lowercase();
        let extension = lower
            .rsplit_once('.')
            .map_or("", |(_, extension)| extension);
        let text = match extension {
            "docx" => office_docx::read(&bytes, "txt", fs.max_input_bytes()).map(|blocks| {
                format!(
                    "\u{feff}{}",
                    office::text(&office::plain_blocks(&blocks), "\n")
                )
            }),
            "odt" | "ods" | "odp" => office_odf::read(&bytes, fs.max_input_bytes())
                .map(|blocks| office::text(&office::plain_blocks(&blocks), "\n")),
            "pptx" => office_pptx::read(&bytes, false, fs.max_input_bytes())
                .map(|slides| office_pptx::text(&slides, false)),
            "xlsx" => office::read_xlsx_text(&bytes, false, fs.max_input_bytes())
                .map(|rows| office::text(&[office::Block::Table(rows)], "\n"))
                .map_err(|error| format!("Error: conversion failed: {error}\n")),
            "rtf" => Ok(rtf(&bytes)),
            "pdf" => read_office_source(extension, &bytes, fs, None, "txt")
                .map(|(paragraphs, _)| paragraphs.join("\n") + "\n"),
            "html" | "htm" => {
                let source = String::from_utf8_lossy(&bytes);
                office::blocks(
                    source.strip_prefix('\u{feff}').unwrap_or(&source),
                    extension,
                    &[],
                    None,
                )
                .map(|blocks| office::text(&blocks, "\n"))
                .ok_or_else(|| "Error: conversion failed: document exceeds nesting limit\n".into())
            }
            _ => {
                let text = String::from_utf8_lossy(&bytes);
                Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned() + "\n")
            }
        };
        match text {
            Ok(text) => out.push_str(&text),
            Err(error) => return err_out(&error, 1),
        }
    }
    ok_out(&out)
}

fn rtf(bytes: &[u8]) -> String {
    const CP1252: &[char] = &[
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    let mut text = String::new();
    let mut groups = Vec::new();
    let mut hidden = false;
    let mut pos = 0;
    while let Some(&byte) = bytes.get(pos) {
        pos += 1;
        let mut emit = None;
        match byte {
            b'{' => groups.push(hidden),
            b'}' => hidden = groups.pop().unwrap_or(false),
            b'\\' => {
                let Some(&symbol) = bytes.get(pos) else {
                    break;
                };
                pos += 1;
                match symbol {
                    b'*' => hidden = true,
                    b'\\' | b'{' | b'}' => emit = Some(symbol),
                    b'\'' => {
                        if let Some(pair) = bytes.get(pos..pos.saturating_add(2)) {
                            emit = (pair[0] as char)
                                .to_digit(16)
                                .zip((pair[1] as char).to_digit(16))
                                .map(|(a, b)| (a * 16 + b) as u8);
                        }
                        pos = pos.saturating_add(2);
                    }
                    b'~' => emit = Some(160),
                    symbol if symbol.is_ascii_alphabetic() => {
                        let start = pos - 1;
                        while bytes.get(pos).is_some_and(u8::is_ascii_alphabetic) {
                            pos += 1;
                        }
                        let word = &bytes[start..pos];
                        let negative = bytes.get(pos) == Some(&b'-');
                        if negative {
                            pos += 1;
                        }
                        let mut parameter = 0usize;
                        while let Some(&digit) = bytes.get(pos).filter(|b| b.is_ascii_digit()) {
                            parameter = parameter
                                .saturating_mul(10)
                                .saturating_add(usize::from(digit - b'0'));
                            pos += 1;
                        }
                        if bytes.get(pos) == Some(&b' ') {
                            pos += 1;
                        }
                        if matches!(
                            word,
                            b"fonttbl"
                                | b"colortbl"
                                | b"stylesheet"
                                | b"info"
                                | b"pict"
                                | b"object"
                        ) {
                            hidden = true;
                        }
                        if word == b"bin"
                            && !negative
                            && (parameter as u64) <= 9_007_199_254_740_991
                        {
                            pos = pos.saturating_add(parameter);
                        } else if matches!(word, b"par" | b"line") {
                            emit = Some(b'\n');
                        } else if word == b"tab" {
                            emit = Some(b'\t');
                        }
                    }
                    _ => {}
                }
            }
            b'\r' | b'\n' => {}
            _ => emit = Some(byte),
        }
        if !hidden && let Some(byte) = emit {
            text.push(if (128..160).contains(&byte) {
                CP1252[usize::from(byte - 128)]
            } else {
                char::from(byte)
            });
        }
    }
    text.split('\n')
        .map(|s| s.trim_matches(office::space))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

#[cfg(test)]
mod tests {
    use super::super::cmd_soffice;
    use crate::commands::structured::{JVal, parse_json_stream, write_zip_stored};
    use crate::{MemoryVfs, SafeBashFs};

    #[test]
    fn text_operands_match_public_file_command() {
        for source in [
            include_str!("../../tests/fixtures/soffice-cat-production.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-text-production.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-export-production.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-long-production.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let field = |key| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Object(inputs) = field("inputs") else {
                panic!("inputs")
            };
            let JVal::Array(cases) = field("cases") else {
                panic!("cases")
            };
            let decode = |s: &str| {
                s.as_bytes()
                    .chunks_exact(2)
                    .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
                    .collect::<Vec<_>>()
            };
            let mut failures = Vec::new();
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
                let text = |key| match field(key) {
                    JVal::Str(s) => s.as_str(),
                    _ => panic!("text"),
                };
                let JVal::Array(args) = field("args") else {
                    panic!("args")
                };
                let args = args
                    .iter()
                    .map(|v| match v {
                        JVal::Str(s) => s.clone(),
                        _ => panic!("arg"),
                    })
                    .collect::<Vec<_>>();
                let fs = MemoryVfs::new();
                for (name, data) in inputs {
                    let JVal::Str(data) = data else {
                        panic!("input")
                    };
                    fs.write_file(&format!("/{name}"), &decode(data)).unwrap();
                }
                fs.write_file("/unrelated", b"keep").unwrap();
                if let Some((_, JVal::Str(output))) = fields.iter().find(|(k, _)| k == "output") {
                    fs.mkdir_all("/output").unwrap();
                    fs.write_file(output, b"destination sentinel").unwrap();
                }
                let result = cmd_soffice(&args, "/", &fs);
                let JVal::Number(code, _) = field("exitCode") else {
                    panic!("exitCode")
                };
                if result.exit_code != *code as i32
                    || result.stdout != text("stdout")
                    || result.stderr != text("stderr")
                {
                    failures.push(format!(
                        "{args:?}: status {}, stdout {:?}, stderr {:?}; expected {}, {:?}, {:?}",
                        result.exit_code,
                        result.stdout,
                        result.stderr,
                        code,
                        text("stdout"),
                        text("stderr")
                    ));
                }
                if let Some((_, JVal::Str(output))) = fields.iter().find(|(k, _)| k == "output") {
                    let actual = fs.read_file(output).unwrap();
                    let expected = decode(text("hex"));
                    let equal = if (output.ends_with(".docx") || output.ends_with(".xlsx"))
                        && actual.starts_with(b"PK\x03\x04")
                        && expected.starts_with(b"PK\x03\x04")
                    {
                        crate::commands::structured::read_office_archive(&actual)
                            == crate::commands::structured::read_office_archive(&expected)
                    } else {
                        actual == expected
                    };
                    if !equal {
                        failures.push(format!("{args:?}: output bytes differ"));
                    }
                }
                for (name, data) in inputs {
                    let JVal::Str(data) = data else {
                        panic!("input")
                    };
                    assert_eq!(fs.read_file(&format!("/{name}")).unwrap(), decode(data));
                }
                assert_eq!(fs.read_file("/unrelated").unwrap(), b"keep");
            }
            assert!(failures.is_empty(), "{}", failures.join("\n"));
        }
    }

    #[test]
    fn writer_cat_limits_count_text_across_files() {
        let source = write_zip_stored(&[
            ("[Content_Types].xml", b"<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"),
            ("_rels/.rels", b"<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
            (
            "word/document.xml",
            b"<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>",
        )]);
        let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
        shell.register_command(
            "writer-cat",
            std::sync::Arc::new(|context| {
                let result = cmd_soffice(context.args, context.cwd, context.fs);
                Ok(crate::CommandResult {
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exit_code: result.exit_code,
                    cwd: context.cwd.clone(),
                    env: context.env.clone(),
                })
            }),
        );
        fs.write_file("/first.docx", &source).unwrap();
        fs.write_file("/second.docx", &source).unwrap();
        fs.write_file("/first.txt", b"keep").unwrap();
        shell.set_limits(crate::budget::ShellLimits {
            max_output_bytes: 18,
            ..Default::default()
        });
        let result = shell
            .exec("writer-cat --cat /first.docx /second.docx")
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "\u{feff}hello\n\u{feff}hello\n");
        shell.set_limits(crate::budget::ShellLimits {
            max_output_bytes: 17,
            ..Default::default()
        });
        let result = shell.exec("writer-cat --cat /first.docx /second.docx");
        assert!(
            result.is_err()
                || result.is_ok_and(|result| result.exit_code != 0 && result.stdout.is_empty())
        );
        assert_eq!(fs.read_file("/first.docx").unwrap(), source);
        assert_eq!(fs.read_file("/second.docx").unwrap(), source);
        assert_eq!(fs.read_file("/first.txt").unwrap(), b"keep");
    }

    #[test]
    fn writer_text_exports_and_cat_match_public_command() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-writer-text-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let field = |key| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
        let JVal::Object(inputs) = field("inputs") else {
            panic!("inputs")
        };
        let JVal::Array(cases) = field("cases") else {
            panic!("cases")
        };
        let mut failures = Vec::new();
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let text = |key| match field(key) {
                JVal::Str(s) => s.as_str(),
                _ => panic!("text"),
            };
            let name = text("input");
            let target = text("target");
            let JVal::Object(parts) = &inputs.iter().find(|(k, _)| k == name).unwrap().1 else {
                panic!("parts")
            };
            let bytes = write_zip_stored(
                &parts
                    .iter()
                    .map(|(name, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (name.as_str(), value.as_bytes())
                    })
                    .collect::<Vec<_>>(),
            );
            let fs = MemoryVfs::new();
            let source = format!("/{name}");
            let dest = format!("/out/{}.txt", name.rsplit_once('.').unwrap().0);
            fs.mkdir_all("/out").unwrap();
            fs.write_file(&source, &bytes).unwrap();
            fs.write_file(&dest, b"old").unwrap();
            fs.write_file("/unrelated", b"keep").unwrap();
            let args = if target == "cat" {
                vec!["--cat".into(), source.clone()]
            } else {
                ["--convert-to", target, "--outdir", "/out", &source]
                    .map(String::from)
                    .to_vec()
            };
            let result = cmd_soffice(&args, "/", &fs);
            let JVal::Number(code, _) = field("exitCode") else {
                panic!("exitCode")
            };
            if result.exit_code != *code as i32
                || result.stderr != text("stderr")
                || result.stdout != text("stdout")
            {
                failures.push(format!(
                    "{name} {target}: status {}, stdout {:?}, stderr {:?}",
                    result.exit_code, result.stdout, result.stderr
                ));
            }
            let expected = if target == "cat" {
                text("stdout").as_bytes().to_vec()
            } else {
                text("hex")
                    .as_bytes()
                    .chunks_exact(2)
                    .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
                    .collect()
            };
            let actual = if target == "cat" {
                result.stdout.into_bytes()
            } else {
                fs.read_file(&dest).unwrap()
            };
            if actual != expected {
                failures.push(format!(
                    "{name} {target}: {:?} != {:?}",
                    String::from_utf8_lossy(&actual),
                    String::from_utf8_lossy(&expected)
                ));
            }
            if target == "cat" {
                assert_eq!(fs.read_file(&dest).unwrap(), b"old");
            }
            assert_eq!(fs.read_file(&source).unwrap(), bytes);
            assert_eq!(fs.read_file("/unrelated").unwrap(), b"keep");
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
