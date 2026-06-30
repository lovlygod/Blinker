import { dialog, ipcMain } from "electron";
import fs from "fs/promises";
import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import { spacesController } from "@/controllers/spaces-controller";
import {
  deleteBookmarkForProfile,
  deleteBookmarkForProfileUrl,
  exportBookmarksToHtml,
  getBookmarkForProfileUrl,
  importBookmarksFromHtml,
  listBookmarksForProfile,
  saveBookmarkForProfile
} from "@/saving/bookmarks";
import type { BookmarkInput } from "~/types/bookmarks";

async function profileIdFromSender(sender: Electron.WebContents): Promise<string | null> {
  const window = browserWindowsController.getWindowFromWebContents(sender);
  if (!window) return null;
  const spaceId = window.currentSpaceId;
  if (!spaceId) return null;
  const space = await spacesController.get(spaceId);
  return space?.profileId ?? null;
}

ipcMain.handle("bookmarks:list", async (event) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return [];
  return listBookmarksForProfile(profileId);
});

ipcMain.handle("bookmarks:get-for-url", async (event, url: string) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return null;
  return getBookmarkForProfileUrl(profileId, url);
});

ipcMain.handle("bookmarks:save", async (event, bookmark: BookmarkInput) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return null;
  return saveBookmarkForProfile(profileId, bookmark);
});

ipcMain.handle("bookmarks:delete", async (event, id: number) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return false;
  return deleteBookmarkForProfile(profileId, id);
});

ipcMain.handle("bookmarks:delete-for-url", async (event, url: string) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return false;
  return deleteBookmarkForProfileUrl(profileId, url);
});

ipcMain.handle("bookmarks:import-html", async (event) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return null;

  const result = await dialog.showOpenDialog({
    title: "Импорт закладок",
    properties: ["openFile"],
    filters: [{ name: "Bookmark HTML", extensions: ["html", "htm"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const html = await fs.readFile(result.filePaths[0], "utf8");
  return importBookmarksFromHtml(profileId, html);
});

ipcMain.handle("bookmarks:export-html", async (event) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return false;

  const result = await dialog.showSaveDialog({
    title: "Экспорт закладок",
    defaultPath: "blinker-bookmarks.html",
    filters: [{ name: "Bookmark HTML", extensions: ["html"] }]
  });
  if (result.canceled || !result.filePath) return false;

  await fs.writeFile(result.filePath, exportBookmarksToHtml(profileId), "utf8");
  return true;
});
