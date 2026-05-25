import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { Tab } from "../core/tab";
import { TabLayoutNode } from "../core/tab-layout-node";
import { TabPositioner } from "./tab-positioner";
import { TabLayoutNodeMode } from "~/types/tab-service";

/**
 * TabLayout — one per window.
 *
 * Holds all TabLayoutNodes for a window. At most one layout node
 * is active (visible) at a time per space.
 *
 * Responsibilities:
 * - Tracks active layout node per space
 * - Tracks focused tab per space
 * - Manages activation history for smart tab switching on close
 * - Delegates position management to TabPositioner
 */

type WindowSpaceKey = `${number}-${string}`;

type TabLayoutEvents = {
  "active-changed": [windowId: number, spaceId: string];
  "focused-tab-changed": [windowId: number, spaceId: string];
  "layout-node-created": [TabLayoutNode];
  "layout-node-destroyed": [TabLayoutNode];
  destroyed: [];
};

export class TabLayout extends TypedEventEmitter<TabLayoutEvents> {
  public readonly windowId: number;
  public readonly positioner: TabPositioner;
  public isDestroyed: boolean = false;

  // Active layout node per space
  private activeNodeMap: Map<WindowSpaceKey, TabLayoutNode> = new Map();
  // Focused tab per space
  private focusedTabMap: Map<WindowSpaceKey, Tab> = new Map();
  // Activation history per space (layout node IDs)
  private activationHistory: Map<WindowSpaceKey, string[]> = new Map();
  // All layout nodes in this window
  private layoutNodes: Map<string, TabLayoutNode> = new Map();

  private layoutNodeCounter: number = 0;

  constructor(windowId: number, positioner: TabPositioner) {
    super();
    this.windowId = windowId;
    this.positioner = positioner;
  }

  // --- Layout Node Management ---

  /**
   * Create a new layout node wrapping a single tab.
   */
  public createSingleNode(tab: Tab): TabLayoutNode {
    const id = this.generateNodeId();
    const node = new TabLayoutNode(id, "single", tab, this.windowId);
    this.registerNode(node);
    return node;
  }

  /**
   * Create a multi-tab layout node (glance or split).
   */
  public createMultiNode(mode: Exclude<TabLayoutNodeMode, "single">, tabs: Tab[]): TabLayoutNode | null {
    if (tabs.length < 2) return null;

    const id = this.generateNodeId();
    const node = new TabLayoutNode(id, mode, tabs[0], this.windowId);
    for (let i = 1; i < tabs.length; i++) {
      node.addTab(tabs[i]);
    }
    this.registerNode(node);
    return node;
  }

  /**
   * Get a layout node by ID.
   */
  public getNode(nodeId: string): TabLayoutNode | undefined {
    return this.layoutNodes.get(nodeId);
  }

  /**
   * Get all layout nodes in a space.
   */
  public getNodesInSpace(spaceId: string): TabLayoutNode[] {
    const result: TabLayoutNode[] = [];
    for (const node of this.layoutNodes.values()) {
      if (node.spaceId === spaceId && !node.isDestroyed) {
        result.push(node);
      }
    }
    return result;
  }

  /**
   * Find the layout node containing a specific tab.
   */
  public getNodeForTab(tabId: number): TabLayoutNode | undefined {
    for (const node of this.layoutNodes.values()) {
      if (node.hasTab(tabId)) return node;
    }
    return undefined;
  }

  /**
   * Get all layout nodes, sorted by position.
   */
  public getAllNodesSorted(spaceId: string): TabLayoutNode[] {
    return this.getNodesInSpace(spaceId).sort((a, b) => a.position - b.position);
  }

  /**
   * Destroy a layout node and remove it from tracking.
   */
  public destroyNode(nodeId: string): void {
    const node = this.layoutNodes.get(nodeId);
    if (!node) return;

    this.layoutNodes.delete(nodeId);
    this.removeFromAllHistory(nodeId);

    // Clear active reference if this was active
    for (const [key, activeNode] of this.activeNodeMap) {
      if (activeNode.id === nodeId) {
        this.activeNodeMap.delete(key);
      }
    }

    if (!node.isDestroyed) {
      node.destroy();
    }
  }

  // --- Active Node Management ---

  /**
   * Set the active layout node for a space.
   */
  public setActiveNode(spaceId: string, node: TabLayoutNode): void {
    const key = this.makeKey(spaceId);
    this.activeNodeMap.set(key, node);

    // Update history
    const history = this.activationHistory.get(key) ?? [];
    const existingIdx = history.indexOf(node.id);
    if (existingIdx > -1) history.splice(existingIdx, 1);
    history.push(node.id);
    this.activationHistory.set(key, history);

    // Update focused tab
    if (node.frontTab) {
      this.setFocusedTab(spaceId, node.frontTab);
    }

    this.emit("active-changed", this.windowId, spaceId);
  }

