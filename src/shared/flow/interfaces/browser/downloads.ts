import type { DownloadEntry, DownloadsPage, DownloadsPageCursor } from "~/types/downloads";

export interface FlowDownloadsAPI {
  listRecent: (limit?: number) => Promise<DownloadEntry[]>;
  listPage: (args: { search?: string; limit: number; cursor?: DownloadsPageCursor }) => Promise<DownloadsPage>;
  getSessionDownloads: () => Promise<DownloadEntry[]>;
  openFile: (id: number) => Promise<boolean>;
  showInFolder: (id: number) => Promise<boolean>;
  pause: (id: number) => Promise<boolean>;
  resume: (id: number) => Promise<boolean>;
  cancel: (id: number) => Promise<boolean>;
  retry: (id: number) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
  clearAll: () => Promise<void>;
  getDownloadDirectory: () => Promise<string>;
  chooseDownloadDirectory: () => Promise<string | null>;
  resetDownloadDirectory: () => Promise<string>;
  onChanged: (callback: (downloads: DownloadEntry[]) => void) => () => void;
  onCreated: (callback: (download: DownloadEntry) => void) => () => void;
}
