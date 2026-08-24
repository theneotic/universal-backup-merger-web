import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { deleteMergeSessionForUser, listMergeSessions, updateMergeSessionMetadataForUser } from "./db";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  merge: router({
    history: protectedProcedure.input(z.object({
      query: z.string().trim().max(100).optional(),
      metadata: z.enum(["all", "labeled", "noted"]).default("all"),
      range: z.enum(["all", "30d", "90d"]).default("all"),
    }).optional()).query(async ({ ctx, input }) => {
      const sessions = await listMergeSessions(ctx.user.id, input ?? {});
      return sessions.map(session => ({
        id: session.id,
        targetFileName: session.targetFileName,
        label: session.label,
        note: session.note,
        sourceFileNames: JSON.parse(session.sourceFileNames) as string[],
        outputUrl: `/api/merge/${session.id}/download`,
        status: session.status,
        createdAt: session.createdAt,
        report: JSON.parse(session.reportJson),
      }));
    }),
    remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const removed = await deleteMergeSessionForUser(input.id, ctx.user.id);
      if (!removed) throw new Error("Saved merge not found.");
      return { success: true } as const;
    }),
    updateMetadata: protectedProcedure.input(z.object({
      id: z.string().min(1),
      label: z.string().trim().max(100).nullable(),
      note: z.string().trim().max(1000).nullable(),
    })).mutation(async ({ ctx, input }) => {
      const updated = await updateMergeSessionMetadataForUser(input.id, ctx.user.id, {
        label: input.label || null,
        note: input.note || null,
      });
      if (!updated) throw new Error("Saved merge not found.");
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
