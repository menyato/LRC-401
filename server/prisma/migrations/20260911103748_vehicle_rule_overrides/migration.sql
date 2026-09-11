-- CreateTable
CREATE TABLE "VehicleRuleOverride" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "rowKey" TEXT,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "expected" INTEGER,
    "warnBelow" INTEGER,
    "criticalBelow" INTEGER,
    "priority" "Priority",
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleRuleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleRuleOverride_vehicleId_idx" ON "VehicleRuleOverride"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRuleOverride_vehicleId_fieldKey_rowKey_key" ON "VehicleRuleOverride"("vehicleId", "fieldKey", "rowKey");

-- AddForeignKey
ALTER TABLE "VehicleRuleOverride" ADD CONSTRAINT "VehicleRuleOverride_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleRuleOverride" ADD CONSTRAINT "VehicleRuleOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
