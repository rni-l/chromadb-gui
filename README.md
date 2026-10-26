# Chroma GUI

本地运行的 ChromaDB 1.x 网页版可视化管理工具（Node.js + React）。功能参考 [Chroma Explorer](https://www.chroma-explorer.com/#features)，另加了向量空间散点图。

## 功能

- **连接管理**：本地 / 自建 / Chroma Cloud，多连接；支持 X-Chroma-Token、Bearer、Basic 认证；tenant 自动识别
- **数据库与集合**：新建/删除数据库；新建集合（距离度量、HNSW 参数、Embedding 函数）、重命名、改 metadata、改 `ef_search`、删除
- **数据浏览**：分页表格、metadata 条件构建器 / `where_document` / 原始 JSON 过滤，批量删除、按过滤条件删除
- **记录编辑**：编辑 document（自动重新计算向量）和 metadata（删除的 key 会正确清除），单条/批量 JSON 写入（支持 Chroma 列格式）
- **向量检查器**：维度、L2 范数、统计值、逐维热力条、取值分布，复制向量
- **语义检索**：自然语言 / 按记录找相似 / 直接输入向量，可叠加过滤；显示距离与按度量换算的相似度
- **向量空间**：服务端 PCA（大维度用随机化 SVD）+ 浏览器 Web Worker 跑 UMAP；按 metadata 分类或数值着色；文本高亮最近邻；点击查看记录
- **复制 / 迁移**：集合在库间、连接间复制（如本地 → Cloud），保留原始向量不重算；同库优先 `fork`；SSE 实时进度、可取消
- **Embedding 配置**：内置本地 all-MiniLM-L6-v2；OpenAI 及兼容接口（Jina、Mistral、Voyage、硅基流动、百炼、智谱…）；Ollama。打开集合时按集合声明的 embedding function 自动匹配，也可手动绑定

## 快速开始

需要 Node.js ≥ 20、pnpm。

```bash
pnpm install
docker compose up -d                                      # 可选：开发用 Chroma，监听 127.0.0.1:8010
CHROMA_URL=http://localhost:8010 HF_ENDPOINT=https://hf-mirror.com pnpm seed   # 可选：示例数据

pnpm dev        # API :4580 + Web :4581（热更新），打开 http://localhost:4581
# 或
pnpm build && pnpm start   # 单进程，打开 http://localhost:4580
```

在页面里「新建连接」填 Chroma 地址即可。

## 设计要点

- **后端直接调用 Chroma REST API v2**（`server/chroma-rest.ts`），没用官方 JS 客户端的 Collection 封装——后者会按集合配置实例化 embedding function，遇到本机没装的 EF 就打不开集合。
- **向量由本工具计算后显式传给 Chroma**，所以浏览、过滤、删除不依赖 embedding；只有写入文本和文本检索需要可用的 Embedding 配置。
- **单用户本地工具**：服务只监听 `127.0.0.1`；连接凭据和 API Key 只存于 `~/.chromadb-gui/config.json`（权限 0600），返回前端前脱敏。目录可用 `CHROMADB_GUI_HOME` 覆盖。
- 内置本地模型首次使用会从 HuggingFace 下载（约 90MB，缓存于 `~/.chromadb-gui/models`），国内网络请在「设置」里填镜像（如 `https://hf-mirror.com`）。

## 目录

```
server/            Hono API
  chroma-rest.ts   Chroma REST v2 薄客户端
  embeddings.ts    Embedding provider 与「集合声明 → 本地配置」匹配
  pca.ts           PCA（精确 / 随机化 SVD）
  migrations.ts    复制 / 迁移任务
  routes/          connections · collections（记录/检索/投影）· profiles
web/src/           React 前端（Vite + Tailwind + TanStack Query + ECharts）
shared/types.ts    前后端共享类型
scripts/seed.ts    示例数据
```

## 测试

```bash
docker compose up -d
pnpm test        # PCA 单测 + 对真实 Chroma 的 API 集成测试（Chroma 不可达时自动跳过）
pnpm typecheck
```

集成测试默认连 `http://localhost:8010`，可用 `TEST_CHROMA_URL` 覆盖；其中用一个本地假 OpenAI 兼容服务替代真实 embedding 接口。

## 暂未支持

多用户部署与登录、其余 embedding provider（Cohere、Gemini 原生接口等）、3D 视图、CSV/JSONL 导入导出、Chroma 0.x。
