# ADR-004: Zero-Tolerance Testing Policy

## Status

Accepted

## Context

Reliability is critical. Flaky, skipped, or ignored tests hide regressions and erode confidence in the test suite over time. We need a clear policy that keeps the test suite trustworthy.

## Decision

- All tests must pass on every CI run. A failing test blocks merge.
- Tests must not be annotated as skipped or ignored (`#[ignore]`, `xit`, `test.skip`, `test.todo`) without a linked tracking issue and a documented expiration date.
- Every public function, API endpoint, and UI component must have at least one test covering its primary behavior.
- Test coverage regressions on changed files are flagged in PR review.

## Consequences

- High confidence that main branch is always in a working state.
- Slightly higher upfront effort to write and maintain tests.
- Broken tests surface immediately rather than accumulating silently.
- CI pipeline is the source of truth for project health.
