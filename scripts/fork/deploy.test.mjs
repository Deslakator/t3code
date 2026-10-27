import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { test } from "vite-plus/test";
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
  NodeAssert.doesNotThrow(() => validateManifest(manifest(), sha));
});

test("rejects an artifact from a different commit or repository", () => {
  NodeAssert.throws(() => validateManifest({ ...manifest(), commit: "c".repeat(40) }, sha));
  NodeAssert.throws(() => validateManifest({ ...manifest(), repository: "other/fork" }, sha));
});

test("rejects a mismatched platform, archive path, or checksum", () => {
  NodeAssert.throws(() => validateManifest({ ...manifest(), platform: "linux-arm64" }, sha));
  NodeAssert.throws(() => validateManifest({ ...manifest(), archive: "../runtime.tar.gz" }, sha));
  NodeAssert.throws(() => validateManifest({ ...manifest(), sha256: "invalid" }, sha));
});

test("rejects a missing commit and versions that cannot be installed independently", () => {
  NodeAssert.throws(() => validateManifest({ ...manifest(), commit: undefined }, undefined));
  NodeAssert.throws(() => validateManifest({ ...manifest(), version: "0.1.3" }, sha));
});

test("records the checksum of the actual archive without touching the service", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-manifest-test-"));
  const previous = {
    RUNTIME_VERSION: process.env.RUNTIME_VERSION,
    GITHUB_SHA: process.env.GITHUB_SHA,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  };
  try {
    process.env.RUNTIME_VERSION = "0.1.3-fork.123.1";
    process.env.GITHUB_SHA = sha;
    process.env.GITHUB_REPOSITORY = "Deslakator/t3code";
    NodeFS.writeFileSync(NodePath.join(directory, manifest().archive), "hello");
    await main(["manifest", directory]);
    const recorded = JSON.parse(
      NodeFS.readFileSync(NodePath.join(directory, "manifest.json"), "utf8"),
    );
    validateManifest(recorded, sha);
    NodeAssert.equal(
      recorded.sha256,
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

test("rollback refuses a concurrent update and an unrelated active version without changing state", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-deploy-test-"));
  const previousHome = process.env.T3CODE_DEPLOY_HOME;
  process.env.T3CODE_DEPLOY_HOME = home;
  try {
    NodeFS.mkdirSync(NodePath.join(home, "runtime"));
    const stateFile = NodePath.join(home, "runtime/service-state.json");
    const history = NodePath.join(home, "runtime/fork-deployment.json");
    NodeFS.writeFileSync(
      history,
      JSON.stringify({ previousVersion: "0.1.2", targetVersion: "0.1.3-fork.123.1" }),
    );
    const pending = JSON.stringify({
      protocol: 3,
      activeVersion: "0.1.3",
      update: { status: "pending" },
    });
    NodeFS.writeFileSync(stateFile, pending);
    await NodeAssert.rejects(main(["rollback"]), /another update/);
    NodeAssert.equal(NodeFS.readFileSync(stateFile, "utf8"), pending);
    const changed = JSON.stringify({ protocol: 3, activeVersion: "0.1.4" });
    NodeFS.writeFileSync(stateFile, changed);
    await NodeAssert.rejects(main(["rollback"]), /no longer runs this deployment/);
    NodeAssert.equal(NodeFS.readFileSync(stateFile, "utf8"), changed);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(home, "runtime/.fork-deploy-lock")), false);
  } finally {
    if (previousHome === undefined) delete process.env.T3CODE_DEPLOY_HOME;
    else process.env.T3CODE_DEPLOY_HOME = previousHome;
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});
