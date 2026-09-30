import { useEffect, useRef } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  ImagePlus,
} from "lucide-react";

import { cn } from "@/lib/utils";

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "40px"];
const BLOCK_TYPES = [
  { value: "p", label: "فقرة" },
  { value: "2", label: "عنوان رئيسي (H2)" },
  { value: "3", label: "عنوان فرعي (H3)" },
  { value: "4", label: "عنوان صغير (H4)" },
];

type Props = {
  /** HTML the editor starts with; later changes are ignored (use `key` to reset). */
  initialHtml?: string;
  onChange: (html: string, text: string) => void;
  /** Uploads a picked image and resolves to its public URL. */
  onUploadImage?: (file: File) => Promise<string | null>;
  disabled?: boolean;
};

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection: a button click would otherwise blur it first.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-foreground/80 hover:bg-muted disabled:opacity-40",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

function Toolbar({
  editor,
  onPickImage,
  uploading,
}: {
  editor: Editor;
  onPickImage?: (() => void) | undefined;
  uploading?: boolean | undefined;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 2 })
        ? "2"
        : e.isActive("heading", { level: 3 })
          ? "3"
          : e.isActive("heading", { level: 4 })
            ? "4"
            : "p",
      fontSize: (e.getAttributes("textStyle")["fontSize"] as string | undefined) ?? "",
      color: (e.getAttributes("textStyle")["color"] as string | undefined) ?? "#000000",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      inTable: e.isActive("table"),
      alignLeft: e.isActive({ textAlign: "left" }),
      alignCenter: e.isActive({ textAlign: "center" }),
      alignRight: e.isActive({ textAlign: "right" }),
      alignJustify: e.isActive({ textAlign: "justify" }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const selectClass = "h-7 rounded-md border bg-background px-1.5 text-[12px]";

  const setLink = () => {
    const previous = (editor.getAttributes("link")["href"] as string | undefined) ?? "";
    const url = window.prompt("رابط الـ Link (سيب الخانة فاضية لإزالة الرابط)", previous);
    if (url === null) return;
    if (!url.trim()) {
      chain().extendMarkRange("link").unsetLink().run();
      return;
    }
    chain().extendMarkRange("link").setLink({ href: url.trim(), target: "_blank" }).run();
  };

  const insertTable = () => {
    const input = window.prompt("عدد الصفوف × الأعمدة (مثال: 3x3)", "3x3");
    if (!input) return;
    const match = input.match(/^\s*(\d{1,2})\s*[x×*,]\s*(\d{1,2})\s*$/i);
    if (!match) return;
    const rows = Math.max(1, Number(match[1]));
    const cols = Math.max(1, Number(match[2]));
    chain().insertTable({ rows, cols, withHeaderRow: true }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 p-1.5" dir="ltr">
      <ToolbarButton label="تراجع" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="إعادة" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 className="size-4" />
      </ToolbarButton>
      <Divider />
      <select
        aria-label="نوع النص"
        className={selectClass}
        value={state.block}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "p") chain().setParagraph().run();
          else
            chain()
              .setHeading({ level: Number(value) as 2 | 3 | 4 })
              .run();
        }}
      >
        {BLOCK_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        aria-label="حجم الخط"
        className={selectClass}
        value={state.fontSize}
        onChange={(event) => {
          const value = event.target.value;
          if (value) chain().setFontSize(value).run();
          else chain().unsetFontSize().run();
        }}
      >
        <option value="">حجم الخط</option>
        {FONT_SIZES.map((size) => (
          <option key={size} value={size}>
            {size.replace("px", "")}
          </option>
        ))}
      </select>
      <Divider />
      <ToolbarButton label="عريض" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="مائل"
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="تسطير"
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="يتوسطه خط"
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <label
        title="لون النص"
        className="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
      >
        <span className="text-[13px] font-bold leading-none" style={{ color: state.color }}>
          A
        </span>
        <span
          className="absolute inset-x-1.5 bottom-1 h-0.5 rounded"
          style={{ background: state.color }}
        />
        <input
          type="color"
          aria-label="لون النص"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={/^#[0-9a-f]{6}$/i.test(state.color) ? state.color : "#000000"}
          onChange={(event) => chain().setColor(event.target.value).run()}
        />
      </label>
      <Divider />
      <ToolbarButton
        label="يمين"
        active={state.alignRight}
        onClick={() => chain().setTextAlign("right").run()}
      >
        <AlignRight className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="وسط"
        active={state.alignCenter}
        onClick={() => chain().setTextAlign("center").run()}
      >
        <AlignCenter className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="شمال"
        active={state.alignLeft}
        onClick={() => chain().setTextAlign("left").run()}
      >
        <AlignLeft className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="ضبط"
        active={state.alignJustify}
        onClick={() => chain().setTextAlign("justify").run()}
      >
        <AlignJustify className="size-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        label="قائمة نقطية"
        active={state.bullet}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="قائمة مرقمة"
        active={state.ordered}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="اقتباس"
        active={state.quote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="خط فاصل" onClick={() => chain().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="رابط" active={state.link} onClick={setLink}>
        <LinkIcon className="size-4" />
      </ToolbarButton>
      {onPickImage && (
        <ToolbarButton label="إدراج صورة" disabled={uploading} onClick={onPickImage}>
          <ImagePlus className="size-4" />
        </ToolbarButton>
      )}
      <Divider />
      <ToolbarButton label="إدراج جدول" onClick={insertTable}>
        <TableIcon className="size-4" />
      </ToolbarButton>
      {state.inTable && (
        <>
          <button
            type="button"
            className={selectClass}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().addRowAfter().run()}
          >
            + صف
          </button>
          <button
            type="button"
            className={selectClass}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().deleteRow().run()}
          >
            − صف
          </button>
          <button
            type="button"
            className={selectClass}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().addColumnAfter().run()}
          >
            + عمود
          </button>
          <button
            type="button"
            className={selectClass}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().deleteColumn().run()}
          >
            − عمود
          </button>
          <button
            type="button"
            className={selectClass}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().toggleHeaderRow().run()}
          >
            صف العناوين
          </button>
          <button
            type="button"
            className={cn(selectClass, "text-destructive")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().deleteTable().run()}
          >
            حذف الجدول
          </button>
        </>
      )}
    </div>
  );
}

/** Word-style editor for blog articles: headings, font size, colour, alignment, lists, links, images and tables. Emits HTML. */
export function RichTextEditor({ initialHtml = "", onChange, onUploadImage, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: initialHtml,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true },
      }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: false } }),
      Image,
    ],
    editorProps: {
      attributes: {
        dir: "auto",
        class: "blog-html min-h-[320px] px-4 py-3 outline-none",
        "aria-label": "نص المقالة",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML(), e.getText()),
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return <div className="min-h-[360px] rounded-lg border" />;

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || !onUploadImage || uploadingRef.current) return;
          uploadingRef.current = true;
          try {
            const url = await onUploadImage(file);
            if (url) editor.chain().focus().setImage({ src: url, alt: "" }).run();
          } finally {
            uploadingRef.current = false;
          }
        }}
      />
      <Toolbar
        editor={editor}
        onPickImage={onUploadImage ? () => fileRef.current?.click() : undefined}
      />
      <EditorContent editor={editor} />
    </div>
  );
}
