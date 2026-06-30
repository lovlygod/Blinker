// This is used to create a simple settings framework.
// This will make it easier to add new settings and cards.

import type { BasicSetting, BasicSettingCard } from "~/types/settings";

/**
 * Maps archive tab duration settings to their equivalent values in seconds.
 * 'never' is mapped to Infinity.
 */
export const ArchiveTabValueMap = {
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
  never: Infinity
};

/**
 * Maps sleep tab duration settings to their equivalent values in seconds.
 * 'never' is mapped to Infinity.
 */
export const SleepTabValueMap = {
  "5m": 5 * 60,
  "10m": 10 * 60,
  "30m": 30 * 60,
  "1h": 60 * 60,
  "2h": 2 * 60 * 60,
  "4h": 4 * 60 * 60,
  "8h": 8 * 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
  never: Infinity
};

export const BasicSettings: BasicSetting[] = [
  {
    id: "autoUpdate",
    name: "Automatic updates",
    showName: true,
    type: "boolean",
    defaultValue: true
  },
  {
    id: "syncTabsAcrossWindows",
    name: "Sync tabs across windows",
    showName: true,
    type: "boolean",
    defaultValue: false
  },
  {
    id: "contentBlocker",
    name: "Content blocker",
    showName: true,
    type: "enum",
    defaultValue: "disabled",
    options: [
      { id: "disabled", name: "Disabled" },
      { id: "adsOnly", name: "Block ads" },
      { id: "adsAndTrackers", name: "Block ads and trackers" },
      { id: "all", name: "Block everything" }
    ]
  },
  {
    id: "appLanguage",
    name: "Interface language",
    showName: true,
    type: "enum",
    defaultValue: "system",
    options: [
      { id: "system", name: "System" },
      { id: "ru", name: "Russian" },
      { id: "en", name: "English" }
    ]
  },
  {
    id: "defaultSearchEngine",
    name: "Default search engine",
    showName: true,
    type: "enum",
    defaultValue: "google",
    options: [
      { id: "google", name: "Google" },
      { id: "yandex", name: "Yandex" },
      { id: "duckduckgo", name: "DuckDuckGo" },
      { id: "bing", name: "Bing" }
    ]
  },
  {
    id: "downloadDirectory",
    name: "Download folder",
    showName: true,
    type: "string",
    defaultValue: ""
  },
  {
    id: "newTabMode",
    name: "New tab mode",
    showName: false,
    type: "enum",
    defaultValue: "tab",
    options: [
      { id: "omnibox", name: "Command palette" },
      { id: "tab", name: "Page" }
    ]
  },
  {
    id: "commandPaletteOpacity",
    name: "Command palette opacity",
    showName: false,
    type: "enum",
    defaultValue: "tinted",
    options: [
      { id: "solid", name: "Solid" },
      { id: "tinted", name: "Tinted" },
      { id: "glassy", name: "Glassy" }
    ]
  },
  {
    id: "sidebarSide",
    name: "Sidebar side",
    showName: true,
    type: "enum",
    defaultValue: "left",
    options: [
      { id: "left", name: "Left" },
      { id: "right", name: "Right" }
    ]
  },
  {
    id: "archiveTabAfter",
    name: "Archive tab after",
    showName: false,
    type: "enum",
    defaultValue: "12h",
    options: [
      { id: "12h", name: "12 hours" },
      { id: "24h", name: "24 hours" },
      { id: "7d", name: "7 days" },
      { id: "30d", name: "30 days" },
      { id: "never", name: "Never" }
    ]
  },
  {
    id: "sleepTabAfter",
    name: "Sleep tab after",
    showName: false,
    type: "enum",
    defaultValue: "never",
    options: [
      { id: "5m", name: "5 minutes" },
      { id: "10m", name: "10 minutes" },
      { id: "30m", name: "30 minutes" },
      { id: "1h", name: "1 hour" },
      { id: "2h", name: "2 hours" },
      { id: "4h", name: "4 hours" },
      { id: "8h", name: "8 hours" },
      { id: "12h", name: "12 hours" },
      { id: "24h", name: "24 hours" },
      { id: "never", name: "Never" }
    ]
  },
  {
    id: "enableFlowPdfViewer",
    name: "Enable Blinker PDF viewer",
    showName: true,
    type: "boolean",
    defaultValue: false
  },
  {
    id: "enableMv2Extensions",
    name: "Enable Manifest V2 extensions",
    showName: true,
    type: "boolean",
    defaultValue: false
  }
];

export const BasicSettingCards: BasicSettingCard[] = [
  {
    title: "General settings",
    subtitle: "Core application settings",
    settings: [
      "autoUpdate",
      "syncTabsAcrossWindows",
      "appLanguage",
      "defaultSearchEngine",
      "downloadDirectory",
      "contentBlocker",
      "internal_setAsDefaultBrowser"
    ]
  },
  {
    title: "INTERNAL_UPDATE",
    subtitle: "",
    settings: []
  },
  {
    title: "New Tab Mode",
    subtitle: "Choose how new tabs open",
    settings: ["newTabMode"]
  },
  {
    title: "Command palette",
    subtitle: "Choose command palette opacity",
    settings: ["commandPaletteOpacity"]
  },
  {
    title: "Sidebar",
    subtitle: "Configure sidebar behavior",
    settings: ["sidebarSide"]
  },
  {
    title: "Performance",
    subtitle: "Settings to improve performance",
    settings: ["archiveTabAfter", "sleepTabAfter"]
  },
  {
    title: "INTERNAL_ONBOARDING",
    subtitle: "",
    settings: []
  },
  {
    title: "Experimental settings",
    subtitle: "Experimental Blinker features",
    settings: ["enableFlowPdfViewer"]
  },
  {
    title: "Advanced settings",
    subtitle: "For advanced users",
    settings: ["enableMv2Extensions"]
  }
];
