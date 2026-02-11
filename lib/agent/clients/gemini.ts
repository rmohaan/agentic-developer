import { GoogleGenAI } from "@google/genai";
import { agentConfig } from "../config";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project: agentConfig.googleCloudProject,
    location: agentConfig.googleCloudLocation,
  });

  return cachedClient;
}

export async function generateText(prompt: string, useFastModel = false): Promise<string> {
  const model = useFastModel ? agentConfig.modelFast : agentConfig.modelPlanner;
  const ai = getClient();
  const result = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  return result.text ?? "";
}

export function parseJsonObject<T>(raw: string): T {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Model response did not contain JSON object");
  }

  const jsonText = raw.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonText) as T;
}
