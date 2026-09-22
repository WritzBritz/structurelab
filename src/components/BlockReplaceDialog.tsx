import { useMemo, useState } from 'react'
import { Badge, Button, Text } from '@radix-ui/themes'
import { BlockIcon } from './BlockIcon'
import { MapColorSwatch } from './MapColorSwatch'
import {
  allPaletteBlocks,
  baseBlockId,
  blockChoices,
  friendlyBlockName,
  friendlyMapColorLabel,
  mapColorRgbHex,
  materialCategory,
  materialCategoryLabel,
  matchesMaterialSearch,
  recommendedReplacements,
  recommendedStatueCubes,
  statueBlockChoices,
  type BlockChoice,
} from '../materials'
import type { MapColor, ModelAppearanceCube, PaletteFile } from '../types'
import { AppDialog, SearchField, Segmented } from '../ui/kit'

export type BlockReplaceTarget = {
  color?: MapColor
  selectedState: string
  enabled: boolean
  rgb?: [number, number, number]
  replaced?: boolean
  sourceState?: string
  /** Support / control-row picker (map art staircase & gravity). */
  kind?: 'map' | 'support'
}

type Tab = 'recommended' | 'same' | 'any'

export function BlockReplaceDialog({
  palette,
  target,
  onPick,
  onReset,
  onToggleEnabled,
  onClose,
  statueSafe = false,
  perCube = false,
  cubes = [],
  pool,
}: {
  palette: PaletteFile
  target: BlockReplaceTarget
  onPick: (state: string) => void
  onReset: () => void
  onToggleEnabled: () => void
  onClose: () => void
  /** Models / statues: hide slabs, doors, Heavy Core, spawners, etc. */
  statueSafe?: boolean
  /** Models: one cube at a time, not a map-colour family. */
  perCube?: boolean
  cubes?: ModelAppearanceCube[]
  /** Fixed list for support picking (stable full cubes). */
  pool?: BlockChoice[]
}) {
  const { color, selectedState, enabled } = target
  const supportMode = target.kind === 'support' || Boolean(pool)
  const [tab, setTab] = useState<Tab>(supportMode ? 'any' : 'recommended')
  const [search, setSearch] = useState('')

  const colorLabel = color ? friendlyMapColorLabel(color) : friendlyBlockName(selectedState)
  const cubeRgb = target.rgb ?? color?.rgb ?? [128, 128, 128]
  const recommended = useMemo(() => {
    if (supportMode) {
      return (pool ?? []).slice(0, 24)
    }
    if (perCube) {
      return recommendedStatueCubes({ block: selectedState, rgb: cubeRgb }, cubes)
    }
    return color ? recommendedReplacements(color, palette, 16, statueSafe) : []
  }, [supportMode, pool, perCube, selectedState, cubeRgb, cubes, color, palette, statueSafe])
  const sameColour = useMemo(() => {
    if (supportMode) return pool ?? []
    if (perCube) {
      const category = materialCategory(selectedState)
      return cubes
        .filter((cube) => materialCategory(cube.block) === category)
        .map((cube) => ({
          id: cube.block,
          state: cube.block,
          name: friendlyBlockName(cube.block),
          category,
        }))
    }
    return color
      ? statueSafe
        ? statueBlockChoices(color)
        : blockChoices(color)
      : []
  }, [supportMode, pool, perCube, selectedState, cubes, color, statueSafe])
  const anyBlocks = useMemo(() => {
    if (supportMode) return pool ?? []
    if (perCube) {
      return cubes.map((cube) => ({
        id: cube.block,
        state: cube.block,
        name: friendlyBlockName(cube.block),
        category: materialCategory(cube.block),
      }))
    }
    return allPaletteBlocks(palette, statueSafe)
  }, [supportMode, pool, perCube, cubes, palette, statueSafe])

  const list: BlockChoice[] = useMemo(() => {
    const source = tab === 'recommended' ? recommended : tab === 'same' ? sameColour : anyBlocks
    return source.filter((choice) => matchesMaterialSearch(choice, search))
  }, [tab, recommended, sameColour, anyBlocks, search])

  const selectedId = baseBlockId(selectedState)
  const isDefault = supportMode
    ? selectedState === (target.sourceState ?? 'minecraft:cobblestone')
    : perCube
      ? !target.replaced
      : Boolean(color && selectedState === color.block)

  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      eyebrow={supportMode ? 'Support' : perCube ? 'Block' : 'Map colour'}
      title={supportMode ? 'Support block' : perCube ? friendlyBlockName(selectedState) : colorLabel}
      description={
        supportMode
          ? 'Used for the staircase control row and under gravity blocks / carpets.'
          : perCube
            ? `${materialCategoryLabel(materialCategory(selectedState))} · matched as its own cube texture`
            : `Pixel colour ${color ? mapColorRgbHex(color).toUpperCase() : ''} · Slot #${color?.id ?? ''}`
      }
      maxWidth="720px"
      tools={
        <>
          <div className="block-replace-current-row">
            <BlockIcon block={selectedState} color={cubeRgb} />
            <div>
              <Text size="1" color="gray">Building with</Text>
              <Text weight="medium">{friendlyBlockName(selectedState)}</Text>
              {!isDefault && !perCube && !supportMode && <Badge variant="soft">Custom</Badge>}
            </div>
          </div>
          {!supportMode && (
            <Button type="button" variant="soft" color="gray" size="2" onClick={onToggleEnabled}>
              {perCube
                ? enabled
                  ? 'Skip this block'
                  : 'Use this block'
                : enabled
                  ? 'Skip this map colour'
                  : 'Use this map colour'}
            </Button>
          )}
          <Button type="button" variant="soft" color="gray" size="2" disabled={isDefault} onClick={onReset}>
            {supportMode
              ? 'Reset to cobblestone'
              : perCube
                ? 'Clear replacement'
                : 'Reset to vanilla default'}
          </Button>
          {!supportMode && (
            <Segmented
              value={tab}
              onChange={(next) => {
                setTab(next)
                setSearch('')
              }}
              options={[
                { value: 'recommended', label: 'Suggested' },
                { value: 'same', label: perCube ? 'Same type' : 'This shade' },
                { value: 'any', label: 'Search all' },
              ]}
            />
          )}
          <SearchField
            placeholder={
              supportMode
                ? 'Search support blocks…'
                : tab === 'any'
                  ? statueSafe
                    ? 'Search full-cube statue blocks…'
                    : 'Search every block in the palette…'
                  : tab === 'same'
                    ? perCube
                      ? 'Search this block type…'
                      : 'Search blocks for this map colour…'
                    : 'Filter suggested blocks…'
            }
            value={search}
            onChange={setSearch}
          />
          <Text size="1" color="gray">
            {list.length} block{list.length === 1 ? '' : 's'}
            {supportMode && ' · stable full cubes for control rows and under-supports'}
            {!supportMode && tab === 'recommended' && (statueSafe
              ? perCube
                ? ' · nearby cube textures, not map-item shades'
                : ' · wool, concrete, terracotta, and other full cubes'
              : ' · wool, concrete, terracotta, and close matches')}
            {!supportMode && tab === 'any' && statueSafe && ' · no slabs, doors, spawners, or Heavy Core'}
          </Text>
        </>
      }
    >
      {!perCube && !supportMode && color && (
        <div className="block-replace-hero-swatch">
          <MapColorSwatch color={color} size={44} className="block-replace-swatch" />
        </div>
      )}
      <div className="block-replace-grid">
        {list.map((choice) => {
          const active = baseBlockId(choice.state) === selectedId
          return (
            <Button
              key={`${tab}-${choice.id}`}
              type="button"
              variant={active ? 'solid' : 'surface'}
              className="block-replace-tile"
              title={choice.state}
              onClick={() => onPick(choice.state)}
            >
              <BlockIcon block={choice.state} color={color?.rgb ?? cubeRgb} />
              <span className="block-replace-tile-name">{choice.name}</span>
              <span className="block-replace-tile-category">
                {materialCategoryLabel(choice.category)}
              </span>
            </Button>
          )
        })}
        {list.length === 0 && (
          <div className="block-replace-empty">No blocks match this search.</div>
        )}
      </div>
    </AppDialog>
  )
}
