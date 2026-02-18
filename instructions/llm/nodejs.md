# Node.js Instructions

- Respect runtime constraints (Node version, ESM/CommonJS mode, package manager).
- Keep IO boundaries mockable and avoid flaky timers/network in unit tests.
- Use dependency injection or module mocking patterns already present.
- If changing server handlers/services, add unit tests around handler/service behavior.
