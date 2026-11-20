//! Unicode general categories shared by schema patterns and document readers.
pub use crate::unicode_categories::{CATEGORY_RANGES, GENERAL_CATEGORIES};

pub fn general_category(character: char) -> &'static str {
    let point = character as u32;
    let index = CATEGORY_RANGES.partition_point(|&(_, end, _)| end < point);
    let category = CATEGORY_RANGES
        .get(index)
        .filter(|&&(start, _, _)| start <= point)
        .map_or(0, |&(_, _, category)| category as usize);
    GENERAL_CATEGORIES[category]
}
