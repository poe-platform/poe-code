use super::{RxSearch, ZeroRegex};

impl ZeroRegex {
    pub(in crate::commands) fn office(pattern: &str, work: &mut usize) -> Option<Option<Self>> {
        *work = work.checked_sub(pattern.len().checked_mul(32)?)?;
        let mut source = String::from("(?i)");
        let mut chars = pattern.chars().peekable();
        let mut quoted = false;
        while let Some(c) = chars.next() {
            if quoted {
                if c == '\\' && chars.peek() == Some(&'E') {
                    chars.next();
                    quoted = false;
                } else {
                    use std::fmt::Write;
                    write!(source, "\\x{{{:x}}}", u32::from(c)).ok()?;
                }
            } else if c == '\\' {
                match chars.next() {
                    Some('Q') => quoted = true,
                    Some('h') => source.push_str("[\\t\\p{Zs}]"),
                    Some('H') => source.push_str("[^\\t\\p{Zs}]"),
                    Some(next) => {
                        source.push(c);
                        source.push(next);
                    }
                    None => source.push(c),
                }
            } else {
                source.push(c);
            }
        }
        // The flat compiler has quadratic group/name scans. Unicode properties
        // and folded bracket classes also expand beyond the source length.
        let classes = source.chars().filter(|c| matches!(c, '[' | '\\')).count();
        *work = work.checked_sub(
            source
                .len()
                .checked_add(1)?
                .checked_mul(source.len().checked_add(1)?)?
                .checked_mul(64)?
                .checked_add(classes.checked_mul(65_536)?)?,
        )?;
        Some(Self::mdq(&source).ok())
    }

    pub(in crate::commands) fn office_match(
        &self,
        text: &str,
        whole: bool,
        skip_empty: bool,
        work: &mut usize,
    ) -> Option<bool> {
        *work = work.checked_sub(text.len().checked_add(1)?.checked_mul(16)?)?;
        let hay: Vec<_> = text.char_indices().collect();
        let search = RxSearch::Mdq {
            continuation: 0,
            trailing_start: hay
                .iter()
                .rposition(|&(_, c)| c != '\n')
                .map_or(0, |i| i + 1),
        };
        for start in 0..=if whole { 0 } else { hay.len() } {
            for program in &self.branches {
                let mut exhausted = false;
                let matched = program.run(
                    &hay,
                    start..=hay.len(),
                    false,
                    search,
                    false,
                    |cost| match work.checked_sub(cost) {
                        Some(left) => {
                            *work = left;
                            Some(())
                        }
                        None => {
                            *work = 0;
                            exhausted = true;
                            None
                        }
                    },
                    |_| true,
                );
                if exhausted {
                    return None;
                }
                if let Some(matched) = matched {
                    if skip_empty && matched.pos == matched.start && !hay.is_empty() {
                        continue;
                    }
                    return Some(
                        (matched.pos > matched.start || hay.is_empty())
                            && (!whole || matched.start == 0 && matched.pos == hay.len()),
                    );
                }
            }
        }
        Some(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_regex_limits_cover_compilation_searches_and_backreferences() {
        assert!(ZeroRegex::office(&"(".repeat(1000), &mut 4096).is_none());
        for (pattern, text) in [
            ("a+$", "a".repeat(60) + "b"),
            ("(a+)\\1b", "a".repeat(60)),
            ("(?=(a+))a+z", "a".repeat(60)),
        ] {
            let regex = ZeroRegex::office(pattern, &mut 1_000_000).unwrap().unwrap();
            assert_eq!(
                regex.office_match(&text, false, false, &mut 4096),
                None,
                "{pattern}"
            );
            assert_eq!(
                regex.office_match(&text, false, false, &mut 100_000_000),
                Some(false),
                "{pattern}"
            );
        }
    }
}
