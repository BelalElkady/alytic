import { ImageIcon, Upload, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postRaw } from "@/lib/api";
import { cn } from "@/lib/utils";

import { cssColorToHex, type ColorRow } from "./tenant-form-utils";

/** A labelled form row. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * A logo or favicon: upload a file (stored by the backend, which hands back
 * its public URL) or type a link / site path by hand. The preview shows what
 * the value currently points at.
 */
export function ImageField({
  label,
  hint,
  kind,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  kind: "logo" | "favicon";
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("ارفع صورة PNG أو JPEG أو WebP أو SVG");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error("الصورة أكبر من 2 ميجا");
      return;
    }
    setUploading(true);
    try {
      const { url } = await postRaw<{ url: string }>(
        `/api/platform/assets/${kind}`,
        file,
        file.type,
      );
      onChange(url);
      toast.success("اترفعت — اضغط حفظ عشان تتسجل");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر رفع الصورة");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          {value ? (
            <img
              key={value}
              src={value}
              alt=""
              className="max-h-full max-w-full object-contain"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </div>
        <Input
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={`${label} (رابط)`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <Spinner /> : <Upload className="size-4" />}
          رفع
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
    </Field>
  );
}

/** A titled group of fields inside the tenant form. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b pb-1.5 pt-3 text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A color picker next to the raw value. The picker sets a hex; the text box
 * keeps whatever syntax the brand already uses (oklch, rgb…) and can be typed
 * into directly. An empty value shows a faded swatch: "not set".
 */
export function ColorField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder?: string;
}) {
  const hex = cssColorToHex(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={hex ?? "#000000"}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1",
          !hex && "opacity-40",
        )}
      />
      <Input
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={`${label} (قيمة)`}
        className="font-mono text-[12.5px]"
      />
    </div>
  );
}

// The CSS variables the stylesheet already defines (see styles.css) — suggestions only, any name works.
const COLOR_NAMES = [
  "primary",
  "primary-foreground",
  "info",
  "accent",
  "ring",
  "up",
  "down",
  "warn",
];

/** A list of "variable name + color" rows — brand.colors or brand.darkColors. */
export function ColorRows({
  title,
  rows,
  onChange,
  datalistId,
}: {
  title: string;
  rows: ColorRow[];
  onChange: (next: ColorRow[]) => void;
  datalistId: string;
}) {
  const update = (index: number, patch: Partial<ColorRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[12px]"
          onClick={() => onChange([...rows, { name: "", value: "" }])}
        >
          إضافة لون
        </Button>
      </div>
      <datalist id={datalistId}>
        {COLOR_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {rows.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          مفيش ألوان — بياخد ألوان الموقع الافتراضية.
        </p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            dir="ltr"
            list={datalistId}
            value={row.name}
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder="primary"
            aria-label="اسم اللون"
            className="w-36 shrink-0 font-mono text-[12.5px]"
          />
          <div className="min-w-0 flex-1">
            <ColorField
              value={row.value}
              onChange={(next) => update(index, { value: next })}
              label={row.name || "لون"}
              placeholder="oklch(0.44 0.11 258) أو #1d4ed8"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-down"
            aria-label="حذف اللون"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
