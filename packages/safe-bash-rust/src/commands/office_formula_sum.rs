use super::approximately_equal;

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
}
