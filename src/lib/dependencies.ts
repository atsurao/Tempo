import type { TaskDependency } from "../types";

/**
 * Adding predecessor → successor closes a loop when the successor can already
 * reach the predecessor through existing finish-to-start links. The scheduler
 * detects loops too, but blocking them at edit time avoids silently dropping
 * every task in the loop from the plan.
 */
export function wouldCreateDependencyCycle(
  dependencies: TaskDependency[],
  predecessorId: string,
  successorId: string,
  ignoreId?: string,
): boolean {
  if (predecessorId === successorId) return true;

  const outgoing = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (dependency.id === ignoreId || dependency.type !== "FS") continue;
    const list = outgoing.get(dependency.predecessorId) ?? [];
    list.push(dependency.successorId);
    outgoing.set(dependency.predecessorId, list);
  }

  const stack = [successorId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === predecessorId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(outgoing.get(id) ?? []));
  }
  return false;
}
