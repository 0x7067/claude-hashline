import { realpathSync } from "node:fs";
import * as path from "node:path";
import { NodeFilesystem } from "@oh-my-pi/hashline";

/**
 * Canonicalize an absolute path by resolving symlinks. The target may not exist
 * yet (file creation), so realpath the longest existing ancestor and re-append
 * the remaining segments. This makes containment robust to symlinked roots
 * (e.g. macOS `/var` -> `/private/var`, where a non-canonical root would
 * spuriously reject valid in-workspace paths) AND defeats symlink-based escapes
 * (a link inside the workspace pointing out resolves to its real target).
 */
export function canonicalize(abs: string): string {
  const segs: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return segs.length ? path.join(real, ...segs.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs; // reached fs root; nothing to resolve
      segs.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Error thrown when a patch section's path escapes the workspace root.
 * Implements the KTD9 path-containment gate (and SEC-002 mitigation): the
 * patch `input` is model-controlled, so an unbounded path is an arbitrary
 * file-write primitive.
 */
export class PathEscapeError extends Error {
  constructor(requested: string, resolved: string, root: string) {
    super(
      `Path '${requested}' resolves to '${resolved}', which is outside the workspace root '${root}'. ` +
        `hashline edits are confined to the workspace (and, when enabled, the Claude memory dir).`,
    );
    this.name = "PathEscapeError";
  }
}

/**
 * Disk-backed filesystem confined to a single root directory. Every read,
 * write, existence probe, and canonical-key resolution goes through
 * {@link resolveInside}, which both enforces containment (KTD9) and pins the
 * snapshot-store key to the resolved absolute path so the `read` adapter and
 * the patcher agree on it (feas-04). Overriding {@link NodeFilesystem} means
 * the patcher's own reads/writes are jailed too, not just the adapter's.
 */
export class JailedFilesystem extends NodeFilesystem {
  readonly root: string;
  /** Additive containment escape hatch: a resolved absolute path outside
   * {@link root} is still permitted when this predicate returns true. Keeps the
   * jail policy-free — the carve-out (e.g. the Claude memory dir) is injected by
   * the caller, not hardcoded here. */
  private readonly extraAllow?: (resolved: string) => boolean;

  constructor(root: string, extraAllow?: (resolved: string) => boolean) {
    super();
    this.root = canonicalize(path.resolve(root));
    this.extraAllow = extraAllow;
  }

  /** Resolve `p` against the root and reject anything that escapes it. Both the
   * root and the target are canonicalized (symlinks resolved) so the prefix
   * check compares real paths — otherwise a symlinked root or a realpath'd
   * input would falsely read as an escape (and a symlink escape would slip).
   * A path outside the root is still allowed if {@link extraAllow} accepts it. */
  resolveInside(p: string): string {
    const resolved = canonicalize(path.resolve(this.root, p));
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep) && !this.extraAllow?.(resolved)) {
      throw new PathEscapeError(p, resolved, this.root);
    }
    return resolved;
  }

  override canonicalPath(p: string): string {
    return this.resolveInside(p);
  }

  override async readText(p: string): Promise<string> {
    return super.readText(this.resolveInside(p));
  }

  override async writeText(p: string, content: string) {
    return super.writeText(this.resolveInside(p), content);
  }

  override async exists(p: string): Promise<boolean> {
    return super.exists(this.resolveInside(p));
  }
}
