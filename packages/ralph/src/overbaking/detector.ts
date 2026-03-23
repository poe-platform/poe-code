export class OverbakingDetector {
  readonly threshold: number;
  private consecutiveFailures = 0;

  constructor(threshold: number) {
    this.threshold = threshold;
  }

  record(_success: boolean): {
    consecutiveFailures: number;
    overbaked: boolean;
    shouldWarn: boolean;
  } {
    if (_success) {
      this.consecutiveFailures = 0;
      return {
        consecutiveFailures: 0,
        overbaked: false,
        shouldWarn: false
      };
    }

    this.consecutiveFailures += 1;

    return {
      consecutiveFailures: this.consecutiveFailures,
      overbaked: this.consecutiveFailures >= this.threshold,
      shouldWarn: this.consecutiveFailures === this.threshold
    };
  }
}
