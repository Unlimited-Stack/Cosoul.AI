-- 启用 pgvector 扩展（必须在建表前执行）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"persona_id" uuid NOT NULL,
	"sender_type" varchar(20) NOT NULL,
	"sender_id" uuid NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"friend_persona_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ai_note" text,
	"source_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handshake_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"direction" varchar(10) NOT NULL,
	"envelope" jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"task_id" uuid,
	"summary_text" text NOT NULL,
	"source_log_id" varchar(255),
	"turn_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_profiles" (
	"persona_id" uuid PRIMARY KEY NOT NULL,
	"profile_text" text,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"persona_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"avatar" text,
	"bio" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_summaries" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"summary_text" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_vectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"field" varchar(30) NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model" varchar(100) DEFAULT 'text-embedding-v4',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"task_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'Drafting' NOT NULL,
	"interaction_type" varchar(20) DEFAULT 'any' NOT NULL,
	"current_partner_id" uuid,
	"raw_description" text,
	"target_activity" text,
	"target_vibe" text,
	"detailed_plan" text,
	"entered_status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pending_sync" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100),
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_persona_id_personas_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_persona_id_personas_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_friend_persona_id_personas_persona_id_fk" FOREIGN KEY ("friend_persona_id") REFERENCES "public"."personas"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_task_id_tasks_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("task_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handshake_logs" ADD CONSTRAINT "handshake_logs_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_summaries" ADD CONSTRAINT "memory_summaries_persona_id_personas_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_summaries" ADD CONSTRAINT "memory_summaries_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_persona_id_personas_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_summaries" ADD CONSTRAINT "task_summaries_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_vectors" ADD CONSTRAINT "task_vectors_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_persona_id_personas_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_persona" ON "chat_messages" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "idx_chat_task" ON "chat_messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_persona" ON "contacts" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_friend" ON "contacts" USING btree ("friend_persona_id");--> statement-breakpoint
CREATE INDEX "idx_handshake_task" ON "handshake_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_memory_persona" ON "memory_summaries" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "idx_personas_user_id" ON "personas" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_vectors_task_field" ON "task_vectors" USING btree ("task_id","field");--> statement-breakpoint
CREATE INDEX "idx_tasks_persona_status" ON "tasks" USING btree ("persona_id","status");--> statement-breakpoint
-- pgvector HNSW 索引：加速向量余弦距离检索
CREATE INDEX "idx_task_vectors_embedding_hnsw" ON "task_vectors" USING hnsw ("embedding" vector_cosine_ops);