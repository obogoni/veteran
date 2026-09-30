import assert from "node:assert/strict";
import { test } from "node:test";
import { compileExcludes } from "../src/snapshot/glob.ts";

test("C12 the excludePaths dialect decides the task's examples and treats other characters literally", () => {
  const cases: Array<[pattern: string, path: string, excluded: boolean]> = [
    ["config", "config/app/secrets.json", true],
    ["config/**", "config/app/secrets.json", true],
    ["*.pem", "key.pem", true],
    ["*.pem", "certs/key.pem", false],
    ["**/*.pem", "key.pem", true],
    ["**/*.pem", "certs/key.pem", true],
    ["Config/**", "config/a.txt", false],
    ["a?.txt", "ab.txt", false],
    ["a?.txt", "a?.txt", true],
  ];
  for (const [pattern, path, excluded] of cases) {
    assert.equal(compileExcludes([pattern])(path), excluded, `${pattern} vs ${path}`);
  }
});

test("globs: * stays within a segment, ** spans segments in the middle", () => {
  const match = compileExcludes(["src/*/secret.txt", "a/**/z.txt"]);
  assert.equal(match("src/x/secret.txt"), true);
  assert.equal(match("src/x/y/secret.txt"), false);
  assert.equal(match("a/z.txt"), true);
  assert.equal(match("a/b/c/z.txt"), true);
  assert.equal(match("ab/z.txt"), false);
});
