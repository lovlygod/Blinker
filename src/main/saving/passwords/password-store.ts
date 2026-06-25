import { and, desc, eq, or, sql } from "drizzle-orm";
import { safeStorage } from "electron";
import { getDb } from "@/saving/db";
import { passwords } from "@/saving/db/schema";
import type { PasswordAutofillEntry, PasswordEntry, PasswordEntryInput, PasswordImportResult } from "~/types/passwords";

type CsvRow = Record<string, string>;

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[\s_-]+/g, "");
}

function valueFrom(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value != null && value.trim() !== "") return value.trim();
  }
  return "";
}

function originFromUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    // Fall through to a best-effort origin.
  }
  return urlString.trim();
}

function titleFromUrl(urlString: string): string {
  try {
    return new URL(urlString).hostname;
  } catch {
    return urlString;
  }
}

function encryptPassword(password: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(password).toString("base64")}`;
  }
  return `plain:${Buffer.from(password, "utf8").toString("base64")}`;
}

function decryptPassword(encryptedPassword: string): string {
  if (encryptedPassword.startsWith("safe:")) {
    return safeStorage.decryptString(Buffer.from(encryptedPassword.slice(5), "base64"));
  }
  if (encryptedPassword.startsWith("plain:")) {
    return Buffer.from(encryptedPassword.slice(6), "base64").toString("utf8");
  }
  return encryptedPassword;
}

function toEntry(row: typeof passwords.$inferSelect): PasswordEntry {
  return {
    id: row.id,
    profileId: row.profileId,
    origin: row.origin,
    url: row.url,
    username: row.username,
    password: decryptPassword(row.encryptedPassword),
    title: row.title,
    note: row.note,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listPasswordsForProfile(profileId: string, search?: string): PasswordEntry[] {
  const q = search?.trim();
  const profileCond = eq(passwords.profileId, profileId);
  const searchCond =
    q && q.length > 0
      ? or(
          sql`instr(lower(${passwords.url}), lower(${q})) > 0`,
          sql`instr(lower(${passwords.title}), lower(${q})) > 0`,
          sql`instr(lower(${passwords.username}), lower(${q})) > 0`
        )
      : undefined;

  return getDb()
    .select()
    .from(passwords)
    .where(searchCond ? and(profileCond, searchCond) : profileCond)
    .orderBy(desc(passwords.updatedAt), desc(passwords.id))
    .all()
    .map(toEntry);
}

export function listPasswordAutofillForUrl(profileId: string, url: string): PasswordAutofillEntry[] {
  const origin = originFromUrl(url);
  return getDb()
    .select()
    .from(passwords)
    .where(and(eq(passwords.profileId, profileId), eq(passwords.origin, origin)))
    .orderBy(desc(passwords.updatedAt), desc(passwords.id))
    .all()
    .map(toEntry)
    .map((entry) => ({
      id: entry.id,
      username: entry.username,
      password: entry.password,
      title: entry.title,
      origin: entry.origin
    }));
}

export function hasSamePasswordForProfile(profileId: string, input: PasswordEntryInput): boolean {
  const origin = originFromUrl(input.url);
  const existing = getDb()
    .select()
    .from(passwords)
    .where(
      and(
        eq(passwords.profileId, profileId),
        eq(passwords.origin, origin),
        eq(passwords.username, input.username.trim())
      )
    )
    .limit(1)
    .get();
  if (!existing) return false;
  return decryptPassword(existing.encryptedPassword) === input.password;
}

export function savePasswordForProfile(profileId: string, input: PasswordEntryInput): PasswordEntry {
  const url = input.url.trim();
  const username = input.username.trim();
  const password = input.password;
  if (!url || !username || !password) {
    throw new Error("URL, username and password are required.");
  }

  const now = Date.now();
  const origin = originFromUrl(url);
  const title = input.title?.trim() || titleFromUrl(url);
  const existing = getDb()
    .select()
    .from(passwords)
    .where(and(eq(passwords.profileId, profileId), eq(passwords.origin, origin), eq(passwords.username, username)))
    .limit(1)
    .get();

  if (existing) {
    getDb()
      .update(passwords)
      .set({
        url,
        encryptedPassword: encryptPassword(password),
        title,
        note: input.note?.trim() || null,
        source: input.source?.trim() || existing.source,
        updatedAt: now
      })
      .where(eq(passwords.id, existing.id))
      .run();
    return listPasswordsForProfile(profileId).find((entry) => entry.id === existing.id)!;
  }

  const inserted = getDb()
    .insert(passwords)
    .values({
      profileId,
      origin,
      url,
      username,
      encryptedPassword: encryptPassword(password),
      title,
      note: input.note?.trim() || null,
      source: input.source?.trim() || "Blinker",
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return toEntry(inserted);
}

export function deletePasswordForProfile(profileId: string, id: number): boolean {
  const deleted = getDb()
    .delete(passwords)
    .where(and(eq(passwords.profileId, profileId), eq(passwords.id, id)))
    .returning({ id: passwords.id })
    .get();
  return deleted != null;
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) =>
    headers.reduce<CsvRow>((acc, header, index) => {
      acc[header] = values[index] ?? "";
      return acc;
    }, {})
  );
}

function detectSource(rows: CsvRow[]): string {
  const headers = new Set(Object.keys(rows[0] ?? {}));
  if (headers.has("loginuri") && headers.has("loginpassword")) return "Bitwarden";
  if (headers.has("httprealm") && headers.has("formactionorigin")) return "Firefox";
  if (headers.has("grouping") && headers.has("extra")) return "LastPass";
  if (headers.has("website") && headers.has("title")) return "1Password";
  if (headers.has("otpauth")) return "Safari";
  if (headers.has("name") && headers.has("url") && headers.has("password")) return "Chromium";
  return "CSV";
}

function rowToPasswordInput(row: CsvRow, source: string): PasswordEntryInput | null {
  const url = valueFrom(row, ["url", "login_uri", "website", "uri", "domain"]);
  const username = valueFrom(row, ["username", "login_username", "user", "email", "login"]);
  const password = valueFrom(row, ["password", "login_password"]);
  if (!url || !username || !password) return null;

  return {
    url,
    username,
    password,
    title: valueFrom(row, ["name", "title"]) || titleFromUrl(url),
    note: valueFrom(row, ["note", "notes", "extra"]) || null,
    source
  };
}

export function importPasswordsFromCsvText(
  profileId: string,
  text: string,
  fileName: string | null
): PasswordImportResult {
  const rows = parseCsv(text);
  const source = detectSource(rows);
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const row of rows) {
    const input = rowToPasswordInput(row, source);
    if (!input) {
      skipped++;
      continue;
    }

    const origin = originFromUrl(input.url);
    const existing = getDb()
      .select({ id: passwords.id })
      .from(passwords)
      .where(
        and(eq(passwords.profileId, profileId), eq(passwords.origin, origin), eq(passwords.username, input.username))
      )
      .limit(1)
      .get();

    savePasswordForProfile(profileId, input);
    if (existing) updated++;
    else imported++;
  }

  return { imported, skipped, updated, source, fileName };
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportPasswordsToCsvText(profileId: string): string {
  const rows = listPasswordsForProfile(profileId);
  const header = ["name", "url", "username", "password", "note"];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((entry) =>
      [entry.title || titleFromUrl(entry.url), entry.url, entry.username, entry.password, entry.note ?? ""]
        .map(csvCell)
        .join(",")
    )
  ];
  return `${lines.join("\r\n")}\r\n`;
}
