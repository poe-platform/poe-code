pub(super) use terminal_png_rust::jpeg::{signature, samples, Output};
pub(super) fn decode(bytes: &[u8], limit: usize) -> Result<super::png_pixels::Raster, &'static str> {
    terminal_png_rust::jpeg::decode(bytes, limit).map(Into::into)
}
