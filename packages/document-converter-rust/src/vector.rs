//! Canonical JSON for positioned vector scenes. No resource fetching or rasterization.
use super::{Error, Result, array, field, number, string};
use document_ast_rust::{Image, cooperate, vector::*};
use mcp_protocol_rust::{formats, json::Value};
const MAX_NODES: usize = 200_000;
const MAX_BYTES: usize = 64 * 1024 * 1024;

fn invalid(message: impl Into<String>) -> Error {
    Error::new("E_AST", message)
}
fn object(value: &Value, allowed: &[&str]) -> Result<()> {
    let Value::Object(fields) = value else {
        return Err(invalid("Expected vector object"));
    };
    let mut seen = std::collections::BTreeSet::new();
    for (key, _) in fields {
        let key = String::from_utf16(key).map_err(|_| invalid("Invalid vector field name"))?;
        if !allowed.contains(&key.as_str()) || !seen.insert(key.clone()) {
            return Err(invalid(format!("Unknown or duplicate vector field: {key}")));
        }
    }
    Ok(())
}
fn numbers<const N: usize>(value: &Value) -> Result<[f64; N]> {
    let values = array(value)?;
    if values.len() != N {
        return Err(invalid("Invalid vector coordinate count"));
    }
    let mut result = [0.; N];
    for (out, value) in result.iter_mut().zip(values) {
        *out = number(value)?;
        if !out.is_finite() || out.abs() > 1e9 {
            return Err(invalid("Invalid vector coordinate"));
        }
    }
    Ok(result)
}
fn color(value: &Value) -> Result<Color> {
    let values = numbers::<4>(value)?;
    if values
        .iter()
        .any(|n| !(0. ..=255.).contains(n) || n.fract() != 0.)
    {
        return Err(invalid("Vector RGBA channels must be bytes"));
    }
    Ok(values.map(|n| n as u8))
}
fn boolean(value: &Value) -> Result<bool> {
    if let Value::Bool(b) = value {
        Ok(*b)
    } else {
        Err(invalid("Expected vector boolean"))
    }
}
fn optional(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !matches!(v, Value::Null))
}
#[derive(Default)]
struct Budget {
    nodes: usize,
    bytes: usize,
}
impl Budget {
    fn count(&mut self, amount: usize) -> Result<()> {
        self.nodes = self.nodes.saturating_add(amount);
        if self.nodes > MAX_NODES {
            return Err(Error::new("E_LIMIT", "Vector content limit exceeded"));
        }
        Ok(())
    }
    fn bytes(&mut self, amount: usize) -> Result<()> {
        self.bytes = self.bytes.saturating_add(amount);
        if self.bytes > MAX_BYTES {
            return Err(Error::new("E_LIMIT", "Vector content exceeds 64 MiB"));
        }
        Ok(())
    }
    fn text(&mut self, value: &Value) -> Result<String> {
        if let Value::String(units) = value {
            if units.len() > MAX_BYTES.saturating_sub(self.bytes) {
                return Err(Error::new("E_LIMIT", "Vector content exceeds 64 MiB"));
            }
        }
        let s = string(value)?;
        self.bytes(s.len())?;
        Ok(s)
    }
    async fn path(&mut self, value: &Value) -> Result<Path> {
        object(value, &["segments", "rule"])?;
        let segments = array(field(value, "segments")?)?;
        self.count(segments.len())?;
        let rule = match string(field(value, "rule")?)?.as_str() {
            "nonzero" => FillRule::NonZero,
            "evenodd" => FillRule::EvenOdd,
            _ => return Err(invalid("Unknown vector fill rule")),
        };
        let mut out = Vec::with_capacity(segments.len());
        for segment in segments {
            cooperate::yield_now().await;
            let parts = array(segment)?;
            let Some(first) = parts.first() else {
                return Err(invalid("Empty vector path segment"));
            };
            let coordinates = Value::Array(parts[1..].to_vec());
            out.push(match string(first)?.as_str() {
                "M" => PathSegment::MoveTo(numbers(&coordinates)?),
                "L" => PathSegment::LineTo(numbers(&coordinates)?),
                "C" => PathSegment::CurveTo(numbers(&coordinates)?),
                "Z" if parts.len() == 1 => PathSegment::Close,
                _ => return Err(invalid("Unsupported vector path segment")),
            });
        }
        let path = Path {
            segments: out,
            rule,
        };
        validate_path(&path).await.map_err(invalid)?;
        Ok(path)
    }
    fn stroke(&mut self, value: &Value) -> Result<Stroke> {
        object(
            value,
            &[
                "color",
                "width",
                "dash",
                "dashOffset",
                "lineCap",
                "lineJoin",
                "miterLimit",
            ],
        )?;
        let dash = array(field(value, "dash")?)?;
        if dash.len() > 10_000 {
            return Err(Error::new("E_LIMIT", "Vector dash limit exceeded"));
        }
        self.count(dash.len())?;
        let stroke = Stroke {
            color: color(field(value, "color")?)?,
            width: number(field(value, "width")?)?,
            dash: dash.iter().map(number).collect::<Result<_>>()?,
            dash_offset: number(field(value, "dashOffset")?)?,
            line_cap: match string(field(value, "lineCap")?)?.as_str() {
                "butt" => LineCap::Butt,
                "round" => LineCap::Round,
                "square" => LineCap::Square,
                _ => return Err(invalid("Unknown vector line cap")),
            },
            line_join: match string(field(value, "lineJoin")?)?.as_str() {
                "miter" => LineJoin::Miter,
                "round" => LineJoin::Round,
                "bevel" => LineJoin::Bevel,
                _ => return Err(invalid("Unknown vector line join")),
            },
            miter_limit: number(field(value, "miterLimit")?)?,
        };
        validate_stroke(&stroke).map_err(invalid)?;
        Ok(stroke)
    }
    async fn nodes(&mut self, value: &Value, depth: usize) -> Result<Vec<Node>> {
        if depth > 64 {
            return Err(Error::new("E_LIMIT", "Vector nesting exceeds 64 levels"));
        }
        let values = array(value)?;
        self.count(values.len())?;
        let mut nodes = Vec::with_capacity(values.len());
        for value in values {
            cooperate::yield_now().await;
            let kind = string(field(value, "kind")?)?;
            let mut fields = vec!["id", "bounds", "transform", "opacity", "clip", "kind"];
            fields.extend(match kind.as_str() {
                "group" => vec!["children"],
                "path" => vec!["path", "fill", "stroke"],
                "text" => vec!["text"],
                "raster" => vec!["image"],
                _ => return Err(invalid("Unknown vector node kind")),
            });
            object(value, &fields)?;
            let id = optional(value.get("id"))
                .map(|v| self.text(v))
                .transpose()?;
            let bounds = numbers(field(value, "bounds")?)?;
            let transform = numbers(field(value, "transform")?)?;
            let opacity = number(field(value, "opacity")?)?;
            let clip = match optional(value.get("clip")) {
                Some(v) => Some(self.path(v).await?),
                None => None,
            };
            let kind = match kind.as_str() {
                "group" => NodeKind::Group(
                    Box::pin(self.nodes(field(value, "children")?, depth + 1)).await?,
                ),
                "path" => NodeKind::Path {
                    path: self.path(field(value, "path")?).await?,
                    fill: optional(value.get("fill")).map(color).transpose()?,
                    stroke: optional(value.get("stroke"))
                        .map(|v| self.stroke(v))
                        .transpose()?,
                },
                "text" => {
                    let v = field(value, "text")?;
                    object(
                        v,
                        &[
                            "text",
                            "baseline",
                            "width",
                            "ascent",
                            "fontSize",
                            "fontFamily",
                            "bold",
                            "italic",
                            "underline",
                            "strike",
                            "color",
                        ],
                    )?;
                    NodeKind::Text(Text {
                        text: self.text(field(v, "text")?)?,
                        baseline: numbers(field(v, "baseline")?)?,
                        width: number(field(v, "width")?)?,
                        ascent: number(field(v, "ascent")?)?,
                        font_size: number(field(v, "fontSize")?)?,
                        font_family: self.text(field(v, "fontFamily")?)?,
                        bold: boolean(field(v, "bold")?)?,
                        italic: boolean(field(v, "italic")?)?,
                        underline: boolean(field(v, "underline")?)?,
                        strike: boolean(field(v, "strike")?)?,
                        color: color(field(v, "color")?)?,
                    })
                }
                "raster" => {
                    let v = field(value, "image")?;
                    object(v, &["data", "width", "height", "alt", "title", "link"])?;
                    let data = string(field(v, "data")?)?;
                    let (prefix, encoded) = data.split_once(',').ok_or_else(|| {
                        invalid("Vector raster must contain an embedded data URL")
                    })?;
                    let mime = prefix
                        .strip_prefix("data:")
                        .and_then(|s| s.strip_suffix(";base64"))
                        .ok_or_else(|| invalid("Vector raster must contain a base64 data URL"))?;
                    if !matches!(
                        mime,
                        "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/tiff"
                    ) {
                        return Err(invalid("Unsupported vector raster MIME type"));
                    }
                    self.bytes(encoded.len().saturating_div(4).saturating_mul(3))?;
                    if !formats::is_base64(&encoded.encode_utf16().collect::<Vec<_>>()) {
                        return Err(invalid("Invalid vector raster base64"));
                    }
                    let bytes = formats::base64_decode(encoded).map_err(invalid)?;
                    let header = terminal_png_rust::office_image::characterize(&bytes)
                        .await
                        .map_err(invalid)?;
                    if header.mime != mime {
                        return Err(invalid("Vector raster MIME does not match its bytes"));
                    }
                    NodeKind::Raster(Image {
                        bytes,
                        mime: mime.into(),
                        width: number(field(v, "width")?)?,
                        height: number(field(v, "height")?)?,
                        alt: self.text(field(v, "alt")?)?,
                        title: self.text(field(v, "title")?)?,
                        link: optional(v.get("link")).map(|v| self.text(v)).transpose()?,
                    })
                }
                _ => unreachable!(),
            };
            nodes.push(Node {
                id,
                bounds,
                transform,
                opacity,
                clip,
                kind,
            });
        }
        Ok(nodes)
    }
}
/// Parse and validate the complete scene before exposing it to either writer.
pub async fn from_json(value: &Value) -> Result<Scene> {
    object(value, &["width", "height", "nodes"])?;
    let scene = Scene {
        width: number(field(value, "width")?)?,
        height: number(field(value, "height")?)?,
        nodes: Budget::default().nodes(field(value, "nodes")?, 0).await?,
    };
    validate_async(&scene).await.map_err(invalid)?;
    Ok(scene)
}
fn s(v: &str) -> Value {
    Value::String(v.encode_utf16().collect())
}
fn n(v: f64) -> Value {
    Value::Number(v)
}
fn obj(fields: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn nums(v: impl IntoIterator<Item = f64>) -> Value {
    Value::Array(v.into_iter().map(n).collect())
}
fn rgba(v: Color) -> Value {
    nums(v.map(f64::from))
}
fn path_json(path: &Path) -> Value {
    obj([
        (
            "rule",
            s(match path.rule {
                FillRule::NonZero => "nonzero",
                FillRule::EvenOdd => "evenodd",
            }),
        ),
        (
            "segments",
            Value::Array(
                path.segments
                    .iter()
                    .map(|segment| {
                        let (tag, points): (&str, &[f64]) = match segment {
                            PathSegment::MoveTo(p) => ("M", p),
                            PathSegment::LineTo(p) => ("L", p),
                            PathSegment::CurveTo(p) => ("C", p),
                            PathSegment::Close => ("Z", &[]),
                        };
                        Value::Array(
                            std::iter::once(s(tag))
                                .chain(points.iter().copied().map(n))
                                .collect(),
                        )
                    })
                    .collect(),
            ),
        ),
    ])
}
fn stroke_json(v: &Stroke) -> Value {
    obj([
        ("color", rgba(v.color)),
        ("width", n(v.width)),
        ("dash", nums(v.dash.iter().copied())),
        ("dashOffset", n(v.dash_offset)),
        (
            "lineCap",
            s(match v.line_cap {
                LineCap::Butt => "butt",
                LineCap::Round => "round",
                LineCap::Square => "square",
            }),
        ),
        (
            "lineJoin",
            s(match v.line_join {
                LineJoin::Miter => "miter",
                LineJoin::Round => "round",
                LineJoin::Bevel => "bevel",
            }),
        ),
        ("miterLimit", n(v.miter_limit)),
    ])
}
fn base64(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let v = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(DIGITS[(v >> 18) as usize] as char);
        out.push(DIGITS[((v >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            DIGITS[((v >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            DIGITS[(v & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
async fn nodes_json(nodes: &[Node]) -> Vec<Value> {
    let mut out = Vec::with_capacity(nodes.len());
    for node in nodes {
        cooperate::yield_now().await;
        let mut fields = vec![
            ("id", node.id.as_deref().map(s).unwrap_or(Value::Null)),
            ("bounds", nums(node.bounds)),
            ("transform", nums(node.transform)),
            ("opacity", n(node.opacity)),
            (
                "clip",
                node.clip.as_ref().map(path_json).unwrap_or(Value::Null),
            ),
        ];
        match &node.kind {
            NodeKind::Group(children) => fields.extend([
                ("kind", s("group")),
                (
                    "children",
                    Value::Array(Box::pin(nodes_json(children)).await),
                ),
            ]),
            NodeKind::Path { path, fill, stroke } => fields.extend([
                ("kind", s("path")),
                ("path", path_json(path)),
                ("fill", fill.map(rgba).unwrap_or(Value::Null)),
                (
                    "stroke",
                    stroke.as_ref().map(stroke_json).unwrap_or(Value::Null),
                ),
            ]),
            NodeKind::Text(t) => fields.extend([
                ("kind", s("text")),
                (
                    "text",
                    obj([
                        ("text", s(&t.text)),
                        ("baseline", nums(t.baseline)),
                        ("width", n(t.width)),
                        ("ascent", n(t.ascent)),
                        ("fontSize", n(t.font_size)),
                        ("fontFamily", s(&t.font_family)),
                        ("bold", Value::Bool(t.bold)),
                        ("italic", Value::Bool(t.italic)),
                        ("underline", Value::Bool(t.underline)),
                        ("strike", Value::Bool(t.strike)),
                        ("color", rgba(t.color)),
                    ]),
                ),
            ]),
            NodeKind::Raster(image) => fields.extend([
                ("kind", s("raster")),
                (
                    "image",
                    obj([
                        (
                            "data",
                            s(&format!(
                                "data:{};base64,{}",
                                image.mime,
                                base64(&image.bytes)
                            )),
                        ),
                        ("width", n(image.width)),
                        ("height", n(image.height)),
                        ("alt", s(&image.alt)),
                        ("title", s(&image.title)),
                        ("link", image.link.as_deref().map(s).unwrap_or(Value::Null)),
                    ]),
                ),
            ]),
        }
        out.push(obj(fields));
    }
    out
}
/// Serialize the same public schema used by drawing requests and Pandoc Vector.
pub async fn to_json(scene: &Scene) -> Result<Value> {
    validate_async(scene).await.map_err(invalid)?;
    Ok(obj([
        ("width", n(scene.width)),
        ("height", n(scene.height)),
        ("nodes", Value::Array(nodes_json(&scene.nodes).await)),
    ]))
}
