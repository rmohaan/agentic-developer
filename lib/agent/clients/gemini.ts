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
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    const repaired = repairInvalidStringEscapes(jsonText);
    return JSON.parse(repaired) as T;
  }
}

function repairInvalidStringEscapes(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (!inString) {
      output += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\"") {
      output += char;
      inString = false;
      continue;
    }

    if (char === "\\") {
      const next = input[index + 1] ?? "";
      const isSimpleEscape = "\"\\/bfnrt".includes(next);
      const isUnicodeEscape = next === "u" && /^[0-9a-fA-F]{4}$/.test(input.slice(index + 2, index + 6));

      if (isSimpleEscape || isUnicodeEscape) {
        output += "\\";
        escaped = true;
      } else {
        // Keep the literal backslash by escaping it.
        output += "\\\\";
      }
      continue;
    }

    output += char;
  }

  return output;
}
