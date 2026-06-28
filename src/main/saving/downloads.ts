import { and, desc, eq, like, lt, or } from "drizzle-orm";
import fs from "fs";
import { getDb } from "@/saving/db";
import { downloads, type DownloadInsert, type DownloadRow } from "@/saving/db/schema";
import type { DownloadEntry, DownloadsPage, DownloadsPageCursor, DownloadState } from "~/types/downloads";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

function withExistence(row: DownloadRow): DownloadEntry {
  return {
    id: row.id,
    profileId: row.profileId,
    url: row.url,
    referrer: row.referrer,
    filename: row.filename,
    mimeType: row.mimeType,
    path: row.path,
    totalBytes: row.totalBytes,
    receivedBytes: row.receivedBytes,
    state: row.state,
    dangerType: row.dangerType,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    updatedAt: row.updatedAt,
    exists: fs.existsSync(row.path)
  };
}

export function createDownload(entry: Omit<DownloadInsert, "id">): DownloadEntry {
  const inserted = getDb().insert(downloads).values(entry).returning().get();
  return withExistence(inserted);
}

export function updateDownload(
  id: number,
  patch: Partial<{
    receivedBytes: number;
    totalBytes: number;
    state: DownloadState;
    finishedAt: number | null;
    path: string;
    filename: string;
    dangerType: string | null;
  }>
): DownloadEntry | null {
  const updated = getDb()
    .update(downloads)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(downloads.id, id))
    .returning()
    .get();
  return updated ? withExistence(updated) : null;
}

export function getDownloadByIdForProfile(profileId: string, id: number): DownloadEntry | null {
  const row = getDb()
    .select()
    .from(downloads)
    .where(and(eq(downloads.profileId, profileId), eq(downloads.id, id)))
    .limit(1)
    .get();
  return row ? withExistence(row) : null;
}

export function listRecentDownloadsForProfile(profileId: string, limit = 20): DownloadEntry[] {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return getDb()
    .select()
    .from(downloads)
    .where(eq(downloads.profileId, profileId))
    .orderBy(desc(downloads.startedAt), desc(downloads.id))
    .limit(safeLimit)
    .all()
    .map(withExistence);
}

export function listDownloadsPageForProfile(
  profileId: string,
  args: { search?: string; limit?: number; cursor?: DownloadsPageCursor }
): DownloadsPage {
  const q = args.search?.trim();
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const conditions = [eq(downloads.profileId, profileId)];
  if (q) {
    conditions.push(or(like(downloads.filename, `%${q}%`), like(downloads.url, `%${q}%`))!);
  }
  if (args.cursor) {
    conditions.push(
      or(
        lt(downloads.startedAt, args.cursor.startedAt),
        and(eq(downloads.startedAt, args.cursor.startedAt), lt(downloads.id, args.cursor.id))
      )!
    );
  }

  const rows = getDb()
    .select()
    .from(downloads)
    .where(and(...conditions))
    .orderBy(desc(downloads.startedAt), desc(downloads.id))
    .limit(limit + 1)
    .all();

  const slice = rows.length > limit ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];

  return {
    downloads: slice.map(withExistence),
    nextCursor: rows.length > limit && last ? { startedAt: last.startedAt, id: last.id } : null
  };
}

export function removeDownloadForProfile(profileId: string, id: number): boolean {
  const deleted = getDb()
    .delete(downloads)
    .where(and(eq(downloads.profileId, profileId), eq(downloads.id, id)))
    .run();
  return deleted.changes > 0;
}

export function clearDownloadsForProfile(profileId: string): void {
  getDb().delete(downloads).where(eq(downloads.profileId, profileId)).run();
}
