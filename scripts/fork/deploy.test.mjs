import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { main, validateManifest } from "./deploy.mjs";

const sha = "a".repeat(40);
const manifest = () => ({
  commit: sha,
  repository: "Deslakator/t3code",
  platform: "linux-x64",
  version: "0.1.3-fork.123.1",
  archive: "t3-0.1.3-fork.123.1-linux-x64.tar.gz",
  sha256: "b".repeat(64),
});

test("accepts the artifact for the exact requested commit", () => {
  assert.doesNotThrow(() => validateManifest(manifest(), sha));
});

test("rejects an artifact from a different commit or repository", () => {
  assert.throws(() => validateManifest({ ...manifest(), commit: "c".repeat(40) }, sha));
  assert.throws(() => validateManifest({ ...manifest(), repository: "other/fork" }, sha));
});

test("rejects a mismatched platform, archive path, or checksum", () => {
  assert.throws(() => validateManifest({ ...manifest(), platform: "linux-arm64" }, sha));
  assert.throws(() => validateManifest({ ...manifest(), archive: "../runtime.tar.gz" }, sha));
  assert.throws(() => validateManifest({ ...manifest(), sha256: "invalid" }, sha));
});

test("rejects a missing commit and versions that cannot be installed independently", () => {
  assert.throws(() => validateManifest({ ...manifest(), commit: undefined }, undefined));
  assert.throws(() => validateManifest({ ...manifest(), version: "0.1.3" }, sha));
});

test("records the checksum of the actual archive without touching the service", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "t3-manifest-test-"));
  const previous = {
    RUNTIME_VERSION: process.env.RUNTIME_VERSION,
    GITHUB_SHA: process.env.GITHUB_SHA,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  };
  try {
    process.env.RUNTIME_VERSION = "0.1.3-fork.123.1";
    process.env.GITHUB_SHA = sha;
    process.env.GITHUB_REPOSITORY = "Deslakator/t3code";
    fs.writeFileSync(path.join(directory, manifest().archive), "hello");
    await main(["manifest", directory]);
    const recorded = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    validateManifest(recorded, sha);
    assert.equal(
      recorded.sha256,
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rollback refuses a concurrent update and an unrelated active version without changing state", async () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "t3-deploy-test-"));
  const previousHome = process.env.T3CODE_DEPLOY_HOME;
  process.env.T3CODE_DEPLOY_HOME = home;
  try {
    fs.mkdirSync(path.join(home, "runtime"));
    const stateFile = path.join(home, "runtime/service-state.json");
    const history = path.join(home, "runtime/fork-deployment.json");
    fs.writeFileSync(
      history,
      JSON.stringify({ previousVersion: "0.1.2", targetVersion: "0.1.3-fork.123.1" }),
    );
    const pending = JSON.stringify({
      protocol: 3,
      activeVersion: "0.1.3",
      update: { status: "pending" },
    });
    fs.writeFileSync(stateFile, pending);
    await assert.rejects(main(["rollback"]), /another update/);
    assert.equal(fs.readFileSync(stateFile, "utf8"), pending);
    const changed = JSON.stringify({ protocol: 3, activeVersion: "0.1.4" });
    fs.writeFileSync(stateFile, changed);
    await assert.rejects(main(["rollback"]), /no longer runs this deployment/);
    assert.equal(fs.readFileSync(stateFile, "utf8"), changed);
    assert.equal(fs.existsSync(path.join(home, "runtime/.fork-deploy-lock")), false);
  } finally {
    if (previousHome === undefined) delete process.env.T3CODE_DEPLOY_HOME;
    else process.env.T3CODE_DEPLOY_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
