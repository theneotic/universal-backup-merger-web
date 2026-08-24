import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const mergeSessions = mysqlTable("merge_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: int("user_id").references(() => users.id),
  visitorId: varchar("visitor_id", { length: 64 }).notNull(),
  targetFileName: varchar("target_file_name", { length: 500 }).notNull(),
  label: varchar("label", { length: 100 }),
  note: text("note"),
  sourceFileNames: text("source_file_names").notNull(),
  outputKey: varchar("output_key", { length: 1000 }),
  outputUrl: varchar("output_url", { length: 1200 }),
  reportJson: text("report_json").notNull(),
  status: mysqlEnum("status", ["success", "failed"]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [index("merge_sessions_visitor_idx").on(table.visitorId)]);

export type MergeSession = typeof mergeSessions.$inferSelect;
export type InsertMergeSession = typeof mergeSessions.$inferInsert;
