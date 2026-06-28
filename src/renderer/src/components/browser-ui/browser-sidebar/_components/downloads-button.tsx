import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Check, DownloadIcon, File, FolderOpen, Loader2, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/portal/popover";
import { PortalComponent } from "@/components/portal/portal";
import { Progress } from "@/components/ui/progress";
import { useBoundingRect } from "@/hooks/use-bounding-rect";
import { cn } from "@/lib/utils";
import type { DownloadEntry } from "~/types/downloads";

function progressValue(download: DownloadEntry) {
  if (download.state === "completed") return 100;
  if (download.totalBytes <= 0) return 8;
  return Math.max(3, Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)));
}

function stateLabel(download: DownloadEntry) {
  if (download.state === "completed") return download.exists ? "Готово" : "Удалено";
  if (download.state === "cancelled") return "Отменено";
  if (download.state === "interrupted") return "Ошибка";
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

function FlyingDownloadAnimation({
  anchorRef,
  flyKey,
  onComplete
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  flyKey: number;
  onComplete: () => void;
}) {
  const anchorRect = useBoundingRect(anchorRef);
  const targetX = anchorRect ? anchorRect.left + anchorRect.width / 2 - 18 : 24;
  const targetY = anchorRect ? anchorRect.top + anchorRect.height / 2 - 18 : window.innerHeight - 48;
  const startX = Math.max(220, Math.round(window.innerWidth * 0.62));
  const startY = Math.max(70, Math.round(window.innerHeight * 0.2));
  const midX = Math.round((startX + targetX) / 2);
  const midY = Math.min(startY, targetY) - 120;

  return (
    <PortalComponent visible={flyKey > 0} layerType="popover" className="fixed inset-0">
      <AnimatePresence>
        {flyKey > 0 && (
          <motion.div
            key={flyKey}
            className="pointer-events-none fixed left-0 top-0 z-popover"
            initial={{ x: startX, y: startY, scale: 1, rotate: -8, opacity: 0 }}
            animate={{
              x: [startX, midX, targetX],
              y: [startY, midY, targetY],
              scale: [1, 0.82, 0.34],
              rotate: [-8, 8, 0],
              opacity: [0, 1, 1, 0]
            }}
            exit={{ opacity: 0, scale: 0.2 }}
            transition={{ duration: 0.86, ease: [0.16, 1, 0.3, 1], times: [0, 0.62, 1] }}
            onAnimationComplete={onComplete}
          >
            <div className="relative flex size-9 items-center justify-center rounded-lg border border-white/25 bg-zinc-950/95 text-primary shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
              <Archive className="size-4" />
              <motion.span
                className="absolute -inset-2 rounded-xl border border-primary/30"
                initial={{ scale: 0.75, opacity: 0.45 }}
                animate={{ scale: 1.35, opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut", delay: 0.44 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PortalComponent>
  );
}

function DownloadRow({ download }: { download: DownloadEntry }) {
  const isGone = download.state === "completed" && !download.exists;
  const isActive = download.state === "progressing";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
        isGone ? "opacity-45" : "hover:bg-white/8"
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => void flow.downloads.openFile(download.id)}
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
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium text-white", isGone && "line-through")}>
            {download.filename}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/55">
            <span>{stateLabel(download)}</span>
            {download.totalBytes > 0 && !isGone && <span>{formatBytes(download.totalBytes)}</span>}
            {download.state === "progressing" && (
              <Progress value={progressValue(download)} className="h-1 w-20 bg-white/10" />
            )}
          </div>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-white/55 opacity-70 transition-opacity hover:bg-white/10 hover:text-white hover:opacity-100"
        onClick={() => void flow.downloads.showInFolder(download.id)}
        disabled={!download.exists}
        aria-label="Показать в папке"
      >
        <FolderOpen className="size-3.5" />
      </Button>
    </motion.div>
  );
}

export function DownloadsButton() {
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [flyKey, setFlyKey] = useState(0);
  const [flyVisible, setFlyVisible] = useState(false);
  const buttonAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void flow.downloads.getSessionDownloads().then(setDownloads);
    const unsubscribeChanged = flow.downloads.onChanged((next) => {
      setDownloads(next.slice(0, 5));
    });
    const unsubscribeCreated = flow.downloads.onCreated(() => {
      setFlyKey((value) => value + 1);
      setFlyVisible(true);
      setOpen(true);
    });
    return () => {
      unsubscribeChanged();
      unsubscribeCreated();
    };
  }, []);

  const visibleDownloads = useMemo(() => downloads.slice(0, 5), [downloads]);
  const hasSessionDownloads = visibleDownloads.length > 0;

  const openDownloadsPage = () => {
    void flow.tabs.newTab("blinker://downloads", true);
    setOpen(false);
  };

  const button = (
    <div ref={buttonAnchorRef} className="relative">
      <FlyingDownloadAnimation
        anchorRef={buttonAnchorRef}
        flyKey={flyVisible ? flyKey : 0}
        onComplete={() => setFlyVisible(false)}
      />
      <Button
        size="icon"
        className="relative size-8 bg-transparent hover:bg-black/10 dark:hover:bg-white/10"
        onClick={hasSessionDownloads ? undefined : openDownloadsPage}
        aria-label="Загрузки"
      >
        <DownloadIcon strokeWidth={2} className="w-4 h-4 text-black/80 dark:text-white/80" />
        <AnimatePresence>
          {visibleDownloads.some((download) => download.state === "progressing") && (
            <motion.span
              className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
            />
          )}
        </AnimatePresence>
      </Button>
    </div>
  );

  if (!hasSessionDownloads) return button;

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger render={button} />
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className="w-[380px] overflow-hidden border border-white/10 bg-zinc-950/95 p-2 text-white shadow-2xl backdrop-blur-xl"
        arrow={false}
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="text-sm font-semibold">Загрузки</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-white/65 hover:bg-white/10 hover:text-white"
            onClick={openDownloadsPage}
          >
            История
          </Button>
        </div>
        <div className="max-h-[360px] overflow-hidden rounded-lg bg-white/[0.03]">
          <AnimatePresence initial={false}>
            {visibleDownloads.length > 0 ? (
              visibleDownloads.map((download) => <DownloadRow key={download.id} download={download} />)
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-white/50">
                <SearchX className="size-6 opacity-60" />
                <span className="text-sm">Нет загрузок</span>
              </div>
            )}
          </AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  );
}
