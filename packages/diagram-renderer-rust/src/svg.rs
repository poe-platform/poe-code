//! Canonical SVG output for semantic vector scenes.
mod path;
pub use document_ast_rust::vector::svg::to_svg;
pub(crate) use path::parse as parse_path;
