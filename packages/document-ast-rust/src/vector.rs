//! Positioned, editable vector content. Coordinates are points from the top-left.
use crate::{Image, cooperate};
pub mod svg;

pub type Color = [u8; 4];

#[derive(Clone, Debug, Default)]
pub struct Scene {
    pub width: f64,
    pub height: f64,
    /// Back-to-front painting order.
    pub nodes: Vec<Node>,
}
#[derive(Clone, Debug)]
pub struct Node {
    /// Original shape identity, when the source has one.
    pub id: Option<String>,
    /// Local left, top, width, height, including the visible shape extent.
    pub bounds: [f64; 4],
    /// SVG affine convention: x'=a*x+c*y+e, y'=b*x+d*y+f.
    pub transform: [f64; 6],
    /// Applied to the complete node/group, after its children are composited.
    pub opacity: f64,
    pub clip: Option<Path>,
    pub kind: NodeKind,
}
impl Default for Node {
    fn default() -> Self {
        Self {
            id: None,
            bounds: [0.; 4],
            transform: [1., 0., 0., 1., 0., 0.],
            opacity: 1.,
            clip: None,
            kind: NodeKind::Group(Vec::new()),
        }
    }
}
#[derive(Clone, Debug)]
pub enum NodeKind {
    Group(Vec<Node>),
    Path {
        path: Path,
        fill: Option<Color>,
        stroke: Option<Stroke>,
    },
    Text(Text),
    /// Only raster content authored in the source, never a flattened vector scene.
    /// Placement uses Node.bounds; Image retains its embedded bytes and metadata.
    Raster(Image),
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Path {
    pub segments: Vec<PathSegment>,
    pub rule: FillRule,
}
#[derive(Clone, Debug, PartialEq)]
pub enum PathSegment {
    MoveTo([f64; 2]),
    LineTo([f64; 2]),
    CurveTo([f64; 6]),
    Close,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FillRule {
    #[default]
    NonZero,
    EvenOdd,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LineCap {
    #[default]
    Butt,
    Round,
    Square,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LineJoin {
    #[default]
    Miter,
    Round,
    Bevel,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub color: Color,
    pub width: f64,
    pub dash: Vec<f64>,
    pub dash_offset: f64,
    pub line_cap: LineCap,
    pub line_join: LineJoin,
    pub miter_limit: f64,
}
impl Default for Stroke {
    fn default() -> Self {
        Self {
            color: [0, 0, 0, 255],
            width: 1.,
            dash: Vec::new(),
            dash_offset: 0.,
            line_cap: LineCap::Butt,
            line_join: LineJoin::Miter,
            miter_limit: 4.,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Text {
    /// One positioned line/run of original semantic text, not glyph outlines.
    pub text: String,
    pub baseline: [f64; 2],
    pub width: f64,
    pub ascent: f64,
    pub font_size: f64,
    /// Source family name or CSS family list. Consumers select supported faces.
    pub font_family: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub color: Color,
}
impl Default for Text {
    fn default() -> Self {
        Self {
            text: String::new(),
            baseline: [0.; 2],
            width: 0.,
            ascent: 9.,
            font_size: 12.,
            font_family: "sans-serif".into(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            color: [0, 0, 0, 255],
        }
    }
}
fn geometry(values: &[f64]) -> Result<(), String> {
    if values.iter().any(|v| !v.is_finite() || v.abs() > 1e9) {
        return Err("Invalid vector geometry".into());
    }
    Ok(())
}
pub async fn validate_path(path: &Path) -> Result<(), String> {
    if path.segments.len() > 200000 {
        return Err("Vector path content limit exceeded".into());
    }
    let mut started = false;
    for (index, segment) in path.segments.iter().enumerate() {
        if index % 256 == 0 {
            cooperate::yield_now().await;
        }
        match segment {
            PathSegment::MoveTo(p) => {
                geometry(p)?;
                started = true;
            }
            PathSegment::LineTo(p) => {
                if !started {
                    return Err("Vector path must start with MoveTo".into());
                }
                geometry(p)?;
            }
            PathSegment::CurveTo(p) => {
                if !started {
                    return Err("Vector path must start with MoveTo".into());
                }
                geometry(p)?;
            }
            PathSegment::Close => {
                if !started {
                    return Err("Vector path must start with MoveTo".into());
                }
            }
        }
    }
    Ok(())
}
pub fn validate_stroke(stroke: &Stroke) -> Result<(), String> {
    geometry(&[stroke.width, stroke.dash_offset, stroke.miter_limit])?;
    if stroke.width < 0.
        || stroke.miter_limit < 1.
        || stroke.dash.len() > 10000
        || stroke
            .dash
            .iter()
            .any(|v| !v.is_finite() || *v < 0. || *v > 1e9)
        || (!stroke.dash.is_empty() && stroke.dash.iter().all(|v| *v == 0.))
    {
        return Err("Invalid vector stroke".into());
    }
    Ok(())
}
/// Validate public scenes independently or before adding them to a document.
pub async fn validate_async(scene: &Scene) -> Result<(), String> {
    validate_content(scene, 0, &mut 0, &mut 0).await
}
pub(crate) async fn validate_content(
    scene: &Scene,
    depth: usize,
    count: &mut usize,
    bytes: &mut usize,
) -> Result<(), String> {
    geometry(&[scene.width, scene.height])?;
    if scene.width <= 0. || scene.height <= 0. {
        return Err("Invalid vector scene dimensions".into());
    }
    let mut pending = vec![(scene.nodes.as_slice(), depth)];
    while let Some((nodes, depth)) = pending.pop() {
        if depth > 64 {
            return Err("Vector nesting limit exceeded".into());
        }
        for node in nodes {
            cooperate::yield_now().await;
            *count = count.saturating_add(1);
            *bytes = bytes.saturating_add(node.id.as_ref().map_or(0, String::len));
            geometry(&node.bounds)?;
            geometry(&node.transform)?;
            if node.bounds[2] < 0.
                || node.bounds[3] < 0.
                || !node.opacity.is_finite()
                || !(0.0..=1.0).contains(&node.opacity)
            {
                return Err("Invalid vector bounds or opacity".into());
            }
            if let Some(clip) = &node.clip {
                validate_path(clip).await?;
                *count = count.saturating_add(clip.segments.len());
            }
            match &node.kind {
                NodeKind::Group(children) => pending.push((children, depth + 1)),
                NodeKind::Path { path, stroke, .. } => {
                    validate_path(path).await?;
                    *count = count.saturating_add(path.segments.len());
                    if let Some(stroke) = stroke {
                        validate_stroke(stroke)?;
                        *count = count.saturating_add(stroke.dash.len());
                    }
                }
                NodeKind::Text(text) => {
                    geometry(&text.baseline)?;
                    geometry(&[text.width, text.ascent, text.font_size])?;
                    if text.font_size <= 0.
                        || text.width < 0.
                        || text.ascent < 0.
                        || (!text.text.is_empty() && text.width <= 0.)
                        || text.text.chars().any(char::is_control)
                    {
                        return Err("Invalid vector text geometry or line content".into());
                    }
                    *bytes = bytes
                        .saturating_add(text.text.len())
                        .saturating_add(text.font_family.len());
                }
                NodeKind::Raster(image) => {
                    if !matches!(
                        image.mime.as_str(),
                        "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/tiff"
                    ) {
                        return Err(
                            "Vector raster nodes require embedded raster image content".into()
                        );
                    }
                    geometry(&[image.width, image.height])?;
                    if image.width <= 0. || image.height <= 0. {
                        return Err("Invalid vector raster dimensions".into());
                    }
                    *bytes = bytes
                        .saturating_add(image.bytes.len())
                        .saturating_add(image.alt.len())
                        .saturating_add(image.title.len())
                        .saturating_add(image.link.as_ref().map_or(0, String::len));
                }
            }
            if *count > 200000 || *bytes > 64 * 1024 * 1024 {
                return Err("Document content limit exceeded".into());
            }
        }
    }
    Ok(())
}
