import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Object storage behind one interface.
 *
 * Uploaded statements are retained for audit: they hold a client's complete
 * financial history and are scoped exactly as tightly as the transactions
 * they produced. Keys are `<firmId>/…`, so the tenant is part of the path.
 *
 * With `S3_BUCKET` set the S3 driver is used (S3 or Cloudflare R2 through
 * `S3_ENDPOINT`); otherwise files go to `storage/` on local disk, outside
 * the web root — the prototype default.
 */

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Keys are opaque paths under the firm; anything that could escape is refused. */
function safeKey(key: string): string {
  const cleaned = normalize(key).replace(/\\/g, "/");
  if (cleaned.startsWith("/") || cleaned.includes("..")) throw new Error("Invalid storage key");
  return cleaned;
}

class LocalDriver implements StorageDriver {
  readonly name = "local";
  private readonly root = join(process.cwd(), "storage");

  async put(key: string, body: Buffer | string, _contentType: string): Promise<void> {
    const path = join(this.root, safeKey(key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(join(this.root, safeKey(key)));
  }
}

class S3Driver implements StorageDriver {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    const endpoint = process.env.S3_ENDPOINT?.trim();
    this.client = new S3Client({
      region: process.env.S3_REGION?.trim() || "auto",
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object not found: ${key}`);
    return Buffer.from(bytes);
  }
}

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const bucket = process.env.S3_BUCKET?.trim();
  cached = bucket ? new S3Driver(bucket) : new LocalDriver();
  return cached;
}
