//! Existing native diagram parsers and layouts, shared by shell and document exports.
mod calendar;
mod geometry;
pub mod graphviz;
pub mod mermaid;
pub mod svg;
pub mod theme;

use document_ast_rust::vector;
pub use graphviz::render_dot_svg;

#[derive(Debug)]
pub struct RenderedDiagram {
    pub scene: vector::Scene,
    pub svg: String,
}

fn escape_mmdc_xml(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}
fn is_valid_mmdc_theme(t: &str) -> bool {
    matches!(
        t,
        "light" | "dark" | "default" | "neutral" | "forest" | "base"
    )
}
fn admit(source: &str, limit: usize) -> Result<(), String> {
    if source.len() > limit.min(1_048_576) {
        return Err("Diagram input byte limit exceeded".into());
    }
    Ok(())
}
fn finish(scene: vector::Scene, limit: usize) -> Result<RenderedDiagram, String> {
    let svg = document_ast_rust::cooperate::block_on(svg::to_svg(&scene))?;
    if svg.len() > limit.min(16_777_216) {
        return Err("Diagram output byte limit exceeded".into());
    }
    Ok(RenderedDiagram { scene, svg })
}

/// One Mermaid parse/layout supplies both screen SVG and editable vector content.
pub fn render_mermaid(source: &str, limit: usize) -> Result<RenderedDiagram, String> {
    render_mermaid_with_config(source, limit, &theme::Config::default())
}

/// Host configuration supplies defaults; authored Mermaid configuration takes precedence.
pub fn render_mermaid_with_config(source: &str, limit: usize, host: &theme::Config) -> Result<RenderedDiagram, String> {
    admit(source, limit)?;
    let mut source = source.to_owned();
    let mut metadata = mermaid::source::Metadata::frontmatter(&mut source)?;
    let scanned = mermaid::scanner::scan(&source, &mut metadata, limit)?;
    let (mut title, config) = metadata.finish();
    let cfg = config?;
    let theme = theme::theme_tokens(host, &cfg, cfg.theme.as_deref().or(host.theme.as_deref()).unwrap_or("light"))?;
    let number = |key: &str| theme.numbers.get(key).copied();
    let padding = cfg.padding.or(host.padding).or_else(|| number("padding")).unwrap_or(32.);
    let first = scanned
        .first()
        .ok_or("mmdc: E_SYNTAX (line 1, column 1): Diagram source is empty\n")?;
    let header = first.text.split_ascii_whitespace().next().unwrap_or("");
    let mut description = None;
    let scene = match header {
        "pie" => {
            let mut pie = mermaid::pie::Pie::parse(&scanned, limit)?;
            pie.title = pie.title.or(title);
            pie.layout(&theme, padding, limit)?
        }
        "gantt" => mermaid::gantt::Gantt::parse(&scanned, &mut title, limit)?.layout(
            &theme,
            padding,
            title.as_deref(),
            limit,
        )?,
        "sequenceDiagram" => mermaid::sequence::Sequence::parse(&scanned, limit)?.layout(
            &theme,
            padding,
            "",
            title.as_deref(),
            limit,
        )?,
        _ => {
            let graph = mermaid::parse(
                &scanned,
                &mut title,
                &mut description,
                cfg.wrapping_width.or(host.wrapping_width)
                    .or_else(|| number("wrappingWidth"))
                    .unwrap_or(200.),
                number("secondaryFontSize").unwrap_or(11.5),
                limit,
            )?;
            mermaid::layout(
                graph,
                &theme,
                "",
                title.as_deref(),
                (
                    cfg.rank_gap.or(host.rank_gap).or_else(|| number("rankGap")).unwrap_or(56.),
                    cfg.node_gap.or(host.node_gap).or_else(|| number("nodeGap")).unwrap_or(32.),
                ),
                padding,
                limit,
            )?
        }
    };
    let (width, height) = match (cfg.width.or(host.width), cfg.height.or(host.height)) {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, (w * scene.height / scene.width).round().max(1.)),
        (None, Some(h)) => ((h * scene.width / scene.height).round().max(1.), h),
        (None, None) => (scene.width, scene.height),
    };
    if !width.is_finite() || !height.is_finite() || width <= 0. || height <= 0. {
        return Err("Invalid diagram dimensions".into());
    }
    let (_, rgba) = mermaid::css_color(cfg.background.as_deref().or(host.background.as_deref()).unwrap_or(theme.background()))?;
    finish(scene.to_vector(&theme, rgba, width, height)?, limit)
}

/// One DOT parse/layout supplies both screen SVG and editable vector content.
pub fn render_graphviz(source: &str, limit: usize) -> Result<RenderedDiagram, String> {
    render_graphviz_with_config(source, limit, &theme::Config::default())
}

/// Apply the shared theme before DOT layout, preserving authored attributes.
pub fn render_graphviz_with_config(source: &str, limit: usize, host: &theme::Config) -> Result<RenderedDiagram, String> {
    admit(source, limit)?;
    let empty = theme::Config::default();
    let theme = theme::theme_tokens(host, &empty, host.theme.as_deref().unwrap_or("light"))?;
    finish(graphviz::render_scene(source, &theme)?, limit)
}
