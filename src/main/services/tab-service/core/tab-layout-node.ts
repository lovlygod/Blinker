import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { Tab } from "./tab";
import { TabLayoutNodeMode } from "~/types/tab-service";

/**
 * TabLayoutNode — represents tabs displayed together in a window.
 *
 * In the old system this was "TabGroup" with modes (glance, split).
 * In the new system we explicitly define this as a "layout node" to
 * avoid confusion with folder-like tab groups.
 *
 * A single tab is represented as a layout node with mode "single".
 * Multi-tab modes include "glance" (stacked preview) and "split" (side-by-side).
 */

type TabLayoutNodeEvents = {
  "tab-added": [Tab];
  "tab-removed": [Tab];
  "front-tab-changed": [Tab | null];
  changed: [];
  destroyed: [];
};

export class TabLayoutNode extends TypedEventEmitter<TabLayoutNodeEvents> {
  public readonly id: string;
  public mode: TabLayoutNodeMode;
  public isDestroyed: boolean = false;

  public windowId: number;
  public profileId: string;
  public spaceId: string;

  private _tabs: Tab[] = [];
  private _frontTab: Tab | null = null;
  private _destroyListeners: Map<number, () => void> = new Map();

  constructor(id: string, mode: TabLayoutNodeMode, initialTab: Tab, windowId: number) {
    super();

    this.id = id;
    this.mode = mode;
    this.windowId = windowId;
    this.profileId = initialTab.profileId;
    this.spaceId = initialTab.spaceId;

    this.addTab(initialTab);
  }

  // --- Accessors ---

  public get tabs(): readonly Tab[] {
    return this._tabs;
  }

  public get tabIds(): number[] {
    return this._tabs.map((t) => t.id);
  }

  public get frontTab(): Tab | null {
    return this._frontTab;
  }

  public get position(): number {
    if (this._tabs.length === 0) return 0;
    // Position is the minimum position of all contained tabs
    return Math.min(...this._tabs.map((t) => t.position));
  }

  public get tabCount(): number {
    return this._tabs.length;
  }

  // --- Tab Management ---

  public hasTab(tabId: number): boolean {
    return this._tabs.some((t) => t.id === tabId);
  }

  public getTab(tabId: number): Tab | undefined {
    return this._tabs.find((t) => t.id === tabId);
  }

  public addTab(tab: Tab): boolean {
    this.checkNotDestroyed();

    if (this.hasTab(tab.id)) return false;

    this._tabs.push(tab);

    // Set front tab for single-tab nodes
    if (this._tabs.length === 1) {
      this._frontTab = tab;
    }

    // Sync tab to this node's space/window
    if (tab.spaceId !== this.spaceId) {
      tab.setSpace(this.spaceId);
    }

    // Listen for tab destruction (guarded + tracked for cleanup)
    const onDestroyed = () => {
      this._destroyListeners.delete(tab.id);
      if (!this.isDestroyed) this.removeTab(tab);
    };
    this._destroyListeners.set(tab.id, onDestroyed);
    tab.once("destroyed", onDestroyed);

    this.emit("tab-added", tab);
    this.emit("changed");
    return true;
  }

  public removeTab(tab: Tab): boolean {
    this.checkNotDestroyed();

    const index = this._tabs.findIndex((t) => t.id === tab.id);
    if (index === -1) return false;

    // Remove the destroy listener to prevent stale callbacks
    const listener = this._destroyListeners.get(tab.id);
    if (listener) {
      tab.off("destroyed", listener);
      this._destroyListeners.delete(tab.id);
    }

    this._tabs.splice(index, 1);

    // Update front tab if needed
    if (this._frontTab?.id === tab.id) {
      this._frontTab = this._tabs[0] ?? null;
      this.emit("front-tab-changed", this._frontTab);
    }

    this.emit("tab-removed", tab);
    this.emit("changed");

    // Auto-destroy if empty
    if (this._tabs.length === 0) {
      this.destroy();
    }

    return true;
  }

  // --- Front Tab (for glance mode) ---

  public setFrontTab(tab: Tab): void {
    this.checkNotDestroyed();

    if (!this.hasTab(tab.id)) return;
    if (this._frontTab?.id === tab.id) return;

    this._frontTab = tab;
    this.emit("front-tab-changed", tab);
    this.emit("changed");
  }

  // --- Space/Window ---

  public setSpace(spaceId: string): void {
    this.checkNotDestroyed();
    if (this.spaceId === spaceId) return;

    this.spaceId = spaceId;
    for (const tab of this._tabs) {
      tab.setSpace(spaceId);
    }
    this.emit("changed");
  }

  public setWindowId(windowId: number): void {
    this.checkNotDestroyed();
    if (this.windowId === windowId) return;

    this.windowId = windowId;
    this.emit("changed");
  }

  // --- Lifecycle ---

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Clean up all destroy listeners from remaining tabs
    for (const [tabId, listener] of this._destroyListeners) {
      const tab = this._tabs.find((t) => t.id === tabId);
      if (tab) tab.off("destroyed", listener);
    }
    this._destroyListeners.clear();

    this.emit("destroyed");
    this.destroyEmitter();
  }

  private checkNotDestroyed(): void {
    if (this.isDestroyed) {
      throw new Error(`TabLayoutNode ${this.id} is already destroyed`);
    }
  }
}
