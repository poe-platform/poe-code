//! Structured-result property admission in observable short-circuit order.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    TypeString,
    Text,
    TextString,
    Image,
    MimeString,
    DataString,
    Error,
    CodeString,
    MessageString,
    RetriableBoolean,
}
pub fn valid_part<E>(mut read: impl FnMut(Probe) -> Result<bool, E>) -> Result<bool, E> {
    if !read(Probe::TypeString)? {
        return Ok(false);
    }
    if read(Probe::Text)? {
        return read(Probe::TextString);
    }
    if read(Probe::Image)? {
        return Ok(read(Probe::MimeString)? && read(Probe::DataString)?);
    }
    Ok(read(Probe::Error)?
        && read(Probe::CodeString)?
        && read(Probe::MessageString)?
        && read(Probe::RetriableBoolean)?)
}
pub fn image_text(mime: &[u16]) -> Vec<u16> {
    "[image: "
        .encode_utf16()
        .chain(mime.iter().copied())
        .chain("]".encode_utf16())
        .collect()
}
