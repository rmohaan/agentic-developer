export const agentConfig = {
  modelPlanner: process.env.GEMINI_MODEL_PLANNER ?? "gemini-3-pro-preview",
  modelFast: process.env.GEMINI_MODEL_FAST ?? "gemini-2.5-flash",
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT,
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION ?? "asia-south1",
  jiraBaseUrl: process.env.JIRA_BASE_URL,
  jiraEmail: process.env.JIRA_EMAIL,
  jiraApiToken: process.env.JIRA_API_TOKEN,
  gitlabBaseUrl: process.env.GITLAB_BASE_URL,
  gitlabToken: process.env.GITLAB_TOKEN,
  gitlabProjectId: process.env.GITLAB_PROJECT_ID,
};

export function requireRepoPath(repoPath: string): string {
  if (!repoPath || repoPath.trim().length === 0) {
    throw new Error("repoPath is required");
  }
  return repoPath;
}
