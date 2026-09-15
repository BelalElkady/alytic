import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDesk, type Stock } from "@/lib/store";
import { cn } from "@/lib/utils";

// Case, Arabic diacritics and letter variants (أ/إ/آ, ى/ي, ة/ه) shouldn't
// decide whether a name matches.
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();

/**
 * Lower is better; null means no match. A ticker typed in full comes first,
 * then codes starting with it, then names with a word starting with it, then
 * anything that merely contains it. Only contiguous matches count — cmdk's
 * default fuzzy scoring matched scattered letters and flooded the list.
 */
function matchRank(stock: Stock, query: string): number | null {
  const code = stock.code.toLowerCase();
  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  const names = [stock.ar, stock.en].filter(Boolean).map((name) => normalize(name!));
  if (names.some((name) => name.startsWith(query))) return 2;
  if (names.some((name) => name.split(/\s+/).some((word) => word.startsWith(query)))) return 3;
  if (code.includes(query)) return 4;
  // A letter or two turns up inside half the names — too loose to be useful.
  if (query.length >= 3 && names.some((name) => name.includes(query))) return 5;
  return null;
}

/**
 * Searchable picker over the same universe list the old <select> used, so a
 * value can still only ever be a code the engine can price.
 */
export function StockPicker({
  value,
  onChange,
  className,
  placeholder = "اختار السهم…",
  modal = false,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  placeholder?: string;
  /** Set inside a Dialog: the portaled list is otherwise outside its scroll lock. */
  modal?: boolean;
}) {
  const { universe } = useDesk();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = universe.find((stock) => stock.code === value);

  const results = useMemo(() => {
    const query = normalize(search);
    if (!query) return universe;
    const hits = universe
      .map((stock) => ({ stock, rank: matchRank(stock, query) }))
      .filter((hit): hit is { stock: Stock; rank: number } => hit.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.stock.code.localeCompare(b.stock.code));
    // A full ticker was typed: show it and the codes that extend it, not
    // every name that happens to share those letters.
    const exactTicker = hits[0]?.rank === 0;
    return hits.filter((hit) => !exactTicker || hit.rank <= 1).map((hit) => hit.stock);
  }, [universe, search]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      modal={modal}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 w-full justify-between font-normal sm:w-56", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.code} — ${selected.ar || selected.en}` : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Capped to the room Radix measured on the chosen side, with the list
          taking whatever is left under the search box, so the top of the
          menu (search + first stocks) never ends up off screen. On touch
          screens the search isn't auto-focused: the keyboard would eat half
          the viewport before the menu is even positioned. */}
      <PopoverContent
        className="flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[min(20rem,90vw)] flex-col p-0"
        align="start"
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          if (window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
        }}
      >
        {/* Filtered and ordered by matchRank above, not cmdk's fuzzy scorer. */}
        <Command shouldFilter={false} className="min-h-0 flex-1">
          {/* 16px on phones: iOS zooms the page into any smaller input. */}
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="ابحث بالكود أو الاسم…"
            className="text-base sm:text-sm"
          />
          <CommandList className="max-h-none min-h-0 flex-1">
            <CommandEmpty>مفيش نتائج.</CommandEmpty>
            <CommandGroup>
              {results.map((stock) => (
                <CommandItem
                  key={stock.code}
                  value={stock.code}
                  onSelect={() => {
                    onChange(stock.code);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check
                    className={cn("size-4", stock.code === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="font-medium">{stock.code}</span>
                  <span className="truncate text-muted-foreground">{stock.ar || stock.en}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
