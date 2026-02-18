# TypeScript Instructions

- Preserve strict typing; avoid `any` unless unavoidable and justified.
- Use existing path aliases and tsconfig module resolution.
- For static methods, test with `ClassName.method(...)` and compile-time-safe expectations.
- Ensure test code is type-correct and compatible with configured TypeScript target.
- Prefer table-driven tests for pure/static utility logic where appropriate.
