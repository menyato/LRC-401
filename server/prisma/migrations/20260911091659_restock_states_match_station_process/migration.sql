-- AlterEnum
BEGIN;
CREATE TYPE "RestockStatus_new" AS ENUM ('OPEN', 'PREPARING', 'READY', 'CONFIRMED', 'CANCELLED');
ALTER TABLE "public"."RestockRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RestockRequest" ALTER COLUMN "status" TYPE "RestockStatus_new" USING ("status"::text::"RestockStatus_new");
ALTER TYPE "RestockStatus" RENAME TO "RestockStatus_old";
ALTER TYPE "RestockStatus_new" RENAME TO "RestockStatus";
DROP TYPE "public"."RestockStatus_old";
ALTER TABLE "RestockRequest" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- AlterTable
ALTER TABLE "RestockRequest" DROP COLUMN "deliveredAt",
DROP COLUMN "pickedAt",
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);
