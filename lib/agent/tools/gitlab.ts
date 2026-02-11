import { agentConfig } from "../config";

export async function createMergeRequest(params: {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
}): Promise<string | undefined> {
  const { gitlabBaseUrl, gitlabToken, gitlabProjectId } = agentConfig;
  if (!gitlabBaseUrl || !gitlabToken || !gitlabProjectId) {
    return undefined;
  }

  const response = await fetch(`${gitlabBaseUrl}/api/v4/projects/${encodeURIComponent(gitlabProjectId)}/merge_requests`, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": gitlabToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      source_branch: params.sourceBranch,
      target_branch: params.targetBranch,
      title: params.title,
      description: params.description,
      remove_source_branch: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed creating merge request: ${response.status} ${response.statusText} ${body}`);
  }

  const data = await response.json();
  return data.web_url as string | undefined;
}
