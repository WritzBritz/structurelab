import { CopyableNotice } from './AppErrorHost'

type Props = {
  blocks: string[]
}

/** Warn when a placed block has no preview PNG. Export still uses the block. */
export function MissingTextureWarnings({ blocks }: Props) {
  if (blocks.length === 0) return null

  const body = blocks
    .map((block) => `Missing preview texture for ${block} (export still uses this block)`)
    .join('\n')

  return <CopyableNotice title="Missing preview textures" body={body} />
}
