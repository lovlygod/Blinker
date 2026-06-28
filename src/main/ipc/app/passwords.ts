import { dialog, ipcMain } from "electron";
import fs from "fs/promises";
import { tabsController } from "@/controllers/tabs-controller";
import { queuePrompt } from "@/modules/prompts";
import {
  deletePasswordForProfile,
  exportPasswordsToCsvText,
  hasSamePasswordForProfile,
  importPasswordsFromCsvText,
  listPasswordAutofillForUrl,
  listPasswordsForProfile,
  savePasswordForProfile
} from "@/saving/passwords/password-store";
import type { PasswordEntryInput, PasswordSaveCandidate } from "~/types/passwords";
import type { PromptResult, PromptState } from "~/types/prompts";

function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  const left = originFromUrl(a);
  const right = originFromUrl(b);
  return left !== null && left === right;
}

function tabFromPasswordEvent(event: Electron.IpcMainInvokeEvent) {
  return tabsController.getTabByWebContents(event.sender) ?? null;
}

ipcMain.handle("passwords:list", async (_event, profileId: string) => {
  return listPasswordsForProfile(profileId);
});

ipcMain.handle("passwords:save", async (_event, profileId: string, entry: PasswordEntryInput) => {
  return savePasswordForProfile(profileId, entry);
});

ipcMain.handle("passwords:delete", async (_event, profileId: string, id: number) => {
  return deletePasswordForProfile(profileId, id);
});

ipcMain.handle("passwords:import-csv", async (_event, profileId: string) => {
  const result = await dialog.showOpenDialog({
    title: "Импорт паролей",
    properties: ["openFile"],
    filters: [{ name: "CSV files", extensions: ["csv"] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, "utf8");
  const fileName = filePath.split(/[\\/]/).pop() ?? null;
  return importPasswordsFromCsvText(profileId, text, fileName);
});

ipcMain.handle("passwords:export-csv", async (_event, profileId: string) => {
  const result = await dialog.showSaveDialog({
    title: "Экспорт паролей",
    defaultPath: "blinker-passwords.csv",
    filters: [{ name: "CSV files", extensions: ["csv"] }]
  });

  if (result.canceled || !result.filePath) return false;

  await fs.writeFile(result.filePath, exportPasswordsToCsvText(profileId), "utf8");
  return true;
});

ipcMain.handle("passwords:get-autofill", async (event, url: string) => {
  const tab = tabFromPasswordEvent(event);
  const frameUrl = event.senderFrame?.url ?? "";
  if (!tab || !sameOrigin(frameUrl, url)) return [];
  return listPasswordAutofillForUrl(tab.profileId, url);
});

ipcMain.handle("passwords:capture-save-candidate", async (event, candidate: PasswordSaveCandidate) => {
  const tab = tabFromPasswordEvent(event);
  const frameUrl = event.senderFrame?.url ?? "";
  if (!tab || !candidate.username.trim() || !candidate.password || !sameOrigin(frameUrl, candidate.url)) return false;

  if (hasSamePasswordForProfile(tab.profileId, candidate)) {
    return true;
  }

  const isUpdate = listPasswordAutofillForUrl(tab.profileId, candidate.url).some(
    (entry) => entry.username === candidate.username.trim()
  );
  const { promise, resolve } = Promise.withResolvers<PromptResult<"save" | "never" | null>>();
  const origin = originFromUrl(candidate.url) ?? candidate.url;
  const state: PromptState = {
    id: "",
    type: "save-password",
    tabId: tab.id,
    originUrl: candidate.url,
    suppressionKey: `save-password:${tab.profileId}:${origin}:${candidate.username.trim()}`,
    candidate: {
      ...candidate,
      username: candidate.username.trim(),
      isUpdate
    },
    promise,
    resolver: resolve
  };

  queuePrompt(state, {
    cancelOnWebFrameDetach: event.senderFrame ? { webContents: event.sender, webFrame: event.senderFrame } : undefined
  });

  void promise.then((result) => {
    if (result.success && result.result === "save") {
      savePasswordForProfile(tab.profileId, {
        ...candidate,
        username: candidate.username.trim(),
        source: "Blinker"
      });
    }
  });

  return true;
});
