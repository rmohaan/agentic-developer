import { generateText, parseJsonObject } from "../clients/gemini";
import type { CompilationErrorAnalysis, RepoSnapshot, TestExecutionReport } from "../types";

export function isCompilationFailure(report: TestExecutionReport | undefined): boolean {
  if (!report || report.success) {
    return false;
  }

  const merged = `${report.failureCause ?? ""}\n${report.stderrSnippet ?? ""}\n${report.stdoutSnippet ?? ""}`.toLowerCase();

  return (
    merged.includes("compilation error") ||
    merged.includes("compile failed") ||
    merged.includes("cannot find symbol") ||
    merged.includes("package does not exist") ||
    merged.includes("execution failed for task ':compile") ||
    merged.includes("ts") && merged.includes("error") ||
    merged.includes("syntaxerror")
  );
}

export async function buildCompilationErrorAnalysis(params: {
  report: TestExecutionReport;
  repo: RepoSnapshot;
}): Promise<CompilationErrorAnalysis> {
  const heuristic = getHeuristicAnalysis(params.report);

  try {
    const prompt = [
      "You are diagnosing a software compilation/build failure.",
      "Return JSON only with schema:",
      JSON.stringify(
        {
          detected: true,
          summary: "string",
          rootCause: "string",
          potentialSolutions: ["string"],
          followUpChecks: ["string"],
        },
        null,
        2,
      ),
      "Focus on concrete, practical remediation steps.",
      `Detected stack: ${params.repo.techStack.join(", ")}`,
      `Test/build command: ${params.report.command ?? "unknown"}`,
      `Failure cause: ${params.report.failureCause ?? ""}`,
      "stderr excerpt:",
      params.report.stderrSnippet ?? "",
      "stdout excerpt:",
      params.report.stdoutSnippet ?? "",
      "Heuristic baseline analysis:",
      JSON.stringify(heuristic, null, 2),
    ].join("\n\n");

    const raw = await generateText(prompt, true);
    const parsed = parseJsonObject<CompilationErrorAnalysis>(raw);

    return {
      detected: true,
      summary: parsed.summary || heuristic.summary,
      rootCause: parsed.rootCause || heuristic.rootCause,
      potentialSolutions: parsed.potentialSolutions?.length ? parsed.potentialSolutions : heuristic.potentialSolutions,
      followUpChecks: parsed.followUpChecks?.length ? parsed.followUpChecks : heuristic.followUpChecks,
    };
  } catch {
    return heuristic;
  }
}

function getHeuristicAnalysis(report: TestExecutionReport): CompilationErrorAnalysis {
  const merged = `${report.failureCause ?? ""}\n${report.stderrSnippet ?? ""}\n${report.stdoutSnippet ?? ""}`.toLowerCase();

  if (merged.includes("cannot find symbol") || merged.includes("package") && merged.includes("does not exist")) {
    return {
      detected: true,
      summary: "Build failed due to unresolved classes/imports.",
      rootCause: "Missing or incorrect imports/dependencies, or wrong package references.",
      potentialSolutions: [
        "Verify class/package names and import statements in changed files.",
        "Confirm required dependency is declared in pom.xml/build.gradle/package.json.",
        "Check module boundaries and visibility (public/package-private) for referenced types.",
      ],
      followUpChecks: [
        "Re-run the same compile/test command after fixing imports/dependencies.",
        "Run IDE or compiler auto-import and inspect resulting diff.",
      ],
    };
  }

  if (merged.includes("invalid target release") || merged.includes("source option") || merged.includes("unsupportedclassversionerror")) {
    return {
      detected: true,
      summary: "Build failed due to Java toolchain mismatch.",
      rootCause: "Project source/target compatibility differs from active JDK version.",
      potentialSolutions: [
        "Set JAVA_HOME to the required JDK version for the project.",
        "Align maven-compiler-plugin or Gradle Java toolchain target with installed JDK.",
        "If CI uses a specific JDK, mirror that version locally.",
      ],
      followUpChecks: [
        "Run `java -version` and `mvn -version`/`gradle -version` to verify toolchain.",
        "Re-run build command after adjusting toolchain settings.",
      ],
    };
  }

  if (merged.includes("execution failed for task ':compile") || merged.includes("compilation error")) {
    return {
      detected: true,
      summary: "Build failed during compilation task.",
      rootCause: "Source changes introduced compile-time errors.",
      potentialSolutions: [
        "Inspect the first compiler error and fix that before addressing cascading errors.",
        "Verify method signatures, static vs instance usage, and generic/type constraints.",
        "Ensure all changed files compile together with the current project settings.",
      ],
      followUpChecks: [
        "Re-run compilation/tests and confirm no new compile errors are introduced.",
      ],
    };
  }

  return {
    detected: true,
    summary: "Compilation/build failure detected.",
    rootCause: report.failureCause ?? "Build tool reported a compilation failure.",
    potentialSolutions: [
      "Inspect first meaningful error line in stderr and address it before secondary errors.",
      "Check dependency declarations, imports, and language version/toolchain settings.",
      "Re-run build with verbose logs to isolate failing module/file.",
    ],
    followUpChecks: [
      "Re-run the same command after applying fix.",
      "Confirm tests and coverage report generation succeed.",
    ],
  };
}
