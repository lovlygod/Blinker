import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFocusedTab } from "@/components/providers/tabs-provider";
import { cn } from "@/lib/utils";
import type { BookmarkEntry } from "~/types/bookmarks";

function canBookmark(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "blinker:";
  } catch {
    return false;
  }
}

export function BookmarkButton() {
  const focusedTab = useFocusedTab();
  const [bookmark, setBookmark] = useState<BookmarkEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const url = focusedTab?.url ?? "";
  const enabled = useMemo(() => canBookmark(url), [url]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setBookmark(null);
      return;
    }

    void flow.bookmarks.getForUrl(url).then((entry) => {
      if (!cancelled) setBookmark(entry);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  if (!enabled) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (bookmark) {
        const removed = await flow.bookmarks.delete(bookmark.id);
        if (removed) setBookmark(null);
      } else {
        const created = await flow.bookmarks.save({
          url,
          title: focusedTab?.title || url,
          faviconUrl: focusedTab?.faviconURL ?? null
        });
        setBookmark(created);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-6 shrink-0 hover:bg-black/10 dark:hover:bg-white/10"
      onClick={(event) => {
        event.stopPropagation();
        void toggle();
      }}
      disabled={busy}
      aria-label={bookmark ? "Удалить из закладок" : "Добавить в закладки"}
    >
      <Star
        className={cn(
          "size-3.5 transition-colors",
          bookmark ? "fill-yellow-400 text-yellow-400" : "text-black/55 dark:text-white/65"
        )}
      />
    </Button>
  );
}
