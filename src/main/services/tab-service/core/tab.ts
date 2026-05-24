import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { generateID, getCurrentTimestamp } from "@/modules/utils";
import { NavigationEntry, Session, WebContents, WebContentsView, WebPreferences } from "electron";
import { Layer } from "@/controllers/windows-controller/layer-manager";
import { BrowserWindow } from "@/controllers/windows-controller/types";
import { LoadedProfile } from "@/controllers/loaded-profiles-controller";
import { createModalTo, focusPriorities, zIndexes } from "~/layers";
import { TabOwnerRef } from "~/types/tab-service";
import { cacheFavicon } from "@/modules/favicons";
import {
  isHistoryRecordableUrl,
  recordBrowsingHistoryVisit,
  updateBrowsingHistoryTitleForOpenPage
} from "@/saving/history/browsing-history";

export const SLEEP_MODE_URL = "about:blank?sleep=true";

// Stable counter-based tab IDs
let nextTabId = 1;

// --- Types ---

type TabStateProperty =
  | "visible"
  | "isDestroyed"
  | "faviconURL"
  | "fullScreen"
  | "isPictureInPicture"
  | "asleep"
  | "lastActiveAt"
  | "position";

type TabContentProperty = "title" | "url" | "isLoading" | "audible" | "muted" | "navHistory" | "navHistoryIndex";

export type TabPublicProperty = TabStateProperty | TabContentProperty;

export type TabEvents = {
  "space-changed": [];
  "window-changed": [oldWindowId: number];
  "fullscreen-changed": [boolean];
  "new-tab-requested": [
    string,
    "new-window" | "foreground-tab" | "background-tab" | "default" | "other",
    Electron.WebContentsViewConstructorOptions | undefined,
    Electron.HandlerDetails | undefined,
    { noLoadURL?: boolean }
  ];
  focused: [];
  updated: [TabPublicProperty[]];
  destroyed: [];
};

export interface TabCreationDetails {
  profileId: string;
  spaceId: string;
  session: Session;
  loadedProfile: LoadedProfile;
}

export interface TabCreationOptions {
  uniqueId?: string;
  window: BrowserWindow;
  webContentsViewOptions?: Electron.WebContentsViewConstructorOptions;
  createdAt?: number;
  lastActiveAt?: number;
  url?: string;
  asleep?: boolean;
  position?: number;
  owner?: TabOwnerRef;
  title?: string;
  faviconURL?: string;
  navHistory?: NavigationEntry[];
  navHistoryIndex?: number;
  noLoadURL?: boolean;
  typedNavigation?: boolean;
}

function createWebContentsView(session: Session, options: Electron.WebContentsViewConstructorOptions): WebContentsView {
  const webContents = options.webContents;
  const webPreferences: WebPreferences = {
    ...(options.webPreferences || {}),
    sandbox: true,
    webSecurity: true,
    session: session,
    scrollBounce: true,
    safeDialogs: true,
    navigateOnDragDrop: true,
    transparent: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: true,
    contextIsolation: true
  };

  const webContentsView = new WebContentsView({
    webPreferences,
    ...(webContents ? { webContents } : {})
  });

  webContentsView.setVisible(false);
  return webContentsView;
}

// Background colors
const COLOR_TRANSPARENT = "#00000000";
const COLOR_BACKGROUND = "#FFFFFF";
const WHITELISTED_PROTOCOLS = ["flow:", "flow-internal:"];

/**
 * Tab — core entity owning identity, state, WebContentsView, and event emission.
 *
 * The view and webContents are nullable: sleeping tabs have no view or
 * webContents to save resources (~20-50MB RAM per sleeping tab).
 */
export class Tab extends TypedEventEmitter<TabEvents> {
  // Identity
  public readonly id: number;
  public readonly profileId: string;
  public spaceId: string;
  public readonly uniqueId: string;

