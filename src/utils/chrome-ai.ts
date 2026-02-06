/**
 * Chrome Built-in AI Wrapper (Tier 3)
 *
 * Wraps Chrome Prompt API + Summarizer API with feature detection
 * and lazy session creation. Runs in background script context.
 */

// Chrome AI type declarations (experimental APIs)
declare global {
  interface Window {
    ai?: {
      summarizer?: {
        capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
        create(options?: {
          type?: string;
          format?: string;
          length?: string;
        }): Promise<AISummarizer>;
      };
      languageModel?: {
        capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
        create(options?: { systemPrompt?: string }): Promise<AILanguageModel>;
      };
    };
  }

  interface AISummarizer {
    summarize(text: string): Promise<string>;
    destroy(): void;
  }

  interface AILanguageModel {
    prompt(text: string): Promise<string>;
    destroy(): void;
  }
}

let summarizerSession: AISummarizer | null = null;
let promptSession: AILanguageModel | null = null;

/**
 * Check if Chrome AI APIs are available.
 */
export async function checkAIAvailable(): Promise<{
  summarizer: boolean;
  prompt: boolean;
}> {
  const result = { summarizer: false, prompt: false };

  try {
    if (self.ai?.summarizer) {
      const caps = await self.ai.summarizer.capabilities();
      result.summarizer = caps.available === 'readily';
    }
  } catch {
    // Not available
  }

  try {
    if (self.ai?.languageModel) {
      const caps = await self.ai.languageModel.capabilities();
      result.prompt = caps.available === 'readily';
    }
  } catch {
    // Not available
  }

  return result;
}

/**
 * Summarize text using Chrome's built-in Summarizer API.
 */
export async function summarizeText(text: string): Promise<string> {
  if (!self.ai?.summarizer) {
    throw new Error('Summarizer API not available');
  }

  if (!summarizerSession) {
    summarizerSession = await self.ai.summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'medium',
    });
  }

  return summarizerSession.summarize(text);
}

/**
 * Simplify text using Chrome's built-in Prompt API.
 */
export async function simplifyText(text: string): Promise<string> {
  if (!self.ai?.languageModel) {
    throw new Error('Prompt API not available');
  }

  if (!promptSession) {
    promptSession = await self.ai.languageModel.create({
      systemPrompt:
        'You are a text simplification assistant. Rewrite the given text in plain, simple language that is easy to understand for elderly users. Keep the meaning intact but use shorter sentences and common words. Respond only with the simplified text.',
    });
  }

  return promptSession.prompt(text);
}

/**
 * Destroy all AI sessions to free resources.
 */
export function destroySessions(): void {
  if (summarizerSession) {
    summarizerSession.destroy();
    summarizerSession = null;
  }
  if (promptSession) {
    promptSession.destroy();
    promptSession = null;
  }
}
