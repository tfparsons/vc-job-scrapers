import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const NOW = new Date("2026-09-02T06:30:00Z");

export function fixture(name) {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

// Compare `value` with test/snapshots/<name>.json. Run `npm run test:update`
// to rewrite snapshots after an intended parser change.
export function expectSnapshot(name, value) {
  const file = join(here, "snapshots", `${name}.json`);
  const json = JSON.stringify(value, null, 2) + "\n";
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    writeFileSync(file, json);
    return;
  }
  assert.deepEqual(
    JSON.parse(json),
    JSON.parse(readFileSync(file, "utf8")),
    `snapshot ${name} differs; run npm run test:update if the change is intended`,
  );
}
