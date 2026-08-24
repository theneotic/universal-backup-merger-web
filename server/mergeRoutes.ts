import type { Express, Request, Response } from "express";
import multer from "multer";
import { createMergeSession, getMergeSessionForUser } from "./db";
import { inspectBackups, mergeBackups, outputName, type UploadedBackup } from "./mergeService";
import { storageGetSignedUrl, storagePut } from "./storage";
import { sdk } from "./_core/sdk";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, callback) => callback(null, /\.(backup|zip)$/i.test(file.originalname)),
});

function uploadedFiles(req: Request): UploadedBackup[] {
  const files = (req.files ?? []) as Express.Multer.File[];
  return files.map(file => ({ name: file.originalname, buffer: file.buffer }));
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "validating: The merge could not be completed.";
  res.status(400).json({ error: message });
}

async function requireAccount(req: Request, res: Response) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    user = null;
  }
  if (!user) {
    res.status(401).json({ error: "Sign in to save and manage your cloud merge history." });
    return null;
  }
  return user;
}

export function registerMergeRoutes(app: Express) {
  app.post("/api/merge/inspect", upload.array("files", 6), async (req, res) => {
    try {
      res.json({ files: await inspectBackups(uploadedFiles(req)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/merge", upload.array("files", 6), async (req, res) => {
    const user = await requireAccount(req, res);
    if (!user) return;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    const emit = (payload: Record<string, unknown>) => res.write(`${JSON.stringify(payload)}\n`);
    try {
      const result = await mergeBackups(uploadedFiles(req), stage => emit({ event: "stage", stage }));
      const filename = outputName();
      const stored = await storagePut(`merge-outputs/user-${user.id}/${filename}`, result.output, "application/octet-stream");
      const session = await createMergeSession({
        id: crypto.randomUUID(),
        userId: user.id,
        visitorId: `account-${user.id}`,
        targetFileName: result.report.targetFileName,
        sourceFileNames: JSON.stringify(result.report.sourceFileNames),
        outputKey: stored.key,
        outputUrl: stored.url,
        reportJson: JSON.stringify(result.report),
        status: "success",
      });
      emit({ event: "result", result: { ...result.report, downloadUrl: `/api/merge/${session?.id}/download`, historyId: session?.id ?? null } });
      res.end();
    } catch (error) {
      emit({ event: "error", error: error instanceof Error ? error.message : "validating: The merge could not be completed." });
      res.end();
    }
  });

  app.get("/api/merge/:id/download", async (req, res) => {
    const user = await requireAccount(req, res);
    if (!user) return;
    const session = await getMergeSessionForUser(req.params.id, user.id);
    if (!session?.outputKey) {
      res.status(404).json({ error: "The requested cloud backup is not available." });
      return;
    }
    try {
      res.redirect(302, await storageGetSignedUrl(session.outputKey));
    } catch {
      res.status(500).json({ error: "The requested cloud backup could not be prepared for download." });
    }
  });

  app.use((error: any, _req: Request, res: Response, next: () => void) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: `uploading: ${error.code === "LIMIT_FILE_SIZE" ? "Each file must be 60 MB or smaller." : "Too many files were uploaded."}` });
    }
    return next();
  });
}
