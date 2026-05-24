import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { Tab, TabCreationDetails, TabCreationOptions } from "./core/tab";
import { TabLayoutNode } from "./core/tab-layout-node";
import { PinnedTab } from "./core/pinned-tab";
import { RecentlyClosedManager } from "./core/recently-closed-manager";
import { TabLayout } from "./layout/tab-layout";
import { TabPositioner } from "./layout/tab-positioner";
import {
  NavigationEntry,
  PersistedTabData,
  RecentlyClosedTabData,
  TabLayoutNodeMode,
  TAB_SERVICE_SCHEMA_VERSION
} from "~/types/tab-service";
import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import { spacesController } from "@/controllers/spaces-controller";
import { loadedProfilesController } from "@/controllers/loaded-profiles-controller";
import { BrowserWindow } from "@/controllers/windows-controller/types";
import { clipboard, Menu, MenuItem, WebContents } from "electron";
import { quitController } from "@/controllers/quit-controller";
import { setWindowSpace } from "@/ipc/session/spaces";
import { getDb, schema } from "@/saving/db";
import { eq } from "drizzle-orm";
import { getSettingValueById } from "@/saving/settings";
import { SleepTabValueMap } from "@/modules/basic-settings";

export const NEW_TAB_URL = "flow://new-tab";

type TabServiceEvents = {
  "tab-created": [Tab];
  "tab-removed": [Tab];
  "active-changed": [windowId: number, spaceId: string];
  "focused-tab-changed": [windowId: number, spaceId: string];
  "pinned-tab-changed": [];
  "structural-change": [windowId: number];
  "content-change": [windowId: number, tabId: number];
  destroyed: [];
};

/**
 * TabService — the central orchestrator for tab management.
 *
 * Manages:
 * - All tabs (Map<tabId, Tab>)
 * - All pinned tabs (Map<uniqueId, PinnedTab>)
 * - Per-window layouts (Map<windowId, TabLayout>)
 * - A shared TabPositioner
 *
 * Coordinates tab creation, destruction, activation, pinned tab operations,
 * and communication with the renderer via events.
 */
export class TabService extends TypedEventEmitter<TabServiceEvents> {
  // All tabs
  public readonly tabs: Map<number, Tab> = new Map();

  // Per-window layouts
  public readonly layouts: Map<number, TabLayout> = new Map();

  // Pinned tabs
  public readonly pinnedTabs: Map<string, PinnedTab> = new Map();

  // Recently closed
  public readonly recentlyClosed: RecentlyClosedManager = new RecentlyClosedManager();

  // Shared positioner
  public readonly positioner: TabPositioner = new TabPositioner();

  /**
   * Hook for tab-sync: moves a tab to another window with placeholder handling.
   * Set by initTabSync() to avoid circular dependency.
   */
  public moveTabToWindowHook: ((tab: Tab, window: BrowserWindow) => Promise<void>) | null = null;

  // --- Pinned Tab Persistence ---

  /**
   * Load all pinned tabs from the database into memory.
   * Called once during app startup.
   */
  public loadPinnedTabs(): void {
    const db = getDb();
    const rows = db.select().from(schema.pinnedTabs).all();
    for (const row of rows) {
      const pinnedTab = new PinnedTab(row);
      this.pinnedTabs.set(pinnedTab.uniqueId, pinnedTab);
      this.wirePinnedTabEvents(pinnedTab);
    }
  }

  private savePinnedTab(pinnedTab: PinnedTab): void {
    const db = getDb();
    db.insert(schema.pinnedTabs)
      .values({
        uniqueId: pinnedTab.uniqueId,
        profileId: pinnedTab.profileId,
        defaultUrl: pinnedTab.defaultUrl,
        faviconUrl: pinnedTab.faviconUrl,
        position: pinnedTab.position
      })
      .onConflictDoUpdate({
        target: schema.pinnedTabs.uniqueId,
        set: {
          defaultUrl: pinnedTab.defaultUrl,
          faviconUrl: pinnedTab.faviconUrl,
          position: pinnedTab.position
        }
      })
      .run();
  }

  private deletePinnedTabFromDb(uniqueId: string): void {
    const db = getDb();
    db.delete(schema.pinnedTabs).where(eq(schema.pinnedTabs.uniqueId, uniqueId)).run();
  }

