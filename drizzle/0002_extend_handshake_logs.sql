-- 扩展 handshake_logs 表：支持 L2 LLM 研判对话存储
-- direction 扩展至 20 字符，新增 l2_request / l2_response 类型
-- 新增 round、visible_to_user、user_summary 列

-- 1. 扩展 direction 列宽度（原 varchar(10) → varchar(20)）
ALTER TABLE "handshake_logs" ALTER COLUMN "direction" TYPE varchar(20);

-- 2. 新增 round 列（协商轮次，可选）
ALTER TABLE "handshake_logs" ADD COLUMN "round" integer;

-- 3. 新增 visible_to_user 列（是否节选给用户展示）
ALTER TABLE "handshake_logs" ADD COLUMN "visible_to_user" boolean NOT NULL DEFAULT false;

-- 4. 新增 user_summary 列（面向用户的可读摘要）
ALTER TABLE "handshake_logs" ADD COLUMN "user_summary" text;

-- 5. 新增复合索引（按 task_id + round 查询历史）
CREATE INDEX IF NOT EXISTS "idx_handshake_task_round" ON "handshake_logs" ("task_id", "round");
