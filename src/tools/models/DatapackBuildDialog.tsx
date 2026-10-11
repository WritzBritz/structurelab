import { useEffect, useState } from 'react'
import { Button, Text } from '@radix-ui/themes'
import {
  datapackPlaceCommand,
  datapackStopCommand,
  estimateDatapackBuild,
  sanitizeDatapackName,
} from '../../api'
import type { DatapackPattern, SceneVoxel } from '../../types'
import {
  AppDialog,
  Field,
  NumberField,
  Segmented,
  SelectField,
} from '../../ui/kit'
import {
  computeAnimatePaceFromDuration,
  computeOptimalPace,
  DEFAULT_DATAPACK_TARGET_SECONDS,
} from './datapackOrder'
import { DatapackBuildPreview } from './DatapackBuildPreview'

type PlaceKind = 'instant' | 'optimal' | 'animate'

const ANIMATION_PATTERNS: Array<[DatapackPattern, string]> = [
  ['layerYAsc', 'Bottom → top'],
  ['layerYDesc', 'Top → bottom'],
  ['axisZAsc', 'North → south'],
  ['axisXDesc', 'East → west'],
  ['radialOut', 'Radial out'],
  ['radialIn', 'Radial in'],
  ['sphereOut', 'Sphere out'],
  ['sphereIn', 'Sphere in'],
  ['spiralOut', 'Spiral out'],
  ['spiralIn', 'Spiral in'],
  ['layerSpiral', 'Layer spiral'],
  ['goldenSpiral', 'Golden spiral'],
  ['diagonal', 'Diagonal'],
  ['checker', 'Checkerboard'],
  ['random', 'Random'],
]

function placeKindOf(pattern: DatapackPattern): PlaceKind {
  if (pattern === 'instant') return 'instant'
  if (pattern === 'optimal') return 'optimal'
  return 'animate'
}

function isAnimationPattern(pattern: DatapackPattern): boolean {
  return pattern !== 'instant' && pattern !== 'optimal'
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  voxels: SceneVoxel[]
  size: [number, number, number]
  blockCount: number
  busy?: boolean
  datapackName: string
  onDatapackNameChange: (name: string) => void
  onDatapackNameEditEnd?: () => void
  pattern: DatapackPattern
  onPatternChange: (pattern: DatapackPattern) => void
  targetSeconds: number
  onTargetSecondsChange: (value: number) => void
  onTargetSecondsEditEnd?: () => void
  blocksPerTick: number
  onBlocksPerTickChange: (value: number) => void
  delayTicks: number
  onDelayTicksChange: (value: number) => void
  onDelayTicksEditEnd?: () => void
  /** Optimal export uses columns/tick (stored separately from preview BPT). */
  onPiecesPerTickChange?: (value: number) => void
  onExport: () => void
}

