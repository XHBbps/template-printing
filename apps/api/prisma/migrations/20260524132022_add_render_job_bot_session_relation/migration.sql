-- AddForeignKey
ALTER TABLE "lark_bot_sessions" ADD CONSTRAINT "lark_bot_sessions_render_job_id_fkey" FOREIGN KEY ("render_job_id") REFERENCES "render_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
