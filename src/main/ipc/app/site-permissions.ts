import { ipcMain } from "electron";
import {
  clearSitePermissionsForProfile,
  deleteSitePermissionForProfile,
  listSitePermissionsForProfile,
  setSitePermissionForProfile
} from "@/saving/site-permissions";
import type { SitePermissionInput } from "~/types/site-permissions";

ipcMain.handle("site-permissions:list", async (_event, profileId: string) => {
  return listSitePermissionsForProfile(profileId);
});

ipcMain.handle("site-permissions:set", async (_event, profileId: string, input: SitePermissionInput) => {
  return setSitePermissionForProfile(profileId, input);
});

ipcMain.handle("site-permissions:remove", async (_event, profileId: string, id: number) => {
  return deleteSitePermissionForProfile(profileId, id);
});

ipcMain.handle("site-permissions:clear", async (_event, profileId: string) => {
  clearSitePermissionsForProfile(profileId);
});
