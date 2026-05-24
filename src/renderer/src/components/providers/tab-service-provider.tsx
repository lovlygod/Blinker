/**
 * Tab Service Provider — React context provider for the new Tab Service v2.
 *
 * Provides reactive access to:
 * - Tabs in the current window
 * - Layout nodes (multi-tab displays)
 * - Focused/active tab state
 * - Pinned tabs
 *
 * Replaces the old TabsProvider and PinnedTabsProvider.
 */
import { useSpaces } from "@/components/providers/spaces-provider";
import { transformUrlToDisplayURL } from "@/lib/url";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { TabData, TabLayoutNodeData, WindowTabsPayload, PinnedTabData } from "~/types/tab-service";
import type { FlowTabServiceAPI } from "~/flow/interfaces/browser/tab-service";

// --- Types ---

export type TabLayoutNodeView = Omit<TabLayoutNodeData, "tabIds"> & {
  tabs: TabData[];
  active: boolean;
  focusedTab: TabData | null;
};

interface TabServiceContextValue {
  // Layout nodes (each represents one or more tabs displayed together)
  layoutNodes: TabLayoutNodeView[];
  getLayoutNodes: (spaceId: string) => TabLayoutNodeView[];
  getActiveLayoutNode: (spaceId: string) => TabLayoutNodeView | null;
  getFocusedTab: (spaceId: string) => TabData | null;

  // Current space shortcuts
  activeLayoutNode: TabLayoutNodeView | null;
  focusedTab: TabData | null;
  addressUrl: string;

  // Pinned tabs
  pinnedTabs: Record<string, PinnedTabData[]>;

  // Raw data access
  tabsPayload: WindowTabsPayload | null;
  getFocusedTabId: (spaceId: string) => number | null;
}

// --- Contexts ---

const TabServiceContext = createContext<TabServiceContextValue | null>(null);
const TabServiceFocusedContext = createContext<{ focusedTab: TabData | null; addressUrl: string } | null>(null);
const TabServiceFocusedIdContext = createContext<number | null | undefined>(undefined);
const TabServiceFocusedLoadingContext = createContext<boolean | undefined>(undefined);
const TabServiceFocusedFullscreenContext = createContext<boolean | undefined>(undefined);
const TabServicePinnedContext = createContext<Record<string, PinnedTabData[]> | undefined>(undefined);

// --- Hooks ---

export const useTabService = () => {
  const context = useContext(TabServiceContext);
  if (!context) throw new Error("useTabService must be used within a TabServiceProvider");
  return context;
};

export const useTabServiceLayoutNodes = () => {
  const context = useContext(TabServiceContext);
  if (!context) throw new Error("useTabServiceLayoutNodes must be used within a TabServiceProvider");
  return {
    layoutNodes: context.layoutNodes,
    getLayoutNodes: context.getLayoutNodes,
    getActiveLayoutNode: context.getActiveLayoutNode,
    activeLayoutNode: context.activeLayoutNode
  };
};

export const useTabServiceFocusedTab = () => {
  const context = useContext(TabServiceFocusedContext);
  if (!context) throw new Error("useTabServiceFocusedTab must be used within a TabServiceProvider");
  return context.focusedTab;
};

export const useTabServiceAddressUrl = () => {
  const context = useContext(TabServiceFocusedContext);
  if (!context) throw new Error("useTabServiceAddressUrl must be used within a TabServiceProvider");
  return context.addressUrl;
};

export const useTabServiceFocusedTabId = () => {
  const context = useContext(TabServiceFocusedIdContext);
  if (context === undefined) throw new Error("useTabServiceFocusedTabId must be used within a TabServiceProvider");
  return context;
};

export const useTabServiceFocusedTabLoading = () => {
  const context = useContext(TabServiceFocusedLoadingContext);
  if (context === undefined) throw new Error("useTabServiceFocusedTabLoading must be used within a TabServiceProvider");
  return context;
};

export const useTabServiceFocusedTabFullscreen = () => {
  const context = useContext(TabServiceFocusedFullscreenContext);
  if (context === undefined)
    throw new Error("useTabServiceFocusedTabFullscreen must be used within a TabServiceProvider");
  return context;
};

export const useTabServicePinnedTabs = () => {
  const context = useContext(TabServicePinnedContext);
  if (context === undefined) throw new Error("useTabServicePinnedTabs must be used within a TabServiceProvider");
  return context;
};

