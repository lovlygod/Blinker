import path from "path";
import { existsSync, mkdirSync } from "fs";
import { app, dialog, shell, type DownloadItem, type Session, type WebContents } from "electron";
import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import { spacesController } from "@/controllers/spaces-controller";
import { getSettingValueById, setSettingValueById } from "@/saving/settings";
import {
  createDownload,
  getDownloadByIdForProfile,
  listRecentDownloadsForProfile,
  updateDownload
} from "@/saving/downloads";
import { sendMessageToListeners } from "@/ipc/listeners-manager";
import type { DownloadEntry } from "~/types/downloads";

const sessionDownloadIds = new Set<number>();
const registeredDownloadSessions = new WeakSet<Session>();
const activeDownloads = new Map<
  number,
  {
    item: DownloadItem;
    lastBytes: number;
    lastMeasuredAt: number;
    speedBytesPerSecond: number;
  }
>();

function getSafeFilename(item: DownloadItem) {
  const name = item.getFilename() || "download";
  return path.basename(name);
}

export function getDownloadDirectory(): string {
  const saved = getSettingValueById("downloadDirectory");
  if (typeof saved === "string" && saved.trim()) {
    return saved;
  }
  return app.getPath("downloads");
}

export async function chooseDownloadDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose downloads folder",
    defaultPath: getDownloadDirectory(),
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  await setSettingValueById("downloadDirectory", result.filePaths[0]);
  return result.filePaths[0];
}

export async function resetDownloadDirectory(): Promise<string> {
  const defaultPath = app.getPath("downloads");
  await setSettingValueById("downloadDirectory", defaultPath);
  return defaultPath;
}

