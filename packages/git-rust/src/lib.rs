pub mod errors;
pub mod fixtures;
pub mod fs;
pub mod utils;

pub const VERSION: &str = "0.0.0-development";

pub fn version() -> &'static str {
    VERSION
}
