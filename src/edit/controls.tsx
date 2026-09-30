import * as React from "react"
import { HexColorPicker } from "react-colorful"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        {hint && (
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** Appended to the readout, e.g. "px", "ms", "dB". */
  unit?: string
  /** Decimal places in the readout. */
  precision?: number
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "",
  precision = 0,
}: SliderFieldProps) {
  return (
    <Field label={label} hint={`${value.toFixed(precision)}${unit}`}>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          onChange(Array.isArray(next) ? next[0] : next)
        }}
      />
    </Field>
  )
}

export function SwitchField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex flex-col gap-0.5">
        <Label className="text-xs font-medium">{label}</Label>
        {description && (
          <span className="text-[10px] leading-tight text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} hint={value.toUpperCase()}>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md border border-input px-2 text-left text-xs transition-colors hover:bg-accent"
            />
          }
        >
          <span
            className="size-4 shrink-0 rounded-sm ring-1 ring-foreground/20"
            style={{ background: value }}
          />
          <span className="font-mono text-muted-foreground">
            {value.toUpperCase()}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-auto items-center gap-3">
          <HexColorPicker color={value} onChange={onChange} />
          <Input
            value={value}
            onChange={(event) => {
              const next = event.target.value
              // Let the user type freely, but only commit valid hex upstream.
              if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(next)) onChange(next)
            }}
            className="h-7 font-mono text-xs"
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={Math.round(value * 100) / 100}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)))
          }
        }}
        className="h-8 font-mono text-xs"
      />
    </Field>
  )
}

export function SectionGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}
