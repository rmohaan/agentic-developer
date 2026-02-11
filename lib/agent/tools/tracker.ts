import { agentConfig } from "../config";
import type { TrackerTask, TrackerType } from "../types";

function basicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

export async function fetchTask(tracker: TrackerType, taskId: string): Promise<TrackerTask> {
  if (tracker === "jira") {
    return fetchJiraTask(taskId);
  }

  return fetchGitLabIssue(taskId);
}

async function fetchJiraTask(taskId: string): Promise<TrackerTask> {
  const { jiraBaseUrl, jiraEmail, jiraApiToken } = agentConfig;
  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    throw new Error("Missing Jira configuration (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)");
  }

  const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${encodeURIComponent(taskId)}`, {
    headers: {
      Authorization: basicAuthHeader(jiraEmail, jiraApiToken),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load Jira issue ${taskId}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const fields = data.fields ?? {};

  return {
    id: data.key,
    title: fields.summary ?? "",
    description: extractText(fields.description),
    acceptanceCriteria: [],
    labels: fields.labels ?? [],
    priority: fields.priority?.name,
    url: `${jiraBaseUrl}/browse/${data.key}`,
  };
}

async function fetchGitLabIssue(taskId: string): Promise<TrackerTask> {
  const { gitlabBaseUrl, gitlabToken, gitlabProjectId } = agentConfig;
  if (!gitlabBaseUrl || !gitlabToken || !gitlabProjectId) {
    throw new Error("Missing GitLab configuration (GITLAB_BASE_URL, GITLAB_TOKEN, GITLAB_PROJECT_ID)");
  }

  const response = await fetch(
    `${gitlabBaseUrl}/api/v4/projects/${encodeURIComponent(gitlabProjectId)}/issues/${encodeURIComponent(taskId)}`,
    {
      headers: {
        "PRIVATE-TOKEN": gitlabToken,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load GitLab issue ${taskId}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: String(data.iid),
    title: data.title ?? "",
    description: data.description ?? "",
    acceptanceCriteria: [],
    labels: data.labels ?? [],
    priority: data.severity,
    url: data.web_url,
  };
}

function extractText(adf: unknown): string {
  if (!adf || typeof adf !== "object") {
    return "";
  }

  const queue: unknown[] = [adf];
  const chunks: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    const node = current as { text?: unknown; content?: unknown };
    if (typeof node.text === "string") {
      chunks.push(node.text);
    }

    if (Array.isArray(node.content)) {
      queue.push(...node.content);
    }
  }

  return chunks.join(" ");
}
