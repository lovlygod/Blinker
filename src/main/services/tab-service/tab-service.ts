import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { Tab, TabCreationDetails, TabCreationOptions } from "./core/tab";
import { TabLayoutNode } from "./core/tab-layout-node";
import { PinnedTab } from "./core/pinned-tab";
import { TabLayout } from "./layout/tab-layout";
import { TabPositioner } from "./layout/tab-positioner";
import { TabLayoutNodeMode } from "~/types/tab-service";
import { browserWindowsController } from "@/controllers/windows-controller/interfaces/browser";
import { spacesController } from "@/controllers/spaces-controller";
import { loadedProfilesController } from "@/controllers/loaded-profiles-controller";
import { BrowserWindow } from "@/controllers/windows-controller/types";
import { WebContents } from "electron";
import { quitController } from "@/controllers/quit-controller";

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

  // Shared positioner
  public readonly positioner: TabPositioner = new TabPositioner();

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
    this.wireTabEvents(tab, layout);

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

  // --- Active Tab Management ---

  /**
   * Activate a layout node (makes it visible).
   */
  public activateNode(windowId: number, spaceId: string, node: TabLayoutNode): void {
    const layout = this.layouts.get(windowId);
    if (!layout) return;

    layout.setActiveNode(spaceId, node);
  }

  /**
   * Activate a tab by finding its layout node and making it active.
   */
  public activateTab(tab: Tab): void {
    const layout = this.layouts.get(tab.getWindow().id);
    if (!layout) return;

    const node = layout.getNodeForTab(tab.id);
    if (!node) return;

    // For multi-tab nodes (glance), set front tab
    if (node.mode === "glance") {
      node.setFrontTab(tab);
    }

    layout.setActiveNode(tab.spaceId, node);
    layout.setFocusedTab(tab.spaceId, tab);
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
        // Move to window if needed
        if (tab.getWindow().id !== window.id) {
          tab.setWindow(window);
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
          tab.setWindow(window);
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
        this.emit("active-changed", wId, spaceId);
      });
      layout.on("focused-tab-changed", (wId, spaceId) => {
        this.emit("focused-tab-changed", wId, spaceId);
      });
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

  private wireTabEvents(tab: Tab, layout: TabLayout): void {
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
      if (this.isTabActive(tab)) {
        layout.setFocusedTab(tab.spaceId, tab);
      }
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
      const wasActive = this.isTabActive(tab);
      const position = tab.position;

      // Clean up pinned tab association
      const pinnedTab = this.getPinnedTabByAssociatedTabId(tab.id);
      if (pinnedTab) {
        pinnedTab.dissociateByTabId(tab.id);
      }

      // Remove from layout node
      const node = layout.getNodeForTab(tab.id);
      if (node) {
        node.removeTab(tab);
      }

      // Remove from tracking
      this.tabs.delete(tab.id);
      this.emit("tab-removed", tab);

      // Handle active tab selection
      if (wasActive) {
        layout.removeActiveAndSelectNext(spaceId, position);
      }

      this.emitStructuralChange(windowId);
    });
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

    const newTab = this.createTabInternal(windowId, sourceTab.profileId, sourceTab.spaceId, undefined, {
      url,
      noLoadURL: options.noLoadURL,
      position: insertPosition
    });

    if (insertPosition !== undefined) {
      this.positioner.normalizePositions(this.getTabsInWindowSpace(sourceTab.getWindow().id, sourceTab.spaceId));
    }

    sourceTab._lastCreatedWebContents = newTab.webContents;

    if (disposition === "foreground-tab" || disposition === "new-window") {
      this.activateTab(newTab);
    }
  }

  private wirePinnedTabEvents(pinnedTab: PinnedTab): void {
    pinnedTab.on("association-changed", () => {
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
}
