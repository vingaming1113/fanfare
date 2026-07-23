// Tiny in-process pub/sub. The server subscribes and fans messages out to all
// connected WebSocket widgets/dashboards.
import type { SocketMessage } from "./events.ts";

type Listener = (msg: SocketMessage) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(msg: SocketMessage): void {
  for (const fn of listeners) {
    try {
      fn(msg);
    } catch (err) {
      console.error("bus listener error", err);
    }
  }
}
