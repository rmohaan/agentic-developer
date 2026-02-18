import { GoogleGenAI } from "@google/genai";
import { jsonrepair } from "jsonrepair";
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
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return result.text ?? "";
}

export function parseJsonObject<T>(raw: string): T {
  const normalized = stripCodeFences(raw).trim();
  const jsonText = extractBalancedJsonValue(normalized);
  if (!jsonText) {
    throw new Error(`Model response did not contain JSON object. Preview: ${normalized.slice(0, 240)}`);
  }

  const parsed = parseJsonLenient(jsonText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as T;
  }

  if (Array.isArray(parsed)) {
    const firstObject = parsed.find((item) => item && typeof item === "object" && !Array.isArray(item));
    if (firstObject) {
      return firstObject as T;
    }
  }

  throw new Error(`Model response JSON was not an object. Preview: ${jsonText.slice(0, 240)}`);
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

function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function parseJsonLenient(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      const repaired = repairInvalidStringEscapes(jsonText);
      return JSON.parse(repaired);
    } catch {
      try {
        const repaired = sanitizeControlCharsInStrings(repairInvalidStringEscapes(jsonText));
        return JSON.parse(repaired);
      } catch {
        const repaired = jsonrepair(jsonText);
        return JSON.parse(repaired);
      }
    }
  }
}

function extractBalancedJsonValue(raw: string): string | null {
  const braceStart = raw.indexOf("{");
  const bracketStart = raw.indexOf("[");

  let start = -1;
  let openChar = "{";
  let closeChar = "}";

  if (braceStart >= 0 && bracketStart >= 0) {
    if (braceStart < bracketStart) {
      start = braceStart;
      openChar = "{";
      closeChar = "}";
    } else {
      start = bracketStart;
      openChar = "[";
      closeChar = "]";
    }
  } else if (braceStart >= 0) {
    start = braceStart;
    openChar = "{";
    closeChar = "}";
  } else if (bracketStart >= 0) {
    start = bracketStart;
    openChar = "[";
    closeChar = "]";
  }

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

function sanitizeControlCharsInStrings(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const code = char.charCodeAt(0);

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

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      output += char;
      inString = false;
      continue;
    }

    // JSON does not allow raw control chars (U+0000 to U+001F) in string literals.
    if (code >= 0x00 && code <= 0x1f) {
      output += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }

    output += char;
  }

  return output;
}
