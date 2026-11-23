use super::{RxSearch, ZeroRegex};

impl ZeroRegex {
    pub(in crate::commands) fn office(
        pattern: &str,
        ignore_case: bool,
        work: &mut usize,
    ) -> Option<Option<Self>> {
        *work = work.checked_sub(pattern.len().checked_mul(32)?)?;
        let mut source = String::from(if ignore_case { "(?i)" } else { "" });
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

    // Byte spans keep extraction/replacement in the workbook's existing UTF-8
    // strings. Capture zero is the full match; absent groups retain None.
    pub(in crate::commands) fn office_matches(
        &self,
        text: &str,
        all: bool,
        work: &mut usize,
    ) -> Option<Vec<Vec<Option<(usize, usize)>>>> {
        *work = work.checked_sub(text.len().checked_add(1)?.checked_mul(16)?)?;
        let hay: Vec<_> = text.char_indices().collect();
        let byte = |index| hay.get(index).map_or(text.len(), |&(offset, _)| offset);
        let trailing_start = hay
            .iter()
            .rposition(|&(_, c)| c != '\n')
            .map_or(0, |i| i + 1);
        let mut output = Vec::new();
        let mut cursor = 0;
        let mut retry_nonempty = false;
        while cursor <= hay.len() {
            let mut found = None;
            'find: for start in cursor..=if retry_nonempty { cursor } else { hay.len() } {
                *work = work.checked_sub(1)?;
                for program in &self.branches {
                    let mut exhausted = false;
                    let matched = program.run(
                        &hay,
                        start..=hay.len(),
                        false,
                        RxSearch::Mdq {
                            continuation: cursor,
                            trailing_start,
                        },
                        true,
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
                        |end| !retry_nonempty || end > cursor,
                    );
                    if exhausted {
                        return None;
                    }
                    if let Some(matched) = matched {
                        found = Some(matched);
                        break 'find;
                    }
                }
            }
            let Some(matched) = found else {
                if retry_nonempty {
                    cursor += 1;
                    retry_nonempty = false;
                    continue;
                }
                break;
            };
            *work = work.checked_sub(
                (matched.caps.len() + 1)
                    .checked_mul(std::mem::size_of::<Option<(usize, usize)>>())?
                    .checked_add(std::mem::size_of::<Vec<Option<(usize, usize)>>>())?,
            )?;
            let mut spans = Vec::with_capacity(matched.caps.len() + 1);
            spans.push(Some((byte(matched.start), byte(matched.pos))));
            spans.extend(
                matched
                    .caps
                    .into_iter()
                    .map(|cap| cap.map(|(a, b)| (byte(a), byte(b)))),
            );
            output.push(spans);
            if !all {
                break;
            }
            // PCRE global iteration tries a nonempty alternative at an empty
            // match before advancing by one Unicode scalar. This also terminates
            // empty patterns without dropping neighboring nonempty matches.
            retry_nonempty = matched.start == matched.pos;
            cursor = matched.pos;
        }
        Some(output)
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
    fn formula_capture_spans_preserve_unicode_optional_groups_and_case() {
        let mut work = 20_000_000;
        let regex = ZeroRegex::office("(é)([0-9]+)?", false, &mut work)
            .unwrap()
            .unwrap();
        assert_eq!(
            regex.office_matches("xé12 É é", true, &mut work),
            Some(vec![
                vec![Some((1, 5)), Some((1, 3)), Some((3, 5))],
                vec![Some((9, 11)), Some((9, 11)), None],
            ])
        );
        let regex = ZeroRegex::office("(é)", true, &mut work).unwrap().unwrap();
        assert_eq!(
            regex.office_matches("É", false, &mut work),
            Some(vec![vec![Some((0, 2)), Some((0, 2))]])
        );
        assert!(ZeroRegex::office("[", false, &mut work).unwrap().is_none());
    }

    #[test]
    fn formula_global_matching_retries_empty_matches_without_losing_characters() {
        for (pattern, text, expected) in [
            ("^|$", "ab", vec![(0, 0), (2, 2)]),
            (".*?", "a", vec![(0, 0), (0, 1), (1, 1)]),
            ("", "é", vec![(0, 0), (2, 2)]),
            ("(a)?", "ab", vec![(0, 1), (1, 1), (2, 2)]),
            ("a|ab", "ab", vec![(0, 1)]),
            ("(?<=a)b", "ab", vec![(1, 2)]),
            ("(.)\\1", "aabb", vec![(0, 2), (2, 4)]),
        ] {
            let mut work = 20_000_000;
            let regex = ZeroRegex::office(pattern, false, &mut work)
                .unwrap()
                .unwrap();
            let matches = regex.office_matches(text, true, &mut work).unwrap();
            assert_eq!(
                matches.iter().map(|m| m[0].unwrap()).collect::<Vec<_>>(),
                expected,
                "{pattern}"
            );
        }
    }

    #[test]
    fn formula_capture_search_and_output_storage_obey_limits() {
        let regex = ZeroRegex::office("(a+)+$", false, &mut 20_000_000)
            .unwrap()
            .unwrap();
        assert!(
            regex
                .office_matches(&("a".repeat(50) + "b"), false, &mut 1000)
                .is_none()
        );
        let regex = ZeroRegex::office("", false, &mut 20_000_000)
            .unwrap()
            .unwrap();
        assert!(
            regex
                .office_matches(&"x".repeat(1000), true, &mut 20_000)
                .is_none()
        );
    }

    #[test]
    fn formula_regex_limits_cover_compilation_searches_and_backreferences() {
        assert!(ZeroRegex::office(&"(".repeat(1000), true, &mut 4096).is_none());
        for (pattern, text) in [
            ("a+$", "a".repeat(60) + "b"),
            ("(a+)\\1b", "a".repeat(60)),
            ("(?=(a+))a+z", "a".repeat(60)),
        ] {
            let regex = ZeroRegex::office(pattern, true, &mut 1_000_000)
                .unwrap()
                .unwrap();
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