  // Ownership — links this tab to a pinned tab, bookmark, or nothing
  public owner: TabOwnerRef;

  // State
  public visible: boolean = false;
  public isDestroyed: boolean = false;
  public faviconURL: string | null = null;
  public fullScreen: boolean = false;
  public isPictureInPicture: boolean = false;
  public asleep: boolean = false;
  public createdAt: number;
  public lastActiveAt: number;
  public position: number;

  // History dedup
  private pendingHistoryTypedUrl: string | null = null;
  private lastRecordedHistoryKey: string = "";

  // Content properties
  public title: string = "New Tab";
  public url: string = "";
  public isLoading: boolean = false;
  public audible: boolean = false;
  public muted: boolean = false;
  public navHistory: NavigationEntry[] = [];
  public navHistoryIndex: number = 0;

  // Nav history diff cache
  private lastNavHistoryLength: number = 0;
  private lastNavHistoryIndex: number = 0;

  // Coalescing
  private _updatePending: boolean = false;

  // View & content objects (nullable when asleep)
  public view: WebContentsView | null = null;
  public webContents: WebContents | null = null;
  public layer: Layer<WebContentsView> | null = null;

  // Private
  private readonly session: Session;
  public readonly loadedProfile: LoadedProfile;
  private window!: BrowserWindow;
  private readonly _webContentsViewOptions: Electron.WebContentsViewConstructorOptions;

  /** Signals that the tab's initial loadURL should be called after wiring. */
  public _needsInitialLoad: boolean = false;
  /** Last webContents created by a new-tab-requested event (for window.open). */
  public _lastCreatedWebContents: WebContents | null = null;

  constructor(details: TabCreationDetails, options: TabCreationOptions) {
    super();

    const { profileId, spaceId, session } = details;

    this.profileId = profileId;
    this.spaceId = spaceId;
    this.session = session;
    this.loadedProfile = details.loadedProfile;

    const {
      window,
      webContentsViewOptions = {},
      createdAt,
      lastActiveAt,
      asleep = false,
      position,
      title,
      faviconURL,
      navHistory = [],
      navHistoryIndex,
      uniqueId,
      owner = { kind: "normal" }
    } = options;

    this._webContentsViewOptions = webContentsViewOptions;
    this.uniqueId = uniqueId || generateID();
    this.owner = owner;
    this.id = nextTabId++;

    // Position
    if (position !== undefined) {
      this.position = position;
    } else {
      this.position = -1; // Will be set by TabPositioner
    }

    // Timestamps
    const now = getCurrentTimestamp();
    this.createdAt = createdAt ?? now;
    this.lastActiveAt = lastActiveAt ?? this.createdAt;

    // Restore visual states
    if (title) this.title = title;
    if (faviconURL) this.faviconURL = faviconURL;

    this.window = window;

    if (asleep) {
      this.asleep = true;
      // Nav history stored for pre-sleep state
      if (navHistory.length > 0) {
        this.navHistory = navHistory;
        this.navHistoryIndex = navHistoryIndex ?? navHistory.length - 1;
        if (navHistory[this.navHistoryIndex]) {
          this.url = navHistory[this.navHistoryIndex].url;
        }
      }
    } else {
      this.initializeView();
      this._needsInitialLoad = navHistory.length === 0;

      // Restore nav history on next tick
      if (navHistory.length > 0) {
        setImmediate(() => {
          if (this.isDestroyed) return;
          this.restoreNavigationHistory(navHistory, navHistoryIndex ?? navHistory.length - 1);
        });
      }
    }
  }

  // --- Getters ---

  public get ephemeral(): boolean {
    return this.owner.kind !== "normal";
  }

  public getWindow(): BrowserWindow {
    return this.window;
  }

  // --- Window Management ---

