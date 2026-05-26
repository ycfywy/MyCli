import * as readline from 'readline';
import chalk from 'chalk';
import { ContentPart } from './ai-client.js';
import { FileSuggestion, getFileSuggestions, parseReferencesToContent } from './file-references.js';

const ALL_COMMANDS = [
  '/help', '/model', '/skills', '/skill', '/new', '/history', '/config',
  '/clear', '/exit', '/quit', '/system', '/tokens',
];

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  '/help': '显示帮助',
  '/model': '切换模型',
  '/skills': '查看 Skills',
  '/skill': '加载/卸载 Skill',
  '/new': '新对话',
  '/history': '对话历史',
  '/config': '当前配置',
  '/clear': '清屏',
  '/exit': '退出',
  '/quit': '退出',
  '/system': '设置系统提示词',
  '/tokens': 'Token 用量估算',
};

export class InputHandler {
  async getInput(): Promise<string> {
    const firstLine = await this.readLine(chalk.blue.bold('❯ '));

    if (firstLine.trim() !== '"""') {
      return firstLine;
    }

    const lines: string[] = [];
    console.log(chalk.dim('进入多行模式，输入 """ 结束'));

    while (true) {
      const line = await this.readLine(chalk.dim('... '));
      if (line.trim() === '"""') {
        return lines.join('\n');
      }
      lines.push(line);
    }
  }

  private readLine(promptText: string): Promise<string> {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      return this.readLineFallback(promptText);
    }

