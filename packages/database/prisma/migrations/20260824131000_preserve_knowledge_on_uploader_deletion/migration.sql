ALTER TABLE "KnowledgeDocument" ALTER COLUMN "uploadedByUserId" DROP NOT NULL;

ALTER TABLE "KnowledgeDocument" DROP CONSTRAINT "KnowledgeDocument_uploadedByUserId_fkey";
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
