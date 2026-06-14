import { z } from 'zod';
import type { Brand } from '../types/index.js';

export type NoteId = Brand<string, 'NoteId'>;

export const createNoteInputSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().max(2000),
});

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(100),
  body: z.string().max(2000),
  createdAt: z.iso.datetime(),
});

export type Note = z.infer<typeof noteSchema>;
