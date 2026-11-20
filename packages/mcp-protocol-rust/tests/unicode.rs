use mcp_protocol_rust::unicode::{CATEGORY_RANGES, general_category};

#[test]
fn general_categories_distinguish_letters_marks_and_numbers() {
    for (character, category) in [
        ('é', "Ll"),
        ('Ω', "Lu"),
        ('中', "Lo"),
        ('\u{10400}', "Lu"),
        ('\u{301}', "Mn"),
        ('\u{345}', "Mn"),
        ('\u{93e}', "Mc"),
        ('\u{20dd}', "Me"),
        ('Ⅷ', "Nl"),
        ('²', "No"),
        ('8', "Nd"),
        ('_', "Pc"),
        ('😀', "So"),
        ('\u{378}', "Cn"),
        ('\u{10ffff}', "Cn"),
    ] {
        assert_eq!(general_category(character), category, "{character:?}");
    }
}
#[test]
fn generated_ranges_are_ordered_and_lookup_obeys_boundaries() {
    let mut previous = None;
    for &(start, end, category) in CATEGORY_RANGES {
        assert!(start <= end);
        assert!(previous.is_none_or(|prior| prior < start));
        for point in [start, end] {
            if let Some(character) = char::from_u32(point) {
                assert_eq!(
                    general_category(character),
                    mcp_protocol_rust::unicode::GENERAL_CATEGORIES[category as usize]
                );
            }
        }
        previous = Some(end);
    }
}
