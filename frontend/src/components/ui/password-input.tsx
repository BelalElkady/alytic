import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Password `Input` with a show/hide toggle. Always LTR (passwords read left-to-right regardless of page direction), icon pinned to the field's own end side. */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, "type">
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative" dir="ltr">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pe-9", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
        aria-label={visible ? "إخفاء كلمة السر" : "إظهار كلمة السر"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
