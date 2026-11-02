// PDF text strings use PDFDocEncoding unless a Unicode byte-order mark is present.
// Page content strings use font encodings and are decoded separately.
use super::Value;

const ACCENTS: [char; 8] = ['˘', 'ˇ', 'ˆ', '˙', '˝', '˛', '˚', '˜'];
const SPECIAL: [char; 33] = [
    '•', '†', '‡', '…', '—', '–', 'ƒ', '⁄', '‹', '›', '−', '‰', '„', '“', '”', '‘', '’', '‚', '™',
    'ﬁ', 'ﬂ', 'Ł', 'Œ', 'Š', 'Ÿ', 'Ž', 'ı', 'ł', 'œ', 'š', 'ž', '�', '€',
];

fn character(b: u8) -> char {
    match b {
        0x18..=0x1f => ACCENTS[(b - 0x18) as usize],
        0x80..=0xa0 => SPECIAL[(b - 0x80) as usize],
        0xad => '�',
        _ => char::from(b),
    }
}

pub(super) fn decode(bytes: &[u8]) -> String {
    let units = match bytes {
        [0xfe, 0xff, rest @ ..] => Some((rest, u16::from_be_bytes as fn([u8; 2]) -> u16)),
        [0xff, 0xfe, rest @ ..] => Some((rest, u16::from_le_bytes as fn([u8; 2]) -> u16)),
        [0xef, 0xbb, 0xbf, rest @ ..] => {
            return String::from_utf8_lossy(rest.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(rest))
                .into_owned();
        }
        _ => None,
    };
    if let Some((rest, unit)) = units {
        char::decode_utf16(rest.chunks_exact(2).map(|c| unit([c[0], c[1]])))
            .map(|c| c.unwrap_or('�'))
            .collect()
    } else {
        bytes.iter().map(|b| character(*b)).collect()
    }
}

pub(super) fn encode(value: &str) -> Value<'static> {
    let byte = |c| {
        if let Ok(b) = u8::try_from(u32::from(c))
            && character(b) == c
        {
            Some(b)
        } else if c == '�' {
            Some(0xad)
        } else if let Some(i) = SPECIAL.iter().position(|&s| s == c) {
            Some(0x80 + i as u8)
        } else {
            ACCENTS.iter().position(|&s| s == c).map(|i| 0x18 + i as u8)
        }
    };
    if let Some(bytes) = value.chars().map(byte).collect::<Option<Vec<_>>>() {
        Value::String { bytes, hex: false }
    } else {
        Value::String {
            bytes: [0xfe, 0xff]
                .into_iter()
                .chain(value.encode_utf16().flat_map(u16::to_be_bytes))
                .collect(),
            hex: true,
        }
    }
}

pub(super) fn name(raw: &[u8]) -> String {
    let mut bytes = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'#'
            && let Some(pair) = raw.get(i + 1..i + 3)
            && pair.iter().all(u8::is_ascii_hexdigit)
        {
            bytes.push(u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap());
            i += 3;
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}
