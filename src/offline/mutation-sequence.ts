let lastMutationSequence = 0;

/**
 * A monotonic sequence stamped on outbox entries so an entity's create always
 * drains before its later mutations, even when their millisecond timestamps tie.
 * It is anchored to the wall clock so ordering stays roughly stable across
 * reloads, and shared by every command module so there is one counter, not one
 * per entity.
 */
export function nextMutationSequence(): number {
  lastMutationSequence = Math.max(Date.now(), lastMutationSequence + 1);
  return lastMutationSequence;
}
