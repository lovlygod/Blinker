// This file will be super large and complex, so
// make sure to keep it clean and organized.

// IMPORTS //
import { contextBridge, ipcRenderer } from "electron";
import { injectBrowserAction } from "electron-chrome-extensions/browser-action";
import { tryPatchPasskeys } from "./webauthn";
import { tryPatchPrompts } from "./prompts";

// TYPE IMPORTS //
import type { ProfileData } from "@/controllers/profiles-controller";
import type { SpaceData } from "@/controllers/spaces-controller";

// SHARED TYPES //
import type { SharedExtensionData } from "~/types/extensions";
import type { TabData, WindowTabsData } from "~/types/tabs";
import type { PinnedTabData } from "~/types/pinned-tabs";
import type { UpdateStatus } from "~/types/updates";
import type { WindowState } from "~/flow/types";

// API TYPES //
import { FlowBrowserAPI } from "~/flow/interfaces/browser/browser";
import { FlowPageAPI } from "~/flow/interfaces/browser/page";
import { FlowNavigationAPI } from "~/flow/interfaces/browser/navigation";
import { FlowInterfaceAPI } from "~/flow/interfaces/browser/interface";
import { FlowProfilesAPI } from "~/flow/interfaces/sessions/profiles";
import { FlowSpacesAPI } from "~/flow/interfaces/sessions/spaces";
import { FlowAppAPI } from "~/flow/interfaces/app/app";
import { FlowIconsAPI } from "~/flow/interfaces/settings/icons";
import { FlowNewTabAPI } from "~/flow/interfaces/browser/newTab";
import { FlowOpenExternalAPI } from "~/flow/interfaces/settings/openExternal";
import { FlowOnboardingAPI } from "~/flow/interfaces/settings/onboarding";
import { FlowPasswordsAPI } from "~/flow/interfaces/settings/passwords";
import type { FlowOmniboxAPI, OmniboxOpenParams } from "~/flow/interfaces/browser/omnibox";
import { FlowSettingsAPI } from "~/flow/interfaces/settings/settings";
import { FlowWindowsAPI } from "~/flow/interfaces/app/windows";
import { FlowExtensionsAPI } from "~/flow/interfaces/app/extensions";
import { FlowTabsAPI } from "~/flow/interfaces/browser/tabs";
import { FlowPinnedTabsAPI } from "~/flow/interfaces/browser/pinned-tabs";
import { FlowUpdatesAPI } from "~/flow/interfaces/app/updates";
import { FlowActionsAPI } from "~/flow/interfaces/app/actions";
import { FlowShortcutsAPI, ShortcutsData } from "~/flow/interfaces/app/shortcuts";
import { FlowFindInPageAPI, FindInPageResult } from "~/flow/interfaces/browser/find-in-page";
import { FlowHistoryAPI } from "~/flow/interfaces/browser/history";
import { FlowDownloadsAPI } from "~/flow/interfaces/browser/downloads";
import { FlowPasskeyAPI } from "~/flow/interfaces/browser/passkey";
import type { ConditionalPasskeyRequest, PasskeyCredential } from "~/types/passkey";
import { FlowPromptsAPI } from "~/flow/interfaces/browser/prompts";
import type { ActivePrompt } from "~/types/prompts";

// const isIFrame = !process.isMainFrame;

// API CHECKS //
function isProtocol(protocol: string) {
  return location.protocol === protocol;
}

function isLocation(protocol: string, hostname: string) {
  return location.protocol === protocol && location.hostname === hostname;
}

type Permission = "all" | "app" | "browser" | "session" | "settings";

function hasPermission(permission: Permission) {
  const isFlowProtocol = isProtocol("blinker:");
  const isFlowInternalProtocol = isProtocol("blinker-internal:");

  const isInternalProtocols = isFlowInternalProtocol || isFlowProtocol;

  // Browser UI
  const isMainUI = isLocation("blinker-internal:", "main-ui");
  const isPopupUI = isLocation("blinker-internal:", "popup-ui");
  const isBrowserUI = isMainUI || isPopupUI;

  // Windows
  const isNewTab = isLocation("blinker:", "new-tab");
  const isOmniboxUI = isLocation("blinker-internal:", "omnibox");
  const isOmniboxDebug = isLocation("blinker:", "omnibox");
  const isOmnibox = isOmniboxUI || isNewTab || isOmniboxDebug;

  // Extensions
  const isExtensions = isLocation("blinker:", "extensions");
  const isHistoryPage = isLocation("blinker:", "history");
  const isDownloadsPage = isLocation("blinker:", "downloads");
  const isSettingsPage = isLocation("blinker:", "settings");

  switch (permission) {
    case "all":
      return true;
    case "app":
      return isInternalProtocols || isExtensions;
    case "browser":
      return isBrowserUI || isOmnibox || isHistoryPage || isDownloadsPage;
    case "session":
      return isFlowInternalProtocol || isOmnibox || isBrowserUI || isSettingsPage;
    case "settings":
      return isInternalProtocols;
    default:
      return false;
  }
}

