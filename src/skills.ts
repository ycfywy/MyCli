import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join, basename, extname } from 'path';
import { homedir } from 'os';

export interface SkillSummary {
  name: string;
  path: string;
  description: string;
}

export interface LoadedSkill extends SkillSummary {
  content: string;
}

const SKILL_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json']);
const SKILL_ENTRY_FILES = ['SKILL.md', 'skill.md', 'README.md'];

export class SkillManager {
  private readonly skillDirs: string[];

  constructor(skillDirs?: string[]) {
    this.skillDirs = skillDirs || [
      resolve(process.cwd(), 'skills'),
      join(homedir(), '.mycli', 'skills'),
    ];
  }

  listSkills(): SkillSummary[] {
    const skills = new Map<string, SkillSummary>();

    for (const dir of this.skillDirs) {
      if (!existsSync(dir)) continue;
      for (const skill of this.scanSkillDir(dir)) {
        if (!skills.has(skill.name)) {
          skills.set(skill.name, skill);
        }
      }
    }

    return Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  loadSkill(nameOrPath: string): LoadedSkill {
    const directPath = resolve(process.cwd(), nameOrPath);
    const summary = existsSync(directPath) ? undefined : this.findSkill(nameOrPath);
    const path = existsSync(directPath) ? directPath : summary?.path;

    if (!path) {
      throw new Error(`未找到 Skill: ${nameOrPath}`);
    }

    const filePath = this.resolveSkillFile(path);
    if (!filePath) {
      throw new Error(`Skill 无可加载文件: ${nameOrPath}`);
    }

    const content = readFileSync(filePath, 'utf-8').trim();
    const name = summary?.name || this.skillNameFromPath(path, filePath);

    return {
      name,
      path: filePath,
      description: this.extractDescription(content),
      content,
    };
  }

  buildSystemPrompt(basePrompt: string, skills: LoadedSkill[]): string {
    if (skills.length === 0) return basePrompt;

    const skillPrompt = skills
      .map((skill) => [
        `## Skill: ${skill.name}`,
        skill.description ? `Description: ${skill.description}` : '',
        'Instructions:',
        skill.content,
      ].filter(Boolean).join('\n'))
      .join('\n\n---\n\n');

    return `${basePrompt}\n\n# Loaded Skills\nThe following skills are active. Follow their instructions when relevant to the user's request.\n\n${skillPrompt}`;
  }

  private scanSkillDir(dir: string): SkillSummary[] {
    const result: SkillSummary[] = [];

    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const skillFile = this.resolveSkillFile(fullPath);
        if (!skillFile) continue;
        const content = readFileSync(skillFile, 'utf-8');
        result.push({
          name: basename(fullPath),
          path: skillFile,
          description: this.extractDescription(content),
        });
        continue;
      }

      if (!stat.isFile() || !SKILL_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
      const content = readFileSync(fullPath, 'utf-8');
      result.push({
        name: basename(entry, extname(entry)),
        path: fullPath,
        description: this.extractDescription(content),
      });
    }

    return result;
  }

  private findSkill(name: string): SkillSummary | undefined {
    const normalized = name.toLowerCase();
    return this.listSkills().find((item) => item.name.toLowerCase() === normalized);
  }

  private resolveSkillFile(path: string): string | undefined {
    if (!existsSync(path)) return undefined;

    const stat = statSync(path);
    if (stat.isFile()) return path;

    for (const entry of SKILL_ENTRY_FILES) {
      const fullPath = join(path, entry);
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return fullPath;
      }
    }

    return undefined;
  }

  private skillNameFromPath(path: string, filePath: string): string {
    if (existsSync(path) && statSync(path).isDirectory()) {
      return basename(path);
    }
    return basename(filePath, extname(filePath));
  }

  private extractDescription(content: string): string {
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const heading = lines.find((line) => line.startsWith('# '));
    const candidate = heading ? heading.replace(/^#+\s*/, '') : lines[0] || '';
    return candidate.replace(/^description:\s*/i, '').slice(0, 120);
  }
}
