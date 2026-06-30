import { ThemeProvider } from "@/components/main/theme";
import { RouteConfigType } from "@/types/routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

function BookmarksQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000
          }
        }
      })
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export const RouteConfig: RouteConfigType = {
  Providers: ({ children }: { children: ReactNode }) => {
    return (
      <BookmarksQueryProvider>
        <ThemeProvider forceTheme="dark">{children}</ThemeProvider>
      </BookmarksQueryProvider>
    );
  }
};