  /**
   * Get the active layout node for a space.
   */
  public getActiveNode(spaceId: string): TabLayoutNode | undefined {
    return this.activeNodeMap.get(this.makeKey(spaceId));
  }

  /**
   * Remove active node and select next based on history/position.
   */
  public removeActiveAndSelectNext(spaceId: string, closedPosition?: number): TabLayoutNode | undefined {
    const key = this.makeKey(spaceId);
    this.activeNodeMap.delete(key);
    this.focusedTabMap.delete(key);

    // Try from history
    const history = this.activationHistory.get(key);
    if (history) {
      for (let i = history.length - 1; i >= 0; i--) {
        const node = this.layoutNodes.get(history[i]);
        if (node && !node.isDestroyed && node.spaceId === spaceId && node.tabCount > 0) {
          this.setActiveNode(spaceId, node);
          return node;
        }
      }
    }

    // Fall back to position-based
    const sorted = this.getAllNodesSorted(spaceId);
    if (sorted.length === 0) {
      this.emit("active-changed", this.windowId, spaceId);
      return undefined;
    }

    if (closedPosition !== undefined) {
      const next = sorted.find((n) => n.position >= closedPosition) ?? sorted[sorted.length - 1];
      this.setActiveNode(spaceId, next);
      return next;
    }

    this.setActiveNode(spaceId, sorted[0]);
    return sorted[0];
  }

  /**
   * Activate the next node in visual order (wraps).
   */
  public activateNextNode(spaceId: string): TabLayoutNode | undefined {
    return this.activateAdjacentNode(spaceId, 1);
  }

  /**
   * Activate the previous node in visual order (wraps).
   */
  public activatePreviousNode(spaceId: string): TabLayoutNode | undefined {
    return this.activateAdjacentNode(spaceId, -1);
  }

  /**
   * Get the next/previous node without activating it.
   */
  public getAdjacentNode(spaceId: string, delta: 1 | -1): TabLayoutNode | undefined {
    const sorted = this.getAllNodesSorted(spaceId);
    if (sorted.length === 0) return undefined;
    if (sorted.length === 1) return sorted[0];

    const active = this.getActiveNode(spaceId);
    if (!active) return sorted[0];

    const idx = sorted.findIndex((n) => n.id === active.id);
    const nextIdx = (idx + delta + sorted.length) % sorted.length;
    return sorted[nextIdx];
  }

  private activateAdjacentNode(spaceId: string, delta: 1 | -1): TabLayoutNode | undefined {
    const node = this.getAdjacentNode(spaceId, delta);
    if (node) {
      this.setActiveNode(spaceId, node);
    }
    return node;
  }

  /**
   * Check if a tab is in the currently active layout node for its space.
   */
  public isTabActive(tab: Tab): boolean {
    const active = this.getActiveNode(tab.spaceId);
    if (!active) return false;
    return active.hasTab(tab.id);
  }

  // --- Focused Tab ---

  public setFocusedTab(spaceId: string, tab: Tab): void {
    this.focusedTabMap.set(this.makeKey(spaceId), tab);
    this.emit("focused-tab-changed", this.windowId, spaceId);
  }

  public getFocusedTab(spaceId: string): Tab | undefined {
    return this.focusedTabMap.get(this.makeKey(spaceId));
  }

  public removeFocusedTab(spaceId: string): void {
    this.focusedTabMap.delete(this.makeKey(spaceId));
  }

  // --- Lifecycle ---

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    for (const node of this.layoutNodes.values()) {
      if (!node.isDestroyed) node.destroy();
    }
    this.layoutNodes.clear();
    this.activeNodeMap.clear();
    this.focusedTabMap.clear();
    this.activationHistory.clear();

    this.emit("destroyed");
    this.destroyEmitter();
  }

  // --- Private ---

  private makeKey(spaceId: string): WindowSpaceKey {
    return `${this.windowId}-${spaceId}`;
  }

  private generateNodeId(): string {
    return `ln-${this.windowId}-${this.layoutNodeCounter++}`;
  }

  private registerNode(node: TabLayoutNode): void {
    this.layoutNodes.set(node.id, node);

    node.on("destroyed", () => {
      this.layoutNodes.delete(node.id);
      this.removeFromAllHistory(node.id);
      this.emit("layout-node-destroyed", node);
    });

    this.emit("layout-node-created", node);
  }

  private removeFromAllHistory(nodeId: string): void {
    for (const history of this.activationHistory.values()) {
      const idx = history.indexOf(nodeId);
      if (idx > -1) history.splice(idx, 1);
    }
  }
}
