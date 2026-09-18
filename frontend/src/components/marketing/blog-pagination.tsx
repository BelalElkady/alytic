import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { pageItems } from "@/lib/pagination";
import { cn } from "@/lib/utils";

// Page 1 is the plain /blog URL, so there is one address for it rather than two.
const searchFor = (page: number) => ({ page: page > 1 ? page : undefined });

/**
 * Pager for the blog index. Real links (not buttons), so every page is
 * reachable and indexable without JavaScript. The page is RTL, so the first
 * item — "السابق" — sits on the right and its chevron points right.
 */
export function BlogPagination({ page, lastPage }: { page: number; lastPage: number }) {
  const edge = "gap-1";

  return (
    <div className="mt-10">
      <Pagination aria-label="صفحات المقالات">
        <PaginationContent className="flex-wrap justify-center">
          <PaginationItem>
            {page > 1 ? (
              <Link
                to="/blog"
                search={searchFor(page - 1)}
                rel="prev"
                className={cn(buttonVariants({ variant: "ghost" }), edge)}
              >
                <ChevronRight className="size-4" />
                السابق
              </Link>
            ) : (
              <span
                aria-disabled
                className={cn(buttonVariants({ variant: "ghost" }), edge, "pointer-events-none opacity-40")}
              >
                <ChevronRight className="size-4" />
                السابق
              </span>
            )}
          </PaginationItem>

          {pageItems(page, lastPage).map((item, index) =>
            item === "gap" ? (
              <PaginationItem key={`gap-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <Link
                  to="/blog"
                  search={searchFor(item)}
                  aria-label={`الصفحة ${item}`}
                  aria-current={item === page ? "page" : undefined}
                  className={buttonVariants({
                    variant: item === page ? "outline" : "ghost",
                    size: "icon",
                  })}
                >
                  <span className="num">{item}</span>
                </Link>
              </PaginationItem>
            ),
          )}

          <PaginationItem>
            {page < lastPage ? (
              <Link
                to="/blog"
                search={searchFor(page + 1)}
                rel="next"
                className={cn(buttonVariants({ variant: "ghost" }), edge)}
              >
                التالي
                <ChevronLeft className="size-4" />
              </Link>
            ) : (
              <span
                aria-disabled
                className={cn(buttonVariants({ variant: "ghost" }), edge, "pointer-events-none opacity-40")}
              >
                التالي
                <ChevronLeft className="size-4" />
              </span>
            )}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      <p className="mt-3 text-center text-[12px] text-muted-foreground">
        صفحة <span className="num">{page}</span> من <span className="num">{lastPage}</span>
      </p>
    </div>
  );
}
