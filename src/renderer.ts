import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

const marked = new Marked();
marked.use(markedTerminal() as any);

export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}

export function renderStreamStart(): void {
  process.stdout.write(chalk.green('\n🤖 '));
}

export function renderStreamChunk(chunk: string): void {
  process.stdout.write(chunk);
}

export function renderStreamEnd(): void {
  process.stdout.write('\n\n');
}

export function renderError(error: string): void {
  console.error(chalk.red(`\n❌ 错误: ${error}\n`));
}

export function renderInfo(info: string): void {
  console.log(chalk.cyan(`\nℹ️  ${info}\n`));
}

export function renderWelcome(): void {
  const banner = `
${chalk.bold.cyan('╔══════════════════════════════════════════╗')}
${chalk.bold.cyan('║')}   ${chalk.bold.white('🚀 MyCLI - AI Coding Assistant')}       ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╠══════════════════════════════════════════╣')}
${chalk.bold.cyan('║')}  ${chalk.dim('输入文字开始对话')}                       ${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}  ${chalk.dim('输入 /help 查看命令')}                    ${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}  ${chalk.dim('支持粘贴文本/图片URL')}                   ${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}  ${chalk.dim('Ctrl+C 或 /exit 退出')}                  ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╚══════════════════════════════════════════╝')}
`;
  console.log(banner);
}

export function renderPrompt(): void {
  process.stdout.write(chalk.blue.bold('\n❯ '));
}
