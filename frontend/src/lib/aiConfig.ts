export type AIProvider = 'openai' | 'gemini' | 'claude' | 'ollama';

export type AIConfig = {
  provider: AIProvider;
  openaiKey: string;
  geminiKey: string;
  claudeKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
};

const STORAGE_KEY = 'ai_config';

const defaultConfig: AIConfig = {
  provider: 'openai',
  openaiKey: '',
  geminiKey: '',
  claudeKey: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'gemma4',
};

export function saveAIConfig(config: AIConfig): void {
  console.debug('[AI Config] Saving AI configuration:', {
    provider: config.provider,
    hasOpenAIKey: !!config.openaiKey,
    hasGeminiKey: !!config.geminiKey,
    hasClaudeKey: !!config.claudeKey,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  console.debug('[AI Config] AI configuration saved successfully');
}

export function loadAIConfig(): AIConfig {
  try {
    console.debug("[AI Config] Loading AI's configuration from localStorage");
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.debug("[AI Config] No saved configuration found, using defaults");
      return { ...defaultConfig };
    }
    const parsed = JSON.parse(raw) as Partial<AIConfig>;
    const config = {
      provider: parsed.provider ?? defaultConfig.provider,
      openaiKey: parsed.openaiKey ?? '',
      geminiKey: parsed.geminiKey ?? '',
      claudeKey: parsed.claudeKey ?? '',
      ollamaBaseUrl: parsed.ollamaBaseUrl ?? defaultConfig.ollamaBaseUrl,
      ollamaModel: parsed.ollamaModel ?? defaultConfig.ollamaModel,
    };
    console.debug('[AI Config] Configuration loaded:', {
      provider: config.provider,
      hasOpenAIKey: !!config.openaiKey,
      hasGeminiKey: !!config.geminiKey,
      hasClaudeKey: !!config.claudeKey,
    });
    return config;
  } catch (error) {
    console.error('[AI Config] Error loading configuration, using defaults:', error);
    return { ...defaultConfig };
  }
}

export function getActiveAIKey(): {
  provider: AIProvider;
  apiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
} {
  const config = loadAIConfig();

  const keyMap: Record<AIProvider, string> = {
    openai: config.openaiKey,
    gemini: config.geminiKey,
    claude: config.claudeKey,
    ollama: '',
  };

  const result = {
    provider: config.provider,
    apiKey: keyMap[config.provider],
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
  };

  console.debug("[AI Config] Getting the active AI provider:", {
    provider: result.provider,
    hasApiKey: !!result.apiKey,
    ollamaModel: result.ollamaModel,
  });

  return result;
}
