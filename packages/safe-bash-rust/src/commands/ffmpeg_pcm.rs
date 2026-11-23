pub(super) const STREAMS_ERROR: &str = "Raw audio output requires exactly one audio stream";

/// PCM storage and sample conversion, independent of its container.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Format {
    Signed(u16, bool),
    Unsigned(u16, bool),
    Float(u16, bool),
    Mulaw,
    Alaw,
    Vidc,
}

impl Format {
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "s8" => Self::Signed(8, false),
            "u8" => Self::Unsigned(8, false),
            "mulaw" => Self::Mulaw,
            "alaw" => Self::Alaw,
            "vidc" => Self::Vidc,
            _ => {
                let (prefix, big) = if let Some(s) = name.strip_suffix("le") {
                    (s, false)
                } else {
                    (name.strip_suffix("be")?, true)
                };
                let bits = prefix.get(1..)?.parse().ok()?;
                match prefix.as_bytes().first()? {
                    b's' if matches!(bits, 16 | 24 | 32) => Self::Signed(bits, big),
                    b'u' if matches!(bits, 16 | 24 | 32) => Self::Unsigned(bits, big),
                    b'f' if matches!(bits, 32 | 64) => Self::Float(bits, big),
                    _ => return None,
                }
            }
        })
    }
    pub fn wave(tag: u16, bits: u16) -> Self {
        match (tag, bits) {
            (3, _) => Self::Float(bits, false),
            (6, _) => Self::Alaw,
            (7, _) => Self::Mulaw,
            (_, 8) => Self::Unsigned(8, false),
            _ => Self::Signed(bits, false),
        }
    }
    pub fn wave_encoding(self) -> Option<(u16, u16)> {
        Some(match self {
            Self::Unsigned(8, false) => (1, 8),
            Self::Signed(bits, false) if bits != 8 => (1, bits),
            Self::Float(bits, false) => (3, bits),
            Self::Alaw => (6, 8),
            Self::Mulaw => (7, 8),
            _ => return None,
        })
    }
    pub fn bits(self) -> u16 {
        match self {
            Self::Signed(b, _) | Self::Unsigned(b, _) | Self::Float(b, _) => b,
            _ => 8,
        }
    }
    pub fn name(self) -> String {
        match self {
            Self::Mulaw => "mulaw".into(),
            Self::Alaw => "alaw".into(),
            Self::Vidc => "vidc".into(),
            Self::Signed(b, e) | Self::Unsigned(b, e) | Self::Float(b, e) => format!(
                "{}{b}{}",
                match self {
                    Self::Signed(..) => "s",
                    Self::Unsigned(..) => "u",
                    _ => "f",
                },
                if b == 8 {
                    ""
                } else if e {
                    "be"
                } else {
                    "le"
                }
            ),
        }
    }
    fn big(self) -> bool {
        matches!(
            self,
            Self::Signed(_, true) | Self::Unsigned(_, true) | Self::Float(_, true)
        )
    }
    fn integer(self, bytes: &[u8]) -> Option<i32> {
        match self {
            Self::Float(..) => None,
            Self::Signed(64, big) => Some(if big {
                i32::from_be_bytes(bytes[..4].try_into().unwrap())
            } else {
                i32::from_le_bytes(bytes[4..8].try_into().unwrap())
            }),
            Self::Mulaw | Self::Alaw | Self::Vidc => {
                let c = bytes[0];
                let value = if self == Self::Alaw {
                    let c = c ^ 85;
                    let e = (c >> 4) & 7;
                    let m = if e == 0 {
                        i32::from(c & 15) * 16 + 8
                    } else {
                        (i32::from(c & 15) * 16 + 264) << (e - 1)
                    };
                    if c & 128 != 0 { m } else { -m }
                } else {
                    let c = if self == Self::Vidc {
                        (c >> 1) | ((c & 1) << 7)
                    } else {
                        c ^ 255
                    };
                    let m = ((i32::from(c & 15) * 8 + 132) << ((c >> 4) & 7)) - 132;
                    if c & 128 != 0 { -m } else { m }
                };
                Some(value << 16)
            }
            _ => {
                let width = usize::from(self.bits() / 8);
                let mut n = 0u32;
                for (i, &byte) in bytes[..width].iter().enumerate() {
                    n |= u32::from(byte) << (8 * if self.big() { width - 1 - i } else { i });
                }
                n <<= 32 - self.bits();
                if matches!(self, Self::Unsigned(..)) {
                    n ^= 0x80000000;
                }
                Some(n as i32)
            }
        }
    }
    pub fn sample(self, bytes: &[u8]) -> f64 {
        match self {
            Self::Signed(64, big) => {
                let value = if big { i64::from_be_bytes(bytes[..8].try_into().unwrap()) }
                    else { i64::from_le_bytes(bytes[..8].try_into().unwrap()) };
                value as f64 / 9223372036854775808.
            }
            Self::Float(32, big) => f64::from(if big {
                f32::from_be_bytes(bytes[..4].try_into().unwrap())
            } else {
                f32::from_le_bytes(bytes[..4].try_into().unwrap())
            }),
            Self::Float(64, big) => {
                if big {
                    f64::from_be_bytes(bytes[..8].try_into().unwrap())
                } else {
                    f64::from_le_bytes(bytes[..8].try_into().unwrap())
                }
            }
            _ => f64::from(self.integer(bytes).unwrap_or(0)) / 2147483648.,
        }
    }
    fn write_integer(self, n: i32, output: &mut [u8]) {
        if matches!(self, Self::Mulaw | Self::Alaw) {
            let table = if self == Self::Alaw { &ALAW } else { &MULAW };
            output[0] = table[((n >> 16) as u16 >> 2) as usize];
        } else {
            let n = if matches!(self, Self::Unsigned(..)) {
                n ^ i32::MIN
            } else {
                n
            };
            let width = output.len();
            output.copy_from_slice(&n.to_le_bytes()[4 - width..]);
            if self.big() {
                output.reverse();
            }
        }
    }
    pub fn convert(self, source: Self, bytes: &[u8], vectorized: bool, output: &mut [u8]) {
        if self == source && !matches!(source, Self::Mulaw | Self::Alaw | Self::Vidc) {
            output.copy_from_slice(&bytes[..output.len()]);
            return;
        }
        if matches!((self, source), (Self::Float(a, _), Self::Float(b, _)) if a == b) {
            output.copy_from_slice(&bytes[..output.len()]);
            output.reverse();
            return;
        }
        if !matches!(self, Self::Float(..))
            && let Some(n) = source.integer(bytes)
        {
            self.write_integer(n, output);
            return;
        }
        let value = source.sample(bytes);
        // FFmpeg's float32 SIMD paths differ from scalar conversion on overflow.
        if vectorized
            && matches!(source, Self::Float(32, _))
            && matches!(
                self,
                Self::Signed(16 | 24 | 32, _)
                    | Self::Unsigned(16 | 24 | 32, _)
                    | Self::Mulaw
                    | Self::Alaw
            )
        {
            let n = if self.bits() == 16 || matches!(self, Self::Mulaw | Self::Alaw) {
                let scaled = (value * 32768.).round_ties_even();
                let n = if !scaled.is_finite()
                    || scaled < f64::from(i32::MIN)
                    || scaled > f64::from(i32::MAX)
                {
                    i32::MIN
                } else {
                    scaled as i32
                };
                n.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) << 16
            } else if value.is_nan() || value >= 1. {
                i32::MAX
            } else if value <= -1. {
                i32::MIN
            } else {
                (value * 2147483648.).round_ties_even() as i32
            };
            self.write_integer(n, output);
        } else {
            self.write_float(value, output);
        }
    }
    pub fn write_float(self, value: f64, output: &mut [u8]) {
        let rounded = |scale: f64| {
            let n = (value * scale).round_ties_even();
            if !n.is_finite() || n < i64::MIN as f64 || n >= -(i64::MIN as f64) {
                i64::MIN
            } else {
                n as i64
            }
        };
        let n = match self {
            Self::Float(32, _) => {
                output.copy_from_slice(&(value as f32).to_le_bytes());
                if self.big() {
                    output.reverse();
                }
                return;
            }
            Self::Float(64, _) => {
                output.copy_from_slice(&value.to_le_bytes());
                if self.big() {
                    output.reverse();
                }
                return;
            }
            Self::Signed(8, _) | Self::Unsigned(8, _) => {
                (rounded(128.) as i32)
                    .wrapping_add(128)
                    .clamp(0, 255)
                    .wrapping_sub(128)
                    << 24
            }
            Self::Signed(16, _) | Self::Unsigned(16, _) | Self::Mulaw | Self::Alaw => {
                (rounded(32768.) as i32).clamp(i32::from(i16::MIN), i32::from(i16::MAX)) << 16
            }
            _ => rounded(2147483648.).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        };
        self.write_integer(n, output);
    }
}

const fn companding_table(alaw: bool) -> [u8; 16384] {
    let mut table = [0; 16384];
    let mut code = 0usize;
    let mut sample = 0usize;
    while code < 128 {
        let end = if code == 127 {
            8192
        } else {
            (level_value(code, alaw) + level_value(code + 1, alaw) + 4) >> 3
        };
        while sample < end {
            table[sample] = code as u8 ^ if alaw { 0xd5 } else { 0xff };
            if sample > 0 {
                table[16384 - sample] = table[sample] ^ 128;
            }
            sample += 1;
        }
        code += 1;
    }
    table[8192] = table[8193];
    table
}
const fn level_value(code: usize, alaw: bool) -> usize {
    let e = code >> 4;
    let m = code & 15;
    if alaw {
        if e == 0 {
            m * 16 + 8
        } else {
            (m * 16 + 264) << (e - 1)
        }
    } else {
        ((m * 8 + 132) << e) - 132
    }
}
static MULAW: [u8; 16384] = companding_table(false);
static ALAW: [u8; 16384] = companding_table(true);
