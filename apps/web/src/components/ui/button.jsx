import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-[#3D5A47] text-[#F7F5F0] hover:bg-[#4A6B55] shadow-warm-sm hover:shadow-warm",
        destructive:
          "bg-[#B54D4D] text-white hover:bg-[#C45B5B] shadow-warm-sm",
        outline:
          "border border-[#E8E4DD] bg-white hover:bg-[#F7F5F0] hover:border-[#D4CFC6] text-[#44403C] shadow-warm-sm",
        secondary:
          "bg-[#F0ECE4] text-[#44403C] hover:bg-[#E8E4DD]",
        ghost: "hover:bg-[#F0ECE4] hover:text-[#44403C]",
        link: "text-[#3D5A47] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-lg px-3.5 text-xs",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
