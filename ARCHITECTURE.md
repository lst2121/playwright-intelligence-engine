# System Architecture: Playwright Intelligence Engine (v2.4 Enterprise Architecture)

Please refer to the comprehensive enterprise architecture specification in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Summary Highlights of v2.4 Architecture Contract As-Built:
1. **Deterministic Controller**: Strictly typed TypeScript state machine; bounded semantic interpretation only.
2. **Intent Invariant v2**: $V = A \land T \land F \land I \land D \land E$ (canonical AST assertion hash, structural control flow invariant, fixture invariant, action semantics, diff allowlist, worktree execution).
3. **Causal Evidence Graph**: Filters telemetry and non-causal endpoints to eliminate false `BACKEND_500` classifications.
4. **Strict Element Uniqueness Gate**: Disqualifies candidates with $matchCount \neq 1$ to prevent strict-mode locator ambiguities.
5. **Versioned Trace Adapters**: Full schema compatibility for Playwright trace versions v5 through v10 with explicit fallback abstention.
6. **Dependency Isolation Strategy**: Windows NTFS junctions, PID tracking, process termination safety, and package manager compatibility (npm, pnpm, yarn pnp).
7. **Empirically Benchmarked**: 104 adversarial scenarios, 100% defect detection rate, 0.0% false repair rate, Wilson 95% CI `[96.44%, 100%]`.
