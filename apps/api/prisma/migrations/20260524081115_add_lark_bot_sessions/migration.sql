-- CreateTable
CREATE TABLE "lark_bot_sessions" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "chat_type" TEXT NOT NULL,
    "trigger_open_id" TEXT NOT NULL,
    "card_message_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'select_template',
    "template_id" TEXT,
    "form_data" JSONB,
    "render_job_id" TEXT,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lark_bot_sessions_render_job_id_key" ON "lark_bot_sessions"("render_job_id");

-- CreateIndex
CREATE INDEX "lark_bot_sessions_chat_id_trigger_open_id_state_idx" ON "lark_bot_sessions"("chat_id", "trigger_open_id", "state");

-- CreateIndex
CREATE INDEX "lark_bot_sessions_render_job_id_idx" ON "lark_bot_sessions"("render_job_id");
