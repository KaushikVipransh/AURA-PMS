import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-[#E8E4DD] bg-white px-3.5 py-2 text-sm text-[#1C1917] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#A8A29E] transition-all duration-200 focus-visible:outline-none focus-visible:border-[#3D5A47] focus-visible:ring-2 focus-visible:ring-[rgba(61,90,71,0.12)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