// --- Provider ---

interface TabServiceProviderProps {
  children: React.ReactNode;
}

const EMPTY_LAYOUT_NODES: TabLayoutNodeView[] = [];
const EMPTY_PINNED_TABS: Record<string, PinnedTabData[]> = {};

export const TabServiceProvider = ({ children }: TabServiceProviderProps) => {
  const { currentSpace } = useSpaces();
  const [tabsPayload, setTabsPayload] = useState<WindowTabsPayload | null>(null);
  const [pinnedTabs, setPinnedTabs] = useState<Record<string, PinnedTabData[]>>(EMPTY_PINNED_TABS);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    const api = (flow as unknown as { tabService?: FlowTabServiceAPI })?.tabService;
    if (!api) return;
    try {
      const [payload, pinned] = await Promise.all([api.getData(), api.getPinnedTabs()]);
      setTabsPayload(payload);
      setPinnedTabs(pinned);
    } catch (error) {
      console.error("[TabServiceProvider] Failed to fetch data:", error);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to updates
  useEffect(() => {
    const api = (flow as unknown as { tabService?: FlowTabServiceAPI })?.tabService;
    if (!api) return;

    const unsubFull = api.onDataUpdated((data: WindowTabsPayload) => {
      setTabsPayload(data);
    });

    const unsubContent = api.onContentUpdated((updatedTabs: TabData[]) => {
      setTabsPayload((prev) => {
        if (!prev || updatedTabs.length === 0) return prev;
        const updatesById = new Map(updatedTabs.map((t) => [t.id, t]));
        let anyChanged = false;
        const newTabs = prev.tabs.map((tab) => {
          const updated = updatesById.get(tab.id);
          if (updated) {
            anyChanged = true;
            return updated;
          }
          return tab;
        });
        if (!anyChanged) return prev;
        return { ...prev, tabs: newTabs };
      });
    });

    const unsubPinned = api.onPinnedTabsChanged((data: Record<string, PinnedTabData[]>) => {
      setPinnedTabs(data);
    });

    return () => {
      unsubFull();
      unsubContent();
      unsubPinned();
    };
  }, []);

  // Compute layout nodes
  const { layoutNodes, layoutNodesBySpaceId, activeLayoutNodeBySpaceId, focusedTabBySpaceId } = useMemo(() => {
    const layoutNodesBySpaceId = new Map<string, TabLayoutNodeView[]>();
    const activeLayoutNodeBySpaceId = new Map<string, TabLayoutNodeView | null>();
    const focusedTabBySpaceId = new Map<string, TabData | null>();

    if (!tabsPayload) {
      return {
        layoutNodes: EMPTY_LAYOUT_NODES,
        layoutNodesBySpaceId,
        activeLayoutNodeBySpaceId,
        focusedTabBySpaceId
      };
    }

    const tabById = new Map<number, TabData>();
    for (const tab of tabsPayload.tabs) {
      tabById.set(tab.id, tab);
    }

    // Resolve focused tabs
    for (const [spaceId, tabId] of Object.entries(tabsPayload.focusedTabIds)) {
      focusedTabBySpaceId.set(spaceId, tabById.get(tabId) ?? null);
    }

    // Multi-tab layout nodes from payload
    const tabsInMultiNodes = new Set<number>();
    const allNodeDatas: TabLayoutNodeData[] = [...(tabsPayload.layoutNodes ?? [])];
    for (const node of allNodeDatas) {
      for (const tabId of node.tabIds) {
        tabsInMultiNodes.add(tabId);
      }
    }

    // Create synthetic single-tab nodes for tabs not in multi-nodes
    for (const tab of tabsPayload.tabs) {
      if (tabsInMultiNodes.has(tab.id)) continue;
      allNodeDatas.push({
        id: `s-${tab.uniqueId}`,
        mode: "single",
        tabIds: [tab.id],
        frontTabId: tab.id,
        position: tab.position,
        spaceId: tab.spaceId,
        profileId: tab.profileId
      });
    }

    const activeNodeIds = new Set(Object.values(tabsPayload.activeLayoutNodeIds));

    const layoutNodes: TabLayoutNodeView[] = [];

    for (const nodeData of allNodeDatas) {
      const tabs: TabData[] = [];
      for (const tabId of nodeData.tabIds) {
        const tab = tabById.get(tabId);
        if (tab) tabs.push(tab);
      }
      if (tabs.length === 0) continue;

      // Determine if active — for synthetic nodes, check if tab is in active node
      let isActive = activeNodeIds.has(nodeData.id);
      if (!isActive && nodeData.mode === "single") {
        // For single nodes, check if its tab is in an active multi-node
        const activeNodeId = tabsPayload.activeLayoutNodeIds[nodeData.spaceId];
        if (activeNodeId === nodeData.id) isActive = true;
      }

      const focusedTab = focusedTabBySpaceId.get(nodeData.spaceId) ?? null;

      const view: TabLayoutNodeView = {
        ...nodeData,
        tabs,
        active: isActive,
        focusedTab: isActive ? focusedTab : null
      };

      layoutNodes.push(view);

      const existing = layoutNodesBySpaceId.get(nodeData.spaceId);
      if (existing) {
        existing.push(view);
      } else {
        layoutNodesBySpaceId.set(nodeData.spaceId, [view]);
      }

      if (isActive && !activeLayoutNodeBySpaceId.has(nodeData.spaceId)) {
        activeLayoutNodeBySpaceId.set(nodeData.spaceId, view);
      }
    }

    // Sort by position
    for (const [, nodes] of layoutNodesBySpaceId) {
      nodes.sort((a, b) => a.position - b.position);
    }

    return { layoutNodes, layoutNodesBySpaceId, activeLayoutNodeBySpaceId, focusedTabBySpaceId };
  }, [tabsPayload]);

  // Callbacks
  const getLayoutNodes = useCallback(
    (spaceId: string) => layoutNodesBySpaceId.get(spaceId) ?? EMPTY_LAYOUT_NODES,
    [layoutNodesBySpaceId]
  );

  const getActiveLayoutNode = useCallback(
    (spaceId: string) => activeLayoutNodeBySpaceId.get(spaceId) ?? null,
    [activeLayoutNodeBySpaceId]
  );

  const getFocusedTab = useCallback(
    (spaceId: string) => focusedTabBySpaceId.get(spaceId) ?? null,
    [focusedTabBySpaceId]
  );

  const getFocusedTabId = useCallback((spaceId: string) => tabsPayload?.focusedTabIds[spaceId] ?? null, [tabsPayload]);

  // Current space values
  const currentSpaceId = currentSpace?.id;
  const activeLayoutNode = currentSpaceId ? getActiveLayoutNode(currentSpaceId) : null;
  const focusedTab = currentSpaceId ? getFocusedTab(currentSpaceId) : null;
  const focusedTabId = focusedTab?.id ?? null;
  const addressUrl: string = focusedTab ? (transformUrlToDisplayURL(focusedTab.url) ?? "") : "";

  const contextValue = useMemo<TabServiceContextValue>(
    () => ({
      layoutNodes,
      getLayoutNodes,
      getActiveLayoutNode,
      getFocusedTab,
      activeLayoutNode,
      focusedTab,
      addressUrl,
      pinnedTabs,
      tabsPayload,
      getFocusedTabId
    }),
    [
      layoutNodes,
      getLayoutNodes,
      getActiveLayoutNode,
      getFocusedTab,
      activeLayoutNode,
      focusedTab,
      addressUrl,
      pinnedTabs,
      tabsPayload,
      getFocusedTabId
    ]
  );

  const focusedContext = useMemo(() => ({ focusedTab, addressUrl: addressUrl as string }), [focusedTab, addressUrl]);

  return (
    <TabServiceContext.Provider value={contextValue}>
      <TabServiceFocusedContext.Provider value={focusedContext}>
        <TabServiceFocusedIdContext.Provider value={focusedTabId}>
          <TabServiceFocusedLoadingContext.Provider value={focusedTab?.isLoading ?? false}>
            <TabServiceFocusedFullscreenContext.Provider value={focusedTab?.fullScreen ?? false}>
              <TabServicePinnedContext.Provider value={pinnedTabs}>{children}</TabServicePinnedContext.Provider>
            </TabServiceFocusedFullscreenContext.Provider>
          </TabServiceFocusedLoadingContext.Provider>
        </TabServiceFocusedIdContext.Provider>
      </TabServiceFocusedContext.Provider>
    </TabServiceContext.Provider>
  );
};
