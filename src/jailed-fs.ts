import * as path from "node:path";
import { NodeFilesystem } from "@oh-my-pi/hashline";

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
        `hashline edits are confined to the workspace.`,
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

  constructor(root: string) {
    super();
    this.root = path.resolve(root);
  }

  /** Resolve `p` against the root and reject anything that escapes it. */
  resolveInside(p: string): string {
    const resolved = path.resolve(this.root, p);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
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
