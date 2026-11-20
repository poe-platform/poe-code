//! Native vector scene layout and PDF graphics resources.
use super::*;

pub(super) fn paints(items: &[Paint]) -> impl Iterator<Item = &Paint> {
    let mut stack = vec![items.iter()];
    std::iter::from_fn(move || {
        loop {
            let iter = stack.last_mut()?;
            if let Some(paint) = iter.next() {
                if let Paint::Group { paints, .. } = paint {
                    stack.push(paints.iter());
                }
                return Some(paint);
            }
            stack.pop();
        }
    })
}
pub(super) fn remap_fonts(items: &mut [Paint], map: &BTreeMap<usize, usize>) {
    for item in items {
        match item {
            Paint::Text { font, .. } => *font = map[font],
            Paint::Group { paints, .. } => remap_fonts(paints, map),
            _ => {}
        }
    }
}
pub(super) fn validate_depth(items: &[Paint]) -> Result<(), String> {
    let mut stack = vec![(items, 0)];
    let mut count = 0usize;
    while let Some((items, depth)) = stack.pop() {
        if depth > 64 {
            return Err("PDF vector nesting limit exceeded".into());
        }
        count = count.saturating_add(items.len());
        if count > 200000 {
            return Err("PDF vector paint limit exceeded".into());
        }
        for item in items {
            if let Paint::Group { paints, .. } = item {
                stack.push((paints, depth + 1));
            }
        }
    }
    Ok(())
}
impl Layout<'_> {
    pub(super) async fn vector_line(
        &mut self,
        scene: &scene::Scene,
        width: f64,
    ) -> Result<Line, String> {
        let scale = (width / scene.width)
            .min((self.bottom() - self.options.page.margin - 24.) / scene.height)
            .min(1.);
        if scale <= 0. {
            return Err("Vector scene has no printable space".into());
        }
        let paints = self.vector_nodes(&scene.nodes).await?;
        let width = scene.width * scale;
        let height = scene.height * scale;
        let paint = Paint::Group {
            x: 0.,
            y: 0.,
            bounds: [0., 0., scene.width, scene.height],
            transform: [scale, 0., 0., scale, 0., 0.],
            clip: None,
            opacity: 1.,
            paints,
        };
        Ok(Line {
            atoms: vec![Atom {
                content: Content::Vector(Arc::new(paint), height),
                width,
                size: self.options.font_size,
                font: 0,
                style: Default::default(),
            }],
            width,
            height,
            baseline: height,
            ..Default::default()
        })
    }
    async fn vector_nodes(&mut self, nodes: &[scene::Node]) -> Result<Vec<Paint>, String> {
        let mut out = Vec::new();
        for node in nodes {
            yield_now().await;
            charge(
                &mut self.work,
                1,
                self.options.limits.layout_work,
                "layoutWork",
            )?;
            if let Some(clip) = &node.clip {
                charge(
                    &mut self.work,
                    clip.segments.len(),
                    self.options.limits.layout_work,
                    "layoutWork",
                )?;
            }
            let paints = match &node.kind {
                scene::NodeKind::Group(nodes) => Box::pin(self.vector_nodes(nodes)).await?,
                scene::NodeKind::Path { path, fill, stroke } => {
                    charge(
                        &mut self.work,
                        path.segments.len(),
                        self.options.limits.layout_work,
                        "layoutWork",
                    )?;
                    vec![Paint::Path {
                        x: 0.,
                        y: 0.,
                        path: path.clone(),
                        fill: *fill,
                        stroke: stroke.clone(),
                    }]
                }
                scene::NodeKind::Raster(image) => vec![Paint::Image {
                    id: self.image(image)?,
                    x: node.bounds[0],
                    y: node.bounds[1],
                    width: node.bounds[2],
                    height: node.bounds[3],
                }],
                scene::NodeKind::Text(text) => self.vector_text(text).await?,
            };
            out.push(Paint::Group {
                x: 0.,
                y: 0.,
                bounds: node.bounds,
                transform: node.transform,
                clip: node.clip.clone(),
                opacity: node.opacity,
                paints,
            });
        }
        Ok(out)
    }
    fn vector_font(&self, text: &scene::Text) -> Result<usize, String> {
        for family in text.font_family.split(',') {
            let family = family.trim().trim_matches(['\'', '"']).to_ascii_lowercase();
            if !self.options.fonts.is_empty() {
                if let Some(index) = self
                    .options
                    .fonts
                    .iter()
                    .position(|f| f.id.eq_ignore_ascii_case(&family))
                {
                    return Ok(index);
                }
                if matches!(family.as_str(), "sans-serif" | "serif" | "monospace") {
                    return Ok(0);
                }
                continue;
            }
            let style = usize::from(text.bold) + 2 * usize::from(text.italic);
            match family.as_str() {
                "liberation sans" | "liberationsans" | "arial" | "helvetica" | "sans-serif" => {
                    return Ok(style);
                }
                "jetbrains mono" | "jetbrainsmono" | "monospace" => return Ok(4 + style),
                "dejavu sans" | "dejavusans" => return Ok(8),
                "dejavu serif" | "dejavuserif" | "times" | "times-roman" | "times new roman"
                | "serif" => return Ok(10),
                _ => {}
            }
        }
        Err(format!(
            "Unsupported PDF vector font family: {}",
            text.font_family
        ))
    }
    async fn vector_text(&mut self, text: &scene::Text) -> Result<Vec<Paint>, String> {
        if text.text.is_empty() {
            return Ok(Vec::new());
        }
        let preferred = self.vector_font(text)?;
        let style = TextStyle {
            bold: text.bold,
            italic: text.italic,
            color: Some(format!(
                "{:02X}{:02X}{:02X}",
                text.color[0], text.color[1], text.color[2]
            )),
            ..Default::default()
        };
        let mut paints = Vec::new();
        let mut width = 0.;
        for (index, c) in text.text.chars().enumerate() {
            if index % 256 == 0 {
                yield_now().await;
            }
            admit_text_scalar(c)?;
            charge(&mut self.glyphs, 1, self.options.limits.glyphs, "glyphs")?;
            charge(
                &mut self.work,
                1,
                self.options.limits.layout_work,
                "layoutWork",
            )?;
            let font = std::iter::once(preferred)
                .chain(0..self.fonts.len())
                .find(|&f| self.fonts[f].glyph_index(c as u32) != 0)
                .ok_or_else(|| format!("No supplied PDF font covers U+{:04X}", c as u32))?;
            let face = &self.fonts[font];
            let advance = f64::from(
                face.advance(face.glyph_index(c as u32))
                    .map_err(str::to_owned)?,
            ) / f64::from(face.units_per_em())
                * text.font_size;
            if advance <= 0. {
                return Err(format!("Nonadvancing PDF glyph U+{:04X}", c as u32));
            }
            match paints.last_mut() {
                Some(Paint::Text {
                    font: last,
                    text: run,
                    ..
                }) if *last == font => run.push(c),
                _ => paints.push(Paint::Text {
                    x: width,
                    y: 0.,
                    size: text.font_size,
                    font,
                    text: c.to_string(),
                    style: style.clone(),
                }),
            }
            width += advance;
        }
        let color = [text.color[0], text.color[1], text.color[2]].map(|c| f64::from(c) / 255.);
        for y in [
            text.underline.then_some(text.font_size * 0.12),
            text.strike.then_some(-text.font_size * 0.3),
        ]
        .into_iter()
        .flatten()
        {
            paints.push(Paint::Stroke {
                x: 0.,
                y,
                width,
                color,
                weight: (text.font_size * 0.05).max(0.4),
            });
        }
        Ok(vec![Paint::Group {
            x: text.baseline[0],
            y: text.baseline[1],
            bounds: [0., -text.ascent, width, text.ascent + text.font_size * 0.35],
            transform: [text.width / width, 0., 0., 1., 0., 0.],
            clip: None,
            opacity: f64::from(text.color[3]) / 255.,
            paints,
        }])
    }
}

