const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const hook = require("../macos-vmp.cjs");
const script = path.resolve(__dirname, "../macos-vmp.cjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidal-vmp-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, "package with spaces", "Tidal Test.app");
  const framework = path.join(
    app,
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
  );
  fs.mkdirSync(path.dirname(framework), { recursive: true });
  fs.writeFileSync(framework, "test fixture, not an Electron binary");
  const python = path.join(dir, "fake-python");
  const log = path.join(dir, "calls.jsonl");
  fs.writeFileSync(
    python,
    `#!${process.execPath}\n` +
      `const fs = require('node:fs');\n` +
      `const args = process.argv.slice(2);\n` +
      `fs.appendFileSync(process.env.TEST_EVS_LOG, JSON.stringify(args)+'\\n');\n` +
      `process.exit(args.includes(process.env.TEST_EVS_FAIL || 'never') ? 7 : 0);\n`,
    { mode: 0o700 },
  );
  const run = (command, fail = "", selectedApp = app) => {
    const result = spawnSync(process.execPath, [script, command, selectedApp], {
      env: {
        ...process.env,
        TIDAL_HIFI_EVS_PYTHON: python,
        TEST_EVS_LOG: log,
        TEST_EVS_FAIL: fail,
      },
      encoding: "utf8",
    });
    const calls = fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
      : [];
    return { ...result, calls };
  };
  return { app, run };
}

test("verification never requests a signature and keeps paths with spaces intact", (t) => {
  const { app, run } = fixture(t);
  const result = run("verify");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    [
      "-m",
      "castlabs_evs.vmp",
      "--no-ask",
      "verify-pkg",
      "--streaming",
      "--name-hint",
      "Tidal Test",
      path.dirname(app),
    ],
  ]);
});

test("signing must be followed by successful production verification", (t) => {
  const result = fixture(t).run("sign", "verify-pkg");
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.calls.map((args) => args[3]),
    ["sign-pkg", "verify-pkg"],
  );
  assert.match(result.stderr, /verify-pkg failed/);
});

test("a successful signing run also verifies the resulting signature", (t) => {
  const result = fixture(t).run("sign");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((args) => args[3]),
    ["sign-pkg", "verify-pkg"],
  );
});

test("a signing failure stops before verification", (t) => {
  const result = fixture(t).run("sign", "sign-pkg");
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.calls.map((args) => args[3]),
    ["sign-pkg"],
  );
});

test("non-macOS builds do not invoke EVS", async () => {
  await hook({ electronPlatformName: "linux" });
  await hook({ electronPlatformName: "win32" });
});

test("rejects a glob name before EVS can select another app", (t) => {
  const result = fixture(t).run("sign", "", "/tmp/*.app");
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
  assert.match(result.stderr, /glob characters/);
});

test("a missing app fails without making a signing request", (t) => {
  const result = fixture(t).run("sign", "", "/no-such-tidal-vmp-test.app");
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
});
