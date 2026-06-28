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
  // [GENERAL] Auto Update
  {
    id: "autoUpdate",
    name: "Автоматические обновления",
    showName: true,
    type: "boolean",
    defaultValue: true
  },

  // [GENERAL] Sync Tabs Across Windows
  {
    id: "syncTabsAcrossWindows",
    name: "Синхронизировать вкладки между окнами",
    showName: true,
    type: "boolean",
    defaultValue: false
  },

  // [GENERAL] Content Blocking
  {
    id: "contentBlocker",
    name: "Блокировка контента (встроенный блокировщик рекламы)",
    showName: true,
    type: "enum",
    defaultValue: "disabled",
    options: [
      {
        id: "disabled",
        name: "Отключено"
      },
      {
        id: "adsOnly",
        name: "Блокировать рекламу"
      },
      {
        id: "adsAndTrackers",
        name: "Блокировать рекламу и трекеры"
      },
      {
        id: "all",
        name: "Блокировать все (баннеры cookie и т. д.)"
      }
    ]
  },

  // [GENERAL] App Language
  {
    id: "appLanguage",
    name: "Язык интерфейса",
    showName: true,
    type: "enum",
    defaultValue: "system",
    options: [
      {
        id: "system",
        name: "Как в системе"
      },
      {
        id: "ru",
        name: "Русский"
      },
      {
        id: "en",
        name: "English"
      }
    ]
  },

  // [GENERAL] Default Search Engine
  {
    id: "defaultSearchEngine",
    name: "Поисковик по умолчанию",
    showName: true,
    type: "enum",
    defaultValue: "google",
    options: [
      {
        id: "google",
        name: "Google"
      },
      {
        id: "yandex",
        name: "Яндекс"
      },
      {
        id: "duckduckgo",
        name: "DuckDuckGo"
      },
      {
        id: "bing",
        name: "Bing"
      }
    ]
  },

  // [GENERAL] Download Directory
  {
    id: "downloadDirectory",
    name: "Download folder",
    showName: true,
    type: "string",
    defaultValue: ""
  },

  // New Tab Mode
  {
    id: "newTabMode",
    name: "Режим новой вкладки",
    showName: false,
    type: "enum",
    defaultValue: "tab",
    options: [
      {
        id: "omnibox",
        name: "Командная палитра"
      },
      {
        id: "tab",
        name: "Страница"
      }
    ]
  },

  // Command Palette Opacity
  {
    id: "commandPaletteOpacity",
    name: "Прозрачность командной палитры",
    showName: false,
    type: "enum",
    defaultValue: "tinted",
    options: [
      {
        id: "solid",
        name: "Сплошная"
      },
      {
        id: "tinted",
        name: "Тонированная (по умолчанию)"
      },
      {
        id: "glassy",
        name: "Стеклянная"
      }
    ]
  },

  // Sidebar Side
  {
    id: "sidebarSide",
    name: "Сторона боковой панели",
    showName: true,
    type: "enum",
    defaultValue: "left",
    options: [
      {
        id: "left",
        name: "Слева"
      },
      {
        id: "right",
        name: "Справа (экспериментально)"
      }
    ]
  },

  // Archive Tab After
  {
    id: "archiveTabAfter",
    name: "Архивировать вкладку через",
    showName: false,
    type: "enum",
    defaultValue: "12h",
    options: [
      {
        id: "12h",
        name: "12 часов"
      },
      {
        id: "24h",
        name: "24 часа"
      },
      {
        id: "7d",
        name: "7 дней"
      },
      {
        id: "30d",
        name: "30 дней"
      },
      {
        id: "never",
        name: "Никогда"
      }
    ]
  },

  // Sleep Tab After
  {
    id: "sleepTabAfter",
    name: "Усыплять вкладку через",
    showName: false,
    type: "enum",
    defaultValue: "never",
    options: [
      {
        id: "5m",
        name: "5 минут"
      },
      {
        id: "10m",
        name: "10 минут"
      },
      {
        id: "30m",
        name: "30 минут"
      },
      {
        id: "1h",
        name: "1 час"
      },
      {
        id: "2h",
        name: "2 часа"
      },
      {
        id: "4h",
        name: "4 часа"
      },
      {
        id: "8h",
        name: "8 часов"
      },
      {
        id: "12h",
        name: "12 часов"
      },
      {
        id: "24h",
        name: "24 часа"
      },
      {
        id: "never",
        name: "Никогда"
      }
    ]
  },

  // [EXPERIMENTAL] Enable Blinker PDF Viewer
  {
    id: "enableFlowPdfViewer",
    name: "Включить PDF-просмотрщик Blinker",
    showName: true,
    type: "boolean",
    defaultValue: false
  },

  // [ADVANCED] Enable mv2 extensions
  {
    id: "enableMv2Extensions",
    name: "Снова включить расширения Manifest V2 [нестабильно]",
    showName: true,
    type: "boolean",
    defaultValue: false
  }
];

export const BasicSettingCards: BasicSettingCard[] = [
  // General Card
  {
    title: "Общие настройки",
    subtitle: "Основные настройки приложения",
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

  // Update Card (Internal)
  {
    title: "INTERNAL_UPDATE",
    subtitle: "",
    settings: []
  },

  // New Tab Mode Card
  {
    title: "Новая вкладка",
    subtitle: "Выберите, как должны открываться новые вкладки",
    settings: ["newTabMode"]
  },

  // Command Palette Card
  {
    title: "Командная палитра",
    subtitle: "Выберите прозрачность командной палитры",
    settings: ["commandPaletteOpacity"]
  },

  // Sidebar Settings Card
  {
    title: "Боковая панель",
    subtitle: "Настройте поведение боковой панели",
    settings: ["sidebarSide"]
  },

  // Performance Settings Card
  {
    title: "Производительность",
    subtitle: "Настройки для повышения производительности",
    settings: ["archiveTabAfter", "sleepTabAfter"]
  },

  // Onboarding Card (Internal)
  {
    title: "INTERNAL_ONBOARDING",
    subtitle: "",
    settings: []
  },

  // Experimental Settings Card
  {
    title: "Экспериментальные настройки",
    subtitle: "Экспериментальные возможности Blinker",
    settings: ["enableFlowPdfViewer"]
  },

  // Advanced Settings Card
  {
    title: "Расширенные настройки",
    subtitle: "Для опытных пользователей (некоторые настройки требуют перезапуска)",
    settings: ["enableMv2Extensions"]
  }
];
