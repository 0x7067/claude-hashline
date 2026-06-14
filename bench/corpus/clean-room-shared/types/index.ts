import type { Result } from 'neverthrow';

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
