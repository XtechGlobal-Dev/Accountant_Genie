import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from the platform, no dependency.
 *
 * Stored as `scrypt$N$salt$hash` so the parameters travel with the hash and
 * can be raised later without invalidating existing passwords.
 */

const KEY_LENGTH = 64;
const COST = 16_384;

function derive(password: string, salt: string, length: number, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { N: cost }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await derive(password, salt, KEY_LENGTH, COST);
  return `scrypt$${COST}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, cost, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !cost || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, salt, expected.length, Number(cost));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A password a person can be handed once — for invitations. */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