  /**
   * Start background tasks: space-deletion cleanup & auto-sleep/archive timer.
   * Called once during initialization.
   */
  public startBackgroundTasks(): void {
    // Destroy tabs when their space is deleted
    spacesController.on("space-deleted", (_profileId, spaceId) => {
      if (quitController.isQuitting) return;
      const tabs = this.getTabsInSpace(spaceId);
      for (const tab of tabs) {
        tab.destroy();
      }
    });

    // Auto-sleep/archive interval (every 10s)
    setInterval(() => {
      if (quitController.isQuitting) return;
      const now = Date.now();

      for (const tab of this.tabs.values()) {
        if (tab.owner.kind !== "normal") continue;
        if (tab.visible) continue;

        // Auto-archive (destroy) tabs inactive too long
        const archiveAfter = getSettingValueById("archiveTabAfter");
        if (typeof archiveAfter === "string" && archiveAfter !== "never") {
          const archiveMs = this.parseDurationToMs(archiveAfter);
          if (archiveMs > 0 && now - tab.lastActiveAt >= archiveMs) {
            tab.destroy();
            continue;
          }
        }

        // Auto-sleep tabs inactive past threshold
        if (!tab.asleep) {
          const sleepAfter = getSettingValueById("sleepTabAfter");
          if (typeof sleepAfter === "string" && sleepAfter !== "never") {
            const sleepSeconds = SleepTabValueMap[sleepAfter as keyof typeof SleepTabValueMap];
            if (typeof sleepSeconds === "number" && now - tab.lastActiveAt >= sleepSeconds * 1000) {
              tab.putToSleep();
            }
          }
        }
      }
    }, 10_000);
  }

  private parseDurationToMs(value: string): number {
    // Matches patterns like "5m", "30m", "1h", "12h", "1d", "7d"
    const match = value.match(/^(\d+)(m|h|d)$/);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    switch (match[2]) {
      case "m":
        return num * 60 * 1000;
      case "h":
        return num * 60 * 60 * 1000;
      case "d":
        return num * 24 * 60 * 60 * 1000;
      default:
        return 0;
    }
  }

  // --- Tab Creation ---

  /**
   * Create a new tab with automatic window/profile/space resolution.
   */
  public async createTab(
    windowId?: number,
    profileId?: string,
    spaceId?: string,
    webContentsViewOptions?: Electron.WebContentsViewConstructorOptions,
    options: Partial<TabCreationOptions> = {}
  ): Promise<Tab> {
    // Resolve window
    if (!windowId) {
      const focusedWindow = browserWindowsController.getFocusedWindow();
      if (focusedWindow) {
        windowId = focusedWindow.id;
      } else {
        const windows = browserWindowsController.getWindows();
        if (windows.length > 0) {
          windowId = windows[0].id;
        } else {
          throw new Error("No window available for new tab");
        }
      }
    }

    // Resolve profile/space from window
    if (!profileId || !spaceId) {
      const window = browserWindowsController.getWindowById(windowId);
      if (window?.currentSpaceId) {
        const spaceData = await spacesController.get(window.currentSpaceId);
        if (spaceData) {
          profileId = profileId || spaceData.profileId;
          spaceId = spaceId || window.currentSpaceId;
        }
      }
    }

    // Fallback to last used space
    if (!profileId) {
      const lastUsedSpace = await spacesController.getLastUsed();
      if (lastUsedSpace) {
        profileId = lastUsedSpace.profileId;
        spaceId = spaceId || lastUsedSpace.id;
      } else {
        throw new Error("Could not determine profile for new tab");
      }
    } else if (!spaceId) {
      const lastUsedSpace = await spacesController.getLastUsedFromProfile(profileId);
      if (lastUsedSpace) {
        spaceId = lastUsedSpace.id;
      } else {
        throw new Error("Could not determine space for new tab");
      }
    }

    // Load profile
    await loadedProfilesController.load(profileId);

    return this.createTabInternal(windowId, profileId, spaceId!, webContentsViewOptions, options);
  }

  /**
   * Internal tab creation — assumes all parameters are resolved.
   */
  public createTabInternal(
    windowId: number,
    profileId: string,
    spaceId: string,
    webContentsViewOptions?: Electron.WebContentsViewConstructorOptions,
    options: Partial<TabCreationOptions> = {}
  ): Tab {
    const window = browserWindowsController.getWindowById(windowId);
    if (!window) throw new Error("Window not found");

    const profile = loadedProfilesController.get(profileId);
    if (!profile) throw new Error("Profile not found");

    // Compute position if not provided
    if (options.position === undefined) {
      const tabsInSpace = this.getTabsInWindowSpace(windowId, spaceId);
      options.position = this.positioner.getInsertTopPosition(tabsInSpace);
    }

    // Create the tab
    const details: TabCreationDetails = {
      profileId,
      spaceId,
      session: profile.session,
      loadedProfile: profile
    };

    const tab = new Tab(details, {
      window,
      webContentsViewOptions,
      ...options
    } as TabCreationOptions);

    // Register tab
    this.tabs.set(tab.id, tab);

    // Get or create layout for this window
    const layout = this.getOrCreateLayout(windowId);

    // Create a single layout node for this tab
    layout.createSingleNode(tab);

    // Wire up tab events
    this.wireTabEvents(tab);

    // Activate the new tab unless explicitly suppressed
    if (options.makeActive !== false) {
      this.activateTab(tab);
    }

    // Load initial URL if needed
    if (tab._needsInitialLoad && options.noLoadURL !== true) {
      const initialURL = options.url || profile.newTabUrl || NEW_TAB_URL;
      if (options.typedNavigation) {
        tab.markTypedNavigationForNextHistoryVisit(initialURL);
      }
      tab.loadURL(initialURL);
    }

    this.emit("tab-created", tab);
    this.emitStructuralChange(windowId);

    return tab;
  }

