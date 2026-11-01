use super::ImageMeta;
use std::borrow::Cow;

pub(super) fn format(
    mut template: &str,
    file: &str,
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
            "%s" => "0".into(),
            "%[colorspace]" => meta.cs.as_str().into(),
            "%[channels]" => format!(
                "{}{}",
                meta.cs.to_ascii_lowercase(),
                if matches!(channels, 2 | 4) { "a" } else { "" }
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
