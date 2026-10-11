/**
 * The Mac app's native commands, called from the school server's pages. Every call fails safe:
 * outside the app (or on an older app) nothing happens and nothing throws, except start(),
 * whose message the page shows.
 */
import { isDesktop } from "./shell";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function bridge(): Invoke | null {
  if (!isDesktop || typeof window === "undefined") return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke.bind(internals) : null;
}

const message = (e: unknown) =>
  typeof e === "string" ? e : e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === "string" ? String((e as { message: string }).message) : "call audio isn't available.";

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return null;
}

/** The other side of a Zoom/Meet/Teams call: the computer's sound, recorded by the Mac app. */
export const callAudio = {
  async available(): Promise<boolean> {
    const invoke = bridge();
    if (!invoke) return false;
    try {
      return (await invoke("call_audio_available")) === true;
    } catch {
      return false;
    }
  },

  /** Throws an Error whose message is the app's reason (e.g. a permission to grant). */
  async start(): Promise<void> {
    const invoke = bridge();
    if (!invoke) throw new Error("call audio isn't available.");
    try {
      await invoke("call_audio_start");
    } catch (e) {
      throw new Error(message(e));
    }
  },

  /** The recording as an .m4a Blob, or null if there is none. */
  async stop(): Promise<Blob | null> {
    const invoke = bridge();
    if (!invoke) return null;
    try {
      const bytes = toBytes(await invoke("call_audio_stop"));
      return bytes && bytes.byteLength ? new Blob([bytes], { type: "audio/mp4" }) : null;
    } catch {
      return null;
    }
  },
};