  // --- Tab Destruction ---

  /**
   * Remove and clean up a tab.
   */
  public destroyTab(tabId: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.destroy();
  }

  // --- Tab Queries ---

  public getTabById(tabId: number): Tab | undefined {
    return this.tabs.get(tabId);
  }

  public getTabByWebContents(webContents: WebContents): Tab | undefined {
    for (const tab of this.tabs.values()) {
      if (tab.webContents === webContents) return tab;
    }
    return undefined;
  }

  public getTabsInWindow(windowId: number): Tab[] {
    const result: Tab[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.getWindow().id === windowId) result.push(tab);
    }
    return result;
  }

  public getTabsInSpace(spaceId: string): Tab[] {
    const result: Tab[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.spaceId === spaceId) result.push(tab);
    }
    return result;
  }

  public getTabsInWindowSpace(windowId: number, spaceId: string): Tab[] {
    const result: Tab[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.getWindow().id === windowId && tab.spaceId === spaceId) {
        result.push(tab);
      }
    }
    return result;
  }

  public getTabsInProfile(profileId: string): Tab[] {
    const result: Tab[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.profileId === profileId) result.push(tab);
    }
    return result;
  }

  public clearBrowsingHistoryDedupingForProfile(profileId: string, url?: string): void {
    for (const tab of this.getTabsInProfile(profileId)) {
      tab.clearBrowsingHistoryDeduping(url);
    }
  }

  // --- Active Tab Management ---

  /**
   * Activate a layout node (makes it visible).
   */
  public activateNode(windowId: number, spaceId: string, node: TabLayoutNode): void {
    const layout = this.layouts.get(windowId);
    if (!layout) return;

    layout.setActiveNode(spaceId, node);

    // Update view visibility and bounds
    this.updateTabVisibility(windowId, spaceId);
    this.handlePageBoundsChanged(windowId);

    // Notify renderer of active node change
    this.emitStructuralChange(windowId);
  }

  /**
   * Activate a tab by finding its layout node and making it active.
   */
  public activateTab(tab: Tab): void {
    const windowId = tab.getWindow().id;
    const layout = this.layouts.get(windowId);
    if (!layout) return;

    const node = layout.getNodeForTab(tab.id);
    if (!node) return;

    // For multi-tab nodes (glance), set front tab
    if (node.mode === "glance") {
      node.setFrontTab(tab);
    }

    layout.setActiveNode(tab.spaceId, node);
    layout.setFocusedTab(tab.spaceId, tab);

    // Update view visibility and bounds
    this.updateTabVisibility(windowId, tab.spaceId);
    this.handlePageBoundsChanged(windowId);

    // Notify renderer of active tab change
    this.emitStructuralChange(windowId);
  }

  /**
   * Activate the next tab in visual order.
   */
  public activateNextTab(windowId: number, spaceId: string): void {
    const layout = this.layouts.get(windowId);
    if (!layout) return;
    layout.activateNextNode(spaceId);
  }

  /**
   * Activate the previous tab in visual order.
   */
  public activatePreviousTab(windowId: number, spaceId: string): void {
    const layout = this.layouts.get(windowId);
    if (!layout) return;
    layout.activatePreviousNode(spaceId);
  }

  /**
   * Check if a tab is currently active.
   */
  public isTabActive(tab: Tab): boolean {
    const layout = this.layouts.get(tab.getWindow().id);
    if (!layout) return false;
    return layout.isTabActive(tab);
  }

  /**
   * Get the focused tab for a space in a window.
   */
  public getFocusedTab(windowId: number, spaceId: string): Tab | undefined {
    return this.layouts.get(windowId)?.getFocusedTab(spaceId);
  }

  /**
   * Get the active layout node for a space in a window.
   */
  public getActiveNode(windowId: number, spaceId: string): TabLayoutNode | undefined {
    return this.layouts.get(windowId)?.getActiveNode(spaceId);
  }

  // --- Layout Node Operations ---

  /**
   * Create a multi-tab layout node (e.g., glance or split).
   */
  public createLayoutNode(
    windowId: number,
    mode: Exclude<TabLayoutNodeMode, "single">,
    tabIds: number[]
  ): TabLayoutNode | null {
    const layout = this.layouts.get(windowId);
    if (!layout) return null;

    const tabs = tabIds.map((id) => this.tabs.get(id)).filter((t): t is Tab => !!t);
    if (tabs.length < 2) return null;

    // Remove tabs from their current single nodes
    for (const tab of tabs) {
      const existingNode = layout.getNodeForTab(tab.id);
      if (existingNode && existingNode.mode === "single") {
        layout.destroyNode(existingNode.id);
      } else if (existingNode) {
        existingNode.removeTab(tab);
      }
    }

    return layout.createMultiNode(mode, tabs);
  }

  /**
   * Dissolve a layout node back to individual single nodes.
   */
  public dissolveLayoutNode(nodeId: string, windowId: number): void {
    const layout = this.layouts.get(windowId);
    if (!layout) return;

    const node = layout.getNode(nodeId);
    if (!node || node.mode === "single") return;

    const tabs = [...node.tabs];
    layout.destroyNode(nodeId);

    // Create individual nodes for each tab
    for (const tab of tabs) {
      layout.createSingleNode(tab);
    }

    // Activate the first tab
    if (tabs.length > 0) {
      this.activateTab(tabs[0]);
    }
  }

  // --- Pinned Tabs ---

  /**
   * Create a pinned tab from an existing browser tab.
   */
  public createPinnedTabFromTab(tabId: number, position?: number): PinnedTab | null {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.url) return null;

    const maxPos = this.getMaxPinnedTabPosition(tab.profileId);
    const finalPosition = position ?? maxPos + 1;

    const pinnedTab = PinnedTab.create(tab.profileId, tab.url, tab.faviconURL, finalPosition);

    this.pinnedTabs.set(pinnedTab.uniqueId, pinnedTab);

    // Mark the tab as owned by this pinned tab
    tab.owner = { kind: "pinned", pinnedTabId: pinnedTab.uniqueId };

    // Associate the tab
    pinnedTab.associate(tab.spaceId, tab.id);

    this.wirePinnedTabEvents(pinnedTab);
    this.normalizePinnedTabPositions(tab.profileId);
    this.savePinnedTab(pinnedTab);
    this.emit("pinned-tab-changed");
    this.emitStructuralChange(tab.getWindow().id);

    return pinnedTab;
  }

  /**
   * Remove a pinned tab. Associated tabs become normal.
   */
  public removePinnedTab(pinnedTabId: string): number[] {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return [];

    const associatedTabIds: number[] = [];
    for (const tabId of pinnedTab.associations.values()) {
      associatedTabIds.push(tabId);
      // Make associated tabs normal again
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.owner = { kind: "normal" };
      }
    }

    this.pinnedTabs.delete(pinnedTabId);
    this.deletePinnedTabFromDb(pinnedTabId);
    pinnedTab.destroy();

    this.emit("pinned-tab-changed");
    return associatedTabIds;
  }

  /**
   * Click a pinned tab — activate or create its associated tab.
   */
  public async clickPinnedTab(pinnedTabId: string, window: BrowserWindow): Promise<boolean> {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return false;

    const spaceId = window.currentSpaceId;
    if (!spaceId) return false;

    // Check existing association
    const associatedTabId = pinnedTab.getAssociatedTabId(spaceId);
    if (associatedTabId !== null) {
      const tab = this.tabs.get(associatedTabId);
      if (tab && !tab.isDestroyed) {
        // Move to window if needed (with placeholder handling)
        if (tab.getWindow().id !== window.id) {
          if (this.moveTabToWindowHook) {
            await this.moveTabToWindowHook(tab, window);
          } else {
            tab.setWindow(window);
          }
        }
        this.activateTab(tab);
        return true;
      }
      // Stale association — clear it
      pinnedTab.dissociate(spaceId);
    }

    // Create new tab
    const tab = await this.createTab(window.id, pinnedTab.profileId, spaceId, undefined, {
      url: pinnedTab.defaultUrl,
      owner: { kind: "pinned", pinnedTabId: pinnedTab.uniqueId }
    });

    pinnedTab.associate(spaceId, tab.id);
    this.activateTab(tab);
    return true;
  }

  /**
   * Double-click a pinned tab — navigate back to default URL.
   */
  public async doubleClickPinnedTab(pinnedTabId: string, window: BrowserWindow): Promise<boolean> {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return false;

    const spaceId = window.currentSpaceId;
    if (!spaceId) return false;

    const associatedTabId = pinnedTab.getAssociatedTabId(spaceId);
    if (associatedTabId !== null) {
      const tab = this.tabs.get(associatedTabId);
      if (tab && !tab.isDestroyed) {
        if (tab.url !== pinnedTab.defaultUrl) {
          tab.loadURL(pinnedTab.defaultUrl);
        }
        if (tab.getWindow().id !== window.id) {
          if (this.moveTabToWindowHook) {
            await this.moveTabToWindowHook(tab, window);
          } else {
            tab.setWindow(window);
          }
        }
        this.activateTab(tab);
        return true;
      }
    }

    // No associated tab — treat as single click
    return this.clickPinnedTab(pinnedTabId, window);
  }

  /**
   * Unpin a tab back to the tab list.
   */
  public unpinToTabList(pinnedTabId: string): boolean {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return false;

    // Collect affected window IDs before destroying (which clears associations)
    const affectedWindowIds = new Set<number>();
    for (const tabId of pinnedTab.associations.values()) {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.owner = { kind: "normal" };
        affectedWindowIds.add(tab.getWindow().id);
      }
    }

    this.pinnedTabs.delete(pinnedTabId);
    this.deletePinnedTabFromDb(pinnedTabId);
    pinnedTab.destroy();

    this.emit("pinned-tab-changed");

    // Emit structural change for all affected windows
    for (const windowId of affectedWindowIds) {
      this.emitStructuralChange(windowId);
    }

    return true;
  }

  /**
   * Reorder a pinned tab.
   */
  public reorderPinnedTab(pinnedTabId: string, newPosition: number): void {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return;

    pinnedTab.updatePosition(newPosition);
    this.normalizePinnedTabPositions(pinnedTab.profileId);
    this.emit("pinned-tab-changed");
  }

  /**
   * Get pinned tabs for a profile, sorted by position.
   */
  public getPinnedTabsForProfile(profileId: string): PinnedTab[] {
    const result: PinnedTab[] = [];
    for (const pt of this.pinnedTabs.values()) {
      if (pt.profileId === profileId) result.push(pt);
    }
    return result.sort((a, b) => a.position - b.position);
  }

  /**
   * Get all pinned tabs grouped by profile.
   */
  public getAllPinnedTabsByProfile(): Record<string, PinnedTab[]> {
    const result: Record<string, PinnedTab[]> = {};
    for (const pt of this.pinnedTabs.values()) {
      if (!result[pt.profileId]) result[pt.profileId] = [];
      result[pt.profileId].push(pt);
    }
    for (const profileId of Object.keys(result)) {
      result[profileId].sort((a, b) => a.position - b.position);
    }
    return result;
  }

  /**
   * Get a pinned tab by its associated tab ID (reverse lookup).
   */
  public getPinnedTabByAssociatedTabId(tabId: number): PinnedTab | undefined {
    for (const pt of this.pinnedTabs.values()) {
      if (pt.hasAssociation(tabId)) return pt;
    }
    return undefined;
  }

  // --- Tab Movement ---

  /**
   * Move a tab to a new position.
   */
  public moveTab(tabId: number, newPosition: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.updateStateProperty("position", newPosition);
    this.positioner.normalizePositions(this.getTabsInWindowSpace(tab.getWindow().id, tab.spaceId));
  }

  /**
   * Move a tab to a different space.
   */
  public moveTabToSpace(tabId: number, spaceId: string, newPosition?: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const sourceSpaceId = tab.spaceId;
    tab.setSpace(spaceId);

    if (newPosition !== undefined) {
      tab.updateStateProperty("position", newPosition);
    }

    // Normalize both spaces
    const windowId = tab.getWindow().id;
    this.positioner.normalizePositions(this.getTabsInWindowSpace(windowId, spaceId));
    if (sourceSpaceId !== spaceId) {
      this.positioner.normalizePositions(this.getTabsInWindowSpace(windowId, sourceSpaceId));
    }

    this.activateTab(tab);
  }

  /**
   * Set muted state for a tab.
   */
  public setTabMuted(tabId: number, muted: boolean): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    tab.webContents?.setAudioMuted(muted);
    tab.updateTabState();
    return true;
  }

  // --- Layout Management ---

  public getOrCreateLayout(windowId: number): TabLayout {
    let layout = this.layouts.get(windowId);
    if (!layout) {
      layout = new TabLayout(windowId, this.positioner);
      this.layouts.set(windowId, layout);

      // Forward events
      layout.on("active-changed", (wId, spaceId) => {
        this.updateTabVisibility(wId, spaceId);
        this.emit("active-changed", wId, spaceId);
      });
      layout.on("focused-tab-changed", (wId, spaceId) => {
        this.emit("focused-tab-changed", wId, spaceId);
      });

      // Exit tab fullscreen when OS window exits fullscreen
      const window = browserWindowsController.getWindowById(windowId);
      if (window) {
        window.on("leave-full-screen", () => {
          const currentSpaceId = window.currentSpaceId;
          if (!currentSpaceId) return;
          for (const tab of this.getTabsInWindowSpace(windowId, currentSpaceId)) {
            if (tab.fullScreen) {
              tab.setFullScreen(false);
            }
          }
        });
      }
    }
    return layout;
  }

  public removeLayout(windowId: number): void {
    const layout = this.layouts.get(windowId);
    if (layout) {
      layout.destroy();
      this.layouts.delete(windowId);
    }
  }

  // --- Tab Visibility ---

  /**
   * Update tab visibility for a given window+space.
   * Tabs in the active node are shown; all others in that space are hidden.
   */
  private updateTabVisibility(windowId: number, spaceId: string): void {
    const layout = this.layouts.get(windowId);
    if (!layout) return;

    const activeNode = layout.getActiveNode(spaceId);
    const tabsInSpace = this.getTabsInWindowSpace(windowId, spaceId);

    for (const tab of tabsInSpace) {
      const shouldBeVisible = activeNode !== undefined && activeNode.hasTab(tab.id);
      if (tab.visible !== shouldBeVisible) {
        // Exit fullscreen when a tab is being hidden
        if (!shouldBeVisible && tab.fullScreen) {
          tab.setFullScreen(false);
        }
        tab.visible = shouldBeVisible;
        tab.layer?.setVisible(shouldBeVisible);
      }
    }
  }

  // --- Window Space Management ---

  public setCurrentWindowSpace(windowId: number, spaceId: string): void {
    const window = browserWindowsController.getWindowById(windowId);
    if (!window) return;

    // Update visibility for old space (hide tabs) and new space (show tabs)
    const oldSpaceId = window.currentSpaceId;
    if (oldSpaceId && oldSpaceId !== spaceId) {
      // Hide tabs in old space
      const oldTabs = this.getTabsInWindowSpace(windowId, oldSpaceId);
      for (const tab of oldTabs) {
        if (tab.visible) {
          if (tab.fullScreen) {
            tab.setFullScreen(false);
          }
          tab.visible = false;
          tab.layer?.setVisible(false);
        }
      }
    }

    // Show active tab in new space
    this.updateTabVisibility(windowId, spaceId);
    this.handlePageBoundsChanged(windowId);
  }

  public handlePageBoundsChanged(windowId: number): void {
    const window = browserWindowsController.getWindowById(windowId);
    if (!window) return;

    const pageBounds = window.pageBounds;
    const tabsInWindow = this.getTabsInWindow(windowId);

    for (const tab of tabsInWindow) {
      if (!tab.visible || !tab.view) continue;

      let bounds: Electron.Rectangle;
      if (tab.fullScreen) {
        const [contentWidth, contentHeight] = window.browserWindow.getContentSize();
        bounds = { x: 0, y: 0, width: contentWidth, height: contentHeight };
      } else {
        bounds = pageBounds;
      }

      // For layout nodes with multiple tabs (glance/split), compute sub-bounds
      const layout = this.layouts.get(windowId);
      const activeNode = layout?.getActiveNode(tab.spaceId);
      if (activeNode && activeNode.tabs.length > 1) {
        const tabIndex = activeNode.tabs.indexOf(tab);
        if (tabIndex >= 0) {
          bounds = this.computeNodeTabBounds(bounds, activeNode, tabIndex);
        }
      }

      tab.view.setBounds(bounds);
      const borderRadius = tab.fullScreen ? 0 : 6;
      tab.view.setBorderRadius(borderRadius);
    }
  }

  private computeNodeTabBounds(
    pageBounds: Electron.Rectangle,
    node: TabLayoutNode,
    tabIndex: number
  ): Electron.Rectangle {
    const count = node.tabs.length;
    if (count <= 1) return pageBounds;

    if (node.mode === "split") {
      // Horizontal split
      const tabWidth = Math.floor(pageBounds.width / count);
      return {
        x: pageBounds.x + tabIndex * tabWidth,
        y: pageBounds.y,
        width: tabIndex === count - 1 ? pageBounds.width - tabIndex * tabWidth : tabWidth,
        height: pageBounds.height
      };
    }

    // Glance mode - only the front tab gets full bounds, others are hidden via visibility
    return pageBounds;
  }

  // --- Event Helpers ---

  public emitStructuralChange(windowId: number): void {
    if (quitController.isQuitting) return;
    this.emit("structural-change", windowId);
  }

  public emitContentChange(windowId: number, tabId: number): void {
    if (quitController.isQuitting) return;
    this.emit("content-change", windowId, tabId);
  }

  // --- Private Methods ---

  private wireTabEvents(tab: Tab): void {
    tab.on("updated", () => {
      if (quitController.isQuitting) return;
      this.emitContentChange(tab.getWindow().id, tab.id);
    });

    tab.on("space-changed", () => {
      if (quitController.isQuitting) return;
      this.emitStructuralChange(tab.getWindow().id);
    });

    tab.on("window-changed", (oldWindowId) => {
      if (quitController.isQuitting) return;
      this.emitStructuralChange(tab.getWindow().id);
      if (oldWindowId !== tab.getWindow().id) {
        this.emitStructuralChange(oldWindowId);
      }
    });

    tab.on("focused", () => {
      const currentLayout = this.layouts.get(tab.getWindow().id);
      if (currentLayout && this.isTabActive(tab)) {
        currentLayout.setFocusedTab(tab.spaceId, tab);
      }
    });

    tab.on("fullscreen-changed", () => {
      if (quitController.isQuitting) return;
      this.handlePageBoundsChanged(tab.getWindow().id);
    });

    tab.on("target-url-changed", (url) => {
      if (quitController.isQuitting) return;
      const window = tab.getWindow();
      if (window.destroyed) return;
      window.sendMessageToCoreWebContents("tab-service:on-target-url", {
        tabId: tab.id,
        windowId: window.id,
        url
      });
    });

    tab.on("new-tab-requested", (url, disposition, constructorOptions, handlerDetails, options) => {
      this.handleNewTabRequested(tab, url, disposition, constructorOptions, handlerDetails, options);
    });

    tab.on("destroyed", () => {
      if (quitController.isQuitting) {
        this.tabs.delete(tab.id);
        return;
      }

      const windowId = tab.getWindow().id;
      const spaceId = tab.spaceId;
      const position = tab.position;
      const currentLayout = this.layouts.get(windowId);

      // Determine if tab was active. The once("destroyed") listener from
      // TabLayoutNode.addTab may have already removed the tab from its node
      // (and auto-destroyed the node), so also check if the active node is
      // destroyed — that means this tab was its last occupant.
      let wasActive = false;
      if (currentLayout) {
        const activeNode = currentLayout.getActiveNode(spaceId);
        if (activeNode) {
          wasActive = activeNode.hasTab(tab.id) || activeNode.isDestroyed;
        }
      }

      // Store in recently closed (only normal tabs with URLs)
      if (tab.owner.kind === "normal" && tab.url) {
        this.recentlyClosed.add(this.serializeTabForPersistence(tab));
      }

      // Clean up pinned tab association
      const pinnedTab = this.getPinnedTabByAssociatedTabId(tab.id);
      if (pinnedTab) {
        pinnedTab.dissociateByTabId(tab.id);
      }

      // Remove from layout node (may already be removed by once listener)
      if (currentLayout) {
        const node = currentLayout.getNodeForTab(tab.id);
        if (node) {
          node.removeTab(tab);
        }
      }

      // Remove from tracking
      this.tabs.delete(tab.id);
      this.emit("tab-removed", tab);

      // Handle active tab selection
      if (wasActive && currentLayout) {
        currentLayout.removeActiveAndSelectNext(spaceId, position);
      }

      this.emitStructuralChange(windowId);

      // Auto-close empty popup windows
      this.reconcilePopupWindow(windowId);
    });
  }

  /**
   * If a popup window has no tabs left, close it. Otherwise, activate
   * the best remaining tab.
   */
  private reconcilePopupWindow(windowId: number): void {
    if (quitController.isQuitting) return;
    const window = browserWindowsController.getWindowById(windowId);
    if (!window || window.destroyed || window.browserWindowType !== "popup") return;

    const tabsInWindow = this.getTabsInWindow(windowId);
    if (tabsInWindow.length === 0) {
      setImmediate(() => {
        const latestWindow = browserWindowsController.getWindowById(windowId);
        if (!latestWindow || latestWindow.destroyed || latestWindow.browserWindowType !== "popup") return;
        if (this.getTabsInWindow(windowId).length > 0) return;
        latestWindow.close();
      });
      return;
    }

    // If there's no active tab, activate the most recently active one
    const layout = this.layouts.get(windowId);
    if (!layout) return;
    const currentSpaceId = window.currentSpaceId;
    if (!currentSpaceId) return;
    const activeNode = layout.getActiveNode(currentSpaceId);
    if (activeNode) return;

    // Find the best tab to activate
    const spaceTabs = tabsInWindow
      .filter((t) => t.spaceId === currentSpaceId)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const bestTab = spaceTabs[0] ?? tabsInWindow.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (bestTab) {
      this.activateTab(bestTab);
    }
  }

  private handleNewTabRequested(
    sourceTab: Tab,
    url: string,
    disposition: "new-window" | "foreground-tab" | "background-tab" | "default" | "other",
    _constructorOptions: Electron.WebContentsViewConstructorOptions | undefined,
    handlerDetails: Electron.HandlerDetails | undefined,
    options: { noLoadURL?: boolean }
  ): void {
    let windowId = sourceTab.getWindow().id;

    if (disposition === "new-window") {
      const parsedFeatures: Record<string, string | number> = {};
      if (handlerDetails?.features) {
        for (const feature of handlerDetails.features.split(",")) {
          const [key, value] = feature.trim().split("=");
          if (key && value) {
            parsedFeatures[key] = Number.isNaN(+value) ? value : +value;
          }
        }
      }

      const popupWindow = browserWindowsController.instantCreate("popup", {
        ...(parsedFeatures.width ? { width: +parsedFeatures.width } : {}),
        ...(parsedFeatures.height ? { height: +parsedFeatures.height } : {}),
        ...(parsedFeatures.left ? { x: +parsedFeatures.left } : {}),
        ...(parsedFeatures.top ? { y: +parsedFeatures.top } : {})
      });
      windowId = popupWindow.id;
    }

    const insertPosition = disposition !== "new-window" ? sourceTab.position + 0.5 : undefined;

    const isBackground = disposition === "background-tab";
    const newTab = this.createTabInternal(windowId, sourceTab.profileId, sourceTab.spaceId, undefined, {
      url,
      noLoadURL: options.noLoadURL,
      position: insertPosition,
      makeActive: !isBackground
    });

    if (insertPosition !== undefined) {
      this.positioner.normalizePositions(this.getTabsInWindowSpace(sourceTab.getWindow().id, sourceTab.spaceId));
    }

    sourceTab._lastCreatedWebContents = newTab.webContents;
  }

  private wirePinnedTabEvents(pinnedTab: PinnedTab): void {
    pinnedTab.on("association-changed", () => {
      this.emit("pinned-tab-changed");
    });
    pinnedTab.on("updated", () => {
      this.savePinnedTab(pinnedTab);
      this.emit("pinned-tab-changed");
    });
  }

  private getMaxPinnedTabPosition(profileId: string): number {
    let max = -1;
    for (const pt of this.pinnedTabs.values()) {
      if (pt.profileId === profileId && pt.position > max) {
        max = pt.position;
      }
    }
    return max;
  }

  private normalizePinnedTabPositions(profileId: string): void {
    const sorted = this.getPinnedTabsForProfile(profileId);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].position !== i) {
        sorted[i].updatePosition(i);
      }
    }
  }

  // --- Picture in Picture ---

  public disablePictureInPicture(tabId: number, goBackToTab: boolean): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.isPictureInPicture) return false;

    tab.updateStateProperty("isPictureInPicture", false);

    if (goBackToTab) {
      const win = tab.getWindow();
      setWindowSpace(win, tab.spaceId);
      win.browserWindow.focus();
      this.activateTab(tab);
    }

    return true;
  }

  // --- Batch Tab Move ---

  public batchMoveTabs(tabIds: number[], spaceId: string, window: BrowserWindow, newPositionStart?: number): boolean {
    for (let i = 0; i < tabIds.length; i++) {
      const tab = this.tabs.get(tabIds[i]);
      if (!tab) continue;

      tab.setSpace(spaceId);
      tab.setWindow(window);

      if (newPositionStart !== undefined) {
        tab.updateStateProperty("position", newPositionStart + i);
      }
    }

    this.positioner.normalizePositions(this.getTabsInWindowSpace(window.id, spaceId));
    return true;
  }

  // --- Recently Closed ---

  public getRecentlyClosed(): RecentlyClosedTabData[] {
    return this.recentlyClosed.getAll();
  }

  public async restoreRecentlyClosed(uniqueId: string, window: BrowserWindow): Promise<boolean> {
    const result = this.recentlyClosed.restore(uniqueId);
    if (!result) return false;

    const { tabData } = result;
    const space = await spacesController.get(tabData.spaceId);
    if (!space) return false;

    const tab = await this.createTab(window.id, space.profileId, tabData.spaceId, undefined, {
      uniqueId: tabData.uniqueId,
      createdAt: tabData.createdAt,
      lastActiveAt: tabData.lastActiveAt,
      position: tabData.position,
      title: tabData.title,
      faviconURL: tabData.faviconURL ?? undefined,
      navHistory: tabData.navHistory,
      navHistoryIndex: tabData.navHistoryIndex
    });

    this.activateTab(tab);
    return true;
  }

  public clearRecentlyClosed(): void {
    this.recentlyClosed.clear();
  }

  // --- Context Menus ---

  public showContextMenu(tabId: number, window: BrowserWindow): void {
    const tab = this.tabs.get(tabId);
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
            this.unpinToTabList(tab.owner.pinnedTabId);
          } else {
            this.createPinnedTabFromTab(tabId);
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
            tab.wakeUp();
            this.activateTab(tab);
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

    const mostRecent = this.recentlyClosed.peekMostRecent();
    const mostRecentTitle = mostRecent?.tabData.title;
    const truncatedTitle =
      mostRecentTitle && mostRecentTitle.length > 35
        ? mostRecentTitle.slice(0, 35).trim() + "..."
        : mostRecentTitle?.trim();

    contextMenu.append(
      new MenuItem({
        label: truncatedTitle ? `Reopen Closed Tab (${truncatedTitle})` : "Reopen Closed Tab",
        enabled: this.recentlyClosed.hasEntries(),
        click: () => {
          if (mostRecent) {
            this.restoreRecentlyClosed(mostRecent.tabData.uniqueId, window).catch((error) => {
              console.error("Failed to restore recently closed tab:", error);
            });
          }
        }
      })
    );

    contextMenu.popup({ window: window.browserWindow });
  }

  public showPinnedTabContextMenu(pinnedTabId: string, window: BrowserWindow): void {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return;

    const contextMenu = new Menu();

    contextMenu.append(
      new MenuItem({
        label: "Unpin",
        click: () => {
          const removedTabIds = this.removePinnedTab(pinnedTabId);
          for (const removedTabId of removedTabIds) {
            const tab = this.tabs.get(removedTabId);
            if (tab && !tab.isDestroyed) {
              tab.destroy();
            }
          }
        }
      })
    );

    contextMenu.append(new MenuItem({ type: "separator" }));

    const currentSpaceId = window.currentSpaceId;
    const associatedTabId = currentSpaceId ? pinnedTab.getAssociatedTabId(currentSpaceId) : null;
    const associatedTab = associatedTabId !== null ? this.tabs.get(associatedTabId) : undefined;
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

  // --- Serialization ---

  private serializeTabForPersistence(tab: Tab): PersistedTabData {
    const navHistory: NavigationEntry[] = [];
    let navHistoryIndex = 0;

    if (tab.webContents && !tab.webContents.isDestroyed()) {
      const history = tab.webContents.navigationHistory;
      const count = history.length();
      for (let i = 0; i < count; i++) {
        const entry = history.getEntryAtIndex(i);
        navHistory.push({ title: entry.title || "", url: entry.url });
      }
      navHistoryIndex = history.getActiveIndex();
    } else if (tab.url) {
      navHistory.push({ title: tab.title, url: tab.url });
      navHistoryIndex = 0;
    }

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
      navHistory,
      navHistoryIndex,
      owner: tab.owner
    };
  }
}