  public setWindow(window: BrowserWindow): void {
    const oldWindowId = this.window?.id;
    if (oldWindowId === window.id) return;

    // Remove from old window
    if (this.layer) {
      this.window?.layerManager?.pop(this.layer);
    }

    this.window = window;

    // Add to new window
    if (this.view && this.layer) {
      window.layerManager?.push(this.layer);
    } else if (this.view) {
      this.layer = new Layer(window.layerManager, this.view, zIndexes.tab, focusPriorities.tab, createModalTo("tab"));
      window.layerManager?.push(this.layer);
    }

    if (oldWindowId !== undefined) {
      this.emit("window-changed", oldWindowId);
    }
  }

  // --- Space Management ---

  public setSpace(spaceId: string): void {
    if (this.spaceId === spaceId) return;
    this.spaceId = spaceId;
    this.emit("space-changed");
  }

  // --- View Management ---

  public initializeView(): void {
    const view = createWebContentsView(this.session, this._webContentsViewOptions);
    this.view = view;
    this.webContents = view.webContents;

    // Create layer
    this.layer = new Layer(this.window.layerManager, view, zIndexes.tab, focusPriorities.tab, createModalTo("tab"));
    this.window.layerManager.push(this.layer);

    this.setupWebContentsListeners();

    // Register with extensions
    const extensions = this.loadedProfile.extensions;
    extensions.addTab(this.webContents, this.window?.browserWindow);
  }

