//! Canonical SVG serialization of the retained semantic scene, without layout.
use crate::{
    cooperate,
    vector::{self, Color, FillRule, LineCap, LineJoin, Node, NodeKind, Path, PathSegment, Scene},
};
use std::collections::BTreeSet;

fn escape(text: &str) -> Result<String, String> {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\0'..='\u{8}' | '\u{b}'..='\u{c}' | '\u{e}'..='\u{1f}' | '\u{fffe}' | '\u{ffff}')
        {
            return Err("Invalid XML character in vector scene".into());
        }
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    Ok(out)
}
fn color(c: Color) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}
fn rule(r: FillRule) -> &'static str {
    match r {
        FillRule::NonZero => "nonzero",
        FillRule::EvenOdd => "evenodd",
    }
}
struct Writer {
    out: String,
    next: usize,
    ids: BTreeSet<String>,
}
impl Writer {
    fn push(&mut self, value: &str) -> Result<(), String> {
        if value.len() > (64 * 1024 * 1024usize).saturating_sub(self.out.len()) {
            return Err("SVG output byte limit exceeded".into());
        }
        self.out.push_str(value);
        Ok(())
    }
    async fn path(&mut self, path: &Path) -> Result<(), String> {
        for (i, segment) in path.segments.iter().enumerate() {
            if i % 256 == 0 {
                cooperate::yield_now().await;
            }
            match segment {
                PathSegment::MoveTo([x, y]) => self.push(&format!("M{x} {y} "))?,
                PathSegment::LineTo([x, y]) => self.push(&format!("L{x} {y} "))?,
                PathSegment::CurveTo([x1, y1, x2, y2, x, y]) => {
                    self.push(&format!("C{x1} {y1} {x2} {y2} {x} {y} "))?
                }
                PathSegment::Close => self.push("Z ")?,
            }
        }
        Ok(())
    }
    async fn base64(&mut self, bytes: &[u8]) -> Result<(), String> {
        const DIGITS: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (index, chunk) in bytes.chunks(3).enumerate() {
            if index % 4096 == 0 {
                cooperate::yield_now().await;
            }
            let n = (u32::from(chunk[0]) << 16)
                | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
                | u32::from(*chunk.get(2).unwrap_or(&0));
            let encoded = [
                DIGITS[(n >> 18) as usize],
                DIGITS[((n >> 12) & 63) as usize],
                if chunk.len() > 1 {
                    DIGITS[((n >> 6) & 63) as usize]
                } else {
                    b'='
                },
                if chunk.len() > 2 {
                    DIGITS[(n & 63) as usize]
                } else {
                    b'='
                },
            ];
            self.push(std::str::from_utf8(&encoded).unwrap())?;
        }
        Ok(())
    }
    async fn node(&mut self, node: &Node) -> Result<(), String> {
        cooperate::yield_now().await;
        self.push("<g")?;
        if let Some(id) = &node.id {
            self.push(&format!(" id=\"{}\"", escape(id)?))?;
        }
        let [a, b, c, d, e, f] = node.transform;
        self.push(&format!(
            " transform=\"matrix({a} {b} {c} {d} {e} {f})\" opacity=\"{}\">",
            node.opacity
        ))?;
        if let Some(clip) = &node.clip {
            let id = loop {
                self.next += 1;
                let id = format!("document-vector-clip-{}", self.next);
                if self.ids.insert(id.clone()) {
                    break id;
                }
            };
            self.push(&format!("<defs><clipPath id=\"{id}\" clipPathUnits=\"userSpaceOnUse\"><path clip-rule=\"{}\" d=\"",rule(clip.rule)))?;
            self.path(clip).await?;
            self.push(&format!(
                "\"/></clipPath></defs><g clip-path=\"url(#{id})\">"
            ))?;
        }
        match &node.kind {
            NodeKind::Group(children) => {
                for child in children {
                    Box::pin(self.node(child)).await?;
                }
            }
            NodeKind::Path { path, fill, stroke } => {
                self.push("<path d=\"")?;
                self.path(path).await?;
                self.push(&format!("\" fill-rule=\"{}\"", rule(path.rule)))?;
                if let Some(fill) = fill {
                    self.push(&format!(
                        " fill=\"{}\" fill-opacity=\"{}\"",
                        color(*fill),
                        f64::from(fill[3]) / 255.
                    ))?;
                } else {
                    self.push(" fill=\"none\"")?;
                }
                if let Some(stroke) = stroke {
                    self.push(&format!(" stroke=\"{}\" stroke-opacity=\"{}\" stroke-width=\"{}\" stroke-linecap=\"{}\" stroke-linejoin=\"{}\" stroke-miterlimit=\"{}\"",color(stroke.color),f64::from(stroke.color[3])/255.,stroke.width,match stroke.line_cap{LineCap::Butt=>"butt",LineCap::Round=>"round",LineCap::Square=>"square"},match stroke.line_join{LineJoin::Miter=>"miter",LineJoin::Round=>"round",LineJoin::Bevel=>"bevel"},stroke.miter_limit))?;
                    if !stroke.dash.is_empty() {
                        self.push(&format!(
                            " stroke-dasharray=\"{}\" stroke-dashoffset=\"{}\"",
                            stroke
                                .dash
                                .iter()
                                .map(f64::to_string)
                                .collect::<Vec<_>>()
                                .join(" "),
                            stroke.dash_offset
                        ))?;
                    }
                }
                self.push("/>")?;
            }
            NodeKind::Text(text) => {
                let decoration = match (text.underline, text.strike) {
                    (true, true) => "underline line-through",
                    (true, false) => "underline",
                    (false, true) => "line-through",
                    _ => "none",
                };
                self.push(&format!("<text xml:space=\"preserve\" x=\"{}\" y=\"{}\" textLength=\"{}\" data-vector-ascent=\"{}\" lengthAdjust=\"spacingAndGlyphs\" font-size=\"{}\" font-family=\"{}\" font-weight=\"{}\" font-style=\"{}\" text-decoration=\"{decoration}\" fill=\"{}\" fill-opacity=\"{}\">{}</text>",text.baseline[0],text.baseline[1],text.width,text.ascent,text.font_size,escape(&text.font_family)?,if text.bold{"700"}else{"400"},if text.italic{"italic"}else{"normal"},color(text.color),f64::from(text.color[3])/255.,escape(&text.text)?))?;
            }
            NodeKind::Raster(image) => {
                if image.link.is_some() {
                    return Err("SVG scene raster hyperlinks are unsupported".into());
                }
                let [x, y, w, h] = node.bounds;
                self.push(&format!("<image x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" preserveAspectRatio=\"none\" href=\"data:{};base64,",escape(&image.mime)?))?;
                self.base64(&image.bytes).await?;
                self.push("\">")?;
                if !image.title.is_empty() {
                    self.push(&format!("<title>{}</title>", escape(&image.title)?))?;
                }
                if !image.alt.is_empty() {
                    self.push(&format!("<desc>{}</desc>", escape(&image.alt)?))?;
                }
                self.push("</image>")?;
            }
        }
        if node.clip.is_some() {
            self.push("</g>")?;
        }
        self.push("</g>")
    }
}
/// Serialize the exact semantic scene for screen display. Explicit CSS pixel
/// dimensions preserve the SVG source's physical size while viewBox uses points.
pub async fn to_svg(scene: &Scene) -> Result<String, String> {
    vector::validate_async(scene).await?;
    let mut writer = Writer {
        out: String::new(),
        next: 0,
        ids: BTreeSet::new(),
    };
    let mut pending = vec![scene.nodes.as_slice()];
    while let Some(nodes) = pending.pop() {
        for node in nodes {
            cooperate::yield_now().await;
            if let Some(id) = &node.id {
                writer.ids.insert(id.clone());
            }
            if let NodeKind::Group(children) = &node.kind {
                pending.push(children);
            }
        }
    }
    writer.push(&format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\">",scene.width*4./3.,scene.height*4./3.,scene.width,scene.height))?;
    for node in &scene.nodes {
        writer.node(node).await?;
    }
    writer.push("</svg>")?;
    Ok(writer.out)
}
