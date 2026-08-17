/**
 * Minimal `.env` parser for the release scripts.
 *
 * The release scripts pull a target environment's variables with
 * `vercel env pull` into a temporary file, then load them here to verify the
 * environment before mutating anything. This is a deliberately small parser
 * covering the shape the Vercel CLI writes (`KEY="value"` with escaped
 * newlines) rather than a general dotenv implementation.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    result[key] = parseValue(rawValue);
  }

  return result;
}

function parseValue(rawValue: string): string {
  const value = rawValue.trim();

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"');
  }

  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }

  return value;
}
