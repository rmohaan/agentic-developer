# Developer Agent Workbench (Next.js + LangGraph + Gemini)

This project is a starting point for a **developer agent** that takes a Jira/GitLab ticket and runs a ticket-to-PR workflow with human approval gates.

## What it does

1. Reads a Jira task or GitLab issue by ID.
2. Scans the repository to understand structure and language mix.
3. Creates/switches to a `feat/<task>` branch (unless in dry-run mode).
4. Uses Gemini + LangGraph reasoning to produce a concrete implementation proposal.
5. Generates draft edits with stack-aware unit-test expectations and quality gate checks.
6. Shows proposal plus side-by-side diff to human reviewer (HITL).
7. On approval, applies changes and optionally commits/pushes/creates GitLab MR.
8. Stores reviewer feedback to improve future runs.

## Model choice (Gemini)

Default planner model is `gemini-3-pro-preview` (best reasoning/coding quality), with `gemini-2.5-flash` as fast helper.

For stricter production stability, set:
- `GEMINI_MODEL_PLANNER=gemini-2.5-pro`

## Stack

- **Frontend / API:** Next.js (App Router), TypeScript
- **Orchestration:** LangGraph JS (`@langchain/langgraph`)
- **LLM:** Gemini via Google GenAI SDK (`@google/genai`) over ADC
- **Validation:** Zod

## Architecture

LangGraph nodes in `lib/agent/workflow.ts`:

1. `loadTask`: fetch Jira/GitLab ticket
2. `scanRepo`: enumerate files/languages
3. `loadFeedback`: load past HITL feedback memory
4. `prepareBranch`: create/checkout `codex/*` branch
5. `propose`: generate implementation + test/grounding plan
6. `draftChanges`: generate staged edits and enforce unit-test presence for detected stacks
7. `testAndCoverageGate`: temporarily apply staged edits, run tests with coverage, restore working copy, and return per-file coverage

Approval endpoint then runs finalize stage:
- generate concrete file edits
- apply edits to repo
- produce diff preview
- optionally commit/push/open GitLab merge request

## LLM instruction bundles

Stack-aware coding/testing instructions are stored in:
- `instructions/llm/common.md`
- `instructions/llm/java.md`
- `instructions/llm/javascript.md`
- `instructions/llm/typescript.md`
- `instructions/llm/nodejs.md`
- `instructions/llm/nextjs.md`
- `instructions/llm/python.md`

These files are dynamically loaded based on detected stack and injected into model prompts during planning and code/test generation.

## API endpoints

- `POST /api/agent/run`
  - body:
    ```json
    {
      "taskId": "PROJ-123",
      "tracker": "jira",
      "repoPath": "/absolute/or/relative/path",
      "targetBranch": "develop",
      "dryRun": true
    }
    ```

- `POST /api/agent/approve`
  - body:
    ```json
    {
      "runId": "<uuid>",
      "approved": true,
      "feedback": "Please use pagination for this endpoint"
    }
    ```

## Environment variables

Create `.env.local`:

```bash
# Gemini / Vertex AI via ADC
GOOGLE_CLOUD_PROJECT=<gcp-project-id>
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL_PLANNER=gemini-3-pro-preview
GEMINI_MODEL_FAST=gemini-2.5-flash

# Jira (if using tracker=jira)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=<jira-api-token>

# GitLab (for tracker=gitlab and/or MR creation)
GITLAB_BASE_URL=https://gitlab.example.com
GITLAB_TOKEN=<gitlab-access-token>
GITLAB_PROJECT_ID=<project-id>
```

## Google ADC setup

```bash
gcloud auth application-default login
gcloud config set project <gcp-project-id>
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Grounding and verification

The agent includes grounding checklist generation in `lib/agent/tools/grounding.ts`:
- JS/TS: lint + tests
- Python: ruff + pytest
- Go: go test + go vet
- Java/Kotlin: gradle/maven tests

Use this as the baseline; customize per repo CI contract.

## Side-by-side diff review

The web UI renders unified diff previews as a side-by-side view with line numbers:
- left pane: original content
- right pane: proposed content

This is shown before approval so reviewers can inspect changes clearly.

## Test execution and per-file coverage in review

Before approval, the agent now executes a test/coverage gate on staged edits:

1. Saves original content of edited files.
2. Applies staged edits to the working copy.
3. Runs repository test coverage command (currently implemented for JS/TS Node repos):
   - `npm|pnpm|yarn run test:coverage` if available
   - otherwise `run coverage`
   - otherwise `run test -- --coverage`
4. Parses `coverage/lcov.info` and maps line coverage to each edited file.
5. Restores original file content so reviewer still approves before final application.

The review UI shows:
- pass/fail status
- executed command
- overall line coverage for changed files
- per-file coverage numbers
- stderr snippet when tests fail

## Reinforcement from human feedback

Feedback is persisted in `.agent-memory/feedback-history.json` and reused in planning prompts to reduce repeated mistakes and improve alignment.

## Important notes

- This is a foundation implementation, not a full autonomous software engineer.
- Keep `dryRun=true` until governance and safety checks are complete.
- For multi-agent/A2A evolution, keep this agent as the "Developer Executor" role and add Planner/Reviewer agents as separate orchestrated graphs.
