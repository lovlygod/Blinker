import { useSpaces } from "@/components/providers/spaces-provider";
import { transformUrlToDisplayURL } from "@/lib/url";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TabData, TabLayoutNodeData, WindowTabsPayload } from "~/types/tab-service";

export type TabGroup = {
  id: string;
  mode: string;
  profileId: string;
  spaceId: string;
  position: number;
  tabIds: number[];
  frontTabId?: number;
  tabs: TabData[];
  active: boolean;
  focusedTab: TabData | null;
};

type TabGroupCacheEntry = {
  source: TabLayoutNodeData | null;
  tabs: TabData[];
  active: boolean;
  focusedTab: TabData | null;
  value: TabGroup;
};

interface TabsContextValue {
  tabGroups: TabGroup[];
  getTabGroups: (spaceId: string) => TabGroup[];
  getActiveTabGroup: (spaceId: string) => TabGroup | null;
  getFocusedTab: (spaceId: string) => TabData | null;

  // Current Space //
  activeTabGroup: TabGroup | null;
  focusedTab: TabData | null;
  addressUrl: string;

  // Utilities //
  tabsData: WindowTabsPayload | null;
  getActiveTabId: (spaceId: string) => number[] | null;
  getFocusedTabId: (spaceId: string) => number | null;
}

const TabsContext = createContext<TabsContextValue | null>(null);
const TabsGroupsContext = createContext<Pick<
  TabsContextValue,
  "tabGroups" | "getTabGroups" | "getActiveTabGroup" | "getFocusedTab" | "activeTabGroup"
> | null>(null);
const TabsFocusedContext = createContext<Pick<TabsContextValue, "focusedTab" | "addressUrl"> | null>(null);
const TabsFocusedIdContext = createContext<number | null | undefined>(undefined);
const TabsFocusedLoadingContext = createContext<boolean | undefined>(undefined);
const TabsFocusedFullscreenContext = createContext<boolean | undefined>(undefined);

export const useTabs = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("useTabs must be used within a TabsProvider");
  }
  return context;
};

export const useTabsGroups = () => {
  const context = useContext(TabsGroupsContext);
  if (!context) {
    throw new Error("useTabsGroups must be used within a TabsProvider");
  }
  return context;
};

export const useFocusedTab = () => {
  const context = useContext(TabsFocusedContext);
  if (!context) {
    throw new Error("useFocusedTab must be used within a TabsProvider");
  }
  return context.focusedTab;
};

export const useAddressUrl = () => {
  const context = useContext(TabsFocusedContext);
  if (!context) {
    throw new Error("useAddressUrl must be used within a TabsProvider");
  }
  return context.addressUrl;
};

export const useFocusedTabId = () => {
  const context = useContext(TabsFocusedIdContext);
  if (context === undefined) {
    throw new Error("useFocusedTabId must be used within a TabsProvider");
  }
  return context;
};

export const useFocusedTabLoading = () => {
  const context = useContext(TabsFocusedLoadingContext);
  if (context === undefined) {
    throw new Error("useFocusedTabLoading must be used within a TabsProvider");
  }
  return context;
};

export const useFocusedTabFullscreen = () => {
  const context = useContext(TabsFocusedFullscreenContext);
  if (context === undefined) {
    throw new Error("useFocusedTabFullscreen must be used within a TabsProvider");
  }
  return context;
};

interface TabsProviderProps {
  children: React.ReactNode;
}

const EMPTY_TAB_GROUPS: TabGroup[] = [];
const EMPTY_TAB_GROUP_CACHE = new Map<string, TabGroupCacheEntry>();

