//! Decoded image pixels and original metadata.
#[derive(Clone, Debug)]
pub struct DecodedImage {
    pub width: usize,
    pub height: usize,
    pub alpha: bool,
    pub gray: bool,
    pub density: u32,
    pub orientation: Option<u8>,
    pub pixels: Vec<[u8; 4]>,
}

/// Apply EXIF orientation to a raster. The limit covers both the original and
/// replacement pixels; callers retain control over when metadata is consumed.
pub async fn orient_async(
    width: usize,
    height: usize,
    pixels: &mut Vec<[u8; 4]>,
    orientation: u8,
    limit: usize,
) -> Result<(usize, usize), &'static str> {
    if !matches!(orientation, 2..=8) {
        return Ok((width, height));
    }
    if width.checked_mul(height) != Some(pixels.len()) {
        return Err("Invalid stored image dimensions");
    }
    if pixels.is_empty() {
        return Ok(if orientation >= 5 {
            (height, width)
        } else {
            (width, height)
        });
    }
    if pixels.len() > limit / if orientation >= 5 { 8 } else { 4 } {
        return Err("image exceeds memory budget");
    }
    if orientation <= 4 {
        for at in 0..pixels.len() {
            if at % 4096 == 0 {
                mcp_protocol_rust::cooperate::yield_now().await;
            }
            let (x, y) = (at % width, at / width);
            let target = match orientation {
                2 => y * width + width - 1 - x,
                3 => pixels.len() - 1 - at,
                _ => (height - 1 - y) * width + x,
            };
            if at < target {
                pixels.swap(at, target);
            }
        }
        return Ok((width, height));
    }
    let (out_width, out_height) = (height, width);
    let mut oriented = Vec::with_capacity(pixels.len());
    for at in 0..pixels.len() {
        if at % 4096 == 0 {
            mcp_protocol_rust::cooperate::yield_now().await;
        }
        let (x, y) = (at % out_width, at / out_width);
        // This is the existing SafeBash Raster::orient mapping, shared with PDF.
        let (sx, sy) = (
            if orientation >= 7 { width - 1 - y } else { y },
            if matches!(orientation, 6 | 7) {
                height - 1 - x
            } else {
                x
            },
        );
        oriented.push(pixels[sy * width + sx]);
    }
    *pixels = oriented;
    Ok((out_width, out_height))
}
