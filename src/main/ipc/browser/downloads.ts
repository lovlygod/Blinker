import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import { spacesController } from "@/controllers/spaces-controller";
import {
  chooseDownloadDirectory,
  getDownloadDirectory,
  getSessionDownloads,
  openDownloadedFile,
  resetDownloadDirectory,
  showDownloadedFileInFolder
} from "@/modules/downloads";
import {
  clearDownloadsForProfile,
  getDownloadByIdForProfile,
  listDownloadsPageForProfile,
  listRecentDownloadsForProfile,
  removeDownloadForProfile
} from "@/saving/downloads";
import type { DownloadsPageCursor } from "~/types/downloads";
import { ipcMain } from "electron";

async function profileIdFromSender(sender: Electron.WebContents): Promise<string | null> {
  const window =
    browserWindowsController.getWindowFromWebContents(sender) || browserWindowsController.getFocusedWindow();
  const spaceId = window?.currentSpaceId;
  if (!spaceId) return "default";
  const cached = spacesController.getFromCache(spaceId);
  if (cached?.profileId) return cached.profileId;
  const space = await spacesController.get(spaceId);
  return space?.profileId ?? "default";
}

ipcMain.handle("downloads:list-recent", async (event, limit?: number) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return [];
  return listRecentDownloadsForProfile(profileId, limit);
});

ipcMain.handle(
  "downloads:list-page",
  async (event, args: { search?: string; limit: number; cursor?: DownloadsPageCursor }) => {
    const profileId = await profileIdFromSender(event.sender);
    if (!profileId) return { downloads: [], nextCursor: null };
    return listDownloadsPageForProfile(profileId, args);
  }
);

ipcMain.handle("downloads:get-session", () => {
  return getSessionDownloads();
});

ipcMain.handle("downloads:open-file", async (event, id: number) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return false;
  const entry = getDownloadByIdForProfile(profileId, id);
  if (!entry) return false;
  return openDownloadedFile(entry);
});

ipcMain.handle("downloads:show-in-folder", async (event, id: number) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return false;
  const entry = getDownloadByIdForProfile(profileId, id);
  if (!entry) return false;
  return showDownloadedFileInFolder(entry);
});

ipcMain.handle("downloads:remove", async (event, id: number) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return false;
  return removeDownloadForProfile(profileId, id);
});

ipcMain.handle("downloads:clear-all", async (event) => {
  const profileId = await profileIdFromSender(event.sender);
  if (!profileId) return;
  clearDownloadsForProfile(profileId);
});

ipcMain.handle("downloads:get-directory", () => {
  return getDownloadDirectory();
});

ipcMain.handle("downloads:choose-directory", () => {
  return chooseDownloadDirectory();
});

ipcMain.handle("downloads:reset-directory", () => {
  return resetDownloadDirectory();
});
