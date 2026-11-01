use super::ImageMeta;
use std::borrow::Cow;

pub(super) fn operand(name: &str) -> (&str, f64) {
    let (base, scene) = name
        .strip_suffix(']')
        .and_then(|s| s.rsplit_once('['))
        .filter(|(_, n)| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
        .map_or((name, 0.), |(path, n)| {
            (path, n.parse().unwrap_or(f64::INFINITY))
        });
    let path = base
        .split_once(':')
        .filter(|(fmt, _)| {
            matches!(
                fmt.to_ascii_lowercase().as_str(),
                "png"
                    | "jpg"
                    | "jpeg"
                    | "webp"
                    | "gif"
                    | "bmp"
                    | "tif"
                    | "tiff"
                    | "ppm"
                    | "pgm"
                    | "pbm"
                    | "heic"
                    | "heif"
                    | "avif"
                    | "pdf"
                    | "svg"
            )
        })
        .map_or(base, |(_, path)| path);
    (path, scene)
}

pub(super) fn recognized_image(b: &[u8]) -> bool {
    if b.starts_with(b"\x89PNG\r\n\x1a\n")
        || super::netpbm::signature(b)
        || b.starts_with(b"\xff\xd8\xff")
        || matches!(b.get(..6), Some(b"GIF87a" | b"GIF89a"))
        || b.len() >= 26 && b.starts_with(b"BM")
        || b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP")
        || b.len() >= 8 && matches!(b.get(..4), Some(b"II*\0" | b"MM\0*"))
    {
        return true;
    }
    if b.len() >= 16 && b.get(4..8) == Some(b"ftyp") {
        let size = u32::from_be_bytes(b[..4].try_into().unwrap()) as usize;
        let end = if size == 0 || size > b.len() {
            b.len().min(64)
        } else {
            size
        };
        let brand = |v: &[u8]| {
            matches!(
                v,
                b"heic"
                    | b"heix"
                    | b"hevc"
                    | b"hevx"
                    | b"heim"
                    | b"heis"
                    | b"hevm"
                    | b"hevs"
                    | b"avif"
                    | b"avis"
                    | b"avio"
                    | b"mif1"
                    | b"msf1"
                    | b"heif"
            )
        };
        if end >= 16 && (brand(&b[8..12]) || b[16..end].chunks_exact(4).any(brand)) {
            return true;
        }
    }
    if b[..b.len().min(1029)].windows(5).any(|v| v == b"%PDF-") {
        return true;
    }
    let head = String::from_utf8_lossy(&b[..b.len().min(512)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    b.len() >= 5 && (head.starts_with("<svg") || head.starts_with("<?xml") && head.contains("<svg"))
}

pub(super) fn format(
    mut template: &str,
    (file, scene): (&str, f64),
    (meta, depth, channels, dpi): (&ImageMeta, u8, u8, u32),
    size: usize,
    out: &mut String,
    limit: usize,
) -> Result<(), &'static str> {
    let name = file.rsplit('/').next().unwrap_or(file);
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let compression = match meta.fmt.as_str() {
        "PNG" => "Zip",
        "JPEG" => "JPEG",
        "GIF" => "LZW",
        _ => "None",
    };
    let mut append = |text: &str| {
        if text.len() > limit.saturating_sub(out.len()) {
            return Err("output byte limit exceeded");
        }
        out.push_str(text);
        Ok(())
    };
    while let Some(i) = template.find(['%', '\\']) {
        append(&template[..i])?;
        template = &template[i..];
        let (token, rest) = if let Some(property) = template.strip_prefix("%[") {
            let mut depth = 1;
            let Some(end) = property.bytes().position(|b| {
                match b {
                    b'[' => depth += 1,
                    b']' => depth -= 1,
                    _ => (),
                }
                depth == 0
            }) else {
                return append(template);
            };
            template.split_at(3 + end)
        } else {
            let n = match template.as_bytes() {
                [b'%', c, ..] if c.is_ascii_alphabetic() || *c == b'%' => 2,
                [
                    b'\\',
                    b'n' | b'N' | b't' | b'T' | b'r' | b'R' | b'%' | b'\\',
                    ..,
                ] => 2,
                _ => 1,
            };
            template.split_at(n)
        };
        template = rest;
        let property;
        let key = if token.starts_with("%[") {
            property = token.to_ascii_lowercase();
            property.as_str()
        } else {
            token
        };
        let value: Cow<'_, str> = match key {
            "%w" | "%[width]" | "%[fx:w]" => meta.w.to_string().into(),
            "%h" | "%[height]" | "%[fx:h]" => meta.h.to_string().into(),
            "%[fx:w*h]" => (u64::from(meta.w) * u64::from(meta.h)).to_string().into(),
            "%m" => meta.fmt.as_str().into(),
            "%q" | "%z" | "%[depth]" => depth.to_string().into(),
            "%r" => format!("DirectClass {}", meta.cs).into(),
            "%t" => stem.into(),
            "%e" => ext.into(),
            "%f" => name.into(),
            "%i" => file.into(),
            "%g" => format!("{}x{}+0+0", meta.w, meta.h).into(),
            "%P" => format!("{}x{}", meta.w, meta.h).into(),
            "%x" | "%y" => dpi.to_string().into(),
            "%C" | "%[compression]" => compression.into(),
            "%Q" | "%[quality]" => "92".into(),
            "%n" => "1".into(),
            "%s" if !scene.is_finite() => "Infinity".into(),
            "%s" if scene >= 1e21 => format!("{scene:e}").replace('e', "e+").into(),
            "%s" => scene.to_string().into(),
            "%[colorspace]" => meta.cs.as_str().into(),
            "%[channels]" => format!(
                "{}{}",
                meta.cs.to_ascii_lowercase(),
                if meta.has_alpha(channels) { "a" } else { "" }
            )
            .into(),
            "%b" | "%[size]" => format!("{size}B").into(),
            "%B" => size.to_string().into(),
            "%%" | "\\%" => "%".into(),
            "\\n" => "\n".into(),
            "\\r" => "\r".into(),
            "\\t" => "\t".into(),
            "\\\\" | "\\N" | "\\R" | "\\T" => token[1..].into(),
            _ => token.into(),
        };
        append(&value)?;
    }
    append(template)
}
