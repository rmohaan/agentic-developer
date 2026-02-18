# Common Coding And Testing Instructions

- Preserve existing architecture and conventions unless task explicitly asks for refactor.
- Keep changes minimal, deterministic, and backward compatible.
- Add or update unit tests for each behavior change before considering work complete.
- Prefer modifying existing tests over adding duplicate test files.
- Ensure tests assert behavior, not implementation details.
- Never fabricate APIs, imports, or framework utilities.
- If code uses static/class methods, test invocation must follow language semantics.
- Do not instantiate classes only to call static/class methods unless constructor behavior is under test.
- Keep test naming explicit and scenario-driven.
- Include negative/error-path coverage for critical logic.
- Keep security and input validation checks in scope for changed paths.