function isWebPage() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function installPasswordAutofillBridge() {
  if (!isWebPage()) return;

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    const message = event.data;
    if (!message || message.source !== "flow-passwords" || typeof message.requestId !== "string") return;

    if (message.type === "get-autofill") {
      const entries = await ipcRenderer.invoke("passwords:get-autofill", location.href);
      window.postMessage(
        {
          source: "flow-passwords",
          type: "autofill-result",
          requestId: message.requestId,
          entries
        },
        location.origin
      );
    } else if (message.type === "save-candidate") {
      await ipcRenderer.invoke("passwords:capture-save-candidate", message.candidate);
    }
  });

  contextBridge.executeInMainWorld({
    func: () => {
      type FlowCredential = {
        username: string;
        password: string;
      };

      const requestAutofill = () =>
        new Promise<FlowCredential[]>((resolve) => {
          const requestId = crypto.randomUUID();
          const timeout = window.setTimeout(() => {
            window.removeEventListener("message", handleMessage);
            resolve([]);
          }, 800);

          function handleMessage(event: MessageEvent) {
            const message = event.data;
            if (
              event.source !== window ||
              !message ||
              message.source !== "flow-passwords" ||
              message.type !== "autofill-result" ||
              message.requestId !== requestId
            ) {
              return;
            }

            window.clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);
            resolve(Array.isArray(message.entries) ? message.entries : []);
          }

          window.addEventListener("message", handleMessage);
          window.postMessage({ source: "flow-passwords", type: "get-autofill", requestId }, location.origin);
        });

      const textInputTypes = new Set(["", "text", "email", "tel", "url", "search"]);

      function findLoginFields(root: ParentNode = document) {
        const passwordFields = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(
          (input) => !input.disabled && !input.readOnly
        );

        return passwordFields.map((passwordField) => {
          const form = passwordField.form;
          const scope: ParentNode = form ?? document;
          const candidates = Array.from(scope.querySelectorAll<HTMLInputElement>("input")).filter((input) => {
            const type = input.type.toLowerCase();
            return input !== passwordField && textInputTypes.has(type) && !input.disabled && !input.readOnly;
          });

          const usernameField =
            candidates.find((input) =>
              /user|email|login|name|account/i.test(`${input.name} ${input.id} ${input.autocomplete}`)
            ) ??
            candidates
              .filter((input) => {
                const passwordRect = passwordField.getBoundingClientRect();
                const inputRect = input.getBoundingClientRect();
                return inputRect.top <= passwordRect.top;
              })
              .at(-1) ??
            null;

          return { form, usernameField, passwordField };
        });
      }

      function setNativeValue(input: HTMLInputElement, value: string) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      async function fillNearest(target: EventTarget | null) {
        if (!(target instanceof HTMLInputElement)) return;
        const fields = findLoginFields();
        const match = fields.find(
          ({ usernameField, passwordField }) => target === usernameField || target === passwordField
        );
        if (!match || match.passwordField.value) return;

        const [credential] = await requestAutofill();
        if (!credential) return;

        if (match.usernameField && !match.usernameField.value) {
          setNativeValue(match.usernameField, credential.username);
        }
        if (!match.passwordField.value) {
          setNativeValue(match.passwordField, credential.password);
        }
      }

      function captureCandidate(form: HTMLFormElement | null, target?: EventTarget | null) {
        const fields = findLoginFields(form ?? document);
        const match =
          fields.find(({ passwordField }) => target === passwordField) ??
          fields.find(({ form: fieldForm }) => fieldForm === form) ??
          fields[0];
        if (!match || !match.passwordField.value) return;

        const username = match.usernameField?.value.trim() ?? "";
        const password = match.passwordField.value;
        if (!username || !password) return;

        window.postMessage(
          {
            source: "flow-passwords",
            type: "save-candidate",
            requestId: crypto.randomUUID(),
            candidate: {
              url: location.href,
              title: document.title,
              username,
              password
            }
          },
          location.origin
        );
      }

      document.addEventListener("focusin", (event) => void fillNearest(event.target), true);
      document.addEventListener(
        "submit",
        (event) => {
          captureCandidate(event.target instanceof HTMLFormElement ? event.target : null);
        },
        true
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter") {
            captureCandidate((event.target as HTMLInputElement | null)?.form ?? null, event.target);
          }
        },
        true
      );
    }
  });
}

// BROWSER ACTION //
// Inject <browser-action-list> element into WebUI
if (hasPermission("browser")) {
  injectBrowserAction();
}

// API PATCHES //
tryPatchPasskeys();
tryPatchPrompts();
installPasswordAutofillBridge();

// INTERNAL FUNCTIONS //
function getOSFromPlatform(platform: NodeJS.Platform) {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return "Unknown";
  }
}

