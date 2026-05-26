# MyCLI 项目说明

这是一个 TypeScript 编写的 Claude Code 风格命令行 AI 助手。它运行在终端里，基于 OpenAI 兼容的 Chat Completions API 提供多轮对话、流式输出、命令补全、模型选择、Skills 加载和 `@` 文件引用。

## 常用命令

```bash
npm install
npm run dev
npm run build
npm start
```

开发时优先运行：

```bash
npm run build
```

确认 TypeScript 能通过编译。

## 关键目录和文件

```text
src/
├── index.ts            # CLI 入口，加载配置、检查 API_KEY、启动 Agent
├── agent.ts            # 主 Agent 流程：处理输入、命令、Skills、模型选择、AI 请求
├── ai-client.ts        # OpenAI 兼容 API 客户端，支持流式 chat 和 /models 拉取
├── commands.ts         # 通用斜杠命令处理，如 /help、/new、/config、/tokens
├── config.ts           # .env 和 ~/.mycli/config.json 配置加载/保存
├── input-handler.ts    # 终端 raw-mode 输入、命令补全、@ 文件补全、选择器
├── file-references.ts  # @ 文件/目录引用解析，文本注入、图片转多模态
├── renderer.ts         # 终端输出渲染
├── skills.ts           # Skills 扫描、加载、注入系统提示词
└── types.d.ts          # 第三方库类型声明
```

## 配置

配置来自 `.env` 和 `~/.mycli/config.json`。

主要环境变量：

```env
API_KEY=your-api-key
API_BASE_URL=https://api.openai.com/v1
MODEL=gpt-4o
MODELS=gpt-4o,gpt-4o-mini
MAX_TOKENS=4096
TEMPERATURE=0.7
```

注意：不要提交 `.env`。

## Agent 主流程

`src/agent.ts` 的 `processInput()` 是核心入口：

1. 空输入直接忽略。
2. `/skills` 或 `/skill...` 交给 Skill 逻辑处理。
3. `/model` 或 `/m` 打开模型选择器。
4. 其他 `/...` 命令交给 `handleCommand()`。
5. 普通文本先通过 `InputHandler.parseImageContent()` 解析 `@` 引用和图片，再传给 `AIClient.streamChat()`。

`/new` 会重置对话，但会重新注入已加载的 Skills。

## 命令系统

命令定义主要分布在：

- `src/input-handler.ts`：`ALL_COMMANDS` 和命令补全展示。
- `src/commands.ts`：命令实际处理逻辑。
- `src/agent.ts`：需要异步交互的命令，比如 `/model`、`/skill`。

新增命令时通常需要同时更新：

1. `ALL_COMMANDS`
2. `COMMAND_DESCRIPTIONS`
3. `commands.ts` 或 `agent.ts`
4. `README.md`

## 模型选择

`/model` 的模型来源：

1. `AIClient.listModels()` 优先请求 `${API_BASE_URL}/models`。
2. 如果失败，回退到配置里的 `MODELS` 和当前 `MODEL`。
3. 使用 `InputHandler.selectFromList()` 展示全屏可滚动选择器。

不要重新加入 `/mode`，该别名已明确移除。保留 `/model` 和 `/m`。

## Skills 机制

`src/skills.ts` 负责扫描和加载 Skills。

搜索目录：

- 项目级：`./skills/`
- 用户级：`~/.mycli/skills/`

支持文件：

- `.md`
- `.txt`
- `.yaml`
- `.yml`
- `.json`

也支持目录型 Skill，例如：

```text
skills/code-review/skill.md
```

加载后，Skill 内容会通过 `SkillManager.buildSystemPrompt()` 拼接到系统提示词里，并由 `AIClient.setSystemPrompt()` 写入当前对话的 system message。

## `@` 文件引用机制

`@` 补全和引用由两个文件配合实现：

- `src/input-handler.ts`：负责输入时展示候选、处理 `Tab` 和 `↑/↓`。
- `src/file-references.ts`：负责扫描文件、解析引用、读取文件内容。

### 输入交互规则

- 输入 `@` 显示当前工作目录候选。
- 输入 `@src/` 显示 `src/` 下一级候选。
- `↑/↓` 只移动高亮候选，不立即引用。
- `Tab` 接受当前候选：
  - 如果是文件：插入 `@path/to/file `，追加空格，完成引用。
  - 如果是目录：插入 `@path/to/dir/`，进入下一级目录继续补全。
- 多个候选且没有公共前缀时，第一次 `Tab` 只高亮第一项；再次 `Tab` 接受该项。

### 发送时解析规则

`parseReferencesToContent()` 会把用户输入中的 `@path` 转换成发送给模型的上下文：

- 文本文件：读取内容，追加到 `# Referenced Files` 区块。
- 目录：追加目录树，最多递归 3 层、200 项。
- 图片：转成 `image_url` 多模态内容。
- 二进制文件：跳过内容并提示。

默认忽略：

- `node_modules/`
- `.git/`
- `dist/`
- `build/`
- `out/`
- `.cache/`
- `.temp/`
- `tmp/`
- `coverage/`
- `.codebuddy/`

## 输入系统注意事项

`InputHandler.readLine()` 使用 raw-mode 直接处理 stdin，不是普通 readline 交互。修改这里时要注意：

- `Ctrl+C` / `Ctrl+D` 应解析为 `/exit`。
- 每次渲染候选前需要清理旧候选行。
- 命令补全和 `@` 补全共享 `Tab`、`↑/↓`，但 `@` 补全优先级更高。
- `selectFromList()` 使用 alternate screen，全屏展示模型/Skill 列表，退出时必须恢复终端状态。

## API 客户端

`AIClient.streamChat()` 调用：

```text
POST ${API_BASE_URL}/chat/completions
```

请求体包含：

- `model`
- `messages`
- `max_tokens`
- `temperature`
- `stream: true`

流式响应按 OpenAI SSE 格式解析 `data: ...` 和 `data: [DONE]`。

## 编码约定

- 项目是 ESM：`package.json` 中 `"type": "module"`。
- TypeScript import 本地文件时使用 `.js` 后缀，例如 `import { Agent } from './agent.js'`。
- 优先做小范围修改，不要重写大文件。
- 修改输入交互后必须运行 `npm run build`。
- README 需要同步更新用户可见行为。

## 常见问题

### 修改后运行没变化

可能是旧 CLI 进程还在运行。退出后重新执行：

```bash
npm run dev
```

### `/model` 列表不对

检查 API 是否支持 `/models`。如果不支持，在 `.env` 里配置：

```env
MODELS=model-a,model-b,model-c
```

### `@` 补全行为异常

重点检查：

- `input-handler.ts` 中 `completeReference()`、`selectReference()`、`applyReferenceSuggestion()`。
- `file-references.ts` 中 `getFileSuggestions()` 是否返回了正确的 `isDirectory` 和带 `/` 的目录 `value`。

## 不要做的事

- 不要提交 `.env`。
- 不要删除 `.codebuddy/`。
- 不要重新加入 `/mode` 命令别名。
- 不要把大型依赖目录或构建产物提交到仓库。
