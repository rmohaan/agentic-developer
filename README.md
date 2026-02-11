# Developer Agent Workbench (Next.js + LangGraph + Gemini)

This project is a starting point for a **developer agent** that takes a Jira/GitLab ticket and runs a ticket-to-PR workflow with human approval gates.

## What it does

1. Reads a Jira task or GitLab issue by ID.
2. Scans the repository to understand structure and language mix.
3. Creates/switches to a `codex/<task>` branch (unless in dry-run mode).
4. Uses Gemini + LangGraph reasoning to produce a concrete implementation proposal.
5. Shows proposal to human reviewer (HITL).
6. On approval, generates file edits, applies changes, and optionally commits/pushes/creates GitLab MR.
7. Stores reviewer feedback to improve future runs.

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

Approval endpoint then runs finalize stage:
- generate concrete file edits
- apply edits to repo
- produce diff preview
- optionally commit/push/open GitLab merge request

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

## Reinforcement from human feedback

Feedback is persisted in `.agent-memory/feedback-history.json` and reused in planning prompts to reduce repeated mistakes and improve alignment.

## Important notes

- This is a foundation implementation, not a full autonomous software engineer.
- Keep `dryRun=true` until governance and safety checks are complete.
- For multi-agent/A2A evolution, keep this agent as the "Developer Executor" role and add Planner/Reviewer agents as separate orchestrated graphs.
