# AI Chat Bot Monorepo

这个仓库正在从单一 Next.js 项目重构为 `web + python` 共存的 monorepo。

## 当前目录结构

```text
packages/
  web/      Next.js 前端，负责聊天 UI 和 AI SDK 编排
  server/   FastAPI 后端，负责技能索引、文件读取、命令执行等服务
skills/     本地技能定义
src/web/    旧版前端目录，暂时保留用于迁移对照
```

## 开发方式

根目录启动前后端：

```bash
npm run dev
```

单独启动前端：

```bash
npm run dev:web
```

单独启动 Python 服务：

```bash
cd packages/server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## 环境变量

前端和后端现在共用 `packages/web/.env.local` 里的大多数变量，`packages/server` 启动时会自动读取这份文件。

共享变量：

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `QWEATHER_API_HOST`
- `QWEATHER_API_KEY`
- `SERPER_API_KEY`

前端附加变量：

- `AI_SERVER_BASE_URL`，默认 `http://127.0.0.1:8000`

后端附加变量：

- `WEB_ORIGIN`，默认 `http://127.0.0.1:3000`

如果后端需要单独覆盖配置，可以复制 `packages/server/.env.example` 为 `packages/server/.env`，该文件会在共享配置之后加载。

## 当前重构状态

- `packages/web` 已作为新的前端主目录。
- `packages/server` 已承接基础后端职责。
- `src/web` 仍是旧结构镜像，后续可以在确认无引用后删除。