function areSameTabRefs(a: TabData[], b: TabData[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const TabsProvider = ({ children }: TabsProviderProps) => {
  const { currentSpace } = useSpaces();
  const [tabsData, setTabsData] = useState<WindowTabsPayload | null>(null);
  const tabGroupCacheRef = useRef<Map<string, TabGroupCacheEntry>>(EMPTY_TAB_GROUP_CACHE);

  const fetchTabs = useCallback(async () => {
    if (!flow) return;
    try {
      const data = await flow.tabService.getData();
      setTabsData(data);
    } catch (error) {
      console.error("Failed to fetch tabs data:", error);
    }
  }, []);

  useEffect(() => {
    fetchTabs();
  }, [fetchTabs]);

  useEffect(() => {
    if (!flow) return;

    // Full data refresh (structural changes: tab created/removed, active tab changed)
    const unsubFull = flow.tabService.onDataUpdated((data) => {
      setTabsData(data);
    });

    // Lightweight content update (title, url, isLoading, etc.)
    // Merges changed tabs into existing state without replacing the full object.
    const unsubContent = flow.tabService.onContentUpdated((updatedTabs) => {
      setTabsData((prev) => {
        if (!prev) return prev;
        if (updatedTabs.length === 0) return prev;

        // Build lookup for fast matching
        const updatesById = new Map(updatedTabs.map((t) => [t.id, t]));

        // Replace only changed tabs and keep untouched entries by reference.
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

    return () => {
      unsubFull();
      unsubContent();
    };
  }, []);

  const getActiveTabId = useCallback(
    (spaceId: string) => {
      if (!tabsData) return null;
      // Resolve from active layout node
      const activeNodeId = tabsData.activeLayoutNodeIds[spaceId];
      if (!activeNodeId) return null;
      // Find the node to get its tab IDs
      const node = tabsData.layoutNodes.find((n) => n.id === activeNodeId);
      if (node) return node.tabIds;
      // For single nodes (not in layoutNodes), the node ID is the tab ID string
      const tabId = parseInt(activeNodeId);
      if (!isNaN(tabId)) return [tabId];
      return null;
    },
    [tabsData]
  );

  const getFocusedTabId = useCallback(
    (spaceId: string) => {
      return tabsData?.focusedTabIds[spaceId] || null;
    },
    [tabsData]
  );

  const { tabGroups, tabGroupsBySpaceId, activeTabGroupBySpaceId, focusedTabBySpaceId, nextTabGroupCache } =
    useMemo(() => {
      const tabGroupsBySpaceId = new Map<string, TabGroup[]>();
      const activeTabGroupBySpaceId = new Map<string, TabGroup | null>();
      const focusedTabBySpaceId = new Map<string, TabData | null>();
      const nextTabGroupCache = new Map<string, TabGroupCacheEntry>();
      const previousTabGroupCache = tabGroupCacheRef.current;

      if (!tabsData) {
        return {
          tabGroups: EMPTY_TAB_GROUPS,
          tabGroupsBySpaceId,
          activeTabGroupBySpaceId,
          focusedTabBySpaceId,
          nextTabGroupCache
        };
      }

      const tabById = new Map<number, TabData>();
      for (const tab of tabsData.tabs) {
        tabById.set(tab.id, tab);
      }

      // Build active node IDs set per space
      const activeNodeBySpace = new Map<string, string>();
      for (const [spaceId, nodeId] of Object.entries(tabsData.activeLayoutNodeIds)) {
        activeNodeBySpace.set(spaceId, nodeId);
      }

      for (const [spaceId, focusedTabId] of Object.entries(tabsData.focusedTabIds)) {
        focusedTabBySpaceId.set(spaceId, tabById.get(focusedTabId) ?? null);
      }

      // Collect tabs that are part of multi-tab layout nodes
      const tabsInNodes = new Set<number>();
      for (const node of tabsData.layoutNodes) {
        for (const tabId of node.tabIds) {
          tabsInNodes.add(tabId);
        }
      }

      // Build tab groups from layout nodes (multi-tab: glance/split)
      interface InternalGroupData {
        id: string;
        mode: string;
        profileId: string;
        spaceId: string;
        tabIds: number[];
        frontTabId?: number;
        position: number;
        nodeData: TabLayoutNodeData | null;
      }

      const allGroupDatas: InternalGroupData[] = [];

      for (const node of tabsData.layoutNodes) {
        allGroupDatas.push({
          id: node.id,
          mode: node.mode,
          profileId: node.profileId,
          spaceId: node.spaceId,
          tabIds: node.tabIds,
          frontTabId: node.frontTabId,
          position: node.position,
          nodeData: node
        });
      }

      // Create synthetic single-tab groups for tabs not in any multi-tab node.
      // Skip pinned/bookmark-owned tabs — they appear in the pin grid, not the sidebar.
      for (const tab of tabsData.tabs) {
        if (tabsInNodes.has(tab.id)) continue;
        if (tab.owner.kind !== "normal") continue;
        allGroupDatas.push({
          id: `s-${tab.uniqueId}`,
          mode: "single",
          profileId: tab.profileId,
          spaceId: tab.spaceId,
          tabIds: [tab.id],
          position: tab.position,
          nodeData: null
        });
      }

      const tabGroups: TabGroup[] = [];

      for (const groupData of allGroupDatas) {
        const tabs: TabData[] = [];
        for (const tabId of groupData.tabIds) {
          const tab = tabById.get(tabId);
          if (tab) {
            tabs.push(tab);
          }
        }

        if (tabs.length === 0) continue;

        const activeNodeId = activeNodeBySpace.get(groupData.spaceId);
        // For synthetic single-tab groups, check if any of their tabs match the active node
        let isActive = false;
        if (activeNodeId) {
          if (groupData.id === activeNodeId) {
            isActive = true;
          } else if (groupData.mode === "single") {
            // Single-node ID format: check if active node references this tab
            const activeTabId = parseInt(activeNodeId);
            if (!isNaN(activeTabId) && groupData.tabIds.includes(activeTabId)) {
              isActive = true;
            }
          }
        }

        const focusedTab = focusedTabBySpaceId.get(groupData.spaceId) ?? null;

        const tabGroupKey = `${groupData.spaceId}:${groupData.id}`;
        const previousEntry = previousTabGroupCache.get(tabGroupKey);

        let tabGroup: TabGroup;
        if (
          previousEntry &&
          previousEntry.source === groupData.nodeData &&
          previousEntry.active === isActive &&
          previousEntry.focusedTab === focusedTab &&
          areSameTabRefs(previousEntry.tabs, tabs)
        ) {
          tabGroup = previousEntry.value;
        } else {
          tabGroup = {
            id: groupData.id,
            mode: groupData.mode,
            profileId: groupData.profileId,
            spaceId: groupData.spaceId,
            position: groupData.position,
            tabIds: groupData.tabIds,
            frontTabId: groupData.frontTabId,
            tabs,
            active: isActive,
            focusedTab
          };
        }

        nextTabGroupCache.set(tabGroupKey, {
          source: groupData.nodeData,
          tabs,
          active: isActive,
          focusedTab,
          value: tabGroup
        });
        tabGroups.push(tabGroup);

        const existingGroups = tabGroupsBySpaceId.get(groupData.spaceId);
        if (existingGroups) {
          existingGroups.push(tabGroup);
        } else {
          tabGroupsBySpaceId.set(groupData.spaceId, [tabGroup]);
        }

        if (isActive && !activeTabGroupBySpaceId.has(groupData.spaceId)) {
          activeTabGroupBySpaceId.set(groupData.spaceId, tabGroup);
        }
      }

      for (const [spaceId, spaceTabGroups] of tabGroupsBySpaceId) {
        spaceTabGroups.sort((a, b) => a.position - b.position);
        if (!activeTabGroupBySpaceId.has(spaceId)) {
          activeTabGroupBySpaceId.set(spaceId, null);
        }
        if (!focusedTabBySpaceId.has(spaceId)) {
          focusedTabBySpaceId.set(spaceId, null);
        }
      }

      return {
        tabGroups,
        tabGroupsBySpaceId,
        activeTabGroupBySpaceId,
        focusedTabBySpaceId,
        nextTabGroupCache
      };
    }, [tabsData]);

  useEffect(() => {
    tabGroupCacheRef.current = nextTabGroupCache;
  }, [nextTabGroupCache]);

  const getTabGroups = useCallback(
    (spaceId: string) => {
      return tabGroupsBySpaceId.get(spaceId) ?? EMPTY_TAB_GROUPS;
    },
    [tabGroupsBySpaceId]
  );

  const getActiveTabGroup = useCallback(
    (spaceId: string) => {
      return activeTabGroupBySpaceId.get(spaceId) ?? null;
    },
    [activeTabGroupBySpaceId]
  );

  const getFocusedTab = useCallback(
    (spaceId: string) => {
      return focusedTabBySpaceId.get(spaceId) ?? null;
    },
    [focusedTabBySpaceId]
  );

  const activeTabGroup = useMemo(() => {
    if (!currentSpace) return null;
    return getActiveTabGroup(currentSpace.id);
  }, [getActiveTabGroup, currentSpace]);

  const focusedTab = useMemo(() => {
    if (!currentSpace) return null;
    return getFocusedTab(currentSpace.id);
  }, [getFocusedTab, currentSpace]);

  const addressUrl = useMemo(() => {
    if (!focusedTab) return "";

    const transformedUrl = transformUrlToDisplayURL(focusedTab.url);
    if (transformedUrl === null) {
      return focusedTab.url;
    } else {
      if (transformedUrl) {
        return transformedUrl;
      } else {
        return "";
      }
    }
  }, [focusedTab]);

  const groupsContextValue = useMemo(
    () => ({
      tabGroups,
      getTabGroups,
      getActiveTabGroup,
      getFocusedTab,
      activeTabGroup
    }),
    [tabGroups, getTabGroups, getActiveTabGroup, getFocusedTab, activeTabGroup]
  );

  const focusedContextValue = useMemo(
    () => ({
      focusedTab,
      addressUrl
    }),
    [focusedTab, addressUrl]
  );
  // Use the raw numeric ID from the main process for the pin grid's
  // active-state detection, which compares against associatedTabId directly.
  const focusedTabId = (currentSpace && tabsData?.focusedTabIds[currentSpace.id]) ?? null;
  const isFocusedTabLoading = focusedTab?.isLoading ?? false;
  const isFocusedTabFullscreen = focusedTab?.fullScreen ?? false;

  const contextValue = useMemo(
    () => ({
      ...groupsContextValue,
      ...focusedContextValue,
      // Utilities //
      tabsData,
      getActiveTabId,
      getFocusedTabId
    }),
    [groupsContextValue, focusedContextValue, tabsData, getActiveTabId, getFocusedTabId]
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <TabsGroupsContext.Provider value={groupsContextValue}>
        <TabsFocusedContext.Provider value={focusedContextValue}>
          <TabsFocusedIdContext.Provider value={focusedTabId}>
            <TabsFocusedLoadingContext.Provider value={isFocusedTabLoading}>
              <TabsFocusedFullscreenContext.Provider value={isFocusedTabFullscreen}>
                {children}
              </TabsFocusedFullscreenContext.Provider>
            </TabsFocusedLoadingContext.Provider>
          </TabsFocusedIdContext.Provider>
        </TabsFocusedContext.Provider>
      </TabsGroupsContext.Provider>
    </TabsContext.Provider>
  );
};
