//! Bounded, dependency-free Unicode-mode pattern matching for JSON Schema.
//! Unsupported ECMAScript features fail compilation rather than losing constraints.
use std::collections::{HashMap, HashSet};

use super::unicode_categories::{CATEGORY_RANGES, GENERAL_CATEGORIES};

const LIMIT: usize = 262_144;

pub(super) struct Pattern {
    expressions: Vec<Expression>,
    root: usize,
}

enum Expression {
    Empty,
    Character(Character),
    Start,
    End,
    Boundary(bool),
    Sequence(Vec<usize>),
    Choice(Vec<usize>),
    Repeat {
        child: usize,
        minimum: usize,
        maximum: Option<usize>,
    },
    Lookahead {
        child: usize,
        positive: bool,
    },
}

enum Character {
    Literal(u32),
    Any,
    Class {
        members: Vec<Character>,
        negative: bool,
    },
    Range(u32, u32),
    Digit(bool),
    Word(bool),
    Space(bool),
    Category {
        mask: u32,
        negative: bool,
    },
    Ascii(bool),
    All(bool),
}

fn scalars(source: &[u16]) -> Vec<u32> {
    std::char::decode_utf16(source.iter().copied())
        .map(|scalar| scalar.map_or_else(|error| u32::from(error.unpaired_surrogate()), u32::from))
        .collect()
}

impl Pattern {
    pub fn compile(source: &[u16]) -> Result<Self, String> {
        if source.len() > 65_536 {
            return Err("Pattern compilation resource limit exceeded".into());
        }
        let mut parser = Parser {
            source: scalars(source),
            position: 0,
            expressions: Vec::new(),
        };
        let root = parser.choice(0)?;
        if parser.position != parser.source.len() {
            return Err("Invalid pattern: unexpected closing group".into());
        }
        Ok(Self {
            expressions: parser.expressions,
            root,
        })
    }

