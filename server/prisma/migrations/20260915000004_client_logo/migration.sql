-- The client's logo: a storage key, never a URL. The bytes live outside the
-- web root and are served only to the firm that owns the client.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "logoKey" TEXT;
