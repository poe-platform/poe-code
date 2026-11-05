use super::super::{
    SvgChild, SvgEl, parse_color, parse_svg_length_px, parse_svg_xml_impl, svg_format_num,
    svg_numbers, svg_tokens, xml_unescape_str,
};
use super::{
    PageSource, RasterOptions,
    pdf_copy::{WIDTHS, literal, write_objects},
    pdf_render::win_ansi,
};
use std::collections::BTreeMap;
const K: f64 = 0.5522847498;
fn num(n: f64) -> String {
    svg_format_num(n, 6)
}
fn op(n: &[f64], op: &str) -> String {
    format!(
        "{} {op}",
        n.iter().map(|&v| num(v)).collect::<Vec<_>>().join(" ")
    )
}
fn color(name: &str, operator: &str) -> Result<String, String> {
    let rgba = match name.trim().to_ascii_lowercase().as_str() {
        "gray" | "grey" => [128, 128, 128, 255],
        _ => parse_color(name)?,
    };
    Ok(op(
        &rgba[..3]
            .iter()
            .map(|&b| f64::from(b) / 255.)
            .collect::<Vec<_>>(),
        operator,
    ))
}
pub(in crate::commands::archive) fn render_svg(
    source: &str,
    format: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let root = parse_svg_xml_impl(source, false)?;
    let root_local = root.name.rsplit(':').next().unwrap_or(&root.name);
    if root_local != "svg" {
        return Err("Expected SVG document".to_string());
    }
    let root_attrs: BTreeMap<String, String> = root
        .attrs
        .iter()
        .map(|(k, v)| {
            (
                k.rsplit(':').next().unwrap_or(k).to_string(),
                xml_unescape_str(v),
            )
        })
        .collect();
    if let Some(par) = root_attrs.get("preserveAspectRatio")
        && par != "xMidYMid meet"
        && par != "xMidYMid"
    {
        return Err("Unsupported SVG preserveAspectRatio".to_string());
    }
    let vbox = if let Some(vb) = root_attrs.get("viewBox") {
        let nums = svg_numbers(vb)?;
        if nums.len() != 4 || nums[2] <= 0.0 || nums[3] <= 0.0 {
            return Err("Invalid SVG viewBox".to_string());
        }
        Some(nums)
    } else {
        None
    };
    let width = parse_svg_length_px(
        root_attrs.get("width").map(|s| s.as_str()),
        vbox.as_ref().map(|b| b[2]).unwrap_or(300.0),
    )?;
    let height = parse_svg_length_px(
        root_attrs.get("height").map(|s| s.as_str()),
        vbox.as_ref().map(|b| b[3]).unwrap_or(150.0),
    )?;
    let pixels = width.ceil() * height.ceil();
    if !(width > 0.0 && height > 0.0) || !pixels.is_finite() || pixels > 16_000_000.0 {
        return Err("SVG pixel limit exceeded".to_string());
    }

    fn visit(
        node: &SvgEl,
        inherited: &BTreeMap<String, String>,
        is_root: bool,
        ops: &mut Vec<String>,
        font: &mut bool,
        limit: usize,
    ) -> Result<(), String> {
        let local_name = node.name.rsplit(':').next().unwrap_or(&node.name);
        let mut own: BTreeMap<String, String> = BTreeMap::new();
        for (k, v) in &node.attrs {
            own.insert(
                k.rsplit(':').next().unwrap_or(k).to_string(),
                xml_unescape_str(v),
            );
        }
        let mut a = inherited.clone();
        for (k, v) in &own {
            a.insert(k.clone(), v.clone());
        }
        if let Some(style) = own.get("style") {
            for decl in style.split(';') {
                if let Some((sk, sv)) = decl.split_once(':') {
                    a.insert(sk.trim().to_string(), sv.trim().to_string());
                }
            }
        }
        if a.get("display").map(|s| s.as_str()) == Some("none")
            || a.get("visibility").map(|s| s.as_str()) == Some("hidden")
        {
            return Ok(());
        }
        if matches!(local_name, "defs" | "title" | "desc" | "metadata") {
            return Ok(());
        }
        for key in [
            "clip-path",
            "mask",
            "filter",
            "marker-start",
            "marker-mid",
            "marker-end",
        ] {
            if let Some(v) = a.get(key)
                && !v.is_empty()
                && v != "none"
            {
                return Err(format!("Unsupported SVG {key}"));
            }
        }
        for key in ["opacity", "fill-opacity", "stroke-opacity"] {
            if let Some(v) = a.get(key)
                && v.trim().parse::<f64>().ok() != Some(1.0)
            {
                return Err(format!("Unsupported SVG {key}"));
            }
        }
        if !is_root && local_name == "svg" {
            return Err("Unsupported nested SVG viewport".to_string());
        }
        ops.push("q".into());
        if let Some(tf) = own.get("transform") {
            transforms(tf, ops)?;
        }
        if let Some(da) = a.get("stroke-dasharray")
            && !da.is_empty()
            && da != "none"
        {
            let mut dash = svg_numbers(da)?;
            if dash.is_empty() || dash.iter().any(|&v| v < 0.0) {
                return Err("Invalid SVG dash array".to_string());
            }
            if dash.len() % 2 == 1 {
                dash.extend_from_within(..);
            }
            let offset = parse_svg_length_px(a.get("stroke-dashoffset").map(|s| s.as_str()), 0.0)?;
            ops.push(format!(
                "[{}] {} d",
                dash.iter().map(|&n| num(n)).collect::<Vec<_>>().join(" "),
                num(offset)
            ));
        }
        if let Some(lc) = a.get("stroke-linecap")
            && !lc.is_empty()
            && !matches!(lc.as_str(), "butt" | "round" | "square")
        {
            return Err("Invalid SVG stroke-linecap".to_string());
        }
        if let Some(lj) = a.get("stroke-linejoin")
            && !lj.is_empty()
            && !matches!(lj.as_str(), "miter" | "round" | "bevel")
        {
            return Err("Invalid SVG stroke-linejoin".to_string());
        }
        let n = |key: &str, fallback: f64| -> Result<f64, String> {
            parse_svg_length_px(a.get(key).map(|s| s.as_str()), fallback)
        };
        for (key, values, operator) in [
            ("stroke-linecap", ["butt", "round", "square"], "J"),
            ("stroke-linejoin", ["miter", "round", "bevel"], "j"),
        ] {
            if let Some(style) = a.get(key)
                && let Some(i) = values.iter().position(|v| *v == style)
            {
                ops.push(op(&[i as f64], operator));
            }
        }
        let mut path = Vec::new();
        match local_name {
            "svg" | "g" | "a" => {}
            "rect" => {
                let (x, y, w, h) = (n("x", 0.)?, n("y", 0.)?, n("width", 0.)?, n("height", 0.)?);
                let rx = n("rx", n("ry", 0.)?)?;
                let ry = n("ry", rx)?;
                if [w, h, rx, ry].into_iter().any(|v| v < 0.) {
                    return Err("Negative SVG rectangle size".into());
                }
                if w > 0. && h > 0. {
                    let (rx, ry) = (rx.min(w / 2.), ry.min(h / 2.));
                    if rx == 0. || ry == 0. {
                        path.push(op(&[x, y, w, h], "re"));
                    } else {
                        let (r, b) = (x + w, y + h);
                        let (kx, ky) = (rx * K, ry * K);
                        path.extend([
                            op(&[x + rx, y], "m"),
                            op(&[r - rx, y], "l"),
                            op(&[r - rx + kx, y, r, y + ry - ky, r, y + ry], "c"),
                            op(&[r, b - ry], "l"),
                            op(&[r, b - ry + ky, r - rx + kx, b, r - rx, b], "c"),
                            op(&[x + rx, b], "l"),
                            op(&[x + rx - kx, b, x, b - ry + ky, x, b - ry], "c"),
                            op(&[x, y + ry], "l"),
                            op(&[x, y + ry - ky, x + rx - kx, y, x + rx, y], "c"),
                            "h".into(),
                        ]);
                    }
                }
            }
            "circle" | "ellipse" => {
                let (x, y) = (n("cx", 0.)?, n("cy", 0.)?);
                let (rx, ry) = if local_name == "circle" {
                    let r = n("r", 0.)?;
                    (r, r)
                } else {
                    (n("rx", 0.)?, n("ry", 0.)?)
                };
                if rx < 0. || ry < 0. {
                    return Err("Negative SVG radius".into());
                }
                if rx > 0. && ry > 0. {
                    let (kx, ky) = (rx * K, ry * K);
                    path.extend([
                        op(&[x + rx, y], "m"),
                        op(&[x + rx, y + ky, x + kx, y + ry, x, y + ry], "c"),
                        op(&[x - kx, y + ry, x - rx, y + ky, x - rx, y], "c"),
                        op(&[x - rx, y - ky, x - kx, y - ry, x, y - ry], "c"),
                        op(&[x + kx, y - ry, x + rx, y - ky, x + rx, y], "c"),
                        "h".into(),
                    ]);
                }
            }
            "line" => path.extend([
                op(&[n("x1", 0.)?, n("y1", 0.)?], "m"),
                op(&[n("x2", 0.)?, n("y2", 0.)?], "l"),
            ]),
            "polygon" | "polyline" => {
                let p = svg_numbers(a.get("points").map(String::as_str).unwrap_or(""))?;
                if p.len() % 2 != 0 {
                    return Err("Invalid SVG points".into());
                }
                for (i, xy) in p.chunks_exact(2).enumerate() {
                    path.push(op(xy, if i == 0 { "m" } else { "l" }));
                }
                if local_name == "polygon" {
                    path.push("h".into());
                }
            }
            "path" => path = path_ops(a.get("d").map(String::as_str).unwrap_or(""))?,
            "text" => {
                if node.children.iter().any(|c| matches!(c, SvgChild::El(_))) {
                    return Err("Unsupported SVG text children".into());
                }
                if a.get("fill").is_none_or(|v| v != "none") {
                    if a.get("stroke")
                        .is_some_and(|v| !v.is_empty() && v != "none")
                    {
                        return Err("Unsupported SVG text stroke".into());
                    }
                    let text: String = node
                        .children
                        .iter()
                        .filter_map(|c| {
                            if let SvgChild::Text(s) = c {
                                Some(xml_unescape_str(s))
                            } else {
                                None
                            }
                        })
                        .collect();
                    let bytes = win_ansi(&text);
                    let size = n("font-size", 16.)?;
                    let advance = bytes
                        .iter()
                        .map(|&b| f64::from(WIDTHS[0][b as usize]))
                        .sum::<f64>()
                        * size
                        / 1000.;
                    let x = n("x", 0.)?
                        - match a.get("text-anchor").map(String::as_str) {
                            Some("middle") => advance / 2.,
                            Some("end") => advance,
                            _ => 0.,
                        };
                    let mut lit = vec![];
                    literal(&bytes, &mut lit);
                    *font = true;
                    ops.extend([
                        "q".into(),
                        "1 0 0 -1 0 0 cm".into(),
                        "q".into(),
                        color(a.get("fill").map_or("black", String::as_str), "rg")?,
                        "BT".into(),
                        format!("/F1 {} Tf", num(size)),
                        op(&[1., 0., 0., 1., x, -n("y", 0.)?], "Tm"),
                        format!("{} Tj", lit.into_iter().map(char::from).collect::<String>()),
                        "ET".into(),
                        "Q".into(),
                        "Q".into(),
                    ]);
                }
            }
            other => return Err(format!("Unsupported SVG element {other}")),
        }
        if !path.is_empty() {
            let fill = a.get("fill").map_or("black", String::as_str);
            let stroke = a.get("stroke").map_or("none", String::as_str);
            let f = fill != "none" && local_name != "line";
            let s = stroke != "none";
            if f || s {
                ops.push("q".into());
                if f {
                    ops.push(color(fill, "rg")?);
                }
                if s {
                    ops.push(color(stroke, "RG")?);
                }
                ops.push(op(&[n("stroke-width", 1.)?], "w"));
                ops.extend(path);
                let mut paint = if f && s {
                    "B"
                } else if f {
                    "f"
                } else {
                    "S"
                }
                .to_string();
                if f && a.get("fill-rule").is_some_and(|v| v == "evenodd") {
                    paint.push('*');
                }
                ops.push(paint);
                ops.push("Q".into());
            }
        }
        if local_name != "text" {
            let mut styles = BTreeMap::new();
            for key in [
                "fill",
                "stroke",
                "stroke-width",
                "fill-rule",
                "font-size",
                "text-anchor",
                "visibility",
                "stroke-dasharray",
                "stroke-dashoffset",
                "stroke-linecap",
                "stroke-linejoin",
            ] {
                if let Some(v) = a.get(key) {
                    styles.insert(key.to_string(), v.clone());
                }
            }
            for ch in &node.children {
                if let SvgChild::El(sub) = ch {
                    visit(sub, &styles, false, ops, font, limit)?;
                }
            }
        }
        ops.push("Q".into());
        if ops.len() > limit / 2 {
            return Err("SVG output exceeds byte limit".into());
        }
        Ok(())
    }

    let (w, h) = (width * 0.75, height * 0.75);
    let mut ops = vec!["q".into(), op(&[0.75, 0., 0., -0.75, 0., h], "cm")];
    if let Some(b) = vbox {
        let scale = (width / b[2]).min(height / b[3]);
        ops.push(op(
            &[
                scale,
                0.,
                0.,
                scale,
                (width - b[2] * scale) / 2. - b[0] * scale,
                (height - b[3] * scale) / 2. - b[1] * scale,
            ],
            "cm",
        ));
    }
    let mut font = false;
    visit(&root, &BTreeMap::new(), true, &mut ops, &mut font, limit)?;
    ops.push("Q".into());
    let stream: Vec<u8> = ops.join("\n").chars().map(|c| c as u8).collect();
    if stream.len() > limit {
        return Err("SVG output exceeds byte limit".into());
    }
    let compressed = crate::commands::codecs::zlib_compress(&stream);
    let mut contents = format!(
        "<<\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
        compressed.len()
    )
    .into_bytes();
    contents.extend_from_slice(&compressed);
    contents.extend_from_slice(b"\nendstream");
    let mut bodies=vec![b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        b"<<\n/Type /Pages\n/Count 1\n/Kids [ 5 0 R ]\n>>".to_vec(),b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec(),contents,
        format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {} {} ]\n/Resources <<\n/Font <<\n{}>>\n>>\n/Contents 4 0 R\n>>",num(w),num(h),if font{"/F1 6 0 R\n"}else{""}).into_bytes()];
    if font {
        bodies.push(b"<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n/Encoding /WinAnsiEncoding\n>>".to_vec());
    }
    let pdf = write_objects(&bodies, limit).ok_or("SVG output exceeds byte limit")?;
    if format == "pdf" {
        return Ok(pdf);
    }
    let mut source = PageSource::open(&pdf,"").map_err(|_| "Invalid SVG page")?;
    source
        .raster(
            1,
            &RasterOptions {
                splash: false,
                tiff: None,
                jpeg: None,
                format: "RGBA",
                color: "rgb",
                transparent: false,
                antialias: true,
                text_aa: true,
                dpi: [96.; 2],
                scale: [0; 3],
                crop: [0.; 4],
                cropbox: false,
                limit,
            },
        )
        .ok_or_else(|| "SVG pixel limit exceeded".into())
}
fn transforms(mut source: &str, ops: &mut Vec<String>) -> Result<(), String> {
    loop {
        source = source.trim_start_matches(|c: char| c.is_whitespace() || c == ',');
        if source.is_empty() {
            return Ok(());
        }
        let (name, rest) = source.split_once('(').ok_or("Invalid SVG transform")?;
        let (values, tail) = rest.split_once(')').ok_or("Invalid SVG transform")?;
        source = tail;
        let args = svg_numbers(values)?;
        let name = name.trim();
        match (name, args.as_slice()) {
            ("matrix", [_, _, _, _, _, _]) => ops.push(op(&args, "cm")),
            ("translate", [x, ..]) if args.len() <= 2 => {
                ops.push(op(&[1., 0., 0., 1., *x, *args.get(1).unwrap_or(&0.)], "cm"))
            }
            ("scale", [x, ..]) if args.len() <= 2 => {
                ops.push(op(&[*x, 0., 0., *args.get(1).unwrap_or(x), 0., 0.], "cm"))
            }
            ("rotate", [angle, ..]) if matches!(args.len(), 1 | 3) => {
                let (x, y) = (
                    args.get(1).copied().unwrap_or(0.),
                    args.get(2).copied().unwrap_or(0.),
                );
                let (s, c) = angle.to_radians().sin_cos();
                ops.extend([
                    op(&[1., 0., 0., 1., x, y], "cm"),
                    op(&[c, s, -s, c, 0., 0.], "cm"),
                    op(&[1., 0., 0., 1., -x, -y], "cm"),
                ]);
            }
            _ => return Err(format!("Unsupported SVG transform {name}")),
        }
    }
}
fn path_ops(source: &str) -> Result<Vec<String>, String> {
    let tokens = svg_tokens(source)?;
    let mut tokens = tokens.into_iter().peekable();
    if tokens.peek().is_some_and(|v| !matches!(v, Err('M' | 'm'))) {
        return Err("SVG path must begin with moveto".into());
    }
    let (mut cmd, mut prev) = (' ', ' ');
    let (mut p, mut start, mut control) = ([0.; 2], [0.; 2], [0.; 2]);
    let mut ops = vec![];
    while tokens.peek().is_some() {
        if let Some(Err(c)) = tokens.peek() {
            cmd = *c;
            tokens.next();
        }
        let rel = cmd.is_ascii_lowercase();
        let upper = cmd.to_ascii_uppercase();
        let mut next = |axis: usize| {
            tokens
                .next()
                .and_then(Result::ok)
                .map(|v| if rel { v + p[axis] } else { v })
                .ok_or("Invalid SVG path")
        };
        let reflect = |k: usize| 2. * p[k] - control[k];
        match upper {
            'Z' => {
                ops.push("h".into());
                p = start;
                cmd = ' ';
            }
            'M' | 'L' => {
                p = [next(0)?, next(1)?];
                ops.push(op(&p, if upper == 'M' { "m" } else { "l" }));
                if upper == 'M' {
                    start = p;
                    cmd = if rel { 'l' } else { 'L' };
                }
            }
            'H' => {
                p[0] = next(0)?;
                ops.push(op(&p, "l"));
            }
            'V' => {
                p[1] = next(1)?;
                ops.push(op(&p, "l"));
            }
            'C' | 'S' => {
                let a = if upper == 'C' {
                    [next(0)?, next(1)?]
                } else if matches!(prev, 'C' | 'S') {
                    [reflect(0), reflect(1)]
                } else {
                    p
                };
                control = [next(0)?, next(1)?];
                p = [next(0)?, next(1)?];
                ops.push(op(&[a[0], a[1], control[0], control[1], p[0], p[1]], "c"));
            }
            'Q' | 'T' => {
                control = if upper == 'Q' {
                    [next(0)?, next(1)?]
                } else if matches!(prev, 'Q' | 'T') {
                    [reflect(0), reflect(1)]
                } else {
                    p
                };
                let end = [next(0)?, next(1)?];
                let cp = |v: f64, c: f64| v + (c - v) * 2. / 3.;
                ops.push(op(
                    &[
                        cp(p[0], control[0]),
                        cp(p[1], control[1]),
                        cp(end[0], control[0]),
                        cp(end[1], control[1]),
                        end[0],
                        end[1],
                    ],
                    "c",
                ));
                p = end;
            }
            _ => return Err(format!("Unsupported SVG path command {cmd}")),
        }
        prev = upper;
    }
    Ok(ops)
}
