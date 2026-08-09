-- CreateTable
CREATE TABLE "UpsellRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "targetId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxProducts" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UpsellRuleProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UpsellRuleProduct_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "UpsellRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UpsellRule_shop_idx" ON "UpsellRule"("shop");

-- CreateIndex
CREATE INDEX "UpsellRule_shop_ruleType_idx" ON "UpsellRule"("shop", "ruleType");

-- CreateIndex
CREATE INDEX "UpsellRuleProduct_ruleId_idx" ON "UpsellRuleProduct"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "UpsellRuleProduct_ruleId_productId_key" ON "UpsellRuleProduct"("ruleId", "productId");
