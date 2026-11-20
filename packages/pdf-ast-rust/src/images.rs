use terminal_png_rust::{bmp, gif, image_header, jpeg, png, tiff};

pub(crate) async fn dimensions(bytes: &[u8]) -> Result<(usize, usize), &'static str> {
    if jpeg::signature(bytes) {
        let header = image_header::jpeg(bytes)?;
        Ok((header.width as usize, header.height as usize))
    } else if gif::signature(bytes) {
        let (width, height) = gif::dimensions(bytes)?;
        Ok((width as usize, height as usize))
    } else if bmp::signature(bytes) {
        let header = bmp::Bmp::parse(bytes, usize::MAX)?;
        Ok((header.width, header.height))
    } else if tiff::signature(bytes) {
        let header = tiff::Tiff::parse_async(bytes, usize::MAX).await?;
        Ok((header.width, header.height))
    } else {
        let header = image_header::Png::read_async(bytes, |_| Ok(())).await?;
        let ihdr = header.ihdr.ok_or("Invalid PNG header")?;
        Ok((
            u32::from_be_bytes(ihdr[..4].try_into().unwrap()) as usize,
            u32::from_be_bytes(ihdr[4..8].try_into().unwrap()) as usize,
        ))
    }
}

pub(crate) async fn image_pixels(
    bytes: &[u8],
    limit: usize,
) -> Result<(usize, usize, Vec<[u8; 4]>), &'static str> {
    let mut image = if jpeg::signature(bytes) {
        jpeg::decode_async(bytes, limit).await?
    } else if gif::signature(bytes) {
        gif::decode_async(bytes, 1, limit, |_, _| Ok(())).await?
    } else if bmp::signature(bytes) {
        bmp::decode_async(bytes, limit).await?
    } else if tiff::signature(bytes) {
        tiff::decode_async(bytes, limit).await?
    } else {
        png::decode_async(bytes, limit).await?
    };
    let (width, height) = terminal_png_rust::image::orient_async(
        image.width,
        image.height,
        &mut image.pixels,
        image.orientation.unwrap_or(1),
        limit,
    )
    .await?;
    Ok((width, height, image.pixels))
}
