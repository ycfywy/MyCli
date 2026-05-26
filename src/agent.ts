import { AIClient, ContentPart } from './ai-client.js';
import { handleCommand } from './commands.js';
import { getConfig, setModel, setModels } from './config.js';
import { InputHandler } from './input-handler.js';
import { LoadedSkill, SkillManager } from './skills.js';
import {
  renderStreamStart,
  renderStreamChunk,
  renderStreamEnd,
  renderError,
  renderMarkdown,
} from './renderer.js';
import chalk from 'chalk';
import ora from 'ora';

export class Agent {
  private client: AIClient;
  private inputHandler: InputHandler;
  private skillManager: SkillManager;
  private loadedSkills = new Map<string, LoadedSkill>();
  private isProcessing: boolean = false;

  constructor() {
    this.client = new AIClient();
    this.inputHandler = new InputHandler();
    this.skillManager = new SkillManager();
  }

  async processInput(input: string): Promise<boolean> {
    const trimmed = input.trim();
    if (!trimmed) return false;

    if (trimmed === '/skills' || trimmed.startsWith('/skill')) {
      await this.handleSkillCommand(trimmed);
      return false;
    }

    // /model 无参数时进入可上下选择的模型列表
    if (trimmed === '/model' || trimmed === '/m') {
      const models = await this.client.listModels();
      setModels(models);
      const selected = await this.inputHandler.selectFromList(
        `当前模型: ${getConfig().model}`,
        models,
        getConfig().model,
        '模型',
      );
      if (selected) {
        setModel(selected);
        console.log(chalk.green(`✓ 已切换到模型: ${chalk.bold(selected)}`));
      } else {
        console.log(chalk.dim('已取消模型切换'));
      }
      return false;
    }

    // 处理命令
    const cmdResult = handleCommand(trimmed, this.client);
    if (cmdResult.handled) {
      if (trimmed === '/new' || trimmed === '/n') {
        this.refreshSystemPrompt();
      }
      if (cmdResult.message) {
        console.log(cmdResult.message);
      }
      return cmdResult.exit || false;
    }

    // 解析图片内容
    const content = this.inputHandler.parseImageContent(trimmed);

    // 发送给 AI
    await this.sendToAI(content);
    return false;
  }

  private async handleSkillCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const command = parts[0];
    const action = parts[1];
    const name = parts.slice(2).join(' ');

    if (command === '/skills' || action === 'list') {
      this.showSkills();
      return;
    }

    if (!action) {
      await this.pickAndLoadSkill();
      return;
    }

    if (action === 'current') {
      this.showLoadedSkills();
      return;
    }

    if (action === 'clear') {
      this.loadedSkills.clear();
      this.refreshSystemPrompt();
      console.log(chalk.green('✓ 已清空所有 Skills'));
      return;
    }

    if (action === 'unload' || action === 'remove') {
      if (!name) {
        console.log(chalk.yellow('用法: /skill unload <name>'));
        return;
      }
      this.unloadSkill(name);
      return;
    }

    if (action === 'load') {
      if (!name) {
        console.log(chalk.yellow('用法: /skill load <name>'));
        return;
      }
      this.loadSkill(name);
      return;
    }

