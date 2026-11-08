//! Markdown delimiter admission and linked-list pairing. The caller supplies
//! runtime Unicode character classes; matching itself does not depend on ICU.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Delimiter {
    pub marker: u16,
    pub length: usize,
    pub can_open: bool,
    pub can_close: bool,
    pub position: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pair {
    pub opener: usize,
    pub closer: usize,
    pub kind: &'static str,
}

#[derive(Clone, Copy, Default)]
pub struct CharacterClass {
    pub whitespace: bool,
    pub punctuation: bool,
}

pub fn admit(
    marker: u16,
    length: usize,
    before: CharacterClass,
    after: CharacterClass,
    position: usize,
) -> Option<Delimiter> {
    if !matches!(marker, 42 | 95 | 126) || length == 0 || (marker == 126 && length < 2) {
        return None;
    }
    let left = !after.whitespace && (!after.punctuation || before.whitespace || before.punctuation);
    let right =
        !before.whitespace && (!before.punctuation || after.whitespace || after.punctuation);
    Some(Delimiter {
        marker,
        length,
        can_open: left && (marker != 95 || !right || before.punctuation),
        can_close: right && (marker != 95 || !left || after.punctuation),
        position,
    })
}

struct Links {
    previous: Vec<Option<usize>>,
    next: Vec<Option<usize>>,
    active: Vec<bool>,
}

impl Links {
    fn unlink(&mut self, index: usize) {
        if !self.active[index] {
            return;
        }
        if let Some(previous) = self.previous[index] {
            self.next[previous] = self.next[index];
        }
        if let Some(next) = self.next[index] {
            self.previous[next] = self.previous[index];
        }
        self.active[index] = false;
    }

    fn prune(&mut self, delimiters: &mut [Delimiter], index: usize) {
        let delimiter = &mut delimiters[index];
        if delimiter.length == 0 {
            self.unlink(index);
        } else if delimiter.marker == 126 && delimiter.length < 2 {
            delimiter.can_open = false;
            delimiter.can_close = false;
            self.unlink(index);
        }
    }
}

pub fn match_pairs(delimiters: &mut [Delimiter]) -> Vec<Pair> {
    let mut pairs = Vec::new();
    let mut links = Links {
        previous: (0..delimiters.len())
            .map(|index| index.checked_sub(1))
            .collect(),
        next: (0..delimiters.len())
            .map(|index| (index + 1 < delimiters.len()).then_some(index + 1))
            .collect(),
        active: vec![true; delimiters.len()],
    };
    let mut closer_index = (!delimiters.is_empty()).then_some(0);
    while let Some(closer_id) = closer_index {
        let closer = delimiters[closer_id];
        if !closer.can_close || closer.length == 0 {
            closer_index = links.next[closer_id];
            continue;
        }
        let mut opener_index = links.previous[closer_id];
        while let Some(index) = opener_index {
            let opener = delimiters[index];
            let multiple_of_three = opener.marker != 126
                && opener.can_close
                && closer.can_open
                && (opener.length + closer.length).is_multiple_of(3)
                && (!opener.length.is_multiple_of(3) || !closer.length.is_multiple_of(3));
            if opener.marker == closer.marker
                && opener.can_open
                && opener.length > 0
                && !multiple_of_three
            {
                break;
            }
            opener_index = links.previous[index];
        }
        let Some(opener_id) = opener_index else {
            closer_index = links.next[closer_id];
            if !closer.can_open {
                links.unlink(closer_id);
            }
            continue;
        };
        let opener = delimiters[opener_id];
        let pair_length = if opener.length >= 2 && closer.length >= 2 {
            2
        } else if opener.marker == 126 {
            0
        } else {
            1
        };
        if pair_length == 0 || opener.position + 1 >= closer.position {
            closer_index = links.next[closer_id];
            continue;
        }
        pairs.push(Pair {
            opener: opener_id,
            closer: closer_id,
            kind: if opener.marker == 126 {
                "strikethrough"
            } else if pair_length == 2 {
                "strong"
            } else {
                "emphasis"
            },
        });
        delimiters[opener_id].length -= pair_length;
        delimiters[closer_id].length -= pair_length;
        let mut trapped = links.next[opener_id];
        while let Some(index) = trapped {
            if index == closer_id {
                break;
            }
            trapped = links.next[index];
            links.unlink(index);
        }
        links.prune(delimiters, opener_id);
        links.prune(delimiters, closer_id);
        if !links.active[closer_id]
            || !delimiters[closer_id].can_close
            || delimiters[closer_id].length == 0
        {
            closer_index = links.next[closer_id];
        }
    }
    pairs
}
