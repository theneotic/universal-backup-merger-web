import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  listMergeSessions: vi.fn(),
  deleteMergeSessionForUser: vi.fn(),
  updateMergeSessionMetadataForUser: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listMergeSessions: dbMocks.listMergeSessions,
    deleteMergeSessionForUser: dbMocks.deleteMergeSessionForUser,
    updateMergeSessionMetadataForUser: dbMocks.updateMergeSessionMetadataForUser,
  };
});

import { appRouter } from "./routers";

function context(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const signedInUser = {
  id: 73,
  openId: "account-73",
  email: "account@example.com",
  name: "Account Holder",
  loginMethod: "manus",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("account-scoped merge history", () => {
  it("requires authentication to view saved cloud merges", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.merge.history()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires authentication to remove a saved cloud merge", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.merge.remove({ id: "session-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requests history only for the signed-in owner", async () => {
    dbMocks.listMergeSessions.mockResolvedValueOnce([]);
    const caller = appRouter.createCaller(context(signedInUser));
    await caller.merge.history();
    expect(dbMocks.listMergeSessions).toHaveBeenCalledWith(73, {});
  });

  it("forwards cloud history search and filters only with the signed-in owner ID", async () => {
    dbMocks.listMergeSessions.mockResolvedValueOnce([]);
    const caller = appRouter.createCaller(context(signedInUser));
    await caller.merge.history({ query: "summer", metadata: "labeled", range: "30d" });
    expect(dbMocks.listMergeSessions).toHaveBeenCalledWith(73, { query: "summer", metadata: "labeled", range: "30d" });
  });

  it("requires authentication before searching account merge history", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.merge.history({ query: "private", metadata: "all", range: "all" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("removes a saved merge only through the signed-in owner ID", async () => {
    dbMocks.deleteMergeSessionForUser.mockResolvedValueOnce(true);
    const caller = appRouter.createCaller(context(signedInUser));
    await expect(caller.merge.remove({ id: "owned-session" })).resolves.toEqual({ success: true });
    expect(dbMocks.deleteMergeSessionForUser).toHaveBeenCalledWith("owned-session", 73);
  });

  it("requires authentication to update custom merge details", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.merge.updateMetadata({ id: "session-1", label: "Archive", note: "Before cleanup" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("updates labels and notes only through the signed-in owner ID", async () => {
    dbMocks.updateMergeSessionMetadataForUser.mockResolvedValueOnce(true);
    const caller = appRouter.createCaller(context(signedInUser));
    await expect(caller.merge.updateMetadata({ id: "owned-session", label: "Summer archive", note: "Keep this version before curation." })).resolves.toEqual({ success: true });
    expect(dbMocks.updateMergeSessionMetadataForUser).toHaveBeenCalledWith("owned-session", 73, {
      label: "Summer archive",
      note: "Keep this version before curation.",
    });
  });
});