    pub fn matches(&self, value: &[u16]) -> Result<bool, String> {
        let input = scalars(value);
        let mut matcher = Matcher {
            pattern: self,
            input: &input,
            cache: HashMap::new(),
            operations: 0,
            retained: 0,
        };
        for position in 0..=input.len() {
            if !matcher.ends(self.root, position)?.is_empty() {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

struct Parser {
    source: Vec<u32>,
    position: usize,
    expressions: Vec<Expression>,
}

impl Parser {
    fn peek(&self) -> Option<u32> {
        self.source.get(self.position).copied()
    }
    fn take(&mut self) -> Option<u32> {
        let value = self.peek();
        self.position += usize::from(value.is_some());
        value
    }
    fn accept(&mut self, byte: u8) -> bool {
        if self.peek() == Some(u32::from(byte)) {
            self.position += 1;
            true
        } else {
            false
        }
    }
    fn add(&mut self, expression: Expression) -> usize {
        let index = self.expressions.len();
        self.expressions.push(expression);
        index
    }
    fn choice(&mut self, depth: usize) -> Result<usize, String> {
        if depth > 128 {
            return Err("Pattern compilation resource limit exceeded".into());
        }
        let mut choices = vec![self.sequence(depth)?];
        while self.accept(b'|') {
            choices.push(self.sequence(depth)?);
        }
        Ok(if choices.len() == 1 {
            choices[0]
        } else {
            self.add(Expression::Choice(choices))
        })
    }
    fn sequence(&mut self, depth: usize) -> Result<usize, String> {
        let mut sequence = Vec::new();
        while self
            .peek()
            .is_some_and(|scalar| scalar != u32::from(b')') && scalar != u32::from(b'|'))
        {
            let (atom, assertion) = self.atom(depth)?;
            let repetition = if self.accept(b'*') {
                Some((0, None))
            } else if self.accept(b'+') {
                Some((1, None))
            } else if self.accept(b'?') {
                Some((0, Some(1)))
            } else if self.accept(b'{') {
                let minimum = self.count()?;
                let maximum = if self.accept(b',') {
                    if self.peek() == Some(u32::from(b'}')) {
                        None
                    } else {
                        Some(self.count()?)
                    }
                } else {
                    Some(minimum)
                };
                if !self.accept(b'}') || maximum.is_some_and(|maximum| maximum < minimum) {
                    return Err("Invalid pattern: invalid repetition bounds".into());
                }
                Some((minimum, maximum))
            } else {
                None
            };
            let atom = if let Some((minimum, maximum)) = repetition {
                if assertion {
                    return Err("Invalid pattern: assertion cannot be repeated".into());
                }
                self.accept(b'?'); // Greediness does not affect Boolean matching without captures.
                self.add(Expression::Repeat {
                    child: atom,
                    minimum,
                    maximum,
                })
            } else {
                atom
            };
            sequence.push(atom);
        }
        Ok(match sequence.len() {
            0 => self.add(Expression::Empty),
            1 => sequence[0],
            _ => self.add(Expression::Sequence(sequence)),
        })
    }
    fn count(&mut self) -> Result<usize, String> {
        let start = self.position;
        let mut count = 0usize;
        while let Some(scalar @ 48..=57) = self.peek() {
            count = count
                .checked_mul(10)
                .and_then(|count| count.checked_add((scalar - 48) as usize))
                .filter(|count| *count <= LIMIT)
                .ok_or_else(|| "Pattern repetition resource limit exceeded".to_owned())?;
            self.position += 1;
        }
        if start == self.position {
            Err("Invalid pattern: expected repetition count".into())
        } else {
            Ok(count)
        }
    }
    fn atom(&mut self, depth: usize) -> Result<(usize, bool), String> {
        let scalar = self
            .take()
            .ok_or_else(|| "Invalid pattern: missing atom".to_owned())?;
        let (expression, assertion) = match scalar {
            94 => (Expression::Start, true),
            36 => (Expression::End, true),
            46 => (Expression::Character(Character::Any), false),
            91 => (Expression::Character(self.class()?), false),
            40 => {
                let mut lookahead = None;
                if self.accept(b'?') {
                    if self.accept(b':') {
                    } else if self.accept(b'=') {
                        lookahead = Some(true);
                    } else if self.accept(b'!') {
                        lookahead = Some(false);
                    } else {
                        return Err("Pattern feature not yet implemented: group extension".into());
                    }
                }
                let child = self.choice(depth + 1)?;
                if !self.accept(b')') {
                    return Err("Invalid pattern: unterminated group".into());
                }
                if let Some(positive) = lookahead {
                    (Expression::Lookahead { child, positive }, true)
                } else {
                    return Ok((child, false));
                }
            }
            92 => {
                if self.accept(b'b') {
                    (Expression::Boundary(true), true)
                } else if self.accept(b'B') {
                    (Expression::Boundary(false), true)
                } else {
                    (Expression::Character(self.escape(false)?), false)
                }
            }
            42 | 43 | 63 | 123 | 125 | 93 => {
                return Err("Invalid pattern: unexpected pattern token".into());
            }
            scalar => (Expression::Character(Character::Literal(scalar)), false),
        };
        Ok((self.add(expression), assertion))
    }
    fn class(&mut self) -> Result<Character, String> {
        let negative = self.accept(b'^');
        let mut members = Vec::new();
        while self.peek() != Some(u32::from(b']')) {
            let left = self.class_character()?;
            if self.accept(b'-') {
                if self.peek() == Some(u32::from(b']')) {
                    members.extend([left, Character::Literal(u32::from(b'-'))]);
                    break;
                }
                let right = self.class_character()?;
                let (Character::Literal(left), Character::Literal(right)) = (left, right) else {
                    return Err(
                        "Invalid pattern: character class range requires literal endpoints".into(),
                    );
                };
                if left > right {
                    return Err("Invalid pattern: character class range is reversed".into());
                }
                members.push(Character::Range(left, right));
            } else {
                members.push(left);
            }
        }
        if !self.accept(b']') {
            return Err("Invalid pattern: unterminated character class".into());
        }
        Ok(Character::Class { members, negative })
    }
    fn class_character(&mut self) -> Result<Character, String> {
        if self.accept(b'\\') {
            self.escape(true)
        } else {
            self.take()
                .map(Character::Literal)
                .ok_or_else(|| "Invalid pattern: unterminated character class".into())
        }
    }
    fn escape(&mut self, in_class: bool) -> Result<Character, String> {
        let scalar = self
            .take()
            .ok_or_else(|| "Invalid pattern: trailing escape".to_owned())?;
        let character = match scalar {
            100 => Character::Digit(false),
            68 => Character::Digit(true),
            119 => Character::Word(false),
            87 => Character::Word(true),
            115 => Character::Space(false),
            83 => Character::Space(true),
            98 if in_class => Character::Literal(8),
            110 => Character::Literal(10),
            114 => Character::Literal(13),
            116 => Character::Literal(9),
            118 => Character::Literal(11),
            102 => Character::Literal(12),
            48 if !self
                .peek()
                .is_some_and(|scalar| (48..=57).contains(&scalar)) =>
            {
                Character::Literal(0)
            }
            99 => {
                let letter = self
                    .take()
                    .filter(|letter| (65..=90).contains(letter) || (97..=122).contains(letter))
                    .ok_or_else(|| "Invalid pattern: invalid control escape".to_owned())?;
                Character::Literal(letter % 32)
            }
            120 => Character::Literal(self.hex(2)?),
            117 => {
                let scalar = if self.accept(b'{') {
                    let mut value = 0u32;
                    let start = self.position;
                    while self.peek() != Some(u32::from(b'}')) {
                        let digit = self
                            .take()
                            .and_then(char::from_u32)
                            .and_then(|scalar| scalar.to_digit(16))
                            .ok_or_else(|| "Invalid pattern: invalid Unicode escape".to_owned())?;
                        value = value
                            .checked_mul(16)
                            .and_then(|value| value.checked_add(digit))
                            .filter(|value| *value <= 0x10ffff)
                            .ok_or_else(|| "Invalid pattern: invalid Unicode scalar".to_owned())?;
                    }
                    if start == self.position || !self.accept(b'}') {
                        return Err("Invalid pattern: invalid Unicode escape".into());
                    }
                    value
                } else {
                    let high = self.hex(4)?;
                    if (0xd800..=0xdbff).contains(&high) {
                        let saved = self.position;
                        if self.accept(b'\\')
                            && self.accept(b'u')
                            && !self.accept(b'{')
                            && let Ok(low @ 0xdc00..=0xdfff) = self.hex(4)
                        {
                            return Ok(Character::Literal(
                                0x10000 + ((high - 0xd800) << 10) + low - 0xdc00,
                            ));
                        }
                        self.position = saved;
                    }
                    high
                };
                Character::Literal(scalar)
            }
            112 | 80 => {
                if !self.accept(b'{') {
                    return Err("Invalid pattern: invalid Unicode property escape".into());
                }
                let start = self.position;
                while self.peek().is_some_and(|scalar| scalar != u32::from(b'}')) {
                    self.position += 1;
                }
                let name = self.source[start..self.position]
                    .iter()
                    .copied()
                    .map(char::from_u32)
                    .collect::<Option<String>>()
                    .ok_or_else(|| "Invalid pattern: invalid Unicode property name".to_owned())?;
                if !self.accept(b'}') {
                    return Err("Invalid pattern: unterminated Unicode property".into());
                }
                property(&name, scalar == 80)?
            }
            49..=57 => return Err("Pattern feature not yet implemented: backreferences".into()),
            scalar if b"^$\\.*+?()[]{}|/".contains(&(scalar as u8)) && scalar < 128 => {
                Character::Literal(scalar)
            }
            45 if in_class => Character::Literal(45),
            _ => return Err("Invalid pattern: invalid Unicode-mode identity escape".into()),
        };
        Ok(character)
    }
    fn hex(&mut self, count: usize) -> Result<u32, String> {
        let mut value = 0;
        for _ in 0..count {
            let digit = self
                .take()
                .and_then(char::from_u32)
                .and_then(|scalar| scalar.to_digit(16))
                .ok_or_else(|| "Invalid pattern: invalid hexadecimal escape".to_owned())?;
            value = value * 16 + digit;
        }
        Ok(value)
    }
}

fn property(name: &str, negative: bool) -> Result<Character, String> {
    let name = name
        .strip_prefix("General_Category=")
        .or_else(|| name.strip_prefix("gc="))
        .unwrap_or(name);
    if name == "ASCII" {
        return Ok(Character::Ascii(negative));
    }
    if name == "Any" {
        return Ok(Character::All(negative));
    }
    if name == "Assigned" {
        return Ok(Character::Category { mask: !1, negative });
    }
    let alias = match name {
        "Letter" => "L",
        "Cased_Letter" | "LC" => "LC",
        "Uppercase_Letter" => "Lu",
        "Lowercase_Letter" => "Ll",
        "Titlecase_Letter" => "Lt",
        "Modifier_Letter" => "Lm",
        "Other_Letter" => "Lo",
        "Mark" => "M",
        "Nonspacing_Mark" => "Mn",
        "Spacing_Mark" => "Mc",
        "Enclosing_Mark" => "Me",
        "Number" => "N",
        "Decimal_Number" => "Nd",
        "Letter_Number" => "Nl",
        "Other_Number" => "No",
        "Punctuation" => "P",
        "Connector_Punctuation" => "Pc",
        "Dash_Punctuation" => "Pd",
        "Open_Punctuation" => "Ps",
        "Close_Punctuation" => "Pe",
        "Initial_Punctuation" => "Pi",
        "Final_Punctuation" => "Pf",
        "Other_Punctuation" => "Po",
        "Symbol" => "S",
        "Math_Symbol" => "Sm",
        "Currency_Symbol" => "Sc",
        "Modifier_Symbol" => "Sk",
        "Other_Symbol" => "So",
        "Separator" => "Z",
        "Space_Separator" => "Zs",
        "Line_Separator" => "Zl",
        "Paragraph_Separator" => "Zp",
        "Other" => "C",
        "Control" => "Cc",
        "Format" => "Cf",
        "Surrogate" => "Cs",
        "Private_Use" => "Co",
        "Unassigned" => "Cn",
        name => name,
    };
    let mut mask = 0u32;
    for (index, category) in GENERAL_CATEGORIES.iter().enumerate() {
        if *category == alias
            || (alias.len() == 1 && category.starts_with(alias))
            || (alias == "LC" && ["Lu", "Ll", "Lt"].contains(category))
        {
            mask |= 1 << index;
        }
    }
    if mask == 0 {
        Err(format!(
            "Pattern Unicode property not yet implemented: {name}"
        ))
    } else {
        Ok(Character::Category { mask, negative })
    }
}

fn word(scalar: u32) -> bool {
    matches!(scalar, 48..=57 | 65..=90 | 97..=122 | 95)
}
fn space(scalar: u32) -> bool {
    matches!(scalar, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028..=0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
impl Character {
    fn matches(&self, scalar: u32) -> bool {
        match self {
            Self::Literal(value) => *value == scalar,
            Self::Any => !matches!(scalar, 10 | 13 | 0x2028 | 0x2029),
            Self::Class { members, negative } => {
                members.iter().any(|member| member.matches(scalar)) != *negative
            }
            Self::Range(low, high) => (*low..=*high).contains(&scalar),
            Self::Digit(negative) => (48..=57).contains(&scalar) != *negative,
            Self::Word(negative) => word(scalar) != *negative,
            Self::Space(negative) => space(scalar) != *negative,
            Self::Ascii(negative) => (scalar < 128) != *negative,
            Self::All(negative) => !negative,
            Self::Category { mask, negative } => {
                let index = CATEGORY_RANGES.partition_point(|(_, high, _)| *high < scalar);
                let category = CATEGORY_RANGES
                    .get(index)
                    .filter(|(low, _, _)| *low <= scalar)
                    .map_or(0, |(_, _, category)| *category);
                (mask & (1 << category) != 0) != *negative
            }
        }
    }
}

struct Matcher<'a> {
    pattern: &'a Pattern,
    input: &'a [u32],
    cache: HashMap<(usize, usize), Vec<usize>>,
    operations: usize,
    retained: usize,
}
impl Matcher<'_> {
    fn tick(&mut self) -> Result<(), String> {
        self.operations += 1;
        if self.operations > LIMIT {
            Err("Pattern evaluation resource limit exceeded".into())
        } else {
            Ok(())
        }
    }
    fn ends(&mut self, id: usize, position: usize) -> Result<Vec<usize>, String> {
        self.tick()?;
        if let Some(result) = self.cache.get(&(id, position)) {
            return Ok(result.clone());
        }
        let expression = &self.pattern.expressions[id];
        let mut ends = match expression {
            Expression::Empty => vec![position],
            Expression::Character(character) => self
                .input
                .get(position)
                .filter(|scalar| character.matches(**scalar))
                .map_or_else(Vec::new, |_| vec![position + 1]),
            Expression::Start => {
                if position == 0 {
                    vec![position]
                } else {
                    Vec::new()
                }
            }
            Expression::End => {
                if position == self.input.len() {
                    vec![position]
                } else {
                    Vec::new()
                }
            }
            Expression::Boundary(positive) => {
                let before = position
                    .checked_sub(1)
                    .and_then(|index| self.input.get(index))
                    .is_some_and(|scalar| word(*scalar));
                let after = self.input.get(position).is_some_and(|scalar| word(*scalar));
                if (before != after) == *positive {
                    vec![position]
                } else {
                    Vec::new()
                }
            }
            Expression::Choice(choices) => {
                let mut result = Vec::new();
                for choice in choices {
                    result.extend(self.ends(*choice, position)?);
                }
                result
            }
            Expression::Sequence(sequence) => {
                let mut result = vec![position];
                for child in sequence {
                    let mut next = HashSet::new();
                    for position in result {
                        next.extend(self.ends(*child, position)?);
                    }
                    result = next.into_iter().collect();
                    if result.is_empty() {
                        break;
                    }
                }
                result
            }
            Expression::Lookahead { child, positive } => {
                if self.ends(*child, position)?.is_empty() != *positive {
                    vec![position]
                } else {
                    Vec::new()
                }
            }
            Expression::Repeat {
                child,
                minimum,
                maximum,
            } => {
                let mut result = HashSet::new();
                let mut current = vec![position];
                let maximum =
                    maximum.unwrap_or_else(|| minimum.saturating_add(self.input.len() + 1));
                for count in 0..=maximum {
                    self.tick()?;
                    if count >= *minimum {
                        result.extend(current.iter().copied());
                    }
                    if count == maximum || current.is_empty() {
                        break;
                    }
                    let mut next = HashSet::new();
                    for position in &current {
                        next.extend(self.ends(*child, *position)?);
                    }
                    let mut next = next.into_iter().collect::<Vec<_>>();
                    next.sort_unstable();
                    if next == current && count >= *minimum {
                        break;
                    }
                    current = next;
                }
                result.into_iter().collect()
            }
        };
        ends.sort_unstable();
        ends.dedup();
        self.retained += ends.len() + 1;
        if self.retained > LIMIT {
            return Err("Pattern evaluation memory limit exceeded".into());
        }
        self.cache.insert((id, position), ends.clone());
        Ok(ends)
    }
}
