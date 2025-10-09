import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-300 cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white/50",
  {
    variants: {
      variant: {
        default:
          "bg-white text-black shadow-lg hover:bg-gray-100 hover:shadow-xl active:bg-gray-200 border border-white/20",
        destructive:
          "bg-red-600 text-white shadow-lg hover:bg-red-700 hover:shadow-xl active:bg-red-800 border border-red-600",
        outline:
          "border-2 border-white/20 bg-transparent text-white shadow-sm hover:bg-white hover:text-black hover:border-white hover:shadow-lg active:bg-gray-100",
        secondary:
          "bg-white/10 text-white shadow-sm hover:bg-white/20 hover:shadow-md active:bg-white/30 border border-white/10",
        ghost:
          "hover:bg-white/10 hover:text-white active:bg-white/20 text-white/80",
        link: "text-white underline-offset-4 hover:underline font-medium hover:text-white/80",
      },
      size: {
        default: "h-11 px-6 py-2.5",
        sm: "h-9 rounded-lg px-4 py-2 text-sm",
        lg: "h-14 rounded-xl px-8 py-4 text-base font-semibold",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
