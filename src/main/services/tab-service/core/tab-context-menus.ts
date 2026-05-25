import { clipboard, Menu, MenuItem } from "electron";
import { BrowserWindow } from "@/controllers/windows-controller/types";
import { spacesController } from "@/controllers/spaces-controller";
import type { TabService } from "../tab-service";
import type { Tab } from "./tab";

/**
 * Builds a "Move To" submenu listing all spaces for the tab's profile.
 */
async function buildMoveToSubmenu(tabService: TabService, tab: Tab): Promise<MenuItem> {
  const spaces = await spacesController.getAllFromProfile(tab.profileId);
  const currentSpaceId = tab.spaceId;

  const submenu = new Menu();
  for (const space of spaces) {
    submenu.append(
      new MenuItem({
        label: space.name,
        enabled: space.id !== currentSpaceId,
        click: () => {
          tabService.moveTabToSpace(tab.id, space.id);
        }
      })
    );
  }

  return new MenuItem({ label: "Move To", submenu });
}

/**
 * Shows the context menu for a tab in the sidebar (works for both normal and pinned-tab-owned tabs).
 */
export async function showTabContextMenu(tabService: TabService, tabId: number, window: BrowserWindow): Promise<void> {
  const tab = tabService.tabs.get(tabId);
  if (!tab) return;

  const isPinned = tab.owner.kind === "pinned";
  const hasURL = !!tab.url;

  const contextMenu = new Menu();

  // --- Copy URL ---
  contextMenu.append(
    new MenuItem({
      label: "Copy URL",
      enabled: hasURL,
      click: () => {
        if (tab.url) clipboard.writeText(tab.url);
      }
    })
  );

  // --- Reset URL to Default (pinned tabs only) ---
  if (tab.owner.kind === "pinned") {
    const pinnedTab = tabService.pinnedTabs.get(tab.owner.pinnedTabId);
    const isOnDifferentUrl = pinnedTab && tab.url !== pinnedTab.defaultUrl;

    contextMenu.append(
      new MenuItem({
        label: "Reset URL to Default",
        enabled: !!isOnDifferentUrl,
        click: () => {
          if (pinnedTab && !tab.isDestroyed) {
            tab.loadURL(pinnedTab.defaultUrl);
          }
        }
      })
    );
  }

  contextMenu.append(new MenuItem({ type: "separator" }));

  // --- Mute ---
  const isMuted = tab.muted;
  contextMenu.append(
    new MenuItem({
      label: isMuted ? "Unmute Tab" : "Mute Tab",
      enabled: !!tab.webContents && !tab.webContents.isDestroyed(),
      click: () => {
        if (tab.webContents && !tab.webContents.isDestroyed()) {
          tab.webContents.setAudioMuted(!isMuted);
        }
      }
    })
  );

  // --- Duplicate ---
  contextMenu.append(
    new MenuItem({
      label: "Duplicate Tab",
      enabled: hasURL,
      click: () => {
        if (tab.url) {
          void tabService.createTab(window.id, tab.profileId, tab.spaceId, undefined, { url: tab.url });
        }
      }
    })
  );

  // --- Move To ---
  const moveToItem = await buildMoveToSubmenu(tabService, tab);
  contextMenu.append(moveToItem);

  contextMenu.append(new MenuItem({ type: "separator" }));

  // --- Close Tab ---
  contextMenu.append(
    new MenuItem({
      label: "Close Tab",
      click: () => {
        tab.destroy();
      }
    })
  );

  // --- Close Tabs Below ---
  const tabsInSpace = tabService.getTabsInWindowSpace(window.id, tab.spaceId);
  const tabsBelow = tabsInSpace.filter((t) => t.position > tab.position && t.id !== tab.id);
  contextMenu.append(
    new MenuItem({
      label: "Close Tabs Below",
      enabled: tabsBelow.length > 0,
      click: () => {
        for (const t of tabsBelow) {
          t.destroy();
        }
      }
    })
  );

  contextMenu.append(new MenuItem({ type: "separator" }));

  // --- Pin / Unpin ---
  contextMenu.append(
    new MenuItem({
      label: isPinned ? "Unpin Tab" : "Pin Tab",
      enabled: hasURL,
      click: () => {
        if (tab.owner.kind === "pinned") {
          tabService.unpinToTabList(tab.owner.pinnedTabId);
        } else {
          tabService.createPinnedTabFromTab(tabId);
        }
      }
    })
  );

  // --- Reopen Closed Tab ---
  const mostRecent = tabService.recentlyClosed.peekMostRecent();
  const mostRecentTitle = mostRecent?.tabData.title;
  const truncatedTitle =
    mostRecentTitle && mostRecentTitle.length > 35
      ? mostRecentTitle.slice(0, 35).trim() + "..."
      : mostRecentTitle?.trim();

  contextMenu.append(
    new MenuItem({
      label: truncatedTitle ? `Reopen Closed Tab (${truncatedTitle})` : "Reopen Closed Tab",
      enabled: tabService.recentlyClosed.hasEntries(),
      click: () => {
        if (mostRecent) {
          tabService.restoreRecentlyClosed(mostRecent.tabData.uniqueId, window).catch((error) => {
            console.error("Failed to restore recently closed tab:", error);
          });
        }
      }
    })
  );

  contextMenu.popup({ window: window.browserWindow });
}

/**
 * Shows the context menu for a pinned tab in the pin grid.
 * Delegates to the unified tab context menu if the tab has an associated tab,
 * otherwise shows a minimal menu.
 */
export async function showPinnedTabContextMenu(
  tabService: TabService,
  pinnedTabId: string,
  window: BrowserWindow
): Promise<void> {
  const pinnedTab = tabService.pinnedTabs.get(pinnedTabId);
  if (!pinnedTab) return;

  // If there's an associated tab for the current space, use the unified menu
  const currentSpaceId = window.currentSpaceId;
  const associatedTabId = currentSpaceId ? pinnedTab.getAssociatedTabId(currentSpaceId) : null;
  if (associatedTabId !== null) {
    return showTabContextMenu(tabService, associatedTabId, window);
  }

  // Minimal menu for pinned tabs with no associated tab (not yet activated)
  const contextMenu = new Menu();

  contextMenu.append(
    new MenuItem({
      label: "Copy URL",
      click: () => {
        clipboard.writeText(pinnedTab.defaultUrl);
      }
    })
  );

  contextMenu.append(new MenuItem({ type: "separator" }));

  contextMenu.append(
    new MenuItem({
      label: "Unpin Tab",
      click: () => {
        tabService.unpinToTabList(pinnedTabId);
      }
    })
  );

  contextMenu.popup({ window: window.browserWindow });
}
