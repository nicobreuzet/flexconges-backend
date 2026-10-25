-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorAlertAccountAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorAlertIpAt" TIMESTAMP(3);