// POPUP POLYFILLS //
// Polyfill some methods for popup windows
function polyfillPopup() {
  window.moveBy = (x: number, y: number) => {
    if (typeof x !== "number" || typeof y !== "number") {
      throw new Error("Invalid arguments: x and y must be provided as numbers");
    }

    flow.interface.moveWindowBy(x, y);
  };

  window.moveTo = (x: number, y: number) => {
    if (typeof x !== "number" || typeof y !== "number") {
      throw new Error("Invalid arguments: x and y must be provided as numbers");
    }

    flow.interface.moveWindowTo(x, y);
  };

  window.resizeBy = (width: number, height: number) => {
    if (typeof width !== "number" || typeof height !== "number") {
      throw new Error("Invalid arguments: width and height must be provided as numbers");
    }

    flow.interface.resizeWindowBy(width, height);
  };

  window.resizeTo = (width: number, height: number) => {
    if (typeof width !== "number" || typeof height !== "number") {
      throw new Error("Invalid arguments: width and height must be provided as numbers");
    }

    flow.interface.resizeWindowTo(width, height);
  };
}

contextBridge.executeInMainWorld({
  func: polyfillPopup
});

/**
 * Generates a UUIDv4 string.
 * @returns A UUIDv4 string.
 */
function generateUUID(): string {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listenOnIPCChannel(channel: string, callback: (...args: any[]) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedCallback = (_event: any, ...args: any[]) => {
    callback(...args);
  };

  const listenerId = generateUUID();
  ipcRenderer.send("listeners:add", channel, listenerId);
  ipcRenderer.on(channel, wrappedCallback);
  return () => {
    ipcRenderer.send("listeners:remove", channel, listenerId);
    ipcRenderer.removeListener(channel, wrappedCallback);
  };
}

function wrapAPI<T extends object>(
  api: T,
  permission: Permission,
  overridePermissions?: {
    [key in keyof T]?: Permission;
  }
): T {
  const wrappedAPI = {} as T;

  for (const key in api) {
    const value = api[key];

    if (typeof value === "function") {
      // @ts-expect-error: annoying little type inconsistancies
      wrappedAPI[key] = (...args: unknown[]) => {
        let noPermission = false;

        if (overridePermissions?.[key]) {
          noPermission = !hasPermission(overridePermissions[key]);
        } else {
          noPermission = !hasPermission(permission);
        }

        if (noPermission) {
          throw new Error(`Permission denied: flow.${permission}.${key}()`);
        }

        return value(...args);
      };
    } else {
      wrappedAPI[key] = value;
    }
  }

  return wrappedAPI;
}

// BROWSER API //
const browserAPI: FlowBrowserAPI = {
  loadProfile: async (profileId: string) => {
    return ipcRenderer.send("browser:load-profile", profileId);
  },
  unloadProfile: async (profileId: string) => {
    return ipcRenderer.send("browser:unload-profile", profileId);
  },
  createWindow: () => {
    return ipcRenderer.send("browser:create-window");
  },
  createIncognitoWindow: () => {
    return ipcRenderer.send("browser:create-incognito-window");
  }
};

// TABS API //
const tabsAPI: FlowTabsAPI = {
  getData: async () => {
    return ipcRenderer.invoke("tabs:get-data");
  },
  onDataUpdated: (callback: (data: WindowTabsData) => void) => {
    return listenOnIPCChannel("tabs:on-data-changed", callback);
  },
  onTabsContentUpdated: (callback: (tabs: TabData[]) => void) => {
    return listenOnIPCChannel("tabs:on-tabs-content-updated", callback);
  },
  onPlaceholderChanged: (callback) => {
    return listenOnIPCChannel("tabs:on-placeholder-changed", callback);
  },
  onTargetUrlChanged: (callback) => {
    return listenOnIPCChannel("tabs:on-target-url", callback);
  },
  switchToTab: async (tabId: number) => {
    return ipcRenderer.invoke("tabs:switch-to-tab", tabId);
  },
  closeTab: async (tabId: number) => {
    return ipcRenderer.invoke("tabs:close-tab", tabId);
  },

  showContextMenu: (tabId: number) => {
    return ipcRenderer.send("tabs:show-context-menu", tabId);
  },

  moveTab: async (tabId: number, newPosition: number) => {
    return ipcRenderer.invoke("tabs:move-tab", tabId, newPosition);
  },

  moveTabToWindowSpace: async (tabId: number, spaceId: string, newPosition?: number) => {
    return ipcRenderer.invoke("tabs:move-tab-to-window-space", tabId, spaceId, newPosition);
  },

  // Special Exception: This is allowed for all internal protocols.
  newTab: async (url?: string, isForeground?: boolean, spaceId?: string, typedFromAddressBar?: boolean) => {
    return ipcRenderer.invoke("tabs:new-tab", url, isForeground, spaceId, typedFromAddressBar);
  },

  // Special Exception: This is allowed on every tab, but very tightly secured.
  // It will only work if the tab is currently in Picture-in-Picture mode.
  disablePictureInPicture: async (goBackToTab: boolean) => {
    return ipcRenderer.invoke("tabs:disable-picture-in-picture", goBackToTab);
  },

  setTabMuted: async (tabId: number, muted: boolean) => {
    return ipcRenderer.invoke("tabs:set-tab-muted", tabId, muted);
  },

  batchMoveTabs: async (tabIds: number[], spaceId: string, newPositionStart?: number) => {
    return ipcRenderer.invoke("tabs:batch-move-tabs", tabIds, spaceId, newPositionStart);
  },

  getRecentlyClosed: async () => {
    return ipcRenderer.invoke("tabs:get-recently-closed");
  },

  restoreRecentlyClosed: async (uniqueId: string) => {
    return ipcRenderer.invoke("tabs:restore-recently-closed", uniqueId);
  },

  clearRecentlyClosed: async () => {
    return ipcRenderer.invoke("tabs:clear-recently-closed");
  }
};

// PINNED TABS API //
const pinnedTabsAPI: FlowPinnedTabsAPI = {
  getData: async () => {
    return ipcRenderer.invoke("pinned-tabs:get-data");
  },
  onChanged: (callback: (data: Record<string, PinnedTabData[]>) => void) => {
    return listenOnIPCChannel("pinned-tabs:on-changed", callback);
  },
  createFromTab: async (tabId: number, position?: number) => {
    return ipcRenderer.invoke("pinned-tabs:create-from-tab", tabId, position);
  },
  click: async (pinnedTabId: string) => {
    return ipcRenderer.invoke("pinned-tabs:click", pinnedTabId);
  },
  doubleClick: async (pinnedTabId: string) => {
    return ipcRenderer.invoke("pinned-tabs:double-click", pinnedTabId);
  },
  remove: async (pinnedTabId: string) => {
    return ipcRenderer.invoke("pinned-tabs:remove", pinnedTabId);
  },
  unpinToTabList: async (pinnedTabId: string, position?: number) => {
    return ipcRenderer.invoke("pinned-tabs:unpin-to-tab-list", pinnedTabId, position);
  },
  reorder: async (pinnedTabId: string, newPosition: number) => {
    return ipcRenderer.invoke("pinned-tabs:reorder", pinnedTabId, newPosition);
  },
  showContextMenu: (pinnedTabId: string) => {
    return ipcRenderer.send("pinned-tabs:show-context-menu", pinnedTabId);
  }
};

// PAGE API //
const pageAPI: FlowPageAPI = {
  setPageBounds: (bounds: { x: number; y: number; width: number; height: number }) => {
    return ipcRenderer.send("page:set-bounds", bounds);
  },
  setLayoutParams: (params) => {
    return ipcRenderer.send("page:set-layout-params", params, Date.now());
  }
};

// NAVIGATION API //
const navigationAPI: FlowNavigationAPI = {
  getTabNavigationStatus: (tabId: number) => {
    return ipcRenderer.invoke("navigation:get-tab-status", tabId);
  },
  goTo: (url: string, tabId?: number, typedFromAddressBar?: boolean) => {
    return ipcRenderer.send("navigation:go-to", url, tabId, typedFromAddressBar);
  },
  stopLoadingTab: (tabId: number) => {
    return ipcRenderer.send("navigation:stop-loading-tab", tabId);
  },
  reloadTab: (tabId: number) => {
    return ipcRenderer.send("navigation:reload-tab", tabId);
  },
  goToNavigationEntry: (tabId: number, index: number) => {
    return ipcRenderer.send("navigation:go-to-entry", tabId, index);
  }
};

// HISTORY API //
const historyAPI: FlowHistoryAPI = {
  list: async () => {
    return ipcRenderer.invoke("history:list");
  },
  listVisits: async (search?: string) => {
    return ipcRenderer.invoke("history:list-visits", search);
  },
  listVisitsPage: async (args) => {
    return ipcRenderer.invoke("history:list-visits-page", args);
  },
  deleteVisit: async (visitId: number) => {
    return ipcRenderer.invoke("history:delete-visit", visitId);
  },
  deleteAllForUrl: async (urlRowId: number) => {
    return ipcRenderer.invoke("history:delete-url", urlRowId);
  },
  clearAll: async () => {
    return ipcRenderer.invoke("history:clear-all");
  }
};

// DOWNLOADS API //
const downloadsAPI: FlowDownloadsAPI = {
  listRecent: async (limit?: number) => {
    return ipcRenderer.invoke("downloads:list-recent", limit);
  },
  listPage: async (args) => {
    return ipcRenderer.invoke("downloads:list-page", args);
  },
  getSessionDownloads: async () => {
    return ipcRenderer.invoke("downloads:get-session");
  },
  openFile: async (id: number) => {
    return ipcRenderer.invoke("downloads:open-file", id);
  },
  showInFolder: async (id: number) => {
    return ipcRenderer.invoke("downloads:show-in-folder", id);
  },
  pause: async (id: number) => {
    return ipcRenderer.invoke("downloads:pause", id);
  },
  resume: async (id: number) => {
    return ipcRenderer.invoke("downloads:resume", id);
  },
  cancel: async (id: number) => {
    return ipcRenderer.invoke("downloads:cancel", id);
  },
  retry: async (id: number) => {
    return ipcRenderer.invoke("downloads:retry", id);
  },
  remove: async (id: number) => {
    return ipcRenderer.invoke("downloads:remove", id);
  },
  clearAll: async () => {
    return ipcRenderer.invoke("downloads:clear-all");
  },
  getDownloadDirectory: async () => {
    return ipcRenderer.invoke("downloads:get-directory");
  },
  chooseDownloadDirectory: async () => {
    return ipcRenderer.invoke("downloads:choose-directory");
  },
  resetDownloadDirectory: async () => {
    return ipcRenderer.invoke("downloads:reset-directory");
  },
  onChanged: (callback) => {
    return listenOnIPCChannel("downloads:on-changed", callback);
  },
  onCreated: (callback) => {
    return listenOnIPCChannel("downloads:on-created", callback);
  }
};

// PASSKEY API //
const passkeyAPI: FlowPasskeyAPI = {
  getConditionalRequests: async (): Promise<ConditionalPasskeyRequest[]> => {
    return ipcRenderer.invoke("passkey:get-conditional-requests");
  },
  onConditionalRequestsUpdated: (callback: (requests: ConditionalPasskeyRequest[]) => void) => {
    return listenOnIPCChannel("passkey:on-conditional-requests-updated", callback);
  },
  hasPermissionToListPasskeys: async () => {
    return ipcRenderer.invoke("passkey:has-permission-to-list-passkeys");
  },
  requestPermissionToListPasskeys: async () => {
    return ipcRenderer.invoke("passkey:request-list-passkeys-permission");
  },
  listPasskeys: async (rpId: string): Promise<PasskeyCredential[]> => {
    return ipcRenderer.invoke("passkey:list-passkeys", rpId);
  },
  selectConditionalPasskey: async (operationId: string, credentialId: string): Promise<boolean> => {
    return ipcRenderer.invoke("passkey:select-conditional-passkey", operationId, credentialId);
  },
  openSystemSettings: async () => {
    return ipcRenderer.invoke("passkey:open-system-settings");
  }
};

// INTERFACE API //
const interfaceAPI: FlowInterfaceAPI = {
  setWindowButtonPosition: (position: { x: number; y: number }) => {
    return ipcRenderer.send("window-button:set-position", position);
  },
  setWindowButtonVisibility: (visible: boolean) => {
    return ipcRenderer.send("window-button:set-visibility", visible);
  },
  onToggleSidebar: (callback: () => void) => {
    return listenOnIPCChannel("sidebar:on-toggle", callback);
  },
  onCursorAtEdge: (callback: (event: import("~/flow/interfaces/browser/interface").CursorEdgeEvent) => void) => {
    return listenOnIPCChannel("interface:cursor-at-edge", callback);
  },
  setComponentWindowBounds: (componentId: string, bounds: Electron.Rectangle) => {
    return ipcRenderer.send("interface:set-component-window-bounds", componentId, bounds);
  },
  allocateComponentWindow: (
    ...[componentId, layerType, visible]: Parameters<FlowInterfaceAPI["allocateComponentWindow"]>
  ) => {
    return ipcRenderer.send("interface:allocate-component-window", componentId, layerType, visible);
  },
  setComponentWindowVisible: (...[componentId, visible]: Parameters<FlowInterfaceAPI["setComponentWindowVisible"]>) => {
    return ipcRenderer.send("interface:set-component-window-visible", componentId, visible);
  },
  releaseComponentWindow: (componentId: string) => {
    return ipcRenderer.send("interface:release-component-window", componentId);
  },
  focusComponentWindow: (componentId: string) => {
    return ipcRenderer.send("interface:focus-component-window", componentId);
  },

  minimizeWindow: () => {
    return ipcRenderer.send("interface:minimize-window");
  },
  maximizeWindow: () => {
    return ipcRenderer.send("interface:maximize-window");
  },
  closeWindow: () => {
    return ipcRenderer.send("interface:close-window");
  },

  getWindowState: () => {
    return ipcRenderer.invoke("interface:get-window-state");
  },
  onWindowStateChanged: (callback: (state: WindowState) => void) => {
    return listenOnIPCChannel("interface:window-state-changed", callback);
  },

  // Special Exception: These are allowed on every tab, but very tightly secured.
  // They will only work in popup windows.
  moveWindowBy: async (x: number, y: number) => {
    return ipcRenderer.send("interface:move-window-by", x, y);
  },
  moveWindowTo: async (x: number, y: number) => {
    return ipcRenderer.send("interface:move-window-to", x, y);
  },
  resizeWindowBy: async (width: number, height: number) => {
    return ipcRenderer.send("interface:resize-window-by", width, height);
  },
  resizeWindowTo: async (width: number, height: number) => {
    return ipcRenderer.send("interface:resize-window-to", width, height);
  }
};

// PROFILES API //
const profilesAPI: FlowProfilesAPI = {
  getProfiles: async () => {
    return ipcRenderer.invoke("profiles:get-all");
  },
  getAreProfilesInternal: async () => {
    return ipcRenderer.invoke("profiles:get-are-internal");
  },
  createProfile: async (profileName: string) => {
    return ipcRenderer.invoke("profiles:create", profileName);
  },
  updateProfile: async (profileId: string, profileData: Partial<ProfileData>) => {
    return ipcRenderer.invoke("profiles:update", profileId, profileData);
  },
  deleteProfile: async (profileId: string) => {
    return ipcRenderer.invoke("profiles:delete", profileId);
  },
  getUsingProfile: async () => {
    return ipcRenderer.invoke("profile:get-using");
  }
};

// SPACES API //
const spacesAPI: FlowSpacesAPI = {
  getSpaces: async () => {
    return ipcRenderer.invoke("spaces:get-all");
  },
  getSpacesFromProfile: async (profileId: string) => {
    return ipcRenderer.invoke("spaces:get-from-profile", profileId);
  },
  createSpace: async (profileId: string, spaceName: string) => {
    return ipcRenderer.invoke("spaces:create", profileId, spaceName);
  },
  deleteSpace: async (profileId: string, spaceId: string) => {
    return ipcRenderer.invoke("spaces:delete", profileId, spaceId);
  },
  updateSpace: async (profileId: string, spaceId: string, spaceData: Partial<SpaceData>) => {
    return ipcRenderer.invoke("spaces:update", profileId, spaceId, spaceData);
  },
  setUsingSpace: async (profileId: string, spaceId: string) => {
    return ipcRenderer.invoke("spaces:set-using", profileId, spaceId);
  },
  getUsingSpace: async () => {
    return ipcRenderer.invoke("spaces:get-using");
  },
  getLastUsedSpace: async () => {
    return ipcRenderer.invoke("spaces:get-last-used");
  },
  reorderSpaces: async (orderMap: { profileId: string; spaceId: string; order: number }[]) => {
    return ipcRenderer.invoke("spaces:reorder", orderMap);
  },
  onSpacesChanged: (callback: () => void) => {
    return listenOnIPCChannel("spaces:on-changed", callback);
  },
  onSetWindowSpace: (callback: (spaceId: string) => void) => {
    return listenOnIPCChannel("spaces:on-set-window-space", callback);
  }
};

// APP API //
const appAPI: FlowAppAPI = {
  getAppInfo: async () => {
    const appInfo: {
      version: string;
      packaged: boolean;
    } = await ipcRenderer.invoke("app:get-info");
    const appVersion = appInfo.version;
    const updateChannel: "Stable" | "Beta" | "Alpha" | "Development" = appInfo.packaged ? "Stable" : "Development";
    const os = getOSFromPlatform(process.platform);

    return {
      app_version: appVersion,
      build_number: appVersion,
      node_version: process.versions.node,
      chrome_version: process.versions.chrome,
      electron_version: process.versions.electron,
      os: os,
      update_channel: updateChannel
    };
  },
  writeTextToClipboard: (text: string) => {
    return ipcRenderer.send("app:write-text-to-clipboard", text);
  },
  setDefaultBrowser: async () => {
    return ipcRenderer.invoke("app:set-default-browser");
  },
  getDefaultBrowser: async () => {
    return ipcRenderer.invoke("app:get-default-browser");
  },

  // Special Exception: This is allowed for all pages everywhere.
  getPlatform: () => {
    return process.platform;
  }
};

// ICONS API //
const iconsAPI: FlowIconsAPI = {
  getIcons: async () => {
    return ipcRenderer.invoke("icons:get-all");
  },
  isPlatformSupported: async () => {
    return ipcRenderer.invoke("icons:is-platform-supported");
  },
  getCurrentIcon: async () => {
    return ipcRenderer.invoke("icons:get-current-icon-id");
  },
  setCurrentIcon: async (iconId: string) => {
    return ipcRenderer.invoke("icons:set-current-icon-id", iconId);
  }
};

// NEW TAB API //
const newTabAPI: FlowNewTabAPI = {
  open: () => {
    return ipcRenderer.send("new-tab:open");
  }
};

// OPEN EXTERNAL API //
const openExternalAPI: FlowOpenExternalAPI = {
  getAlwaysOpenExternal: async () => {
    return ipcRenderer.invoke("open-external:get");
  },
  unsetAlwaysOpenExternal: async (requestingURL: string, openingURL: string) => {
    return ipcRenderer.invoke("open-external:unset", requestingURL, openingURL);
  }
};

// ONBOARDING API //
const onboardingAPI: FlowOnboardingAPI = {
  finish: () => {
    return ipcRenderer.send("onboarding:finish");
  },
  reset: () => {
    return ipcRenderer.send("onboarding:reset");
  }
};

// PASSWORDS API //
const passwordsAPI: FlowPasswordsAPI = {
  list: async (profileId: string) => {
    return ipcRenderer.invoke("passwords:list", profileId);
  },
  save: async (profileId, entry) => {
    return ipcRenderer.invoke("passwords:save", profileId, entry);
  },
  delete: async (profileId, id) => {
    return ipcRenderer.invoke("passwords:delete", profileId, id);
  },
  importFromCsv: async (profileId) => {
    return ipcRenderer.invoke("passwords:import-csv", profileId);
  },
  exportToCsv: async (profileId) => {
    return ipcRenderer.invoke("passwords:export-csv", profileId);
  }
};

// OMNIBOX API //
const omniboxAPI: FlowOmniboxAPI = {
  show: (bounds: Electron.Rectangle | null, params: OmniboxOpenParams | null) => {
    return ipcRenderer.send("omnibox:show", bounds, params);
  },
  getState: async () => {
    return ipcRenderer.invoke("omnibox:get-state");
  },
  onStateChanged: (callback) => {
    return listenOnIPCChannel("omnibox:on-state-changed", callback);
  },
  hide: () => {
    return ipcRenderer.send("omnibox:hide");
  }
};

// FIND IN PAGE API //
const findInPageAPI: FlowFindInPageAPI = {
  find: (text: string, options?: { forward?: boolean; findNext?: boolean }) => {
    ipcRenderer.send("find-in-page:find", text, options);
  },
  stop: (action: "clearSelection" | "keepSelection" | "activateSelection") => {
    ipcRenderer.send("find-in-page:stop", action);
  },
  onResult: (callback: (result: FindInPageResult) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedCallback = (_event: any, data: FindInPageResult) => {
      callback(data);
    };
    ipcRenderer.on("find-in-page:result", wrappedCallback);
    return () => {
      ipcRenderer.removeListener("find-in-page:result", wrappedCallback);
    };
  },
  onToggle: (callback: () => void) => {
    return listenOnIPCChannel("find-in-page:toggle", callback);
  }
};

// PROMPTS API //
const promptsAPI: FlowPromptsAPI = {
  getActivePrompts: async () => {
    return ipcRenderer.invoke("prompts:get-active-prompts");
  },
  onActivePromptsChanged: (callback: (prompts: ActivePrompt[]) => void) => {
    return listenOnIPCChannel("prompts:on-active-prompts-changed", callback);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  confirmPrompt: (promptId: string, result: any, suppress: boolean) => {
    return ipcRenderer.send("prompts:confirm-prompt", promptId, result, suppress);
  }
};

// SETTINGS API //
const settingsAPI: FlowSettingsAPI = {
  getSetting: async (settingId: string) => {
    return ipcRenderer.invoke("settings:get-setting", settingId);
  },
  setSetting: async (settingId: string, value: unknown) => {
    return ipcRenderer.invoke("settings:set-setting", settingId, value);
  },
  getBasicSettings: async () => {
    return ipcRenderer.invoke("settings:get-basic-settings");
  },
  onSettingsChanged: (callback: () => void) => {
    return listenOnIPCChannel("settings:on-changed", callback);
  }
};

// WINDOWS API //
const windowsAPI: FlowWindowsAPI = {
  openSettingsWindow: () => {
    void ipcRenderer.invoke("tabs:new-tab", "blinker://settings/", true);
  },
  closeSettingsWindow: () => {
    return ipcRenderer.send("settings:close");
  },

  // Generic window controls (work for any internal window)
  minimizeCurrentWindow: () => {
    return ipcRenderer.send("window:minimize");
  },
  maximizeCurrentWindow: () => {
    return ipcRenderer.send("window:maximize");
  },
  closeCurrentWindow: () => {
    return ipcRenderer.send("window:close");
  },
  getCurrentWindowState: () => {
    return ipcRenderer.invoke("window:get-state");
  },
  onCurrentWindowStateChanged: (callback: (state: WindowState) => void) => {
    return listenOnIPCChannel("window:state-changed", callback);
  }
};

// EXTENSIONS API //
const extensionsAPI: FlowExtensionsAPI = {
  getAllInProfile: async (profileId: string) => {
    return ipcRenderer.invoke("extensions:get-all-in-profile", profileId);
  },
  getAllInCurrentProfile: async () => {
    return ipcRenderer.invoke("extensions:get-all-in-current-profile");
  },
  onUpdated: (callback: (profileId: string, extensions: SharedExtensionData[]) => void) => {
    return listenOnIPCChannel("extensions:on-updated", callback);
  },
  setExtensionEnabled: async (extensionId: string, enabled: boolean) => {
    return ipcRenderer.invoke("extensions:set-extension-enabled", extensionId, enabled);
  },
  uninstallExtension: async (extensionId: string) => {
    return ipcRenderer.invoke("extensions:uninstall-extension", extensionId);
  },
  setExtensionPinned: async (extensionId: string, pinned: boolean) => {
    return ipcRenderer.invoke("extensions:set-extension-pinned", extensionId, pinned);
  },
  importUnpacked: async () => {
    return ipcRenderer.invoke("extensions:import-unpacked");
  }
};

// UPDATES API //
const updatesAPI: FlowUpdatesAPI = {
  isAutoUpdateSupported: async () => {
    return ipcRenderer.invoke("updates:is-auto-update-supported");
  },
  getUpdateStatus: async () => {
    return ipcRenderer.invoke("updates:get-update-status");
  },
  onUpdateStatusChanged: (callback: (updateStatus: UpdateStatus) => void) => {
    return listenOnIPCChannel("updates:on-update-status-changed", callback);
  },
  checkForUpdates: async () => {
    return ipcRenderer.invoke("updates:check-for-updates");
  },
  downloadUpdate: async () => {
    return ipcRenderer.invoke("updates:download-update");
  },
  installUpdate: async () => {
    return ipcRenderer.invoke("updates:install-update");
  },
  hasUpdated: async () => {
    return ipcRenderer.invoke("updates:has-updated");
  }
};

// ACTIONS API //
const actionsAPI: FlowActionsAPI = {
  onCopyLink: (callback: () => void) => {
    return listenOnIPCChannel("actions:on-copy-link", callback);
  },
  onIncomingAction: (callback: (action: string) => void) => {
    return listenOnIPCChannel("actions:on-incoming", callback);
  }
};

// SHORTCUTS API //
const shortcutsAPI: FlowShortcutsAPI = {
  getShortcuts: async () => {
    return ipcRenderer.invoke("shortcuts:get-all");
  },
  setShortcut: async (actionId: string, shortcut: string) => {
    return ipcRenderer.invoke("shortcuts:set", actionId, shortcut);
  },
  resetShortcut: async (actionId: string) => {
    return ipcRenderer.invoke("shortcuts:reset", actionId);
  },
  onShortcutsUpdated: (callback: (shortcuts: ShortcutsData) => void) => {
    return listenOnIPCChannel("shortcuts:on-updated", callback);
  }
};

// EXPOSE FLOW API //
const flowAPI: typeof flow = {
  // App APIs
  app: wrapAPI(appAPI, "app", {
    getPlatform: "all"
  }),
  windows: wrapAPI(windowsAPI, "app"),
  extensions: wrapAPI(extensionsAPI, "app"),
  updates: wrapAPI(updatesAPI, "app"),
  actions: wrapAPI(actionsAPI, "app"),
  shortcuts: wrapAPI(shortcutsAPI, "app"),

  // Browser APIs
  browser: wrapAPI(browserAPI, "browser"),
  tabs: wrapAPI(tabsAPI, "browser", {
    newTab: "app",
    disablePictureInPicture: "all"
  }),
  pinnedTabs: wrapAPI(pinnedTabsAPI, "browser"),
  page: wrapAPI(pageAPI, "browser"),
  navigation: wrapAPI(navigationAPI, "browser"),
  history: wrapAPI(historyAPI, "browser"),
  downloads: wrapAPI(downloadsAPI, "browser", {
    getDownloadDirectory: "settings",
    chooseDownloadDirectory: "settings",
    resetDownloadDirectory: "settings"
  }),
  passkey: wrapAPI(passkeyAPI, "browser"),
  interface: wrapAPI(interfaceAPI, "browser", {
    moveWindowTo: "all",
    resizeWindowTo: "all"
  }),
  omnibox: wrapAPI(omniboxAPI, "browser"),
  newTab: wrapAPI(newTabAPI, "browser"),
  findInPage: wrapAPI(findInPageAPI, "browser"),
  prompts: wrapAPI(promptsAPI, "browser"),

  // Session APIs
  profiles: wrapAPI(profilesAPI, "session", {
    getUsingProfile: "app"
  }),
  spaces: wrapAPI(spacesAPI, "session", {
    getUsingSpace: "app"
  }),

  // Settings APIs
  settings: wrapAPI(settingsAPI, "settings"),
  icons: wrapAPI(iconsAPI, "settings"),
  openExternal: wrapAPI(openExternalAPI, "settings"),
  onboarding: wrapAPI(onboardingAPI, "settings"),
  passwords: wrapAPI(passwordsAPI, "settings")
};
contextBridge.exposeInMainWorld("flow", flowAPI);