export function getSessionDownloads(): DownloadEntry[] {
  const rows: DownloadEntry[] = [];
  for (const id of sessionDownloadIds) {
    const row = getDownloadByIdAnyProfile(id);
    if (row) rows.push(enrichDownload(row));
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
}

export function enrichDownload(entry: DownloadEntry): DownloadEntry {
  const active = activeDownloads.get(entry.id);
  if (!active) return entry;

  const totalBytes = entry.totalBytes || active.item.getTotalBytes();
  const receivedBytes = entry.receivedBytes || active.item.getReceivedBytes();
  const remainingBytes = Math.max(0, totalBytes - receivedBytes);
  const etaSeconds =
    totalBytes > 0 && active.speedBytesPerSecond > 0
      ? Math.max(0, Math.ceil(remainingBytes / active.speedBytesPerSecond))
      : null;

  return {
    ...entry,
    totalBytes,
    receivedBytes,
    canResume: active.item.canResume(),
    speedBytesPerSecond: entry.state === "progressing" ? active.speedBytesPerSecond : 0,
    etaSeconds
  };
}

function getDownloadByIdAnyProfile(id: number): DownloadEntry | null {
  for (const window of browserWindowsController.getWindows()) {
    const spaceId = window.currentSpaceId;
    const profileId = spaceId ? spacesController.getFromCache(spaceId)?.profileId : undefined;
    if (!profileId) continue;
    const row = getDownloadByIdForProfile(profileId, id);
    if (row) return row;
  }
  return null;
}

function getProfileIdFromWebContents(webContents: WebContents): string {
  const window =
    browserWindowsController.getWindowFromWebContents(webContents) || browserWindowsController.getFocusedWindow();
  const spaceId = window?.currentSpaceId;
  if (!spaceId) return "default";

  const cached = spacesController.getFromCache(spaceId);
  if (cached?.profileId) return cached.profileId;
  return "default";
}

function emitDownloadsChanged(download?: DownloadEntry) {
  sendMessageToListeners("downloads:on-changed", getSessionDownloads());
  if (download) {
    sendMessageToListeners("downloads:on-created", download);
  }
}

function uniqueDownloadPath(directory: string, filename: string) {
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename);
  let counter = 1;

  while (existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${counter})${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

export function registerDownloadHandlingForSession(session: Session) {
  if (registeredDownloadSessions.has(session)) return;
  registeredDownloadSessions.add(session);

  session.on("will-download", (_event, item, webContents) => {
    registerDownloadHandling(item, webContents);
  });
}

function registerDownloadHandling(item: DownloadItem, webContents: WebContents) {
  const profileId = getProfileIdFromWebContents(webContents);
  const filename = getSafeFilename(item);
  const downloadDirectory = getDownloadDirectory();

  mkdirSync(downloadDirectory, { recursive: true });

  const savePath = uniqueDownloadPath(downloadDirectory, filename);
  item.setSavePath(savePath);

  const now = Date.now();
  const created = createDownload({
    profileId,
    url: item.getURL(),
    referrer: null,
    filename,
    mimeType: item.getMimeType() || null,
    path: savePath,
    totalBytes: item.getTotalBytes(),
    receivedBytes: item.getReceivedBytes(),
    state: "progressing",
    dangerType: null,
    errorMessage: null,
    startedAt: now,
    finishedAt: null,
    updatedAt: now
  });

  sessionDownloadIds.add(created.id);
  activeDownloads.set(created.id, {
    item,
    lastBytes: item.getReceivedBytes(),
    lastMeasuredAt: now,
    speedBytesPerSecond: 0
  });
  emitDownloadsChanged(created);

  item.on("updated", (_event, state) => {
    const active = activeDownloads.get(created.id);
    const measuredAt = Date.now();
    const receivedBytes = item.getReceivedBytes();
    if (active) {
      const elapsedMs = Math.max(1, measuredAt - active.lastMeasuredAt);
      const deltaBytes = Math.max(0, receivedBytes - active.lastBytes);
      active.speedBytesPerSecond = Math.round((deltaBytes / elapsedMs) * 1000);
      active.lastBytes = receivedBytes;
      active.lastMeasuredAt = measuredAt;
    }

    const updated = updateDownload(created.id, {
      receivedBytes,
      totalBytes: item.getTotalBytes(),
      state: state === "interrupted" ? "interrupted" : "progressing",
      dangerType: null,
      errorMessage: state === "interrupted" ? "Download interrupted" : null
    });
    if (updated) emitDownloadsChanged(enrichDownload(updated));
  });

  item.once("done", (_event, state) => {
    const finalState = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
    const errorMessage =
      finalState === "interrupted"
        ? `Download interrupted${item.canResume() ? ". You can resume it." : ". Try downloading again."}`
        : finalState === "cancelled"
          ? "Download cancelled"
          : null;
    const updated = updateDownload(created.id, {
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: finalState,
      finishedAt: Date.now(),
      path: item.getSavePath() || savePath,
      filename: path.basename(item.getSavePath() || savePath),
      dangerType: null,
      errorMessage
    });
    activeDownloads.delete(created.id);
    if (updated) emitDownloadsChanged(updated);
  });
}

export function pauseDownload(entry: DownloadEntry): boolean {
  const active = activeDownloads.get(entry.id);
  if (!active || entry.state !== "progressing") return false;
  active.item.pause();
  const updated = updateDownload(entry.id, { state: "paused", errorMessage: null });
  if (updated) emitDownloadsChanged(enrichDownload(updated));
  return true;
}

export function resumeDownload(entry: DownloadEntry): boolean {
  const active = activeDownloads.get(entry.id);
  if (!active) return false;

  if (!active.item.canResume()) {
    const updated = updateDownload(entry.id, {
      state: "interrupted",
      errorMessage: "This download cannot be resumed. Try downloading it again."
    });
    if (updated) emitDownloadsChanged(updated);
    return false;
  }

  active.item.resume();
  const updated = updateDownload(entry.id, { state: "progressing", errorMessage: null });
  if (updated) emitDownloadsChanged(enrichDownload(updated));
  return true;
}

export function cancelDownload(entry: DownloadEntry): boolean {
  const active = activeDownloads.get(entry.id);
  if (!active || (entry.state !== "progressing" && entry.state !== "paused")) return false;
  active.item.cancel();
  const updated = updateDownload(entry.id, {
    state: "cancelled",
    finishedAt: Date.now(),
    errorMessage: "Download cancelled"
  });
  activeDownloads.delete(entry.id);
  if (updated) emitDownloadsChanged(updated);
  return true;
}

export function retryDownload(entry: DownloadEntry, webContents: WebContents): boolean {
  if (!entry.url) return false;
  webContents.downloadURL(entry.url);
  return true;
}

export async function openDownloadedFile(entry: DownloadEntry): Promise<boolean> {
  if (!entry.exists) return false;
  const error = await shell.openPath(entry.path);
  return !error;
}

export function showDownloadedFileInFolder(entry: DownloadEntry): boolean {
  if (!entry.exists) return false;
  shell.showItemInFolder(entry.path);
  return true;
}

export function getRecentDownloadsForCurrentWindow(webContents: WebContents, limit?: number) {
  const window =
    browserWindowsController.getWindowFromWebContents(webContents) || browserWindowsController.getFocusedWindow();
  const spaceId = window?.currentSpaceId;
  const profileId = spaceId ? spacesController.getFromCache(spaceId)?.profileId : undefined;
  return listRecentDownloadsForProfile(profileId ?? "default", limit);
}
