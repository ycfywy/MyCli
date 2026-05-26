# MyCLI - AI Coding Assistant

一个类似 Claude Code 的命令行 AI 编程助手，基于 OpenAI 兼容的 Chat Completions API，支持流式对话、命令补全、多模态输入、模型选择和 Skills 扩展。

## 功能特性

- **流式对话**：AI 回复实时输出，保留上下文多轮对话。
- **命令系统**：支持 `/help`、`/model`、`/new`、`/skills` 等斜杠命令。
- **命令补全**：输入 `/` 后显示候选命令，支持 `Tab`、`↑/↓` 选择。
- **模型选择**：`/model` 进入可滚动模型列表，支持上下选择。
- **Skills 支持**：从项目或用户目录加载专用技能提示词，并注入系统提示词。
- **多模态输入**：支持图片 URL、本地图片文件和 base64 图片。
- **多行输入**：使用 `"""` 开始和结束多行输入。
- **灵活配置**：支持 OpenAI、DeepSeek、通义千问、Ollama、LM Studio 等兼容接口。

## 环境要求

- Node.js 20+
- npm

如果当前环境没有 `node/npm`，可以先安装或把已有 Node.js 加入 `PATH`。

## 安装

```bash
cd /root/aigame/dannyyan/mycli
npm install
```

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
API_KEY=your-api-key
API_BASE_URL=https://api.openai.com/v1
MODEL=gpt-4o

# 当 API 不支持 /models 接口时，可手动配置候选模型
MODELS=gpt-4o,gpt-4o-mini

MAX_TOKENS=4096
TEMPERATURE=0.7
```

### 环境变量说明

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `API_KEY` | 是 | API 密钥 | - |
| `API_BASE_URL` | 否 | OpenAI 兼容 API 地址 | `https://api.openai.com/v1` |
| `MODEL` | 否 | 当前默认模型 | `gpt-4o` |
| `MODELS` | 否 | 模型候选列表，逗号分隔 | 当前 `MODEL` |
| `MAX_TOKENS` | 否 | 最大回复 token 数 | `4096` |
| `TEMPERATURE` | 否 | 温度参数 | `0.7` |

## 运行

开发模式：

```bash
npm run dev
```

构建后运行：

```bash
npm run build
npm start
```

全局链接到本机命令：

```bash
npm run build
npm link
mycli
```

## 命令列表

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/model` | 打开模型选择器，支持 `↑/↓`、`Tab`、`Enter` |
| `/model <name>` | 直接切换到指定模型 |
| `/m` | `/model` 简写 |
| `/new` | 开始新对话，保留已加载 Skills |
| `/history` | 查看对话历史摘要 |
| `/config` | 查看当前配置 |
| `/clear` | 清屏 |
| `/system <prompt>` | 设置系统提示词 |
| `/tokens` | 查看 token 用量估算 |
| `/skills` | 查看可用和已加载的 Skills |
| `/skill` | 打开 Skill 选择器 |
| `/skill <name>` | 加载指定 Skill |
| `/skill load <name>` | 加载指定 Skill |
| `/skill unload <name>` | 卸载指定 Skill |
| `/skill current` | 查看当前已加载 Skills |
| `/skill clear` | 清空已加载 Skills |
| `/exit` / `/quit` | 退出程序 |

## 快捷键

### 普通输入

| 快捷键 | 说明 |
|--------|------|
| `Tab` | 补全或切换命令候选 |
| `↑/↓` | 在命令候选中上下选择 |
| `Enter` | 发送输入或执行命令 |
| `Ctrl+C` | 退出 |

### 模型/Skill 选择器

| 快捷键 | 说明 |
|--------|------|
| `↑/↓` | 上下选择 |
| `j/k` | 下/上选择 |
| `Tab` | 下一项 |
| `PageUp/PageDown` | 翻页 |
| `Enter` | 确认 |
| `Esc` / `Ctrl+C` | 取消 |

## Skills

Skill 是一段可复用的专用提示词或工作流。加载后会注入系统提示词，后续对话会自动使用。

### 搜索目录

- 当前项目的 `skills/`
- 用户目录的 `~/.mycli/skills/`

### 支持格式

- `.md`
- `.txt`
- `.yaml`
- `.yml`
- `.json`

也支持目录型 Skill：

```text
skills/
└── code-review/
    └── skill.md
```

### 创建示例

```bash
mkdir -p skills/code-review
cat > skills/code-review/skill.md <<'EOF'
# code-review

你是严格的代码审查助手。
重点检查：
- 正确性
- 边界条件
- 类型安全
- 可维护性
- 安全风险

输出格式：
1. 主要问题
2. 建议修改
3. 风险等级
EOF
```

### 使用示例

```text
/skills
/skill
/skill code-review
/skill current
/skill unload code-review
/skill clear
```

## 多模态输入

### 图片 URL

```text
解释这张图片 https://example.com/screenshot.png
```

### 本地图片

使用 `@` 引用本地图片：

```text
分析这个截图 @./screenshot.png
```

支持格式：`png`、`jpg`、`jpeg`、`gif`、`webp`。

### Base64 图片

```text
请分析这张图片 data:image/png;base64,...
```

## 多行输入

使用三引号进入多行模式：

```text
"""
这里可以输入多行内容
比如代码片段、报错日志、需求描述
"""
```

## 模型列表机制

`/model` 的候选模型来源：

1. 优先请求当前 `API_BASE_URL` 的 `/models` 接口。
2. 如果接口不可用，则使用 `.env` 中的 `MODELS`。
3. 当前 `MODEL` 会始终加入候选列表。

## 项目结构

```text
mycli/
├── src/
│   ├── index.ts          # CLI 入口
│   ├── agent.ts          # Agent 主流程
│   ├── ai-client.ts      # AI API 客户端
│   ├── commands.ts       # 命令处理
│   ├── config.ts         # 配置管理
│   ├── input-handler.ts  # 输入、补全、选择器
│   ├── renderer.ts       # 终端渲染
│   ├── skills.ts         # Skills 加载与注入
│   └── types.d.ts        # 类型声明
├── skills/               # 项目级 Skills，可选
├── .env.example          # 配置模板
├── package.json
└── tsconfig.json
```

## 开发

```bash
# 开发模式
npm run dev

# 编译
npm run build

# 构建后运行
npm start
```

## 注意事项

- 不要提交 `.env`，其中可能包含 API Key。
- 如果 `/model` 模型列表不正确，请检查 API 是否支持 `/models`，或手动配置 `MODELS`。
- 如果修改了源码后运行结果没变化，请重启当前 CLI 进程。

## License

MIT
