# 多轮对话测试场景定义

## 场景 A：Intake 多轮需求提取

### 设计目的
验证 intake 模块在用户信息不足时能否正确追问，并在多轮对话后完整提取所有字段。

### 对话脚本

| 轮次 | 角色 | 内容 | 预期行为 |
|------|------|------|----------|
| 1 | 用户 | "好无聊啊，想找人一起玩点什么" | complete=false，缺失 targetActivity, targetVibe, interaction_type |
| 1 | 系统 | 追问（自动生成） | 应询问具体活动或互动方式 |
| 2 | 用户 | "想去打羽毛球，最好是线下面对面的" | interaction_type=offline，targetActivity 已填充 |
| 2 | 系统 | 追问（如还缺字段） | 应询问氛围偏好 |
| 3 | 用户 | "希望是轻松愉快的，不要太卷，大家随便打打" | 所有字段已填充，complete=true |

### 验证点
- 第 1 轮必须返回 complete=false + missingFields.length > 0
- 第 2 轮 interaction_type 必须被识别为 "offline"
- 第 3 轮所有必填字段（targetActivity, targetVibe, interaction_type）非空
- buildTaskDocument 生成的 TaskDocument 通过 Zod 校验
- task.md 包含正确的 YAML frontmatter

---

## 场景 B：Revise 多轮需求修改

### 设计目的
验证 revise 模块在已有任务基础上，能否正确识别修改意图、检测变更字段，以及区分闲聊和修改指令。

### 初始任务
- 活动：打篮球
- 氛围：轻松随意，友好开放
- 互动方式：offline

### 对话脚本

| 轮次 | 角色 | 内容 | 预期行为 |
|------|------|------|----------|
| 1 | 用户 | "我改主意了，想打羽毛球，不打篮球了" | changedFields 包含 targetActivity，needReEmbed=true |
| 2 | 用户 | "氛围方面，我想找那种比较有竞技精神的" | changedFields 包含 targetVibe |
| 3 | 用户 | "对了，一般打羽毛球大概要多少人比较好玩？" | revision=null（纯闲聊） |
| 4 | 用户 | "算了线上线下都行吧，改成都可以" | changedFields 包含 interaction_type |

### 验证点
- 第 1 轮：targetActivity 变更，needReEmbed=true
- 第 2 轮：targetVibe 变更
- 第 3 轮：纯闲聊不应触发修改（revision=null）
- 第 4 轮：interaction_type 变更
- 最终 task 的 version >= 初始版本 + 修改次数
- 生成的 task.md 反映所有修改
