import type { MergeReport } from "./browserMerger";

export type LocalMergeSession = { id: string; targetFileName: string; sourceFileNames: string[]; label: string | null; note: string | null; createdAt: number; report: MergeReport; output: Blob };
const DB_NAME = "archive-merge-history";
const STORE = "sessions";

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    transaction.onabort = () => reject(transaction.error);
    operation(transaction.objectStore(STORE), resolve, reject);
  });
}

export const localHistory = {
  list: () => transact<LocalMergeSession[]>("readonly", (store, resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve((request.result as LocalMergeSession[]).sort((a, b) => b.createdAt - a.createdAt)); request.onerror = () => reject(request.error); }),
  save: (session: LocalMergeSession) => transact<void>("readwrite", (store, resolve, reject) => { const request = store.put(session); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }),
  remove: (id: string) => transact<void>("readwrite", (store, resolve, reject) => { const request = store.delete(id); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }),
  update: (session: LocalMergeSession) => transact<void>("readwrite", (store, resolve, reject) => { const request = store.put(session); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }),
};
