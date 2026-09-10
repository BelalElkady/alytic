import { Toaster as Sonner } from "sonner";
import type { CSSProperties } from "react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // Colors go through CSS vars, not a fixed classNames.toast override —
      // that used to force bg-background/text-foreground on every toast
      // regardless of type, which silently defeated richColors and made
      // success/error/warning toasts indistinguishable from a default one.
      // Reuses the app's own up/down/warn palette (the same one profit/loss
      // numbers use) so a success toast reads as the same green everywhere.
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--up-soft)",
          "--success-text": "var(--up)",
          "--success-border": "var(--up)",
          "--error-bg": "var(--down-soft)",
          "--error-text": "var(--down)",
          "--error-border": "var(--down)",
          "--warning-bg": "var(--warn-soft)",
          "--warning-text": "var(--warn)",
          "--warning-border": "var(--warn)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "group toast shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
