/** Streaming OBJ text writer — avoids holding a giant string + encoded copy in RAM. */

const DEFAULT_FLUSH = 1024 * 1024

export class ObjTextWriter {
  private buf: string[] = []
  private chars = 0
  private chunks: Uint8Array[] = []
  private readonly enc = new TextEncoder()
  private readonly onChunk?: (chunk: Uint8Array) => void | Promise<void>
  private readonly flushAt: number

  constructor(
    onChunk?: (chunk: Uint8Array) => void | Promise<void>,
    flushAt = DEFAULT_FLUSH,
  ) {
    this.onChunk = onChunk
    this.flushAt = flushAt
  }

  /** Sync append — never await per line (that freezes on million-vert meshes). */
  line(s: string): void {
    this.buf.push(s)
    this.chars += s.length + 1
  }

  get pendingChars(): number {
    return this.chars
  }

  needsFlush(): boolean {
    return this.chars >= this.flushAt
  }

  async flushIfNeeded(): Promise<void> {
    if (this.needsFlush()) await this.flush()
  }

  async flush(): Promise<void> {
    if (this.buf.length === 0) return
    const text = `${this.buf.join('\n')}\n`
    this.buf = []
    this.chars = 0
    const bytes = this.enc.encode(text)
    if (this.onChunk) {
      await this.onChunk(bytes)
      return
    }
    this.chunks.push(bytes)
  }

  /** Empty when chunks were streamed via `onChunk`. */
  async finish(): Promise<Uint8Array> {
    await this.flush()
    if (this.onChunk) return new Uint8Array()
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    this.chunks = []
    return out
  }
}

/** Prefer keeping converted / imported OBJs under this size in the WebView heap. */
export const IN_MEMORY_OBJ_MAX = 32 * 1024 * 1024
/**
 * Above this, import keeps path-only (convert still works).
 * Preview loads from disk on demand when the part is selected.
 */
export const OBJ_FULL_LOAD_MAX = 128 * 1024 * 1024
