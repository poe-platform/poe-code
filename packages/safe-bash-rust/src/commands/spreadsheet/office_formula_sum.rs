use super::{Coord, approximately_equal};

// Calc 24.8 queues the last nonzero term for approximate cancellation and
// compensates the preceding additions with Neumaier summation.
#[derive(Clone, Copy, Default)]
pub(super) struct Sum {
    sum: f64,
    error: f64,
    last: f64,
}

impl Sum {
    fn accumulate(&mut self, value: f64) {
        let total = self.sum + value;
        self.error += if self.sum.abs() >= value.abs() {
            (self.sum - total) + value
        } else {
            (value - total) + self.sum
        };
        self.sum = total;
    }

    pub(super) fn add(&mut self, value: f64) {
        if value != 0. {
            if self.last != 0. {
                self.accumulate(self.last);
            }
            self.last = value;
        }
    }

    pub(super) fn merge(&mut self, other: Self) {
        self.add(other.sum + other.error);
        self.add(other.last);
    }

    pub(super) fn subtract(&mut self, other: Self) {
        self.add(-other.sum - other.error);
        self.add(-other.last);
    }

    pub(super) fn total(&mut self) -> f64 {
        let total = self.sum + self.error;
        if self.last == 0. {
            return total;
        }
        if ((self.last < 0. && total > 0.) || (self.last > 0. && total < 0.))
            && approximately_equal(self.last, -total)
        {
            return 0.;
        }
        self.accumulate(self.last);
        self.last = 0.;
        self.sum + self.error
    }

    fn array(values: &[(Coord, f64, bool)]) -> Self {
        // Match the x86_64 native oracle's eight SSE2 lanes on every target,
        // including Wasm. These lanes accumulate without a queued last term.
        let mut lanes = [Self::default(); 8];
        let mut chunks = values.chunks_exact(8);
        for chunk in &mut chunks {
            for (lane, (_, value, _)) in lanes.iter_mut().zip(chunk) {
                lane.accumulate(*value);
            }
        }
        for (to, from) in [(0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (0, 1)] {
            lanes[to].accumulate(lanes[from].sum);
            lanes[to].accumulate(lanes[from].error);
        }
        let mut sum = lanes[0];
        for (_, value, _) in chunks.remainder() {
            sum.add(*value);
        }
        // Native sumArray finalizes its pending term while checking overflow;
        // approximate cancellation returns zero without changing the state.
        sum.total();
        sum
    }
}

pub(super) enum Term {
    Number(f64),
    Group(Sum),
}

// Cells arrive in sheet/column/row order. Blanks and text leave row gaps;
// formulas interrupt numeric storage blocks even when they return a number.
pub(super) fn range(cells: &[(Coord, f64, bool)]) -> Sum {
    let mut result = Sum::default();
    let mut start = 0;
    while start < cells.len() {
        let column = (cells[start].0.0, cells[start].0.2);
        let mut sum = Sum::default();
        while start < cells.len() && (cells[start].0.0, cells[start].0.2) == column {
            if cells[start].2 {
                sum.add(cells[start].1);
                start += 1;
            } else {
                let mut end = start + 1;
                while end < cells.len()
                    && (cells[end].0.0, cells[end].0.2) == column
                    && !cells[end].2
                    && cells[end].0.1 == cells[end - 1].0.1 + 1
                {
                    end += 1;
                }
                sum.merge(Sum::array(&cells[start..end]));
                start = end;
            }
        }
        result.merge(sum);
    }
    result
}
