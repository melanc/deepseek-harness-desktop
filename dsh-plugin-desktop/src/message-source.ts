/**
 * message-source -- provenance for desktop plugin-injected messages
 *
 * DSH 0.2.0 replaced the built-in `plugin` message source with a
 * merge-extensible `MessageSourceMap` (declared in `@deepseek-ai/dsh-llm`):
 * every producer declares its own kind through module augmentation, and
 * consumers fall through kinds they do not know.
 *
 * The desktop's own producers (`main-session`, `message-channels`) keep
 * emitting the `plugin` kind, so durable session logs written before the
 * 0.2.0 upgrade stay readable and one filter still covers every
 * plugin-injected message.
 *
 * @module
 */

import type {} from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message a desktop plugin injected on the user's behalf. */
    plugin: {
      kind: 'plugin'
      /** Plugin that injected the message (for example `main-session`). */
      plugin: string
    }
  }
}
