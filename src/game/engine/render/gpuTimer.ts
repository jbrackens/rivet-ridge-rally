/**
 * GPU frame timing via `EXT_disjoint_timer_query_webgl2`.
 *
 * The project has never had a GPU number — every recorded "frame work" figure is
 * synchronous CPU time in the rAF callback (GRAPHICS_EVOLUTION_PLAN.md §4, Phase
 * 0). That is the wrong axis for deciding whether a render change is affordable:
 * the whole graphics plan spends on the GPU, and the CPU timer cannot see it.
 *
 * This wraps the render call in a GPU timer query. Results lag the submitting
 * frame by a few frames, so a small ring of queries is kept in flight and the
 * oldest completed one is read each frame.
 *
 * It is entirely optional. The extension is absent on some drivers (notably
 * software rasterisers and parts of mobile Safari), and when it is, every method
 * is a no-op and {@link GpuFrameTimer.available} is false — the engine renders
 * exactly as before and simply reports no GPU number.
 */

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

const RING = 4;

export class GpuFrameTimer {
  readonly available: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerExtension | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private lastMs: number | null = null;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    // Timer queries are a WebGL2 feature. Three r185 runs WebGL2 by default; a
    // WebGL1 context simply reports unavailable.
    const gl2 = (typeof WebGL2RenderingContext !== "undefined"
      && gl instanceof WebGL2RenderingContext)
      ? gl
      : null;
    this.gl = gl2 as WebGL2RenderingContext;
    this.ext = gl2 ? (gl2.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null) : null;
    this.available = Boolean(gl2 && this.ext);
  }

  /** Begin timing the frame's GPU work. Call immediately before render. */
  begin(): void {
    if (!this.available || this.active) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.active = query;
    this.gl.beginQuery(this.ext!.TIME_ELAPSED_EXT, query);
  }

  /** End timing and harvest the oldest completed result. Call after render. */
  end(): void {
    if (!this.available || !this.active) return;
    this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.harvest();
    // Bound the in-flight set: if results are not coming back (throttled tab,
    // driver stall), drop the excess rather than leak query objects.
    while (this.pending.length > RING) {
      const stale = this.pending.shift();
      if (stale) this.gl.deleteQuery(stale);
    }
  }

  /** The most recent GPU frame time in milliseconds, or null if unknown. */
  readMs(): number | null {
    return this.lastMs;
  }

  dispose(): void {
    for (const q of [...this.pending, this.active]) {
      if (q) this.gl.deleteQuery(q);
    }
    this.pending.length = 0;
    this.active = null;
  }

  private harvest(): void {
    const oldest = this.pending[0];
    if (!oldest) return;
    const disjoint = this.gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
    const ready = this.gl.getQueryParameter(oldest, this.gl.QUERY_RESULT_AVAILABLE) as boolean;
    if (!ready) return;
    this.pending.shift();
    if (!disjoint) {
      const nanos = this.gl.getQueryParameter(oldest, this.gl.QUERY_RESULT) as number;
      this.lastMs = Number((nanos / 1_000_000).toFixed(2));
    }
    this.gl.deleteQuery(oldest);
  }
}
