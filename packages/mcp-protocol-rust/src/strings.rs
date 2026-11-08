//! ECMAScript string rules shared by reusable native package cores.
pub fn trim_ecmascript(text: &[u16]) -> &[u16] {
    fn whitespace(unit: u16) -> bool {
        matches!(unit, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
    }
    let Some(start) = text.iter().position(|unit| !whitespace(*unit)) else {
        return &text[0..0];
    };
    let end = text.iter().rposition(|unit| !whitespace(*unit)).unwrap() + 1;
    &text[start..end]
}
