import { ipcMain } from "electron";
import { TabService } from "../tab-service";
import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import { BrowserWindow } from "@/controllers/windows-controller/types";
import { spacesController } from "@/controllers/spaces-controller";
import {
  TabData,
  TabLayoutNodeData,
  WindowFocusedTabIds,
  WindowActiveLayoutNodeIds,
  WindowTabsPayload,
  PinnedTabData,
  TAB_SERVICE_SCHEMA_VERSION
} from "~/types/tab-service";
import { Tab } from "../core/tab";
import { TabLayoutNode } from "../core/tab-layout-node";
import { PinnedTab } from "../core/pinned-tab";

const DEBOUNCE_MS = 80;

/**
 * TabIPC — handles all IPC communication between the TabService and renderer.
 *
 * Provides:
 * - Debounced structural and content change notifications
 * - IPC handlers for all tab/pinned-tab operations
 */
export class TabIPC {
  private structuralQueue: Set<number> = new Set();
  private contentQueue: Map<number, Set<number>> = new Map();
  private queueTimeout: NodeJS.Timeout | null = null;

  private pinnedTabChangeTimeout: NodeJS.Timeout | null = null;

  private readonly tabService: TabService;

  constructor(tabService: TabService) {
    this.tabService = tabService;
  }

  /**
   * Initialize all IPC handlers and event listeners.
   */
  public initialize(): void {
    this.setupEventListeners();
    this.registerHandlers();
  }

  // --- Event Listeners ---

  private setupEventListeners(): void {
    this.tabService.on("structural-change", (windowId) => {
      this.structuralQueue.add(windowId);
      this.scheduleProcessing();
    });

    this.tabService.on("content-change", (windowId, tabId) => {
      if (this.structuralQueue.has(windowId)) return;
      let tabIds = this.contentQueue.get(windowId);
      if (!tabIds) {
        tabIds = new Set();
        this.contentQueue.set(windowId, tabIds);
      }
      tabIds.add(tabId);
      this.scheduleProcessing();
    });

    this.tabService.on("pinned-tab-changed", () => {
      this.schedulePinnedTabChange();
    });
  }

  private scheduleProcessing(): void {
    if (this.queueTimeout) return;
    this.queueTimeout = setTimeout(() => {
      this.processQueues();
      this.queueTimeout = null;
    }, DEBOUNCE_MS);
  }

  private processQueues(): void {
    // Structural changes (full refresh)
    for (const windowId of this.structuralQueue) {
      const window = browserWindowsController.getWindowById(windowId);
      if (!window) continue;

      const payload = this.getWindowTabsPayload(window);
      window.sendMessageToCoreWebContents("tab-service:on-data-changed", payload);
      this.contentQueue.delete(windowId);
    }
    this.structuralQueue.clear();

    // Content-only changes
    for (const [windowId, tabIds] of this.contentQueue) {
      const window = browserWindowsController.getWindowById(windowId);
      if (!window) continue;

      const updatedTabs: TabData[] = [];
      for (const tabId of tabIds) {
        const tab = this.tabService.getTabById(tabId);
        if (!tab) continue;
        updatedTabs.push(this.serializeTabForRenderer(tab));
      }

      if (updatedTabs.length > 0) {
        window.sendMessageToCoreWebContents("tab-service:on-content-updated", updatedTabs);
      }
    }
    this.contentQueue.clear();
  }

  private schedulePinnedTabChange(): void {
    if (this.pinnedTabChangeTimeout) clearTimeout(this.pinnedTabChangeTimeout);
    this.pinnedTabChangeTimeout = setTimeout(() => {
      this.pinnedTabChangeTimeout = null;
      const data = this.serializeAllPinnedTabs();
      for (const window of browserWindowsController.getWindows()) {
        window.sendMessageToCoreWebContents("tab-service:pinned-tabs-changed", data);
      }
    }, DEBOUNCE_MS);
  }

  // --- IPC Handlers ---

