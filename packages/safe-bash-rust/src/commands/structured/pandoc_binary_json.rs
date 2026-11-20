//! Native JSON input uses the same canonical mapper as the portable converter.
use super::super::archive::base64_decode;
use crate::vfs::{SafeBashFs, resolve_posix_path};
use document_converter_rust::{
    Format,
    html::{HtmlToken, html_tokens},
};
use mcp_protocol_rust::json::{self, Value};
use std::collections::{BTreeMap, BTreeSet};

fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn object(entries: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
fn text(value: &Value) -> Result<String, String> {
    let Value::String(units) = value else {
        return Err("E_AST: Expected string".into());
    };
    String::from_utf16(units).map_err(|_| "E_ENCODING: Invalid Unicode string".into())
}
fn content(value: &Value) -> Result<&[Value], String> {
    let Some(Value::Array(values)) = value.get("c") else {
        return Err("E_AST: Expected content array".into());
    };
    Ok(values)
}
fn field_mut<'a>(value: &'a mut Value, key: &str) -> Option<&'a mut Value> {
    let Value::Object(fields) = value else {
        return None;
    };
    fields
        .iter_mut()
        .find(|(name, _)| name.iter().copied().eq(key.encode_utf16()))
        .map(|(_, value)| value)
}
fn node(kind: &str, content: Value) -> Value {
    object([("t", string(kind)), ("c", content)])
}

