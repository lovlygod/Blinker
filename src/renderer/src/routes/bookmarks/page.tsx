import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Bookmark, Download, ExternalLink, FileUp, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WebsiteFavicon } from "@/components/main/website-favicon";
import { simplifyUrl } from "@/lib/url";
import type { BookmarkEntry } from "~/types/bookmarks";

function bookmarksQueryKey() {
  return ["bookmarks"] as const;
}

function groupBookmarks(bookmarks: BookmarkEntry[]) {
  const map = new Map<string, BookmarkEntry[]>();
  for (const bookmark of bookmarks) {
    const folder = bookmark.folder || "Bookmarks bar";
    map.set(folder, [...(map.get(folder) ?? []), bookmark]);
  }
  return [...map.entries()].map(([folder, items]) => ({
    folder,
    items: items.sort((a, b) => b.updatedAt - a.updatedAt)
  }));
}

function BookmarksPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data, isError, isPending, refetch } = useQuery({
    queryKey: bookmarksQueryKey(),
    queryFn: () => flow.bookmarks.list()
  });

  useEffect(() => {
    if (isError) toast.error("Не удалось загрузить закладки");
  }, [isError]);

  const bookmarks = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter((bookmark) =>
      `${bookmark.title} ${bookmark.url} ${bookmark.folder}`.toLowerCase().includes(q)
    );
  }, [bookmarks, search]);
  const grouped = useMemo(() => groupBookmarks(filtered), [filtered]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: bookmarksQueryKey() });

  const remove = async (id: number) => {
    const ok = await flow.bookmarks.delete(id);
    if (ok) {
      toast.success("Закладка удалена");
      invalidate();
    } else {
      toast.error("Не удалось удалить закладку");
    }
  };

  const importHtml = async () => {
    const count = await flow.bookmarks.importFromHtml();
    if (count == null) return;
    toast.success(`Импортировано закладок: ${count}`);
    invalidate();
  };

  const exportHtml = async () => {
    const ok = await flow.bookmarks.exportToHtml();
    if (ok) toast.success("Закладки экспортированы");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
          <Bookmark className="size-5 text-foreground" />
          <h1 className="shrink-0 text-lg font-semibold tracking-tight text-foreground">Закладки</h1>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск в закладках"
              className="h-9 w-full rounded-lg border border-input bg-muted/40 pl-9 pr-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <Button variant="ghost" size="sm" className="gap-2 border text-muted-foreground" onClick={importHtml}>
            <FileUp className="size-4" />
            Импорт
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 border text-muted-foreground" onClick={exportHtml}>
            <Download className="size-4" />
            Экспорт
          </Button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-6"
      >
        {isPending ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Загрузка...</div>
        ) : isError ? (
          <div className="space-y-3 py-20 text-center">
            <p className="font-medium text-foreground">Не удалось загрузить закладки</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Повторить
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <Bookmark className="mx-auto mb-3 size-10 text-muted-foreground opacity-40" />
            <p className="font-medium text-foreground">Закладок нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search.trim() ? "Попробуйте другой запрос." : "Нажмите звезду в адресной строке, чтобы добавить сайт."}
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <Card key={group.folder} className="gap-0 overflow-hidden py-0 shadow-sm">
              <div className="border-b border-border/60 bg-muted/95 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.folder}
              </div>
              <CardContent className="p-1">
                <ul>
                  {group.items.map((bookmark) => (
                    <li
                      key={bookmark.id}
                      className="group flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-3 rounded text-left text-inherit"
                        onClick={() => void flow.tabs.newTab(bookmark.url, true)}
                      >
                        <WebsiteFavicon
                          url={bookmark.url}
                          className="size-5 shrink-0 rounded-sm bg-muted object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm leading-snug text-foreground">
                            {bookmark.title || simplifyUrl(bookmark.url)}
                          </span>
                          <span className="block truncate text-[11px] leading-snug text-muted-foreground">
                            {simplifyUrl(bookmark.url)}
                          </span>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100"
                        onClick={() => void flow.tabs.newTab(bookmark.url, true)}
                        aria-label="Открыть"
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100"
                        onClick={() => void remove(bookmark.id)}
                        aria-label="Удалить"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </motion.div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <title>Закладки</title>
      <BookmarksPage />
    </>
  );
}
