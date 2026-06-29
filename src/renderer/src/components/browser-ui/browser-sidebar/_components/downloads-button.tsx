import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, DownloadIcon, File, FolderOpen, Loader2, Pause, Play, RotateCcw, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalComponent } from "@/components/portal/portal";
import { Progress } from "@/components/ui/progress";
import { useBoundingRect } from "@/hooks/use-bounding-rect";
import { cn } from "@/lib/utils";
import type { DownloadEntry } from "~/types/downloads";

const DOWNLOAD_ANIMATION_DURATION_MS = 1000;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 260;
const PANEL_GAP = 12;

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

function ZenDownloadArcAnimation({
  anchorRef,
  animationKey,
  visible,
  onComplete
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  animationKey: number;
  visible: boolean;
  onComplete: () => void;
}) {
  const [target, setTarget] = useState({ x: 32, y: window.innerHeight - 44 });

  useEffect(() => {
    if (!visible) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTarget({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }, [anchorRef, animationKey, visible]);

  const startX = target.x + 46;
  const startY = Math.max(72, target.y - 118);
  const midX = target.x + 72;
  const midY = Math.max(48, target.y - 52);

  return (
    <PortalComponent visible={visible} layerType="popover" className="pointer-events-none fixed inset-0 z-[10000]">
      <AnimatePresence>
        {visible && (
          <motion.div
            key={animationKey}
            className="pointer-events-none fixed left-0 top-0 z-[10000]"
            initial={{ x: startX, y: startY, scale: 0.72, opacity: 0, rotate: -14 }}
            animate={{
              x: [startX, midX, target.x],
              y: [startY, midY, target.y],
              scale: [0.72, 1.28, 0.42],
              opacity: [0, 1, 1, 0],
              rotate: [-14, 10, 0]
            }}
            exit={{ opacity: 0, scale: 0.36 }}
            transition={{
              duration: DOWNLOAD_ANIMATION_DURATION_MS / 1000,
              ease: [0.37, 0, 0.63, 1],
              times: [0, 0.58, 1]
            }}
            onAnimationComplete={onComplete}
          >
            <div className="relative flex size-8 items-center justify-center rounded-full bg-white/16 p-0.5 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md">
              <div className="flex size-full items-center justify-center rounded-full bg-zinc-950/95 text-primary">
                <DownloadIcon className="size-4" />
              </div>
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
  const isPaused = download.state === "paused";
  const canRetry = download.state === "cancelled" || download.state === "interrupted" || isGone;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
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
            {download.speedBytesPerSecond > 0 && <span>{formatSpeed(download.speedBytesPerSecond)}</span>}
            {download.state === "progressing" && (
              <Progress value={progressValue(download)} className="h-1 w-20 bg-white/10" />
            )}
          </div>
        </div>
      </button>
      {isActive && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-white/55 opacity-70 transition-opacity hover:bg-white/10 hover:text-white hover:opacity-100"
          onClick={() => void flow.downloads.pause(download.id)}
          aria-label="Пауза"
        >
          <Pause className="size-3.5" />
        </Button>
      )}
      {isPaused && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-white/55 opacity-70 transition-opacity hover:bg-white/10 hover:text-white hover:opacity-100"
          onClick={() => void flow.downloads.resume(download.id)}
          aria-label="Продолжить"
        >
          <Play className="size-3.5" />
        </Button>
      )}
      {(isActive || isPaused) && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-white/55 opacity-70 transition-opacity hover:bg-white/10 hover:text-white hover:opacity-100"
          onClick={() => void flow.downloads.cancel(download.id)}
          aria-label="Отменить"
        >
          <X className="size-3.5" />
        </Button>
      )}
      {canRetry && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-white/55 opacity-70 transition-opacity hover:bg-white/10 hover:text-white hover:opacity-100"
          onClick={() => void flow.downloads.retry(download.id)}
          aria-label="Скачать снова"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      )}
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
  const [animationKey, setAnimationKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isButtonPulsing, setIsButtonPulsing] = useState(false);
  const buttonAnchorRef = useRef<HTMLDivElement>(null);
  const latestDownloadsRef = useRef<DownloadEntry[]>([]);
  const lastSeenDownloadIdRef = useRef<number | null>(null);
  const buttonRect = useBoundingRect(buttonAnchorRef, { observingWithLoop: open || isAnimating });

  const closePreview = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    void flow.downloads.getSessionDownloads().then((next) => {
      const visible = next.slice(0, 5);
      latestDownloadsRef.current = visible;
      lastSeenDownloadIdRef.current = visible[0]?.id ?? null;
      setDownloads(visible);
    });

    const unsubscribeChanged = flow.downloads.onChanged((next) => {
      const visible = next.slice(0, 5);
      latestDownloadsRef.current = visible;
      setDownloads(visible);
    });

    const unsubscribeCreated = flow.downloads.onCreated((created) => {
      const createdId = created?.id ?? latestDownloadsRef.current[0]?.id ?? null;
      if (createdId && createdId === lastSeenDownloadIdRef.current) return;
      lastSeenDownloadIdRef.current = createdId;

      setAnimationKey((value) => value + 1);
      setIsAnimating(true);
      setIsButtonPulsing(true);
      setOpen(true);

      window.setTimeout(() => setIsButtonPulsing(false), DOWNLOAD_ANIMATION_DURATION_MS + 220);
    });

    return () => {
      unsubscribeChanged();
      unsubscribeCreated();
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && buttonAnchorRef.current?.contains(target)) return;
      closePreview();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closePreview);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closePreview);
    };
  }, [closePreview, open]);

  const visibleDownloads = useMemo(() => downloads.slice(0, 5), [downloads]);
  const hasSessionDownloads = visibleDownloads.length > 0;
  const activeDownloads = visibleDownloads.filter((download) => download.state === "progressing");

  const openDownloadsPage = () => {
    void flow.tabs.newTab("blinker://downloads", true);
    closePreview();
  };

  const panelPosition = useMemo(() => {
    if (!buttonRect) {
      return {
        left: PANEL_GAP,
        top: window.innerHeight - PANEL_HEIGHT - PANEL_GAP
      };
    }

    const opensRight = buttonRect.right + PANEL_GAP + PANEL_WIDTH <= window.innerWidth;
    const left = opensRight
      ? buttonRect.right + PANEL_GAP
      : Math.max(PANEL_GAP, buttonRect.left - PANEL_WIDTH - PANEL_GAP);
    const top = Math.min(
      Math.max(PANEL_GAP, buttonRect.bottom - PANEL_HEIGHT),
      Math.max(PANEL_GAP, window.innerHeight - PANEL_HEIGHT - PANEL_GAP)
    );

    return { left, top };
  }, [buttonRect]);

  const button = (
    <div ref={buttonAnchorRef} className="relative">
      <ZenDownloadArcAnimation
        anchorRef={buttonAnchorRef}
        animationKey={animationKey}
        visible={isAnimating}
        onComplete={() => setIsAnimating(false)}
      />
      <motion.div
        animate={isButtonPulsing ? { scale: [1, 1.18, 0.96, 1] } : { scale: 1 }}
        transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex size-8 items-center justify-center"
      >
        <AnimatePresence>
          {(isButtonPulsing || activeDownloads.length > 0) && (
            <motion.span
              className="pointer-events-none absolute inset-0 rounded-lg border border-primary/45 shadow-[0_0_18px_hsl(var(--primary)/0.36)]"
              initial={{ scale: 0.72, opacity: 0 }}
              animate={{ scale: [0.72, 1.22], opacity: [0, 0.75, 0] }}
              exit={{ opacity: 0, scale: 1.15 }}
              transition={{ duration: 0.9, ease: "easeOut", repeat: activeDownloads.length > 0 ? Infinity : 0 }}
            />
          )}
        </AnimatePresence>
        <Button
          size="icon"
          className="relative size-8 bg-transparent hover:bg-black/10 dark:hover:bg-white/10"
          onClick={hasSessionDownloads ? () => setOpen((current) => !current) : openDownloadsPage}
          aria-label="Загрузки"
        >
          <DownloadIcon strokeWidth={2} className="h-4 w-4 text-black/80 dark:text-white/80" />
        </Button>
      </motion.div>
    </div>
  );

  if (!hasSessionDownloads) return button;

  return (
    <>
      {button}
      <PortalComponent
        visible={open}
        autoFocus
        layerType="popover"
        className="pointer-events-none fixed z-[10000]"
        style={{
          left: panelPosition.left,
          top: panelPosition.top,
          width: PANEL_WIDTH,
          height: PANEL_HEIGHT
        }}
      >
        <motion.div
          className="pointer-events-auto h-full w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-2 text-white shadow-2xl shadow-black/35 backdrop-blur-xl"
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.97 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onPointerDown={(event) => event.stopPropagation()}
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
        </motion.div>
      </PortalComponent>
    </>
  );
}
