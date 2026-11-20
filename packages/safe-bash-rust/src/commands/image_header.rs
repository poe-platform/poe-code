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
    if super::heif::format(b).is_some() { return true; }
    if b[..b.len().min(1029)].windows(5).any(|v| v == b"%PDF-") {
        return true;
    }
    let head = String::from_utf8_lossy(&b[..b.len().min(512)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    b.len() >= 5 && (head.starts_with("<svg") || head.starts_with("<?xml") && head.contains("<svg"))
}

pub(super) use terminal_png_rust::image_header::*;
