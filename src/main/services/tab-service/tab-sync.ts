/**
 * Tab Sync — shared tab state across windows.
 *
 * When enabled (via the "syncTabsAcrossWindows" setting), every window sees
 * the same tabs. When a window gains focus, the active tab's view is moved
 * there. A screenshot placeholder is left in the old window.
 *
 * Pinned tabs ALWAYS sync across windows regardless of the setting.
 *
 * Disabled by default (each window has independent tabs).
 */

import { getSettingValueById } from "@/saving/settings";
import { windowsController } from "@/controllers/windows-controller";
import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import type { BrowserWindow } from "@/controllers/windows-controller/types";
import { spacesController } from "@/controllers/spaces-controller";
import {
  storeSnapshot,
  removeSnapshot
} from "@/controllers/sessions-controller/protocols/_protocols/flow-internal/tab-snapshot";
import type { TabPlaceholderUpdate } from "~/types/tab-service";
import { Tab } from "./core/tab";
import { tabService } from "./index";

// --- Screenshot Placeholders (served via flow-internal://tab-snapshot) ---

const PLACEHOLDER_RELEASE_DELAY_MS = 180;

type WindowPlaceholderState = {
  snapshotId: string;
  tabId: number;
  generation: number;
  spaceId: string;
};

const windowPlaceholderState: Map<number, WindowPlaceholderState> = new Map();
const windowPlaceholderGeneration: Map<number, number> = new Map();

function nextPlaceholderGeneration(windowId: number): number {
  const generation = (windowPlaceholderGeneration.get(windowId) ?? 0) + 1;
  windowPlaceholderGeneration.set(windowId, generation);
  return generation;
}

function sendPlaceholderUpdate(targetWindow: BrowserWindow, update: TabPlaceholderUpdate): void {
  if (targetWindow.destroyed) return;
  targetWindow.sendMessageToCoreWebContents("tab-service:on-placeholder-changed", update);
}

