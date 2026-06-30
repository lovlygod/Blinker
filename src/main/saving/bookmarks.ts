import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/saving/db";
import { bookmarks } from "@/saving/db/schema";
import type { BookmarkEntry, BookmarkInput } from "~/types/bookmarks";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "blinker:") {
      return parsed.toString();
    }
  } catch {
    // Keep the original value and let callers decide whether it is useful.
  }
  return trimmed;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function toEntry(row: typeof bookmarks.$inferSelect): BookmarkEntry {
  return {
    id: row.id,
    profileId: row.profileId,
    url: row.url,
    title: row.title,
    folder: row.folder,
    faviconUrl: row.faviconUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listBookmarksForProfile(profileId: string, search?: string): BookmarkEntry[] {
  const q = search?.trim();
  const profileCond = eq(bookmarks.profileId, profileId);
  const searchCond =
    q && q.length > 0
      ? sql`instr(lower(${bookmarks.url}), lower(${q})) > 0 OR instr(lower(${bookmarks.title}), lower(${q})) > 0 OR instr(lower(${bookmarks.folder}), lower(${q})) > 0`
      : undefined;

  return getDb()
    .select()
    .from(bookmarks)
    .where(searchCond ? and(profileCond, searchCond) : profileCond)
    .orderBy(desc(bookmarks.updatedAt), desc(bookmarks.id))
    .all()
    .map(toEntry);
}

export function getBookmarkForProfileUrl(profileId: string, url: string): BookmarkEntry | null {
  const normalized = normalizeUrl(url);
  const row = getDb()
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.url, normalized)))
    .limit(1)
    .get();
  return row ? toEntry(row) : null;
}

export function saveBookmarkForProfile(profileId: string, input: BookmarkInput): BookmarkEntry {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error("Bookmark URL is required.");

  const now = Date.now();
  const existing = getDb()
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.url, url)))
    .limit(1)
    .get();

  const title = input.title.trim() || titleFromUrl(url);
  const folder = input.folder?.trim() || "Bookmarks bar";

  if (existing) {
    getDb()
      .update(bookmarks)
      .set({
        title,
        folder,
        faviconUrl: input.faviconUrl ?? existing.faviconUrl,
        updatedAt: now
      })
      .where(eq(bookmarks.id, existing.id))
      .run();
    return getBookmarkForProfileUrl(profileId, url)!;
  }

  const inserted = getDb()
    .insert(bookmarks)
    .values({
      profileId,
      url,
      title,
      folder,
      faviconUrl: input.faviconUrl ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();

  return toEntry(inserted);
}

export function deleteBookmarkForProfile(profileId: string, id: number): boolean {
  const deleted = getDb()
    .delete(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.id, id)))
    .returning({ id: bookmarks.id })
    .get();
  return deleted != null;
}

export function deleteBookmarkForProfileUrl(profileId: string, url: string): boolean {
  const normalized = normalizeUrl(url);
  const deleted = getDb()
    .delete(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.url, normalized)))
    .returning({ id: bookmarks.id })
    .get();
  return deleted != null;
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function exportBookmarksToHtml(profileId: string): string {
  const entries = listBookmarksForProfile(profileId);
  const lines = entries.map((entry) => {
    const created = Math.floor(entry.createdAt / 1000);
    const icon = entry.faviconUrl ? ` ICON="${htmlEscape(entry.faviconUrl)}"` : "";
    return `        <DT><A HREF="${htmlEscape(entry.url)}" ADD_DATE="${created}"${icon}>${htmlEscape(entry.title)}</A>`;
  });

  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    '    <DT><H3 ADD_DATE="0" LAST_MODIFIED="0">Bookmarks bar</H3>',
    "    <DL><p>",
    ...lines,
    "    </DL><p>",
    "</DL><p>",
    ""
  ].join("\n");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function importBookmarksFromHtml(profileId: string, html: string): number {
  const anchorPattern = /<A\s+[^>]*HREF=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>(.*?)<\/A>/gis;
  let imported = 0;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html))) {
    const url = decodeHtmlEntities(match[1] || match[2] || match[3] || "");
    const title = decodeHtmlEntities(match[4].replace(/<[^>]+>/g, "").trim());
    if (!url) continue;
    saveBookmarkForProfile(profileId, {
      url,
      title: title || titleFromUrl(url)
    });
    imported++;
  }

  return imported;
}
