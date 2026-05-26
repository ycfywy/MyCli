#!/usr/bin/env node

import { loadConfig, getConfig } from './config.js';
import { Agent } from './agent.js';
import { renderWelcome, renderError, renderInfo } from './renderer.js';
import chalk from 'chalk';

async function main(): Promise<void> {
  // 加载配置
  loadConfig();
  const config = getConfig();

  // 检查 API Key
  if (!config.apiKey) {
    renderError('未设置 API_KEY');
    console.log(chalk.yellow('请执行以下步骤:'));
    console.log(chalk.dim('  1. 复制 .env.example 为 .env'));
    console.log(chalk.dim('  2. 填写你的 API_KEY'));
    console.log(chalk.dim('  或设置环境变量: export API_KEY=your-key'));
    process.exit(1);
  }

  // 显示欢迎界面
  renderWelcome();
  renderInfo(`模型: ${chalk.bold(config.model)} | API: ${config.apiBaseUrl}`);

  // 启动 Agent
  const agent = new Agent();

  // 处理 Ctrl+C
  process.on('SIGINT', () => {
    console.log(chalk.cyan('\n\n👋 再见!\n'));
    process.exit(0);
  });

  // 运行主循环
  await agent.run();
}

main().catch((error) => {
  renderError(`启动失败: ${error.message}`);
  process.exit(1);
});