    this.loadSkill(parts.slice(1).join(' '));
  }

  private async pickAndLoadSkill(): Promise<void> {
    const available = this.skillManager.listSkills();
    if (available.length === 0) {
      console.log(chalk.yellow('没有找到 Skill。请在 ./skills 或 ~/.mycli/skills 下放置 .md/.txt Skill 文件。'));
      return;
    }

    const selected = await this.inputHandler.selectFromList(
      '选择要加载的 Skill',
      available.map((skill) => skill.name),
      Array.from(this.loadedSkills.keys())[0],
      'Skill',
    );

    if (selected) {
      this.loadSkill(selected);
    }
  }

  private loadSkill(nameOrPath: string): void {
    try {
      const skill = this.skillManager.loadSkill(nameOrPath);
      this.loadedSkills.set(skill.name, skill);
      this.refreshSystemPrompt();
      console.log(chalk.green(`✓ 已加载 Skill: ${chalk.bold(skill.name)}`));
      if (skill.description) {
        console.log(chalk.dim(`  ${skill.description}`));
      }
    } catch (error: any) {
      console.log(chalk.red(error.message || '加载 Skill 失败'));
    }
  }

  private unloadSkill(name: string): void {
    const match = Array.from(this.loadedSkills.keys()).find((item) => item.toLowerCase() === name.toLowerCase());
    if (!match) {
      console.log(chalk.yellow(`未加载 Skill: ${name}`));
      return;
    }

    this.loadedSkills.delete(match);
    this.refreshSystemPrompt();
    console.log(chalk.green(`✓ 已卸载 Skill: ${chalk.bold(match)}`));
  }

  private showSkills(): void {
    const available = this.skillManager.listSkills();
    if (available.length === 0) {
      console.log(chalk.yellow('没有找到 Skill。请在 ./skills 或 ~/.mycli/skills 下放置 .md/.txt Skill 文件。'));
      return;
    }

    console.log(chalk.bold.cyan('\n可用 Skills:\n'));
    for (const skill of available) {
      const loaded = this.loadedSkills.has(skill.name);
      const marker = loaded ? chalk.green('●') : chalk.dim('○');
      const desc = skill.description ? chalk.dim(` - ${skill.description}`) : '';
      console.log(`  ${marker} ${chalk.bold(skill.name)}${desc}`);
    }
    console.log(chalk.dim('\n用法: /skill <name> | /skill unload <name> | /skill clear'));
  }

  private showLoadedSkills(): void {
    const loaded = Array.from(this.loadedSkills.values());
    if (loaded.length === 0) {
      console.log(chalk.dim('当前没有加载 Skill'));
      return;
    }

    console.log(chalk.bold.cyan('\n已加载 Skills:\n'));
    for (const skill of loaded) {
      const desc = skill.description ? chalk.dim(` - ${skill.description}`) : '';
      console.log(`  ${chalk.green('●')} ${chalk.bold(skill.name)}${desc}`);
    }
  }

  private refreshSystemPrompt(): void {
    const prompt = this.skillManager.buildSystemPrompt(getConfig().systemPrompt, Array.from(this.loadedSkills.values()));
    this.client.setSystemPrompt(prompt);
  }

  private async sendToAI(content: string | ContentPart[]): Promise<void> {
    this.isProcessing = true;
    const spinner = ora({
      text: chalk.dim('思考中...'),
      spinner: 'dots',
    }).start();

    try {
      let firstChunk = true;
      let fullResponse = '';

      for await (const chunk of this.client.streamChat(content)) {
        if (chunk.done) break;

        if (firstChunk) {
          firstChunk = false;
          spinner.stop();
          renderStreamStart();
        }

        fullResponse += chunk.content;
        renderStreamChunk(chunk.content);
      }

      if (firstChunk) {
        // 没有收到任何 chunk
        spinner.stop();
        renderError('未收到 AI 响应');
      } else {
        renderStreamEnd();
      }
    } catch (error: any) {
      spinner.stop();
      renderError(error.message || '请求失败');
    } finally {
      this.isProcessing = false;
    }
  }

  async run(): Promise<void> {
    while (true) {
      try {
        const input = await this.inputHandler.getInput();
        const shouldExit = await this.processInput(input);
        if (shouldExit) {
          console.log(chalk.cyan('\n👋 再见!\n'));
          break;
        }
      } catch (error: any) {
        // 只有 readline 彻底关闭才退出
        if (error.message === 'readline closed') {
          console.log(chalk.cyan('\n👋 再见!\n'));
          break;
        }
        renderError(error.message || '发生错误');
        // 继续循环，不退出
      }
    }
    this.inputHandler.close();
  }

  getClient(): AIClient {
    return this.client;
  }
}
