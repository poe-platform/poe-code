//! One UTC instant per calculation, shared with conditional formatting.
//! Reuse Poe's native/Wasm wall clock; workbook files contain no clock override.
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(in super::super) fn now_ms() -> f64 {
    #[cfg(test)]
    if let Some(time) = TEST_TIME.with(|clock| clock.get()) {
        return time;
    }
    crate::vfs::now_ms()
}

pub(super) fn serial(milliseconds: f64, date1904: bool) -> Option<f64> {
    if !milliseconds.is_finite() {
        return None;
    }
    let days = (milliseconds / 86_400_000.).floor();
    if days < days_from_civil(1900, 1, 1) as f64 || days >= days_from_civil(10000, 1, 1) as f64 {
        return None;
    }
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 31)
    };
    let leap = f64::from(!date1904 && days >= days_from_civil(1900, 3, 1) as f64);
    // Separate the integer day from the time to retain subsecond precision.
    Some(days - epoch as f64 + leap + milliseconds.rem_euclid(86_400_000.) / 86_400_000.)
}

pub(super) fn period_bounds(period: &str, milliseconds: f64, date1904: bool) -> Option<(f64, f64)> {
    let today = serial(milliseconds, date1904)?.floor();
    let bounds = match period {
        "yesterday" => (today - 1., today),
        "today" => (today, today + 1.),
        "tomorrow" => (today + 1., today + 2.),
        "last7Days" => (today - 6., today + 1.),
        "lastWeek" | "thisWeek" | "nextWeek" => {
            // Excel's WEEKDAY(...,1): Sunday starts the week in both calendars.
            let sunday = today - (today + if date1904 { 5. } else { 6. }).rem_euclid(7.);
            let start = sunday
                + match period {
                    "lastWeek" => -7.,
                    "nextWeek" => 7.,
                    _ => 0.,
                };
            (start, start + 7.)
        }
        "lastMonth" | "thisMonth" | "nextMonth" => {
            let (year, month, _) = civil_from_days((milliseconds / 86_400_000.).floor() as i64);
            let month = year * 12 + month as i64 - 1
                + match period {
                    "lastMonth" => -1,
                    "nextMonth" => 1,
                    _ => 0,
                };
            let first = |month: i64| {
                let days = days_from_civil(month.div_euclid(12), month.rem_euclid(12) + 1, 1);
                (days
                    - if date1904 {
                        days_from_civil(1904, 1, 1)
                    } else {
                        days_from_civil(1899, 12, 31)
                    }) as f64
                    + f64::from(!date1904 && days >= days_from_civil(1900, 3, 1))
            };
            (first(month), first(month + 1))
        }
        _ => return None,
    };
    Some(bounds)
}

#[cfg(test)]
thread_local! { static TEST_TIME: std::cell::Cell<Option<f64>> = const { std::cell::Cell::new(None) }; }

#[cfg(test)]
pub(in super::super) fn with_time<T>(milliseconds: f64, run: impl FnOnce() -> T) -> T {
    struct Restore(Option<f64>);
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_TIME.with(|clock| clock.set(self.0));
        }
    }
    let _restore = Restore(TEST_TIME.with(|clock| clock.replace(Some(milliseconds))));
    run()
}
