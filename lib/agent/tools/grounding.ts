import type { RepoSnapshot } from "../types";

export function buildGroundingChecklist(repo: RepoSnapshot): string[] {
  const checks: string[] = [];
  const langs = repo.languageSummary;

  if (langs.TypeScript || langs.JavaScript) {
    checks.push("Run lint and tests: npm run lint && npm test (or pnpm/yarn equivalent)");
  }
  if (langs.Python) {
    checks.push("Run static checks and tests: ruff check . && pytest");
  }
  if (langs.Go) {
    checks.push("Run go validation: go test ./... and go vet ./...");
  }
  if (langs.Java || langs.Kotlin) {
    checks.push("Run JVM validation: ./gradlew test (or mvn test)");
  }

  if (checks.length === 0) {
    checks.push("Run project-specific build/test checks from CI pipeline.");
  }

  checks.push("Compare generated diff against task acceptance criteria and non-functional requirements.");
  checks.push("Verify security-sensitive changes and dependency updates with trusted sources.");

  return checks;
}
