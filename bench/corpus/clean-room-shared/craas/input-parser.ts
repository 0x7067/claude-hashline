import { err, ok, type Result } from 'neverthrow';
import { RUN_REJECTION_CODE, type RunRejectionCode } from './constants.js';
import type { Target } from './types.js';

export interface ParseError {
  code: RunRejectionCode;
  message: string;
}

const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function parseInput(raw: string): Result<Target, ParseError> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return err({ code: RUN_REJECTION_CODE.EMPTY_INPUT, message: 'Input is empty' });
  }

  // npm URL forms
  const npmUrl = /^https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/i.exec(trimmed);
  if (npmUrl) {
    const name = decodeURIComponent(npmUrl[1] ?? '');
    if (!NPM_NAME_RE.test(name)) {
      return err({
        code: RUN_REJECTION_CODE.INVALID_PACKAGE_NAME,
        message: `Invalid npm package name: ${name}`,
      });
    }
    return ok({ platform: 'npm', packageName: name, rawInput: trimmed });
  }

  // GitHub URL forms
  const ghUrl =
    /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(
      trimmed,
    );
  if (ghUrl) {
    return ok({
      platform: 'github',
      owner: ghUrl[1],
      repo: ghUrl[2],
      rawInput: trimmed,
    });
  }

  // bare npm name
  if (NPM_NAME_RE.test(trimmed)) {
    return ok({ platform: 'npm', packageName: trimmed, rawInput: trimmed });
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return err({
      code: RUN_REJECTION_CODE.UNSUPPORTED_URL,
      message: 'Only npmjs.com/package/<name> and github.com/<owner>/<repo> URLs are supported',
    });
  }

  return err({
    code: RUN_REJECTION_CODE.INVALID_PACKAGE_NAME,
    message: 'Could not interpret input as an npm package or GitHub repo',
  });
}
