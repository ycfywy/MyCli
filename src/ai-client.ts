import { getConfig } from './config.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export class AIClient {
  private conversationHistory: Message[] = [];
  private modelCache: string[] | null = null;

  constructor() {
    this.resetConversation();
  }

  resetConversation(): void {
    const config = getConfig();
    this.conversationHistory = [
      { role: 'system', content: config.systemPrompt },
    ];
  }

  getHistory(): Message[] {
    return this.conversationHistory;
  }

  setSystemPrompt(prompt: string): void {
    if (this.conversationHistory[0]?.role === 'system') {
      this.conversationHistory[0].content = prompt;
      return;
    }
    this.conversationHistory.unshift({ role: 'system', content: prompt });
  }

  addMessage(message: Message): void {
    this.conversationHistory.push(message);
  }

  async listModels(): Promise<string[]> {
    const config = getConfig();
    const fallback = Array.from(new Set([config.model, ...config.models].filter(Boolean)));

    if (this.modelCache) {
      return Array.from(new Set([config.model, ...this.modelCache].filter(Boolean)));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${config.apiBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) return fallback;

      const payload: any = await response.json();
      const rawModels = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.models)
          ? payload.models
          : [];

      const models = rawModels
        .map((item: any) => (typeof item === 'string' ? item : item?.id || item?.name || item?.model))
        .filter((item: unknown): item is string => typeof item === 'string' && item.length > 0)
        .sort();

      this.modelCache = models;
      return models.length > 0 ? Array.from(new Set([config.model, ...models])) : fallback;
    } catch {
      return fallback;
    }
  }

  async *streamChat(userMessage: string | ContentPart[]): AsyncGenerator<StreamChunk> {
    const config = getConfig();

    const userMsg: Message = {
      role: 'user',
      content: userMessage,
    };
    this.conversationHistory.push(userMsg);

    const body = {
      model: config.model,
      messages: this.conversationHistory,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      stream: true,
    };

    const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') {
            yield { content: '', done: true };
          }
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              yield { content: delta, done: false };
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    }

    this.conversationHistory.push({
      role: 'assistant',
      content: fullContent,
    });
  }

  async chat(userMessage: string | ContentPart[]): Promise<string> {
    let result = '';
    for await (const chunk of this.streamChat(userMessage)) {
      if (!chunk.done) {
        result += chunk.content;
      }
    }
    return result;
  }
}
