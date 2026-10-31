-- AlterTable
ALTER TABLE "User" ADD COLUMN     "managerId" INTEGER;

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
