// Adapted from yaml-rust2 0.10.4 (MIT); see THIRD_PARTY_NOTICES.md.

#[inline]
pub(crate) fn is_z(c: u16) -> bool {
    c == 0
}

#[inline]
pub(crate) fn is_break(c: u16) -> bool {
    c == 10 || c == 13
}

#[inline]
pub(crate) fn is_breakz(c: u16) -> bool {
    is_break(c) || is_z(c)
}

#[inline]
pub(crate) fn is_blank(c: u16) -> bool {
    c == 32 || c == 9
}

#[inline]
pub(crate) fn is_blank_or_breakz(c: u16) -> bool {
    is_blank(c) || is_breakz(c)
}

#[inline]
pub(crate) fn is_digit(c: u16) -> bool {
    (48..=57).contains(&c)
}

#[inline]
pub(crate) fn is_alpha(c: u16) -> bool {
    matches!(c, 48..=57 | 97..=122 | 65..=90 | 95 | 45)
}

#[inline]
pub(crate) fn is_hex(c: u16) -> bool {
    (48..=57).contains(&c) || (97..=102).contains(&c) || (65..=70).contains(&c)
}

#[inline]
pub(crate) fn as_hex(c: u16) -> u32 {
    match c {
        48..=57 => u32::from(c) - 48,
        97..=102 => u32::from(c) - 97 + 10,
        65..=70 => u32::from(c) - 65 + 10,
        _ => unreachable!(),
    }
}

#[inline]
pub(crate) fn is_flow(c: u16) -> bool {
    matches!(c, 44 | 91 | 93 | 123 | 125)
}

#[inline]
pub(crate) fn is_bom(c: u16) -> bool {
    c == 65279
}

#[inline]
pub(crate) fn is_yaml_non_break(c: u16) -> bool {
    // TODO(ethiraric, 28/12/2023): is_printable
    !is_break(c) && !is_bom(c)
}

#[inline]
pub(crate) fn is_yaml_non_space(c: u16) -> bool {
    is_yaml_non_break(c) && !is_blank(c)
}

#[inline]
pub(crate) fn is_anchor_char(c: u16) -> bool {
    is_yaml_non_space(c) && !is_flow(c) && !is_z(c)
}

#[inline]
pub(crate) fn is_word_char(c: u16) -> bool {
    is_alpha(c) && c != 95
}

#[inline]
pub(crate) fn is_uri_char(c: u16) -> bool {
    is_word_char(c)
        || "#;/?:@&=+$,_.!~*\'()[]%"
            .encode_utf16()
            .any(|unit| unit == c)
}

#[inline]
pub(crate) fn is_tag_char(c: u16) -> bool {
    is_uri_char(c) && !is_flow(c) && c != 33
}
