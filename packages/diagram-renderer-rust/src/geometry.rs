use document_ast_rust::vector::*;
pub(crate) const K: f64 = 0.5522847498307936;

pub(crate) fn stroke(color: Color, width: f64, dashed: bool) -> Option<Stroke> {
    (color[3] > 0 && width > 0.).then(|| Stroke {
        color,
        width,
        dash: if dashed { vec![5., 4.] } else { vec![] },
        line_join: LineJoin::Round,
        ..Default::default()
    })
}
pub(crate) fn path(
    segments: Vec<PathSegment>,
    fill: Option<Color>,
    stroke: Option<Stroke>,
) -> Node {
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for segment in &segments {
        let coords: &[f64] = match segment {
            PathSegment::MoveTo(v) | PathSegment::LineTo(v) => v,
            PathSegment::CurveTo(v) => v,
            PathSegment::Close => &[],
        };
        for p in coords.chunks_exact(2) {
            bounds[0] = bounds[0].min(p[0]);
            bounds[1] = bounds[1].min(p[1]);
            bounds[2] = bounds[2].max(p[0]);
            bounds[3] = bounds[3].max(p[1]);
        }
    }
    if !bounds[0].is_finite() {
        bounds = [0.; 4];
    }
    let pad = stroke.as_ref().map_or(0., |s| s.width / 2.);
    Node {
        bounds: [
            bounds[0] - pad,
            bounds[1] - pad,
            bounds[2] - bounds[0] + 2. * pad,
            bounds[3] - bounds[1] + 2. * pad,
        ],
        kind: NodeKind::Path {
            path: Path {
                segments,
                ..Default::default()
            },
            fill: fill.filter(|c| c[3] > 0),
            stroke,
        },
        ..Default::default()
    }
}
pub(crate) fn polygon(
    points: &[[f64; 2]],
    closed: bool,
    fill: Option<Color>,
    stroke: Option<Stroke>,
) -> Node {
    let mut segments = Vec::new();
    if let Some(first) = points.first() {
        segments.push(PathSegment::MoveTo(*first));
        segments.extend(points[1..].iter().copied().map(PathSegment::LineTo));
        if closed {
            segments.push(PathSegment::Close);
        }
    }
    path(segments, fill, stroke)
}
pub(crate) fn rect(
    [x, y, w, h]: [f64; 4],
    radius: f64,
    fill: Option<Color>,
    stroke: Option<Stroke>,
) -> Node {
    let r = radius.max(0.).min(w / 2.).min(h / 2.);
    let c = r * K;
    if r == 0. {
        return polygon(
            &[[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
            true,
            fill,
            stroke,
        );
    }
    path(
        vec![
            PathSegment::MoveTo([x + r, y]),
            PathSegment::LineTo([x + w - r, y]),
            PathSegment::CurveTo([x + w - r + c, y, x + w, y + r - c, x + w, y + r]),
            PathSegment::LineTo([x + w, y + h - r]),
            PathSegment::CurveTo([x + w, y + h - r + c, x + w - r + c, y + h, x + w - r, y + h]),
            PathSegment::LineTo([x + r, y + h]),
            PathSegment::CurveTo([x + r - c, y + h, x, y + h - r + c, x, y + h - r]),
            PathSegment::LineTo([x, y + r]),
            PathSegment::CurveTo([x, y + r - c, x + r - c, y, x + r, y]),
            PathSegment::Close,
        ],
        fill,
        stroke,
    )
}
pub(crate) fn ellipse(
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    fill: Option<Color>,
    stroke: Option<Stroke>,
) -> Node {
    path(
        vec![
            PathSegment::MoveTo([cx + rx, cy]),
            PathSegment::CurveTo([cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry]),
            PathSegment::CurveTo([cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy]),
            PathSegment::CurveTo([cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry]),
            PathSegment::CurveTo([cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy]),
            PathSegment::Close,
        ],
        fill,
        stroke,
    )
}
pub(crate) fn text(
    text: String,
    baseline: [f64; 2],
    width: f64,
    size: f64,
    font_family: String,
    bold: bool,
    color: Color,
) -> Node {
    let ascent = size * 0.8;
    Node {
        bounds: [baseline[0], baseline[1] - ascent, width.max(0.), size],
        kind: NodeKind::Text(Text {
            text,
            baseline,
            width: width.max(0.01),
            ascent,
            font_size: size,
            font_family,
            bold,
            color,
            ..Default::default()
        }),
        ..Default::default()
    }
}
pub(crate) fn color(value: &str) -> Result<Color, String> {
    terminal_png_rust::color::css_named_color(&value.trim().to_ascii_lowercase())
        .map(Ok)
        .unwrap_or_else(|| terminal_png_rust::color::parse_color(value))
}
pub(crate) fn unescape(value: &str) -> String {
    value
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}
