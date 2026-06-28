export type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export type DownloadEntry = {
  id: number;
  profileId: string;
  url: string;
  referrer: string | null;
  filename: string;
  mimeType: string | null;
  path: string;
  totalBytes: number;
  receivedBytes: number;
  state: DownloadState;
  dangerType: string | null;
  startedAt: number;
  finishedAt: number | null;
  updatedAt: number;
  exists: boolean;
};

export type DownloadsPageCursor = {
  startedAt: number;
  id: number;
};

export type DownloadsPage = {
  downloads: DownloadEntry[];
  nextCursor: DownloadsPageCursor | null;
};
