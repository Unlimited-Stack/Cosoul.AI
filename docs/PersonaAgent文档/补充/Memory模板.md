# Memory.md 完整模板

> 位置：`.data/<persona_id>/Memory.md`（分身级，Persona-Agent 独占读写）
> 大小限制：≤ 8000 字符，超限时 LLM 摘要压缩。

```markdown
---
persona_id: "P-xxxxxxxx"
last_updated: "2026-03-11T10:00:00Z"
total_tasks_completed: 0
total_tasks_cancelled: 0
---

# 匹配模式总结

## 高满意度模式
（从已完成任务中归纳的正面模式）

## 低满意度模式
（从已完成任务中归纳的负面模式）

# 偏好演变日志

（按日期追加的偏好学习记录，格式如下）
## YYYY-MM-DD
- 从任务 T-xxx 学到：...
- 调整建议：...

# Token 使用统计

| 月份 | 总 Token | Intake | L2 研判 | Memory Flush |
|------|---------|--------|---------|-------------|
```

## 写入规则

1. **追加模式**：偏好学习产出 `PreferenceLearning` → 追加到"偏好演变日志"
2. **压缩触发**：总字符 > 8000 时，调 LLM 归纳"匹配模式总结"段，清理旧日志
3. **来源**：只从 `task_summary.md` 学习，不直接读 raw_chats

## 与 task-agent memory.ts 的关系

| | Memory.md | memory.ts |
|---|-----------|-----------|
| 层级 | Persona 层（跨任务） | Task 层（单任务） |
| 内容 | 偏好模式/教训 | 对话 token 压缩 |
| 生命周期 | 长期（月/年） | 短期（单次任务内） |
| 写入者 | persona-agent | task-agent |

两者互不干扰，完全独立运行。
