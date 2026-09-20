// Upstream scanner/event parser retain their low-level inspection entry points.
#![allow(dead_code)]
macro_rules! debug_print {
    ($($arg:tt)*) => {{}};
}
mod char_traits;
pub(super) mod parser;
pub(super) mod scanner;
