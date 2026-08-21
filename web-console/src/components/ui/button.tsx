import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-blue-500 text-white hover:bg-blue-400 shadow-sm shadow-blue-950/20',
        secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700',
        ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
        outline: 'border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800',
        destructive: 'bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-xs',
        icon: 'size-9 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
Button.displayName = 'Button'
