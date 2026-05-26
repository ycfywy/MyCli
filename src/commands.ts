import chalk from 'chalk';
import { getConfig, getModelCandidates, setModel } from './config.js';
import { AIClient } from './ai-client.js';

export interface CommandResult {
  handled: boolean;
  exit?: boolean;
  message?: string;
}

const COMMANDS: Record<string, string> = {
  '/help': '显示帮助信息',
  '/model': '切换模型 (用法: /model <model-name>)',
  '/new': '开始新对话 (清除历史)',
  '/history': '显示对话历史',
  '/config': '显示当前配置',
  '/clear': '清屏',
  '/exit': '退出程序',
  '/copy': '复制上一条回复到剪贴板',
  '/paste': '从剪贴板粘贴内容作为输入',
  '/image': '发送图片 (用法: /image <url-or-base64>)',
  '/system': '设置系统提示词 (用法: /system <prompt>)',
  '/tokens': '显示 token 使用情况估算',
};

export function handleCommand(input: string, client: AIClient): CommandResult {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (cmd) {
    case '/help':
    case '/h':
    case '/?':
      return showHelp();

    case '/model':
    case '/m':
      return switchModel(args);

    case '/new':
    case '/n':
      return newConversation(client);

    case '/history':
      return showHistory(client);

    case '/config':
      return showConfig();

    case '/clear':
    case '/cls':
      console.clear();
      return { handled: true };

    case '/exit':
    case '/quit':
    case '/q':
      return { handled: true, exit: true };

    case '/system':
      return setSystemPrompt(args, client);

    case '/tokens':
      return estimateTokens(client);

    default:
      if (trimmed.startsWith('/')) {
        return {
          handled: true,
          message: chalk.yellow(`未知命令: ${cmd}\n输入 /help 查看可用命令`),
        };
      }
      return { handled: false };
  }
}

function showHelp(): CommandResult {
  let helpText = chalk.bold.cyan('\n📋 可用命令:\n\n');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    helpText += `  ${chalk.green(cmd.padEnd(12))} ${desc}\n`;
  }
  helpText += '\n' + chalk.dim('提示: 直接输入文字即可与 AI 对话，支持多行输入 (Shift+Enter)');
  helpText += '\n' + chalk.dim('      支持粘贴文本和图片 URL');
  return { handled: true, message: helpText };
}

function switchModel(modelName: string): CommandResult {
  if (!modelName) {
    const config = getConfig();
    let msg = chalk.cyan(`\n当前模型: ${chalk.bold(config.model)}\n`);
    msg += chalk.bold('\n可用模型列表:\n\n');
    for (const m of getModelCandidates()) {
      const isCurrent = m === config.model;
      const prefix = isCurrent ? chalk.green('  ● ') : chalk.dim('  ○ ');
      const label = isCurrent ? chalk.green.bold(m) : chalk.white(m);
      msg += `${prefix}${label}\n`;
    }
    msg += chalk.dim('\n用法: /model <model-name>');
    msg += chalk.dim('\n提示: 也可输入上述列表中没有的自定义模型名\n');
    return { handled: true, message: msg };
  }
  setModel(modelName);
  return {
    handled: true,
    message: chalk.green(`✓ 已切换到模型: ${chalk.bold(modelName)}`),
  };
}

function newConversation(client: AIClient): CommandResult {
  client.resetConversation();
  return {
    handled: true,
    message: chalk.green('✓ 已开始新对话'),
  };
}

function showHistory(client: AIClient): CommandResult {
  const history = client.getHistory();
  let output = chalk.bold.cyan('\n📜 对话历史:\n\n');
  for (const msg of history) {
    if (msg.role === 'system') continue;
    const roleColor = msg.role === 'user' ? chalk.blue : chalk.green;
    const roleLabel = msg.role === 'user' ? '👤 You' : '🤖 AI';
    const content = typeof msg.content === 'string' ? msg.content : '[多模态内容]';
    const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
    output += `${roleColor(roleLabel)}: ${preview}\n\n`;
  }
  return { handled: true, message: output };
}

function showConfig(): CommandResult {
  const config = getConfig();
  let output = chalk.bold.cyan('\n⚙️  当前配置:\n\n');
  output += `  ${chalk.dim('API Base URL:')} ${config.apiBaseUrl}\n`;
  output += `  ${chalk.dim('Model:')}        ${chalk.bold(config.model)}\n`;
  output += `  ${chalk.dim('Max Tokens:')}   ${config.maxTokens}\n`;
  output += `  ${chalk.dim('Temperature:')}  ${config.temperature}\n`;
  output += `  ${chalk.dim('API Key:')}      ${config.apiKey ? '***' + config.apiKey.slice(-4) : chalk.red('未设置')}\n`;
  return { handled: true, message: output };
}

function setSystemPrompt(prompt: string, client: AIClient): CommandResult {
  if (!prompt) {
    return {
      handled: true,
      message: chalk.yellow('用法: /system <prompt>'),
    };
  }
  const history = client.getHistory();
  if (history.length > 0 && history[0].role === 'system') {
    history[0].content = prompt;
  }
  return {
    handled: true,
    message: chalk.green('✓ 系统提示词已更新'),
  };
}

function estimateTokens(client: AIClient): CommandResult {
  const history = client.getHistory();
  let totalChars = 0;
  for (const msg of history) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    totalChars += content.length;
  }
  const estimatedTokens = Math.ceil(totalChars / 4);
  return {
    handled: true,
    message: chalk.cyan(`📊 估算 Token 用量: ~${estimatedTokens} tokens (${history.length} 条消息)`),
  };
}
