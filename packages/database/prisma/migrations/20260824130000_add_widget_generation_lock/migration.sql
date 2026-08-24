ALTER TABLE "WidgetConversation" ADD COLUMN "generationLockAt" TIMESTAMP(3);

CREATE INDEX "WidgetConversation_workspaceId_generationLockAt_idx" ON "WidgetConversation"("workspaceId", "generationLockAt");
