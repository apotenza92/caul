import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

const checkboxClassName = "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary"
const checkboxIndicatorClassName = "grid place-content-center text-current transition-none [&>svg]:size-3.5"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        checkboxClassName,
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={checkboxIndicatorClassName}
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

function CheckboxDisplay({
  checked,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  checked: boolean
}) {
  return (
    <span
      data-checked={checked ? "" : undefined}
      data-slot="checkbox"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(checkboxClassName, className)}
      {...props}
    >
      {checked ? (
        <span
          data-slot="checkbox-indicator"
          className={checkboxIndicatorClassName}
        >
          <CheckIcon
          />
        </span>
      ) : null}
    </span>
  )
}

export { Checkbox, CheckboxDisplay }
