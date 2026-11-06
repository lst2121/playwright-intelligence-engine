# PIE LLM Agent Boundary

PIE now contains an executable, bounded proposal-agent layer, but it is not an
unrestricted autonomous coding agent.

## Runtime contract

1. `FailureClassifier` runs first.
2. Hard negative controls and environment/application failures terminate with
   `DETERMINISTIC_ABSTAIN`; the model is not invoked.
3. The caller must provide an `EvidenceBundle` whose `redactionComplete` flag
   is explicitly true.
4. An optional `ProposalProvider` may return only the strict
   `LlmRepairProposal` schema.
5. PIE rejects malformed operations and proposals whose failure kind conflicts
   with deterministic classification.
6. `PROPOSAL_RECEIVED` is not a repair success. Worktree execution, intent and
   oracle verification, approval, and promotion remain separate gates.

The implementation is in `src/intelligence/repair-agent.ts` and
`src/intelligence/evidence-bundle.ts`. Trace-backed invocation is exposed by
the MCP `propose_repair` tool. The provider remains optional and
caller-configured; there is still no mandatory cloud model or built-in model
credential.

## Why this is agentic, but controlled

The agent can make a bounded reasoning decision after observing normalized
evidence, but it cannot freely edit files, execute arbitrary commands, weaken
assertions, or approve its own patch. The trace-to-repair workflow can consume
structured allowlisted operations, including constrained browser state waits,
while worktree verification and explicit approval remain separate gates before
promotion. Arbitrary wait strings, page evaluation, and free-form interaction
are rejected or remain proposal-only.

## External failure bundles

`pw-intel diagnose <trace.zip> --error-context <error-context.md>` and the
equivalent MCP argument allow Playwright’s companion error context to
supplement traces that contain no failed action. The external text is redacted
before it enters the diagnostic context.
