/** @impl URC-13.2 @impl URC-13.3 */
export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
	readonly level: LogLevel;
	readonly message: string;
}

export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	debug(message: string): void;
}

export interface LoggerOptions {
	readonly debug?: boolean;
	readonly sink?: (entry: LogEntry) => void;
}

const defaultSink = (entry: LogEntry): void => {
	const output =
		entry.level === "error"
			? console.error
			: entry.level === "warn"
				? console.warn
				: console.log;
	output(entry.message);
};

export function createLogger(options: LoggerOptions = {}): Logger {
	const sink = options.sink ?? defaultSink;
	const emit = (level: LogLevel, message: string): void => {
		if (level === "debug" && options.debug !== true) return;
		sink({ level, message });
	};

	return {
		info: (message) => emit("info", message),
		warn: (message) => emit("warn", message),
		error: (message) => emit("error", message),
		debug: (message) => emit("debug", message),
	};
}
