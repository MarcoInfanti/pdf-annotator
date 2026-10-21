import { PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib';
import type { PDFContext, PDFObject } from 'pdf-lib';

/**
 * Deletes every indirect object that cannot be reached from the trailer (Root, Info, Encrypt, ID).
 * pdf-lib keeps objects whose last reference was removed, and writes them out again on save, so
 * without this a file grows a little with every reopen and save. Returns how many were deleted.
 */
export function removeUnreachable(context: PDFContext): number {
  const reachable = reachableTags(context);
  const unreachable = context
    .enumerateIndirectObjects()
    .map(([ref]) => ref)
    .filter((ref) => !reachable.has(ref.tag));
  unreachable.forEach((ref) => context.delete(ref));
  return unreachable.length;
}

/** Tags of every reference found by walking dictionaries, arrays and stream dictionaries from the trailer. */
function reachableTags(context: PDFContext): Set<string> {
  const reachable = new Set<string>();
  const pending: (PDFObject | undefined)[] = Object.values(context.trailerInfo);
  while (pending.length) {
    const object = pending.pop();
    if (object instanceof PDFRef && !reachable.has(object.tag)) {
      reachable.add(object.tag);
      pending.push(context.lookup(object));
    } else if (object instanceof PDFDict) {
      pending.push(...object.entries().map(([, value]) => value));
    } else if (object instanceof PDFArray) {
      pending.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      pending.push(object.dict);
    }
  }
  return reachable;
}
