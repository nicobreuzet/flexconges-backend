-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "endHalf" TEXT NOT NULL DEFAULT 'afternoon',
ADD COLUMN     "startHalf" TEXT NOT NULL DEFAULT 'morning';