async function captureTabScreenshot(tab: Tab): Promise<Electron.NativeImage | null> {
  const wc = tab.webContents;
  if (!wc || wc.isDestroyed()) return null;

  const view = tab.view;
  if (!view) return null;

  const bounds = view.getBounds();
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  try {
    const image = await wc.capturePage({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

function sendPlaceholderToRenderer(
  targetWindow: BrowserWindow,
  spaceId: string,
  tabId: number,
  image: Electron.NativeImage
): void {
  if (targetWindow.destroyed) return;

  const previousPlaceholder = windowPlaceholderState.get(targetWindow.id);
  if (previousPlaceholder) {
    removeSnapshot(previousPlaceholder.snapshotId);
  }

  const generation = nextPlaceholderGeneration(targetWindow.id);
  const snapshotId = storeSnapshot(image);
  windowPlaceholderState.set(targetWindow.id, { snapshotId, tabId, generation, spaceId });
  sendPlaceholderUpdate(targetWindow, { snapshotId, generation, spaceId });
}

function clearPlaceholderInRenderer(windowId: number): void {
  const generation = nextPlaceholderGeneration(windowId);
  const placeholderState = windowPlaceholderState.get(windowId);
  if (placeholderState) {
    windowPlaceholderState.delete(windowId);
    setTimeout(() => {
      removeSnapshot(placeholderState.snapshotId);
    }, PLACEHOLDER_RELEASE_DELAY_MS);
  }

  const win = browserWindowsController.getWindowById(windowId);
  if (!win) return;

  sendPlaceholderUpdate(win, { snapshotId: null, generation, spaceId: win.currentSpaceId });
}

export function clearPlaceholdersForTab(tabId: number): void {
  for (const [windowId, placeholderState] of windowPlaceholderState.entries()) {
    if (placeholderState.tabId !== tabId) continue;
    clearPlaceholderInRenderer(windowId);
  }
}

function reconcilePlaceholderForWindow(windowId: number): void {
  const window = browserWindowsController.getWindowById(windowId);
  if (!window || window.destroyed || window.browserWindowType !== "normal") return;

  const spaceId = window.currentSpaceId;
  if (!spaceId) {
    clearPlaceholderInRenderer(windowId);
    return;
  }

  const focusedTab = tabService.getFocusedTab(windowId, spaceId);
  if (!focusedTab) {
    clearPlaceholderInRenderer(windowId);
    return;
  }

  if (isSyncExcludedTab(focusedTab)) {
    clearPlaceholderInRenderer(windowId);
    return;
  }

  // If the active tab is physically in this window, clear the placeholder
  if (focusedTab.getWindow().id === windowId) {
    clearPlaceholderInRenderer(windowId);
  }
}

// --- Core Helpers ---

export function isTabSyncEnabled(): boolean {
  return getSettingValueById("syncTabsAcrossWindows") === true;
}

function isInternalProfileTab(tab: Tab): boolean {
  return tab.loadedProfile.profileData.internal === true;
}

function isPopupWindowTab(tab: Tab): boolean {
  return tab.getWindow().browserWindowType === "popup";
}

export function isSyncExcludedTab(tab: Tab): boolean {
  return isInternalProfileTab(tab) || isPopupWindowTab(tab);
}

function shouldSyncSharedActiveTab(window: BrowserWindow, spaceId: string): boolean {
  if (isTabSyncEnabled()) return true;

  // Pinned tabs always sync across windows
  const focusedTab = tabService.getFocusedTab(window.id, spaceId);
  return !!focusedTab && focusedTab.owner.kind === "pinned";
}

// --- Tab Moving ---

function prepareTabForWindowTransfer(tab: Tab): void {
  tab.visible = false;
  if (tab.layer) {
    tab.layer.setVisible(false);
  }
}

async function moveTabToWindowIfNeeded(tab: Tab, window: BrowserWindow, isStale?: () => boolean): Promise<void> {
  if (tab.isDestroyed || window.destroyed) return;
  if (tab.getWindow().id !== window.id) {
    const oldWindow = tab.getWindow();
    if (oldWindow.destroyed) return;

    // Capture screenshot BEFORE the move so the old window gets a placeholder.
    // Use a short timeout to avoid blocking on unresponsive renderers.
    const screenshot = await captureTabScreenshot(tab);

    // After async capture, re-check validity
    if (isStale?.()) return;
    if (tab.isDestroyed || window.destroyed || oldWindow.destroyed) return;
    if (tab.getWindow().id === window.id) return; // already moved by another path

    // Send placeholder to old window before moving
    if (screenshot) {
      sendPlaceholderToRenderer(oldWindow, tab.spaceId, tab.id, screenshot);
    }

    // Migrate the layout node BEFORE calling setWindow (so old layout is still accessible)
    tabService.migrateTabBetweenLayouts(tab, window.id);

    // Move the tab to the new window (emits "window-changed" which triggers structural updates)
    prepareTabForWindowTransfer(tab);
    tab.setWindow(window);
  }
}

async function moveActiveTabToWindow(window: BrowserWindow, isStale?: () => boolean): Promise<void> {
  const spaceId = window.currentSpaceId;
  if (!spaceId) return;

  const focusedTab = tabService.getFocusedTab(window.id, spaceId);
  if (!focusedTab) return;

  clearPlaceholderInRenderer(window.id);

  if (isSyncExcludedTab(focusedTab)) return;

  // Move the focused tab (and all tabs in its layout node)
  const layout = tabService.layouts.get(window.id);
  if (!layout) return;

  const node = layout.getNodeForTab(focusedTab.id);
  if (node) {
    if (isStale?.()) return;
    for (const tab of node.tabs) {
      if (!isSyncExcludedTab(tab)) {
        await moveTabToWindowIfNeeded(tab, window, isStale);
      }
    }
  } else {
    await moveTabToWindowIfNeeded(focusedTab, window, isStale);
  }
}

export async function moveTabOrGroupToWindow(tab: Tab, window: BrowserWindow): Promise<void> {
  clearPlaceholderInRenderer(window.id);

  const layout = tabService.layouts.get(tab.getWindow().id);
  if (layout) {
    const node = layout.getNodeForTab(tab.id);
    if (node) {
      for (const nodeTab of node.tabs) {
        await moveTabToWindowIfNeeded(nodeTab, window);
      }
      return;
    }
  }

  await moveTabToWindowIfNeeded(tab, window);
}

// --- Tab Relocation from Closing Window ---

function findWindowWithProfile(windows: BrowserWindow[], profileId: string): BrowserWindow | null {
  for (const win of windows) {
    const spaceId = win.currentSpaceId;
    if (!spaceId) continue;
    const space = spacesController.getFromCache(spaceId);
    if (space?.profileId === profileId) {
      return win;
    }
  }
  return null;
}

export function relocateTabsFromClosingWindow(closingWindow: BrowserWindow, tabs: Tab[]): Tab[] | null {
  if (!isTabSyncEnabled()) return null;

  const closingWindowId = closingWindow.id;
  if (closingWindow.browserWindowType === "popup") return null;

  const survivingWindows = browserWindowsController
    .getWindows()
    .filter((w) => w.id !== closingWindowId && w.browserWindowType === "normal");
  if (survivingWindows.length === 0) return null;

  const defaultTargetWindow = survivingWindows[0];
  const relocatable = new Map<BrowserWindow, Tab[]>();
  const unrelocatable: Tab[] = [];

  for (const tab of tabs) {
    const isInternal = tab.loadedProfile.profileData.internal;
    if (isInternal) {
      const targetWindow = findWindowWithProfile(survivingWindows, tab.profileId);
      if (targetWindow) {
        const list = relocatable.get(targetWindow) ?? [];
        list.push(tab);
        relocatable.set(targetWindow, list);
      } else {
        unrelocatable.push(tab);
      }
    } else {
      const list = relocatable.get(defaultTargetWindow) ?? [];
      list.push(tab);
      relocatable.set(defaultTargetWindow, list);
    }
  }

  for (const [targetWindow, windowTabs] of relocatable) {
    for (const tab of windowTabs) {
      prepareTabForWindowTransfer(tab);
      tab.setWindow(targetWindow);
    }
  }

  // Activate a tab in target windows so the UI shows something
  for (const targetWindow of relocatable.keys()) {
    const targetSpaceId = targetWindow.currentSpaceId;
    if (targetSpaceId) {
      const focusedTab = tabService.getFocusedTab(targetWindow.id, targetSpaceId);
      if (focusedTab) {
        tabService.activateTab(focusedTab);
      }
    }
  }

  return unrelocatable;
}

// --- Displaced Tab Relocation ---

let _syncMoveQueue: Promise<void> = Promise.resolve();

async function runTabSyncMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = _syncMoveQueue.then(work, work);
  _syncMoveQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// --- Initialization ---

export function initTabSync(): void {
  // Set the move-tab hook so TabService can call tab-sync's move logic
  tabService.moveTabToWindowHook = (tab, window) => moveTabOrGroupToWindow(tab, window);

  // Move active tab view to focused window.
  // Debounces spurious focus events from WebContentsView manipulation.
  // After moving the tab, programmatically re-focuses the target window
  // to ensure it stays in front (Electron can shift focus during view moves).
  let _lastFocusMoveTime = 0;
  const FOCUS_MOVE_DEBOUNCE_MS = 200;

  windowsController.on("window-focused", (id) => {
    const now = Date.now();
    if (now - _lastFocusMoveTime < FOCUS_MOVE_DEBOUNCE_MS) return;

    const window = browserWindowsController.getWindowById(id);
    if (!window || window.destroyed || window.browserWindowType !== "normal") return;

    const spaceId = window.currentSpaceId;
    if (!spaceId) return;

    if (!shouldSyncSharedActiveTab(window, spaceId)) return;

    const focusedTab = tabService.getFocusedTab(window.id, spaceId);
    if (!focusedTab || focusedTab.isDestroyed) return;
    if (isSyncExcludedTab(focusedTab)) return;

    // If the tab is already in this window, just activate
    if (focusedTab.getWindow().id === window.id) {
      clearPlaceholderInRenderer(window.id);
      tabService.activateTab(focusedTab);
      return;
    }

    // Async move: screenshot → move → placeholder → activate → re-focus
    const targetWindowId = window.id;
    runTabSyncMutation(async () => {
      if (window.destroyed || focusedTab.isDestroyed) return;
      if (focusedTab.getWindow().id === targetWindowId) return; // already moved

      clearPlaceholderInRenderer(targetWindowId);
      await moveTabToWindowIfNeeded(focusedTab, window);

      if (focusedTab.isDestroyed || window.destroyed) return;

      // Activate the tab (makes it visible in the target window)
      tabService.activateTab(focusedTab);

      // Re-focus the target window AFTER the tab is moved and visible.
      // This ensures the correct window stays in front even if Electron
      // briefly shifted focus during WebContentsView manipulation.
      _lastFocusMoveTime = Date.now();
      if (!window.destroyed && !window.browserWindow.isFocused()) {
        window.browserWindow.focus();
      }
    }).catch((err) => {
      console.error("[tab-sync] Failed to move active tab on focus:", err);
    });
  });

  // Update placeholders when active/focused state changes
  tabService.on("active-changed", (windowId) => {
    reconcilePlaceholderForWindow(windowId);
  });

  tabService.on("focused-tab-changed", (windowId) => {
    reconcilePlaceholderForWindow(windowId);
  });

  // Handle space changes
  const handleSpaceChange = (windowId: number) => {
    reconcilePlaceholderForWindow(windowId);

    const window = browserWindowsController.getWindowById(windowId);
    if (window && window.browserWindowType === "normal") {
      const expectedSpaceId = window.currentSpaceId;
      if (expectedSpaceId && shouldSyncSharedActiveTab(window, expectedSpaceId)) {
        const isStale = () => window.currentSpaceId !== expectedSpaceId;

        runTabSyncMutation(async () => {
          if (window.destroyed || isStale()) return;
          await moveActiveTabToWindow(window, isStale);
          if (isStale()) return;

          const focusedTab = tabService.getFocusedTab(window.id, expectedSpaceId);
          if (focusedTab) {
            tabService.activateTab(focusedTab);
          }
        }).catch((err) => {
          console.error("[tab-sync] Failed to move active tab on space change:", err);
        });
      }
    }
  };

  // Listen for new windows being added, and wire space-change listener
  const wireWindowSpaceChange = (window: BrowserWindow) => {
    window.on("current-space-changed", () => {
      handleSpaceChange(window.id);
    });
  };

  // Wire existing windows
  for (const win of browserWindowsController.getWindows()) {
    wireWindowSpaceChange(win);
  }

  // Wire future windows via windowsController
  windowsController.on("window-added", (id) => {
    const win = browserWindowsController.getWindowById(id);
    if (win && win.browserWindowType === "normal") {
      wireWindowSpaceChange(win);
    }
  });

  // Clear placeholders when tabs are destroyed
  tabService.on("tab-removed", (tab) => {
    clearPlaceholdersForTab(tab.id);
  });

  // Clean up when windows are destroyed
  windowsController.on("window-removed", (id) => {
    clearPlaceholderInRenderer(id);
    windowPlaceholderGeneration.delete(id);
  });
}

export { runTabSyncMutation };