// Raw content is processed before discovering resources. Escaped markup must
// never acquire image-read capabilities, and descriptive image text is not rendered.
fn prepare(value: &mut Value, policy: Option<&str>, strip_comments: bool) -> Result<(), String> {
    let kind = value.get("t").map(text).transpose()?;
    if kind.as_deref() == Some("Image") {
        return Ok(());
    }
    if matches!(kind.as_deref(), Some("RawBlock" | "RawInline")) {
        let values = content(value)?;
        let format = text(values.first().ok_or("E_AST: Missing raw format")?)?;
        let mut source = text(values.get(1).ok_or("E_AST: Missing raw content")?)?;
        if strip_comments && matches!(format.as_str(), "html" | "html5") {
            super::pandoc_raw_inline::strip_html_comments(&mut source);
        }
        if !source.is_empty() && policy == Some("reject") {
            return Err("E_CAPABILITY: Raw content rejected by output policy".into());
        }
        *value = if policy == Some("escape") {
            let inline = node("Str", string(&source));
            if kind.as_deref() == Some("RawBlock") {
                node("Para", Value::Array(vec![inline]))
            } else {
                inline
            }
        } else {
            node(
                kind.as_deref().unwrap(),
                Value::Array(vec![
                    string(if format == "html5" { "html" } else { &format }),
                    string(&source),
                ]),
            )
        };
        return Ok(());
    }
    match value {
        Value::Array(values) => {
            for value in values {
                prepare(value, policy, strip_comments)?;
            }
        }
        Value::Object(fields) => {
            for (_, value) in fields {
                prepare(value, policy, strip_comments)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn sources(
    value: &Value,
    result: &mut BTreeSet<String>,
    count: &mut usize,
    maximum: usize,
) -> Result<(), String> {
    *count = count.saturating_add(1);
    if *count > maximum {
        return Err("E_LIMIT: Document node limit exceeded".into());
    }
    match value.get("t").map(text).transpose()?.as_deref() {
        Some("Image") => {
            let target = content(value)?
                .get(2)
                .ok_or("E_AST: Missing image target")?;
            let Value::Array(target) = target else {
                return Err("E_AST: Invalid image target".into());
            };
            result.insert(text(target.first().ok_or("E_AST: Missing image source")?)?);
            return Ok(());
        }
        Some("RawBlock" | "RawInline") => {
            let values = content(value)?;
            if text(values.first().ok_or("E_AST: Missing raw format")?)? == "html" {
                for (_, token) in
                    html_tokens(&text(values.get(1).ok_or("E_AST: Missing raw content")?)?)?
                {
                    if let HtmlToken::Open(scope) = token
                        && let Some(source) = scope.image_source()
                    {
                        result.insert(source.into());
                        if result.len() > maximum {
                            return Err("E_LIMIT: Document resource limit exceeded".into());
                        }
                    }
                }
            }
            return Ok(());
        }
        _ => {}
    }
    match value {
        Value::Array(values) => {
            for value in values {
                sources(value, result, count, maximum)?;
            }
        }
        Value::Object(fields) => {
            for (_, value) in fields {
                sources(value, result, count, maximum)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn resources(
    documents: &[&Value],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let limits = fs.shell_limits();
    let mut sources_set = BTreeSet::new();
    let mut count = 0;
    for document in documents {
        sources(
            document,
            &mut sources_set,
            &mut count,
            limits.max_parse_units,
        )?;
    }
    read_resources(sources_set, cwd, fs)
}

pub(super) fn read_resources(
    sources_set: BTreeSet<String>,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let limits = fs.shell_limits();
    let mut resources = BTreeMap::new();
    let mut retained = 0usize;
    for source in sources_set {
        let bytes = if source.starts_with("data:") {
            let (header, encoded) = source.split_once(',').ok_or("Invalid image data URL")?;
            if !header.starts_with("data:image/") || !header.ends_with(";base64") {
                return Err("Images must use base64 image data URLs".into());
            }
            // The encoded length bounds decoding before its allocation.
            if encoded.len() > limits.max_input_bytes
                || encoded.len() > limits.max_memory_bytes.saturating_sub(retained)
            {
                return Err("E_LIMIT: Document resource byte limit exceeded".into());
            }
            base64_decode(encoded)?
        } else {
            if source.contains("://") || source.starts_with("//") {
                return Err("Remote images must be explicitly embedded before export".into());
            }
            let path = resolve_posix_path(cwd, &source);
            let size = fs
                .stat(&path)
                .map_err(|error| format!("Image {source}: {error}"))?
                .size;
            if size > limits.max_input_bytes
                || size > limits.max_memory_bytes.saturating_sub(retained)
            {
                return Err("E_LIMIT: Document resource byte limit exceeded".into());
            }
            fs.read_file(&path)
                .map_err(|error| format!("Image {source}: {error}"))?
        };
        if bytes.len() > limits.max_input_bytes
            || bytes.len() > limits.max_memory_bytes.saturating_sub(retained)
        {
            return Err("E_LIMIT: Document resource byte limit exceeded".into());
        }
        retained += bytes.len();
        resources.insert(source, bytes);
    }
    Ok(resources)
}

pub(super) fn canonical_value(value: super::JVal) -> Value {
    use super::JVal;
    match value {
        JVal::Null => Value::Null,
        JVal::Bool(value) => Value::Bool(value),
        JVal::Number(value, _) => Value::Number(value),
        JVal::Str(value) => Value::String(value.encode_utf16().collect()),
        JVal::Array(values) => Value::Array(values.into_iter().map(canonical_value).collect()),
        JVal::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key.encode_utf16().collect(), canonical_value(value)))
                .collect(),
        ),
    }
}

// Move the existing JSON value into the canonical mapper without serializing,
// reparsing, or charging generated bytes as external input.
pub(super) fn binary_document(
    blocks: &[super::PandocBlock],
    metadata: &[(String, super::JVal)],
) -> Value {
    use super::JVal;
    Value::Object(vec![
        (
            "blocks".encode_utf16().collect(),
            canonical_value(super::pandoc_blocks_to_json(blocks)),
        ),
        (
            "metadata".encode_utf16().collect(),
            canonical_value(JVal::Object(metadata.to_vec())),
        ),
    ])
}

pub(super) fn convert(
    inputs: &[Vec<u8>],
    format: &str,
    metadata: &BTreeMap<String, String>,
    policy: Option<&str>,
    strip_comments: bool,
    shift_heading: i32,
    number_sections: bool,
    cwd: &str,
    fs: &dyn SafeBashFs,
    output_limit: usize,
) -> Result<Vec<u8>, String> {
    let limits = fs.shell_limits();
    if inputs
        .iter()
        .try_fold(0usize, |sum, input| sum.checked_add(input.len()))
        .is_none_or(|sum| sum > limits.max_input_bytes)
    {
        return Err(fs.limit_error("maxInputBytes", limits.max_input_bytes));
    }
    let mut blocks = Vec::new();
    let mut meta = BTreeMap::new();
    let mut direction = None;
    for input in inputs {
        let value = json::parse(
            input,
            json::Limits {
                max_bytes: limits.max_input_bytes,
                max_depth: 256,
                max_nodes: limits.max_parse_units,
            },
        )
        .map_err(|error| format!("E_AST: {error}"))?;
        let Value::Object(fields) = value else {
            return Err("E_AST: Expected document object".into());
        };
        let mut found_blocks = false;
        for (key, value) in fields {
            match String::from_utf16(&key)
                .map_err(|_| "E_ENCODING: Invalid field name")?
                .as_str()
            {
                "blocks" => {
                    let Value::Array(input_blocks) = value else {
                        return Err("E_AST: Expected blocks array".into());
                    };
                    blocks.extend(input_blocks);
                    found_blocks = true;
                }
                "meta" => {
                    let Value::Object(fields) = value else {
                        return Err("E_AST: Expected metadata object".into());
                    };
                    meta.extend(fields);
                }
                "direction" => direction = Some(value),
                _ => {}
            }
        }
        if !found_blocks {
            return Err("E_AST: Missing blocks".into());
        }
    }
    let mut document = object([
        ("blocks", Value::Array(blocks)),
        ("metadata", Value::Object(meta.into_iter().collect())),
    ]);
    if let Some(direction) = direction
        && let Value::Object(fields) = &mut document
    {
        fields.push(("direction".encode_utf16().collect(), direction));
    }
    write_document(
        document,
        format,
        metadata,
        policy,
        strip_comments,
        shift_heading,
        number_sections,
        cwd,
        fs,
        output_limit,
    )
}

fn shift_headers(value: &mut Value, amount: i32) -> Result<(), String> {
    if value.get("t").map(text).transpose()?.as_deref() == Some("Header") {
        let Some(Value::Array(values)) = field_mut(value, "c") else {
            return Err("E_AST: Expected header content".into());
        };
        let Some(Value::Number(level)) = values.first_mut() else {
            return Err("E_AST: Expected header level".into());
        };
        if !(1. ..=6.).contains(level) || level.fract() != 0. {
            return Err("E_AST: Header level must be an integer from 1 to 6".into());
        }
        let adjusted = *level + f64::from(amount);
        if adjusted < 1. {
            let [_, Value::Array(attributes), Value::Array(_)] = values.as_slice() else {
                return Err("E_AST: Invalid header content".into());
            };
            let [id, Value::Array(classes), Value::Array(properties)] = attributes.as_slice()
            else {
                return Err("E_AST: Invalid header attributes".into());
            };
            text(id)?;
            for class in classes {
                text(class)?;
            }
            for property in properties {
                let Value::Array(pair) = property else {
                    return Err("E_AST: Invalid header attribute pair".into());
                };
                let [key, value] = pair.as_slice() else {
                    return Err("E_AST: Invalid header attribute pair".into());
                };
                text(key)?;
                text(value)?;
            }
            let inlines = values.pop().unwrap();
            *value = node("Para", inlines);
        } else {
            *level = adjusted.min(6.);
        }
    }
    match value {
        Value::Array(values) => {
            for value in values {
                shift_headers(value, amount)?;
            }
        }
        Value::Object(values) => {
            for (_, value) in values {
                shift_headers(value, amount)?;
            }
        }
        _ => {}
    }
    Ok(())
}

// Native readers can reuse their canonical value without serializing and parsing
// JSON or charging the expanded serialization as another source input.
pub(super) fn map_document(
    mut document: Value,
    format: &str,
    metadata: &BTreeMap<String, String>,
    policy: Option<&str>,
    strip_comments: bool,
    shift_heading: i32,
    number_sections: bool,
    cwd: &str,
    fs: &dyn SafeBashFs,
    output_limit: usize,
) -> Result<(document_ast_rust::Document, pdf_ast_rust::PdfOptions), String> {
    let limits = fs.shell_limits();
    let Some(Value::Object(meta)) = field_mut(&mut document, "metadata") else {
        return Err("E_AST: Expected metadata object".into());
    };
    for (key, value) in metadata {
        let value = node("MetaString", string(value));
        if let Some((_, prior)) = meta
            .iter_mut()
            .find(|(name, _)| name.iter().copied().eq(key.encode_utf16()))
        {
            *prior = value;
        } else {
            meta.push((key.encode_utf16().collect(), value));
        }
    }
    let has_title = meta
        .iter()
        .any(|(key, _)| key.iter().copied().eq("title".encode_utf16()));
    if let Some(blocks) = field_mut(&mut document, "blocks") {
        shift_headers(blocks, shift_heading)?;
    }
    let Some(Value::Array(blocks)) = field_mut(&mut document, "blocks") else {
        return Err("E_AST: Expected blocks array".into());
    };
    let mut counts = [0usize; 6];
    for block in blocks {
        if block.get("t").map(text).transpose()?.as_deref() != Some("Header") {
            continue;
        }
        let Some(Value::Array(values)) = field_mut(block, "c") else {
            return Err("E_AST: Expected header content".into());
        };
        let Some(Value::Number(level)) = values.first_mut() else {
            return Err("E_AST: Expected header level".into());
        };
        if number_sections {
            let index = (*level as usize).saturating_sub(1).min(5);
            counts[index] += 1;
            counts[index + 1..].fill(0);
            let mut parts = Vec::new();
            for count in &counts[..=index] {
                if *count > 0 || !parts.is_empty() {
                    parts.push((*count).max(1).to_string());
                }
            }
            let Some(Value::Array(inlines)) = values.get_mut(2) else {
                return Err("E_AST: Expected header inlines".into());
            };
            inlines.insert(0, node("Str", string(&format!("{} ", parts.join(".")))));
        }
    }
    let mut visible = document_converter_rust::visible_metadata(document.get("metadata").unwrap())
        .map_err(|error| format!("{}: {}", error.code, error.message))?;
    prepare(&mut visible, policy, strip_comments)?;
    let blocks = field_mut(&mut document, "blocks").unwrap();
    prepare(blocks, policy, strip_comments)?;
    let resources = resources(&[blocks, &visible], cwd, fs)?;
    // Only visible metadata gains raw-content policy and image-read capability.
    // Preserve descriptive/unknown fields for the shared mapper's own contract.
    if let Value::Object(selected) = visible {
        let Some(Value::Object(meta)) = field_mut(&mut document, "metadata") else {
            unreachable!()
        };
        for (key, value) in selected {
            if let Some((_, prior)) = meta.iter_mut().find(|(name, _)| *name == key) {
                *prior = value;
            }
        }
    }
    let mapper_limits = object([
        ("nodes", Value::Number(limits.max_parse_units as f64)),
        ("images", Value::Number(limits.max_parse_units as f64)),
        (
            "retainedBytes",
            Value::Number(limits.max_memory_bytes as f64),
        ),
        ("depth", Value::Number(96.)),
    ]);
    let format = if format == "docx" {
        Format::Docx
    } else {
        Format::Pdf
    };
    let mut options = pdf_ast_rust::PdfOptions {
        line_height: 1.2,
        ..Default::default()
    };
    options.limits.output_bytes = output_limit;
    options.limits.image_bytes = limits.max_memory_bytes;
    options.limits.decoded_image_bytes = limits.max_memory_bytes;
    options.limits.layout_work = limits.max_parse_units;
    options.limits.images = limits.max_parse_units;
    let mut document = document_ast_rust::cooperate::block_on(document_converter_rust::map_pandoc(
        &document,
        format,
        &resources,
        &mut options,
        false,
        Some(&mapper_limits),
        &mut Vec::new(),
    ))
    .map_err(|error| format!("{}: {}", error.code, error.message))?;
    if !has_title && format == Format::Docx {
        document.title = "Document".into();
    }
    Ok((document, options))
}

pub(super) fn write_document(
    document: Value,
    format: &str,
    metadata: &BTreeMap<String, String>,
    policy: Option<&str>,
    strip_comments: bool,
    shift_heading: i32,
    number_sections: bool,
    cwd: &str,
    fs: &dyn SafeBashFs,
    output_limit: usize,
) -> Result<Vec<u8>, String> {
    let (document, options) = map_document(
        document,
        format,
        metadata,
        policy,
        strip_comments,
        shift_heading,
        number_sections,
        cwd,
        fs,
        output_limit,
    )?;
    if format == "docx" {
        docx_ast_rust::write_docx(&document)
    } else {
        pdf_ast_rust::write_pdf_with_options(&document, &options)
    }
}
