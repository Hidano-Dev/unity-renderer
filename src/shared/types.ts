/** @impl URC-13.2 @impl URC-13.3 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { readonly [key: string]: JsonValue };

export type Result<T, E = CommonError> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export type ErrorCategory =
	| "user"
	| "environment"
	| "scene"
	| "timeout"
	| "hook"
	| "restore"
	| "io"
	| "internal";

export interface CommonError {
	readonly category: ErrorCategory;
	readonly code: string;
	readonly message: string;
	readonly cause?: unknown;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
	result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } => result.ok;

export const isErr = <T, E>(
	result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } => !result.ok;
