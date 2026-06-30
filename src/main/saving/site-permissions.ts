import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/saving/db";
import { sitePermissions } from "@/saving/db/schema";
import type { SitePermissionEntry, SitePermissionInput, SitePermissionSetting } from "~/types/site-permissions";

function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function toEntry(row: typeof sitePermissions.$inferSelect): SitePermissionEntry {
  return {
    id: row.id,
    profileId: row.profileId,
    origin: row.origin,
    permission: row.permission,
    setting: row.setting,
    updatedAt: row.updatedAt
  };
}

export function normalizePermissionOrigin(originOrUrl: string): string {
  return originFromUrl(originOrUrl) ?? originOrUrl.trim();
}

export function listSitePermissionsForProfile(profileId: string): SitePermissionEntry[] {
  return getDb()
    .select()
    .from(sitePermissions)
    .where(eq(sitePermissions.profileId, profileId))
    .orderBy(desc(sitePermissions.updatedAt), desc(sitePermissions.id))
    .all()
    .map(toEntry);
}

export function getSitePermissionSetting(
  profileId: string,
  originOrUrl: string,
  permission: string
): SitePermissionSetting | null {
  const origin = normalizePermissionOrigin(originOrUrl);
  if (!origin) return null;
  const row = getDb()
    .select()
    .from(sitePermissions)
    .where(
      and(
        eq(sitePermissions.profileId, profileId),
        eq(sitePermissions.origin, origin),
        eq(sitePermissions.permission, permission)
      )
    )
    .limit(1)
    .get();
  return row?.setting ?? null;
}

export function setSitePermissionForProfile(profileId: string, input: SitePermissionInput): SitePermissionEntry {
  const origin = normalizePermissionOrigin(input.origin);
  const permission = input.permission.trim();
  if (!origin || !permission) throw new Error("Origin and permission are required.");

  const now = Date.now();
  const existing = getDb()
    .select()
    .from(sitePermissions)
    .where(
      and(
        eq(sitePermissions.profileId, profileId),
        eq(sitePermissions.origin, origin),
        eq(sitePermissions.permission, permission)
      )
    )
    .limit(1)
    .get();

  if (existing) {
    getDb()
      .update(sitePermissions)
      .set({ setting: input.setting, updatedAt: now })
      .where(eq(sitePermissions.id, existing.id))
      .run();
    const updated = getDb().select().from(sitePermissions).where(eq(sitePermissions.id, existing.id)).get();
    return toEntry(updated!);
  }

  const inserted = getDb()
    .insert(sitePermissions)
    .values({
      profileId,
      origin,
      permission,
      setting: input.setting,
      updatedAt: now
    })
    .returning()
    .get();

  return toEntry(inserted);
}

export function deleteSitePermissionForProfile(profileId: string, id: number): boolean {
  const deleted = getDb()
    .delete(sitePermissions)
    .where(and(eq(sitePermissions.profileId, profileId), eq(sitePermissions.id, id)))
    .returning({ id: sitePermissions.id })
    .get();
  return deleted != null;
}

export function clearSitePermissionsForProfile(profileId: string): void {
  getDb().delete(sitePermissions).where(eq(sitePermissions.profileId, profileId)).run();
}
