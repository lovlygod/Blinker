import { AnimatePresence, motion } from "motion/react";
import { Check, File, FolderOpen, Loader2, Pause, Play, RotateCcw, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalComponent } from "@/components/portal/portal";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { DownloadEntry } from "~/types/downloads";

export const DOWNLOADS_PREVIEW_WIDTH = 390;
export const DOWNLOADS_PREVIEW_HEIGHT = 236;

function progressValue(download: DownloadEntry) {
  if (download.state === "completed") return 100;
  if (download.totalBytes <= 0) return 8;
  return Math.max(3, Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)));
}

function stateLabel(download: DownloadEntry) {
  if (download.state === "completed") return download.exists ? "Готово" : "Удалено";
  if (download.state === "paused") return "Пауза";
  if (download.state === "cancelled") return "Отменено";
  if (download.state === "interrupted") return download.errorMessage || "Ошибка";
  return "Скачивается";
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatSpeed(bytesPerSecond: number) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

function DownloadPreviewRow({
  download,
  onInternalInteraction
}: {
  download: DownloadEntry;
  onInternalInteraction: () => void;
}) {
  const isGone = download.state === "completed" && !download.exists;
  const isActive = download.state === "progressing";
  const isPaused = download.state === "paused";
  const canRetry = download.state === "cancelled" || download.state === "interrupted" || isGone;

  const runAction = (action: () => Promise<boolean> | void) => {
    onInternalInteraction();
    void action();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.985 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-2.5 transition-colors",
        isGone ? "opacity-45" : "hover:bg-white/8"
      )}
    >
      <button
        className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-center gap-3 text-left"
        onPointerDown={onInternalInteraction}
        onClick={() => runAction(() => flow.downloads.openFile(download.id))}
        disabled={isGone || download.state !== "completed"}
      >
        <div
          className={cn(
            "relative flex size-10 shrink-0 items-center justify-center rounded-lg border shadow-sm",
            isActive ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/8 text-white/80"
          )}
        >
          {isActive ? (
            <Loader2 className="size-4 animate-spin" />
          ) : download.state === "completed" && download.exists ? (
            <Check className="size-4" />
          ) : (
            <File className="size-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-semibold text-white", isGone && "line-through")}>
            {download.filename}
          </div>
          <div className="mt-1 grid grid-cols-[auto_auto_1fr] items-center gap-2 text-[11px] text-white/55">
            <span>{stateLabel(download)}</span>
            {download.totalBytes > 0 && !isGone && <span>{formatBytes(download.totalBytes)}</span>}
            <span className="truncate">
              {download.speedBytesPerSecond > 0 ? formatSpeed(download.speedBytesPerSecond) : ""}
            </span>
          </div>
          {download.state === "progressing" && (
            <Progress value={progressValue(download)} className="mt-1.5 h-1 w-full bg-white/10" />
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {isActive && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-white/55 hover:bg-white/10 hover:text-white"
            onPointerDown={onInternalInteraction}
            onClick={() => runAction(() => flow.downloads.pause(download.id))}
            aria-label="Пауза"
          >
            <Pause className="size-3.5" />
          </Button>
        )}
        {isPaused && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-white/55 hover:bg-white/10 hover:text-white"
            onPointerDown={onInternalInteraction}
            onClick={() => runAction(() => flow.downloads.resume(download.id))}
            aria-label="Продолжить"
          >
            <Play className="size-3.5" />
          </Button>
        )}
        {(isActive || isPaused) && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-white/55 hover:bg-white/10 hover:text-white"
            onPointerDown={onInternalInteraction}
            onClick={() => runAction(() => flow.downloads.cancel(download.id))}
            aria-label="Отменить"
          >
            <X className="size-3.5" />
          </Button>
        )}
        {canRetry && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-white/55 hover:bg-white/10 hover:text-white"
            onPointerDown={onInternalInteraction}
            onClick={() => runAction(() => flow.downloads.retry(download.id))}
            aria-label="Скачать снова"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-35"
          onPointerDown={onInternalInteraction}
          onClick={() => runAction(() => flow.downloads.showInFolder(download.id))}
          disabled={!download.exists}
          aria-label="Показать в папке"
        >
          <FolderOpen className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

export function DownloadsPreview({
  open,
  downloads,
  position,
  onOpenHistory,
  onInternalInteraction
}: {
  open: boolean;
  downloads: DownloadEntry[];
  position: { left: number; top: number };
  onOpenHistory: () => void;
  onInternalInteraction: () => void;
}) {
  return (
    <PortalComponent
      visible={open}
      autoFocus
      layerType="popover"
      className="pointer-events-none fixed z-[10000]"
      style={{
        left: position.left,
        top: position.top,
        width: DOWNLOADS_PREVIEW_WIDTH,
        height: DOWNLOADS_PREVIEW_HEIGHT
      }}
    >
      <motion.div
        className="pointer-events-auto h-full w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-2 text-white shadow-2xl shadow-black/35 backdrop-blur-xl"
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.97 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onPointerDownCapture={onInternalInteraction}
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="text-sm font-semibold">Загрузки</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-white/65 hover:bg-white/10 hover:text-white"
            onPointerDown={onInternalInteraction}
            onClick={onOpenHistory}
          >
            История
          </Button>
        </div>
        <div className="max-h-[176px] overflow-hidden rounded-lg bg-white/[0.03]">
          <AnimatePresence initial={false}>
            {downloads.length > 0 ? (
              downloads.map((download) => (
                <DownloadPreviewRow
                  key={download.id}
                  download={download}
                  onInternalInteraction={onInternalInteraction}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-white/50">
                <SearchX className="size-6 opacity-60" />
                <span className="text-sm">Нет загрузок</span>
              </div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </PortalComponent>
  );
}
