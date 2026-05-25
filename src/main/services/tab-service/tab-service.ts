import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { Tab, TabCreationDetails, TabCreationOptions } from "./core/tab";
import { TabLayoutNode } from "./core/tab-layout-node";
import { PinnedTab } from "./core/pinned-tab";
import { RecentlyClosedManager } from "./core/recently-closed-manager";
import { showTabContextMenu, showPinnedTabContextMenu } from "./core/tab-context-menus";
import { TabLayout } from "./layout/tab-layout";
import { TabPositioner } from "./layout/tab-positioner";
import { PinnedTabPersistence } from "./persistence/pinned-tab-persistence";
import { startTabLifecycleTimer } from "./tab-lifecycle-timer";
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
import { WebContents } from "electron";
import { quitController } from "@/controllers/quit-controller";
import { setWindowSpace } from "@/ipc/session/spaces";
import { FLAGS } from "@/modules/flags";

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

  // Persistence delegate
  private readonly pinnedTabDb = new PinnedTabPersistence();

  // --- Initialization ---

  /**
   * Load all pinned tabs from the database into memory.
   * Called once during app startup.
   */
  public loadPinnedTabs(): void {
    const pinnedTabs = this.pinnedTabDb.loadAll();
    for (const pinnedTab of pinnedTabs) {
      this.pinnedTabs.set(pinnedTab.uniqueId, pinnedTab);
      this.wirePinnedTabEvents(pinnedTab);
    }
  }

  /**
   * Start background tasks: space-deletion cleanup & auto-sleep/archive timer.
   * Called once during initialization.
   */
  public startBackgroundTasks(): void {
    spacesController.on("space-deleted", (_profileId, spaceId) => {
      if (quitController.isQuitting) return;
      for (const tab of this.getTabsInSpace(spaceId)) {
        tab.destroy();
      }
    });

    startTabLifecycleTimer(this.tabs);
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

    // Activate the new tab unless explicitly suppressed or created asleep
    if (options.makeActive !== false && !tab.asleep) {
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
   * Wakes the tab if it is sleeping so the view is available.
   */
  private _activatingTabIds = new Set<number>();

  public activateTab(tab: Tab): void {
    // Guard against re-entry (extensions.addTab can fire selectTab → activateTab)
    if (this._activatingTabIds.has(tab.id)) return;

    const windowId = tab.getWindow().id;
    const layout = this.layouts.get(windowId);
    if (!layout) return;

    const node = layout.getNodeForTab(tab.id);
    if (!node) return;

    this._activatingTabIds.add(tab.id);
    try {
      // Wake sleeping tabs so the view exists for display
      if (tab.asleep) {
        tab.wakeUp();
      }

      // For multi-tab nodes (glance), set front tab
      if (node.mode === "glance") {
        node.setFrontTab(tab);
      }

      layout.setActiveNode(tab.spaceId, node);
      layout.setFocusedTab(tab.spaceId, tab);

      // Mark as recently active (prevents premature archive/sleep)
      tab.lastActiveAt = Math.floor(Date.now() / 1000);

      // Only update visibility/bounds if the tab's space is the window's current space.
      // A tab can be activated in a non-current space (e.g. STAW release) without
      // making it visible — it becomes visible when the user switches to that space.
      const window = browserWindowsController.getWindowById(windowId);
      if (window && !window.destroyed && window.currentSpaceId === tab.spaceId) {
        this.updateTabVisibility(windowId, tab.spaceId);
        this.handlePageBoundsChanged(windowId);
      }

      // Record browsing history on activation (deduped)
      tab.recordBrowsingHistoryOnActivationIfNeeded();

      // Notify extensions of the active tab change
      if (tab.webContents && !tab.webContents.isDestroyed()) {
        tab.loadedProfile.extensions.selectTab(tab.webContents);
      }

      // Focus the tab's layer through the LayerManager — but only if the
      // window is currently focused. Calling webContents.focus() on a
      // background window would steal OS focus (same issue reallocateFocus
      // defers to avoid). When the window later gains focus, the deferred
      // reallocateFocus handles it.
      if (tab.layer && window && !window.destroyed && window.browserWindow.isFocused()) {
        tab.layer.focus();
      }

      // Notify renderer of active tab change
      this.emitStructuralChange(windowId);
    } finally {
      this._activatingTabIds.delete(tab.id);
    }
  }

  /**
   * Migrate a tab's layout node from its current window to a new window.
   * Must be called BEFORE `tab.setWindow(newWindow)` so the old layout is still accessible.
   */
  public migrateTabBetweenLayouts(tab: Tab, toWindowId: number): void {
    const fromWindowId = tab.getWindow().id;
    if (fromWindowId === toWindowId) return;

    const fromLayout = this.layouts.get(fromWindowId);
    const toLayout = this.getOrCreateLayout(toWindowId);

    // Remove from old layout
    if (fromLayout) {
      const node = fromLayout.getNodeForTab(tab.id);
      if (node && node.mode === "single") {
        fromLayout.destroyNode(node.id);
      } else if (node) {
        node.removeTab(tab);
      }
      // Note: we intentionally keep the focusedTabMap entry in the old layout.
      // It serves as the window's "memory" of what tab it was viewing, so the
      // focus handler can pull it back when that window regains focus.
    }

    // Create a new single node in the target layout
    toLayout.createSingleNode(tab);
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

    // Mark the tab as owned by this pinned tab (ephemeral — remove stale DB record)
    tab.owner = { kind: "pinned", pinnedTabId: pinnedTab.uniqueId };
    this.emitContentChange(tab.getWindow().id, tab.id);

    // Associate the tab
    pinnedTab.associate(tab.spaceId, tab.id);

    this.wirePinnedTabEvents(pinnedTab);
    this.normalizePinnedTabPositions(tab.profileId);
    this.pinnedTabDb.save(pinnedTab);
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
    const affectedWindowIds = new Set<number>();
    for (const tabId of pinnedTab.associations.values()) {
      associatedTabIds.push(tabId);
      // Make associated tabs normal again
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.owner = { kind: "normal" };
        affectedWindowIds.add(tab.getWindow().id);
        this.emitContentChange(tab.getWindow().id, tab.id);
      }
    }

    this.pinnedTabs.delete(pinnedTabId);
    this.pinnedTabDb.delete(pinnedTabId);
    pinnedTab.destroy();

    this.emit("pinned-tab-changed");
    for (const windowId of affectedWindowIds) {
      this.emitStructuralChange(windowId);
    }
    return associatedTabIds;
  }

  /**
   * Click a pinned tab — activate or create its associated tab.
   * Pinned tabs sync across spaces: clicking in space B moves the existing
   * tab from space A to space B (one live tab per pinned tab, not per space).
   */
  public async clickPinnedTab(pinnedTabId: string, window: BrowserWindow): Promise<boolean> {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return false;

    const spaceId = window.currentSpaceId;
    if (!spaceId) return false;

    // Find the existing associated tab (any space)
    const existingTab = this.findAssociatedTab(pinnedTab);
    if (existingTab) {
      // Move to target window if needed
      if (existingTab.getWindow().id !== window.id) {
        if (this.moveTabToWindowHook) {
          await this.moveTabToWindowHook(existingTab, window);
        } else {
          this.migrateTabBetweenLayouts(existingTab, window.id);
          existingTab.setWindow(window);
        }
      }

      // Move to target space if needed
      if (existingTab.spaceId !== spaceId) {
        const oldSpaceId = existingTab.spaceId;
        pinnedTab.dissociate(oldSpaceId);
        this.moveTabToSpace(existingTab.id, spaceId);
        pinnedTab.associate(spaceId, existingTab.id);
        return true;
      }

      this.activateTab(existingTab);
      return true;
    }

    // No existing tab — create one
    const tab = await this.createTab(window.id, pinnedTab.profileId, spaceId, undefined, {
      url: pinnedTab.defaultUrl,
      owner: { kind: "pinned", pinnedTabId: pinnedTab.uniqueId }
    });

    pinnedTab.associate(spaceId, tab.id);
    this.activateTab(tab);
    return true;
  }

  /**
   * Find the live associated tab for a pinned tab (across all spaces).
   */
  private findAssociatedTab(pinnedTab: PinnedTab): Tab | null {
    for (const tabId of pinnedTab.associations.values()) {
      const tab = this.tabs.get(tabId);
      if (tab && !tab.isDestroyed) return tab;
    }
    return null;
  }

  /**
   * Double-click a pinned tab — navigate back to default URL.
   */
  public async doubleClickPinnedTab(pinnedTabId: string, window: BrowserWindow): Promise<boolean> {
    const pinnedTab = this.pinnedTabs.get(pinnedTabId);
    if (!pinnedTab) return false;

    const spaceId = window.currentSpaceId;
    if (!spaceId) return false;

    // Find existing tab across all spaces
    const existingTab = this.findAssociatedTab(pinnedTab);
    if (existingTab) {
      if (existingTab.url !== pinnedTab.defaultUrl) {
        existingTab.loadURL(pinnedTab.defaultUrl);
      }
      // Move to target window if needed
      if (existingTab.getWindow().id !== window.id) {
        if (this.moveTabToWindowHook) {
          await this.moveTabToWindowHook(existingTab, window);
        } else {
          this.migrateTabBetweenLayouts(existingTab, window.id);
          existingTab.setWindow(window);
        }
      }
      // Move to target space if needed
      if (existingTab.spaceId !== spaceId) {
        const oldSpaceId = existingTab.spaceId;
        pinnedTab.dissociate(oldSpaceId);
        this.moveTabToSpace(existingTab.id, spaceId);
        pinnedTab.associate(spaceId, existingTab.id);
        return true;
      }
      this.activateTab(existingTab);
      return true;
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
        this.emitContentChange(tab.getWindow().id, tab.id);
      }
    }

    this.pinnedTabs.delete(pinnedTabId);
    this.pinnedTabDb.delete(pinnedTabId);
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
    if (sourceSpaceId === spaceId) return;

    const windowId = tab.getWindow().id;
    const layout = this.layouts.get(windowId);

    // Hide the tab before moving (it's leaving the source space)
    if (tab.visible) {
      tab.visible = false;
      tab.layer?.setVisible(false);
    }

    // Move the layout node to the new space (this also updates tab.spaceId)
    if (layout) {
      const node = layout.getNodeForTab(tab.id);
      if (node) {
        // If this node was active in the source space, clear it and select next
        const activeInSource = layout.getActiveNode(sourceSpaceId);
        const wasActive = activeInSource?.id === node.id;

        node.setSpace(spaceId);

        if (wasActive) {
          layout.removeActiveAndSelectNext(sourceSpaceId, node.position);
        }
      } else {
        tab.setSpace(spaceId);
      }
    } else {
      tab.setSpace(spaceId);
    }

    // Clear focused tab references to this tab in the source space across ALL layouts.
    // This prevents STAW from thinking any window still "wants" this tab in the old space.
    for (const [, otherLayout] of this.layouts) {
      const focused = otherLayout.getFocusedTab(sourceSpaceId);
      if (focused?.id === tab.id) {
        otherLayout.removeFocusedTab(sourceSpaceId);
      }
    }

    if (newPosition !== undefined) {
      tab.updateStateProperty("position", newPosition);
    }

    // Normalize both spaces
    this.positioner.normalizePositions(this.getTabsInWindowSpace(windowId, spaceId));
    this.positioner.normalizePositions(this.getTabsInWindowSpace(windowId, sourceSpaceId));

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
        const wasVisible = tab.visible;

        // When a tab is being hidden, record the time so archive/sleep timers
        // measure from when the user actually stopped viewing it.
        if (!shouldBeVisible) {
          tab.lastActiveAt = Math.floor(Date.now() / 1000);
          if (tab.fullScreen) {
            tab.setFullScreen(false);
          }
        }
        tab.visible = shouldBeVisible;
        tab.layer?.setVisible(shouldBeVisible);

        // PiP transitions on visibility change
        if (wasVisible && !shouldBeVisible && tab.layer) {
          // Tab became hidden — auto-enter PiP if playing video
          const anyTabInPiP = Array.from(this.tabs.values()).some((t) => t.id !== tab.id && t.isPictureInPicture);
          const isStillVisibleElsewhere = this.isTabVisibleInAnotherWindow(tab);
          if (!anyTabInPiP && !isStillVisibleElsewhere) {
            tab.enterPictureInPicture();
          }
        } else if (!wasVisible && shouldBeVisible && tab.isPictureInPicture) {
          // Tab became visible — exit PiP
          tab.exitPictureInPicture();
        }
      }
    }
  }

  /**
   * Returns true when the tab is visible (active) in a different browser window.
   * Used to prevent auto-PiP for tabs that are still on-screen elsewhere (STAW).
   */
  private isTabVisibleInAnotherWindow(tab: Tab): boolean {
    const tabWindowId = tab.getWindow().id;
    for (const [windowId, layout] of this.layouts) {
      if (windowId === tabWindowId) continue;
      const window = browserWindowsController.getWindowById(windowId);
      if (!window || window.destroyed || window.browserWindowType !== "normal") continue;
      if (window.currentSpaceId !== tab.spaceId) continue;
      const activeNode = layout.getActiveNode(tab.spaceId);
      if (activeNode && activeNode.hasTab(tab.id)) return true;
    }
    return false;
  }

  // --- Window Space Management ---

  public setCurrentWindowSpace(windowId: number, spaceId: string, oldSpaceId?: string | null): void {
    const window = browserWindowsController.getWindowById(windowId);
    if (!window) return;

    // Update visibility for old space (hide tabs) and new space (show tabs)
    if (oldSpaceId && oldSpaceId !== spaceId) {
      // Hide tabs in old space
      const oldTabs = this.getTabsInWindowSpace(windowId, oldSpaceId);
      for (const tab of oldTabs) {
        if (tab.visible) {
          tab.lastActiveAt = Math.floor(Date.now() / 1000);
          if (tab.fullScreen) {
            tab.setFullScreen(false);
          }
          tab.visible = false;
          tab.layer?.setVisible(false);

          // Auto-PiP for hidden tabs with playing video
          if (tab.layer) {
            const anyTabInPiP = Array.from(this.tabs.values()).some((t) => t.id !== tab.id && t.isPictureInPicture);
            if (!anyTabInPiP && !this.isTabVisibleInAnotherWindow(tab)) {
              tab.enterPictureInPicture();
            }
          }
        }
      }
    }

    // Relocate pinned tabs whose live tab is in another space.
    // Pinned tabs sync across spaces — one live tab that follows the user.
    // Only relocate pinned tabs whose profile matches the target space's profile.
    const targetSpaceData = spacesController.getFromCache(spaceId);
    for (const pinnedTab of this.pinnedTabs.values()) {
      if (targetSpaceData && pinnedTab.profileId !== targetSpaceData.profileId) continue;

      const liveTab = this.findAssociatedTab(pinnedTab);
      if (!liveTab || liveTab.isDestroyed) continue;
      if (liveTab.spaceId === spaceId && liveTab.getWindow().id === windowId) continue;

      // Move to this window if needed
      if (liveTab.getWindow().id !== windowId) {
        this.migrateTabBetweenLayouts(liveTab, windowId);
        liveTab.setWindow(window);
      }

      // Move to the target space if needed
      if (liveTab.spaceId !== spaceId) {
        const oldSpaceForTab = liveTab.spaceId;
        pinnedTab.dissociate(oldSpaceForTab);
        pinnedTab.associate(spaceId, liveTab.id);
        this.moveTabToSpace(liveTab.id, spaceId);
      } else {
        this.activateTab(liveTab);
      }
    }

    const layout = this.layouts.get(windowId);

    // If no active node is set yet (e.g. tabs were restored asleep), optionally
    // activate the focused tab or the most recently active one.
    if (FLAGS.ACTIVATE_TAB_ON_SPACE_SWITCH && layout && !layout.getActiveNode(spaceId)) {
      const focused = layout.getFocusedTab(spaceId);
      if (focused && !focused.isDestroyed) {
        this.activateTab(focused);
        return;
      }
      // Fall back to the most recently active tab in this space
      const tabsInSpace = this.getTabsInWindowSpace(windowId, spaceId);
      if (tabsInSpace.length > 0) {
        const sorted = tabsInSpace.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
        this.activateTab(sorted[0]);
        return;
      }
    }

    this.updateTabVisibility(windowId, spaceId);
    this.handlePageBoundsChanged(windowId);
    this.emitStructuralChange(windowId);
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

          // Update z-index for glance mode (front tab = "tab", back tab = "tabBack")
          if (activeNode.mode === "glance") {
            const isFront = activeNode.frontTab === tab;
            tab.setLayerType(isFront ? "tab" : "tabBack");
          }
        }
      } else {
        // Single-tab node: ensure layer type is "tab" (reset from previous glance)
        tab.setLayerType("tab");
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

    // Glance mode: front tab at 85% centered, back tab at 95% centered
    const isFront = node.frontTab === node.tabs[tabIndex];
    const widthPct = isFront ? 0.85 : 0.95;
    const heightPct = isFront ? 1 : 0.975;

    const newWidth = Math.floor(pageBounds.width * widthPct);
    const newHeight = Math.floor(pageBounds.height * heightPct);
    const xOffset = Math.floor((pageBounds.width - newWidth) / 2);
    const yOffset = Math.floor((pageBounds.height - newHeight) / 2);

    return {
      x: pageBounds.x + xOffset,
      y: pageBounds.y + yOffset,
      width: newWidth,
      height: newHeight
    };
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
      // Re-serialize so persistence picks up the new windowGroupId
      this.emitContentChange(tab.getWindow().id, tab.id);
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
    constructorOptions: Electron.WebContentsViewConstructorOptions | undefined,
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
      webContentsViewOptions: constructorOptions,
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
      this.pinnedTabDb.save(pinnedTab);
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

      // Hide if leaving the current space
      if (tab.spaceId !== spaceId && tab.visible) {
        tab.visible = false;
        tab.layer?.setVisible(false);
      }

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
    showTabContextMenu(this, tabId, window);
  }

  public showPinnedTabContextMenu(pinnedTabId: string, window: BrowserWindow): void {
    showPinnedTabContextMenu(this, pinnedTabId, window);
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
