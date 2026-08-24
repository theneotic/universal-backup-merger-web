import { and, desc, eq, gte, isNotNull, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertMergeSession, InsertUser, mergeSessions, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createMergeSession(session: InsertMergeSession) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(mergeSessions).values(session);
  return { id: session.id };
}

export type MergeHistoryFilters = {
  query?: string;
  metadata?: "all" | "labeled" | "noted";
  range?: "all" | "30d" | "90d";
};

export async function listMergeSessions(userId: number, filters: MergeHistoryFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(mergeSessions.userId, userId)];
  const query = filters.query?.trim();
  if (query) {
    const term = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(
      like(mergeSessions.label, term),
      like(mergeSessions.note, term),
      like(mergeSessions.targetFileName, term),
      like(mergeSessions.sourceFileNames, term),
    )!);
  }
  if (filters.metadata === "labeled") conditions.push(isNotNull(mergeSessions.label));
  if (filters.metadata === "noted") conditions.push(isNotNull(mergeSessions.note));
  if (filters.range === "30d" || filters.range === "90d") {
    const days = filters.range === "30d" ? 30 : 90;
    conditions.push(gte(mergeSessions.createdAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
  }
  return db.select().from(mergeSessions).where(and(...conditions)).orderBy(desc(mergeSessions.createdAt)).limit(50);
}

export async function getMergeSessionForUser(id: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(mergeSessions).where(and(eq(mergeSessions.id, id), eq(mergeSessions.userId, userId))).limit(1);
  return rows[0];
}

export async function deleteMergeSessionForUser(id: string, userId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.delete(mergeSessions).where(and(eq(mergeSessions.id, id), eq(mergeSessions.userId, userId)));
  return result[0]?.affectedRows === 1;
}

export async function updateMergeSessionMetadataForUser(id: string, userId: number, metadata: { label: string | null; note: string | null }) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(mergeSessions).set(metadata).where(and(eq(mergeSessions.id, id), eq(mergeSessions.userId, userId)));
  return result[0]?.affectedRows === 1;
}