  private registerHandlers(): void {
    // --- Tab Data ---
    ipcMain.handle("tab-service:get-data", (event) => {
      const webContents = event.sender;
      const window = browserWindowsController.getWindowFromWebContents(webContents);
      if (!window) return null;
      return this.getWindowTabsPayload(window);
    });

    // --- Tab Operations ---
    ipcMain.handle("tab-service:switch-to-tab", async (_event, tabId: number) => {
      const tab = this.tabService.getTabById(tabId);
      if (!tab) return false;
      this.tabService.activateTab(tab);
      return true;
    });

    ipcMain.handle(
      "tab-service:new-tab",
      async (event, url?: string, isForeground?: boolean, spaceId?: string, typedFromAddressBar?: boolean) => {
        const webContents = event.sender;
        const window =
          browserWindowsController.getWindowFromWebContents(webContents) || browserWindowsController.getWindows()[0];
        if (!window) return false;

        if (!spaceId) {
          spaceId = window.currentSpaceId ?? undefined;
        }
        if (!spaceId) return false;

        const space = await spacesController.get(spaceId);
        if (!space) return false;

        const tab = await this.tabService.createTab(window.id, space.profileId, spaceId, undefined, {
          url: url || undefined,
          typedNavigation: typedFromAddressBar === true
        });

        if (isForeground) {
          this.tabService.activateTab(tab);
        }
        return true;
      }
    );

    ipcMain.handle("tab-service:close-tab", async (_event, tabId: number) => {
      const tab = this.tabService.getTabById(tabId);
      if (!tab) return false;
      tab.destroy();
      return true;
    });

    ipcMain.handle("tab-service:set-tab-muted", async (_event, tabId: number, muted: boolean) => {
      return this.tabService.setTabMuted(tabId, muted);
    });

    ipcMain.handle("tab-service:move-tab", async (_event, tabId: number, newPosition: number) => {
      this.tabService.moveTab(tabId, newPosition);
      return true;
    });

    ipcMain.handle(
      "tab-service:move-tab-to-space",
      async (_event, tabId: number, spaceId: string, newPosition?: number) => {
        this.tabService.moveTabToSpace(tabId, spaceId, newPosition);
        return true;
      }
    );

    // --- Pinned Tabs ---
    ipcMain.handle("tab-service:pinned-tabs-get-data", async () => {
      return this.serializeAllPinnedTabs();
    });

    ipcMain.handle("tab-service:pinned-tabs-create-from-tab", async (_event, tabId: number, position?: number) => {
      const pinnedTab = this.tabService.createPinnedTabFromTab(tabId, position);
      if (!pinnedTab) return null;
      return this.serializePinnedTab(pinnedTab);
    });

    ipcMain.handle("tab-service:pinned-tabs-click", async (event, pinnedTabId: string) => {
      const webContents = event.sender;
      const window = browserWindowsController.getWindowFromWebContents(webContents);
      if (!window) return false;
      return this.tabService.clickPinnedTab(pinnedTabId, window);
    });

    ipcMain.handle("tab-service:pinned-tabs-double-click", async (event, pinnedTabId: string) => {
      const webContents = event.sender;
      const window = browserWindowsController.getWindowFromWebContents(webContents);
      if (!window) return false;
      return this.tabService.doubleClickPinnedTab(pinnedTabId, window);
    });

    ipcMain.handle("tab-service:pinned-tabs-remove", async (_event, pinnedTabId: string) => {
      this.tabService.removePinnedTab(pinnedTabId);
      return true;
    });

    ipcMain.handle("tab-service:pinned-tabs-unpin", async (_event, pinnedTabId: string) => {
      return this.tabService.unpinToTabList(pinnedTabId);
    });

    ipcMain.handle("tab-service:pinned-tabs-reorder", async (_event, pinnedTabId: string, newPosition: number) => {
      this.tabService.reorderPinnedTab(pinnedTabId, newPosition);
      return true;
    });

    // --- Layout Nodes ---
    ipcMain.handle("tab-service:create-layout-node", async (event, mode: "glance" | "split", tabIds: number[]) => {
      const webContents = event.sender;
      const window = browserWindowsController.getWindowFromWebContents(webContents);
      if (!window) return null;

      const node = this.tabService.createLayoutNode(window.id, mode, tabIds);
      if (!node) return null;

      this.tabService.activateNode(window.id, node.spaceId, node);
      return this.serializeLayoutNode(node);
    });

    ipcMain.handle("tab-service:dissolve-layout-node", async (event, nodeId: string) => {
      const webContents = event.sender;
      const window = browserWindowsController.getWindowFromWebContents(webContents);
      if (!window) return false;

      this.tabService.dissolveLayoutNode(nodeId, window.id);
      return true;
    });
  }

