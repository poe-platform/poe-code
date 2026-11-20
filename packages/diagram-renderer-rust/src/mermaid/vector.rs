use super::{Scene, Shape, config::Theme, raster::Paint, route::Segment};
use crate::geometry as g;
use document_ast_rust::vector::{self as v, Node, NodeKind, PathSegment as S};

impl Scene {
    pub(crate) fn to_vector(
        &self,
        theme: &Theme<'_>,
        background: v::Color,
        width: f64,
        height: f64,
    ) -> Result<v::Scene, String> {
        // Hyperlinks require a document link model; do not silently remove authored actions.
        if self.elements.iter().any(|element| element.contains("<a ")) {
            return Err("Diagram hyperlinks are not supported by editable document scenes".into());
        }
        let mut nodes = Vec::new();
        if background[3] > 0 {
            nodes.push(g::rect(
                [0., 0., self.width, self.height],
                0.,
                Some(background),
                None,
            ));
        }
        for paint in &self.paint {
            match paint {
                Paint::Text {
                    mono,
                    start,
                    baseline,
                    size,
                    weight,
                    color,
                    text,
                } => {
                    if text.is_empty() {
                        continue;
                    }
                    let width = if *mono {
                        text.chars()
                            .map(|c| f64::from(super::card::mono_advance(c)))
                            .sum::<f64>()
                            * size
                            / 1000.
                    } else {
                        super::measure(text, *size, *weight >= 600)
                    };
                    nodes.push(g::text(
                        text.clone(),
                        [*start, *baseline],
                        width,
                        *size,
                        g::unescape(if *mono { &theme.mono_font } else { &theme.font }),
                        *weight >= 600,
                        *color,
                    ));
                }
                Paint::Path {
                    points,
                    fill,
                    stroke,
                    width,
                    dashed,
                } => {
                    nodes.push(g::polygon(
                        &points.iter().map(|&(x, y)| [x, y]).collect::<Vec<_>>(),
                        fill.is_some(),
                        *fill,
                        g::stroke(*stroke, *width, *dashed),
                    ));
                }
                Paint::Edge {
                    route,
                    stroke,
                    width,
                    dashed,
                } => {
                    let mut segments = vec![S::MoveTo([route.start.0, route.start.1])];
                    let mut from = route.start;
                    for segment in &route.segments {
                        match *segment {
                            Segment::Line((x, y)) => {
                                segments.push(S::LineTo([x, y]));
                                from = (x, y);
                            }
                            Segment::Quad((cx, cy), (x, y)) => {
                                segments.push(S::CurveTo([
                                    from.0 + (cx - from.0) * 2. / 3.,
                                    from.1 + (cy - from.1) * 2. / 3.,
                                    x + (cx - x) * 2. / 3.,
                                    y + (cy - y) * 2. / 3.,
                                    x,
                                    y,
                                ]));
                                from = (x, y);
                            }
                        }
                    }
                    nodes.push(g::path(segments, None, g::stroke(*stroke, *width, *dashed)));
                }
                Paint::Pie { cx, cy, ends } => {
                    let mut start = -std::f64::consts::FRAC_PI_2;
                    for &(end, fill) in ends {
                        let mut points = vec![[*cx, *cy]];
                        let count = ((end - start) * 60.).ceil().max(1.) as usize;
                        for index in 0..=count {
                            let angle = start + (end - start) * index as f64 / count as f64;
                            points.push([cx + 120. * angle.cos(), cy + 120. * angle.sin()]);
                        }
                        nodes.push(g::polygon(&points, true, Some(fill), None));
                        start = end;
                    }
                }
                Paint::Box {
                    bounds,
                    style,
                    shape,
                    shadow,
                } => {
                    let [x, y, w, h] = *bounds;
                    let outline = |fill, stroke| match shape {
                        Shape::Circle | Shape::StateStart | Shape::StateEnd => {
                            g::ellipse(x + w / 2., y + h / 2., w / 2., h / 2., fill, stroke)
                        }
                        Shape::Diamond => g::polygon(
                            &[
                                [x + w / 2., y],
                                [x + w, y + h / 2.],
                                [x + w / 2., y + h],
                                [x, y + h / 2.],
                            ],
                            true,
                            fill,
                            stroke,
                        ),
                        Shape::Hexagon => g::polygon(
                            &[
                                [x + 12., y],
                                [x + w - 12., y],
                                [x + w, y + h / 2.],
                                [x + w - 12., y + h],
                                [x + 12., y + h],
                                [x, y + h / 2.],
                            ],
                            true,
                            fill,
                            stroke,
                        ),
                        Shape::Cylinder => {
                            let ry = (w * 0.075).round().clamp(9., 11.);
                            g::path(
                                vec![
                                    S::MoveTo([x, y + ry]),
                                    S::CurveTo([
                                        x,
                                        y + ry - ry * g::K,
                                        x + w / 2. - w / 2. * g::K,
                                        y,
                                        x + w / 2.,
                                        y,
                                    ]),
                                    S::CurveTo([
                                        x + w / 2. + w / 2. * g::K,
                                        y,
                                        x + w,
                                        y + ry - ry * g::K,
                                        x + w,
                                        y + ry,
                                    ]),
                                    S::LineTo([x + w, y + h - ry]),
                                    S::CurveTo([
                                        x + w,
                                        y + h - ry + ry * g::K,
                                        x + w / 2. + w / 2. * g::K,
                                        y + h,
                                        x + w / 2.,
                                        y + h,
                                    ]),
                                    S::CurveTo([
                                        x + w / 2. - w / 2. * g::K,
                                        y + h,
                                        x,
                                        y + h - ry + ry * g::K,
                                        x,
                                        y + h - ry,
                                    ]),
                                    S::Close,
                                ],
                                fill,
                                stroke,
                            )
                        }
                        _ => g::rect(*bounds, style.radius, fill, stroke),
                    };
                    if let Some(color) = shadow {
                        // Keep the existing soft shadow as editable translucent vector layers.
                        for (offset, alpha) in [(3., 0.08), (2., 0.12), (1., 0.18)] {
                            let mut shade = outline(
                                Some([
                                    color[0],
                                    color[1],
                                    color[2],
                                    (f64::from(color[3]) * alpha).round() as u8,
                                ]),
                                None,
                            );
                            shade.transform = [1., 0., 0., 1., 0., offset];
                            nodes.push(shade);
                        }
                    }
                    let shape_node = outline(
                        Some(style.fill),
                        g::stroke(style.border, style.thickness, style.dashed),
                    );
                    if let Some((header, color)) = style.header {
                        // The group header is a rounded-top strip, retained as editable geometry.
                        let mut body = shape_node.clone();
                        if let NodeKind::Path { stroke, .. } = &mut body.kind {
                            *stroke = None;
                        }
                        nodes.push(body);
                        let r = style.radius.max(0.).min(w / 2.).min(h / 2.);
                        let c = r * g::K;
                        nodes.push(g::path(
                            vec![
                                S::MoveTo([x + r, y]),
                                S::LineTo([x + w - r, y]),
                                S::CurveTo([x + w - r + c, y, x + w, y + r - c, x + w, y + r]),
                                S::LineTo([x + w, y + header]),
                                S::LineTo([x, y + header]),
                                S::LineTo([x, y + r]),
                                S::CurveTo([x, y + r - c, x + r - c, y, x + r, y]),
                                S::Close,
                            ],
                            Some(color),
                            None,
                        ));
                        let mut border = shape_node;
                        if let NodeKind::Path { fill, .. } = &mut border.kind {
                            *fill = None;
                        }
                        nodes.push(border);
                    } else {
                        nodes.push(shape_node);
                    }
                    if *shape == Shape::Cylinder {
                        let [r, g, b, a] = style.fill;
                        let lid = if r < 128 {
                            [
                                r.saturating_add(18),
                                g.saturating_add(28),
                                b.saturating_add(58),
                                a,
                            ]
                        } else {
                            [
                                r.saturating_sub(24),
                                g.saturating_sub(14),
                                b.saturating_sub(4),
                                a,
                            ]
                        };
                        let ry = (w * 0.075).round().clamp(9., 11.);
                        nodes.push(g::ellipse(
                            x + w / 2.,
                            y + ry,
                            w / 2.,
                            ry,
                            Some(lid),
                            g::stroke(style.border, style.thickness, false),
                        ));
                    }
                }
            }
        }
        for (index, node) in nodes.iter_mut().enumerate() {
            node.id = Some(format!("mermaid-{index}"));
        }
        let scale = (width / self.width).min(height / self.height);
        let group = Node {
            bounds: [0., 0., self.width, self.height],
            transform: [
                scale * 0.75,
                0.,
                0.,
                scale * 0.75,
                (width - self.width * scale) * 0.375,
                (height - self.height * scale) * 0.375,
            ],
            kind: NodeKind::Group(nodes),
            ..Default::default()
        };
        Ok(v::Scene {
            width: width * 0.75,
            height: height * 0.75,
            nodes: vec![group],
        })
    }
}
