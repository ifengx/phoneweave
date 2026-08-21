import * as React from 'react'
import { cn } from '../../lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn('flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/10', className)} {...props} />
))
Input.displayName = 'Input'
