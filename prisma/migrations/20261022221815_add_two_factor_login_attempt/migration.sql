-- CreateTable
CREATE TABLE "TwoFactorLoginAttempt" (
    "userId" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorLoginAttempt_pkey" PRIMARY KEY ("userId","ip")
);

-- CreateIndex
CREATE INDEX "TwoFactorLoginAttempt_updatedAt_idx" ON "TwoFactorLoginAttempt"("updatedAt");
