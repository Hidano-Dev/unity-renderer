import type { OutputFormat } from "../../config/schema.js";

export function codecArgsFor(format: OutputFormat): readonly string[] {
	switch (format) {
		case "mp4":
			return [
				"-c:a",
				"aac",
				"-ar",
				"48000",
				"-ac",
				"2",
				"-b:a",
				"256k",
				"-movflags",
				"+faststart",
			];
		case "mov-prores":
			return ["-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2"];
	}
}
