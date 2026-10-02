#[derive(Clone)]
pub struct Match {
    pub score: u32,
    pub positions: Vec<u32>,
}

fn better(candidate: &Match, current: Option<&Match>) -> bool {
    current.is_none_or(|current| {
        candidate.score > current.score
            || (candidate.score == current.score && candidate.positions < current.positions)
    })
}

pub fn subsequence(query: &[Vec<u16>], text: &[Vec<u16>]) -> Option<Match> {
    let mut previous: Vec<Option<Match>> = vec![None; text.len()];
    for (query_index, query_character) in query.iter().enumerate() {
        let mut states = vec![None; text.len()];
        let mut best_prior: Option<&Match> = None;
        let mut offset = 0;
        for (index, character) in text.iter().enumerate() {
            // Every nonadjacent predecessor receives the same score increment.
            // Keep its best prefix; compare the adjacent predecessor separately.
            if index > 0
                && let Some(prior) = previous[index - 1].as_ref()
                && better(prior, best_prior)
            {
                best_prior = Some(prior);
            }
            let position = offset;
            offset += character.len() as u32;
            if character != query_character {
                continue;
            }
            let word_start =
                index == 0 || matches!(text[index - 1].as_slice(), [32 | 45 | 95 | 47 | 46]);
            let score = 10 + if word_start { 10 } else { 0 };
            let positions = if character.len() == 2 {
                vec![position, position + 1]
            } else {
                vec![position]
            };
            if query_index == 0 {
                states[index] = Some(Match {
                    score: score + 3u32.saturating_sub(position),
                    positions,
                });
                continue;
            }
            let adjacent = index.checked_sub(1).and_then(|i| previous[i].as_ref());
            for (prior, bonus) in [(best_prior, 0), (adjacent, 14)] {
                if let Some(prior) = prior {
                    let mut next = prior.clone();
                    next.score += score + bonus;
                    next.positions.extend_from_slice(&positions);
                    if better(&next, states[index].as_ref()) {
                        states[index] = Some(next);
                    }
                }
            }
        }
        if states.iter().all(Option::is_none) {
            return None;
        }
        previous = states;
    }
    previous.into_iter().flatten().fold(None, |best, next| {
        if better(&next, best.as_ref()) {
            Some(next)
        } else {
            best
        }
    })
}

pub fn project<E>(
    positions: &[u32],
    mut next_lengths: impl FnMut() -> Result<Option<(u32, u32)>, E>,
) -> Result<Vec<u32>, E> {
    let mut projected = Vec::new();
    let (mut original_offset, mut folded_offset, mut match_index) = (0, 0, 0);
    while let Some((original_length, folded_length)) = next_lengths()? {
        let first_match = match_index;
        while match_index < positions.len()
            && positions[match_index] < folded_offset + folded_length
        {
            if original_length == folded_length {
                projected.push(original_offset + positions[match_index] - folded_offset);
            }
            match_index += 1;
        }
        if match_index > first_match && original_length != folded_length {
            projected.extend(original_offset..original_offset + original_length);
        }
        if match_index == positions.len() {
            break;
        }
        original_offset += original_length;
        folded_offset += folded_length;
    }
    Ok(projected)
}
