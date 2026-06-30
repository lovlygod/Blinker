import { tabsController } from "@/controllers/tabs-controller";
import { sendMessageToListeners } from "@/ipc/listeners-manager";
import { debugPrint } from "@/modules/output";
import { queuePrompt } from "@/modules/prompts";
import { setAlwaysOpenExternal, shouldAlwaysOpenExternal } from "@/saving/open-external";
import { getSitePermissionSetting, setSitePermissionForProfile } from "@/saving/site-permissions";
import { app, dialog, OpenExternalPermissionRequest, type Session } from "electron";
import type { PromptResult, PromptState, SitePermissionPromptResult } from "~/types/prompts";

const MANAGED_PERMISSIONS = new Set(["media", "geolocation", "notifications", "midiSysex", "pointerLock", "fullscreen"]);

function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function permissionLabel(permission: string) {
  switch (permission) {
    case "media":
      return "камере или микрофону";
    case "geolocation":
      return "геолокации";
    case "notifications":
      return "уведомлениям";
    case "midiSysex":
      return "MIDI-устройствам";
    case "pointerLock":
      return "захвату курсора";
    case "fullscreen":
      return "полноэкранному режиму";
    default:
      return permission;
  }
}

async function requestSitePermission(tabId: number, origin: string, permission: string) {
  const { promise, resolve } = Promise.withResolvers<PromptResult<SitePermissionPromptResult>>();
  const state: PromptState = {
    id: "",
    type: "site-permission",
    tabId,
    originUrl: origin,
    origin,
    permission,
    permissionLabel: permissionLabel(permission),
    promise,
    resolver: resolve
  };

  queuePrompt(state);

  const result = await promise;
  if (!result.success) return "block";
  return result.result;
}

export function registerHandlersWithSession(session: Session) {
  session.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    debugPrint("PERMISSIONS", "permission request", webContents?.getURL() || "unknown-url", permission);

    if (permission === "openExternal") {
      const openExternalDetails = details as OpenExternalPermissionRequest;

      const requestingURL = openExternalDetails.requestingUrl;
      const externalURL = openExternalDetails.externalURL;

      if (openExternalDetails.externalURL) {
        const shouldAlwaysOpen = await shouldAlwaysOpenExternal(requestingURL, openExternalDetails.externalURL);
        if (shouldAlwaysOpen) {
          callback(true);
          return;
        }
      }

      const externalAppName =
        app.getApplicationNameForProtocol(openExternalDetails.externalURL ?? "") || "an unknown application";

      const url = new URL(openExternalDetails.requestingUrl);
      const minifiedUrl = `${url.protocol}//${url.host}`;

      dialog
        .showMessageBox({
          message: `"${minifiedUrl}" wants to open "${externalAppName}".`,
          buttons: ["Cancel", "Open", "Always Open"]
        })
        .then((response) => {
          switch (response.response) {
            case 2:
              if (externalURL) {
                setAlwaysOpenExternal(requestingURL, externalURL);
              }
            /* falls through */
            case 1:
              callback(true);
              break;
            case 0:
              callback(false);
              break;
          }
        });

      return;
    }

    const tab = webContents ? tabsController.getTabByWebContents(webContents) : null;
    const requestingUrl = details.requestingUrl || webContents?.getURL() || "";
    const origin = originFromUrl(requestingUrl);

    if (!tab || !origin || !MANAGED_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }

    const stored = getSitePermissionSetting(tab.profileId, origin, permission);
    if (stored === "allow") {
      callback(true);
      return;
    }
    if (stored === "block") {
      callback(false);
      return;
    }

    const response = await requestSitePermission(tab.id, origin, permission);
    if (response === "always") {
      setSitePermissionForProfile(tab.profileId, { origin, permission, setting: "allow" });
      sendMessageToListeners("site-permissions:on-changed");
      callback(true);
      return;
    }

    callback(response === "allow");
  });
}
