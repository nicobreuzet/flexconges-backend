const crypto = require('crypto');
const prisma = require('../config/prisma');
const { purgeExpiredPendingTokens } = require('../utils/pendingTokenPurge');

describe('Purge des jetons temporaires utilises', () => {
  test('supprime les jetons expires et garde ceux qui sont encore valables', async () => {
    const now = new Date();
    const expired = crypto.randomUUID();
    const valid = crypto.randomUUID();
    await prisma.usedPendingToken.createMany({
      data: [
        { jti: expired, expiresAt: new Date(now.getTime() - 60 * 1000) },
        { jti: valid, expiresAt: new Date(now.getTime() + 5 * 60 * 1000) }
      ]
    });

    const count = await purgeExpiredPendingTokens(now);

    expect(count).toBeGreaterThanOrEqual(1);
    expect(await prisma.usedPendingToken.findUnique({ where: { jti: expired } })).toBeNull();
    expect(await prisma.usedPendingToken.findUnique({ where: { jti: valid } })).not.toBeNull();

    await prisma.usedPendingToken.deleteMany({ where: { jti: valid } });
  });
});