#[derive(Default)]
pub(super) struct Resources {
    states: BTreeMap<(u64, u64), usize>,
}
impl Resources {
    fn alpha(&mut self, objects: &mut Objects, fill: f64, stroke: f64) -> String {
        let key = (fill.to_bits(), stroke.to_bits());
        let id = *self.states.entry(key).or_insert_with(|| {
            objects.add(format!("<< /Type /ExtGState /ca {fill} /CA {stroke} >>").into_bytes())
        });
        format!("/GS{id} gs\n")
    }
    pub(super) fn entries(content: &str) -> String {
        format!("/ExtGState << {} >>", references(content, "/GS"))
    }
    pub(super) fn forms(content: &str) -> String {
        references(content, "/V")
    }
}
fn references(content: &str, prefix: &str) -> String {
    content
        .split_ascii_whitespace()
        .filter_map(|word| word.strip_prefix(prefix)?.parse::<usize>().ok())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .map(|id| format!("{prefix}{id} {id} 0 R "))
        .collect()
}
async fn path_ops(path: &scene::Path, out: &mut String) {
    for (index, segment) in path.segments.iter().enumerate() {
        if index % 256 == 0 {
            yield_now().await;
        }
        match segment {
            scene::PathSegment::MoveTo([x, y]) => writeln!(out, "{x:.6} {:.6} m", -y).unwrap(),
            scene::PathSegment::LineTo([x, y]) => writeln!(out, "{x:.6} {:.6} l", -y).unwrap(),
            scene::PathSegment::CurveTo([a, b, c, d, e, f]) => {
                writeln!(out, "{a:.6} {:.6} {c:.6} {:.6} {e:.6} {:.6} c", -b, -d, -f).unwrap()
            }
            scene::PathSegment::Close => out.push_str("h\n"),
        }
    }
}
async fn clip_ops(path: &scene::Path, out: &mut String) {
    path_ops(path, out).await;
    out.push_str(if path.rule == scene::FillRule::EvenOdd {
        "W* n\n"
    } else {
        "W n\n"
    });
}
/// Group content uses a PDF origin at the scene's top-left (negative PDF y).
pub(super) async fn write_vector(
    paint: &Paint,
    height: f64,
    content: &mut String,
    objects: &mut Objects,
    resources: &mut Resources,
    layout: &PdfDocument,
    usages: &[FontUse],
    font_resources: &str,
    image_resources: &str,
) {
    match paint {
        Paint::Path {
            x,
            y,
            path,
            fill,
            stroke,
        } => {
            writeln!(content, "q 1 0 0 1 {x:.6} {:.6} cm", height - y).unwrap();
            content.push_str(&resources.alpha(
                objects,
                fill.map_or(1., |c| f64::from(c[3]) / 255.),
                stroke.as_ref().map_or(1., |s| f64::from(s.color[3]) / 255.),
            ));
            if let Some(c) = fill {
                writeln!(
                    content,
                    "{} {} {} rg",
                    f64::from(c[0]) / 255.,
                    f64::from(c[1]) / 255.,
                    f64::from(c[2]) / 255.
                )
                .unwrap();
            }
            if let Some(s) = stroke {
                writeln!(
                    content,
                    "{} {} {} RG {} w {} J {} j {} M [{}] {} d",
                    f64::from(s.color[0]) / 255.,
                    f64::from(s.color[1]) / 255.,
                    f64::from(s.color[2]) / 255.,
                    s.width,
                    match s.line_cap {
                        scene::LineCap::Butt => 0,
                        scene::LineCap::Round => 1,
                        scene::LineCap::Square => 2,
                    },
                    match s.line_join {
                        scene::LineJoin::Miter => 0,
                        scene::LineJoin::Round => 1,
                        scene::LineJoin::Bevel => 2,
                    },
                    s.miter_limit,
                    s.dash
                        .iter()
                        .map(|v| v.to_string())
                        .collect::<Vec<_>>()
                        .join(" "),
                    s.dash_offset
                )
                .unwrap();
            }
            path_ops(path, content).await;
            content.push_str(match (fill.is_some(), stroke.is_some(), path.rule) {
                (true, true, scene::FillRule::EvenOdd) => "B*\n",
                (true, true, _) => "B\n",
                (true, false, scene::FillRule::EvenOdd) => "f*\n",
                (true, false, _) => "f\n",
                (false, true, _) => "S\n",
                _ => "n\n",
            });
            content.push_str("Q\n");
        }
        Paint::Group {
            x,
            y,
            bounds,
            transform,
            clip,
            opacity,
            paints,
        } => {
            let [a, b, c, d, e, f] = transform;
            writeln!(
                content,
                "q 1 0 0 1 {x:.6} {:.6} cm {a:.6} {:.6} {:.6} {d:.6} {e:.6} {:.6} cm",
                height - y,
                -b,
                -c,
                -f
            )
            .unwrap();
            if *opacity == 1. {
                if let Some(clip) = clip {
                    clip_ops(clip, content).await;
                }
                Box::pin(write_paints(
                    paints,
                    0.,
                    content,
                    objects,
                    resources,
                    layout,
                    usages,
                    font_resources,
                    image_resources,
                ))
                .await;
            } else {
                let mut group = String::new();
                group.push_str(&resources.alpha(objects, 1., 1.));
                if let Some(clip) = clip {
                    clip_ops(clip, &mut group).await;
                }
                Box::pin(write_paints(
                    paints,
                    0.,
                    &mut group,
                    objects,
                    resources,
                    layout,
                    usages,
                    font_resources,
                    image_resources,
                ))
                .await;
                let [left, top, width, height] = bounds;
                let header = format!(
                    "/Type /XObject /Subtype /Form /BBox [{left} {} {} {}] /Group << /S /Transparency /I true /K false >> /Resources << /Font << {font_resources} >> /XObject << {image_resources} {} >> {} >>",
                    -top - height,
                    left + width,
                    -top,
                    Resources::forms(&group),
                    Resources::entries(&group)
                );
                let id = objects.stream(&header, group.as_bytes(), true).await;
                content.push_str(&resources.alpha(objects, *opacity, *opacity));
                writeln!(content, "/V{id} Do").unwrap();
            }
            content.push_str("Q\n");
        }
        _ => unreachable!(),
    }
}
