use task_list_rust::migration::{Search, TokenBucket};
fn text(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn queue_and_visited_preserve_order_and_exact_utf16() {
    let mut search = Search::new(text("draft")).unwrap();
    assert!(search.has(&text("draft")));
    assert_eq!(search.next().unwrap(), (text("draft"), vec![]));
    assert_eq!(search.next(), None);
    search.mark(vec![0xd800]).unwrap();
    assert!(search.has(&[0xd800]));
    assert!(!search.has(&[0xfffd]));
    search.push(text("planned"), vec![text("plan")]).unwrap();
    search
        .push(text("done"), vec![text("plan"), text("complete")])
        .unwrap();
    assert_eq!(
        search.next().unwrap(),
        (text("planned"), vec![text("plan")])
    );
    assert_eq!(
        search.next().unwrap(),
        (text("done"), vec![text("plan"), text("complete")])
    );
}
#[test]
fn token_capacity_refill_and_fractional_rate() {
    let mut bucket = TokenBucket::new(15.0, 0.0).unwrap();
    for _ in 0..15 {
        assert_eq!(bucket.take(0.0), None);
    }
    assert_eq!(bucket.take(0.0), Some(4000.0));
    assert_eq!(bucket.take(4000.0), None);
    let mut bucket = TokenBucket::new(0.5, 0.0).unwrap();
    assert_eq!(bucket.take(0.0), None);
    assert_eq!(bucket.take(0.0), Some(120000.0));
    assert_eq!(bucket.take(60000.0), Some(60000.0));
    assert_eq!(bucket.take(120000.0), None);
}
#[test]
fn token_clock_reversal_and_nonfinite_rates() {
    for rate in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(TokenBucket::new(rate, 0.0).is_err());
    }
    let mut bucket = TokenBucket::new(1.0, 1000.0).unwrap();
    assert_eq!(bucket.take(1000.0), None);
    assert_eq!(bucket.take(0.0), Some(61000.0));
    let mut bucket = TokenBucket::new(1.0, 0.0).unwrap();
    assert!(bucket.take(f64::NAN).unwrap().is_nan());
}
#[test]
fn queue_budget_rejects_without_mutation_and_releases_drained_units() {
    let mut search = Search::new(text("a")).unwrap();
    search.next();
    assert!(search.push(vec![97; 1_048_576], vec![]).is_err());
    assert_eq!(search.next(), None);
    assert!(search.push(vec![97; 1_048_575], vec![]).is_ok());
    assert!(search.push(text("b"), vec![]).is_err());
    search.next();
    assert!(search.push(text("b"), vec![]).is_ok());
}
