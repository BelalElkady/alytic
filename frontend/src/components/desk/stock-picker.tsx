import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

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
import { useDesk } from "@/lib/store";
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
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const { universe } = useDesk();
  const [open, setOpen] = useState(false);
  const selected = universe.find((stock) => stock.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent className="w-[min(20rem,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder="ابحث بالكود أو الاسم…" />
          <CommandList>
            <CommandEmpty>مفيش نتائج.</CommandEmpty>
            <CommandGroup>
              {universe.map((stock) => (
                <CommandItem
                  key={stock.code}
                  value={`${stock.code} ${stock.ar ?? ""} ${stock.en ?? ""}`}
                  onSelect={() => {
                    onChange(stock.code);
                    setOpen(false);
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
