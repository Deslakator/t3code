import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

const repository = "Deslakator/t3code";
const workflow = "fork-runtime.yml";
const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const runtimeVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function run(command, args, options = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout?.trim() ?? "";
}

function gh(args) {
  return run("gh", args);
}

function readJson(file) {
  return JSON.parse(NodeFS.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  const temporary = `${file}.${NodeCrypto.randomUUID()}.tmp`;
  NodeFS.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

async function checksum(file) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function validateManifest(manifest, sha) {
  if (
    manifest.commit !== sha ||
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    manifest.repository !== repository ||
    manifest.platform !== "linux-x64" ||
    !/^\d+\.\d+\.\d+-fork\.\d+\.\d+$/.test(manifest.version) ||
    manifest.archive !== `t3-${manifest.version}-linux-x64.tar.gz` ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  ) {
    throw new Error("Runtime manifest does not match the requested commit/platform.");
  }
}

async function manifest(directory) {
  const version = process.env.RUNTIME_VERSION;
  const archive = `t3-${version}-linux-x64.tar.gz`;
  const value = {
    repository: process.env.GITHUB_REPOSITORY,
    commit: process.env.GITHUB_SHA,
    version,
    archive,
    platform: "linux-x64",
    sha256: await checksum(NodePath.join(directory, archive)),
  };
  validateManifest(value, process.env.GITHUB_SHA);
  writeJson(NodePath.join(directory, "manifest.json"), value);
}

async function build(sha, branch, signal) {
  const request = NodeCrypto.randomUUID();
  gh([
    "workflow",
    "run",
    workflow,
    "--repo",
    repository,
    "--ref",
    branch,
    "-f",
    `request_id=${request}`,
  ]);
  console.log(
    `Requested CI verification and build for ${sha}. Waiting on GitHub, not building locally.`,
  );
  const deadline = Date.now() + 90 * 60 * 1000;
  let runId;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (!runId) {
      const runs = JSON.parse(
        gh([
          "run",
          "list",
          "--repo",
          repository,
          "--workflow",
          workflow,
          "--event",
          "workflow_dispatch",
          "--limit",
          "50",
          "--json",
          "databaseId,displayTitle,headSha,url",
        ]),
      );
      const found = runs.find((entry) => entry.displayTitle === `Fork runtime ${request}`);
      if (found) {
        if (found.headSha !== sha)
          throw new Error("Remote branch changed during dispatch. Retry from its new commit.");
        runId = found.databaseId;
        console.log(found.url);
      }
    }
    if (runId) {
      const result = JSON.parse(
        gh(["run", "view", String(runId), "--repo", repository, "--json", "status,conclusion"]),
      );
      if (result.status === "completed") {
        if (result.conclusion !== "success")
          throw new Error(`CI ${result.conclusion}; service left unchanged.`);
        return runId;
      }
    }
    await NodeTimersPromises.setTimeout(10_000, undefined, { signal });
  }
  throw new Error("Timed out waiting for GitHub. Service left unchanged.");
}

function serviceState(home) {
  const state = readJson(NodePath.join(home, "runtime/service-state.json"));
  if (state.protocol !== 3 || state.update?.status === "pending") {
    throw new Error("Unsupported launcher protocol or another update is in progress.");
  }
  if (!runtimeVersion.test(state.activeVersion)) throw new Error("Invalid active runtime version.");
  return state;
}

function activate(home, version) {
  if (!runtimeVersion.test(version)) throw new Error("Invalid target runtime version.");
  const runtime = NodePath.join(home, "runtime/versions", version);
  if (NodeFS.readFileSync(NodePath.join(runtime, ".install-complete"), "utf8").trim() !== version) {
    throw new Error("Runtime installation is incomplete.");
  }
  console.log(
    `Switching service to ${version}. T3 will briefly disconnect. See ${home}/userdata/logs/boot-service.log`,
  );
  run(
    NodePath.join(runtime, "t3"),
    ["service", "install", "--base-dir", home, "--allow-downgrade"],
    {
      stdio: "inherit",
      env: { ...process.env, T3_BOOT_SERVICE_UNIT: "t3code.service" },
    },
  );
}

async function deploy(home, history, signal) {
  const initial = serviceState(home).activeVersion;
  const sha = run("git", ["rev-parse", "HEAD"]);
  const branch = run("git", ["symbolic-ref", "--short", "HEAD"]);
  if (run("git", ["status", "--porcelain"])) throw new Error("Commit your changes first.");
  const remote = gh([
    "api",
    `repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`,
    "--jq",
    ".object.sha",
  ]);
  if (remote !== sha)
    throw new Error("Push the current branch to origin first. No changes were deployed.");
  const runId = await build(sha, branch, signal);
  signal.throwIfAborted();
  if (serviceState(home).activeVersion !== initial)
    throw new Error("Service changed during build; retry deployment.");
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-deploy-"));
  try {
    gh([
      "run",
      "download",
      String(runId),
      "--repo",
      repository,
      "--name",
      "fork-runtime",
      "--dir",
      scratch,
    ]);
    const value = readJson(NodePath.join(scratch, "manifest.json"));
    validateManifest(value, sha);
    const archive = NodePath.join(scratch, value.archive);
    if ((await checksum(archive)) !== value.sha256) throw new Error("Runtime checksum mismatch.");
    const staging = NodePath.join(scratch, "unpacked");
    NodeFS.mkdirSync(staging);
    run("tar", ["-xzf", archive, "-C", staging, "--strip-components=1"]);
    const reported = run(NodePath.join(staging, "t3"), ["--version"]);
    if (!reported.endsWith(`v${value.version}`)) throw new Error("Runtime version mismatch.");
    const target = NodePath.join(home, "runtime/versions", value.version);
    if (NodeFS.existsSync(target))
      throw new Error("Target runtime already exists; refusing to overwrite it.");
    const installing = NodeFS.mkdtempSync(NodePath.join(home, "runtime/versions/.fork-install-"));
    try {
      NodeFS.cpSync(staging, installing, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(installing, ".install-complete"), `${value.version}\n`, {
        mode: 0o600,
      });
      NodeFS.renameSync(installing, target);
    } finally {
      NodeFS.rmSync(installing, { recursive: true, force: true });
    }
    if (serviceState(home).activeVersion !== initial)
      throw new Error("Service changed during download; retry deployment.");
    writeJson(history, {
      previousVersion: initial,
      targetVersion: value.version,
      commit: sha,
      runId,
    });
    return value.version;
  } finally {
    NodeFS.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function main(args, signal = new AbortController().signal) {
  if (args[0] === "manifest") return manifest(args[1]);
  if (
    HostProcess.Platform.defaultValue() !== "linux" ||
    HostProcess.Architecture.defaultValue() !== "x64"
  )
    throw new Error("This action targets the Linux x64 service.");
  const home = NodePath.resolve(
    process.env.T3CODE_DEPLOY_HOME || NodePath.join(NodeOS.homedir(), ".t3"),
  );
  const runtime = NodePath.join(home, "runtime");
  const history = NodePath.join(runtime, "fork-deployment.json");
  const lock = NodePath.join(runtime, ".fork-deploy-lock");
  if (args[0] === "status") {
    console.log(
      JSON.stringify(
        {
          service: serviceState(home),
          deployment: NodeFS.existsSync(history) ? readJson(history) : null,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!["deploy", "rollback"].includes(args[0]))
    throw new Error("Usage: node scripts/fork/deploy.mjs deploy|rollback|status");
  NodeFS.mkdirSync(lock);
  let target;
  try {
    if (args[0] === "deploy") target = await deploy(home, history, signal);
    else {
      const state = serviceState(home);
      const previous = readJson(history);
      if (state.activeVersion !== previous.targetVersion)
        throw new Error("Service no longer runs this deployment; rollback refused.");
      target = previous.previousVersion;
    }
  } finally {
    NodeFS.rmdirSync(lock);
  }
  activate(home, target);
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  main(process.argv.slice(2), controller.signal).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
