import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'path';
import { ContentPart } from './ai-client.js';

export interface FileSuggestion {
  value: string;
  label: string;
  isDirectory: boolean;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IGNORE_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.cache', '.temp', 'tmp', 'coverage', '.codebuddy',
]);
const MAX_FILE_CHARS = 60_000;
const MAX_TREE_ENTRIES = 200;

export function getFileSuggestions(query: string, cwd = process.cwd()): FileSuggestion[] {
  const normalizedQuery = query.replace(/^['"]|['"]$/g, '');
  const dirPart = normalizedQuery.endsWith('/') ? normalizedQuery : dirname(normalizedQuery);
  const filePrefix = normalizedQuery.endsWith('/') || dirPart === '.' ? '' : basename(normalizedQuery);
  const displayDir = dirPart === '.' ? '' : dirPart;
  const targetDir = resolvePath(displayDir, cwd);

  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) return [];

  return readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => !shouldIgnore(entry.name))
    .filter((entry) => entry.name.toLowerCase().startsWith(filePrefix.toLowerCase()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((entry) => {
      const value = normalizeReferencePath(join(displayDir, entry.name)) + (entry.isDirectory() ? '/' : '');
      return {
        value,
        label: `${entry.isDirectory() ? '📁' : '📄'} ${value}`,
        isDirectory: entry.isDirectory(),
      };
    });
}

export function parseReferencesToContent(input: string, cwd = process.cwd()): string | ContentPart[] {
  const imageUrlRegex = /(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp))/gi;
  const base64Regex = /(data:image\/\w+;base64,[A-Za-z0-9+/=]+)/g;
  const referenceRegex = /(^|\s)@((?:"[^"]+")|(?:'[^']+')|[^\s]+)/g;

  const imageUrls = input.match(imageUrlRegex) || [];
  const base64Images = input.match(base64Regex) || [];
  const references: string[] = [];

  let textContent = input;
  for (const url of imageUrls) textContent = textContent.replace(url, '');
  for (const b64 of base64Images) textContent = textContent.replace(b64, '');

  textContent = textContent.replace(referenceRegex, (full, leading: string, rawPath: string) => {
    references.push(unquote(rawPath));
    return leading;
  }).trim();

  if (imageUrls.length === 0 && base64Images.length === 0 && references.length === 0) {
    return input;
  }

  const parts: ContentPart[] = [];
  const fileContexts: string[] = [];

  for (const ref of references) {
    const absolutePath = resolvePath(ref, cwd);
    if (isImagePath(absolutePath)) {
      const image = readImageAsContentPart(absolutePath);
      if (image) {
        parts.push(image);
      } else {
        fileContexts.push(`- 无法读取图片引用: @${ref}`);
      }
      continue;
    }

    fileContexts.push(formatReferenceContext(ref, absolutePath, cwd));
  }

  const combinedText = [
    textContent,
    fileContexts.length > 0 ? `\n\n# Referenced Files\n\n${fileContexts.join('\n\n')}` : '',
  ].filter(Boolean).join('\n');

  if (combinedText.trim()) {
    parts.unshift({ type: 'text', text: combinedText.trim() });
  }

  for (const url of imageUrls) {
    parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  }

  for (const b64 of base64Images) {
    parts.push({ type: 'image_url', image_url: { url: b64, detail: 'auto' } });
  }

  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text || '' : parts;
}

function resolvePath(path: string, cwd: string): string {
  return path.startsWith('/') ? path : resolve(cwd, path || '.');
}

function normalizeReferencePath(path: string): string {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function shouldIgnore(name: string): boolean {
  if (IGNORE_NAMES.has(name)) return true;
  return name.startsWith('.') && name !== '.env.example';
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function readImageAsContentPart(path: string): ContentPart | undefined {
  if (!existsSync(path) || !statSync(path).isFile()) return undefined;

  const buffer = readFileSync(path);
  const ext = extname(path).toLowerCase().replace('.', '');
  const mimeType = ext === 'jpg' ? 'jpeg' : ext;
  return {
    type: 'image_url',
    image_url: { url: `data:image/${mimeType};base64,${buffer.toString('base64')}`, detail: 'auto' },
  };
}

function formatReferenceContext(originalRef: string, absolutePath: string, cwd: string): string {
  const displayPath = normalizeReferencePath(relative(cwd, absolutePath) || originalRef);

  if (!existsSync(absolutePath)) {
    return `## @${originalRef}\n\n文件不存在: ${displayPath}`;
  }

  const stat = statSync(absolutePath);
  if (stat.isDirectory()) {
    return `## @${displayPath}/\n\n\`\`\`text\n${buildDirectoryTree(absolutePath, cwd)}\n\`\`\``;
  }

  if (!stat.isFile()) {
    return `## @${displayPath}\n\n不是普通文件，已跳过。`;
  }

  const buffer = readFileSync(absolutePath);
  if (isBinary(buffer)) {
    return `## @${displayPath}\n\n二进制文件，已跳过内容。`;
  }

  let content = buffer.toString('utf-8');
  const truncated = content.length > MAX_FILE_CHARS;
  if (truncated) {
    content = content.slice(0, MAX_FILE_CHARS);
  }

  const language = languageFromExtension(extname(absolutePath));
  return [
    `## @${displayPath}`,
    '',
    `\`\`\`${language}`,
    content,
    `\`\`\``,
    truncated ? `\n[内容过长，仅包含前 ${MAX_FILE_CHARS} 字符]` : '',
  ].filter(Boolean).join('\n');
}

function buildDirectoryTree(dir: string, cwd: string): string {
  const lines: string[] = [];
  let count = 0;

  const walk = (current: string, depth: number) => {
    if (count >= MAX_TREE_ENTRIES || depth > 3) return;
    const entries = readdirSync(current, { withFileTypes: true })
      .filter((entry) => !shouldIgnore(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (count >= MAX_TREE_ENTRIES) break;
      const fullPath = join(current, entry.name);
      const display = normalizeReferencePath(relative(cwd, fullPath));
      lines.push(`${'  '.repeat(depth)}${entry.isDirectory() ? '📁' : '📄'} ${display}${entry.isDirectory() ? '/' : ''}`);
      count++;
      if (entry.isDirectory()) walk(fullPath, depth + 1);
    }
  };

  walk(dir, 0);
  if (count >= MAX_TREE_ENTRIES) lines.push(`... 已截断，仅展示前 ${MAX_TREE_ENTRIES} 项`);
  return lines.join('\n') || '(空目录)';
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes(0);
}

function languageFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx', '.json': 'json', '.md': 'md',
    '.py': 'py', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cpp': 'cpp', '.c': 'c',
    '.h': 'c', '.hpp': 'cpp', '.css': 'css', '.html': 'html', '.yml': 'yaml', '.yaml': 'yaml',
    '.sh': 'bash', '.toml': 'toml', '.xml': 'xml', '.sql': 'sql', '.txt': 'text',
  };
  return map[ext.toLowerCase()] || '';
}
