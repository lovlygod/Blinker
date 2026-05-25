import { clipboard, Menu, MenuItem } from "electron";
import { BrowserWindow } from "@/controllers/windows-controller/types";
import type { TabService } from "../tab-service";

/**
 * Shows the context menu for a regular tab in the sidebar.
 */
export function showTabContextMenu(tabService: TabService, tabId: number, window: BrowserWindow): void {
  const tab = tabService.tabs.get(tabId);
  if (!tab) return;

  const isTabVisible = tab.visible;
  const hasURL = !!tab.url;

  const contextMenu = new Menu();

  const isPinned = tab.owner.kind === "pinned";

  contextMenu.append(
    new MenuItem({
      label: "Copy URL",
      enabled: hasURL,
      click: () => {
        if (tab.url) clipboard.writeText(tab.url);
      }
    })
  );

  contextMenu.append(new MenuItem({ type: "separator" }));

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

  contextMenu.append(new MenuItem({ type: "separator" }));

  contextMenu.append(
    new MenuItem({
      label: isTabVisible ? "Cannot put active tab to sleep" : tab.asleep ? "Wake Tab" : "Put Tab to Sleep",
      enabled: !isTabVisible,
      click: () => {
        if (tab.asleep) {
          tabService.activateTab(tab);
        } else {
          tab.putToSleep();
        }
      }
    })
  );

  contextMenu.append(
    new MenuItem({
      label: "Close Tab",
      click: () => {
        tab.destroy();
      }
    })
  );

  contextMenu.append(new MenuItem({ type: "separator" }));

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
 * Shows the context menu for a pinned tab.
 */
export function showPinnedTabContextMenu(tabService: TabService, pinnedTabId: string, window: BrowserWindow): void {
  const pinnedTab = tabService.pinnedTabs.get(pinnedTabId);
  if (!pinnedTab) return;

  const contextMenu = new Menu();

  contextMenu.append(
    new MenuItem({
      label: "Unpin",
      click: () => {
        tabService.unpinToTabList(pinnedTabId);
      }
    })
  );

  contextMenu.append(new MenuItem({ type: "separator" }));

  const currentSpaceId = window.currentSpaceId;
  const associatedTabId = currentSpaceId ? pinnedTab.getAssociatedTabId(currentSpaceId) : null;
  const associatedTab = associatedTabId !== null ? tabService.tabs.get(associatedTabId) : undefined;
  const isOnDifferentUrl = associatedTab && associatedTab.url !== pinnedTab.defaultUrl;

  contextMenu.append(
    new MenuItem({
      label: "Reset to Default",
      enabled: !!isOnDifferentUrl,
      click: () => {
        if (associatedTab && !associatedTab.isDestroyed) {
          associatedTab.loadURL(pinnedTab.defaultUrl);
        }
      }
    })
  );

  contextMenu.append(
    new MenuItem({
      label: "Copy URL",
      click: () => {
        clipboard.writeText(pinnedTab.defaultUrl);
      }
    })
  );

  contextMenu.popup({ window: window.browserWindow });
}
