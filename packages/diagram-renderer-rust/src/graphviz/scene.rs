use super::*;
use crate::geometry as g;
use document_ast_rust::vector::{self as v, Node, NodeKind, PathSegment as S};

fn style(a: &GvAttrs, filled: bool) -> Result<(Option<v::Color>, Option<v::Stroke>), String> {
    let styles = a.get("style").unwrap_or("");
    let fill = if filled || styles.contains("filled") {
        Some(g::color(a.get("fillcolor").unwrap_or("lightgrey"))?)
    } else {
        None
    };
    let mut stroke = g::stroke(
        g::color(a.get("color").unwrap_or("black"))?,
        gv_numeric(a.get("penwidth"), 1., 0.),
        false,
    );
    if let Some(s) = &mut stroke {
        s.line_join = v::LineJoin::Miter;
        s.dash = if styles.contains("dotted") {
            vec![1., 3.]
        } else if styles.contains("dashed") {
            vec![5., 3.]
        } else {
            vec![]
        };
    }
    Ok((fill, stroke))
}
fn text(label: &str, x: f64, y: f64, a: &GvAttrs, id: &str) -> Result<Vec<Node>, String> {
    let size = gv_numeric(a.get("fontsize"), 14., 1.);
    let lines = gv_label_lines(label, id);
    let count = lines.len() as f64;
    let color = g::color(a.get("fontcolor").unwrap_or("black"))?;
    let family = a.get("fontname").unwrap_or("Times,serif");
    Ok(lines
        .into_iter()
        .enumerate()
        .filter(|(_, s)| !s.is_empty())
        .map(|(i, line)| {
            let width = gv_text_width(&line, size, Some(family));
            let baseline = y + (i as f64 - (count - 1.) / 2.) * size * 1.2 + size * 0.35;
            g::text(
                line,
                [x - width / 2., baseline],
                width,
                size,
                family.into(),
                false,
                color,
            )
        })
        .collect())
}
fn shape(node: &GvLayoutNode) -> Result<Vec<Node>, String> {
    let (x, y, w, h) = (node.x, node.y, node.width, node.height);
    let (l, t, r, b) = (x - w / 2., y - h / 2., x + w / 2., y + h / 2.);
    let a = &node.attributes;
    let name = a.get("shape").unwrap_or("ellipse");
    let (fill, stroke) = style(a, false)?;
    let polygon = |p: &[[f64; 2]]| g::polygon(p, true, fill, stroke.clone());
    let rect = |radius| g::rect([l, t, w, h], radius, fill, stroke.clone());
    let ellipse = |rx, ry| g::ellipse(x, y, rx, ry, fill, stroke.clone());
    Ok(match name {
        "none" | "plaintext" => vec![],
        "ellipse" | "oval" | "circle" => vec![ellipse(w / 2., h / 2.)],
        "doublecircle" => vec![
            ellipse(w / 2., h / 2.),
            ellipse((w / 2. - 4.).max(1.), (h / 2. - 4.).max(1.)),
        ],
        "diamond" => vec![polygon(&[[x, t], [r, y], [x, b], [l, y]])],
        "cylinder" => {
            let arc = (h / 5.).min(10.);
            vec![
                g::path(
                    vec![
                        S::MoveTo([l, t + arc]),
                        S::CurveTo([l, t - arc / 3., r, t - arc / 3., r, t + arc]),
                        S::LineTo([r, b - arc]),
                        S::CurveTo([r, b + arc / 3., l, b + arc / 3., l, b - arc]),
                        S::Close,
                    ],
                    fill,
                    stroke.clone(),
                ),
                g::path(
                    vec![
                        S::MoveTo([l, t + arc]),
                        S::CurveTo([l, t + arc * 2., r, t + arc * 2., r, t + arc]),
                    ],
                    fill,
                    stroke,
                ),
            ]
        }
        "folder" | "tab" => vec![polygon(&[
            [l, t + 8.],
            [l, t],
            [l + w * 0.35, t],
            [l + w * 0.35 + 8., t + 8.],
            [r, t + 8.],
            [r, b],
            [l, b],
        ])],
        "note" => vec![
            polygon(&[[l, t], [r - 10., t], [r, t + 10.], [r, b], [l, b]]),
            g::polygon(
                &[[r - 10., t], [r - 10., t + 10.], [r, t + 10.]],
                false,
                None,
                stroke,
            ),
        ],
        "component" => vec![
            rect(0.),
            g::rect([l - 4., t + h * 0.2, 8., h * 0.2], 0., fill, stroke.clone()),
            g::rect([l - 4., t + h * 0.6, 8., h * 0.2], 0., fill, stroke),
        ],
        _ => vec![rect(
            if name == "Mrecord" || a.get("style").is_some_and(|s| s.contains("rounded")) {
                6.
            } else {
                0.
            },
        )],
    })
}
fn record(node: &GvLayoutNode) -> Result<Vec<Node>, String> {
    fn walk(
        fields: &[GvRecordField],
        bounds: [f64; 4],
        horizontal: bool,
        node: &GvLayoutNode,
        out: &mut Vec<Node>,
    ) -> Result<(), String> {
        let [x, y, w, h] = bounds;
        let len = fields.len() as f64;
        for (i, field) in fields.iter().enumerate() {
            let width = if horizontal { w / len } else { w };
            let height = if horizontal { h } else { h / len };
            let left = x + if horizontal { i as f64 * width } else { 0. };
            let top = y + if horizontal { 0. } else { i as f64 * height };
            if i > 0 {
                out.push(g::polygon(
                    &[
                        [left, top],
                        [
                            if horizontal { left } else { left + width },
                            if horizontal { top + height } else { top },
                        ],
                    ],
                    false,
                    None,
                    g::stroke(
                        g::color(node.attributes.get("color").unwrap_or("black"))?,
                        1.,
                        false,
                    ),
                ));
            }
            if let Some(children) = &field.children {
                walk(children, [left, top, width, height], !horizontal, node, out)?;
            } else {
                out.extend(text(
                    &field.label,
                    left + width / 2.,
                    top + height / 2.,
                    &node.attributes,
                    &node.id,
                )?);
            }
        }
        Ok(())
    }
    let fields = gv_record_fields(node.attributes.get("label").unwrap_or(&node.id));
    let mut out = vec![];
    walk(
        &fields,
        [
            node.x - node.width / 2.,
            node.y - node.height / 2.,
            node.width,
            node.height,
        ],
        true,
        node,
        &mut out,
    )?;
    Ok(out)
}
fn arrow(point: GvPoint, previous: GvPoint, a: &GvAttrs) -> Result<Node, String> {
    let size = gv_numeric(a.get("arrowsize"), 1., 0.) * 10.;
    let (mut dx, mut dy) = (point.x - previous.x, point.y - previous.y);
    let len = dx.hypot(dy);
    let len = if len == 0. { 1. } else { len };
    dx /= len;
    dy /= len;
    let (x, y) = (point.x - size * dx, point.y - size * dy);
    let color = g::color(a.get("color").unwrap_or("black"))?;
    Ok(g::polygon(
        &[
            [point.x, point.y],
            [x + dy * size * 0.4, y - dx * size * 0.4],
            [x - dy * size * 0.4, y + dx * size * 0.4],
        ],
        true,
        Some(color),
        g::stroke(color, 1., false),
    ))
}
// Graphviz places endpoint labels in polar coordinates about the node contact:
// https://graphviz.org/docs/attrs/labelangle/ and /labeldistance/.
fn endpoint_labels(edge: &GvLayoutEdge) -> Result<Vec<Node>, String> {
    if edge.points.len() < 2 {
        return Ok(Vec::new());
    }
    let a = &edge.attributes;
    let mut font = a.clone();
    for key in ["fontname", "fontsize", "fontcolor"] {
        if let Some(value) = a.get(&format!("label{key}")) {
            font.insert(key, value);
        }
    }
    let distance = 10. * gv_numeric(a.get("labeldistance"), 1., 0.);
    let angle = gv_numeric(a.get("labelangle"), -25., -180.).to_radians();
    let last = edge.points.len() - 1;
    let mut nodes = Vec::new();
    for (key, origin, inside) in [
        ("taillabel", edge.points[0], edge.points[1]),
        ("headlabel", edge.points[last], edge.points[last - 1]),
    ] {
        if let Some(label) = a.get(key) {
            // Scene y grows down, so counterclockwise Graphviz angles subtract.
            let direction = (inside.y - origin.y).atan2(inside.x - origin.x) - angle;
            nodes.extend(text(
                label,
                origin.x + distance * direction.cos(),
                origin.y + distance * direction.sin(),
                &font,
                "",
            )?);
        }
    }
    Ok(nodes)
}
fn group(id: String, bounds: [f64; 4], nodes: Vec<Node>) -> Node {
    Node {
        id: Some(id),
        bounds,
        kind: NodeKind::Group(nodes),
        ..Default::default()
    }
}

