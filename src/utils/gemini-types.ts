/**
 * Shared types for Gemini API responses
 */

export interface GeminiCandidatePart {
  text?: string;
}

export interface GeminiCandidateContent {
  parts?: GeminiCandidatePart[];
}

export interface GeminiCandidate {
  content?: GeminiCandidateContent;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

/**
 * Extract text from a Gemini response
 */
export function extractGeminiText(data: GeminiResponse): string | null {
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

/**
 * Safely parse JSON from a Gemini response that may be wrapped in markdown
 */
export function parseGeminiJson<T>(text: string): T {
  // Extract JSON from the response (in case model wraps in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  
  try {
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    throw new Error(`Failed to parse Gemini JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
