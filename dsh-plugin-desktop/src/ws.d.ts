/**
 * Ambient declaration for the `ws` WebSocket client package.
 *
 * `ws` ships no bundled types; the desktop package uses it only for the
 * WeCom bot long connection (JSON frames, no binary protocols), so a narrow
 * ambient declaration is sufficient and avoids a @types/ws dependency.
 */

declare module 'ws' {
  import type { EventEmitter } from 'node:events'

  interface ClientOptions {
    perMessageDeflate?: boolean
    skipUTF8Validation?: boolean
  }

  type Data = string | Buffer | ArrayBuffer | Buffer[]

  class WebSocket extends EventEmitter {
    static readonly CONNECTING: number
    static readonly OPEN: number
    static readonly CLOSING: number
    static readonly CLOSED: number

    constructor(address: string | URL, options?: ClientOptions)
    readonly readyState: number
    readonly url: string
    send(data: string | Buffer, callback?: (err?: Error) => void): void
    send(data: string | Buffer, options?: unknown, callback?: (err?: Error) => void): void
    ping(data?: unknown): void
    pong(data?: unknown): void
    close(code?: number, reason?: string): void
    terminate(): void
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: Data, isBinary: boolean) => void): this
    on(event: 'error', listener: (err: Error) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'ping', listener: (data: Buffer) => void): this
    on(event: 'pong', listener: (data: Buffer) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
    removeAllListeners(event?: string | symbol): this
  }

  /** Namespace merge so `WebSocket.Data` type access matches @types/ws. */
  namespace WebSocket {
    type Data = string | Buffer | ArrayBuffer | Buffer[]
    interface ClientOptions {
      perMessageDeflate?: boolean
      skipUTF8Validation?: boolean
    }
  }

  export default WebSocket
}
