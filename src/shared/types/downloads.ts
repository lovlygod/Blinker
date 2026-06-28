export type DownloadState = "progressing" | "paused" | "completed" | "cancelled" | "interrupted";

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
  errorMessage: string | null;
  startedAt: number;
  finishedAt: number | null;
  updatedAt: number;
  exists: boolean;
  canResume: boolean;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
};

export type DownloadsPageCursor = {
  startedAt: number;
  id: number;
};

export type DownloadsPage = {
  downloads: DownloadEntry[];
  nextCursor: DownloadsPageCursor | null;
};