export function DatapackBuildDialog({
  open,
  onOpenChange,
  voxels,
  size,
  blockCount,
  busy = false,
  datapackName,
  onDatapackNameChange,
  onDatapackNameEditEnd,
  pattern,
  onPatternChange,
  targetSeconds,
  onTargetSecondsChange,
  onTargetSecondsEditEnd,
  blocksPerTick,
  onBlocksPerTickChange,
  delayTicks,
  onDelayTicksChange,
  onDelayTicksEditEnd,
  onPiecesPerTickChange,
  onExport,
}: Props) {
  const id = sanitizeDatapackName(datapackName)
  const placeCmd = datapackPlaceCommand(id)
  const stopCmd = datapackStopCommand(id)
  const placeKind = placeKindOf(pattern)
  const animated = pattern !== 'instant'
  const estimate = estimateDatapackBuild(blockCount, pattern, blocksPerTick, delayTicks)
  const optimalPace =
    placeKind === 'optimal' ? computeOptimalPace(blockCount, size, targetSeconds) : null
  const warnHuge = placeKind === 'animate' && blockCount > 50_000 && blocksPerTick < 8
  const [lastAnimatePattern, setLastAnimatePattern] = useState<DatapackPattern>('layerYAsc')

  useEffect(() => {
    if (isAnimationPattern(pattern)) setLastAnimatePattern(pattern)
  }, [pattern])

  // Derive blocks/step (and Optimal columns/tick) whenever duration or size changes.
  useEffect(() => {
    if (!open || pattern === 'instant') return
    if (pattern === 'optimal') {
      const pace = computeOptimalPace(blockCount, size, targetSeconds)
      if (pace.blocksPerTick !== blocksPerTick) onBlocksPerTickChange(pace.blocksPerTick)
      if (pace.delayTicks !== delayTicks) onDelayTicksChange(pace.delayTicks)
      onPiecesPerTickChange?.(pace.piecesPerTick)
      return
    }
    const pace = computeAnimatePaceFromDuration(blockCount, targetSeconds, delayTicks)
    if (pace.blocksPerTick !== blocksPerTick) onBlocksPerTickChange(pace.blocksPerTick)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional derive from duration
  }, [open, pattern, blockCount, size[0], size[1], size[2], targetSeconds, delayTicks])

  function applyPlaceKind(next: PlaceKind) {
    if (next === 'instant') {
      onPatternChange('instant')
      return
    }
    if (next === 'optimal') {
      // Use the shared default (3s), not the fastest-safe floor (often 0.25s).
      onTargetSecondsChange(DEFAULT_DATAPACK_TARGET_SECONDS)
      const pace = computeOptimalPace(blockCount, size, DEFAULT_DATAPACK_TARGET_SECONDS)
      onPatternChange('optimal')
      onBlocksPerTickChange(pace.blocksPerTick)
      onDelayTicksChange(pace.delayTicks)
      onPiecesPerTickChange?.(pace.piecesPerTick)
      return
    }
    onTargetSecondsChange(DEFAULT_DATAPACK_TARGET_SECONDS)
    onPatternChange(isAnimationPattern(pattern) ? pattern : lastAnimatePattern)
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="1120px"
      eyebrow="Export"
      title="Place datapack"
      description="Paste large builds without freezing, or play animated placement effects — preview matches in-game order."
    >
      <div className="datapack-build-dialog">
        <aside className="datapack-build-controls">
          <Field label="Datapack name">
            <input
              type="text"
              value={datapackName}
              onChange={(event) => onDatapackNameChange(event.target.value)}
              onBlur={() => onDatapackNameEditEnd?.()}
              placeholder="build"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <p className="datapack-build-hint">
            Becomes <code>{placeCmd}</code>. Letters, numbers, _ and - only.
          </p>

          <div className="datapack-mode-section datapack-mode-section--paste">
            <Text size="1" weight="bold" className="datapack-mode-kicker">
              Paste
            </Text>
            <p className="datapack-build-hint">
              For big builds — one-shot template, or paced like async world edit.
            </p>
            <Segmented
              size="2"
              value={placeKind}
              onChange={applyPlaceKind}
              options={[
                {
                  value: 'instant',
                  label: 'Instant',
                  title: 'Place the whole structure in one tick (place template)',
                },
                {
                  value: 'optimal',
                  label: 'Optimal',
                  title: 'Chunked place template at a target duration',
                },
                {
                  value: 'animate',
                  label: 'Animate',
                  title: 'Cinematic placement patterns — spirals, layers, and more',
                },
              ]}
            />

            {placeKind === 'instant' ? (
              <p className="datapack-build-hint">
                Places the whole structure in one tick with <code>place template</code>. Best for
                small builds — large ones can hitch or freeze the game.
              </p>
            ) : null}

            {placeKind === 'optimal' ? (
              <>
                <p className="datapack-build-hint">
                  Near-instant paste via chunked <code>place template</code>. Set how long it should
                  take — columns/tick are calculated for you.
                </p>
                <NumberField
                  label="Target time (seconds)"
                  value={targetSeconds}
                  min={0.25}
                  max={600}
                  step={0.25}
                  onChange={onTargetSecondsChange}
                  onEditEnd={onTargetSecondsEditEnd}
                />
                {estimate && optimalPace ? (
                  <p className="datapack-build-hint datapack-optimal-stats">
                    Auto · ~{optimalPace.pieceCount.toLocaleString()} columns ·{' '}
                    {optimalPace.piecesPerTick}/tick
                    {optimalPace.delayTicks > 0 ? ` · delay ${optimalPace.delayTicks}` : ''} · ~
                    {estimate.steps.toLocaleString()} steps · ~{estimate.seconds.toFixed(1)}s at 20
                    TPS
                    {blockCount > 0 ? ` · ${blockCount.toLocaleString()} blocks` : ''}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          {placeKind === 'animate' ? (
            <div className="datapack-mode-section datapack-mode-section--animate">
              <Text size="1" weight="bold" className="datapack-mode-kicker">
                Animation
              </Text>
              <p className="datapack-build-hint">
                Fun reveal patterns — set a target length and blocks/step are calculated for you.
              </p>

              <SelectField
                label="Pattern"
                value={pattern}
                onChange={(value) => onPatternChange(value as DatapackPattern)}
                options={ANIMATION_PATTERNS}
              />

              <NumberField
                label="Target time (seconds)"
                value={targetSeconds}
                min={0.25}
                max={3600}
                step={0.25}
                onChange={onTargetSecondsChange}
                onEditEnd={onTargetSecondsEditEnd}
              />
              <NumberField
                label="Delay between steps (ticks)"
                value={delayTicks}
                min={0}
                max={20}
                onChange={onDelayTicksChange}
                onEditEnd={onDelayTicksEditEnd}
              />
              <p className="datapack-build-hint">
                Auto blocks/step: {blocksPerTick.toLocaleString()} (from target time
                {delayTicks > 0 ? ` + delay ${delayTicks}` : ''}).
              </p>
              {estimate ? (
                <p className="datapack-build-hint">
                  ~{estimate.steps.toLocaleString()} steps · ~{estimate.seconds.toFixed(1)}s at 20 TPS
                  {blockCount > 0 ? ` · ${blockCount.toLocaleString()} blocks` : ''}
                </p>
              ) : null}
              {warnHuge ? (
                <p className="datapack-build-hint datapack-build-warn">
                  Large build with a low blocks/step — export zip and in-game lag may be heavy.
                  Shorten the target time, or switch to Optimal.
                </p>
              ) : null}
            </div>
          ) : null}

          <Button
            type="button"
            size="3"
            variant="solid"
            className="ui-export"
            disabled={busy || blockCount <= 0}
            onClick={onExport}
          >
            Export &amp; copy command
          </Button>

          {animated ? (
            <p className="datapack-build-hint">
              Stop early in-game with <code>{stopCmd}</code>.
            </p>
          ) : null}
        </aside>

        <div className="datapack-build-preview-wrap">
          {voxels.length > 0 ? (
            <DatapackBuildPreview
              voxels={voxels}
              size={size}
              pattern={pattern}
              blocksPerTick={blocksPerTick}
              delayTicks={delayTicks}
              datapackName={datapackName}
              blockCount={blockCount}
            />
          ) : (
            <div className="datapack-build-preview-empty">
              Convert a build first to preview placement.
            </div>
          )}
        </div>
      </div>
    </AppDialog>
  )
}
