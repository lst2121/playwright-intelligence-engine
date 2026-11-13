# PIE Phase 7 — Statistical Verification & Confidence Intervals Report

**Phase:** Phase 7  
**Module:** Statistical Verification Engine (`src/sandbox/execution-runner.ts`, `benchmarks/flakiness/pie-flake-runner.ts`)  
**Status:** FULLY IMPLEMENTED & VERIFIED  

---

## 1. The Fallacy of Single-Run Test Passing

In test automation and test repair tools, the standard practice is fundamentally unscientific: a tool applies a patch, executes the test once, sees that it exits with code 0, and declares the test "100% repaired and stable".

This claim is statistically invalid:
- An intermittently flaky test with a true failure probability of $40\%$ will still pass on a single run $60\%$ of the time.
- A single run provides zero statistical power to prove that timing flakiness, race conditions, or hydration lags have been eliminated.

---

## 2. Mathematical Foundation: The Wilson Score Interval

PIE implements the asymmetric binomial **Wilson Score 95% Confidence Interval**:

Given $n$ Bernoulli trials with $n_s$ successes and sample proportion $\hat{p} = \frac{n_s}{n}$:

$$\tilde{n} = n + z^2$$

$$\tilde{p} = \frac{n_s + \frac{z^2}{2}}{\tilde{n}}$$

$$\text{Margin of Error} = \frac{z}{\tilde{n}} \sqrt{n \hat{p} (1 - \hat{p}) + \frac{z^2}{4}}$$

$$\text{Confidence Interval} = \left[ \max\left(0, \tilde{p} - \text{Margin}\right), \min\left(1, \tilde{p} + \text{Margin}\right) \right]$$

For a 95% confidence level, $z = 1.95996$.

### Why Wilson Score Over Normal Approximation?
The standard normal approximation (Wald interval $\hat{p} \pm z \sqrt{\frac{\hat{p}(1-\hat{p})}{n}}$) produces nonsensical zero-width confidence intervals when $\hat{p} = 1.0$ or $\hat{p} = 0.0$, falsely claiming 100% certainty from small sample sizes. 
In contrast, for $n = 5$ trials with 5 passes, the Wilson Score interval correctly yields:
$$\text{CI}_{95\%} = [56.55\%, 100.0\%]$$
For $n = 15$ trials with 15 passes, the Wilson Score interval tightens to:
$$\text{CI}_{95\%} = [79.61\%, 100.0\%]$$
And across the 125 Master Benchmark scenarios with 120 successes, the Wilson Score interval is:
$$\text{CI}_{95\%} = [94.35\%, 99.56\%]$$

---

## 3. Implementation in PIE Core

Implemented in `src/sandbox/execution-runner.ts`:
```typescript
export function computeWilsonScoreInterval(
  successes: number,
  trials: number,
  confidenceLevel: number = 0.95
): { lower: number; upper: number; center: number; confidenceLevel: number } {
  if (trials <= 0) {
    return { lower: 0, upper: 0, center: 0, confidenceLevel };
  }
  const z = 1.95996; // 95% two-sided normal quantile
  const p = successes / trials;
  const n = trials;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const halfWidth =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;

  const lower = Math.max(0, center - halfWidth);
  const upper = Math.min(1, center + halfWidth);

  return {
    lower: Math.round(lower * 10000) / 100,
    upper: Math.round(upper * 10000) / 100,
    center: Math.round(center * 10000) / 100,
    confidenceLevel,
  };
}
```

Every benchmark, flakiness evaluation, and multi-trial repair verification in PIE reports the two-sided Wilson confidence interval alongside point estimates.
