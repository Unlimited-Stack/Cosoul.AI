-- 为 chat_messages 表新增 compress_summary 列
-- 用于存储 LLM 生成的压缩对话历史摘要（上下文过长时触发）
ALTER TABLE "chat_messages" ADD COLUMN "compress_summary" text;
