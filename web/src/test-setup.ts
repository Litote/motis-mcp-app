// Tests in English whatever the locale of the machine (navigator.language of Node follows the system locale)
Object.defineProperty(globalThis.navigator, "language", { value: "en-US", configurable: true });
