-- CreateTable
CREATE TABLE "UsedPendingToken" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsedPendingToken_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "UsedPendingToken_expiresAt_idx" ON "UsedPendingToken"("expiresAt");
