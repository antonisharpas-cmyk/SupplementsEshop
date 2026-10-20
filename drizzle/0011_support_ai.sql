ALTER TABLE "support_conversations" ADD COLUMN "ai_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD COLUMN "ai_typing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD COLUMN "handoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD COLUMN "ai_replies" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "meta" jsonb;