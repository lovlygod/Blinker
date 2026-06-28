import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { DownloadEntry, DownloadsPageCursor } from "~/types/downloads";
import { Download, File, FolderOpen, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const DOWNLOADS_PAGE_SIZE = 120;

function queryKey(search: string) {
  return ["downloads", "page", search] as const;
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

function progressValue(download: DownloadEntry) {
  if (download.state === "completed") return 100;
  if (download.totalBytes <= 0) return 8;
  return Math.max(3, Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)));
}

function statusText(download: DownloadEntry) {
  if (download.state === "completed") return download.exists ? "Скачано" : "Удалено";
  if (download.state === "cancelled") return "Отменено";
  if (download.state === "interrupted") return "Ошибка загрузки";
  const total = formatBytes(download.totalBytes);
  const received = formatBytes(download.receivedBytes);
  return total ? `${received} из ${total}` : "Скачивается";
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const t1 = t0 - 86400000;
  if (ts >= t0) return "Сегодня";
  if (ts >= t1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function groupDownloads(downloads: DownloadEntry[]) {
  const map = new Map<number, DownloadEntry[]>();
  for (const download of downloads) {
    const key = startOfLocalDay(download.startedAt);
    map.set(key, [...(map.get(key) ?? []), download]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStart, items]) => ({
      dayStart,
      label: dayLabel(dayStart),
      items: items.sort((a, b) => b.startedAt - a.startedAt)
    }));
}

function DownloadCard({ download, onRemove }: { download: DownloadEntry; onRemove: (id: number) => void }) {
  const isDeleted = download.state === "completed" && !download.exists;
  const canOpen = download.state === "completed" && download.exists;

  return (
    <li
      className={cn(
        "group flex items-center gap-4 rounded-lg px-4 py-3 transition-colors",
        isDeleted ? "opacity-55" : "hover:bg-muted/60"
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
        onClick={() => void flow.downloads.openFile(download.id)}
        disabled={!canOpen}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <File className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium text-foreground", isDeleted && "line-through")}>
            {download.filename}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{statusText(download)}</span>
            {download.state === "progressing" && (
              <Progress value={progressValue(download)} className="h-1 w-28 bg-muted" />
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{download.path}</div>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => void flow.downloads.showInFolder(download.id)}
        disabled={!download.exists}
        aria-label="Показать в папке"
      >
        <FolderOpen className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 opacity-60 hover:opacity-100"
        onClick={() => onRemove(download.id)}
        aria-label="Убрать из истории"
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}

function DownloadsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data, fetchNextPage, hasNextPage, isError, isFetchingNextPage, isPending, refetch } = useInfiniteQuery({
    queryKey: queryKey(debouncedSearch),
    queryFn: async ({ pageParam }: { pageParam: DownloadsPageCursor | undefined }) => {
      return flow.downloads.listPage({
        search: debouncedSearch || undefined,
        limit: DOWNLOADS_PAGE_SIZE,
        cursor: pageParam
      });
    },
    initialPageParam: undefined as DownloadsPageCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  });

  useEffect(() => {
    const unsubscribe = flow.downloads.onChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    });
    return () => unsubscribe();
  }, [queryClient]);

  const downloads = useMemo(() => data?.pages.flatMap((page) => page.downloads) ?? [], [data]);
  const grouped = useMemo(() => groupDownloads(downloads), [downloads]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "220px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["downloads"] });
  };

  const remove = async (id: number) => {
    const ok = await flow.downloads.remove(id);
    if (ok) invalidate();
  };

  const clearAll = async () => {
    await flow.downloads.clearAll();
    toast.success("История загрузок очищена");
    invalidate();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3">
          <h1 className="flex shrink-0 items-center gap-3 text-lg font-semibold tracking-tight text-foreground">
            <Download className="size-5" />
            История скачиваний
          </h1>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск в загрузках"
              className="h-9 w-full rounded-lg border border-input bg-muted/40 pl-9 pr-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0 gap-2 border text-muted-foreground">
                <Trash2 className="size-4" />
                Удалить все
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Очистить историю загрузок?</AlertDialogTitle>
                <AlertDialogDescription>
                  Файлы на диске останутся, Blinker удалит только записи из истории.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={() => void clearAll()}>Очистить</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6"
      >
        {isPending ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Загружаю...</div>
        ) : isError ? (
          <div className="space-y-3 py-20 text-center">
            <p className="font-medium text-foreground">Не удалось загрузить историю</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Попробовать снова
            </Button>
          </div>
        ) : downloads.length === 0 ? (
          <div className="py-20 text-center">
            <Download className="mx-auto mb-3 size-10 text-muted-foreground opacity-40" />
            <p className="font-medium text-foreground">Загрузок нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {debouncedSearch ? "Попробуйте другой запрос." : "Скачанные файлы появятся здесь."}
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <Card key={group.dayStart} className="gap-0 overflow-clip py-0 shadow-sm">
              <CardHeader className="gap-0 border-b border-border/60 bg-muted/95 px-4 py-2.5! backdrop-blur-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </span>
              </CardHeader>
              <CardContent className="p-1">
                <ul>
                  {group.items.map((download) => (
                    <DownloadCard key={download.id} download={download} onRemove={(id) => void remove(id)} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
        {downloads.length > 0 && (
          <div ref={loadMoreRef} className="flex min-h-8 justify-center py-4 text-sm text-muted-foreground">
            {isFetchingNextPage ? "Загружаю еще..." : !hasNextPage ? "Конец истории" : null}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function App() {
  return (
    <>
      <title>История скачиваний</title>
      <DownloadsPage />
    </>
  );
}

export default App;
