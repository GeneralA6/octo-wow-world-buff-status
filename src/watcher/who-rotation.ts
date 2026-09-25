import type { WhoFn } from "./roster.js";

/**
 * A /who that goes out on each of a set of sockets in turn.
 *
 * The realm silently drops a /who that a character sends too soon after its last one: the Spire
 * query sent a breath after the lair's, on the watcher's own socket, went unanswered 517 times in
 * 518 overnight, while the lair's once-a-minute query never missed. Another character's socket is
 * not held to that — the lair's class slices go out a breath apart on the listeners' sockets and are
 * answered — so a second regular reading belongs on theirs, spread across them so no one character
 * asks often.
 *
 * `sockets` is read on every call, as listeners come and go; with none in world the query is refused
 * rather than sent on a socket that would drop it.
 */
export function rotatingWho(sockets: () => readonly WhoFn[]): WhoFn {
  let turn = 0;
  return (query) => {
    const available = sockets();
    if (available.length === 0) return Promise.reject(new Error("no socket free to /who on"));
    const who = available[turn % available.length]!;
    turn += 1;
    return who(query);
  };
}
