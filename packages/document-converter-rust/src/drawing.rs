//! First-party drawing renderers share the document converter's result ABI.
use super::*;
const SOURCE_LIMIT: usize = 1024 * 1024;
const SVG_LIMIT: usize = 16 * 1024 * 1024;
const OUTPUT_LIMIT: usize = 64 * 1024 * 1024;

pub async fn render_async(input: &[u8]) -> Result<Output> {
    let (request, tail) = parse_request(input)?;
    if !tail.is_empty()
        || request
            .get("resources")
            .is_some_and(|v| !matches!(v, Value::Array(a) if a.is_empty()))
    {
        return Err(Error::new(
            "E_OPTION",
            "Drawing sources must contain their own resources",
        ));
    }
    if string(field(&request, "mode")?)? != "drawing" {
        return Err(Error::new("E_OPTION", "Expected drawing input mode"));
    }
    let source_value = field(&request, "source")?;
    if matches!(source_value,Value::String(v) if v.len()>SOURCE_LIMIT) {
        return Err(Error::new("E_LIMIT", "Drawing source exceeds 1 MiB"));
    }
    let source = string_async(source_value).await?;
    if source.len() > SOURCE_LIMIT {
        return Err(Error::new("E_LIMIT", "Drawing source exceeds 1 MiB"));
    }
    let config = match request.get("theme") {
        Some(theme) => diagram_renderer_rust::theme::Config::parse(
            &Value::Object(vec![("theme".encode_utf16().collect(), theme.clone())]), false,
        ).map_err(|e| Error::new("E_OPTION", e))?,
        None => diagram_renderer_rust::theme::Config::default(),
    };
    document_ast_rust::cooperate::yield_now().await;
    let drawing = match string(field(&request, "format")?)?.as_str() {
        "mermaid" => diagram_renderer_rust::render_mermaid_with_config(&source, SVG_LIMIT, &config).map_err(|e| {
            Error::new(
                if e.contains("limit exceeded") {
                    "E_LIMIT"
                } else {
                    "E_PARSE"
                },
                e,
            )
        })?,
        "graphviz" => diagram_renderer_rust::render_graphviz_with_config(&source, SVG_LIMIT, &config).map_err(|e| {
            Error::new(
                if e.contains("limit exceeded") {
                    "E_LIMIT"
                } else {
                    "E_PARSE"
                },
                e,
            )
        })?,
        _ => return Err(Error::new("E_OPTION", "Unknown drawing format")),
    };
    let diagram_renderer_rust::RenderedDiagram { scene, svg } = drawing;
    if svg.len() > SVG_LIMIT {
        return Err(Error::new("E_LIMIT", "Drawing SVG exceeds 16 MiB"));
    }
    let value = Value::Object(vec![
        (
            "svg".encode_utf16().collect(),
            Value::String(svg.encode_utf16().collect()),
        ),
        (
            "scene".encode_utf16().collect(),
            vector::to_json(&scene).await?,
        ),
    ]);
    let bytes = json::stringify(&value).into_bytes();
    if bytes.len() > OUTPUT_LIMIT {
        return Err(Error::new("E_LIMIT", "Drawing result exceeds 64 MiB"));
    }
    Ok(Output {
        bytes,
        diagnostics: Vec::new(),
        usage: Vec::new(),
    })
}
