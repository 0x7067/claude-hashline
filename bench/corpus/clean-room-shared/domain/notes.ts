import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import * as R from 'remeda';
import {
  createNoteInputSchema,
  type Note,
  type NoteId,
  type CreateNoteInput,
} from '../validation/notes.js';

export function buildNote(
  id: NoteId,
  input: CreateNoteInput,
  createdAt: string,
): Result<Note, Error> {
  const parsed = createNoteInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(new Error('Invalid note input'));
  }
  return ok({
    id,
    title: parsed.data.title,
    body: parsed.data.body,
    createdAt,
  });
}

export function sortNotesByDate(notes: Note[]): Note[] {
  return R.sortBy(notes, [R.prop('createdAt'), 'desc']);
}
