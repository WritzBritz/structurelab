import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Heading,
  IconButton,
  RadioCards,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Text,
  TextField,
} from '@radix-ui/themes'
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import './kit.css'

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="ui-field">
      <Text size="1" weight="medium">
        {label}
      </Text>
      {children}
    </label>
  )
}

export function NumberField({
  label,
  value,
  min = 1,
  max,
  onChange,
  onEditEnd,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  onEditEnd?: () => void
}) {
  const clamp = (raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next)) return min
    const rounded = Math.round(next)
    const low = Math.max(min, rounded)
    return max == null ? low : Math.min(max, low)
  }

  return (
    <Field label={label}>
      <TextField.Root
        type="number"
        min={min}
        max={max}
        value={String(value)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(clamp(event.target.value))
        }}
        onBlur={() => onEditEnd?.()}
      />
    </Field>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  swatches,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  disabled?: boolean
  swatches?: Record<string, string>
}) {
  return (
    <Field label={label}>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger />
        <Select.Content position="popper" variant="solid">
          {options.map(([option, text]) => {
            const swatch = swatches?.[option]
            return (
              <Select.Item key={option} value={option}>
                {swatch ? (
                  <span className="ui-select-color-option">
                    <span
                      className="ui-color-dot"
                      style={{ background: swatch }}
                      aria-hidden
                    />
                    {text}
                  </span>
                ) : (
                  text
                )}
              </Select.Item>
            )
          })}
        </Select.Content>
      </Select.Root>
    </Field>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  onChange,
  onEditEnd,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onEditEnd?: () => void
  disabled?: boolean
}) {
  return (
    <div className={`ui-range${disabled ? ' is-disabled' : ''}`}>
      <div className="ui-range-head">
        <Text size="1" weight="medium">
          {label}
        </Text>
        <TextField.Root
          size="1"
          type="number"
          min={min}
          max={max}
          value={String(value)}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const next = Number(event.target.value)
            if (!Number.isFinite(next)) return
            onChange(Math.min(max, Math.max(min, Math.round(next))))
          }}
          onBlur={() => onEditEnd?.()}
        />
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={(next) => onChange(next[0] ?? value)}
        onValueCommit={() => onEditEnd?.()}
      />
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <TextField.Root
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = '2',
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (value: T) => void
  className?: string
  size?: '1' | '2' | '3'
}) {
  return (
    <SegmentedControl.Root
      size={size}
      className={`ui-segmented ${className ?? ''}`.trim()}
      value={value}
      onValueChange={(next) => {
        const option = options.find((entry) => entry.value === next)
        if (!next || option?.disabled) return
        onChange(next as T)
      }}
    >
      {options.map((option) => (
        <SegmentedControl.Item
          key={option.value}
          value={option.value}
          title={option.title}
          style={option.disabled ? { opacity: 0.38, pointerEvents: 'none' } : undefined}
        >
          {option.label}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl.Root>
  )
}

export function CheckRow({
  checked,
  onChange,
  children,
  title,
  disabled,
  compact,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  title?: string
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <Text
      as="label"
      size={compact ? '1' : '2'}
      className={`ui-check-row${compact ? ' is-compact' : ''}`}
      title={title}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span>{children}</span>
    </Text>
  )
}

export function AxisSlider({
  label,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onChange,
  onEditEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  decimals?: number
  onChange: (value: number) => void
  onEditEnd?: () => void
}) {
  return (
    <label className="ui-axis-slider">
      <Text size="1" color="gray">
        {label}
      </Text>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(next[0] ?? value)}
        onValueCommit={() => onEditEnd?.()}
      />
      <Text size="1" className="ui-axis-value">
        {value.toFixed(decimals)}
      </Text>
    </label>
  )
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="ui-switch-row">
      <span>
        <Text size="2" weight="medium">
          {label}
        </Text>
        {hint ? (
          <Text size="1" color="gray" as="p">
            {hint}
          </Text>
        ) : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

export function ExportButton({
  title,
  detail,
  primary,
  disabled,
  onClick,
}: {
  title: string
  detail: string
  primary?: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      className="ui-export"
      size="3"
      variant={primary ? 'solid' : 'soft'}
      color={primary ? undefined : 'gray'}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ui-export-copy">
        <Text size="2" weight="medium">
          {title}
        </Text>
        <Text size="1">{detail}</Text>
      </span>
      <Text size="3" weight="bold">
        ↓
      </Text>
    </Button>
  )
}

export function PanelTitle({ step, title }: { step: string; title: string }) {
  return (
    <div className="ui-panel-title">
      <Badge variant="soft">{step}</Badge>
      <Heading size="3">{title}</Heading>
    </div>
  )
}

export function DropZone({
  dragging,
  children,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragging?: boolean
  children: ReactNode
  onClick?: () => void
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void
  onDragLeave?: () => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
}) {
  return (
    <Button
      type="button"
      variant="surface"
      size="3"
      className={`ui-drop-zone${dragging ? ' is-dragging' : ''}`}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </Button>
  )
}

export function PresetCards({
  value,
  options,
  onChange,
  columns = '2',
}: {
  value: string
  options: { value: string; label: string; detail: string }[]
  onChange: (value: string) => void
  columns?: '1' | '2' | '3'
}) {
  return (
    <RadioCards.Root
      columns={columns}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
    >
      {options.map((option) => (
        <RadioCards.Item key={option.value} value={option.value}>
          <Text weight="medium">{option.label}</Text>
          <Text size="1" color="gray">
            {option.detail}
          </Text>
        </RadioCards.Item>
      ))}
    </RadioCards.Root>
  )
}

export function ChipButton({
  active,
  disabled,
  children,
  onClick,
  title,
  className,
}: {
  active?: boolean
  disabled?: boolean
  children: ReactNode
  onClick?: () => void
  title?: string
  className?: string
}) {
  return (
    <Button
      type="button"
      size="1"
      variant={active ? 'solid' : 'soft'}
      color={active ? undefined : 'gray'}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={className}
    >
      {children}
    </Button>
  )
}

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  tools,
  children,
  maxWidth = '960px',
  compact = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  eyebrow?: string
  tools?: ReactNode
  children: ReactNode
  maxWidth?: string
  compact?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        className={`app-sheet${compact ? ' is-compact' : ''}`}
        maxWidth={maxWidth}
      >
        <div className="app-sheet-head">
          <div>
            {eyebrow ? (
              <Badge variant="soft" style={{ marginBottom: 8 }}>
                {eyebrow}
              </Badge>
            ) : null}
            <Dialog.Title>{title}</Dialog.Title>
            {description ? (
              <Dialog.Description>{description}</Dialog.Description>
            ) : null}
          </div>
          <Dialog.Close>
            <IconButton variant="ghost" color="gray" aria-label="Close">
              ×
            </IconButton>
          </Dialog.Close>
        </div>
        {tools ? <div className="app-sheet-tools">{tools}</div> : null}
        <div className="app-sheet-body">{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Classic SpinKit fold — loops on its own; progress lives on the bar. */
export function FoldingCube() {
  return (
    <div className="ui-fold" aria-hidden="true">
      <div className="ui-fold-cube" />
      <div className="ui-fold-cube" />
      <div className="ui-fold-cube" />
      <div className="ui-fold-cube" />
    </div>
  )
}

/** Keep overlay / status lines from stretching the chrome. */
export function compactLabel(text: string, maxChars = 36): string {
  const value = text.trim()
  if (value.length <= maxChars) return value
  const extMatch = /\.[A-Za-z0-9]{1,8}$/.exec(value)
  const ext = extMatch?.[0] ?? ''
  const stem = ext ? value.slice(0, -ext.length) : value
  const budget = Math.max(6, maxChars - ext.length - 1)
  if (stem.length <= budget) return `${stem}${ext}`
  const head = Math.max(3, Math.ceil(budget * 0.65))
  const tail = Math.max(0, budget - head)
  return `${stem.slice(0, head)}…${tail ? stem.slice(-tail) : ''}${ext}`
}

export function fileProgressLabel(verb: string, fileName: string, maxChars = 28): string {
  return `${verb} ${compactLabel(fileName, maxChars)}…`
}

export type LoadProgress = {
  ratio: number
  label: string
  indeterminate?: boolean
}

export type LoadOverlayProps = {
  label: string
  ratio?: number
  indeterminate?: boolean
  detail?: string
  title?: string
  variant?: 'cover' | 'page'
}

export function overlayFromProgress(
  progress: LoadProgress | null,
  fallbackLabel: string,
): LoadOverlayProps {
  if (!progress) return { label: fallbackLabel, indeterminate: true }
  return {
    label: progress.label,
    ratio: progress.ratio,
    indeterminate: progress.indeterminate,
  }
}

export function LoadOverlay({
  label,
  ratio,
  indeterminate,
  detail,
  title,
  variant = 'cover',
}: LoadOverlayProps) {
  const unknown =
    indeterminate === true || ratio == null || !Number.isFinite(ratio)
  const clamped = unknown ? 0 : Math.min(1, Math.max(0, ratio))
  const pct = Math.round(clamped * 100)
  const showDetail = Boolean(detail && detail !== label)

  return (
    <div
      className={`ui-load ui-load--${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="ui-load-card">
        <FoldingCube />
        {title ? <p className="ui-load-title" title={title}>{title}</p> : null}
        <div className="ui-load-heading">
          <strong>{label}</strong>
          <span className="ui-load-pct">{unknown ? '…' : `${pct}%`}</span>
        </div>
        <div
          className={`ui-load-track${unknown ? ' is-indeterminate' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={unknown ? undefined : pct}
          aria-valuetext={unknown ? label : `${pct}%`}
        >
          <div
            className="ui-load-fill"
            style={
              unknown
                ? undefined
                : { transform: `scaleX(${Math.max(0.02, clamped)})` }
            }
          />
        </div>
        {showDetail ? <p className="ui-load-detail" title={detail}>{detail}</p> : null}
      </div>
    </div>
  )
}