pub(super) fn lower(graph: &GvGraphLayout) -> Result<v::Scene, String> {
    let mut nodes = vec![];
    let mut viewport = [0., 0., graph.width, graph.height];
    for cluster in graph.clusters.iter().rev() {
        let (fill, stroke) = style(&cluster.attributes, false)?;
        let mut children = vec![g::rect(
            [cluster.x, cluster.y, cluster.width, cluster.height],
            0.,
            fill,
            stroke,
        )];
        if let Some(label) = cluster.attributes.get("label") {
            children.extend(text(
                label,
                cluster.x + cluster.width / 2.,
                cluster.y + 12.,
                &cluster.attributes,
                "",
            )?);
        }
        nodes.push(group(
            format!("cluster-{}", cluster.id),
            [cluster.x, cluster.y, cluster.width, cluster.height],
            children,
        ));
    }
    for (index, edge) in graph.edges.iter().enumerate() {
        if edge
            .attributes
            .get("style")
            .is_some_and(|s| s.contains("invis"))
        {
            continue;
        }
        let mut children = vec![];
        if !edge.path.is_empty() {
            let (_, stroke) = style(&edge.attributes, false)?;
            let path = crate::svg::parse_path(&edge.path)?;
            children.push(g::path(path.segments, None, stroke));
            let dir = edge.attributes.get("dir").unwrap_or("");
            if ((graph.directed && dir != "none" && dir != "back")
                || dir == "both"
                || dir == "forward")
                && edge.attributes.get("arrowhead") != Some("none")
                && edge.points.len() >= 2
            {
                children.push(arrow(
                    *edge.points.last().unwrap(),
                    edge.points[edge.points.len() - 2],
                    &edge.attributes,
                )?);
            }
            if matches!(dir, "back" | "both")
                && edge.attributes.get("arrowtail") != Some("none")
                && edge.points.len() >= 2
            {
                children.push(arrow(edge.points[0], edge.points[1], &edge.attributes)?);
            }
        }
        if let Some(label) = edge.attributes.get("label") {
            children.extend(text(
                label,
                edge.label.x,
                edge.label.y,
                &edge.attributes,
                "",
            )?);
        }
        let labels = endpoint_labels(edge)?;
        for label in &labels {
            let [x, y, width, height] = label.bounds;
            viewport[0] = viewport[0].min(x);
            viewport[1] = viewport[1].min(y);
            viewport[2] = viewport[2].max(x + width);
            viewport[3] = viewport[3].max(y + height);
        }
        children.extend(labels);
        nodes.push(group(
            format!("edge-{index}"),
            [0., 0., graph.width, graph.height],
            children,
        ));
    }
    for node in &graph.nodes {
        if node
            .attributes
            .get("style")
            .is_some_and(|s| s.contains("invis"))
        {
            continue;
        }
        let mut children = shape(node)?;
        if matches!(node.attributes.get("shape"), Some("record" | "Mrecord")) {
            children.extend(record(node)?);
        } else {
            children.extend(text(
                node.attributes.get("label").unwrap_or(&node.id),
                node.x,
                node.y,
                &node.attributes,
                &node.id,
            )?);
        }
        nodes.push(group(
            format!("node-{}", node.id),
            [
                node.x - node.width / 2.,
                node.y - node.height / 2.,
                node.width,
                node.height,
            ],
            children,
        ));
    }
    if let Some(label) = graph.attributes.get("label") {
        nodes.extend(text(
            label,
            graph.width / 2.,
            graph.height - 12.,
            &graph.attributes,
            "",
        )?);
    }
    let [left, top, right, bottom] = viewport;
    let (width, height) = (right - left, bottom - top);
    if left != 0. || top != 0. {
        let mut content = group("graph-content".into(), [left, top, width, height], nodes);
        content.transform[4] = -left;
        content.transform[5] = -top;
        nodes = vec![content];
    }
    if let Some(bg) = graph.attributes.get("bgcolor") {
        nodes.insert(0, g::rect([0., 0., width, height], 0., Some(g::color(bg)?), None));
    }
    Ok(v::Scene { width, height, nodes })
}
