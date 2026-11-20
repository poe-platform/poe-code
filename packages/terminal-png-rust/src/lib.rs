//! Portable terminal rendering, with independent ANSI display and raster policies.
pub mod ansi;
pub mod cli;
pub mod font;
pub mod grapheme;
pub mod png;
pub mod publication;
pub mod raster;
pub mod svg;
pub mod xml;

pub mod inflate;
pub mod image;
pub mod image_header;
pub mod bmp;
pub mod gif;
pub mod fax;
pub mod lzw;
pub mod tiff;
pub mod jpeg;
mod png_decode;

pub mod office_image;

pub mod color;
