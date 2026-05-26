import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

dotenv.config();

const CONFIG_DIR = join(homedir(), '.mycli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface Config {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  models: string[];
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
}

function parseModels(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueModels(models: string[]): string[] {
  return Array.from(new Set(models.filter(Boolean)));
}

const DEFAULT_MODEL = process.env.MODEL || 'gpt-4o';

const DEFAULT_CONFIG: Config = {
  apiKey: process.env.API_KEY || '',
  apiBaseUrl: process.env.API_BASE_URL || 'https://api.openai.com/v1',
  model: DEFAULT_MODEL,
  models: uniqueModels([...parseModels(process.env.MODELS), DEFAULT_MODEL]),
  maxTokens: parseInt(process.env.MAX_TOKENS || '4096'),
  temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
  systemPrompt: `You are a powerful AI coding assistant, similar to Claude Code. You help users with:
- Writing, reviewing, and debugging code
- Explaining technical concepts
- File system operations and project management
- Shell command suggestions
- Architecture and design decisions

Be concise, helpful, and provide code examples when appropriate. Use markdown formatting.`,
};

let currentConfig: Config = { ...DEFAULT_CONFIG };

function normalizeConfig(config: Config): Config {
  return {
    ...config,
    models: uniqueModels([...(config.models || []), config.model]),
  };
}

export function loadConfig(): Config {
  if (existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      currentConfig = normalizeConfig({ ...DEFAULT_CONFIG, ...saved });
    } catch {
      currentConfig = normalizeConfig({ ...DEFAULT_CONFIG });
    }
  } else {
    currentConfig = normalizeConfig({ ...DEFAULT_CONFIG });
  }
  return currentConfig;
}

export function saveConfig(config: Partial<Config>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  currentConfig = { ...currentConfig, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
}

export function getConfig(): Config {
  return currentConfig;
}

export function setModel(model: string): void {
  currentConfig.model = model;
  currentConfig.models = uniqueModels([model, ...currentConfig.models]);
}

export function setModels(models: string[]): void {
  currentConfig.models = uniqueModels([...models, currentConfig.model]);
}

export function getModelCandidates(): string[] {
  return uniqueModels([...currentConfig.models, currentConfig.model]);
}
