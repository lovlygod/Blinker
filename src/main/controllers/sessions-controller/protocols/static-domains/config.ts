import type { StaticDomainInfo } from "./types";

export const STATIC_DOMAINS: StaticDomainInfo[] = [
  // blinker-internal
  {
    protocol: "blinker-internal",
    hostname: "main-ui",
    actual: {
      type: "route",
      route: "main-ui"
    }
  },
  {
    protocol: "blinker-internal",
    hostname: "popup-ui",
    actual: {
      type: "route",
      route: "popup-ui"
    }
  },
  {
    protocol: "blinker-internal",
    hostname: "settings",
    actual: {
      type: "route",
      route: "settings"
    }
  },
  {
    protocol: "blinker-internal",
    hostname: "omnibox",
    actual: {
      type: "route",
      route: "omnibox"
    }
  },
  {
    protocol: "blinker-internal",
    hostname: "onboarding",
    actual: {
      type: "route",
      route: "onboarding"
    }
  },

  // flow
  {
    protocol: "blinker",
    hostname: "new-tab",
    actual: {
      type: "route",
      route: "new-tab"
    }
  },
  {
    protocol: "blinker",
    hostname: "error",
    actual: {
      type: "route",
      route: "error"
    }
  },
  {
    protocol: "blinker",
    hostname: "about",
    actual: {
      type: "route",
      route: "about"
    }
  },
  {
    protocol: "blinker",
    hostname: "games",
    actual: {
      type: "route",
      route: "games"
    }
  },
  {
    protocol: "blinker",
    hostname: "omnibox",
    actual: {
      type: "route",
      route: "omnibox-debug"
    }
  },
  {
    protocol: "blinker",
    hostname: "settings",
    actual: {
      type: "route",
      route: "settings"
    }
  },
  {
    protocol: "blinker",
    hostname: "extensions",
    actual: {
      type: "route",
      route: "extensions"
    }
  },
  {
    protocol: "blinker",
    hostname: "history",
    actual: {
      type: "route",
      route: "history"
    }
  },
  {
    protocol: "blinker",
    hostname: "bookmarks",
    actual: {
      type: "route",
      route: "bookmarks"
    }
  },
  {
    protocol: "blinker",
    hostname: "downloads",
    actual: {
      type: "route",
      route: "downloads"
    }
  },
  {
    protocol: "blinker",
    hostname: "bangs",
    actual: {
      type: "route",
      route: "bangs"
    }
  },
  {
    protocol: "blinker",
    hostname: "pdf-viewer",
    actual: {
      type: "route",
      route: "pdf-viewer"
    }
  },

  // blinker-external
  {
    protocol: "blinker-external",
    // Dino Game - Taken from https://github.com/yell0wsuit/chrome-dino-enhanced
    hostname: "dino.chrome.game",
    actual: {
      type: "subdirectory",
      subdirectory: "chrome-dino-game"
    }
  },
  {
    protocol: "blinker-external",
    // Surf Game (v1) - Taken From https://github.com/yell0wsuit/ms-edge-letssurf
    hostname: "v1.surf.edge.game",
    actual: {
      type: "subdirectory",
      subdirectory: "edge-surf-game-v1"
    }
  },
  {
    protocol: "blinker-external",
    // Surf Game (v2) - Taken from https://github.com/yell0wsuit/ms-edge-surf-2
    hostname: "v2.surf.edge.game",
    actual: {
      type: "subdirectory",
      subdirectory: "edge-surf-game-v2"
    }
  }
];
