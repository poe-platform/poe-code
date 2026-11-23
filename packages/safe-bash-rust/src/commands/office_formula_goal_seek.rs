// Shared production financial goal-seek algorithm; see financial-goal-seek.ts.
pub(super) struct Solver<'a, F> {
    f: F,
    work: &'a mut usize,
    positive: Option<(f64, f64)>,
    negative: Option<(f64, f64)>,
    pub(super) root: f64,
    minimum: f64,
    maximum: f64,
    derivative: Option<&'a dyn Fn(f64) -> f64>,
}

impl<'a, F: Fn(f64, &mut usize) -> Option<f64>> Solver<'a, F> {
    pub(super) fn new(
        f: F,
        work: &'a mut usize,
        minimum: f64,
        maximum: f64,
        derivative: Option<&'a dyn Fn(f64) -> f64>,
    ) -> Self {
        Self {
            f,
            work,
            minimum,
            maximum,
            derivative,
            positive: None,
            negative: None,
            root: f64::NAN,
        }
    }
    pub(super) fn point(&mut self, x: f64) -> Option<bool> {
        if !self.root.is_nan() {
            return Some(true);
        }
        if x < self.minimum || x > self.maximum {
            return Some(false);
        }
        let y = self.evaluate(x)?;
        Some(self.update(x, y))
    }
    fn evaluate(&mut self, x: f64) -> Option<f64> {
        *self.work = self.work.checked_sub(1)?;
        (self.f)(x, self.work)
    }
    fn update(&mut self, x: f64, y: f64) -> bool {
        if !y.is_finite() {
            return false;
        }
        if y == 0. {
            self.root = x;
            return true;
        }
        let (current, other) = if y > 0. {
            (&mut self.positive, self.negative)
        } else {
            (&mut self.negative, self.positive)
        };
        if current.is_none_or(|c| {
            other.map_or(y.abs() < c.1.abs(), |o| (x - o.0).abs() < (c.0 - o.0).abs())
        }) {
            *current = Some((x, y));
        }
        false
    }
    pub(super) fn bracketed(&self) -> bool {
        self.positive.is_some() && self.negative.is_some()
    }
    fn slope(&mut self, x: f64, step: f64) -> Option<f64> {
        let left = if x - step < self.minimum { x } else { x - step };
        let right = if x + step > self.maximum { x } else { x + step };
        if left == right {
            return Some(f64::NAN);
        }
        let y = self.evaluate(left)?;
        if y.is_nan() {
            return Some(f64::NAN);
        }
        Some((self.evaluate(right)? - y) / (right - left))
    }
    pub(super) fn newton(&mut self, mut x: f64) -> Option<bool> {
        if !self.root.is_nan() {
            return Some(true);
        }
        let mut last_slope: f64 = 1.;
        let mut step_factor = 1e-6;
        for i in 0..100 {
            if x < self.minimum || x > self.maximum {
                return Some(false);
            }
            let y = self.evaluate(x)?;
            if y.is_nan() {
                return Some(false);
            }
            if self.update(x, y) {
                return Some(true);
            }
            let step = if x.abs() < 1e-10 {
                (if self.bracketed() {
                    (self.positive?.0 - self.negative?.0).abs()
                } else {
                    self.maximum - self.minimum
                }) / 1e6
            } else {
                step_factor * x.abs()
            };
            let mut slope = match self.derivative {
                Some(f) => f(x),
                None => self.slope(x, step)?,
            };
            if !slope.is_finite() {
                return Some(false);
            }
            let flat = slope == 0.;
            if flat {
                last_slope /= 2.;
                if last_slope.abs() <= f64::MIN_POSITIVE {
                    return Some(false);
                }
                slope = last_slope;
            } else {
                last_slope = slope;
            }
            let next = x - if self.bracketed() { 1. } else { 1.000001 } * y / slope;
            let size = (next - x).abs() / (x.abs() + next.abs());
            if size < 5e-11 {
                return self.polish(x, y);
            }
            if flat && i > 0 {
                if next < self.minimum || next > self.maximum {
                    return Some(false);
                }
                let next_y = self.evaluate(next)?;
                if next_y.is_nan() || next_y.abs() >= 0.9 * y.abs() {
                    return Some(false);
                }
            }
            if size < step_factor {
                step_factor = size;
            }
            x = next;
        }
        Some(false)
    }
    fn polish(&mut self, mut x: f64, y: f64) -> Option<bool> {
        let mut last_slope = 1.;
        let mut square = x != 0. && x.abs() < 1e10;
        for _ in 0..20 {
            if square {
                let next = x * x.abs();
                let next_y = self.evaluate(next)?;
                if self.update(next, next_y) {
                    return Some(true);
                }
                let ratio = (next_y / y).abs();
                if !next_y.is_nan() && ratio < 1. {
                    x = next;
                    if ratio <= 0.5 {
                        continue;
                    }
                }
                square = false;
            }
            let mut slope = match self.derivative {
                Some(f) => f(x),
                None => self.slope(x, x.abs() / 1e6)?,
            };
            if !slope.is_finite() || slope == 0. {
                slope = last_slope;
            } else {
                last_slope = slope;
            }
            let next = x - y / slope;
            if next >= self.minimum && next <= self.maximum {
                let next_y = self.evaluate(next)?;
                if self.update(next, next_y) {
                    return Some(true);
                }
                let ratio = (next_y / y).abs();
                if !next_y.is_nan() && ratio < 1. {
                    x = next;
                    if ratio <= 0.5 {
                        continue;
                    }
                }
            }
            break;
        }
        if self.bisect()? {
            return Some(true);
        }
        self.root = x;
        Some(true)
    }
    pub(super) fn bisect(&mut self) -> Option<bool> {
        if !self.root.is_nan() {
            return Some(true);
        }
        if !self.bracketed() {
            return Some(false);
        }
        let mut size = (self.positive?.0 - self.negative?.0).abs()
            / (self.positive?.0.abs() + self.negative?.0.abs());
        let mut submethod = 0;
        for i in 0..160 {
            let pos = self.positive?;
            let neg = self.negative?;
            let mut mid = (pos.0 + neg.0) / 2.;
            if i % 4 == 0 {
                let y = self.evaluate(mid)?;
                if y.is_nan() {
                    continue;
                }
                if y == 0. {
                    return Some(self.update(mid, y));
                }
                let determinant = (y * y - pos.1 * neg.1).sqrt();
                if determinant == 0. {
                    continue;
                }
                mid += (mid - pos.0) * y / determinant;
            } else if i % 4 == 2 && size <= 0.1 {
                let method = submethod % 4;
                submethod += 1;
                let (x, y) = match method {
                    0 => pos,
                    2 => neg,
                    _ => (mid, self.evaluate(mid)?),
                };
                let slope = self.slope(x, (pos.0 - neg.0).abs() / 1e6)?;
                if !slope.is_finite() || slope == 0. || y.is_nan() {
                    continue;
                }
                mid = x - 1.01 * y / slope;
            }
            if mid < pos.0.min(neg.0) || mid > pos.0.max(neg.0) {
                mid = (pos.0 + neg.0) / 2.;
            }
            let y = self.evaluate(mid)?;
            if y.is_nan() {
                continue;
            }
            if self.update(mid, y) {
                return Some(true);
            }
            let pos = self.positive?;
            let neg = self.negative?;
            size = (pos.0 - neg.0).abs() / (pos.0.abs() + neg.0.abs());
            if size < f64::EPSILON {
                let (mut x, mut y) = (mid, y);
                if neg.1 < y {
                    y = neg.1;
                    x = neg.0;
                }
                if pos.1 < y {
                    x = pos.0;
                }
                self.root = x;
                return Some(true);
            }
        }
        Some(false)
    }
}
