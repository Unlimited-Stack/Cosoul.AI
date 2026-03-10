# Git 开发规范文档

> 基于 [Conventional Commits](https://www.conventionalcommits.org/) 规范，参考 OpenClaw 等开源项目的最佳实践。

---

## 一、Commit Message 结构

每条提交信息由三部分组成：

```
<type>(<scope>): <subject>

[body]

[footer]
```

| 部分 | 是否必填 | 说明 |
|------|---------|------|
| `type` | 必填 | 提交类型（见下节） |
| `scope` | 可选 | 影响范围，如 `auth`、`db`、`ui` |
| `subject` | 必填 | 简短描述，英文小写开头，不加句号 |
| `body` | 可选 | 详细说明，解释"为什么"而非"做了什么" |
| `footer` | 可选 | Breaking Change 或关联 Issue |

**示例：**

```
feat(auth): add OAuth2 login with GitHub

Allow users to sign in using their GitHub account.
Implements PKCE flow to prevent CSRF attacks.

Closes #42
```

---

## 二、Type 类型详解

从 OpenClaw 及业界规范中归纳的常用前缀：

### `feat` — 新功能
引入新的用户可见功能。

```
feat(feed): add infinite scroll pagination
feat(agent): integrate DashScope embedding API
feat: add dark mode support
```

### `fix` — 缺陷修复
修复一个已知的 Bug。

```
fix(db): resolve connection pool exhaustion on high load
fix(ui): correct tab bar pill animation on Android
fix: handle null user session on cold start
```

### `chore` — 杂项维护
不影响业务逻辑的维护性工作：依赖更新、构建脚本、配置修改、代码格式化。

```
chore: update appcast for 2026.1.30
chore: run pnpm format:fix
chore: add pnpm check for fast repo checks
chore: update deps
```

> OpenClaw 截图中出现频率最高的前缀，常用于 CI 自动格式化、依赖升级等。

### `refactor` — 重构
代码结构改进，**不修改功能，不修复 Bug**。

```
refactor(vendor): align a2ui renderer typings
refactor: rename to openclaw
refactor(core): extract LlmService interface
```

### `docs` — 文档
仅修改文档，包括注释、README、规范文档等。

```
docs: fix Moonshot sync markers
docs: add pgvector persistence rebuild guide
docs: update contributors list
```

### `ci` — 持续集成
修改 CI/CD 配置文件（GitHub Actions、流水线脚本等）。

```
ci: enforce lf line endings
ci: add matrix crypto build scripts
ci: enable experimentalSortImports in Oxfmt
```

### `revert` — 回滚
撤销之前的某次提交。Subject 中注明被回滚的提交描述。

```
revert: switch back to tsc for compiling
revert: feat(agent): add streaming response
```

### `build` — 构建系统
影响构建流程或外部依赖的改动（webpack、rollup、npm scripts 等）。

```
build: allow matrix crypto build scripts
build: migrate from npm to pnpm workspaces
```

### `perf` — 性能优化
专门用于提升性能的改动。

```
perf(vector): switch HNSW index to cosine ops
perf(feed): lazy-load off-screen images
```

### `test` — 测试
添加或修改测试用例，不涉及业务代码。

```
test(db): add seed data validation tests
test: add unit tests for LlmService
```

### `style` — 样式/格式
仅涉及代码格式（空格、缩进、分号），不影响逻辑。区别于 `chore` 的是范围更窄。

```
style: remove trailing whitespace in schema.ts
```

---

## 三、Scope 使用建议

Scope 描述"影响了哪个模块"，建议结合项目结构定义：

| Scope | 对应范围 |
|-------|---------|
| `auth` | 认证授权 |
| `db` | 数据库 / Schema / 迁移 |
| `ui` | 共享 UI 组件（packages/ui） |
| `agent` | Agent 逻辑（packages/agent） |
| `core` | 核心库（packages/core） |
| `web` | Web 端（apps/web） |
| `native` | 移动端（apps/native） |
| `feed` | 首页模块 |
| `cards` | 发现模块 |
| `messages` | 消息模块 |
| `profile` | 我的模块 |
| `ci` | CI/CD 配置 |
| `deps` | 依赖升级 |

---

## 四、Subject 书写规则

1. **英文优先**，中文项目也可用中文，但要统一风格
2. 动词开头，使用祈使句（`add`、`fix`、`remove`，不是 `added`、`fixed`）
3. 首字母小写
4. 结尾不加句号
5. 控制在 **72 字符**以内

| 推荐写法 | 不推荐写法 |
|---------|---------|
| `fix connection timeout` | `Fixed the connection timeout issue.` |
| `add user avatar upload` | `Added a new feature for user avatar upload` |
| `remove deprecated API` | `delete old stuff` |

---

## 五、Breaking Change 标注

当改动破坏向后兼容性时，在 footer 中用 `BREAKING CHANGE:` 标注，或在 type 后加 `!`：

```
feat(api)!: remove v1 persona endpoint

BREAKING CHANGE: /api/v1/personas has been removed.
Migrate to /api/v2/personas which supports pagination.
```

---

## 六、关联 Issue

在 footer 中引用 Issue，GitHub 会自动关闭对应 Issue：

```
fix(db): handle null vector on cold persona match

Closes #128
Related to #120
```

---

## 七、完整示例对照

以下是从 OpenClaw 截图中提取的真实提交，结合规范解读：

| 原始提交 | Type | 说明 |
|---------|------|------|
| `chore: Run pnpm format:fix` | chore | 自动格式化，无业务逻辑变更 |
| `feat: update chat layout and session management` | feat | 新功能，UI + 状态管理 |
| `fix: add git hook setup and stable config hash sorting` | fix | 缺陷修复，两个相关联的修复合并 |
| `refactor(vendor): align a2ui renderer typings` | refactor | 类型对齐，无功能改动 |
| `docs: fix Moonshot sync markers` | docs | 仅文档改动 |
| `ci: enforce lf line endings` | ci | CI 配置，强制换行符 |
| `revert: Switch back to tsc for compiling` | revert | 回滚之前的编译器切换 |
| `build: allow matrix crypto build scripts` | build | 构建脚本改动 |

---

## 八、本项目推荐工作流

### 日常提交流程

```bash
# 1. 查看变更
git status
git diff

# 2. 分模块暂存（不要一次 git add .）
git add packages/ui/src/screens/FeedScreen.tsx
git add apps/web/components/Sidebar.tsx

# 3. 写 commit message
git commit -m "feat(ui): rename 锐评 tab to Agent and remove emoji icons"

# 4. 推送到功能分支
git push origin feat/agent-tab-rename
```

### 分支命名规范

与 commit type 保持一致：

```
feat/agent-matching-flow
fix/db-vector-null-crash
chore/update-dashscope-sdk
refactor/llm-service-interface
docs/add-git-standards
```

### 禁止的行为

```bash
# 禁止：含义不明的 message
git commit -m "update"
git commit -m "fix bug"
git commit -m "aaa"
git commit -m "."

# 禁止：一次提交混入多种不相关改动
# 应拆分为独立的 fix commit 和 feat commit

# 禁止：跳过 pre-commit hooks
git commit --no-verify
```

---

## 九、快速参考卡片

```
feat     新功能
fix      Bug 修复
chore    维护/依赖/格式化（不影响逻辑）
refactor 重构（不加功能，不修 Bug）
docs     文档/注释
ci       CI/CD 配置
revert   撤销提交
build    构建系统
perf     性能优化
test     测试用例
style    代码格式（空格/缩进，不影响逻辑）
```

---

> 参考规范：[Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) | [Angular Commit Guidelines](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#commit)
