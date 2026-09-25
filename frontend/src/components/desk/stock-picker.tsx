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
import { searchStocks } from "@/lib/stock-search";
import { type Stock, useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

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
  stocks,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  placeholder?: string;
  /** Set inside a Dialog: the portaled list is otherwise outside its scroll lock. */
  modal?: boolean;
  /** The list to pick from, for pages outside the desk; defaults to the signed-in universe. */
  stocks?: Stock[];
}) {
  const desk = useDesk();
  const universe = stocks ?? desk.universe;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = universe.find((stock) => stock.code === value);

  const results = useMemo(() => searchStocks(universe, search), [universe, search]);

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
