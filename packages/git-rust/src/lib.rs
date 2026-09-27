pub mod errors;
pub mod fixtures;
pub mod fs;
pub mod models;
pub mod utils;
pub mod wire;

pub const VERSION: &str = "0.0.0-development";

pub fn version() -> &'static str {
    VERSION
}