    return new Promise((resolve) => {
      let line = '';
      let lastHintLines = 0;
      let completionPrefix: string | null = null;
      let selectedCommandIndex = -1;
      let referencePrefix: string | null = null;
      let selectedReferenceIndex = -1;
      const stdin = process.stdin;
      const stdout = process.stdout;
      const previousRawMode = stdin.isRaw;

      const displayLine = () => line.replace(/\n/g, '↵ ');
      const cursorColumn = () => 2 + Array.from(displayLine()).length;
      const activePrefix = () => completionPrefix ?? line;
      const commandMatches = () => {
        const prefix = activePrefix();
        if (!prefix.startsWith('/') || prefix.includes(' ')) return [];
        return ALL_COMMANDS.filter((cmd) => cmd.startsWith(prefix.toLowerCase())).slice(0, 8);
      };
      const activeReference = () => this.getActiveReference(line);
      const activeReferenceQuery = () => referencePrefix ?? activeReference()?.query ?? '';
      const referenceMatches = () => getFileSuggestions(activeReferenceQuery());
      const resetCommandCompletion = () => {
        completionPrefix = null;
        selectedCommandIndex = -1;
      };
      const resetReferenceCompletion = () => {
        referencePrefix = null;
        selectedReferenceIndex = -1;
      };
      const resetCompletion = () => {
        resetCommandCompletion();
        resetReferenceCompletion();
      };

      const clearHints = () => {
        if (lastHintLines <= 0) return;
        stdout.write('\x1B[s');
        for (let i = 0; i < lastHintLines; i++) {
          stdout.write('\x1B[1B\r\x1B[2K');
        }
        stdout.write('\x1B[u');
        lastHintLines = 0;
      };

      const render = () => {
        clearHints();
        stdout.write(`\r\x1B[2K${promptText}${displayLine()}`);

        const reference = activeReference();
        const hints = reference
          ? this.getFileReferenceHints(referenceMatches(), selectedReferenceIndex)
          : this.getCommandHints(activePrefix(), selectedCommandIndex);
        if (hints.length > 0) {
          for (const hint of hints) {
            stdout.write(`\n\r\x1B[2K${hint}`);
          }
          stdout.write(`\x1B[${hints.length}A\r\x1B[${cursorColumn()}C`);
          lastHintLines = hints.length;
        }
      };

      const cleanup = () => {
        clearHints();
        stdin.off('data', onData);
        stdin.setRawMode(Boolean(previousRawMode));
        stdin.pause();
      };

      const finish = () => {
        cleanup();
        stdout.write('\n');
        resolve(line);
      };

      const exit = () => {
        cleanup();
        stdout.write('\n');
        resolve('/exit');
      };

      const selectCommand = (direction: 1 | -1) => {
        if (!line.startsWith('/') || line.includes(' ')) return false;
        if (completionPrefix === null) {
          completionPrefix = line;
        }

        const matches = commandMatches();
        if (matches.length === 0) return false;

        if (selectedCommandIndex < 0) {
          selectedCommandIndex = direction === 1 ? 0 : matches.length - 1;
        } else {
          selectedCommandIndex = (selectedCommandIndex + direction + matches.length) % matches.length;
        }

        line = matches[selectedCommandIndex];
        render();
        return true;
      };

      const applyReferenceSuggestion = (suggestion: FileSuggestion, finalizeFile = false) => {
        const ref = activeReference();
        if (!ref) return;
        const suffix = finalizeFile && !suggestion.isDirectory ? ' ' : '';
        line = `${line.slice(0, ref.start)}@${suggestion.value}${suffix}${line.slice(ref.end)}`;
      };

      const acceptReferenceSuggestion = (suggestion: FileSuggestion) => {
        applyReferenceSuggestion(suggestion, !suggestion.isDirectory);
        resetReferenceCompletion();
        render();
      };

      const selectReference = (direction: 1 | -1) => {
        const ref = activeReference();
        if (!ref) return false;
        if (referencePrefix === null) {
          referencePrefix = ref.query;
        }

        const matches = referenceMatches();
        if (matches.length === 0) return false;

        if (selectedReferenceIndex < 0) {
          selectedReferenceIndex = direction === 1 ? 0 : matches.length - 1;
        } else {
          selectedReferenceIndex = (selectedReferenceIndex + direction + matches.length) % matches.length;
        }

        applyReferenceSuggestion(matches[selectedReferenceIndex]);
        render();
        return true;
      };

      const completeReference = () => {
        const ref = activeReference();
        if (!ref) return false;

        // 如果用户已经用 ↑/↓ 选中了候选项，Tab 表示接受当前项：
        // - 文件：完成引用，并追加空格退出 @ 补全
        // - 目录：进入该目录，展示下一级候选
        if (referencePrefix !== null && selectedReferenceIndex >= 0) {
          const selected = referenceMatches()[selectedReferenceIndex];
          if (selected) {
            acceptReferenceSuggestion(selected);
            return true;
          }
        }

        // Tab 始终基于当前输入里的 @ 路径做补全。
        resetReferenceCompletion();
        const matches = getFileSuggestions(ref.query);
        if (matches.length === 0) return false;

        if (matches.length === 1) {
          acceptReferenceSuggestion(matches[0]);
          return true;
        }

        const commonPrefix = this.commonPrefix(matches.map((item) => item.value));
        if (commonPrefix.length > ref.query.length) {
          line = `${line.slice(0, ref.start)}@${commonPrefix}${line.slice(ref.end)}`;
          resetReferenceCompletion();
          render();
          return true;
        }

        // 多个候选且没有公共前缀时，只高亮第一项，不直接插入，避免误引用。
        referencePrefix = ref.query;
        selectedReferenceIndex = 0;
        render();
        return true;
      };

      const completeCommand = () => {
        if (!line.startsWith('/') || line.includes(' ')) return;
        if (completionPrefix === null) {
          completionPrefix = line;
        }

        const matches = commandMatches();
        if (matches.length === 0) return;

        if (matches.length === 1) {
          selectedCommandIndex = 0;
          line = matches[0];
          render();
          return;
        }

        const prefix = this.commonPrefix(matches);
        if (selectedCommandIndex < 0 && prefix.length > line.length) {
          line = prefix;
          completionPrefix = prefix;
          render();
          return;
        }

        selectCommand(1);
      };

      const appendPaste = (chunk: string) => {
        resetCompletion();
        line += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        render();
      };

      const onData = (chunk: Buffer | string) => {
        const input = chunk.toString('utf8');

        if (input === '\u0003' || input === '\u0004') {
          exit();
          return;
        }

        if (input === '\r' || input === '\n') {
          finish();
          return;
        }

        if (input === '\t') {
          if (!completeReference()) {
            completeCommand();
          }
          return;
        }

        if (input === '\x1B[A') {
          if (!selectReference(-1)) {
            selectCommand(-1);
          }
          return;
        }

        if (input === '\x1B[B') {
          if (!selectReference(1)) {
            selectCommand(1);
          }
          return;
        }

        if (input === '\u007F' || input === '\b') {
          resetCompletion();
          line = Array.from(line).slice(0, -1).join('');
          render();
          return;
        }

        if (input.startsWith('\x1B')) {
          return;
        }

        if (input.includes('\r') || input.includes('\n')) {
          appendPaste(input);
          return;
        }

        resetCompletion();
        line += input;
        render();
      };

      stdin.setEncoding('utf8');
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
      render();
    });
  }

  async selectFromList(title: string, items: string[], current?: string, itemLabel = '项目'): Promise<string | undefined> {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      console.log(chalk.bold(title));
      items.forEach((item, index) => {
        const marker = item === current ? ' 当前' : '';
        console.log(`${index + 1}. ${item}${marker}`);
      });
      const answer = await this.readLineFallback(chalk.blue.bold(`选择编号或${itemLabel}名 ❯ `));
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && items[index]) return items[index];
      return answer.trim() || undefined;
    }

    return new Promise((resolve) => {
      const stdin = process.stdin;
      const stdout = process.stdout;
      const previousRawMode = stdin.isRaw;
      let selectedIndex = Math.max(0, items.indexOf(current || ''));
      let scrollOffset = 0;

      const viewportSize = () => Math.max(5, Math.min(items.length, (stdout.rows || 24) - 6));
      const ensureVisible = () => {
        const size = viewportSize();
        if (selectedIndex < scrollOffset) {
          scrollOffset = selectedIndex;
        } else if (selectedIndex >= scrollOffset + size) {
          scrollOffset = selectedIndex - size + 1;
        }
      };

      const move = (direction: 1 | -1) => {
        selectedIndex = (selectedIndex + direction + items.length) % items.length;
        ensureVisible();
        render();
      };

      const render = () => {
        ensureVisible();
        const size = viewportSize();
        const visibleItems = items.slice(scrollOffset, scrollOffset + size);
        const hasTop = scrollOffset > 0;
        const hasBottom = scrollOffset + size < items.length;

        const rows = [
          chalk.bold.cyan(title),
          chalk.dim(`↑/↓ 选择${itemLabel}，Enter 确认，Esc 取消，Tab 下一项`),
          chalk.dim(`${selectedIndex + 1}/${items.length}`),
          hasTop ? chalk.dim('  ↑ 更多') : '',
          ...visibleItems.map((item, visibleIndex) => {
            const index = scrollOffset + visibleIndex;
            const isSelected = index === selectedIndex;
            const isCurrent = item === current;
            const prefix = isSelected ? '›' : ' ';
            const suffix = isCurrent ? chalk.green('  当前') : '';
            const text = `${prefix} ${item}${suffix}`;
            return isSelected ? chalk.cyan.bold(text) : chalk.dim(text);
          }),
          hasBottom ? chalk.dim('  ↓ 更多') : '',
        ].filter(Boolean);

        stdout.write('\x1B[H\x1B[2J');
        stdout.write(rows.join('\n'));
      };

      const cleanup = () => {
        stdout.write('\x1B[?25h\x1B[?1049l');
        stdin.off('data', onData);
        stdin.setRawMode(Boolean(previousRawMode));
        stdin.pause();
      };

      const finish = (value?: string) => {
        cleanup();
        resolve(value);
      };

      const onData = (chunk: Buffer | string) => {
        const input = chunk.toString('utf8');

        if (input === '\u0003' || input === '\x1B') {
          finish(undefined);
          return;
        }

        if (input === '\r' || input === '\n') {
          finish(items[selectedIndex]);
          return;
        }

        if (input === '\x1B[A' || input === 'k') {
          move(-1);
          return;
        }

        if (input === '\x1B[B' || input === '\t' || input === 'j') {
          move(1);
          return;
        }

        if (input === '\x1B[5~') {
          selectedIndex = Math.max(0, selectedIndex - viewportSize());
          ensureVisible();
          render();
          return;
        }

        if (input === '\x1B[6~') {
          selectedIndex = Math.min(items.length - 1, selectedIndex + viewportSize());
          ensureVisible();
          render();
        }
      };

      stdout.write('\x1B[?1049h\x1B[?25l');
      stdin.setEncoding('utf8');
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
      render();
    });
  }

  private readLineFallback(promptText: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  private getCommandHints(input: string, selectedIndex: number): string[] {
    if (!input.startsWith('/') || input.includes(' ')) return [];

    const matches = ALL_COMMANDS.filter((cmd) => cmd.startsWith(input.toLowerCase())).slice(0, 8);
    if (matches.length === 0) {
      return [chalk.dim('  无匹配命令，输入 /help 查看帮助')];
    }

    return matches.map((cmd, index) => {
      const desc = COMMAND_DESCRIPTIONS[cmd] || '';
      const text = `${index === selectedIndex ? '›' : ' '} ${cmd.padEnd(10)} ${desc}`;
      return index === selectedIndex ? chalk.cyan.bold(text) : chalk.dim(text);
    });
  }

  private getActiveReference(input: string): { start: number; end: number; query: string } | undefined {
    const match = input.match(/(^|\s)@([^\s]*)$/);
    if (!match || match.index === undefined) return undefined;

    const leading = match[1] || '';
    const query = match[2] || '';
    const start = match.index + leading.length;
    return { start, end: input.length, query };
  }

  private getFileReferenceHints(matches: FileSuggestion[], selectedIndex: number): string[] {
    if (matches.length === 0) {
      return [chalk.dim('  输入 @ 引用文件；当前目录无匹配项')];
    }

    return matches.map((item, index) => {
      const text = `${index === selectedIndex ? '›' : ' '} ${item.label}`;
      return index === selectedIndex ? chalk.cyan.bold(text) : chalk.dim(text);
    });
  }

  private commonPrefix(values: string[]): string {
    if (values.length === 0) return '';
    let prefix = values[0];
    for (const value of values.slice(1)) {
      while (!value.startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
    }
    return prefix;
  }

  parseImageContent(input: string): ContentPart[] | string {
    return parseReferencesToContent(input);
  }

  close(): void {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
}
