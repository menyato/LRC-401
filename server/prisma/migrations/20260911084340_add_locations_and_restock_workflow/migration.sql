-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('STORE', 'CABINET', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "RestockStatus" AS ENUM ('OPEN', 'PICKING', 'DELIVERED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterEnum
ALTER TYPE "MovementDirection" ADD VALUE 'TRANSFER';

-- DropIndex
DROP INDEX "StockLot_itemId_size_batchNumber_expiryDate_key";

-- AlterTable
ALTER TABLE "StockLot" ADD COLUMN     "locationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "fromLocationId" TEXT,
ADD COLUMN     "restockLineId" TEXT,
ADD COLUMN     "toLocationId" TEXT;

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL DEFAULT 'OTHER',
    "vehicleId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockRequest" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "shiftDate" DATE NOT NULL,
    "status" "RestockStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "sourceLocationId" TEXT NOT NULL,
    "targetLocationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "confirmedById" TEXT,
    "note" TEXT,
    "pickedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fieldKey" TEXT,
    "rowKey" TEXT,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "itemId" TEXT,
    "size" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "reportedQuantity" INTEGER,
    "expectedQuantity" INTEGER,
    "quantityNeeded" INTEGER NOT NULL DEFAULT 1,
    "quantityIssued" INTEGER NOT NULL DEFAULT 0,
    "isFulfilled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_key_key" ON "StorageLocation"("key");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_vehicleId_key" ON "StorageLocation"("vehicleId");

-- CreateIndex
CREATE INDEX "StorageLocation_kind_isActive_idx" ON "StorageLocation"("kind", "isActive");

-- CreateIndex
CREATE INDEX "RestockRequest_status_priority_idx" ON "RestockRequest"("status", "priority");

-- CreateIndex
CREATE INDEX "RestockRequest_teamId_shiftDate_idx" ON "RestockRequest"("teamId", "shiftDate");

-- CreateIndex
CREATE INDEX "RestockRequest_vehicleId_idx" ON "RestockRequest"("vehicleId");

-- CreateIndex
CREATE INDEX "RestockRequest_assignedToId_idx" ON "RestockRequest"("assignedToId");

-- CreateIndex
CREATE INDEX "RestockRequest_createdAt_idx" ON "RestockRequest"("createdAt");

-- CreateIndex
CREATE INDEX "RestockLine_requestId_idx" ON "RestockLine"("requestId");

-- CreateIndex
CREATE INDEX "RestockLine_itemId_idx" ON "RestockLine"("itemId");

-- CreateIndex
CREATE INDEX "StockLot_locationId_idx" ON "StockLot"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_itemId_locationId_size_batchNumber_expiryDate_key" ON "StockLot"("itemId", "locationId", "size", "batchNumber", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_restockLineId_key" ON "StockMovement"("restockLineId");

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_restockLineId_fkey" FOREIGN KEY ("restockLineId") REFERENCES "RestockLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockLine" ADD CONSTRAINT "RestockLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RestockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockLine" ADD CONSTRAINT "RestockLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
