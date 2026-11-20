//! HTML adapter and compatibility exports for the portable document packages.
pub use document_ast_rust::*;
pub use docx_ast_rust::write_docx;
pub use document_converter_rust::html::{HtmlScope, HtmlToken, append_html_text, from_html, html_tokens, raw_html_blocks};
pub use pdf_ast_rust::{self as pdf, write_pdf};
