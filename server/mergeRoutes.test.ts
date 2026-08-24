import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getMergeSessionForUser: vi.fn(),
  storageGetSignedUrl: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticateRequest } }));
vi.mock("./db", () => ({
  createMergeSession: vi.fn(),
  getMergeSessionForUser: mocks.getMergeSessionForUser,
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn(),
  storageGetSignedUrl: mocks.storageGetSignedUrl,
}));

import { registerMergeRoutes } from "./mergeRoutes";

const owner = {
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

function app() {
  const instance = express();
  registerMergeRoutes(instance);
  return instance;
}

describe("protected cloud backup downloads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated download requests", async () => {
    mocks.authenticateRequest.mockRejectedValueOnce(new Error("missing session"));
    const response = await request(app()).get("/api/merge/session-1/download");
    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Sign in");
  });

  it("creates a signed download redirect only for the authenticated owner", async () => {
    mocks.authenticateRequest.mockResolvedValueOnce(owner);
    mocks.getMergeSessionForUser.mockResolvedValueOnce({ id: "owned-session", outputKey: "merge-outputs/user-73/owned.backup" });
    mocks.storageGetSignedUrl.mockResolvedValueOnce("https://storage.example.test/signed-output");
    const response = await request(app()).get("/api/merge/owned-session/download");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://storage.example.test/signed-output");
    expect(mocks.getMergeSessionForUser).toHaveBeenCalledWith("owned-session", 73);
  });

  it("does not expose a download URL for a session outside the account scope", async () => {
    mocks.authenticateRequest.mockResolvedValueOnce(owner);
    mocks.getMergeSessionForUser.mockResolvedValueOnce(undefined);
    const response = await request(app()).get("/api/merge/other-users-session/download");
    expect(response.status).toBe(404);
    expect(mocks.storageGetSignedUrl).not.toHaveBeenCalled();
  });
});
