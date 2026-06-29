import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalComponent } from "@/components/portal/portal";
import { useBoundingRect } from "@/hooks/use-bounding-rect";
import {
  DOWNLOADS_PREVIEW_HEIGHT,
  DOWNLOADS_PREVIEW_WIDTH,
  DownloadsPreview
} from "@/components/browser-ui/browser-sidebar/_components/downloads-preview";
import type { DownloadEntry } from "~/types/downloads";

const DOWNLOAD_ANIMATION_DURATION_MS = 1000;
const PANEL_GAP = 12;

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

export function DownloadsButton() {
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isButtonPulsing, setIsButtonPulsing] = useState(false);
  const buttonAnchorRef = useRef<HTMLDivElement>(null);
  const latestDownloadsRef = useRef<DownloadEntry[]>([]);
  const lastSeenDownloadIdRef = useRef<number | null>(null);
  const ignoreBlurUntilRef = useRef(0);
  const buttonRect = useBoundingRect(buttonAnchorRef, { observingWithLoop: open || isAnimating });

  const markInternalInteraction = useCallback(() => {
    ignoreBlurUntilRef.current = Date.now() + 450;
  }, []);

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

    const handleBlur = () => {
      window.setTimeout(() => {
        if (Date.now() <= ignoreBlurUntilRef.current) return;
        closePreview();
      }, 120);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [closePreview, open]);

  const visibleDownloads = useMemo(() => downloads.slice(0, 5), [downloads]);
  const hasSessionDownloads = visibleDownloads.length > 0;
  const activeDownloads = visibleDownloads.filter((download) => download.state === "progressing");

  const openDownloadsPage = useCallback(() => {
    markInternalInteraction();
    void flow.tabs.newTab("blinker://downloads", true);
    closePreview();
  }, [closePreview, markInternalInteraction]);

  const panelPosition = useMemo(() => {
    if (!buttonRect) {
      return {
        left: PANEL_GAP,
        top: window.innerHeight - DOWNLOADS_PREVIEW_HEIGHT - PANEL_GAP
      };
    }

    const opensRight = buttonRect.right + PANEL_GAP + DOWNLOADS_PREVIEW_WIDTH <= window.innerWidth;
    const left = opensRight
      ? buttonRect.right + PANEL_GAP
      : Math.max(PANEL_GAP, buttonRect.left - DOWNLOADS_PREVIEW_WIDTH - PANEL_GAP);
    const top = Math.min(
      Math.max(PANEL_GAP, buttonRect.bottom - DOWNLOADS_PREVIEW_HEIGHT),
      Math.max(PANEL_GAP, window.innerHeight - DOWNLOADS_PREVIEW_HEIGHT - PANEL_GAP)
    );

    return { left, top };
  }, [buttonRect]);

  const togglePreview = () => {
    markInternalInteraction();
    if (hasSessionDownloads) {
      setOpen((current) => !current);
    } else {
      openDownloadsPage();
    }
  };

  return (
    <>
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
            onPointerDown={markInternalInteraction}
            onClick={togglePreview}
            aria-label="Загрузки"
          >
            <DownloadIcon strokeWidth={2} className="h-4 w-4 text-black/80 dark:text-white/80" />
          </Button>
        </motion.div>
      </div>
      {hasSessionDownloads && (
        <DownloadsPreview
          open={open}
          downloads={visibleDownloads}
          position={panelPosition}
          onOpenHistory={openDownloadsPage}
          onInternalInteraction={markInternalInteraction}
        />
      )}
    </>
  );
}