  public teardownView(): void {
    if (!this.view) return;

    // Unregister from extensions
    if (this.webContents) {
      const extensions = this.loadedProfile.extensions;
      extensions.removeTab(this.webContents);
    }

    // Remove layer from window
    if (this.layer) {
      this.window?.layerManager?.pop(this.layer);
      this.layer = null;
    }

    // Close webContents (this effectively destroys the view)
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.close();
    }
    this.view = null;
    this.webContents = null;
  }

  // --- State Updates ---

  public updateStateProperty<K extends TabStateProperty>(key: K, value: this[K]): boolean {
    if ((this as Record<string, unknown>)[key] === value) return false;
    (this as Record<string, unknown>)[key] = value;
    this.scheduleUpdate([key]);
    return true;
  }

  public updateTabState(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return;

    const changed: TabPublicProperty[] = [];
    const wc = this.webContents;

    const newTitle = wc.getTitle() || "New Tab";
    if (this.title !== newTitle) {
      this.title = newTitle;
      changed.push("title");
    }

    const newUrl = wc.getURL();
    if (this.url !== newUrl) {
      this.url = newUrl;
      changed.push("url");
    }

    const newIsLoading = wc.isLoading();
    if (this.isLoading !== newIsLoading) {
      this.isLoading = newIsLoading;
      changed.push("isLoading");
    }

    const newAudible = wc.isCurrentlyAudible();
    if (this.audible !== newAudible) {
      this.audible = newAudible;
      changed.push("audible");
    }

    const newMuted = wc.isAudioMuted();
    if (this.muted !== newMuted) {
      this.muted = newMuted;
      changed.push("muted");
    }

    // Nav history diff
    const entries = wc.navigationHistory.getAllEntries();
    const currentIndex = wc.navigationHistory.getActiveIndex();
    if (entries.length !== this.lastNavHistoryLength || currentIndex !== this.lastNavHistoryIndex) {
      this.navHistory = entries.map((e) => ({ title: e.title || "", url: e.url }));
      this.navHistoryIndex = currentIndex;
      this.lastNavHistoryLength = entries.length;
      this.lastNavHistoryIndex = currentIndex;
      changed.push("navHistory", "navHistoryIndex");
    }

    if (changed.length > 0) {
      this.scheduleUpdate(changed);
    }
  }

  private scheduleUpdate(properties: TabPublicProperty[]): void {
    if (this._updatePending) return;
    this._updatePending = true;
    queueMicrotask(() => {
      this._updatePending = false;
      if (!this.isDestroyed) {
        this.emit("updated", properties);
      }
    });
  }

  // --- Navigation ---

  public loadURL(url: string): void {
    if (!this.webContents || this.webContents.isDestroyed()) return;
    this.webContents.loadURL(url).catch(() => {
      // Navigation cancelled or failed — ignore
    });
  }

  public restoreNavigationHistory(entries: NavigationEntry[], activeIndex: number): void {
    if (!this.webContents || this.webContents.isDestroyed()) return;

    this.webContents.navigationHistory.restore({
      entries: entries.map((e) => ({ url: e.url, title: e.title })),
      index: activeIndex
    });
  }

  // --- URL Background ---

  public applyUrlBackground(): void {
    if (!this.view) return;
    const parsedUrl = URL.parse(this.url);
    if (parsedUrl && WHITELISTED_PROTOCOLS.includes(parsedUrl.protocol || "")) {
      this.view.setBackgroundColor(COLOR_TRANSPARENT);
    } else {
      this.view.setBackgroundColor(COLOR_BACKGROUND);
    }
  }

  // --- History Recording ---

  public markTypedNavigationForNextHistoryVisit(url: string): void {
    this.pendingHistoryTypedUrl = url;
  }

  public recordBrowsingHistoryOnActivationIfNeeded(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return;
    const url = this.url;
    if (!isHistoryRecordableUrl(url)) return;

    const key = `${url}|${this.title}`;
    if (key === this.lastRecordedHistoryKey) return;
    this.lastRecordedHistoryKey = key;

    const typed = this.pendingHistoryTypedUrl === url;
    if (typed) this.pendingHistoryTypedUrl = null;

    recordBrowsingHistoryVisit({
      profileId: this.profileId,
      url,
      title: this.title,
      incrementTyped: typed
    });
  }

  // --- Lifecycle ---

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.teardownView();
    this.emit("destroyed");
    this.destroyEmitter();
  }

  // --- Private Listener Setup ---

  private setupWebContentsListeners(): void {
    if (!this.webContents) return;
    const wc = this.webContents;

    wc.on("did-start-loading", () => this.updateTabState());
    wc.on("did-stop-loading", () => this.updateTabState());
    wc.on("did-start-navigation", () => this.updateTabState());
    wc.on("did-navigate", () => {
      this.updateTabState();
      this.applyUrlBackground();
      this.recordBrowsingHistoryOnActivationIfNeeded();
    });
    wc.on("did-navigate-in-page", () => this.updateTabState());
    wc.on("page-title-updated", () => {
      this.updateTabState();
      if (isHistoryRecordableUrl(this.url)) {
        updateBrowsingHistoryTitleForOpenPage({
          profileId: this.profileId,
          url: this.url,
          title: this.title
        });
      }
    });
    wc.on("page-favicon-updated", (_event, favicons) => {
      if (favicons.length > 0) {
        const newFavicon = favicons[0];
        if (this.faviconURL !== newFavicon) {
          this.faviconURL = newFavicon;
          this.scheduleUpdate(["faviconURL"]);
          cacheFavicon(this.url, newFavicon, this.session);
        }
      }
    });
    wc.on("audio-state-changed", () => this.updateTabState());

    wc.on("focus", () => this.emit("focused"));

    // New window/tab requests
    wc.setWindowOpenHandler((details) => {
      const disposition = details.disposition;
      const url = details.url;

      if (disposition === "new-window" || disposition === "foreground-tab" || disposition === "background-tab") {
        this.emit("new-tab-requested", url, disposition, undefined, details, {});
        return { action: "deny" };
      }

      this.emit("new-tab-requested", url, "default", undefined, details, {});
      return { action: "deny" };
    });

    // Fullscreen
    wc.on("enter-html-full-screen", () => {
      this.updateStateProperty("fullScreen", true);
      this.emit("fullscreen-changed", true);
    });
    wc.on("leave-html-full-screen", () => {
      this.updateStateProperty("fullScreen", false);
      this.emit("fullscreen-changed", false);
    });
  }
}