  // --- Serialization ---

  private getWindowTabsPayload(window: BrowserWindow): WindowTabsPayload {
    const windowId = window.id;
    const tabs = this.tabService.getTabsInWindow(windowId);
    const layout = this.tabService.layouts.get(windowId);

    // Filter out ephemeral tabs from the sidebar list
    const visibleTabs = tabs.filter((t) => t.owner.kind === "normal");
    const tabDatas = visibleTabs.map((tab) => this.serializeTabForRenderer(tab));

    // Collect layout nodes
    const layoutNodes: TabLayoutNodeData[] = [];
    if (layout) {
      const spaces = new Set(tabs.map((t) => t.spaceId));
      for (const spaceId of spaces) {
        const nodes = layout.getNodesInSpace(spaceId);
        for (const node of nodes) {
          // Only include multi-tab nodes (single nodes are implicit)
          if (node.mode !== "single") {
            layoutNodes.push(this.serializeLayoutNode(node));
          }
        }
      }
    }

    // Focused and active maps
    const focusedTabIds: WindowFocusedTabIds = {};
    const activeLayoutNodeIds: WindowActiveLayoutNodeIds = {};

    const spaces = new Set(tabs.map((t) => t.spaceId));
    for (const spaceId of spaces) {
      if (layout) {
        const focusedTab = layout.getFocusedTab(spaceId);
        if (focusedTab) focusedTabIds[spaceId] = focusedTab.id;

        const activeNode = layout.getActiveNode(spaceId);
        if (activeNode) activeLayoutNodeIds[spaceId] = activeNode.id;
      }
    }

    return {
      tabs: tabDatas,
      layoutNodes,
      focusedTabIds,
      activeLayoutNodeIds
    };
  }

  private serializeTabForRenderer(tab: Tab): TabData {
    return {
      schemaVersion: TAB_SERVICE_SCHEMA_VERSION,
      uniqueId: tab.uniqueId,
      createdAt: tab.createdAt,
      lastActiveAt: tab.lastActiveAt,
      position: tab.position,
      profileId: tab.profileId,
      spaceId: tab.spaceId,
      windowGroupId: `w-${tab.getWindow().id}`,
      title: tab.title,
      url: tab.url,
      faviconURL: tab.faviconURL,
      muted: tab.muted,
      owner: tab.owner,

      // Runtime fields
      id: tab.id,
      windowId: tab.getWindow().id,
      isLoading: tab.isLoading,
      audible: tab.audible,
      fullScreen: tab.fullScreen,
      isPictureInPicture: tab.isPictureInPicture,
      asleep: tab.asleep
    };
  }

  private serializeLayoutNode(node: TabLayoutNode): TabLayoutNodeData {
    return {
      id: node.id,
      mode: node.mode,
      tabIds: node.tabIds,
      frontTabId: node.frontTab?.id,
      position: node.position,
      spaceId: node.spaceId,
      profileId: node.profileId
    };
  }

  private serializePinnedTab(pinnedTab: PinnedTab): PinnedTabData {
    return {
      uniqueId: pinnedTab.uniqueId,
      profileId: pinnedTab.profileId,
      defaultUrl: pinnedTab.defaultUrl,
      faviconUrl: pinnedTab.faviconUrl,
      position: pinnedTab.position,
      associatedTabIds: pinnedTab.getAssociatedTabIds()
    };
  }

  private serializeAllPinnedTabs(): Record<string, PinnedTabData[]> {
    const byProfile = this.tabService.getAllPinnedTabsByProfile();
    const result: Record<string, PinnedTabData[]> = {};

    for (const [profileId, pinnedTabs] of Object.entries(byProfile)) {
      result[profileId] = pinnedTabs.map((pt) => this.serializePinnedTab(pt));
    }

    return result;
  }
}
